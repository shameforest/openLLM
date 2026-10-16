import { describe, expect, it } from 'vitest'
import type { OcEvent } from './api'
import { emptyTurn, reduceEvent } from './stream'
import { addClaude, addLocal, emptyUsage, fmtExact, savedTokens, totalUsage, turnTokens, usageSplit } from './usage'

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
  it('counts prompt-cache hits as read tokens (measured: input 4 + cache.read 16373)', () => {
    const t = reduceEvent(emptyTurn(), ev('message.updated', { info: { id: 'm', role: 'assistant', tokens: { input: 4, output: 46, reasoning: 0, cache: { read: 16373, write: 0 } } } }))
    expect(t.usage).toEqual({ input: 16377, output: 46 })
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
    expect(u).toEqual({ local: 800, localIn: 10000, localEstimated: false, claudeIn: 2100, claudeOut: 200, offloadOut: 150, auditOut: 50, offloads: 1 })
    expect(usageSplit(u)).toEqual({ localPct: 80, claudePct: 20 })
    expect(savedTokens(u)).toBe(10800) // everything the local model read + wrote
  })
  it('counts a MIN-floor improvement toward Claude, but not as an offload or audit (OD-64)', () => {
    const u = addClaude(emptyUsage(), 'improve', { input_tokens: 400, output_tokens: 120 })
    expect([u.claudeIn, u.claudeOut, u.offloadOut, u.auditOut, u.offloads]).toEqual([400, 120, 0, 0, 0])
  })
  it('sums many chats, tolerating fields missing in older saves', () => {
    const a = addClaude(addLocal(emptyUsage(), { ...emptyTurn(), usage: { input: 1000, output: 300 } }), 'offload', { input_tokens: 50, output_tokens: 100 })
    const t = totalUsage([a, a, { local: 100 }])
    expect([t.local, t.localIn, t.claudeIn, t.claudeOut, t.offloads]).toEqual([700, 2000, 100, 200, 2])
    expect(usageSplit(t)).toEqual({ localPct: 78, claudePct: 22 })
    expect(totalUsage([])).toEqual(emptyUsage())
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
