// OpenDante companion: a tiny zero-dependency local service (port 4097) started by the launcher. It does the two
// things the browser cannot: (1) serve the built web UI so OpenDante is one app window, and (2) write files / run
// commands for the Einstellungen panel — store the Claude key in OpenCode, write global instructions to AGENTS.md,
// save skills, run the updates. The chat itself goes straight to the OpenCode server (port 4096) and needs none of this.
import http from 'node:http'
import { promises as fs } from 'node:fs'
import { createReadStream, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.OPENDANTE_ROOT || path.resolve(HERE, '..')
const DIST = path.join(ROOT, 'web', 'dist')
const CFG = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode')
const PORT = Number(process.env.OPENDANTE_COMPANION_PORT || 4097)
// Default local model: from config/models.json, the one list shared with the app and the installer.
const MODEL = process.env.OPENDANTE_MODEL || (() => {
  try { return JSON.parse(readFileSync(path.join(ROOT, 'config', 'models.json'), 'utf8')).default } catch { return 'qwen3.8:27b' }
})()
// An Ollama model name like "qwen3.8:27b" or "user/Model-Name:q4_K_M" — nothing else may reach `ollama pull`.
const modelOk = (m) => typeof m === 'string' && /^[\w.-]+(\/[\w.-]+)?(:[\w.-]+)?$/.test(m)
const PROJECTS = process.env.OPENDANTE_PROJECTS || path.join(os.homedir(), 'OpenDante-Projekte')
const CHATS = path.join(process.env.OPENDANTE_DATA || path.join(os.homedir(), '.opendante'), 'chats')
// Where pasted / dropped images are saved so the model can read them by path (the browser cannot write to disk, and
// OpenCode reads an attachment from a file:// url). The vision model reads the image and any text in it.
const ATTACH_DIR = path.join(path.dirname(CHATS), 'attachments')
const IMG_EXT = { png: 'png', jpg: 'jpg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' }
// The Claude key lives in OpenDante's own data dir, NOT in opencode.json — OpenCode rewrites its own config on start
// and would drop a provider block we hand-wrote, which made the key "disappear" after saving.
const CLAUDE_FILE = path.join(path.dirname(CHATS), 'claude-key.json')

// Only the app itself may use the companion. Listening on 127.0.0.1 is not enough: any web page open in the same browser
// can send requests to localhost. So: answer CORS only for our own origins, refuse requests that carry a foreign Origin,
// and require JSON for every POST (a foreign page cannot send JSON without a CORS preflight, which it does not pass).
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, // the app window served by this companion
  'http://127.0.0.1:5173', 'http://localhost:5173',       // the Vite dev server (npm run dev)
  ...String(process.env.OPENDANTE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
])
const originOk = (req) => !req.headers.origin || ALLOWED_ORIGINS.has(req.headers.origin) // no Origin = a local tool, not a page
const corsFor = (req) => (req.headers.origin && ALLOWED_ORIGINS.has(req.headers.origin)
  ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
  : {})
const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', ...(res.cors || {}) }); res.end(JSON.stringify(obj)) }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const s = Buffer.concat(chunks).toString('utf8')
  return s ? JSON.parse(s) : {}
}

// ---- Einstellungen actions (file writes) ----
const U0 = '<!-- OPENDANTE-USER-START -->', U1 = '<!-- OPENDANTE-USER-END -->'

/** Put the user's global instructions into OpenCode's global AGENTS.md, inside a replaceable marked block. */
async function setGlobalInstructions(text) {
  const file = path.join(CFG, 'AGENTS.md')
  let base = ''
  try { base = await fs.readFile(file, 'utf8') } catch { /* none yet */ }
  base = base.replace(new RegExp(`\\n*${U0}[\\s\\S]*?${U1}\\n*`), '\n').replace(/\s*$/, '')
  const block = text && text.trim() ? `\n\n${U0}\n## Persönliche Anweisungen des Nutzers\n${text.trim()}\n${U1}\n` : '\n'
  await fs.mkdir(CFG, { recursive: true })
  await fs.writeFile(file, base + block)
}

/** Store the Claude key + chosen model in OpenDante's own file (so OpenCode can't drop it), and clear any copy that an
 *  earlier version left inside opencode.json. */
