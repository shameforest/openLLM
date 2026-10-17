// Self-contained check of the companion's file-writing endpoints. Run: node companion/test.mjs
import { execFileSync, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cfg = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-'))
const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-proj-'))
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-data-'))
// A port the OS reports free — never a fixed range, which could hit a running test companion (4197) and write into
// its real data folder.
const PORT = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
// A raw request, so the test can send what fetch() would clean up: a malformed path or a foreign Host header.
const raw = (p, headers = {}) => new Promise((resolve) => {
  const r = http.get({ host: '127.0.0.1', port: PORT, path: p, headers }, (res) => { res.resume(); resolve(res.statusCode) })
  r.on('error', () => resolve(0))
})
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

  // A malformed address used to end the whole process (AN-01).
  ok(await raw('/%') === 400, 'a malformed path ("/%") is answered with 400')
  ok(await raw('/%zz.js') === 400, 'a malformed path with an extension is answered with 400')
  ok([200, 400, 404].includes(await raw('//')), 'a path starting with "//" gets an answer')
  ok(await raw('/health', { host: 'evil.example:80' }) === 403, 'a foreign Host header (DNS rebinding) is refused')
  ok((await fetch(base + '/health')).ok, 'the companion is still alive after the bad requests')

  await post('/settings', { globalInstructions: 'Antworte knapp.', apiKey: 'sk-ant-x', claudeModel: 'claude-opus-5-5' })
  const agents = await fs.readFile(path.join(cfg, 'AGENTS.md'), 'utf8')
  ok(agents.includes('Antworte knapp.') && agents.includes('OPENDANTE-USER-START'), 'global instructions written to AGENTS.md')
  const key = JSON.parse(await fs.readFile(path.join(data, 'claude-key.json'), 'utf8'))
  ok(key.apiKey === 'sk-ant-x' && key.model === 'claude-opus-5-5', 'claude key written to the dedicated file (not opencode.json)')

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

  // File picker (Datei anhängen): GET /fs?files=1 adds the files of the folder, without it nothing changes
  const fdir = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-files-'))
  await fs.mkdir(path.join(fdir, 'unterordner'))
  await fs.writeFile(path.join(fdir, 'zweite.txt'), 'x'.repeat(2048))
  await fs.writeFile(path.join(fdir, 'Erste notiz.txt'), 'hallo')
  await fs.writeFile(path.join(fdir, '$Systemrauschen.txt'), 'nein')
  const withFiles = await fetch(base + '/fs?path=' + encodeURIComponent(fdir) + '&files=1').then((r) => r.json())
  ok(Array.isArray(withFiles.files) && withFiles.files.length === 2, 'GET /fs?files=1 lists the regular files (no folders, no $-system noise)')
  ok(withFiles.files[0].name === 'Erste notiz.txt' && withFiles.files[0].size === 5 && withFiles.files[0].path === path.join(fdir, 'Erste notiz.txt'), 'a listed file has its name, full path and size in bytes')
  ok(withFiles.files[1].name === 'zweite.txt' && withFiles.files[1].size === 2048, 'files are sorted by name')
  ok(withFiles.dirs.length === 1 && withFiles.dirs[0].name === 'unterordner', 'GET /fs?files=1 still lists the sub-folders')
  const noFiles = await fetch(base + '/fs?path=' + encodeURIComponent(fdir)).then((r) => r.json())
  ok(!('files' in noFiles) && noFiles.dirs.length === 1, 'without files=1 the answer has no files key (folder picker unchanged)')
  const rootsWithFiles = await fetch(base + '/fs?files=1').then((r) => r.json())
  ok(Array.isArray(rootsWithFiles.files) && rootsWithFiles.files.length === 0 && rootsWithFiles.dirs.length > 0, 'GET /fs?files=1 at the roots has an empty files list')
  await fs.rm(fdir, { recursive: true, force: true })

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

  // "Sicherung einschalten" (OD-26): a .gitignore keeps generated folders out of OpenCode's snapshots
  const prep = await post('/git/prepare', { path: noRepo })
  const gi = await fs.readFile(path.join(noRepo, '.gitignore'), 'utf8').catch(() => '')
  ok(prep.created === true && gi.includes('node_modules/') && gi.includes('.venv/'), 'prepare writes a default .gitignore into a folder without one')
  await fs.writeFile(path.join(noRepo, '.gitignore'), 'eigene-regel/\n')
  const prep2 = await post('/git/prepare', { path: noRepo })
  ok(prep2.created === false && (await fs.readFile(path.join(noRepo, '.gitignore'), 'utf8')) === 'eigene-regel/\n', 'an existing .gitignore is left alone')
  const prepHome = await post('/git/prepare', { path: os.homedir() })
  ok(prepHome.error && /nicht ein/.test(prepHome.error), 'the home folder is refused (too big for snapshots)')
  const prepRoot = await post('/git/prepare', { path: path.parse(os.homedir()).root })
  ok(prepRoot.error && /nicht ein/.test(prepRoot.error), 'a drive root is refused')
  await fs.rm(noRepo, { recursive: true, force: true })
  await fs.rm(repo, { recursive: true, force: true })
  await fs.rm(noRepo, { recursive: true, force: true })

  await post('/settings', { globalInstructions: 'Neu.', apiKey: '', claudeModel: 'claude-opus-5-5' })
  const agents2 = await fs.readFile(path.join(cfg, 'AGENTS.md'), 'utf8')
  ok((agents2.match(/OPENDANTE-USER-START/g) || []).length === 1 && agents2.includes('Neu.'), 'user block replaced, not duplicated')
  let keyGone = false
  try { await fs.access(path.join(data, 'claude-key.json')) } catch { keyGone = true }
  ok(keyGone, 'empty key removes the dedicated key file')

  // Pasted/dropped image → saved to disk, returns a path the UI can attach (the vision model reads it).
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const att = await post('/attach', { name: 'screenshot.png', dataBase64: png1x1 })
  ok(att.path && att.path.endsWith('.png') && att.size > 0, '/attach saves an image and returns its path')
  const { readFileSync: rf } = await import('node:fs')
  let onDisk = false; try { onDisk = rf(att.path).length === Buffer.from(png1x1, 'base64').length } catch {}
  ok(onDisk, 'the saved image is on disk with the right size')
  const attBad = await post('/attach', { name: 'schad.exe', dataBase64: png1x1 })
  ok(attBad.error && /nur Bilder/i.test(attBad.error), '/attach refuses a non-image file')
  const attEmpty = await post('/attach', { name: 'leer.png', dataBase64: '' })
  ok(attEmpty.error && /leer/i.test(attEmpty.error), '/attach refuses an empty image')

  // Projektnotiz (OD-41): per-project memory stored as .opendante/projektnotiz.md, read/written by the companion.
  const noteSave = await post('/project-note', { path: proj, content: '# Projekt\nZweck: Testprojekt.' })
  ok(noteSave.ok && noteSave.chars > 0, '/project-note saves a note into the project')
  const noteOnDisk = await fs.readFile(path.join(proj, '.opendante', 'projektnotiz.md'), 'utf8').then(() => true).catch(() => false)
  ok(noteOnDisk, 'the note is on disk at .opendante/projektnotiz.md')
  const noteGet = await (await fetch(base + '/project-note?path=' + encodeURIComponent(proj))).json()
  ok(noteGet.note.includes('Testprojekt'), 'GET /project-note returns the stored note')
  const noteEmptyDir = await (await fetch(base + '/project-note?path=')).json()
  ok(noteEmptyDir.note === '', 'GET /project-note returns empty for the default (no) folder')
  await post('/project-note', { path: proj, content: '   ' })
  const noteGone = await (await fetch(base + '/project-note?path=' + encodeURIComponent(proj))).json()
  ok(noteGone.note === '', 'an empty note removes the file')
  const noteBad = await post('/project-note', { path: path.join(proj, 'gibtsnicht'), content: 'x' })
  ok(noteBad.error && /Projektordner/.test(noteBad.error), '/project-note refuses a non-existent folder')

  // Projekt-Metadaten (OD-73): name/description per folder (.opendante/projekt.json); default name = folder basename.
  const metaDefault = await (await fetch(base + '/project-meta?path=' + encodeURIComponent(proj))).json()
  ok(metaDefault.name === path.basename(proj), 'GET /project-meta defaults the name to the folder basename')
  const metaSave = await post('/project-meta', { path: proj, name: 'Mein Projekt', description: 'Testbeschreibung' })
  ok(metaSave.name === 'Mein Projekt' && metaSave.description === 'Testbeschreibung', '/project-meta saves name + description')
  const metaGet = await (await fetch(base + '/project-meta?path=' + encodeURIComponent(proj))).json()
  ok(metaGet.name === 'Mein Projekt' && metaGet.createdAt, 'GET /project-meta returns the stored meta with a createdAt')
  const metaBad = await post('/project-meta', { path: path.join(proj, 'gibtsnicht'), name: 'x' })
  ok(metaBad.error && /Projektordner/.test(metaBad.error), '/project-meta refuses a non-existent folder')

  // Projektwissen (OD-73): knowledge items in .opendante/wissen/, listed with a char/token total for the capacity bar.
  const kEmpty = await (await fetch(base + '/project-knowledge?path=' + encodeURIComponent(proj))).json()
  ok(Array.isArray(kEmpty.items) && kEmpty.items.length === 0 && kEmpty.tokens === 0, 'GET /project-knowledge is empty at first')
  const kAdd = await post('/project-knowledge', { path: proj, name: 'regeln.md', content: 'Regel 1: immer testen.' })
  ok(kAdd.id && kAdd.chars > 0, '/project-knowledge adds a text item')
  const kOnDisk = await fs.readFile(path.join(proj, '.opendante', 'wissen', kAdd.id + '.txt'), 'utf8').then((t) => t.includes('Regel 1')).catch(() => false)
  ok(kOnDisk, 'the knowledge item text is on disk at .opendante/wissen/<id>.txt')
  const kList = await (await fetch(base + '/project-knowledge?path=' + encodeURIComponent(proj))).json()
  ok(kList.items.length === 1 && kList.chars === kAdd.chars && kList.tokens === Math.round(kAdd.chars / 4), 'GET /project-knowledge lists the item with char/token totals')
  const srcFile = path.join(data, 'quelle.txt')
  await fs.writeFile(srcFile, 'Inhalt aus einer Datei.')
  const kFromFile = await post('/project-knowledge', { path: proj, srcPath: srcFile })
  ok(kFromFile.id && kFromFile.name === 'quelle.txt', '/project-knowledge adds an item from a source file on disk')
  const binFile = path.join(data, 'bild.bin')
  await fs.writeFile(binFile, Buffer.from([0, 1, 2, 0, 255]))
  const kBin = await post('/project-knowledge', { path: proj, srcPath: binFile })
  ok(kBin.error && /Textdateien/.test(kBin.error), '/project-knowledge refuses a binary file (v1 is text-only)')
  const kDel = await post('/project-knowledge/delete', { path: proj, id: kAdd.id })
  ok(kDel.ok, '/project-knowledge/delete removes an item')
  const kAfter = await (await fetch(base + '/project-knowledge?path=' + encodeURIComponent(proj))).json()
  ok(kAfter.items.length === 1 && !kAfter.items.some((it) => it.id === kAdd.id), 'the deleted item is gone, the file-sourced one remains')
  const kEmptyContent = await post('/project-knowledge', { path: proj, content: '   ' })
  ok(kEmptyContent.error && /Leer/.test(kEmptyContent.error), '/project-knowledge refuses empty content')
  // Local search (OD-73 stage 2): these two paths need no embedding model, so they stay safe in the standard suite
  // (the real chunk→embed→cosine retrieval is proven separately against a live Ollama; the pure helpers in rag-test.mjs).
  const emptyProj = await fs.mkdtemp(path.join(os.tmpdir(), 'opendante-empty-'))
  const kSearchEmpty = await post('/project-knowledge/search', { path: emptyProj, query: 'egal' })
  ok(Array.isArray(kSearchEmpty.results) && kSearchEmpty.results.length === 0, '/project-knowledge/search on an empty project returns no results (no model needed)')
  const kSearchNoQuery = await post('/project-knowledge/search', { path: proj, query: '   ' })
  ok(kSearchNoQuery.error && /Suchanfrage/.test(kSearchNoQuery.error), '/project-knowledge/search refuses an empty query')
  // /context (OD-73 stage 3): with little knowledge it loads ALL of it (no model needed) — the send step prepends this.
  const ctx = await post('/project-knowledge/context', { path: proj, query: 'egal', budgetTokens: 16000 })
  ok(ctx.mode === 'all' && ctx.text.includes('Inhalt aus einer Datei'), '/project-knowledge/context loads all knowledge when it fits (no model)')
  const ctxEmpty = await post('/project-knowledge/context', { path: emptyProj, query: 'x' })
  ok(ctxEmpty.mode === 'none' && ctxEmpty.text === '', '/project-knowledge/context returns nothing for an empty project')

  const noKey = await post('/claude', { prompt: 'hallo' })
  ok(noKey.error && /Schlüssel/.test(noKey.error), 'claude call without a stored key fails cleanly (no network)')
  const noKeyTest = await post('/claude/test', {})
  ok(noKeyTest.ok === false && /Schlüssel/.test(noKeyTest.error || ''), 'claude/test reports a missing key cleanly (no network)')

  // Offload safety gate (server-side backstop): sensitive subtasks are blocked before anything else (key, slider, net).
  const blockedSex = await post('/claude', { kind: 'offload', prompt: 'Baue einen FaceSwap fuer explizite Bilder.' })
  ok(blockedSex.error && /bleibt lokal/.test(blockedSex.error), 'offload gate blocks explicit/face-swap content first')
  const blockedKey = await post('/claude', { kind: 'offload', prompt: 'Nutze den api-key sk-ant-abc123def456 fuer den Call.' })
  ok(blockedKey.error && /bleibt lokal/.test(blockedKey.error), 'offload gate blocks a secret/api key')
  const auditNotGated = await post('/claude', { kind: 'audit', prompt: 'Pruefe diese Loesung mit intim-Daten.' })
  ok(auditNotGated.error && /Schlüssel/.test(auditNotGated.error), 'the gate is for offload only — an audit reaches the normal key check')
  // Offload off by default (slider at 0): a benign offload is refused as "off" before the key check.
  const offBenign = await post('/claude', { kind: 'offload', prompt: 'Schreibe eine Python-Funktion ggt(a, b) euklidisch.' })
  ok(offBenign.error && /ausgeschaltet/.test(offBenign.error), 'a benign offload is refused while the slider is at 0 %')
  // Offload prefs: set the slider > 0, then a benign offload passes the gate and the on/off and reaches the key check.
  const prefs = await post('/offload-prefs', { offloadShare: 0.3, dailyUsd: 2 })
  ok(prefs.ok && prefs.offloadShare === 0.3 && prefs.dailyUsd === 2, '/offload-prefs stores the slider share and the daily cap')
  const got = await (await fetch(base + '/offload-prefs')).json()
  ok(got.offloadShare === 0.3 && got.dailyUsd === 2, 'GET /offload-prefs returns the stored prefs')
  const onBenign = await post('/claude', { kind: 'offload', prompt: 'Schreibe eine Python-Funktion ggt(a, b) euklidisch.' })
  ok(onBenign.error && /Schlüssel/.test(onBenign.error), 'with the slider > 0 a benign offload reaches the key check')
  const prefsClamp = await post('/offload-prefs', { offloadShare: 5, dailyUsd: -3 })
  ok(prefsClamp.offloadShare === 0.9 && prefsClamp.dailyUsd === 0, '/offload-prefs clamps the share to ≤0.9 and the cap to ≥0')
} finally {
  srv.kill()
  await fs.rm(cfg, { recursive: true, force: true })
  await fs.rm(proj, { recursive: true, force: true })
  await fs.rm(data, { recursive: true, force: true })
}
console.log(failed ? `\n${failed} FAILED` : '\nall companion checks passed')
process.exit(failed ? 1 : 0)
