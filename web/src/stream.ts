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
  usage: { input: number; output: number } | null
  error: string | null
}

export const emptyTurn = (): Turn => ({ text: '', reasoning: '', tools: [], done: false, usage: null, error: null })

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

export function reduceEvent(turn: Turn, e: OcEvent): Turn {
  const p = (e.properties ?? {}) as Record<string, any>
  switch (e.type) {
    case 'message.part.delta': {
      const delta = typeof p.delta === 'string' ? p.delta : ''
      if (p.field === 'text') return { ...turn, text: turn.text + delta }
      if (p.field === 'reasoning') return { ...turn, reasoning: turn.reasoning + delta }
      return turn
    }
    case 'message.part.updated': {
      const part = p.part
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
      const tok = p.info?.tokens
      if (!tok) return turn
      return { ...turn, usage: { input: num(tok.input), output: num(tok.output) + num(tok.reasoning) } }
    }
    case 'session.error':
      return { ...turn, done: true, error: typeof p.message === 'string' ? p.message : 'Fehler' }
    case 'session.idle':
      return { ...turn, done: true }
    case 'session.status':
      return p.status?.type === 'idle' ? { ...turn, done: true } : turn
    default:
      return turn
  }
}
