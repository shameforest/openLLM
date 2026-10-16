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
  retry: { attempt: number; message: string; next: number } | null // the server is retrying after a model error
  userMsg: string | null // OpenCode id of this turn's first user message (to undo the turn with POST …/revert)
  userMsgs: string[]     // all user messages of the turn (plan mode adds one when it switches to build)
  agent: string | null   // the agent of the latest answer: "plan", or "build" once plan mode switched over
}

export const emptyTurn = (): Turn =>
  ({ text: '', reasoning: '', tools: [], done: false, usage: null, perMsg: {}, kinds: {}, segs: [], error: null, retry: null, userMsg: null, userMsgs: [], agent: null })

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

/** The session an event belongs to (OpenCode puts it on the event, its `info` or its `part`); '' if it has none. */
export function eventSession(e: OcEvent): string {
  const p = (e.properties ?? {}) as Record<string, any>
  const sid = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID
  return typeof sid === 'string' ? sid : ''
}

export type StoredMessage = { info: Record<string, any>; parts: Record<string, any>[] }

/** Replay the stored messages from index `start` onward into `base`, through the same reducer as live events. */
function rebuildFrom(base: Turn, msgs: StoredMessage[], start: number): Turn {
  let t: Turn = { ...base, segs: [], kinds: {}, tools: [], perMsg: {}, usage: null }
  const ev = (type: string, properties: Record<string, unknown>): OcEvent => ({ id: 'sync', type, properties })
  for (const m of msgs.slice(start)) {
    t = reduceEvent(t, ev('message.updated', { info: m.info }))
    if (m.info?.role !== 'assistant') continue
    for (const part of m.parts ?? []) {
      t = reduceEvent(t, ev('message.part.updated', { part }))
      if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string' && part.text)
        t = reduceEvent(t, ev('message.part.delta', { partID: part.id, field: 'text', delta: part.text }))
    }
    const err = m.info?.error
    if (err && err.name !== 'MessageAbortedError' && !t.error) t = { ...t, error: errorText({ error: err }) }
  }
  return t
}

/** Rebuild the current turn from the messages the server stored (GET /session/{id}/message) — for when the live stream
 *  had a gap and events, possibly the end, were missed (AN-05). The turn = its first user message and everything after
 *  it; if that id never arrived, the first user message created since `since` (ms). Text and thinking come from the
 *  parts' final text; tools, tokens and agent go through the same reducer as live events. */
export function turnFromMessages(turn: Turn, msgs: StoredMessage[], since: number): Turn {
  let start = turn.userMsg ? msgs.findIndex((m) => m.info?.id === turn.userMsg) : -1
  if (start < 0) start = msgs.findIndex((m) => m.info?.role === 'user' && num(m.info?.time?.created) >= since - 5000)
  if (start < 0) return turn
  return rebuildFrom(turn, msgs, start)
}

/** Rebuild the LAST turn the server has (from its last user message on) — to recover a turn that finished, or is still
 *  running, while the window was closed (resume after a stop, a closed window, or a PC shutdown). */
export function lastTurn(msgs: StoredMessage[]): Turn {
  let start = -1
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].info?.role === 'user') { start = i; break }
  return start < 0 ? emptyTurn() : rebuildFrom(emptyTurn(), msgs, start)
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
      if (info?.role === 'user') {
        // Plan mode's "switch to build?" adds a second user message inside the same turn. Undo starts at the first;
        // the file changes are listed per user message, so all of them are kept.
        if (typeof info.id !== 'string' || turn.userMsgs.includes(info.id)) return turn
        return { ...turn, userMsg: turn.userMsg ?? info.id, userMsgs: [...turn.userMsgs, info.id] }
      }
      const agent = typeof info?.agent === 'string' && info.agent !== turn.agent ? info.agent : turn.agent
      const tok = info?.tokens
      if (!tok) return agent !== turn.agent ? { ...turn, agent } : turn
      // input = everything the model read, including prompt-cache hits (OpenCode reports those separately).
      const input = num(tok.input) + num(tok.cache?.read) + num(tok.cache?.write)
      const perMsg = { ...turn.perMsg, [String(info.id ?? 'msg')]: { input, output: num(tok.output) + num(tok.reasoning) } }
      const all = Object.values(perMsg)
      const usage = { input: all.reduce((s, x) => s + x.input, 0), output: all.reduce((s, x) => s + x.output, 0) }
      return { ...turn, perMsg, usage, agent }
    }
    case 'session.error':
      return { ...turn, done: true, error: errorText(p) }
    case 'session.idle':
      return { ...turn, done: true }
    case 'session.status': {
      // After a model error OpenCode retries by itself with growing pauses (measured: 4 tries in 17 s). Keep that
      // visible instead of showing "reading the task" while nothing is being read.
      const st = p.status ?? {}
      if (st.type === 'idle') return { ...turn, done: true, retry: null }
      if (st.type === 'retry') return { ...turn, retry: { attempt: num(st.attempt), message: typeof st.message === 'string' ? st.message : '', next: num(st.next) } }
      return turn.retry ? { ...turn, retry: null } : turn
    }
    default:
      return turn
  }
}
