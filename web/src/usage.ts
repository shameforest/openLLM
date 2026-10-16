// Token bookkeeping: how many tokens the local model handled vs how many Claude did (offload + audit), per chat and in
// total. Pure and unit-tested. The chat counter sits next to the "Automatisch über Claude …" line; the totals are in
// Einstellungen → Übersicht.
//
// The split compares GENERATED tokens on both sides: local = answer + reasoning (from the server's per-message counts),
// Claude = API output_tokens (which also include any Claude thinking). "Read" tokens (input incl. cache) are kept
// separately; they matter for the savings: everything the local model read and wrote is work Claude did not do.
import { taskSplit } from './claude'
import { type Turn, produced } from './stream'

export interface ChatUsage {
  local: number           // tokens the local model generated
  localIn: number         // tokens the local model read (prompt, files, tool results, incl. cache hits)
  localEstimated: boolean // true when some local count is a ~4-characters-per-token estimate (server sent no count)
  claudeIn: number        // tokens Claude read (input)
  claudeOut: number       // tokens Claude generated
  offloadOut: number      // … of which for offloaded subtasks
  auditOut: number        // … of which for the final audit
  offloads: number        // number of offloaded subtasks
}

export const emptyUsage = (): ChatUsage =>
  ({ local: 0, localIn: 0, localEstimated: false, claudeIn: 0, claudeOut: 0, offloadOut: 0, auditOut: 0, offloads: 0 })

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
  return { ...u, local: u.local + tokens, localIn: u.localIn + (t.usage?.input ?? 0), localEstimated: u.localEstimated || estimated }
}

/** Add one Claude call (an offloaded subtask, the audit, or a MIN-floor improvement) with the usage the API reported.
 *  'improve' counts toward Claude's share (claudeIn/Out) but not toward the offload-subtask or audit sub-buckets. */
export function addClaude(u: ChatUsage, kind: 'offload' | 'audit' | 'improve', usage?: { input_tokens: number; output_tokens: number }): ChatUsage {
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

/** Sum the usage of many chats (fields missing in older saves count as 0). */
export function totalUsage(list: Partial<ChatUsage>[]): ChatUsage {
  const t = emptyUsage()
  for (const u of list) {
    t.local += u.local ?? 0
    t.localIn += u.localIn ?? 0
    t.localEstimated ||= !!u.localEstimated
    t.claudeIn += u.claudeIn ?? 0
    t.claudeOut += u.claudeOut ?? 0
    t.offloadOut += u.offloadOut ?? 0
    t.auditOut += u.auditOut ?? 0
    t.offloads += u.offloads ?? 0
  }
  return t
}

/** Claude tokens saved by running locally: everything the local model read and generated would otherwise have gone
 *  through Claude. An estimate — it assumes Claude would have needed about the same number of tokens. */
export const savedTokens = (u: ChatUsage): number => u.localIn + u.local

/** Percent split of generated tokens; null while nothing has been generated yet. */
export function usageSplit(u: ChatUsage): { localPct: number; claudePct: number } | null {
  if (u.local + u.claudeOut === 0) return null
  return taskSplit(u.local, u.claudeOut)
}

/** German thousands separators, exact (no rounding to "k"): 12345 → "12.345". */
export const fmtExact = (n: number): string => Math.round(n).toLocaleString('de-DE')
