// Self-contained check of the companion's file-writing endpoints. Run: node companion/test.mjs
import { execFileSync, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-'))
const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-proj-'))
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-data-'))
const PORT = 4096 + Math.floor(Math.random() * 500) + 50
const srv = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
  env: { ...process.env, OPENCODE_CONFIG_DIR: cfg, OPENDANTE_COMPANION_PORT: String(PORT), OPENDANTE_PROJECTS: proj, OPENDANTE_DATA: data },
  stdio: 'ignore',
})
const base = `http://127.0.0.1:${PORT}`
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json())

let failed = 0
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL:', msg) } else console.log('ok:', msg) }

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 100)) }

  // Only the app itself may call the companion (OD-03)
  const foreign = await fetch(base + '/skills', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' }, body: '{"name":"x","content":"y"}' })
  ok(foreign.status === 403, 'a POST from a foreign web page (Origin header) is refused')
  const foreignGet = await fetch(base + '/chats', { headers: { origin: 'https://evil.example.com' } })
  ok(foreignGet.status === 403 && !foreignGet.headers.get('access-control-allow-origin'), 'a foreign page cannot read the chat list either')
  const plain = await fetch(base + '/skills', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"name":"x","content":"y"}' })
  ok(plain.status === 415, 'a POST that is not JSON (what a cross-site form can send) is refused')
  const own = await fetch(base + '/health', { headers: { origin: base } })
  ok(own.status === 200 && own.headers.get('access-control-allow-origin') === base, 'the app itself (own origin) is allowed and gets CORS')
  const pre = await fetch(base + '/skills', { method: 'OPTIONS', headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' } })
  ok(pre.status === 403, 'a foreign CORS preflight is refused')

  await post('/settings', { globalInstructions: 'Antworte knapp.', apiKey: 'sk-ant-x', claudeModel: 'claude-opus-5-5' })
  const agents = await fs.readFile(path.join(cfg, 'AGENTS.md'), 'utf8')
  ok(agents.includes('Antworte knapp.') && agents.includes('OPENDANTE-USER-START'), 'global instructions written to AGENTS.md')
  const oc = JSON.parse(await fs.readFile(path.join(cfg, 'opencode.json'), 'utf8'))
  ok(oc.provider.anthropic.options.apiKey === 'sk-ant-x' && oc.provider.anthropic.models['claude-opus-5-5'], 'anthropic provider + key written')

  // Daily cap for the paid Claude modes (OD-12): enforced before any network call
  const day = new Date().toISOString().slice(0, 10)
  await fs.writeFile(path.join(data, 'claude-usage.json'), JSON.stringify({ date: day, usd: 2.5, calls: 7 }))
  const capped = await post('/claude', { prompt: 'hallo', model: 'claude-sonnet-5-5', capUsd: 2 })
  ok(capped.error && /Tageslimit/.test(capped.error), 'a Claude call above the daily cap is refused (no API call made)')
  const usageNow = await fetch(base + '/claude/usage').then((r) => r.json())
  ok(usageNow.date === day && usageNow.usd === 2.5 && usageNow.calls === 7, 'GET /claude/usage reports what was spent today')
  await fs.writeFile(path.join(data, 'claude-usage.json'), JSON.stringify({ date: '2000-01-01', usd: 99, calls: 1 }))
  ok((await fetch(base + '/claude/usage').then((r) => r.json())).usd === 0, 'the spend resets on a new day')

  const s = await post('/skills', { name: 'Test Runner!', content: '---\nname: test-runner\ndescription: runs tests\n---\nbody' })
  ok(s.slug === 'test-runner', 'skill name slugified')
  ok((await fs.readFile(path.join(cfg, 'skills', 'test-runner', 'SKILL.md'), 'utf8')).includes('body'), 'skill saved as SKILL.md')

  const skillList = await fetch(base + '/skills').then((r) => r.json())
  ok(Array.isArray(skillList) && skillList.some((x) => x.slug === 'test-runner' && x.description === 'runs tests'), 'GET /skills lists the saved skill with its description')

  // Verlauf
  const chats0 = await fetch(base + '/chats').then((r) => r.json())
  ok(Array.isArray(chats0) && chats0.length === 0, 'GET /chats is empty at first')
  const chat = { id: 'chat-test-0001', title: 'Hallo Welt', sessionId: 'ses_x', workdir: 'C:\\x', messages: [{ role: 'user', text: 'Hallo' }, { role: 'assistant', text: 'Hi', reasoning: 'denke' }], usage: { local: 40, localIn: 900, claudeOut: 10 } }
  const saved = await post('/chats', chat)
  ok(saved.id === chat.id && saved.messages === 2 && saved.usage.local === 40, 'POST /chats saves a chat and returns its metadata')
  await post('/chats', { ...chat, id: 'chat-test-0002', title: 'Zweiter' })
  const chats1 = await fetch(base + '/chats').then((r) => r.json())
  ok(chats1.length === 2 && chats1[0].title === 'Zweiter' && !('messages' in chats1[0] && Array.isArray(chats1[0].messages)), 'GET /chats lists metadata only, newest first')
  const full = await fetch(base + '/chats/chat-test-0001').then((r) => r.json())
  ok(full.sessionId === 'ses_x' && full.messages[1].reasoning === 'denke', 'GET /chats/<id> returns the whole chat incl. thinking + session id')
  const badChat = await post('/chats', { ...chat, id: '../../evil' })
  ok(badChat.error && /Kennung/.test(badChat.error), 'a chat id with path characters is rejected')
  const badGet = await fetch(base + '/chats/..%2F..%2Fx').then((r) => r.json())
  ok(badGet.error, 'loading a malformed chat id is rejected')

  // Chat rename + delete
  await post('/chats/rename', { id: 'chat-test-0001', title: 'Neuer Name' })
  const renamed = (await fetch(base + '/chats').then((r) => r.json())).find((c) => c.id === 'chat-test-0001')
  ok(renamed && renamed.title === 'Neuer Name', 'POST /chats/rename changes the title')
  ok((await fetch(base + '/chats/chat-test-0001').then((r) => r.json())).title === 'Neuer Name', 'rename also updates the full chat file')
  const del = await post('/chats/delete', { id: 'chat-test-0002' })
  ok(del.ok && del.id === 'chat-test-0002', 'POST /chats/delete reports success')
  ok(!(await fetch(base + '/chats').then((r) => r.json())).some((c) => c.id === 'chat-test-0002'), 'deleted chat is gone from the list')
  const badDel = await post('/chats/delete', { id: '../etc' })
  ok(badDel.error && /Kennung/.test(badDel.error), 'delete rejects a malformed id')

  // Filesystem browser
  const roots = await fetch(base + '/fs').then((r) => r.json())
  ok(Array.isArray(roots.dirs) && roots.dirs.length > 0 && roots.parent === null, 'GET /fs lists roots when no path is given')
  const sub = await fetch(base + '/fs?path=' + encodeURIComponent(data)).then((r) => r.json())
  ok(sub.path && Array.isArray(sub.dirs) && sub.dirs.some((d) => d.name === 'chats'), 'GET /fs?path lists sub-folders (finds the chats folder)')
  ok(typeof sub.parent === 'string', 'GET /fs returns a parent path for going up')
  const bad = await fetch(base + '/fs?path=' + encodeURIComponent(path.join(data, 'gibt-es-nicht'))).then((r) => r.json())
  ok(bad.error && /lesbar/.test(bad.error), 'GET /fs on a missing folder errors cleanly')

  const badModel = await post('/update/models', { model: 'qwen; rm -rf /' })
  ok(badModel.error && /Modellname/.test(badModel.error), 'model update rejects a malformed model name (nothing is run)')

  // Projekte (GitHub)
  const repos0 = await fetch(base + '/repos').then((r) => r.json())
  ok(Array.isArray(repos0) && repos0.length === 0, 'GET /repos is empty before cloning')
  const badClone = await post('/repo/clone', { url: 'https://evil.example.com/x' })
  ok(badClone.error && /GitHub/i.test(badClone.error), 'clone rejects a non-GitHub url')
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-repo-'))
  execFileSync('git', ['init', '-q', repo])
  const st = await post('/git', { path: repo, action: 'status' })
  ok(st.code === 0, 'git status runs in a real repo')
  const noRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-norepo-'))
  const badGit = await post('/git', { path: noRepo, action: 'status' })
  ok(badGit.error && /Git-Projektordner/.test(badGit.error), 'git action rejects a non-repo folder')
  await fs.rm(repo, { recursive: true, force: true })
  await fs.rm(noRepo, { recursive: true, force: true })

  await post('/settings', { globalInstructions: 'Neu.', apiKey: '', claudeModel: 'claude-opus-5-5' })
  const agents2 = await fs.readFile(path.join(cfg, 'AGENTS.md'), 'utf8')
  ok((agents2.match(/OPENDANTE-USER-START/g) || []).length === 1 && agents2.includes('Neu.'), 'user block replaced, not duplicated')
  const oc2 = JSON.parse(await fs.readFile(path.join(cfg, 'opencode.json'), 'utf8'))
  ok(!oc2.provider.anthropic, 'empty key removes the anthropic provider')

  const noKey = await post('/claude', { prompt: 'hallo' })
  ok(noKey.error && /Schlüssel/.test(noKey.error), 'claude call without a stored key fails cleanly (no network)')
} finally {
  srv.kill()
  await fs.rm(cfg, { recursive: true, force: true })
  await fs.rm(proj, { recursive: true, force: true })
  await fs.rm(data, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} FAILED` : '\nall companion checks passed')
process.exit(failed ? 1 : 0)