async function setAnthropic(apiKey, model) {
  await fs.mkdir(path.dirname(CLAUDE_FILE), { recursive: true })
  if (apiKey && apiKey.trim()) {
    await fs.writeFile(CLAUDE_FILE, JSON.stringify({ apiKey: apiKey.trim(), model: model || 'claude-sonnet-5-5' }))
  } else {
    try { await fs.unlink(CLAUDE_FILE) } catch { /* nothing to remove */ }
  }
  // Remove a key an earlier build wrote into OpenCode's own config — it isn't needed there and OpenCode may choke on it.
  try {
    const file = path.join(CFG, 'opencode.json')
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'))
    if (cfg.provider && cfg.provider.anthropic) { delete cfg.provider.anthropic; await fs.writeFile(file, JSON.stringify(cfg, null, 2)) }
  } catch { /* no config yet */ }
}

/** List installed skills (one folder each with a SKILL.md), with name + description read from the --- head. */
async function listSkills() {
  const dir = path.join(CFG, 'skills')
  let slugs = []
  try { slugs = await fs.readdir(dir) } catch { return [] }
  const out = []
  for (const slug of slugs) {
    try {
      const md = await fs.readFile(path.join(dir, slug, 'SKILL.md'), 'utf8')
      const name = (md.match(/^\s*---[\s\S]*?\bname:\s*["']?([^"'\n]+)/)?.[1] || slug).trim()
      const description = (md.match(/^\s*---[\s\S]*?\bdescription:\s*["']?([^"'\n]+)/)?.[1] || '').trim()
      out.push({ slug, name, description })
    } catch { /* not a skill folder */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

async function saveSkill(name, content) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) throw new Error('Ungültiger Name')
  const dir = path.join(CFG, 'skills', slug)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), String(content || ''))
  return slug
}

// ---- in-app folder browser ----
// The browser can't read the file system, so the companion lists folders and the app shows its own picker (always
// visible in the app window, supports picking several at once — unlike the native dialog, which opened behind the window).

/** Windows drive roots (C:\, D:\, …) plus a few handy starting points. */
async function fsRoots() {
  const out = []
  if (process.platform === 'win32') {
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const p = `${l}:\\`
      try { if ((await fs.stat(p)).isDirectory()) out.push({ name: `${l}:`, path: p }) } catch { /* no such drive */ }
    }
  } else {
    out.push({ name: '/', path: '/' })
  }
  for (const [name, p] of [['Benutzer', os.homedir()], ['Desktop', path.join(os.homedir(), 'Desktop')], ['Dokumente', path.join(os.homedir(), 'Documents')], ['OpenDante-Projekte', PROJECTS]]) {
    try { if ((await fs.stat(p)).isDirectory() && !out.some((x) => x.path === p)) out.push({ name, path: p }) } catch { /* missing */ }
  }
  return out
}

const FS_MAX_FILES = 500 // the file picker never lists more than this many files of one folder

/** Regular files of a folder (`ents` = its readdir result) as { name, path, size }: sorted by name, at most
 *  FS_MAX_FILES, same system-noise filter as for folders. Entries that cannot be stat'ed (locked system files) are left out. */
async function fsFiles(abs, ents) {
  const names = []
  for (const e of ents) {
    if (!e.isFile() && !e.isSymbolicLink()) continue
    if (e.name.startsWith('$')) continue // Windows system noise
    if (e.isSymbolicLink()) { try { if (!(await fs.stat(path.join(abs, e.name))).isFile()) continue } catch { continue } }
    names.push(e.name)
  }
  names.sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }))
  const out = []
  for (const name of names.slice(0, FS_MAX_FILES)) {
    const p = path.join(abs, name)
    try { out.push({ name, path: p, size: (await fs.stat(p)).size }) } catch { /* vanished or locked */ }
  }
  return out
}

/** Sub-folders of `dir` (directories only), with the parent path for going up. With `withFiles` the listing also has
 *  `files` (the in-app file picker); without it the answer is exactly what the folder picker always got. */
async function fsList(dir, withFiles = false) {
  if (!dir) return { path: '', parent: null, dirs: await fsRoots(), ...(withFiles ? { files: [] } : {}) }
  const abs = path.resolve(String(dir))
  let ents = []
  try { ents = await fs.readdir(abs, { withFileTypes: true }) } catch (e) { throw new Error('Ordner nicht lesbar: ' + (e && e.code || e)) }
  const dirs = []
  for (const e of ents) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue
    if (e.name.startsWith('$') || e.name === 'System Volume Information') continue // Windows system noise
    const p = path.join(abs, e.name)
    if (e.isSymbolicLink()) { try { if (!(await fs.stat(p)).isDirectory()) continue } catch { continue } }
    dirs.push({ name: e.name, path: p })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))
  const parent = path.dirname(abs)
  return { path: abs, parent: parent === abs ? '' : parent, dirs, ...(withFiles ? { files: await fsFiles(abs, ents) } : {}) } // parent '' = go back to the roots
}


