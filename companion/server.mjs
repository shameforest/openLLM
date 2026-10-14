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

async function saveSkill(name, content) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) throw new Error('Ungültiger Name')
  const dir = path.join(CFG, 'skills', slug)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), String(content || ''))
  return slug
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
    if (req.method === 'POST' && url.pathname === '/update/app') return sendJson(res, 200, runUpdate('app'))
    if (req.method === 'POST' && url.pathname === '/update/models') return sendJson(res, 200, runUpdate('models'))
    if (req.method === 'GET') return serveStatic(req, res)
    sendJson(res, 404, { error: 'not found' })
  } catch (e) {
    sendJson(res, 400, { error: String(e && e.message || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`OpenDante companion on http://127.0.0.1:${PORT} (UI from ${DIST}, config ${CFG})`))
