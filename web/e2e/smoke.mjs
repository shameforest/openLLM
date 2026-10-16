// Browser smoke test for the OpenDante web app (`npm run e2e`).
//
// It starts the Vite dev server of web/ on a free port, opens the app in the installed system Chrome (no browser is
// downloaded) and walks one realistic conversation: git hint, attach a file, send a prompt, a risky permission request
// (must ask), a harmless one (must be answered silently), the streamed answer, "N Dateien geändert" + diff, Einstellungen.
//
// NOTHING real is contacted. Every request to the OpenCode server (127.0.0.1:4096), the companion (127.0.0.1:4097) and
// Ollama (127.0.0.1:11434) is answered by a mock in this file (`context.route`). Any other request that leaves the dev
// server is blocked and fails the test.
//
// Server-Sent Events: a single `route.fulfill` cannot stream, so a `/event` request is HELD until events are queued, then
// answered with `retry: 100` + the queued events and closed. The app sees that as "connection lost" and reconnects at
// once (that is how App.tsx reacts to a dropped stream), the next connection is held again, and so on.
//
// Output: one line per step ("ok: …" / "FAIL: …"); exit code 0 only if every step passed.
// Screenshots go to web/e2e/screens/ (git-ignored). Debugging: E2E_HEADED=1 shows the window, E2E_VERBOSE=1 lists every check.

import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const screensDir = path.join(webDir, 'e2e', 'screens')
const VERBOSE = !!process.env.E2E_VERBOSE
const HEADED = !!process.env.E2E_HEADED
const HARD_LIMIT_MS = 75_000 // the whole run must stay well under a minute; this is only the safety net against a hang
const START = Date.now()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const secs = () => ((Date.now() - START) / 1000).toFixed(1)

// ---------------------------------------------------------------------------------------------------------------------
// Vite dev server
// ---------------------------------------------------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function startVite() {
  const port = await freePort()
  // `node vite.js` instead of `npx vite`: no shell in between, so the process can be stopped reliably on Windows.
  const bin = path.join(webDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [bin, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: webDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
  })
  let out = ''
  let exited = false
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.once('exit', () => { exited = true })
  const stop = () => {
    if (exited) return
    exited = true
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  }
  const url = `http://127.0.0.1:${port}`
  try {
    const deadline = Date.now() + 40_000
    for (;;) {
      if (exited) throw new Error(`vite exited early:\n${out}`)
      try {
        const r = await fetch(`${url}/`, { signal: AbortSignal.timeout(2000) })
        if (r.ok) break
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error(`vite did not answer within 40 s:\n${out}`)
      await sleep(150)
    }
    await fetch(`${url}/src/main.tsx`).catch(() => {}) // compile the entry once, so the first page load is not slow
  } catch (e) {
    stop()
    throw e
  }
  return { url, origin: new URL(url).origin, stop }
}

// ---------------------------------------------------------------------------------------------------------------------
// Mocks: OpenCode (4096), companion (4097), Ollama (11434)
// ---------------------------------------------------------------------------------------------------------------------

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
}
const SES = 'ses_test'
const SERVER_DIR = 'C:\\demo'
const DIFF = [{
  file: 'rechner.py',
  patch: '@@ -1,1 +1,2 @@\n def a():\n+    return 1',
  additions: 1, deletions: 0, status: 'modified',
}]
const SSE_MIN_AGE_MS = 80 // a freshly opened /event connection may be closed again by the app within a few ms; wait it out

