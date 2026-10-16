import { describe, expect, it } from 'vitest'
import type { OcEvent } from './api'
import { emptyTurn, eventSession, lastTurn, produced, reduceEvent, turnFromMessages, type Turn } from './stream'

const ev = (type: string, properties: Record<string, unknown> = {}): OcEvent => ({ id: 'evt', type, properties })
const run = (events: OcEvent[], start: Turn = emptyTurn()): Turn => events.reduce(reduceEvent, start)

describe('reduceEvent', () => {
  it('accumulates text and reasoning deltas separately', () => {
    const t = run([
      ev('message.part.delta', { field: 'reasoning', delta: 'denke… ' }),
      ev('message.part.delta', { field: 'text', delta: 'Hal' }),
      ev('message.part.delta', { field: 'text', delta: 'lo' }),
    ])
    expect([t.text, t.reasoning]).toEqual(['Hallo', 'denke… '])
    expect(produced(t)).toBe(5 + 7)
  })

  it('tracks a tool call from running to completed by id', () => {
    const t = run([
      ev('message.part.updated', { part: { id: 'prt_1', type: 'tool', tool: 'write', state: { status: 'running' } } }),
      ev('message.part.updated', { part: { id: 'prt_1', type: 'tool', tool: 'write', state: { status: 'completed', title: 'hallo.txt' } } }),
    ])
    expect(t.tools).toEqual([{ id: 'prt_1', tool: 'write', status: 'completed', title: 'hallo.txt' }])
  })

  it('adds a second distinct tool rather than overwriting', () => {
    const t = run([
      ev('message.part.updated', { part: { id: 'a', type: 'tool', tool: 'read', state: { status: 'running' } } }),
      ev('message.part.updated', { part: { id: 'b', type: 'tool', tool: 'bash', state: { status: 'running' } } }),
    ])
    expect(t.tools.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('captures usage (reasoning folded into output) and ignores non-tool part updates', () => {
    const t = run([
      ev('message.part.updated', { part: { type: 'text', text: 'done' } }),
      ev('message.updated', { info: { tokens: { input: 100, output: 40, reasoning: 5 } } }),
    ])
    expect(t.usage).toEqual({ input: 100, output: 45 })
  })

  it('routes a reasoning PART to the thinking even though its deltas say field "text" (measured OpenCode 1.19 + Ollama)', () => {
    const t = run([
      ev('message.part.updated', { part: { id: 'u', type: 'text', text: 'Was ist 2+2?' } }), // the user's prompt part
      ev('message.part.updated', { part: { id: 'r', type: 'reasoning', text: '' } }),
      ev('message.part.delta', { partID: 'r', field: 'text', delta: 'The user asks ' }),
      ev('message.part.delta', { partID: 'r', field: 'text', delta: 'for 2+2.' }),
      ev('message.part.updated', { part: { id: 'a', type: 'text', text: '' } }),
      ev('message.part.delta', { partID: 'a', field: 'text', delta: '2+2 ist 4.' }),
    ])
    expect([t.text, t.reasoning]).toEqual(['2+2 ist 4.', 'The user asks for 2+2.'])
  })

  it('moves early deltas to the thinking once the part type arrives late', () => {
    const t = run([
      ev('message.part.delta', { partID: 'r', field: 'text', delta: 'denke' }),
      ev('message.part.updated', { part: { id: 'r', type: 'reasoning' } }),
    ])
    expect([t.text, t.reasoning]).toEqual(['', 'denke'])
  })

  it('keeps text before and after a tool call as separate paragraphs', () => {
    const t = run([
      ev('message.part.delta', { partID: 'a1', field: 'text', delta: 'Ich lege die Datei an.' }),
      ev('message.part.delta', { partID: 'a2', field: 'text', delta: 'Fertig.' }),
    ])
    expect(t.text).toBe('Ich lege die Datei an.\n\nFertig.')
  })

  it('shows the server retrying after a model error, and clears it when it works again (OD-14)', () => {
    const t = run([ev('session.status', { status: { type: 'retry', attempt: 4, message: 'model not found', next: 1792061357521 } })])
    expect(t.retry).toEqual({ attempt: 4, message: 'model not found', next: 1792061357521 })
    expect(t.done).toBe(false)
    expect(reduceEvent(t, ev('session.status', { status: { type: 'busy' } })).retry).toBeNull()
  })

  it('remembers the user message id of the turn (needed to undo it)', () => {
    const t = run([
      ev('message.updated', { info: { id: 'msg_user1', role: 'user' } }),
      ev('message.updated', { info: { id: 'msg_a1', role: 'assistant', tokens: { input: 5, output: 1 } } }),
    ])
    expect(t.userMsg).toBe('msg_user1')
    expect(t.usage).toEqual({ input: 5, output: 1 }) // the user message adds no tokens
  })

  it('keeps the first user message for undo and notices plan mode switching to build (found in the real test)', () => {
    const t = run([
      ev('message.updated', { info: { id: 'msg_u1', role: 'user' } }),
      ev('message.updated', { info: { id: 'msg_a1', role: 'assistant', agent: 'plan', tokens: { input: 5, output: 1 } } }),
      ev('message.updated', { info: { id: 'msg_u1', role: 'user' } }), // updated again: no duplicate
      ev('message.updated', { info: { id: 'msg_u2', role: 'user' } }), // "switch to build agent"
      ev('message.updated', { info: { id: 'msg_a2', role: 'assistant', agent: 'build' } }),
    ])
    expect(t.userMsg).toBe('msg_u1')
    expect(t.userMsgs).toEqual(['msg_u1', 'msg_u2'])
    expect(t.agent).toBe('build')
  })

  it('marks done on session.idle and on session.status idle', () => {
    expect(run([ev('session.idle')]).done).toBe(true)
    expect(run([ev('session.status', { status: { type: 'busy' } })]).done).toBe(false)
    expect(run([ev('session.status', { status: { type: 'idle' } })]).done).toBe(true)
  })

  it('session.error ends the turn and records the message', () => {
    const t = run([ev('session.error', { message: 'model not loaded' })])
    expect([t.done, t.error]).toEqual([true, 'model not loaded'])
  })

  it('reads the nested OpenCode error and hints at downloading a missing model', () => {
    const t = run([ev('session.error', { error: { name: 'APIError', data: { message: "model 'x/y:q4' not found", statusCode: 404 } } })])
    expect(t.error).toMatch(/^model 'x\/y:q4' not found — .*Modelle aktualisieren/)
  })

  it('a full turn: deltas + tool + idle', () => {
    const t = run([
      ev('message.part.delta', { field: 'text', delta: 'Ich lege die Datei an. ' }),
      ev('message.part.updated', { part: { id: 't1', type: 'tool', tool: 'write', state: { status: 'running' } } }),
      ev('message.part.updated', { part: { id: 't1', type: 'tool', tool: 'write', state: { status: 'completed' } } }),
      ev('message.part.delta', { field: 'text', delta: 'Fertig.' }),
      ev('message.updated', { info: { tokens: { input: 50, output: 20, reasoning: 0 } } }),
      ev('session.idle'),
    ])
    expect(t.text).toBe('Ich lege die Datei an. Fertig.')
    expect(t.tools).toEqual([{ id: 't1', tool: 'write', status: 'completed', title: undefined }])
    expect(t.usage).toEqual({ input: 50, output: 20 })
    expect(t.done).toBe(true)
  })
})

describe('re-reading a turn after the live stream had a gap (AN-05)', () => {
  const msgs = [
    { info: { id: 'msg_old', role: 'user', time: { created: 1000 } }, parts: [{ id: 'p0', type: 'text', text: 'alte Frage' }] },
    { info: { id: 'msg_a0', role: 'assistant', time: { created: 1100 }, tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [{ id: 'p1', type: 'text', text: 'alte Antwort' }] },
    { info: { id: 'msg_u1', role: 'user', time: { created: 20_000 } }, parts: [{ id: 'p2', type: 'text', text: 'Lege rechner.py an' }] },
    { info: { id: 'msg_a1', role: 'assistant', agent: 'build', time: { created: 20_100 }, tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 900, write: 0 } } },
      parts: [{ id: 'r1', type: 'reasoning', text: 'Ich überlege.' }, { id: 't1', type: 'tool', tool: 'write', state: { status: 'completed', title: 'rechner.py' } }] },
    { info: { id: 'msg_a2', role: 'assistant', agent: 'build', time: { created: 25_000 }, tokens: { input: 1200, output: 30, reasoning: 0, cache: { read: 0, write: 0 } } },
      parts: [{ id: 'x1', type: 'step-start' }, { id: 'x2', type: 'text', text: 'Fertig: rechner.py angelegt.' }] },
  ]
  it('takes the turn from its own user message on: text, thinking, tools, tokens and agent', () => {
    const live = run([ev('message.updated', { info: { id: 'msg_u1', role: 'user' } }), ev('message.part.delta', { partID: 'r1', field: 'text', delta: 'Ich üb' })])
    const t = turnFromMessages(live, msgs, 19_000)
    expect(t.text).toBe('Fertig: rechner.py angelegt.')
    expect(t.reasoning).toBe('Ich überlege.')
    expect(t.tools).toEqual([{ id: 't1', tool: 'write', status: 'completed', title: 'rechner.py' }])
    expect(t.usage).toEqual({ input: 1000 + 1200, output: 50 })
    expect([t.userMsg, t.userMsgs, t.agent]).toEqual(['msg_u1', ['msg_u1'], 'build'])
  })
  it('finds the turn by time when its user message id never arrived, and keeps a real error', () => {
    const withErr = [...msgs.slice(0, 4), { info: { id: 'msg_a2', role: 'assistant', time: { created: 25_000 }, error: { name: 'APIError', data: { message: 'model crashed' } } }, parts: [] }]
    const t = turnFromMessages(emptyTurn(), withErr, 19_000)
    expect(t.userMsg).toBe('msg_u1')
    expect(t.error).toBe('model crashed')
    expect(turnFromMessages(emptyTurn(), msgs, 99_000)).toEqual(emptyTurn()) // nothing of this turn stored yet
  })
  it('ignores the error of a turn the user stopped', () => {
    const stopped = [...msgs.slice(0, 3), { info: { id: 'msg_a1', role: 'assistant', time: { created: 20_100 }, error: { name: 'MessageAbortedError' } }, parts: [{ id: 'q', type: 'text', text: 'halb' }] }]
    expect(turnFromMessages(emptyTurn(), stopped, 19_000).error).toBeNull()
  })
  it('tells which session an event belongs to (events of other sessions must not end this turn, AN-06)', () => {
    expect(eventSession(ev('session.idle', { sessionID: 'ses_a' }))).toBe('ses_a')
    expect(eventSession(ev('message.updated', { info: { sessionID: 'ses_b' } }))).toBe('ses_b')
    expect(eventSession(ev('message.part.updated', { part: { sessionID: 'ses_c' } }))).toBe('ses_c')
    expect(eventSession(ev('server.connected'))).toBe('')
  })
})

describe('lastTurn — recover the last turn after a close or shutdown (resume)', () => {
  const msgs = [
    { info: { id: 'u0', role: 'user', time: { created: 1000 } }, parts: [{ id: 'a', type: 'text', text: 'erste Frage' }] },
    { info: { id: 'a0', role: 'assistant', agent: 'build', time: { created: 1100 }, tokens: { input: 10, output: 3, reasoning: 0, cache: {} } }, parts: [{ id: 'b', type: 'text', text: 'erste Antwort' }] },
    { info: { id: 'u1', role: 'user', time: { created: 2000 } }, parts: [{ id: 'c', type: 'text', text: 'zweite Frage' }] },
    { info: { id: 'a1', role: 'assistant', agent: 'build', time: { created: 2100 }, tokens: { input: 40, output: 8, reasoning: 0, cache: { read: 100 } } },
      parts: [{ id: 'd', type: 'tool', tool: 'write', state: { status: 'completed', title: 'x.py' } }, { id: 'e', type: 'text', text: 'zweite Antwort, fertig' }] },
  ]
  it('rebuilds only the last turn (from the last user message), not the whole chat', () => {
    const t = lastTurn(msgs)
    expect(t.userMsg).toBe('u1')
    expect(t.text).toBe('zweite Antwort, fertig')
    expect(t.tools).toEqual([{ id: 'd', tool: 'write', status: 'completed', title: 'x.py' }])
    expect(t.usage).toEqual({ input: 140, output: 8 })
    expect(t.text).not.toContain('erste')
  })
  it('handles a turn that was interrupted before any answer (last message is the user prompt)', () => {
    const open = [...msgs, { info: { id: 'u2', role: 'user', time: { created: 3000 } }, parts: [{ id: 'f', type: 'text', text: 'dritte Frage' }] }]
    const t = lastTurn(open)
    expect(t.userMsg).toBe('u2')
    expect(t.text).toBe('')
    expect(t.tools).toEqual([])
  })
  it('returns an empty turn when the server has no messages', () => {
    expect(lastTurn([])).toEqual(emptyTurn())
  })
})
