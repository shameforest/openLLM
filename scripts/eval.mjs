#!/usr/bin/env node
// OpenDante Testlauf (OD-04): runs the fixed tasks in eval/tasks against a running OpenCode server and checks each
// result automatically. Every change (model, rules, skills, thinking effort) becomes measurable: success rate, minutes,
// steps, tokens, permission prompts, per task. Results go to eval/results/ (not committed) and one line per run to
// eval/results/verlauf.jsonl, so runs can be compared.
//
//   node scripts/eval.mjs                                   all tasks, default model, server 127.0.0.1:4096
//   node scripts/eval.mjs --tasks roemisch,umbenennen --repeat 2 --variant wenig-denken --label "think low"
//   node scripts/eval.mjs --base http://127.0.0.1:4196      a separate test server
//   node scripts/eval.mjs --level schwer --repeat 2         only the hard tasks, each twice (one run varies a lot)
//
// Each task runs in a fresh folder under ~/.opendante/eval/ (outside any git repo, made a git repo itself so it
// behaves like a real project with undo). Permission prompts are answered with the same rules as the app's
// "Befehle automatisch erlauben" (web/src/requests.ts); everything that would ask the user is refused with a hint and
// counted. Questions are skipped ("decide yourself"). Do not use OpenDante while a run is going: both share the GPU.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { autoDecision, openCodeSafeDirs } from '../web/src/requests.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TASKS = path.join(ROOT, 'eval', 'tasks')
const RESULTS = path.join(ROOT, 'eval', 'results')
const models = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'models.json'), 'utf8'))

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log('node scripts/eval.mjs [--base URL] [--model ID] [--variant NAME] [--tasks a,b] [--level leicht|schwer] [--repeat N] [--label TEXT] [--keep]')
  process.exit(0)
}
const BASE = (args.base || 'http://127.0.0.1:4096').replace(/\/$/, '')
const MODEL = args.model || models.default
const VARIANT = args.variant || ''
const REPEAT = Math.max(1, Number(args.repeat) || 1)
const LABEL = args.label || (VARIANT ? `${short(MODEL)} · ${VARIANT}` : short(MODEL))
const OLLAMA = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, '')}` : 'http://127.0.0.1:11434'
const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188'
const ANSWER_REFUSED = 'Im Testlauf nicht erlaubt (würde den Nutzer fragen). Finde einen Weg innerhalb des Arbeitsordners ohne diesen Schritt.'

function parseArgs(list) {
  const out = {}
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = list[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}
function short(model) { return model.split('/').pop() }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const q = (dir) => `?directory=${encodeURIComponent(dir)}`

async function api(p, init) {
  const res = await fetch(BASE + p, { ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${p} -> ${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.status === 204 ? undefined : res.json()
}

// ---- before starting: server up, OpenDali not rendering, model loaded ----
async function preflight() {
  try { await api('/global/health') } catch {
    console.error(`OpenCode antwortet nicht unter ${BASE}. Erst OpenDante starten (Symbol) oder --base angeben.`)
    process.exit(2)
  }
  try {
    const r = await fetch(`${COMFY}/queue`, { signal: AbortSignal.timeout(3000) })
    const qd = await r.json()
    if ((qd.queue_running?.length ?? 0) + (qd.queue_pending?.length ?? 0) > 0) {
      console.error('OpenDali rechnet gerade (ComfyUI-Warteschlange nicht leer). Testlauf später starten.')
      process.exit(3)
    }
  } catch { /* ComfyUI not running: nothing to protect */ }
  const t0 = Date.now()
  const ps = await fetch(`${OLLAMA}/api/ps`).then((r) => r.json()).catch(() => ({ models: [] }))
  if (!ps.models?.some((m) => m.name === MODEL || m.model === MODEL)) {
    process.stdout.write(`Lade ${short(MODEL)} in die Grafikkarte … `)
    await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODEL, keep_alive: '30m' }) }).then((r) => r.text()).catch(() => '')
    console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
}

function loadTasks() {
  const only = typeof args.tasks === 'string' ? args.tasks.split(',').map((s) => s.trim()) : null
  const level = typeof args.level === 'string' ? args.level : null // "leicht" (the first 7) or "schwer"
  return fs.readdirSync(TASKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(TASKS, d.name, 'task.json')))
    .map((d) => ({ dir: path.join(TASKS, d.name), ...JSON.parse(fs.readFileSync(path.join(TASKS, d.name, 'task.json'), 'utf8')) }))
    .filter((t) => !only || only.includes(t.id))
    .filter((t) => !level || (t.level || 'leicht') === level)
    .sort((a, b) => a.id.localeCompare(b.id))
}

// ---- one task ----
async function runTask(task, workdir, safeDirs) {
  fs.mkdirSync(workdir, { recursive: true })
  const start = path.join(task.dir, 'start')
  if (fs.existsSync(start)) fs.cpSync(start, workdir, { recursive: true, filter: (src) => path.basename(src) !== '.keep' })
  await api(`/project/git/init${q(workdir)}`, { method: 'POST' }).catch(() => {})

  const session = await api(`/session${q(workdir)}`, { method: 'POST', body: JSON.stringify({ title: `Testlauf ${task.id}` }) })
  const body = { agent: 'build', model: { providerID: 'ollama', modelID: MODEL }, parts: [{ type: 'text', text: task.prompt }] }
  if (VARIANT) body.variant = VARIANT
  const t0 = Date.now()
  await api(`/session/${session.id}/prompt_async${q(workdir)}`, { method: 'POST', body: JSON.stringify(body) })

  const limitMs = (task.timeoutMin || 10) * 60_000
  const seen = new Set()
  let asks = 0, autoAllowed = 0, questions = 0, timedOut = false
  const asked = [] // what would have needed the user's OK (command or pattern), for the report
  await sleep(1500)
  for (;;) {
    // Permission prompts: same rules as the app's automatic mode; the rest is refused (= would have asked the user).
    for (const p of await api(`/permission${q(workdir)}`).catch(() => [])) {
      if (seen.has(p.id) || p.sessionID !== session.id) continue
      seen.add(p.id)
      const d = autoDecision(p, workdir, safeDirs)
      if (d?.reply === 'once') autoAllowed++
      else { asks++; asked.push(`${p.permission}: ${String(p.metadata?.command ?? p.patterns?.join(' ') ?? '').replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 300)}`) }
      const reply = d ?? { reply: 'reject', message: ANSWER_REFUSED }
      await api(`/permission/${p.id}/reply${q(workdir)}`, { method: 'POST', body: JSON.stringify(reply) }).catch(() => {})
    }
    for (const x of await api(`/question${q(workdir)}`).catch(() => [])) {
      if (seen.has(x.id) || x.sessionID !== session.id) continue
      seen.add(x.id); questions++
      await api(`/question/${x.id}/reject${q(workdir)}`, { method: 'POST' }).catch(() => {})
    }
    const st = await api(`/session/status${q(workdir)}`).catch(() => ({}))
    if (!st[session.id] || st[session.id].type === 'idle') break
    if (Date.now() - t0 > limitMs) {
      timedOut = true
      await api(`/session/${session.id}/abort${q(workdir)}`, { method: 'POST' }).catch(() => {})
      break
    }
    await sleep(2000)
  }
  const seconds = (Date.now() - t0) / 1000

  // What happened: steps (model calls), tokens read/written, tool calls and failed ones, the model's last error.
  const msgs = await api(`/session/${session.id}/message${q(workdir)}`).catch(() => [])
  let steps = 0, read = 0, written = 0, tools = 0, toolErrors = 0, error = ''
  for (const m of msgs) {
    if (m.info?.role !== 'assistant') continue
    steps++
    const t = m.info.tokens ?? {}
    read += (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)
    written += (t.output ?? 0) + (t.reasoning ?? 0)
    if (m.info.error) error = m.info.error.data?.message || m.info.error.name || 'Fehler'
    for (const part of m.parts ?? []) {
      if (part.type !== 'tool') continue
      tools++
      if (part.state?.status === 'error') toolErrors++
    }
  }

  // The check: run with the task folder's check file, inside the working folder. Exit code 0 = solved.
  const [cmd, ...rest] = task.check
  const checkArgs = rest.map((a) => (fs.existsSync(path.join(task.dir, a)) ? path.join(task.dir, a) : a))
  const c = spawnSync(cmd, checkArgs, { cwd: workdir, encoding: 'utf8', timeout: 60_000, windowsHide: true })
  const output = `${c.stdout ?? ''}${c.stderr ?? ''}`.trim().split(/\r?\n/).filter(Boolean)
  const passed = c.status === 0
  // Test sessions would otherwise pile up in OpenCode's session database, also the user's (OD-32). Failed ones stay
  // for diagnosis (their id is in the report).
  if (!args.keep && passed) await api(`/session/${session.id}${q(workdir)}`, { method: 'DELETE' }).catch(() => {})
  return {
    task: task.id, kind: task.kind, passed, timedOut, seconds: Math.round(seconds), steps, tools, toolErrors,
    tokensRead: read, tokensWritten: written, asks, asked, autoAllowed, questions, error,
    check: passed ? 'ok' : (output.at(-1) || (c.error ? String(c.error.message) : `Exit ${c.status}`)).slice(0, 200),
    session: session.id, workdir,
  }
}

// ---- report ----
const fmtMin = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function report(stamp, runs) {
  const passed = runs.filter((r) => r.passed).length
  const total = runs.length
  const secs = runs.reduce((s, r) => s + r.seconds, 0)
  const lines = [
    `# Testlauf ${stamp}`,
    '',
    `- Modell: \`${MODEL}\`${VARIANT ? ` · Variante \`${VARIANT}\`` : ''} · Bezeichnung: ${LABEL}`,
    `- Server: ${BASE} · Wiederholungen: ${REPEAT}`,
    `- **Gelöst: ${passed} von ${total}** · Dauer gesamt ${fmtMin(secs)} min · Rückfragen, die der Nutzer hätte beantworten müssen: ${runs.reduce((s, r) => s + r.asks, 0)}`,
    '',
    '| Aufgabe | Ergebnis | Dauer | Schritte | Werkzeuge (Fehler) | Tokens gelesen / geschrieben | Rückfragen | Prüfung |',
    '|---|---|---|---|---|---|---|---|',
    ...runs.map((r) => `| ${r.task} | ${r.passed ? '✅' : r.timedOut ? '⏱ Zeit um' : '❌'} | ${fmtMin(r.seconds)} | ${r.steps} | ${r.tools} (${r.toolErrors}) | ${fmtK(r.tokensRead)} / ${fmtK(r.tokensWritten)} | ${r.asks} | ${r.check.replace(/\|/g, '/')}${r.error ? ` · Modellfehler: ${r.error}` : ''} |`),
    '',
  ]
  const asked = runs.flatMap((r) => (r.asked ?? []).map((a) => `- ${r.task}: \`${a.replace(/`/g, "'")}\``))
  if (asked.length) lines.push('**Hätte nachgefragt** (im Testlauf abgelehnt, der Agent musste einen anderen Weg finden):', '', ...asked, '')
  return { md: lines.join('\n'), summary: { stamp, model: MODEL, variant: VARIANT, label: LABEL, level: args.level || 'alle', repeat: REPEAT, passed, total, seconds: secs,
    tokensWritten: runs.reduce((s, r) => s + r.tokensWritten, 0), asks: runs.reduce((s, r) => s + r.asks, 0) } }
}

