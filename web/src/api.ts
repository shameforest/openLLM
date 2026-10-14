// All access to the local OpenCode server (started by the launcher as `opencode serve`, default 127.0.0.1:4096).
// Verified 2026-10-14 against OpenCode v1.19.0 (REST + SSE). No auth on localhost. Directory defaults to the server's
// cwd (the launcher starts it in the project folder), so we pass none and everything stays consistent.

export const DEFAULT_BASE = 'http://127.0.0.1:4096'
export const MODEL = { providerID: 'ollama', modelID: 'qwen3.8:27b' }

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

export const createSession = (title: string) =>
  call<{ id: string }>('/session', { method: 'POST', body: JSON.stringify({ title }) })

/** Send a user prompt. Returns at once (204); the answer arrives as events on the stream. */
export const sendPrompt = (sessionID: string, text: string, agent = 'build') =>
  call<void>(`/session/${sessionID}/prompt_async`, {
    method: 'POST',
    body: JSON.stringify({ agent, model: MODEL, parts: [{ type: 'text', text }] }),
  })

export const abort = (sessionID: string) =>
  call<boolean>(`/session/${sessionID}/abort`, { method: 'POST' }).catch(() => false)

/** Subscribe to the server's event stream (SSE). Returns an unsubscribe function. */
export function connectEvents(onEvent: (e: OcEvent) => void, onState?: (open: boolean) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const es = new EventSource(baseUrl() + '/event')
  es.onopen = () => onState?.(true)
  es.onerror = () => onState?.(false)
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data) as OcEvent) } catch { /* heartbeat / non-JSON */ } }
  return () => es.close()
}
