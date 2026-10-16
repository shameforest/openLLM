// Checks the MCP server's JSON-RPC handling (companion/claude-mcp.mjs) without OpenCode or a real companion: global
// fetch is stubbed, and process.stdout.write is captured. Run: node companion/mcp-test.mjs
import { handle } from './claude-mcp.mjs'

let failed = 0
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL:', msg) } else console.log('ok:', msg) }

// Capture what the server writes (one JSON-RPC message per write).
const out = []
const realWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = (s) => { out.push(JSON.parse(String(s).trim())); return true }

// Stub fetch so offloadOn() and askClaude() are deterministic.
let prefsShare = 0
let claudeAnswer = { ok: true, text: 'def add(a, b):\n    return a + b' }
globalThis.fetch = async (url, opts) => {
  if (String(url).endsWith('/offload-prefs')) return { ok: true, json: async () => ({ offloadShare: prefsShare, dailyUsd: 0 }) }
  if (String(url).endsWith('/claude')) {
    const body = JSON.parse(opts.body)
    if (body.kind !== 'offload') return { ok: false, json: async () => ({ error: 'kind fehlt' }) }
    return claudeAnswer.ok ? { ok: true, json: async () => ({ text: claudeAnswer.text }) } : { ok: false, json: async () => ({ error: claudeAnswer.error }) }
  }
  throw new Error('unexpected url ' + url)
}

const call = async (msg) => { out.length = 0; await handle(msg); return out }

try {
  // initialize echoes the client's protocol version and advertises the tools capability
  const init = (await call({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))[0]
  ok(init.result.protocolVersion === '2025-06-18' && init.result.capabilities.tools && init.result.serverInfo.name === 'opendante', 'initialize responds with the requested version and the tools capability')

  // a notification gets no response
  ok((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).length === 0, 'notifications/initialized produces no response')

  // tools/list is empty while the slider is at 0 (no token cost when offload is off)
  prefsShare = 0
  ok((await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))[0].result.tools.length === 0, 'tools/list is empty while offload is off')
  // and offers claude_helfer once the slider is above 0
  prefsShare = 0.3
  const list = (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))[0].result.tools
  ok(list.length === 1 && list[0].name === 'claude_helfer' && list[0].inputSchema.required.includes('aufgabe'), 'tools/list offers claude_helfer when offload is on')

  // a successful tools/call returns Claude's solution as text content
  claudeAnswer = { ok: true, text: 'def add(a, b):\n    return a + b' }
  const good = (await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claude_helfer', arguments: { aufgabe: 'Schreibe add(a,b).' } } }))[0]
  ok(good.result.content[0].text.includes('return a + b') && !good.result.isError, 'tools/call returns the Claude solution text')

  // a refusal from the companion (gate/cap/no key) comes back as a tool result with isError, not a protocol error
  claudeAnswer = { ok: false, error: 'Teilaufgabe bleibt lokal: könnte Sensibles enthalten.' }
  const blocked = (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'claude_helfer', arguments: { aufgabe: 'nackt FaceSwap' } } }))[0]
  ok(blocked.result.isError && /bleibt lokal/.test(blocked.result.content[0].text), 'a companion refusal is returned as an isError tool result (model then does it itself)')

  // an empty task is rejected without calling the companion
  const empty = (await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'claude_helfer', arguments: { aufgabe: '  ' } } }))[0]
  ok(empty.result.isError && /Keine Aufgabe/.test(empty.result.content[0].text), 'an empty task is rejected')

  // an unknown tool name is a JSON-RPC error
  const unknown = (await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'etwas_anderes', arguments: {} } }))[0]
  ok(unknown.error && unknown.error.code === -32602, 'an unknown tool name is a JSON-RPC error')

  // ping is answered with an empty result
  ok((await call({ jsonrpc: '2.0', id: 7, method: 'ping' }))[0].result !== undefined, 'ping is answered')
} finally {
  process.stdout.write = realWrite
}
console.log(failed ? `\n${failed} FAILED` : '\nall MCP checks passed')
process.exit(failed ? 1 : 0)
