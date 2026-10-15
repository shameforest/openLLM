// All access to the local OpenCode server (started by the launcher as `opencode serve`, default 127.0.0.1:4096).
// Verified 2026-10-14 against OpenCode v1.19.0 (REST + SSE). No auth on localhost. The working directory (the folder the
// agent reads/edits/runs in) is chosen PER REQUEST via the `directory` query param — one server serves many folders,
// no restart. Empty directory = the server's own cwd (where the launcher started it).

export const DEFAULT_BASE = 'http://127.0.0.1:4096'

/** `?directory=…` query suffix when a working folder is set, else empty. */
const dirQuery = (dir?: string) => (dir && dir.trim() ? `?directory=${encodeURIComponent(dir.trim())}` : '')

export interface OcEvent { id: string; type: string; properties: Record<string, unknown> }
export interface Health { healthy: boolean; version: string }

export function baseUrl(): string {
  try { return localStorage.getItem('openllm.base') || DEFAULT_BASE } catch { return DEFAULT_BASE }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Reachable? Returns the health payload, or null if the server is not up. */
export async function health(): Promise<Health | null> {
  try { return await call<Health>('/global/health') } catch { return null }
}

export const createSession = (title: string, dir?: string) =>
  call<{ id: string }>(`/session${dirQuery(dir)}`, { method: 'POST', body: JSON.stringify({ title }) })

/** Send a user prompt to the given local (Ollama) model. Returns at once (204); the answer arrives as events. */
export const sendPrompt = (sessionID: string, text: string, modelID: string, dir?: string, agent = 'build') =>
  call<void>(`/session/${sessionID}/prompt_async${dirQuery(dir)}`, {
    method: 'POST',
    body: JSON.stringify({ agent, model: { providerID: 'ollama', modelID }, parts: [{ type: 'text', text }] }),
  })

export const abort = (sessionID: string, dir?: string) =>
  call<boolean>(`/session/${sessionID}/abort${dirQuery(dir)}`, { method: 'POST' }).catch(() => false)

/** Subscribe to the server's event stream (SSE) for one working folder. Returns an unsubscribe function. */
export function connectEvents(onEvent: (e: OcEvent) => void, onState?: (open: boolean) => void, dir?: string): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const es = new EventSource(baseUrl() + '/event' + dirQuery(dir))
  es.onopen = () => onState?.(true)
  es.onerror = () => onState?.(false)
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data) as OcEvent) } catch { /* heartbeat / non-JSON */ } }
  return () => es.close()
}
