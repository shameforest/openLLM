// All access to the local OpenCode server (started by the launcher as `opencode serve`, default 127.0.0.1:4096).
// Verified 2026-10-14 against OpenCode v1.19.0 (REST + SSE). No auth on localhost. The working directory (the folder the
// agent reads/edits/runs in) is chosen PER REQUEST via the `directory` query param — one server serves many folders,
// no restart. Empty directory = the server's own cwd (where the launcher started it).

import { type Attachment, filePart } from './attachments'

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

/** Send a user prompt to the given local (Ollama) model. Returns at once (204); the answer arrives as events.
 *  `variant` picks a model variant from config/opencode.json, e.g. "ohne-denken" (sent to Ollama as reasoning_effort none).
 *  `files` are attached as file parts (file:// urls): OpenCode reads them from disk and hands the content to the model. */
export const sendPrompt = (sessionID: string, text: string, modelID: string, dir?: string, agent = 'build', variant?: string, files: Attachment[] = []) =>
  call<void>(`/session/${sessionID}/prompt_async${dirQuery(dir)}`, {
    method: 'POST',
    body: JSON.stringify({ agent, model: { providerID: 'ollama', modelID }, parts: [{ type: 'text', text }, ...files.map(filePart)], ...(variant ? { variant } : {}) }),
  })

export const abort = (sessionID: string, dir?: string) =>
  call<boolean>(`/session/${sessionID}/abort${dirQuery(dir)}`, { method: 'POST' }).catch(() => false)

// ---- requests the agent waits on (verified against the server's own OpenAPI doc, GET /doc, OpenCode 1.19.0) ----
// Without an answer the agent waits forever — these were the main reason long tasks seemed stuck.

/** The agent wants to do something its permission rules mark "ask" (a command, a file outside the project, a 3rd identical step). */
export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string // bash | edit | external_directory | doom_loop | webfetch | task | …
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
}
export interface QuestionOption { label: string; description: string }
export interface QuestionInfo { question: string; header: string; options: QuestionOption[]; multiple?: boolean; custom?: boolean }
/** The agent asks the user a multiple-choice question (its "question" tool). */
export interface QuestionRequest { id: string; sessionID: string; questions: QuestionInfo[] }
export type SessionStatus = { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next: number }

export const listPermissions = (dir?: string) => call<PermissionRequest[]>(`/permission${dirQuery(dir)}`)
export const listQuestions = (dir?: string) => call<QuestionRequest[]>(`/question${dirQuery(dir)}`)
export const replyPermission = (id: string, reply: 'once' | 'always' | 'reject', dir?: string, message?: string) =>
  call<boolean>(`/permission/${id}/reply${dirQuery(dir)}`, { method: 'POST', body: JSON.stringify(message ? { reply, message } : { reply }) })
export const replyQuestion = (id: string, answers: string[][], dir?: string) =>
  call<boolean>(`/question/${id}/reply${dirQuery(dir)}`, { method: 'POST', body: JSON.stringify({ answers }) })
export const rejectQuestion = (id: string, dir?: string) =>
  call<boolean>(`/question/${id}/reject${dirQuery(dir)}`, { method: 'POST' })
// ---- undo, changes, plan list, context (verified against GET /doc, OpenCode 1.19.0) ----

/** One changed file of a turn: unified-diff `patch`, line counts, added/deleted/modified. */
export interface FileDiff { file?: string; patch?: string; additions: number; deletions: number; status?: 'added' | 'deleted' | 'modified' }
/** A step of the agent's own task list (its `todowrite` tool). */
export interface Todo { content: string; status: string; priority: string }

/** Files changed by the turn that started with `messageID` (the user message). */
export const sessionDiff = (sessionID: string, messageID: string, dir?: string) =>
  call<FileDiff[]>(`/session/${sessionID}/diff${dirQuery(dir)}${dir && dir.trim() ? '&' : '?'}messageID=${encodeURIComponent(messageID)}`)
/** Undo from this message on: files go back to their state before it; OpenCode drops the reverted messages with the
 *  next prompt. `unrevert` takes it back as long as no new prompt was sent. */
