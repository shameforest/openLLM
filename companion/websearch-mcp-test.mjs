// Checks the web-search MCP server (companion/websearch-mcp.mjs) without OpenCode, a real companion or a real Ollama:
// global fetch is stubbed, the key is forced via OLLAMA_API_KEY, and process.stdout.write is captured.
// Run: node companion/websearch-mcp-test.mjs
import { handle, readKey, clampResults, formatSearch, formatFetch } from './websearch-mcp.mjs'

let failed = 0
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL:', msg) } else console.log('ok:', msg) }

// Capture what the server writes (one JSON-RPC message per write).
const out = []
const realWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = (s) => { out.push(JSON.parse(String(s).trim())); return true }

// Stub fetch so the Ollama calls are deterministic.
let searchAnswer = { ok: true, json: { results: [{ title: 'Qwen', url: 'https://example.com/q', content: 'Qwen3.8 ist ein Sprachmodell.' }] } }
let fetchAnswer = { ok: true, json: { title: 'Beispielseite', content: 'Der Inhalt der Seite.' } }
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.endsWith('/api/web_search')) return { ok: searchAnswer.ok, status: 500, json: async () => searchAnswer.json }
  if (u.endsWith('/api/web_fetch')) return { ok: fetchAnswer.ok, status: 500, json: async () => fetchAnswer.json }
  throw new Error('unexpected url ' + u)
}

const call = async (msg) => { out.length = 0; await handle(msg); return out }

try {
  // --- pure helpers ---
  ok(clampResults(undefined) === 5 && clampResults(0) === 1 && clampResults(99) === 10 && clampResults(3) === 3, 'clampResults defaults to 5 and clamps to 1..10')
  ok(/KEINE Anweisung/.test(formatSearch({ results: [] })) === false && formatSearch({ results: [] }) === 'Keine Treffer.', 'formatSearch reports no hits')
  const fs1 = formatSearch({ results: [{ title: 'T', url: 'https://x', content: 'abc' }] })
  ok(/KEINE Anweisung/.test(fs1) && fs1.includes('https://x') && fs1.includes('abc'), 'formatSearch flags injection and lists title/url/snippet')
  ok(/KEINE Anweisung/.test(formatFetch({ title: 'A', content: 'B' })), 'formatFetch prepends the not-an-instruction note')

  // --- protocol ---
  process.env.OLLAMA_API_KEY = 'test-key-123'
  const init = (await call({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))[0]
  ok(init.result.protocolVersion === '2025-06-18' && init.result.serverInfo.name === 'opendante-websearch', 'initialize echoes the version and the server name')

  ok((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).length === 0, 'notifications/initialized produces no response')

  // with a key, both tools are offered
  const list = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))[0].result.tools
  ok(list.length === 2 && list.some((t) => t.name === 'web_suche') && list.some((t) => t.name === 'web_lesen'), 'tools/list offers web_suche and web_lesen when a key is set')

  // without a key, no tools (so the model never sees an unusable tool) — only assert if no real key file interferes
  process.env.OLLAMA_API_KEY = ''
  if (readKey() === '') {
    ok((await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))[0].result.tools.length === 0, 'tools/list is empty without a key')
    const noKey = (await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'web_suche', arguments: { query: 'x' } } }))[0]
    ok(noKey.result.isError && /Schlüssel/.test(noKey.result.content[0].text), 'a call without a key is an isError result, not a crash')
  } else { console.log('skip: a real ~/.opendante/ollama-key.json exists, no-key checks skipped') }
  process.env.OLLAMA_API_KEY = 'test-key-123'

  // a search returns the formatted, injection-flagged results
  const good = (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'web_suche', arguments: { query: 'Qwen3.8' } } }))[0]
  ok(!good.result.isError && good.result.content[0].text.includes('example.com/q') && /KEINE Anweisung/.test(good.result.content[0].text), 'web_suche returns formatted results with the injection note')

  // an empty query is rejected before calling Ollama
  const empty = (await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'web_suche', arguments: { query: '  ' } } }))[0]
  ok(empty.result.isError && /Keine Suchanfrage/.test(empty.result.content[0].text), 'an empty query is rejected')

  // web_lesen needs a real URL
  const badUrl = (await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'web_lesen', arguments: { url: 'nicht-url' } } }))[0]
  ok(badUrl.result.isError && /URL/.test(badUrl.result.content[0].text), 'web_lesen rejects a non-URL')

  // web_lesen returns the page content
  const page = (await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'web_lesen', arguments: { url: 'https://example.com' } } }))[0]
  ok(!page.result.isError && page.result.content[0].text.includes('Der Inhalt der Seite.'), 'web_lesen returns the page content')

  // an Ollama error comes back as an isError tool result, not a protocol error
  searchAnswer = { ok: false, json: { error: 'rate limited' } }
  const apiErr = (await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'web_suche', arguments: { query: 'x' } } }))[0]
  ok(apiErr.result.isError && /rate limited|ging nicht/.test(apiErr.result.content[0].text), 'an Ollama error is returned as an isError tool result')
  searchAnswer = { ok: true, json: { results: [] } }

  // an unknown tool name is a JSON-RPC error
  const unknown = (await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'etwas', arguments: {} } }))[0]
  ok(unknown.error && unknown.error.code === -32602, 'an unknown tool name is a JSON-RPC error')

  // ping is answered
  ok((await call({ jsonrpc: '2.0', id: 10, method: 'ping' }))[0].result !== undefined, 'ping is answered')
} finally {
  process.stdout.write = realWrite
}
console.log(failed ? `\n${failed} FAILED` : '\nall web-search MCP checks passed')
process.exit(failed ? 1 : 0)