async function main() {
  const tasks = loadTasks()
  if (!tasks.length) { console.error('Keine Aufgaben gefunden (eval/tasks/*/task.json).'); process.exit(2) }
  await preflight()
  const paths = await api('/path').catch(() => null)
  const safeDirs = openCodeSafeDirs(paths)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}` // local time
  const base = path.join(os.homedir(), '.opendante', 'eval', stamp)
  console.log(`Testlauf ${stamp}: ${tasks.length} Aufgaben × ${REPEAT} · ${LABEL}`)

  const runs = []
  for (let n = 1; n <= REPEAT; n++) {
    for (const task of tasks) {
      process.stdout.write(`  ${task.id}${REPEAT > 1 ? ` #${n}` : ''} … `)
      const r = await runTask(task, path.join(base, `${task.id}-${n}`), safeDirs).catch((e) => ({
        task: task.id, kind: task.kind, passed: false, timedOut: false, seconds: 0, steps: 0, tools: 0, toolErrors: 0,
        tokensRead: 0, tokensWritten: 0, asks: 0, autoAllowed: 0, questions: 0, error: String(e.message || e), check: 'Lauf abgebrochen',
      }))
      runs.push(r)
      console.log(`${r.passed ? 'gelöst' : r.timedOut ? 'Zeit um' : 'nicht gelöst'} · ${fmtMin(r.seconds)} min · ${r.steps} Schritte${r.asks ? ` · ${r.asks} Rückfrage${r.asks === 1 ? '' : 'n'}` : ''}${r.passed ? '' : ` · ${r.check}`}`)
    }
  }

  const { md, summary } = report(stamp, runs)
  fs.mkdirSync(RESULTS, { recursive: true })
  const file = path.join(RESULTS, `${stamp}_${LABEL.replace(/[^\w.-]+/g, '-')}`)
  fs.writeFileSync(`${file}.md`, md)
  fs.writeFileSync(`${file}.json`, JSON.stringify({ ...summary, runs }, null, 2))
  const history = path.join(RESULTS, 'verlauf.jsonl')
  const before = fs.existsSync(history) ? fs.readFileSync(history, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  fs.appendFileSync(history, JSON.stringify(summary) + '\n')
  // The EPERM seen after a run is most likely a file OpenCode still had open, so cleanup is retried briefly; a leftover
  // folder is only reported. Git's read-only object files are made writable first, for tools that refuse to delete them.
  if (!args.keep) {
    const writable = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) writable(p)
        else { try { fs.chmodSync(p, 0o666) } catch { /* gone or locked */ } }
      }
    }
    let cleaned = false
    for (let i = 0; i < 5 && !cleaned; i++) {
      try { if (fs.existsSync(base)) writable(base); fs.rmSync(base, { recursive: true, force: true }); cleaned = true } catch { await sleep(2000) }
    }
    if (!cleaned) console.log(`(Arbeitsordner ${base} ließ sich noch nicht löschen; später von Hand entfernen.)`)
  }

  console.log(`\nGelöst: ${summary.passed} von ${summary.total} · ${fmtMin(summary.seconds)} min · Bericht: ${file}.md`)
  if (before.length) {
    console.log('Frühere Läufe:')
    for (const b of before.slice(-5)) console.log(`  ${b.stamp}  ${b.label.padEnd(40)} ${b.passed}/${b.total}  ${fmtMin(b.seconds)} min  ${fmtK(b.tokensWritten)} Tokens geschrieben`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
