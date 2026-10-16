// A tiny local helper service (started by the launcher, port 4097) does the things a browser cannot: store the Claude
// API key in OpenCode, write the global instructions to AGENTS.md, save skills to disk, and run the updates. Until it
// runs, these calls fail cleanly and the UI says so. (The chat itself does NOT need it.)
// Overridable like the server address (localStorage `openllm.companion`), so a test companion can run beside the real one.
const DEFAULT_COMPANION = 'http://127.0.0.1:4097'
export const COMPANION = (() => { try { return localStorage.getItem('openllm.companion') || DEFAULT_COMPANION } catch { return DEFAULT_COMPANION } })()

export async function companionHealth(): Promise<boolean> {
  try { const r = await fetch(COMPANION + '/health', { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false }
}

// Every POST is JSON (also without a payload): the companion refuses anything else, which keeps foreign web pages out.
export async function companionPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(COMPANION + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((j && typeof j.error === 'string' && j.error) || `${res.status}`) // e.g. "Tageslimit … erreicht"
  return j as T
}

export const OFFLINE_HINT = 'Der lokale Dienst läuft noch nicht — er startet mit OpenDante. Bis dahin greift dieser Knopf nicht.'

/** Save a pasted or dropped image to disk (the companion returns its path) so it can be attached like a picked file. */
export const saveImageAttachment = (name: string, dataBase64: string) =>
  companionPost<{ path: string; name: string; size: number }>('/attach', { name, dataBase64 })

/** The project note (OD-41): a per-project memory stored as .opendante/projektnotiz.md in the working folder. */
export async function getProjectNote(dir: string): Promise<{ note: string }> {
  try { const r = await fetch(`${COMPANION}/project-note?path=${encodeURIComponent(dir)}`); return await r.json() } catch { return { note: '' } }
}
export const saveProjectNote = (path: string, content: string) =>
  companionPost<{ ok: boolean; chars: number }>('/project-note', { path, content })
