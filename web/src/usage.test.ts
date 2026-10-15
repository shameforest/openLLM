import { describe, expect, it } from 'vitest'
import type { OcEvent } from './api'
import { emptyTurn, reduceEvent } from './stream'
import { addClaude, addLocal, emptyUsage, fmtExact, turnTokens, usageSplit } from './usage'

const ev = (type: string, properties: Record<string, unknown> = {}): OcEvent => ({ id: 'evt', type, properties })

describe('per-message usage in the stream', () => {
  it('sums several assistant messages (tool steps) and keeps only the latest count per message', () => {
    const t = [
      ev('message.updated', { info: { id: 'm1', role: 'assistant', tokens: { input: 100, output: 10, reasoning: 5 } } }),
      ev('message.updated', { info: { id: 'm1', role: 'assistant', tokens: { input: 100, output: 30, reasoning: 20 } } }),
      ev('message.updated', { info: { id: 'm2', role: 'assistant', tokens: { input: 300, output: 40, reasoning: 0 } } }),
      ev('message.updated', { info: { id: 'u1', role: 'user', tokens: { input: 999, output: 999, reasoning: 0 } } }),
    ].reduce(reduceEvent, emptyTurn())
    expect(t.usage).toEqual({ input: 400, output: 90 })
  })
})

describe('turnTokens', () => {
  it('uses the exact server count when present', () => {
    const t = { ...emptyTurn(), text: 'x'.repeat(400), usage: { input: 1, output: 123 } }
    expect(turnTokens(t)).toEqual({ tokens: 123, estimated: false })
  })
  it('estimates ~4 characters per token when the server sent none', () => {
    const t = { ...emptyTurn(), text: 'x'.repeat(300), reasoning: 'y'.repeat(100) }
    expect(turnTokens(t)).toEqual({ tokens: 100, estimated: true })
  })
  it('is zero for an empty turn', () => {
    expect(turnTokens(emptyTurn())).toEqual({ tokens: 0, estimated: false })
  })
})

describe('chat usage', () => {
  it('accumulates local turns and Claude calls, split by generated tokens', () => {
    let u = emptyUsage()
    u = addLocal(u, { ...emptyTurn(), usage: { input: 5000, output: 600 } })
    u = addLocal(u, { ...emptyTurn(), usage: { input: 5000, output: 200 } })
    u = addClaude(u, 'offload', { input_tokens: 900, output_tokens: 150 })
    u = addClaude(u, 'audit', { input_tokens: 1200, output_tokens: 50 })
    expect(u).toEqual({ local: 800, localEstimated: false, claudeIn: 2100, claudeOut: 200, offloadOut: 150, auditOut: 50, offloads: 1 })
    expect(usageSplit(u)).toEqual({ localPct: 80, claudePct: 20 })
  })
  it('remembers when part of the local count is an estimate', () => {
    const u = addLocal(emptyUsage(), { ...emptyTurn(), text: 'abcdefgh' })
    expect(u.localEstimated).toBe(true)
  })
  it('has no split before anything was generated, and a missing API usage counts as 0', () => {
    expect(usageSplit(emptyUsage())).toBeNull()
    expect(addClaude(emptyUsage(), 'offload').claudeOut).toBe(0)
  })
  it('formats exact numbers with German separators', () => {
    expect(fmtExact(12345)).toBe('12.345')
    expect(fmtExact(7)).toBe('7')
  })
})
