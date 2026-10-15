// A tiny local helper service (started by the launcher, port 4097) does the things a browser cannot: store the Claude
// API key in OpenCode, write the global instructions to AGENTS.md, save skills to disk, and run the updates. Until it
// runs, these calls fail cleanly and the UI says so. (The chat itself does NOT need it.)
// Overridable like the server address (localStorage `openllm.companion`), so a test companion can run beside the real one.
const DEFAULT_COMPANION = 'http://127.0.0.1:4097'
export const COMPANION = (() => { try { return localStorage.getItem('openllm.companion') || DEFAULT_COMPANION } catch { return DEFAULT_COMPANION } })()

export async function companionHealth(): Promise<boolean> {
  try { const r = await fetch(COMPANION + '/health', { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false }
}

export async function companionPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(COMPANION + path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return (await res.json().catch(() => ({}))) as T
}

export const OFFLINE_HINT = 'Der lokale Dienst läuft noch nicht — er startet mit OpenDante. Bis dahin greift dieser Knopf nicht.'
