import { describe, expect, it } from 'vitest'
import {
  type AnswerSample, type Timing,
  clock, elapsedLabel, elapsedMs, estimateTotalMs, fraction, median, remainingLabel, remainingMs, tokensPerSec,
} from './eta'

const T0 = 1_000_000
const t = (over: Partial<Timing> = {}): Timing => ({ startedAt: T0, now: T0, tokens: 0, ...over })
const hist = (ms: number[], tokens: number[]): AnswerSample[] => ms.map((m, i) => ({ ms: m, tokens: tokens[i] }))

describe('clock / elapsed', () => {
  it('formats mm:ss', () => {
    expect([0, 5000, 83000, 600000].map(clock)).toEqual(['0:00', '0:05', '1:23', '10:00'])
  })
  it('elapsed never goes negative', () => {
    expect(elapsedMs({ startedAt: T0, now: T0 - 500 })).toBe(0)
    expect(elapsedLabel({ startedAt: T0, now: T0 + 12_000 })).toBe('0:12')
  })
})

describe('median', () => {
  it('odd, even, and empties', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(median([0, -1, NaN])).toBeNull() // only positive finite values count
  })
})

describe('tokensPerSec', () => {
  it('null until enough time and tokens, else the live rate', () => {
    expect(tokensPerSec(t({ now: T0 + 100, tokens: 50 }))).toBeNull() // too little time
    expect(tokensPerSec(t({ now: T0 + 1000, tokens: 2 }))).toBeNull() // too few tokens
    expect(tokensPerSec(t({ now: T0 + 2000, tokens: 40 }))).toBe(20) // 40 tokens / 2 s
  })
})

describe('estimateTotalMs', () => {
  const h = hist([10_000, 20_000, 30_000], [200, 400, 600]) // median 20 s, 400 tokens
  it('falls back to the median past duration before text flows', () => {
    expect(estimateTotalMs(t({ now: T0 + 1000, tokens: 0 }), h)).toBe(20_000)
  })
  it('uses the live rate once streaming: median length / current speed', () => {
    // 2 s elapsed, 40 tokens -> 20 tok/s; median length 400 -> 400/20 = 20 s total
    expect(estimateTotalMs(t({ now: T0 + 2000, tokens: 40 }), h)).toBe(20_000)
  })
  it('is null with no history and no live rate', () => {
    expect(estimateTotalMs(t({ now: T0 + 1000 }), [])).toBeNull()
  })
})

describe('remaining', () => {
  const h = hist([20_000], [400])
  it('remaining can be negative once overrun', () => {
    expect(remainingMs(t({ now: T0 + 5000 }), h)).toBe(15_000)
    expect(remainingMs(t({ now: T0 + 25_000 }), h)).toBe(-5000)
  })
  it('fraction is bounded and never completes while running', () => {
    expect(fraction(t({ now: T0 + 10_000 }), h)).toBeCloseTo(0.5, 5)
    expect(fraction(t({ now: T0 + 100_000 }), h)).toBe(0.99)
    expect(fraction(t(), [])).toBeNull()
  })
  it('label: "…" with no data, "~m:ss" normal, "läuft…" when overrun', () => {
    expect(remainingLabel(t({ now: T0 + 1000 }), [])).toBe('…')
    expect(remainingLabel(t({ now: T0 + 5000 }), h)).toBe('~0:15')
    expect(remainingLabel(t({ now: T0 + 25_000 }), h)).toBe('läuft…')
  })
})
