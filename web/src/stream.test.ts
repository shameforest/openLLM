import { describe, expect, it } from 'vitest'
import type { OcEvent } from './api'
import { emptyTurn, produced, reduceEvent, type Turn } from './stream'

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

  it('marks done on session.idle and on session.status idle', () => {
    expect(run([ev('session.idle')]).done).toBe(true)
    expect(run([ev('session.status', { status: { type: 'busy' } })]).done).toBe(false)
    expect(run([ev('session.status', { status: { type: 'idle' } })]).done).toBe(true)
  })

  it('session.error ends the turn and records the message', () => {
    const t = run([ev('session.error', { message: 'model not loaded' })])
    expect([t.done, t.error]).toEqual([true, 'model not loaded'])
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
