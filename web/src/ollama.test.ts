import { describe, expect, it } from 'vitest'
import { loadPct } from './ollama'

describe('loadPct', () => {
  it('is about half-way at half the estimate', () => {
    expect(loadPct(15_000, 30_000)).toBe(50)
  })
  it('never drops below 1 at the very start', () => {
    expect(loadPct(0, 30_000)).toBe(1)
  })
  it('caps at 99 before the load actually finishes', () => {
    expect(loadPct(60_000, 30_000)).toBe(99)
  })
  it('falls back to a 30 s estimate when none is given', () => {
    expect(loadPct(15_000, 0)).toBe(50)
  })
})
