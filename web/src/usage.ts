// Token bookkeeping for one chat: how many tokens the local model generated vs how many Claude did (offload + audit).
// Pure and unit-tested. Shown live next to the "Automatisch über Claude …" line above the chat box.
//
// The split compares GENERATED tokens on both sides: local = answer + reasoning (from the server's per-message counts),
// Claude = API output_tokens (which also include any Claude thinking). Claude's input ("gelesen") is shown separately.
import { taskSplit } from './claude'
import { type Turn, produced } from './stream'

export interface ChatUsage {
  local: number           // tokens the local model generated in this chat
  localEstimated: boolean // true when some of `local` is a ~4-characters-per-token estimate (server sent no count)
  claudeIn: number        // tokens Claude read (input) in this chat
  claudeOut: number       // tokens Claude generated in this chat
  offloadOut: number      // … of which for offloaded subtasks
  auditOut: number        // … of which for the final audit
  offloads: number        // number of offloaded subtasks
}

export const emptyUsage = (): ChatUsage =>
  ({ local: 0, localEstimated: false, claudeIn: 0, claudeOut: 0, offloadOut: 0, auditOut: 0, offloads: 0 })

/** Tokens the local model generated in one turn: the server's exact count, else ~4 characters per token. */
export function turnTokens(t: Turn): { tokens: number; estimated: boolean } {
  if (t.usage && t.usage.output > 0) return { tokens: t.usage.output, estimated: false }
  const chars = produced(t)
  return { tokens: chars > 0 ? Math.max(1, Math.round(chars / 4)) : 0, estimated: chars > 0 }
}

/** Add a finished (or the still running) local turn. */
export function addLocal(u: ChatUsage, t: Turn): ChatUsage {
  const { tokens, estimated } = turnTokens(t)
  if (tokens === 0) return u
  return { ...u, local: u.local + tokens, localEstimated: u.localEstimated || estimated }
}

/** Add one Claude call (an offloaded subtask or the audit) with the usage the API reported. */
export function addClaude(u: ChatUsage, kind: 'offload' | 'audit', usage?: { input_tokens: number; output_tokens: number }): ChatUsage {
  const inT = usage?.input_tokens ?? 0
  const outT = usage?.output_tokens ?? 0
  return {
    ...u,
    claudeIn: u.claudeIn + inT,
    claudeOut: u.claudeOut + outT,
    offloadOut: u.offloadOut + (kind === 'offload' ? outT : 0),
    auditOut: u.auditOut + (kind === 'audit' ? outT : 0),
    offloads: u.offloads + (kind === 'offload' ? 1 : 0),
  }
}

/** Percent split of generated tokens; null while nothing has been generated yet. */
export function usageSplit(u: ChatUsage): { localPct: number; claudePct: number } | null {
  if (u.local + u.claudeOut === 0) return null
  return taskSplit(u.local, u.claudeOut)
}

/** German thousands separators, exact (no rounding to "k"): 12345 → "12.345". */
export const fmtExact = (n: number): string => Math.round(n).toLocaleString('de-DE')
