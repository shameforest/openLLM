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

// ---- Projektordner (OD-73): name/description, knowledge items, local search, and the context prepended to a prompt ----
export interface ProjectMeta { name: string; description: string; createdAt: number | null }
export interface KnowledgeItem { id: string; name: string; chars: number; addedAt: number }
export interface KnowledgeList { items: KnowledgeItem[]; chars: number; tokens: number }
export interface KnowledgeContext { text: string; mode: 'none' | 'all' | 'search'; tokens: number; used: number }

export async function getProjectMeta(dir: string): Promise<ProjectMeta> {
  try { const r = await fetch(`${COMPANION}/project-meta?path=${encodeURIComponent(dir)}`); return await r.json() } catch { return { name: '', description: '', createdAt: null } }
}
export const saveProjectMeta = (path: string, meta: { name?: string; description?: string }) =>
  companionPost<ProjectMeta>('/project-meta', { path, ...meta })

export async function getKnowledge(dir: string): Promise<KnowledgeList> {
  try { const r = await fetch(`${COMPANION}/project-knowledge?path=${encodeURIComponent(dir)}`); return await r.json() } catch { return { items: [], chars: 0, tokens: 0 } }
}
export const addKnowledge = (path: string, body: { name?: string; content?: string; srcPath?: string }) =>
  companionPost<KnowledgeItem>('/project-knowledge', { path, ...body })
export const removeKnowledge = (path: string, id: string) =>
  companionPost<{ ok: boolean }>('/project-knowledge/delete', { path, id })

/** The knowledge to prepend to a prompt in a project: all of it when it fits, else the parts most relevant to `query`
 *  (local search). Empty on any error, so a knowledge hiccup never blocks sending. */
export async function getKnowledgeContext(dir: string, query: string, budgetTokens = 16000): Promise<KnowledgeContext> {
  try { return await companionPost<KnowledgeContext>('/project-knowledge/context', { path: dir, query, budgetTokens }) } catch { return { text: '', mode: 'none', tokens: 0, used: 0 } }
}
