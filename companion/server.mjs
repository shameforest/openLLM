// OpenDante companion: a tiny zero-dependency local service (port 4097) started by the launcher. It does the two
// things the browser cannot: (1) serve the built web UI so OpenDante is one app window, and (2) write files / run
// commands for the Einstellungen panel — store the Claude key in OpenCode, write global instructions to AGENTS.md,
// save skills, run the updates. The chat itself goes straight to the OpenCode server (port 4096) and needs none of this.
import http from 'node:http'
import { promises as fs } from 'node:fs'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.OPENDANTE_ROOT || path.resolve(HERE, '..')
const DIST = path.join(ROOT, 'web', 'dist')
const CFG = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode')
const PORT = Number(process.env.OPENDANTE_COMPANION_PORT || 4097)
const MODEL = process.env.OPENDANTE_MODEL || 'qwen3.8:27b'
const PROJECTS = process.env.OPENDANTE_PROJECTS || path.join(os.homedir(), 'OpenDante-Projekte')

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)) }
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

/** Add/replace an `anthropic` provider in OpenCode's global config, with the key and the chosen Claude model. */
async function setAnthropic(apiKey, model) {
  const file = path.join(CFG, 'opencode.json')
  let cfg = {}
  try { cfg = JSON.parse(await fs.readFile(file, 'utf8')) } catch { /* fresh */ }
  cfg.provider = cfg.provider || {}
  if (apiKey && apiKey.trim()) {
    cfg.provider.anthropic = { name: 'Claude (Anthropic)', options: { apiKey: apiKey.trim() }, models: { [model || 'claude-opus-5-5']: {} } }
  } else {
    delete cfg.provider.anthropic
  }
  await fs.mkdir(CFG, { recursive: true })
  await fs.writeFile(file, JSON.stringify(cfg, null, 2))
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

/** Open the native Windows folder dialog and return the chosen absolute path (the browser cannot read a folder path). */
function pickFolder() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ path: '', note: 'Ordnerwahl gibt es nur unter Windows.' })
    // FolderBrowserDialog needs a single-threaded apartment (-STA); we write only the chosen path to stdout.
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Ordner fuer OpenDante waehlen'; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }"
    const child = spawn('powershell.exe', ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { cwd: ROOT })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.on('error', () => resolve({ path: '', note: 'Ordner-Dialog konnte nicht geoeffnet werden.' }))
    child.on('close', () => { const p = out.trim(); resolve({ path: p, note: p ? '' : 'Keine Auswahl getroffen.' }) })
  })
}

/** Fire an update script and return at once. Windows only (git/powershell/ollama live there). */
function runUpdate(kind) {
  if (process.platform !== 'win32') return { started: false, note: 'Updates laufen nur unter Windows.' }
  let cmd, args
  if (kind === 'models') { cmd = 'ollama'; args = ['pull', MODEL] }
  else { cmd = 'powershell.exe'; args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Set-Location '${ROOT}'; git pull; ./scripts/install.ps1 -SkipModel`] }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: ROOT })
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

// ---- Claude-API-Brücke (bezahlt) ----
// Read the stored Anthropic key + model from OpenCode's config (written by the Einstellungen panel).
async function readAnthropic() {
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(CFG, 'opencode.json'), 'utf8'))
    const a = cfg.provider && cfg.provider.anthropic
    return { key: a && a.options && a.options.apiKey, model: a && a.models ? Object.keys(a.models)[0] : null }
  } catch { return {} }
}

/** One call to the Claude Messages API with the stored key. Used by the auto offload/audit modes. */
async function callClaude({ system, prompt, model }) {
  const stored = await readAnthropic()
  if (!stored.key) throw new Error('Kein Claude-Schlüssel gespeichert (Einstellungen → Claude-Verbindung → Speichern).')
  const useModel = model || stored.model || 'claude-opus-5-5'
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': stored.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: useModel, max_tokens: 4096, system: system || '', messages: [{ role: 'user', content: String(prompt || '') }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j && j.error && j.error.message) || `Claude-API Fehler ${r.status}`)
  const text = Array.isArray(j.content) ? j.content.filter((c) => c.type === 'text').map((c) => c.text).join('') : ''
  const usage = { input_tokens: Number(j.usage && j.usage.input_tokens) || 0, output_tokens: Number(j.usage && j.usage.output_tokens) || 0 }
  return { text, model: useModel, usage }
}

// ---- static web UI ----
async function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (rel === '/' || !path.extname(rel)) rel = '/index.html' // SPA fallback
  const file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end() }
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile()) throw new Error('dir')
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('web/dist fehlt — bitte scripts/install.ps1 ausführen (baut die Oberfläche).')
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  try {
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'opendante-companion' })
    if (req.method === 'GET' && url.pathname === '/skills') return sendJson(res, 200, await listSkills())
    if (req.method === 'GET' && url.pathname === '/repos') return sendJson(res, 200, await listRepos())
    if (req.method === 'POST' && url.pathname === '/repo/clone') { const b = await readBody(req); return sendJson(res, 200, await cloneRepo(b.url)) }
    if (req.method === 'POST' && url.pathname === '/git') { const b = await readBody(req); return sendJson(res, 200, await gitAction(b.path, b.action, b.message)) }
    if (req.method === 'POST' && url.pathname === '/settings') {
      const b = await readBody(req)
      await setGlobalInstructions(b.globalInstructions ?? '')
      await setAnthropic(b.apiKey ?? '', b.claudeModel)
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/skills') {
      const b = await readBody(req)
      const slug = await saveSkill(b.name, b.content)
      return sendJson(res, 200, { ok: true, slug })
    }
    if (req.method === 'POST' && url.pathname === '/pick-folder') return sendJson(res, 200, await pickFolder())
    if (req.method === 'POST' && url.pathname === '/claude') { const b = await readBody(req); return sendJson(res, 200, await callClaude(b)) }
    if (req.method === 'POST' && url.pathname === '/update/app') return sendJson(res, 200, runUpdate('app'))
    if (req.method === 'POST' && url.pathname === '/update/models') return sendJson(res, 200, runUpdate('models'))
    if (req.method === 'GET') return serveStatic(req, res)
    sendJson(res, 404, { error: 'not found' })
  } catch (e) {
    sendJson(res, 400, { error: String(e && e.message || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`OpenDante companion on http://127.0.0.1:${PORT} (UI from ${DIST}, config ${CFG})`))
