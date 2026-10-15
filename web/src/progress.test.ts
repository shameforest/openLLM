import { describe, expect, it } from 'vitest'
import type { OcEvent } from './api'
import { PRIOR, type Progress, type StepSample, estimateStep, estimateTask, finishStep, quantile, reduceProgress, smoothEnd, startProgress } from './progress'

const ev = (type: string, properties: Record<string, unknown> = {}): OcEvent => ({ id: 'e', type, properties })
const part = (id: string, type: string, extra: Record<string, unknown> = {}) => ev('message.part.updated', { part: { id, type, ...extra } })
const msg = (id: string, role = 'assistant') => ev('message.updated', { info: { id, role } })
const delta = (partID: string, text: string) => ev('message.part.delta', { partID, field: 'text', delta: text })
/** Feed [event, time] pairs. */
const feed = (pairs: [OcEvent, number][], p: Progress = startProgress(0)) => pairs.reduce((acc, [e, t]) => reduceProgress(acc, e, t), p)

describe('reduceProgress (event order measured on OpenCode 1.19 + Ollama, 2026-10-15)', () => {
  // The recorded two-step turn "create b.txt, then answer": the step boundary is the NEW assistant message;
  // step-start only arrives with the first output; the tool runs inside the step; step-finish closes it.
  const measured: [OcEvent, number][] = [
    [msg('u1', 'user'), 525], [part('pu', 'text'), 525],
    [msg('a1'), 543],
    [part('ss1', 'step-start'), 2117], [part('r1', 'reasoning'), 2117], [delta('r1', 'x'.repeat(120)), 2117],
    [part('t1', 'tool', { state: { status: 'running' } }), 7691], [part('t1', 'tool', { state: { status: 'completed' } }), 7699],
    [part('sf1', 'step-finish'), 7744], [msg('a1'), 7744],
    [msg('a2'), 7744],
    [part('ss2', 'step-start'), 8392], [part('r2', 'reasoning'), 8392], [delta('r2', 'hm'), 8392],
    [part('x2', 'text'), 9312], [delta('x2', 'erledigt'), 9312],
  ]

  it('splits the measured turn into two steps with the right timings', () => {
    const p = feed(measured)
    expect(p.step).toBe(2)
    expect(p.done).toEqual([{ prefillMs: 2117, postMs: 7744 - 2117 }]) // step 1 began at send (t=0)
    expect([p.stepStart, p.firstDelta, p.kind]).toEqual([7744, 8392, 'text'])
    const fin = finishStep(p, 9505)
    expect(fin.done[1]).toEqual({ prefillMs: 8392 - 7744, postMs: 9505 - 8392 })
  })
  it('finishStep is idempotent (a step is never learned twice)', () => {
    const p = finishStep(finishStep(startProgress(0), 100), 200)
    expect(p.done).toHaveLength(1)
  })
  it('repeated updates of the same message or step-finish change nothing', () => {
    const p = feed([[msg('a1'), 10], [delta('t', 'x'), 20], [msg('a2'), 30], [msg('a2'), 40], [part('f', 'step-finish'), 50], [part('f', 'step-finish'), 60]])
    expect([p.step, p.done.length, p.open]).toEqual([2, 2, false])
  })
  it('output after a step-finish without a new message starts a new step', () => {
    const p = feed([[delta('a', 'eins'), 10], [part('f', 'step-finish'), 20], [delta('b', 'zwei'), 500]])
    expect([p.step, p.chars, p.stepStart]).toEqual([2, 4, 500])
  })
  it('marks reasoning parts as thinking', () => {
    expect(feed([[part('r', 'reasoning'), 10], [delta('r', 'hm'), 20]]).kind).toBe('reasoning')
  })
})