export const revertTo = (sessionID: string, messageID: string, dir?: string) =>
  call<unknown>(`/session/${sessionID}/revert${dirQuery(dir)}`, { method: 'POST', body: JSON.stringify({ messageID }) })
export const unrevert = (sessionID: string, dir?: string) =>
  call<unknown>(`/session/${sessionID}/unrevert${dirQuery(dir)}`, { method: 'POST' })
export const sessionTodos = (sessionID: string, dir?: string) => call<Todo[]>(`/session/${sessionID}/todo${dirQuery(dir)}`)
/** Condense the conversation so far into a summary, to free the model's context window. */
export const summarize = (sessionID: string, modelID: string, dir?: string) =>
  call<boolean>(`/session/${sessionID}/summarize${dirQuery(dir)}`, { method: 'POST', body: JSON.stringify({ providerID: 'ollama', modelID }) })

/** The folder as OpenCode sees it. Without `vcs: "git"` OpenCode keeps no file snapshots there: no list of changed
 *  files, no undo (measured 2026-10-15: same edit, empty diff before `git init`, the diff right after). */
export const projectInfo = (dir?: string) => call<{ id: string; worktree: string; vcs?: string }>(`/project/current${dirQuery(dir)}`)
/** Make the folder a git repository (a hidden .git folder), so OpenCode can snapshot it. Nothing is committed. */
export const gitInit = (dir?: string) => call<{ vcs?: string }>(`/project/git/init${dirQuery(dir)}`, { method: 'POST' })

/** The server's own folders; `directory` is where the agent works when no folder is chosen. */
export const serverPaths = (dir?: string) => call<{ home: string; state: string; config: string; directory: string }>(`/path${dirQuery(dir)}`)

/** What a model can take/do, as the running OpenCode reports it (depends on the installed opencode.json). */
export interface ModelCaps { attachment: boolean; image: boolean }
interface ProviderList { providers?: { id: string; models?: Record<string, { capabilities?: { attachment?: boolean; input?: { image?: boolean } } }> }[] }
/** Flatten GET /config/providers into "providerID/modelID" → caps. Pure, so the image-support check is unit-testable. */
export function modelCapsFrom(data: ProviderList): Record<string, ModelCaps> {
  const m: Record<string, ModelCaps> = {}
  for (const p of data.providers ?? []) for (const [id, md] of Object.entries(p.models ?? {})) m[`${p.id}/${id}`] = { attachment: !!md.capabilities?.attachment, image: !!md.capabilities?.input?.image }
  return m
}
/** Does the active model accept images? true/false, or null when we don't know yet (caps not loaded) — then don't warn. */
export function activeModelTakesImages(caps: Record<string, ModelCaps>, provider: string, modelId: string): boolean | null {
  const c = caps[`${provider}/${modelId}`]
  return c ? c.image : null
}
/** The running OpenCode's model capabilities. Empty map on any error, so a hiccup never blocks sending. */
export const listModelCaps = () => call<ProviderList>(`/config/providers`).then(modelCapsFrom).catch(() => ({} as Record<string, ModelCaps>))
/** busy / idle / retry (after a model error, with attempt and reason) for every session in the folder. */
export const sessionStatus = (dir?: string) => call<Record<string, SessionStatus>>(`/session/status${dirQuery(dir)}`)
/** All messages of a session with their parts — used to re-sync when live events were missed. */
export const sessionMessages = (sessionID: string, dir?: string) =>
  call<{ info: Record<string, any>; parts: Record<string, any>[] }[]>(`/session/${sessionID}/message${dirQuery(dir)}`)

/** Subscribe to the server's event stream (SSE) for one working folder. Returns an unsubscribe function. */
export function connectEvents(onEvent: (e: OcEvent) => void, onState?: (open: boolean) => void, dir?: string): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const es = new EventSource(baseUrl() + '/event' + dirQuery(dir))
  es.onopen = () => onState?.(true)
  es.onerror = () => onState?.(false)
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data) as OcEvent) } catch { /* heartbeat / non-JSON */ } }
  return () => es.close()
}