function createMock(appOrigin) {
  const s = {
    git: false,         // becomes true after POST /project/git/init
    perms: [],          // pending permission requests (what GET /permission returns)
    questions: [],
    events: [],         // queued SSE events, not yet delivered
    held: [],           // open /event connections waiting for events
    sseConnections: 0,
    log: [],            // every call to 4096 / 4097 / 11434 (except /event and CORS preflights), in order
    notFound: [],       // calls nobody mocked (answered 404)
    external: [],       // requests that tried to leave the dev server for somewhere else (blocked)
    seq: 0,
    onPrompt: () => {}, // scenario hooks, set by the test
    onPermissionReply: () => {},
  }

  const send = (route, status, body, headers = {}) =>
    route.fulfill({ status, headers: { ...CORS, ...headers }, body })
  const json = (route, data, status = 200) => send(route, status, JSON.stringify(data), { 'content-type': 'application/json' })
  const noContent = (route) => route.fulfill({ status: 204, headers: CORS })

  // ---- SSE -------------------------------------------------------------------------------------------------------
  const sse = (events) => `retry: 100\n\n${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}`

  function flush() {
    if (!s.events.length) return
    s.held = s.held.filter((c) => !c.dead)
    const now = Date.now()
    // The newest connection that has been up for a moment is the app's live one (older ones are already cancelled).
    const live = [...s.held].reverse().find((c) => now - c.at >= SSE_MIN_AGE_MS)
    if (!live) {
      if (s.held.length) setTimeout(flush, 25)
      return
    }
    s.held = s.held.filter((c) => c !== live)
    const batch = s.events.splice(0)
    live.route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: sse(batch) })
      .catch(() => { // the page cancelled that connection meanwhile: keep the events for the next one
        live.dead = true
        s.events.unshift(...batch)
        setTimeout(flush, 25)
      })
  }

  /** Queue server events; they reach the app with its next (re)connect. */
  function queue(...evs) {
    for (const e of evs) s.events.push({ id: `evt_${++s.seq}`, ...e })
    flush()
  }

  // ---- routing ---------------------------------------------------------------------------------------------------
  const record = (svc, request, url, body) => {
    const entry = { svc, method: request.method(), path: url.pathname, params: Object.fromEntries(url.searchParams), body, n: s.log.length }
    s.log.push(entry)
    return entry
  }

  async function handle(route) {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === appOrigin) return route.continue()

    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    const svc = local ? { 4096: 'oc', 4097: 'comp', 11434: 'ollama' }[url.port] : undefined
    if (!svc) {
      s.external.push(`${request.method()} ${request.url()}`)
      return route.abort('blockedbyclient')
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-max-age': '600' } })

    if (svc === 'oc' && request.method() === 'GET' && url.pathname === '/event') {
      s.sseConnections++
      s.held.push({ route, request, at: Date.now(), dead: false })
      setTimeout(flush, SSE_MIN_AGE_MS + 10)
      return // held until events are queued
    }

    let body
    try { body = request.postData() ? JSON.parse(request.postData()) : undefined } catch { body = request.postData() }
    const entry = record(svc, request, url, body)
    const m = request.method()
    const p = url.pathname

    if (svc === 'oc') {
      if (m === 'GET' && p === '/global/health') return json(route, { healthy: true, version: '1.19.0' })
      if (m === 'GET' && p === '/path') return json(route, { home: 'C:\\Users\\demo', state: 'C:\\Users\\demo\\.local\\state\\opencode', config: 'C:\\Users\\demo\\.config\\opencode', directory: SERVER_DIR })
      if (m === 'GET' && p === '/project/current') return json(route, { id: 'global', worktree: '/', ...(s.git ? { vcs: 'git' } : {}) })
      if (m === 'POST' && p === '/project/git/init') { s.git = true; return json(route, { id: 'global', worktree: '/', vcs: 'git' }) }
      if (m === 'GET' && p === '/permission') return json(route, s.perms)
      if (m === 'GET' && p === '/question') return json(route, s.questions)
      if (m === 'GET' && p === '/session/status') return json(route, {})
      if (m === 'POST' && p === '/session') return json(route, { id: SES })
      if (m === 'POST' && p === `/session/${SES}/prompt_async`) {
        await noContent(route)
        s.onPrompt(body)
        return
      }
      const reply = p.match(/^\/permission\/([^/]+)\/reply$/)
      if (m === 'POST' && reply) {
        s.perms = s.perms.filter((x) => x.id !== reply[1])
        await json(route, true)
        s.onPermissionReply(reply[1], body)
        return
      }
      if (m === 'GET' && p === `/session/${SES}/diff`) return json(route, DIFF)
    } else if (svc === 'comp') {
      if (m === 'GET' && p === '/health') return json(route, { ok: true })
      if (m === 'GET' && p === '/skills') return json(route, [])
      if (m === 'GET' && p === '/chats') return json(route, [])
      if (m === 'GET' && p === '/repos') return json(route, []) // Einstellungen lists cloned projects (not in the brief; harmless)
      if (m === 'POST' && p === '/chats') {
        const c = body ?? {}
        return json(route, { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: Date.now(), workdir: c.workdir ?? '', model: c.model ?? '', messages: (c.messages ?? []).length, usage: c.usage ?? {} })
      }
      if (m === 'POST' && p === '/git/prepare') return json(route, { created: true })
      if (m === 'POST' && p === '/offload-prefs') return json(route, { ok: true, offloadShare: body?.offloadShare ?? 0, dailyUsd: body?.claudeDailyUsd ?? 0 })
      if (m === 'GET' && p === '/claude/usage') return json(route, { usd: 0 })
      if (m === 'GET' && p === '/fs') {
        const dir = url.searchParams.get('path') || ''
        const files = url.searchParams.get('files') === '1'
        if (!dir) return json(route, { path: '', parent: null, dirs: [{ name: 'demo', path: 'C:\\demo' }], ...(files ? { files: [] } : {}) })
        if (dir === 'C:\\demo') return json(route, { path: 'C:\\demo', parent: 'C:\\', dirs: [], ...(files ? { files: [{ name: 'notiz.txt', path: 'C:\\demo\\notiz.txt', size: 120 }] } : {}) })
        return json(route, { error: 'Ordner nicht lesbar: ENOENT' }, 404)
      }
    } else if (svc === 'ollama') {
      if (m === 'GET' && p === '/api/ps') return json(route, { models: [] }) // no model loaded
    }

    s.notFound.push(`${m} ${svc}:${p}`)
    entry.unmocked = true
    return json(route, { error: 'not mocked' }, 404)
  }

  return {
    state: s,
    queue,
    handle: (route) => handle(route).catch((e) => {
      if (!/closed|Target|disposed|already handled|cancel/i.test(String(e?.message))) s.notFound.push(`handler error: ${e?.message}`)
    }),
    onRequestFailed: (request) => { for (const c of s.held) if (c.request === request) c.dead = true },
    calls: (svc, method, pathRe) => s.log.filter((c) => c.svc === svc && c.method === method && pathRe.test(c.path)),
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Server events the scenario sends
// ---------------------------------------------------------------------------------------------------------------------

const RISKY_CMD = 'Remove-Item -Recurse build'
const SAFE_CMD = 'python -c "print(1+1)"'
const permAsked = (id, command) => ({
  type: 'permission.asked',
  properties: { id, sessionID: SES, permission: 'bash', patterns: [command], metadata: { command }, always: [command.split(' ')[0] + ' *'], tool: { messageID: 'msg_asst1', callID: `call_${id}` } },
})
const permReplied = (id, reply) => ({ type: 'permission.replied', properties: { sessionID: SES, requestID: id, reply } })
const ANSWER_PARTS = ['Ich habe ', 'rechner.py ', 'angelegt.']
const ANSWER = ANSWER_PARTS.join('')
const answerStart = () => [
  { type: 'message.updated', properties: { info: { id: 'msg_user1', sessionID: SES, role: 'user', agent: 'build' } } },
  { type: 'message.updated', properties: { info: { id: 'msg_asst1', sessionID: SES, role: 'assistant', agent: 'build' } } },
  { type: 'message.part.updated', properties: { part: { id: 'prt_tool', messageID: 'msg_asst1', sessionID: SES, type: 'tool', tool: 'write', state: { status: 'completed', title: 'rechner.py' } } } },
  { type: 'message.part.updated', properties: { part: { id: 'prt_ans', messageID: 'msg_asst1', sessionID: SES, type: 'text', text: '' } } },
  ...ANSWER_PARTS.map((delta) => ({ type: 'message.part.delta', properties: { sessionID: SES, messageID: 'msg_asst1', partID: 'prt_ans', field: 'text', delta } })),
]
const answerFinish = () => [
  { type: 'message.updated', properties: { info: { id: 'msg_asst1', sessionID: SES, role: 'assistant', agent: 'build', tokens: { input: 1200, output: 80, reasoning: 0, cache: { read: 0, write: 0 } } } } },
  { type: 'session.status', properties: { sessionID: SES, status: { type: 'idle' } } },
]

// ---------------------------------------------------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------------------------------------------------

let shotNo = 0
const stepResults = []
let failed = false
let page
const diag = { pageErrors: [], consoleErrors: [] } // filled while the page runs, printed when a step fails

async function shot(name) {
  const file = path.join(screensDir, `${String(++shotNo).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
}

function check(cond, message) {
  if (!cond) throw new Error(message)
  if (VERBOSE) console.log(`      · ${message.replace(/^expected /, '')}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function waitFor(fn, label, timeout = 8000) {
  const end = Date.now() + timeout
  for (;;) {
    let v
    try { v = await fn() } catch { v = false }
    if (v) return v
    if (Date.now() > end) throw new Error(`timeout waiting for ${label}`)
    await sleep(25)
  }
}

const tid = (id) => page.getByTestId(id)
const visible = (id, label = id) => tid(id).first().waitFor({ state: 'visible' }).catch(() => { throw new Error(`${label} not visible`) })
const hidden = (id, label = id) => tid(id).first().waitFor({ state: 'hidden' }).catch(() => { throw new Error(`${label} still visible`) })
const textOf = async (id) => (await tid(id).first().textContent({ timeout: 1000 })) ?? ''
const waitText = (id, re, label) => waitFor(async () => re.test(await textOf(id)), `${label} (testid ${id})`)

async function step(name, fn) {
  if (failed) {
    console.log(`SKIP: ${name} (earlier step failed)`)
    stepResults.push(false)
    return
  }
  const t = Date.now()
  try {
    await fn()
    console.log(`ok: ${name} [${((Date.now() - t) / 1000).toFixed(1)} s]`)
    stepResults.push(true)
  } catch (e) {
    failed = true
    stepResults.push(false)
    console.log(`FAIL: ${name}: ${String(e?.message ?? e).split('\n')[0]}`)
    await shot(`FAIL-${name.slice(0, 1)}`).catch(() => {})
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)).catch(() => '(page not readable)')
    console.log(`diag: page says "${text}" | page errors: ${diag.pageErrors.join(' | ') || 'none'} | console errors: ${diag.consoleErrors.join(' | ') || 'none'}`)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------------

let vite
let browser
let context

async function cleanup() {
  try { await context?.unrouteAll({ behavior: 'ignoreErrors' }) } catch { /* ignore */ }
  try { await browser?.close() } catch { /* ignore */ }
  vite?.stop()
}

async function main() {
  mkdirSync(screensDir, { recursive: true })
  for (const f of readdirSync(screensDir)) if (f.endsWith('.png')) rmSync(path.join(screensDir, f))

  vite = await startVite()
  console.log(`info: dev server ${vite.url} (${secs()} s)`)

  const mock = createMock(vite.origin)
  const s = mock.state

  browser = await chromium.launch({ channel: 'chrome', headless: !HEADED })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  await context.route('**/*', mock.handle)
  // Records every permission card that shows up in the DOM and how long it stayed (step e: a harmless request must not wait for a click).
  await context.addInitScript(() => {
    window.__cards = []
    const open = new Map()
    const scan = () => {
      const now = performance.now()
      const present = new Set()
      document.querySelectorAll('[data-testid="perm-card"]').forEach((el) => present.add((el.querySelector('[data-testid="perm-detail"]')?.textContent ?? el.textContent ?? '').trim()))
      for (const t of present) if (!open.has(t)) { const rec = { text: t, start: now, end: null }; open.set(t, rec); window.__cards.push(rec) }
      for (const [t, rec] of open) if (!present.has(t)) { rec.end = now; open.delete(t) }
    }
    new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
  })
  page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.on('requestfailed', mock.onRequestFailed)
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })
  const { pageErrors, consoleErrors } = diag
  let navigations = 0 // more than 1 = the page reloaded itself (Vite re-optimised its dependencies on a cold cache)
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()) })

  // ---- scenario hooks: what the (mock) server does when the app acts ----
  s.onPrompt = () => {
    s.perms.push(permAsked('per_risky', RISKY_CMD).properties)
    mock.queue(permAsked('per_risky', RISKY_CMD))
  }
  s.onPermissionReply = (id, body) => {
    if (id === 'per_risky') {
      s.perms.push(permAsked('per_safe', SAFE_CMD).properties)
      mock.queue(permReplied(id, body?.reply), permAsked('per_safe', SAFE_CMD))
    } else if (id === 'per_safe') {
      mock.queue(permReplied(id, body?.reply), ...answerStart())
    }
  }

  // a ---------------------------------------------------------------------------------------------------------------
  await step('a. app loads, git hint shows, "Sicherung einschalten" prepares and inits git', async () => {
    // The first load compiles the whole app on demand (cold Vite cache, slow PC): be generous here, quick everywhere else.
    await page.goto(vite.url, { timeout: 25_000 })
    await page.getByText('Womit kann ich helfen?').waitFor({ timeout: 25_000 }).catch(() => { throw new Error('start screen "Womit kann ich helfen?" not shown') })
    await visible('git-hint', 'git hint (project is not a git repo)')
    check((await textOf('git-hint')).includes('Git'), 'expected the git hint to explain Git')
    check(await page.getByText('bereit', { exact: true }).isVisible(), 'expected the sidebar to say "bereit" (server reachable)')
    await waitFor(() => mock.calls('oc', 'GET', /^\/path$/).length > 0, 'GET /path (server folder)')
    await shot('start-git-hint')

    await tid('git-enable').click()
    await waitFor(() => mock.calls('comp', 'POST', /^\/git\/prepare$/).length && mock.calls('oc', 'POST', /^\/project\/git\/init$/).length, 'POST /git/prepare and POST /project/git/init')
    const prepare = mock.calls('comp', 'POST', /^\/git\/prepare$/)[0]
    const init = mock.calls('oc', 'POST', /^\/project\/git\/init$/)[0]
    check(prepare.n < init.n, 'expected /git/prepare to be called before /project/git/init')
    check(same(prepare.body, { path: SERVER_DIR }), `expected /git/prepare body {path:"${SERVER_DIR}"}, got ${JSON.stringify(prepare.body)}`)
    await hidden('git-hint', 'git hint')
    await waitText('ctx-note', /Sicherung ist an/, 'confirmation note')
    await shot('git-enabled')
  })

  // b ---------------------------------------------------------------------------------------------------------------
  await step('b. "+" → Datei anhängen → pick C:\\demo\\notiz.txt → attachment chip', async () => {
    await tid('plus').click()
    await visible('plus-menu')
    await tid('attach-file').click()
    await visible('file-picker')
    await visible('fp-open', 'root listing folder')
    check(same(mock.calls('comp', 'GET', /^\/fs$/)[0]?.params, { files: '1' }), 'expected the picker to ask GET /fs?files=1 first')
    await tid('fp-open').first().click()
    await waitText('fp-here', /C:\\demo$/, 'current folder C:\\demo')
    const fsCall = mock.calls('comp', 'GET', /^\/fs$/).find((c) => c.params.path === 'C:\\demo')
    check(fsCall && fsCall.params.files === '1', 'expected GET /fs?path=C:\\demo&files=1')
    await visible('fp-file-name', 'file notiz.txt')
    check((await textOf('fp-file-name')).includes('notiz.txt'), 'expected the file row to say notiz.txt')
    await tid('fp-check').check()
    await waitText('fp-count', /1 ausgewählt/, 'count "1 ausgewählt"')
    await shot('file-picker-ticked')

    await tid('fp-confirm').click()
    await hidden('file-picker', 'file picker')
    await visible('attachment-chip')
    check((await textOf('attachment-chip')).includes('notiz.txt'), 'expected the chip to say notiz.txt')
    check((await tid('attachment-chip').count()) === 1, 'expected exactly one chip')
    await shot('attachment-chip')
  })

  // c ---------------------------------------------------------------------------------------------------------------
  await step('c. send "Lege rechner.py an" → prompt has the text part and the file part, chip is gone', async () => {
    const box = page.locator('textarea')
    await box.fill('Lege rechner.py an')
    await box.press('Enter')
    await waitFor(() => mock.calls('oc', 'POST', new RegExp(`^/session/${SES}/prompt_async$`)).length, 'POST /session/ses_test/prompt_async')
    const body = mock.calls('oc', 'POST', new RegExp(`^/session/${SES}/prompt_async$`))[0].body
    const parts = body?.parts ?? []
    check(parts.length === 2, `expected 2 prompt parts (text + file), got ${parts.length}`)
    check(same(parts[0], { type: 'text', text: 'Lege rechner.py an' }), `expected text part, got ${JSON.stringify(parts[0])}`)
    check(same(parts[1], { type: 'file', mime: 'text/plain', filename: 'notiz.txt', url: 'file:///C:/demo/notiz.txt' }), `expected file part, got ${JSON.stringify(parts[1])}`)
    check(body.agent === 'build' && body.model?.providerID === 'ollama', 'expected agent "build" and provider "ollama"')
    check(body.variant === 'ohne-denken', `expected the default to carry out without thinking (variant ohne-denken), got ${JSON.stringify(body.variant)}`)
    check((await tid('attachment-chip').count()) === 0, 'expected the attachment chip to be gone')
    await visible('stop', 'stop button (a turn is running)')
    await shot('prompt-sent')
  })

  // d ---------------------------------------------------------------------------------------------------------------
  await step('d. risky command (Remove-Item) is NOT auto-allowed: card shows, "Einmal erlauben" replies once', async () => {
    await visible('perm-card', 'permission card')
    check((await textOf('perm-detail')).includes(RISKY_CMD), `expected the card to show "${RISKY_CMD}"`)
    await sleep(700) // an auto-allow would answer within a few ms
    check(mock.calls('oc', 'POST', /^\/permission\//).length === 0, 'expected no reply yet: the risky command must wait for the user')
    check(await tid('perm-card').first().isVisible(), 'expected the card to still be waiting')
    await shot('permission-card')

    await tid('perm-once').click()
    await waitFor(() => mock.calls('oc', 'POST', /^\/permission\/per_risky\/reply$/).length, 'POST /permission/per_risky/reply')
    const r = mock.calls('oc', 'POST', /^\/permission\/per_risky\/reply$/)[0]
    check(same(r.body, { reply: 'once' }), `expected {"reply":"once"}, got ${JSON.stringify(r.body)}`)
  })

  // e ---------------------------------------------------------------------------------------------------------------
  await step('e. harmless python one-liner is answered automatically, without a card', async () => {
    const reply = await waitFor(() => mock.calls('oc', 'POST', /^\/permission\/per_safe\/reply$/)[0], 'automatic POST /permission/per_safe/reply')
    check(same(reply.body, { reply: 'once' }), `expected {"reply":"once"}, got ${JSON.stringify(reply.body)}`)
    await hidden('perm-card', 'permission card')
    await sleep(150)
    const cards = (await page.evaluate(() => window.__cards)).filter((c) => c.text.includes('print(1+1)'))
    const lingered = cards.filter((c) => c.end === null || c.end - c.start > 300)
    check(lingered.length === 0, `expected no card for the harmless command, but one stayed ${cards.map((c) => (c.end === null ? 'forever' : `${Math.round(c.end - c.start)} ms`)).join(', ')}`)
    if (cards.length) console.log(`note: the harmless request's card was in the DOM for ${cards.map((c) => `${Math.round(c.end - c.start)} ms`).join(', ')} before the auto-answer removed it`)
    await shot('auto-allowed')
  })

  // f ---------------------------------------------------------------------------------------------------------------
  await step('f. answer streams in, then "1 Datei geändert" with Ansehen → diff modal; Esc closes it', async () => {
    await waitFor(async () => (await tid('answer').last().textContent({ timeout: 1000 }))?.includes(ANSWER), `answer text "${ANSWER}"`)
    check(await tid('stop').isVisible(), 'expected the turn to still be running while the answer streams')
    // OD-55: the live activity card shows what the agent is doing, independent of its task list
    await visible('activity-card', 'live activity card while running')
    check((await textOf('activity-now')).includes('rechner.py'), 'expected the activity card to name the file being worked on')
    check(/1 Datei geändert/.test(await textOf('activity-files')), 'expected the activity card to count 1 changed file')
    await shot('answer-streaming')

    mock.queue(...answerFinish())
    await visible('turn-actions', 'turn actions under the answer')
    await waitText('turn-changes', /1 Datei geändert/, '"1 Datei geändert"')
    check(/\+1/.test(await textOf('turn-changes')), 'expected "+1" added line in the changes summary')
    const diff = mock.calls('oc', 'GET', new RegExp(`^/session/${SES}/diff$`))[0]
    check(diff?.params.messageID === 'msg_user1', `expected the diff to be asked for the user message msg_user1, got ${JSON.stringify(diff?.params)}`)
    await visible('ctx-gauge', 'context gauge (tokens from message.updated)')
    check(await tid('send').isVisible(), 'expected the send button back (turn finished)')
    await shot('answer-with-changes')

    await tid('turn-diff').click()
    await visible('diff-modal')
    const patch = await textOf('diff-patch')
    check(patch.includes('return 1') && patch.includes('def a():'), 'expected the diff to show the patch of rechner.py')
    check((await page.getByTestId('diff-modal').textContent()).includes('rechner.py'), 'expected the file name rechner.py in the modal')
    await shot('diff-modal')
    await page.keyboard.press('Escape')
    await hidden('diff-modal', 'diff modal')
  })

  // g ---------------------------------------------------------------------------------------------------------------
  await step('g. Einstellungen opens with the think-off select; Esc closes it', async () => {
    await tid('open-settings').click()
    await visible('settings')
    check((await tid('think-off').count()) === 1, 'expected exactly one think-off select')
    check(await tid('think-off').evaluate((el) => el.tagName === 'SELECT'), 'expected think-off to be a <select>')
    const values = await tid('think-off').locator('option').evaluateAll((os) => os.map((o) => o.value))
    check(same(values, ['schnell', 'gruendlich']), `expected think-off options schnell/gruendlich, got ${JSON.stringify(values)}`)
    check((await tid('think-off').inputValue()) === 'schnell', 'expected "schnell" (carry out without thinking) as the default')
    await waitText('claude-spent', /0\.00 \$/, 'today\'s Claude usage from the companion')
    await shot('settings')
    await page.keyboard.press('Escape')
    await hidden('settings', 'settings panel')
  })

  // safety nets -----------------------------------------------------------------------------------------------------
  await step('no request escaped the mocks, no uncaught page error', async () => {
    check(s.external.length === 0, `requests to unexpected hosts were blocked: ${s.external.join(' | ')}`)
    check(pageErrors.length === 0, `uncaught page errors: ${pageErrors.join(' | ')}`)
  })
  if (s.notFound.length) console.log(`note: unmocked calls answered 404: ${[...new Set(s.notFound)].join(', ')}`)
  if (navigations > 1) console.log(`note: the page navigated ${navigations} times (reload by the dev server?)`)
  if (consoleErrors.length) console.log(`note: console errors in the page: ${[...new Set(consoleErrors)].join(' | ')}`)
  console.log(`info: ${s.sseConnections} SSE connections, ${s.log.length} mocked calls, ${shotNo} screenshots in e2e/screens/`)
}

// ---------------------------------------------------------------------------------------------------------------------

const watchdog = setTimeout(() => {
  console.log(`FAIL: run exceeded ${HARD_LIMIT_MS / 1000} s, aborted`)
  vite?.stop()
  process.exit(1)
}, HARD_LIMIT_MS)
watchdog.unref()
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { vite?.stop(); process.exit(130) })

let code = 1
try {
  await main()
  const passed = stepResults.length > 0 && stepResults.every(Boolean)
  console.log(passed ? `ok: all ${stepResults.length} steps passed in ${secs()} s` : `FAIL: ${stepResults.filter(Boolean).length}/${stepResults.length} steps passed (${secs()} s)`)
  code = passed ? 0 : 1
} catch (e) {
  console.log(`FAIL: ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n')}`)
} finally {
  await cleanup()
}
process.exit(code)
