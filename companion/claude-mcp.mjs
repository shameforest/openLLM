// OpenDante MCP server: gives the local model ONE tool, "claude_helfer", to hand a self-contained, harmless subtask to
// the stronger Claude and get the finished solution back (so the result flows into the model's own turn — unlike the
// old text-marker path). It forwards to the companion's POST /claude (kind:'offload'), so the SAME safety gate, stored
// model, daily cap and on/off (the "Claude-Hilfe" slider) apply there. No dependencies; OpenCode spawns this per
// session and speaks MCP = newline-delimited JSON-RPC 2.0 over stdin/stdout.
import process from 'node:process'

const PORT = Number(process.env.OPENDANTE_COMPANION_PORT || 4097)
const COMPANION = `http://127.0.0.1:${PORT}`
const NAME = 'opendante'
const VERSION = '1.0.0'

const TOOL = {
  name: 'claude_helfer',
  description:
    'Gib eine IN SICH GESCHLOSSENE, UNBEDENKLICHE Teilaufgabe an einen stärkeren Helfer (Claude) ab und erhalte die ' +
    'fertige Lösung zurück. Geeignet nur für Teile, die OHNE Projektgeheimnisse, echte Namen, Zugangsdaten oder ' +
    'sensiblen/heiklen Zusammenhang für sich allein lösbar sind (z. B. eine Standard-Hilfsfunktion, ein Algorithmus, ' +
    'eine Formel, ein Regex). Sensibles und alles, was den Projektzusammenhang braucht, löst du selbst. Nur nutzen, ' +
    'wenn es wirklich Zeit spart. Gib die Aufgabe vollständig und eigenständig an, denn der Helfer kennt deinen ' +
    'Kontext nicht.',
  inputSchema: {
    type: 'object',
    properties: { aufgabe: { type: 'string', description: 'Die vollständige, eigenständige Aufgabenbeschreibung.' } },
    required: ['aufgabe'],
  },
}

// Same system prompt the UI uses for offload (web/src/claude.ts OFFLOAD_SYSTEM).
const OFFLOAD_SYSTEM =
  'Löse die folgende, in sich geschlossene Teilaufgabe vollständig und korrekt. Gib nur die fertige Lösung zurück ' +
  '(Code mit kurzen deutschen Kommentaren, falls es Code ist), ohne Rückfragen. Wenn die Aufgabe ohne zusätzlichen ' +
  'Zusammenhang nicht eindeutig lösbar ist, sage das in einem Satz, statt zu raten.'

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }) }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }) }

/** Is offloading switched on (the "Claude-Hilfe" slider above 0 %)? Asked at tools/list so the tool is only offered
 *  when the user wants it — no token cost on every request while it is off. Unreachable companion → treat as off. */
async function offloadOn() {
  try {
    const r = await fetch(`${COMPANION}/offload-prefs`)
    const j = await r.json().catch(() => ({}))
    return r.ok && Number(j && j.offloadShare) > 0
  } catch { return false }
}

/** Ask the companion to run the subtask on Claude. Returns the solution text, or throws with the companion's reason
 *  (no key / blocked by the safety gate / daily cap / offload switched off). */
async function askClaude(aufgabe) {
  const r = await fetch(`${COMPANION}/claude`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system: OFFLOAD_SYSTEM, prompt: String(aufgabe || ''), kind: 'offload' }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j && j.error) || `Companion-Fehler ${r.status}`)
  return (j && j.text) || ''
}

export async function handle(msg) {
  const { id, method, params } = msg || {}
  if (method === 'initialize') {
    const pv = (params && params.protocolVersion) || '2024-11-05'
    return reply(id, { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: { name: NAME, version: VERSION } })
  }
  if (method === 'notifications/initialized' || method === 'initialized') return // a notification: no response
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: (await offloadOn()) ? [TOOL] : [] })
  if (method === 'tools/call') {
    if (!params || params.name !== 'claude_helfer') return fail(id, -32602, `Unbekanntes Werkzeug: ${params && params.name}`)
    const aufgabe = params.arguments && params.arguments.aufgabe
    if (!aufgabe || !String(aufgabe).trim()) return reply(id, { content: [{ type: 'text', text: 'Keine Aufgabe angegeben.' }], isError: true })
    try {
      return reply(id, { content: [{ type: 'text', text: await askClaude(aufgabe) }] })
    } catch (e) {
      // A refusal (gate / cap / no key / off) is a normal tool result the model should read and then do it itself —
      // not a protocol error.
      return reply(id, { content: [{ type: 'text', text: `Konnte nicht an Claude ausgelagert werden (mach es selbst): ${String((e && e.message) || e)}` }], isError: true })
    }
  }
  if (id !== undefined && id !== null) fail(id, -32601, `Methode nicht unterstützt: ${method}`)
}

// Read newline-delimited JSON-RPC from stdin. Only run the loop when started as a process (not when imported by a test).
export function start() {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue } // ignore a non-JSON line rather than crash
      Promise.resolve(handle(msg)).catch(() => {})
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('claude-mcp.mjs')) start()
