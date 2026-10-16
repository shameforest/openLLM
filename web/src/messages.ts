import type { FileDiff } from './api'
import { type ToolCall, splitThinking } from './stream'
import { offloadTasks } from './claude'
import type { Thought } from './ThinkingSidebar'
import ocConfig from '../../config/opencode.json'

export interface Msg {
  role: 'user' | 'assistant'; text: string; reasoning?: string; tools?: ToolCall[]; error?: string | null; kind?: 'claude'; pending?: boolean
  agent?: 'plan' | 'build' // which OpenCode agent answered (a "plan" answer gets the "Plan umsetzen" button)
  userMsg?: string | null   // OpenCode id of the turn's user message: key for its file changes and for undo
  changes?: FileDiff[] | null
  reverted?: boolean        // undone; OpenCode drops it for good with the next prompt
  stopped?: boolean         // the turn was cut short (Stopp, or a gap during it) — offer "Fortsetzen"
}

/** The model's context window (tokens it can see at once), from config/opencode.json. */
export const CONTEXT_LIMIT = (() => {
  const ms = (ocConfig as unknown as { provider: { ollama: { models: Record<string, { limit?: { context?: number } }> } } }).provider.ollama.models
  return Object.values(ms)[0]?.limit?.context ?? 65536
})()

/** Did this answer already change files? Then a plan in it was carried out (plan mode → "Yes, switch to build"). */
export const wroteFiles = (m: Msg) =>
  (m.changes?.length ?? 0) > 0 || (m.tools ?? []).some((t) => t.status === 'completed' && /^(edit|write|patch|multiedit|apply_patch)$/.test(t.tool))

/** One assistant message → its process entry for the sidebar (thinking, tool steps, subtasks handed to Claude). */
export function toThought(key: string, prompt: string, m: Msg, live: boolean): Thought {
  const split = splitThinking(m.text)
  const thinking = [m.reasoning || '', split.thinking].filter((x) => x.trim()).join('\n')
  return { key, prompt, thinking, tools: m.tools ?? [], offloads: offloadTasks(split.answer), live }
}