/** Fire an update script and return at once. Windows only (git/powershell/ollama live there). `model` = the local
 *  model chosen in Einstellungen (pulled by "Modelle aktualisieren"); falls back to the default. */
function runUpdate(kind, model) {
  if (kind === 'models' && model && !modelOk(model)) throw new Error('Ungültiger Modellname.')
  if (process.platform !== 'win32') return { started: false, note: 'Updates laufen nur unter Windows.' }
  let cmd, args
  if (kind === 'models') { cmd = 'ollama'; args = ['pull', model || MODEL] }
  else { cmd = 'powershell.exe'; args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Set-Location '${ROOT}'; git pull; ./scripts/install.ps1 -SkipModel`] }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: ROOT })
  child.on('error', (e) => console.error(`${cmd} konnte nicht starten:`, e.message)) // e.g. ollama not on PATH
  child.unref()
  return { started: true }
}

// ---- Projekte (GitHub) ----
// Run a command and collect its output (no shell, so arguments can't inject). Returns { code, out, err }.
function runCmd(cmd, args, cwd) {
  return new Promise((resolve) => {
    let child
    try { child = spawn(cmd, args, { cwd }) } catch (e) { return resolve({ code: -1, out: '', err: String(e && e.message || e) }) }
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => resolve({ code: -1, out, err: String(e && e.message || e) }))
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }))
  })
}

// Only accept a plain GitHub https URL, so nothing odd reaches git. Returns the repo name or null.
function repoName(url) {
  const m = String(url || '').trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)
  if (!m) return null
  const name = m[2].replace(/[^\w.-]/g, '')
  return name && name !== '.' && name !== '..' ? name : null
}

/** Clone a GitHub repo into the projects folder (or pull if it is already there). */
async function cloneRepo(url) {
  const name = repoName(url)
  if (!name) throw new Error('Bitte eine GitHub-Adresse wie https://github.com/benutzer/projekt angeben.')
  await fs.mkdir(PROJECTS, { recursive: true })
  const dest = path.join(PROJECTS, name)
  let hasGit = false
  try { hasGit = (await fs.stat(path.join(dest, '.git'))).isDirectory() } catch { /* not cloned yet */ }
  const r = hasGit
    ? await runCmd('git', ['-C', dest, 'pull', '--ff-only'], dest)
    : await runCmd('git', ['clone', '--depth', '1', String(url).trim(), dest], PROJECTS)
  return { ok: r.code === 0, name, path: dest, updated: hasGit, out: r.out, err: r.err }
}

/** List cloned projects (folders with a .git under the projects folder). */
async function listRepos() {
  let names = []
  try { names = await fs.readdir(PROJECTS) } catch { return [] }
  const out = []
  for (const name of names) {
    const p = path.join(PROJECTS, name)
    try { if ((await fs.stat(path.join(p, '.git'))).isDirectory()) out.push({ name, path: p }) } catch { /* not a repo */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/** Run a safe git action in a folder that is a git repo (status / commit / push / pull). */
async function gitAction(dir, action, message) {
  const p = path.resolve(String(dir || ''))
  try { if (!(await fs.stat(path.join(p, '.git'))).isDirectory()) throw new Error() } catch { throw new Error('Das ist kein Git-Projektordner.') }
  if (action === 'status') return await runCmd('git', ['-C', p, 'status', '--short', '--branch'], p)
  if (action === 'pull') return await runCmd('git', ['-C', p, 'pull', '--ff-only'], p)
  if (action === 'push') return await runCmd('git', ['-C', p, 'push'], p)
  if (action === 'commit') {
    const msg = String(message || '').trim()
    if (!msg) throw new Error('Bitte eine Commit-Nachricht angeben.')
    const add = await runCmd('git', ['-C', p, 'add', '-A'], p)
    if (add.code !== 0) return add
    return await runCmd('git', ['-C', p, 'commit', '-m', msg], p)
  }
  throw new Error('Unbekannte Git-Aktion.')
}

// Before the UI turns on OpenCode's snapshots ("Sicherung einschalten" = git init), make sure folders full of generated
// files stay out of them. OpenCode snapshots the whole git worktree before each step: measured 2026-10-15, 20,000 files
// in node_modules without .gitignore = 86 s before the first model request, 5 s with it (OD-26).
const DEFAULT_GITIGNORE = [
  '# Von OpenDante angelegt, damit die Sicherung (Rückgängig) schnell bleibt:',
  '# Ordner mit Dateien, die sich jederzeit neu erzeugen lassen.',
  'node_modules/', '.venv/', 'venv/', '__pycache__/', '*.pyc', 'dist/', 'build/', '.next/', '.cache/', 'target/',
  '.opendante/', '',
].join('\n')

/** Check that a folder may get snapshots and give it a .gitignore if it has none. Refuses drive roots, the home folder
 *  and system folders: snapshotting them would copy huge amounts of unrelated files. */
async function prepareBackup(dir) {
  const p = path.resolve(String(dir || ''))
  try { if (!(await fs.stat(p)).isDirectory()) throw new Error() } catch { throw new Error('Diesen Ordner gibt es nicht.') }
  const low = p.toLowerCase().replace(/[\\/]+$/, '')
  const home = os.homedir().toLowerCase()
  const blocked = path.parse(p).root.toLowerCase().replace(/[\\/]+$/, '') === low || low === home ||
    [path.join(home, 'desktop'), path.join(home, 'documents'), path.join(home, 'downloads')].includes(low) ||
    /^[a-z]:\\(windows|program files( \(x86\))?|programdata)(\\|$)/.test(low)
  if (blocked) throw new Error('Für diesen Ordner schalte ich die Sicherung nicht ein: er ist zu groß und enthält fremde Dateien. Lege für das Projekt einen eigenen Unterordner an.')
  const file = path.join(p, '.gitignore')
  try { await fs.access(file); return { created: false } } catch { /* none yet */ }
  await fs.writeFile(file, DEFAULT_GITIGNORE, 'utf8')
  return { created: true }
}

// ---- Verlauf (gespeicherte Chats) ----
// One chat = <id>.json (everything the window shows, incl. thinking, Claude replies and token usage) plus a small
// <id>.meta.json (title, date, usage) so listing stays fast however long the chats get. The OpenCode session id inside
// lets a reopened chat continue with the model's full context.
const chatIdOk = (id) => typeof id === 'string' && /^[a-z0-9-]{8,64}$/.test(id)

async function saveChat(chat) {
  if (!chat || !chatIdOk(chat.id)) throw new Error('Ungültige Chat-Kennung.')
  if (!Array.isArray(chat.messages)) throw new Error('Chat ohne Nachrichten.')
  const meta = {
    id: chat.id,
    title: String(chat.title || 'Ohne Titel').slice(0, 120),
    createdAt: Number(chat.createdAt) || Date.now(),
    updatedAt: Date.now(),
    workdir: String(chat.workdir || ''),
    model: String(chat.model || ''),
    messages: chat.messages.length,
    usage: chat.usage && typeof chat.usage === 'object' ? chat.usage : {},
  }
  await fs.mkdir(CHATS, { recursive: true })
  await fs.writeFile(path.join(CHATS, `${chat.id}.json`), JSON.stringify({ ...chat, ...meta, messages: chat.messages }))
  await fs.writeFile(path.join(CHATS, `${chat.id}.meta.json`), JSON.stringify(meta))
  return meta
}

/** All chats, newest first (metadata only). */
async function listChats() {
  let names = []
  try { names = await fs.readdir(CHATS) } catch { return [] }
  const out = []
  for (const n of names) {
    if (!n.endsWith('.meta.json')) continue
    try { out.push(JSON.parse(await fs.readFile(path.join(CHATS, n), 'utf8'))) } catch { /* half-written file */ }
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return out
}

async function loadChat(id) {
  if (!chatIdOk(id)) throw new Error('Ungültige Chat-Kennung.')
  try { return JSON.parse(await fs.readFile(path.join(CHATS, `${id}.json`), 'utf8')) } catch { throw new Error('Chat nicht gefunden.') }
}

/** Rename a saved chat (updates both the full file and its metadata). */
async function renameChat(id, title) {
  if (!chatIdOk(id)) throw new Error('Ungültige Chat-Kennung.')
  const t = String(title || '').trim().slice(0, 120)
  if (!t) throw new Error('Bitte einen Namen angeben.')
  const chat = await loadChat(id)
  chat.title = t
  return await saveChat(chat) // rewrites <id>.json + <id>.meta.json, returns the metadata
}

/** Delete a saved chat (both files). Succeeds even if a file is already gone. */
async function deleteChat(id) {
  if (!chatIdOk(id)) throw new Error('Ungültige Chat-Kennung.')
  await fs.rm(path.join(CHATS, `${id}.json`), { force: true })
  await fs.rm(path.join(CHATS, `${id}.meta.json`), { force: true })
  return { ok: true, id }
}

// ---- Claude-API-Brücke (bezahlt) ----
// Read the stored Anthropic key + model from OpenCode's config (written by the Einstellungen panel).
async function readAnthropic() {
  try {
    const s = JSON.parse(await fs.readFile(CLAUDE_FILE, 'utf8'))
    if (s && s.apiKey) return { key: s.apiKey, model: s.model || null }
  } catch { /* not set via the dedicated file */ }
  // Backward compatibility: a key an older build saved inside opencode.json still works.
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(CFG, 'opencode.json'), 'utf8'))
    const a = cfg.provider && cfg.provider.anthropic
    if (a && a.options && a.options.apiKey) return { key: a.options.apiKey, model: a.models ? Object.keys(a.models)[0] : null }
  } catch { /* none */ }
  return {}
}

// Price per million tokens [input, output] in USD — Anthropic first-party rates (claude-api reference, cached
// 2026-10-06). Unknown models are charged at the Opus rate, so the cap errs on the safe side.
const CLAUDE_PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] }
const DEFAULT_CLAUDE = 'claude-sonnet-5-5'
const USAGE_FILE = path.join(path.dirname(CHATS), 'claude-usage.json')
const costUsd = (model, inTok, outTok) => {
  const [pi, po] = CLAUDE_PRICES[model] || CLAUDE_PRICES['claude-opus-5-5']
  return (inTok * pi + outTok * po) / 1e6
}
const today = () => new Date().toISOString().slice(0, 10)

/** What the paid Claude modes spent today (resets at midnight UTC). */
async function claudeUsage() {
  try {
    const u = JSON.parse(await fs.readFile(USAGE_FILE, 'utf8'))
    if (u.date === today()) return { date: u.date, usd: Number(u.usd) || 0, calls: Number(u.calls) || 0 }
  } catch { /* first call today */ }
  return { date: today(), usd: 0, calls: 0 }
}
async function addClaudeUsage(usd) {
  const u = await claudeUsage()
  const next = { date: u.date, usd: u.usd + usd, calls: u.calls + 1 }
  await fs.mkdir(path.dirname(USAGE_FILE), { recursive: true })
  await fs.writeFile(USAGE_FILE, JSON.stringify(next))
  return next
}

// Offload preferences the UI keeps in sync (the "Claude-Hilfe" slider and the daily cap), so the MCP tool path
// (companion/claude-mcp.mjs → POST /claude) honours the same on/off and budget as the UI, even though OpenCode calls
// it without the browser in the loop. Stored in OpenDante's data dir, separate from the key.
const PREFS_FILE = path.join(path.dirname(CHATS), 'claude-prefs.json')
async function readPrefs() {
  try { const p = JSON.parse(await fs.readFile(PREFS_FILE, 'utf8')); return { dailyUsd: Number(p.dailyUsd) || 0, offloadShare: Number(p.offloadShare) || 0 } }
  catch { return { dailyUsd: 0, offloadShare: 0 } }
}
async function setPrefs({ offloadShare, dailyUsd }) {
  await fs.mkdir(path.dirname(PREFS_FILE), { recursive: true })
  const share = Math.max(0, Math.min(0.9, Number(offloadShare) || 0))
  const cap = Math.max(0, Number(dailyUsd) || 0)
  await fs.writeFile(PREFS_FILE, JSON.stringify({ offloadShare: share, dailyUsd: cap }))
  return { ok: true, offloadShare: share, dailyUsd: cap }
}

// Second gate, server-side: a subtask the UI marked for offload (kind:'offload') must not leave the PC if it looks
// sensitive or against Anthropic's usage policy. Mirrors offloadAllowed() in web/src/claude.ts (keep both in sync).
// A heuristic backstop — the primary protection is the local model marking only self-contained, benign parts.
const OFFLOAD_SENSITIVE = [
  /\b(sex|sexual|sexuell|porn|porno|nsfw|nackt|nude|naked|explicit|explizit|eroti|fetisch|xxx|onlyfans|deepnude|intim)\w*/i,
  /face[\s-]?swap|faceswap|gesichtstausch|deepfake/i,
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
  /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})/,
  /\b(passwort|password|api[-_ ]?key|secret|token|zugangsdaten|kreditkart|credit[\s-]?card|iban)\w*/i,
]
const offloadBlocked = (text) => OFFLOAD_SENSITIVE.some((re) => re.test(String(text || '')))

/** One call to the Claude Messages API with the stored key. Used by the auto offload/audit modes. A daily cap in USD
 *  (`capUsd`, from Einstellungen; 0 = none) is enforced here, server-side, before each call. */
async function callClaude({ system, prompt, model, capUsd, kind }) {
  if (kind === 'offload') {
    // The MCP tool (claude-helfer) calls this without the browser; honour the gate and the slider here too. The safety
    // gate comes first, so sensitive content always gets the "bleibt lokal" message even when offload is otherwise off.
    if (offloadBlocked(prompt)) throw new Error('Teilaufgabe bleibt lokal: könnte Sensibles oder gegen Richtlinien Verstoßendes enthalten.')
    if (!((await readPrefs()).offloadShare > 0)) throw new Error('Auslagern ist ausgeschaltet (Regler „Claude-Hilfe“ steht auf 0 %).')
  }
  const stored = await readAnthropic()
  if (!stored.key) throw new Error('Kein Claude-Schlüssel gespeichert (Einstellungen → Claude-Verbindung → Speichern).')
  const cap = Number(capUsd) || (await readPrefs()).dailyUsd || 0 // the MCP path sends no capUsd → use the stored cap
  if (cap > 0) {
    const u = await claudeUsage()
    if (u.usd >= cap) throw new Error(`Tageslimit für Claude erreicht (${u.usd.toFixed(2)} $ von ${cap.toFixed(2)} $). Ab Mitternacht (UTC) wieder frei, oder das Limit in den Einstellungen erhöhen.`)
  }
  const useModel = model || stored.model || DEFAULT_CLAUDE
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': stored.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: useModel, max_tokens: 4096, system: system || '', messages: [{ role: 'user', content: String(prompt || '') }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j && j.error && j.error.message) || `Claude-API Fehler ${r.status}`)
  const text = Array.isArray(j.content) ? j.content.filter((c) => c.type === 'text').map((c) => c.text).join('') : ''
  const usage = { input_tokens: Number(j.usage && j.usage.input_tokens) || 0, output_tokens: Number(j.usage && j.usage.output_tokens) || 0 }
  const cost = costUsd(useModel, usage.input_tokens, usage.output_tokens)
  const day = await addClaudeUsage(cost)
  return { text, model: useModel, usage, costUsd: cost, todayUsd: day.usd }
}

/** Verify the stored key with a tiny real call (max_tokens 1). Returns {ok, model} or {ok:false, error}. */
async function testClaude(model) {
  const stored = await readAnthropic()
  if (!stored.key) return { ok: false, error: 'Kein Claude-Schlüssel gespeichert — zuerst eintragen und auf Speichern klicken.' }
  const useModel = model || stored.model || DEFAULT_CLAUDE
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': stored.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: useModel, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, model: useModel, error: (j && j.error && j.error.message) || `Fehler ${r.status}` }
    return { ok: true, model: useModel }
  } catch (e) { return { ok: false, model: useModel, error: String((e && e.message) || e) } }
}

/** Save a pasted or dropped image (base64) to the attachments folder and return its path, so the UI can attach it like
 *  a picked file. Images only (the model reads them); a size cap keeps the context sane. */
async function saveAttachment({ name, dataBase64 }) {
  const ext = String(name || '').split('.').pop()?.toLowerCase()
  if (!ext || !IMG_EXT[ext]) throw new Error('Nur Bilder (png, jpg, gif, webp) können so eingefügt werden.')
  const buf = Buffer.from(String(dataBase64 || ''), 'base64')
  if (!buf.length) throw new Error('Leeres Bild.')
  if (buf.length > 25 * 1024 * 1024) throw new Error('Bild zu groß (max. 25 MB).')
  await fs.mkdir(ATTACH_DIR, { recursive: true })
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const safe = (String(name).replace(/[^\w.-]+/g, '_').replace(/^[-_.]+/, '') || `bild.${ext}`).slice(-60)
  const file = path.join(ATTACH_DIR, `${id}-${safe}`)
  await fs.writeFile(file, buf)
  return { path: file, name: safe, size: buf.length }
}

// ---- Projektnotiz (OD-41: a per-project memory that OpenDante prepends to every prompt in that folder) ----
// Stored inside the project as .opendante/projektnotiz.md so it travels with the project and the agent can update it.
const noteFile = (dir) => path.join(path.resolve(String(dir || '')), '.opendante', 'projektnotiz.md')
async function readProjectNote(dir) {
  if (!dir) return { note: '' } // the default server folder is not a project
  try { return { note: await fs.readFile(noteFile(dir), 'utf8') } } catch { return { note: '' } }
}
async function writeProjectNote(dir, content) {
  const d = path.resolve(String(dir || ''))
  const st = await fs.stat(d).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error('Kein gültiger Projektordner.')
  const s = String(content || '')
  if (s.length > 20000) throw new Error('Notiz zu lang (max. 20.000 Zeichen).')
  await fs.mkdir(path.join(d, '.opendante'), { recursive: true })
  if (s.trim()) await fs.writeFile(noteFile(d), s)
  else { try { await fs.unlink(noteFile(d)) } catch { /* already gone */ } }
  return { ok: true, chars: s.trim() ? s.length : 0 }
}

// ---- static web UI ----
async function serveStatic(url, res) {
  let rel
  try { rel = decodeURIComponent(url.pathname) } catch { res.writeHead(400); return res.end() } // e.g. "/%": not a path
  if (rel === '/' || !path.extname(rel)) rel = '/index.html' // SPA fallback
  const file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end() }
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile()) throw new Error('dir')
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    // A file that vanishes between stat and read (an update rebuilding web/dist) must not take the service down.
    createReadStream(file).on('error', () => res.destroy()).pipe(res)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('web/dist fehlt — bitte scripts/install.ps1 ausführen (baut die Oberfläche).')
  }
}

// The Host header must name this service. A web page that points its own domain name at 127.0.0.1 ("DNS rebinding")
// would otherwise count as same-origin, send no Origin header on GET and could read chats, folders and skills.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
const hostOk = (req) => HOSTS.has(String(req.headers.host || '').toLowerCase())

const server = http.createServer(async (req, res) => {
  let url
  // A malformed address (e.g. "//" or "/%") used to throw outside any try and end the whole process (AN-01).
  try { url = new URL(req.url, 'http://x') } catch { return sendJson(res, 400, { error: 'Ungültige Adresse.' }) }
  res.cors = corsFor(req)
  if (!hostOk(req)) return sendJson(res, 403, { error: 'Fremder Hostname abgelehnt.' })
  if (!originOk(req)) return sendJson(res, 403, { error: 'Fremde Herkunft abgelehnt.' })
  if (req.method === 'OPTIONS') { res.writeHead(204, res.cors); return res.end() }
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    return sendJson(res, 415, { error: 'Nur JSON-Anfragen.' })
  }
  try {
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'opendante-companion' })
    if (req.method === 'GET' && url.pathname === '/skills') return sendJson(res, 200, await listSkills())
    if (req.method === 'GET' && url.pathname === '/repos') return sendJson(res, 200, await listRepos())
    if (req.method === 'GET' && url.pathname === '/chats') return sendJson(res, 200, await listChats())
    if (req.method === 'POST' && url.pathname === '/chats/rename') { const b = await readBody(req); return sendJson(res, 200, await renameChat(b.id, b.title)) }
    if (req.method === 'POST' && url.pathname === '/chats/delete') { const b = await readBody(req); return sendJson(res, 200, await deleteChat(b.id)) }
    if (req.method === 'GET' && url.pathname.startsWith('/chats/')) return sendJson(res, 200, await loadChat(url.pathname.slice(7)))
    if (req.method === 'POST' && url.pathname === '/chats') { const b = await readBody(req); return sendJson(res, 200, await saveChat(b)) }
    if (req.method === 'GET' && url.pathname === '/fs') return sendJson(res, 200, await fsList(url.searchParams.get('path') || '', url.searchParams.get('files') === '1'))
    if (req.method === 'POST' && url.pathname === '/repo/clone') { const b = await readBody(req); return sendJson(res, 200, await cloneRepo(b.url)) }
    if (req.method === 'POST' && url.pathname === '/git') { const b = await readBody(req); return sendJson(res, 200, await gitAction(b.path, b.action, b.message)) }
    if (req.method === 'POST' && url.pathname === '/git/prepare') { const b = await readBody(req); return sendJson(res, 200, await prepareBackup(b.path)) }
    if (req.method === 'POST' && url.pathname === '/settings') {
      const b = await readBody(req)
      await setGlobalInstructions(b.globalInstructions ?? '')
      await setAnthropic(b.apiKey ?? '', b.claudeModel)
      if (b.offloadShare !== undefined || b.claudeDailyUsd !== undefined) await setPrefs({ offloadShare: b.offloadShare, dailyUsd: b.claudeDailyUsd })
      return sendJson(res, 200, { ok: true })
    }
    // Lightweight: the "Claude-Hilfe" slider and the daily cap, so the MCP offload tool honours them (no AGENTS/key rewrite).
    if (req.method === 'POST' && url.pathname === '/offload-prefs') { const b = await readBody(req); return sendJson(res, 200, await setPrefs(b)) }
    if (req.method === 'GET' && url.pathname === '/offload-prefs') return sendJson(res, 200, await readPrefs())
    if (req.method === 'POST' && url.pathname === '/skills') {
      const b = await readBody(req)
      const slug = await saveSkill(b.name, b.content)
      return sendJson(res, 200, { ok: true, slug })
    }
    if (req.method === 'POST' && url.pathname === '/attach') { const b = await readBody(req); return sendJson(res, 200, await saveAttachment(b)) }
    if (req.method === 'GET' && url.pathname === '/project-note') return sendJson(res, 200, await readProjectNote(url.searchParams.get('path') || ''))
    if (req.method === 'POST' && url.pathname === '/project-note') { const b = await readBody(req); return sendJson(res, 200, await writeProjectNote(b.path, b.content)) }
    if (req.method === 'POST' && url.pathname === '/claude') { const b = await readBody(req); return sendJson(res, 200, await callClaude(b)) }
    if (req.method === 'POST' && url.pathname === '/claude/test') { const b = await readBody(req); return sendJson(res, 200, await testClaude(b.model)) }
    if (req.method === 'GET' && url.pathname === '/claude/usage') return sendJson(res, 200, await claudeUsage())
    if (req.method === 'POST' && url.pathname === '/update/app') return sendJson(res, 200, runUpdate('app'))
    if (req.method === 'POST' && url.pathname === '/update/models') { const b = await readBody(req); return sendJson(res, 200, runUpdate('models', b.model)) }
    if (req.method === 'GET') return await serveStatic(url, res)
    sendJson(res, 404, { error: 'not found' })
  } catch (e) {
    if (res.headersSent) return res.destroy()
    sendJson(res, 400, { error: String(e && e.message || e) })
  }
})

// Last line of defence: the companion runs hidden and nothing restarts it until the next launch, so one unexpected
// error must cost one request, not the whole app window.
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e))
process.on('uncaughtException', (e) => console.error('uncaughtException:', e))

server.listen(PORT, '127.0.0.1', () => console.log(`OpenDante companion on http://127.0.0.1:${PORT} (UI from ${DIST}, config ${CFG})`))