describe('estimateStep', () => {
  const samples: StepSample[] = [
    { prefillMs: 2000, postMs: 8000 },
    { prefillMs: 3000, postMs: 10_000 },
    { prefillMs: 4000, postMs: 12_000 },
    { prefillMs: 90_000, postMs: 9000 }, // a model load: its prefill is not learned
  ] // 75th percentile: prefill 4 s (loads excluded), post 12 s

  it('gives a countdown right away, from priors, before anything was learned', () => {
    const e = estimateStep(startProgress(0), [], 1000)
    expect([e.learned, e.phase]).toEqual([false, 'prefill'])
    expect(e.remainingMs).toBe(PRIOR.prefillMs - 1000 + PRIOR.postMs)
    expect(e.fraction).toBeGreaterThan(0)
  })
  it('uses what this PC learned: rest of a typical prefill + typical rest of a step', () => {
    const e = estimateStep(startProgress(0), samples, 1000)
    expect(e.learned).toBe(true)
    expect(e.remainingMs).toBe(3000 + 12_000)
  })
  it('after the first output: counts down the typical rest of the step', () => {
    const p = feed([[delta('a', 'x'.repeat(300)), 4000], [delta('a', 'x'.repeat(300)), 7000]])
    const e = estimateStep(p, samples, 7000)
    expect([e.phase, e.remainingMs, e.overrun]).toEqual(['writing', 12_000 - 3000, false])
    expect(e.charsPerSec).toBe(200) // 600 chars in 3 s
  })
  it('a step longer than typical is flagged and holds at 1 s instead of running backwards', () => {
    const p = feed([[delta('a', 'x'), 1000]])
    const e = estimateStep(p, samples, 30_000)
    expect([e.overrun, e.remainingMs]).toEqual([true, 1000])
  })
  it('an overdue first output (e.g. model loading) holds at "1 s + rest" and never counts up', () => {
    const a = estimateStep(startProgress(0), samples, 40_000)
    const b = estimateStep(startProgress(0), samples, 70_000)
    expect(a.overrun).toBe(true)
    expect([a.remainingMs, b.remainingMs]).toEqual([1000 + 12_000, 1000 + 12_000])
    expect([a.writeMs, a.stepElapsedMs]).toEqual([12_000, 40_000])
  })
  it('between steps there is no step countdown', () => {
    expect(estimateStep(finishStep(startProgress(0), 10), samples, 5000).phase).toBe('between')
  })
  it('ignores malformed samples from older versions', () => {
    const e = estimateStep(startProgress(0), [{ chars: 5 } as unknown as StepSample, ...samples], 1000)
    expect(e.remainingMs).toBe(3000 + 12_000)
  })
})

describe('quantile', () => {
  it('75th percentile, robust to empties', () => {
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(4)
    expect(quantile([5], 0.75)).toBe(5)
    expect(quantile([], 0.75)).toBeNull()
  })
})

describe('estimateTask', () => {
  const tasks = [{ ms: 60_000, steps: 4 }, { ms: 100_000, steps: 5 }, { ms: 30_000, steps: 3 }] // typical 4 steps; 15/20/10 s per step → median 15 s
  it('needs a few past tasks first', () => {
    expect(estimateTask(1, 5000, tasks.slice(0, 2))).toEqual({ typicalSteps: null, remainingMs: null })
  })
  it('current step rest + remaining typical steps', () => {
    expect(estimateTask(2, 5000, tasks)).toEqual({ typicalSteps: 4, remainingMs: 5000 + 2 * 15_000 })
  })
  it('past the typical number of steps: honest "open"', () => {
    expect(estimateTask(6, 5000, tasks)).toEqual({ typicalSteps: 4, remainingMs: null })
  })
})

describe('smoothEnd', () => {
  it('eases toward the new prediction and resets on big jumps', () => {
    expect(smoothEnd(null, 10_000, 100)).toBe(10_000)
    const s = smoothEnd(10_000, 20_000, 2500)
    expect(s).toBeGreaterThan(10_000)
    expect(s).toBeLessThan(20_000)
    expect(smoothEnd(10_000, 200_000, 100)).toBe(200_000)
  })
})
