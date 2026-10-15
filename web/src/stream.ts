// Turns the OpenCode event stream into the state the UI shows: the assistant's text, its reasoning ("thinking"),
// the tool calls it makes, usage, and whether the turn has ended. Pure and unit-tested; the same reducer feeds both
// the real SSE stream and the offline demo. Event shapes verified against OpenCode v1.19.0.
import type { OcEvent } from './api'

export interface ToolCall { id: string; tool: string; status: 'pending' | 'running' | 'completed' | 'error'; title?: string }
export interface Turn {
  text: string
  reasoning: string
  tools: ToolCall[]
  done: boolean
  usage: { input: number; output: number } | null // summed over every assistant message (step) of the turn
  perMsg: Record<string, { input: number; output: number }> // latest count per message id, so updates never double-count
  kinds: Record<string, string> // part id → part type ("text" | "reasoning" | …), from message.part.updated
  segs: { id: string; text: string }[] // streamed text per part, in arrival order
  error: string | null
}

export const emptyTurn = (): Turn =>
  ({ text: '', reasoning: '', tools: [], done: false, usage: null, perMsg: {}, kinds: {}, segs: [], error: null })

/** Rebuild answer + reasoning from the per-part segments. Separate parts (e.g. text before and after a tool call)
 *  are joined with a blank line. */
function compose(turn: Turn): Turn {
  const of = (want: boolean) => turn.segs.filter((s) => (turn.kinds[s.id] === 'reasoning') === want).map((s) => s.text)
  return { ...turn, text: of(false).join('\n\n'), reasoning: of(true).join('\n\n') }
}

/** Characters produced so far — the unit the timers use for speed/estimate (we have the text even though live token
 *  counts are not streamed). */
export const produced = (t: Turn): number => t.text.length + t.reasoning.length

function num(x: unknown): number { return typeof x === 'number' ? x : 0 }

/** Separate a qwen-style <think>…</think> section from the final answer. Handles the streaming case where the
 *  closing tag has not arrived yet (everything after <think> is still thinking, the answer is empty). */
export function splitThinking(text: string): { thinking: string; answer: string } {
  const open = text.indexOf('<think>')
  if (open === -1) return { thinking: '', answer: text }
  const before = text.slice(0, open)
  const close = text.indexOf('</think>', open)
  if (close === -1) return { thinking: text.slice(open + 7), answer: before }
  return { thinking: text.slice(open + 7, close), answer: before + text.slice(close + 8) }
}

/** The readable reason of a session.error. OpenCode nests it (error.data.message); a model Ollama does not have yet
 *  gets a hint on how to download it. */
function errorText(p: Record<string, any>): string {
  const msg = [p.error?.data?.message, p.error?.message, p.message].find((x) => typeof x === 'string' && x.trim()) ?? 'Fehler'
  return /model .* not found/i.test(msg) ? `${msg} — das Modell ist noch nicht heruntergeladen: Einstellungen → Updates → „Modelle aktualisieren“.` : msg
}

export function reduceEvent(turn: Turn, e: OcEvent): Turn {
  const p = (e.properties ?? {}) as Record<string, any>
  switch (e.type) {
    case 'message.part.delta': {
      // Measured on OpenCode 1.19 + Ollama (2026-10-15): the thinking streams into a part of TYPE "reasoning", but its
      // deltas say field "text" (the part's own text property). So the part id, not the field, decides answer vs
      // thinking. A delta that arrives before its part's type is known counts as answer until the type arrives.
      const delta = typeof p.delta === 'string' ? p.delta : ''
      if (!delta || (p.field !== 'text' && p.field !== 'reasoning')) return turn
      const id = typeof p.partID === 'string' ? p.partID : `_${p.field}`
      const kinds = p.field === 'reasoning' && !turn.kinds[id] ? { ...turn.kinds, [id]: 'reasoning' } : turn.kinds
      const i = turn.segs.findIndex((s) => s.id === id)
      const segs = i >= 0 ? turn.segs.map((s, k) => (k === i ? { ...s, text: s.text + delta } : s)) : [...turn.segs, { id, text: delta }]
      return compose({ ...turn, kinds, segs })
    }
    case 'message.part.updated': {
      const part = p.part
      // Remember each part's type (only the type: the user's own prompt arrives as a text part too, but never as deltas).
      if (part && typeof part.id === 'string' && typeof part.type === 'string' && turn.kinds[part.id] !== part.type) {
        turn = compose({ ...turn, kinds: { ...turn.kinds, [part.id]: part.type } })
      }
      if (part?.type !== 'tool') return turn
      const st = part.state ?? {}
      const tc: ToolCall = {
        id: String(part.id ?? part.callID ?? part.tool),
        tool: String(part.tool ?? 'tool'),
        status: (st.status as ToolCall['status']) ?? 'running',
        title: typeof st.title === 'string' ? st.title : undefined,
      }
      const i = turn.tools.findIndex((t) => t.id === tc.id)
      const tools = i >= 0 ? turn.tools.map((t, idx) => (idx === i ? { ...t, ...tc } : t)) : [...turn.tools, tc]
      return { ...turn, tools }
    }
    case 'message.updated': {
      // A turn with tool calls spans several assistant messages, and each is updated repeatedly. Keep the latest
      // count per message and sum them, so the total is exact either way.
      const info = p.info
      const tok = info?.tokens
      if (!tok || info?.role === 'user') return turn
      // input = everything the model read, including prompt-cache hits (OpenCode reports those separately).
      const input = num(tok.input) + num(tok.cache?.read) + num(tok.cache?.write)
      const perMsg = { ...turn.perMsg, [String(info.id ?? 'msg')]: { input, output: num(tok.output) + num(tok.reasoning) } }
      const all = Object.values(perMsg)
      const usage = { input: all.reduce((s, x) => s + x.input, 0), output: all.reduce((s, x) => s + x.output, 0) }
      return { ...turn, perMsg, usage }
    }
    case 'session.error':
      return { ...turn, done: true, error: errorText(p) }
    case 'session.idle':
      return { ...turn, done: true }
    case 'session.status':
      return p.status?.type === 'idle' ? { ...turn, done: true } : turn
    default:
      return turn
  }
}
