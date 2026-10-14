// Two time readouts for a running answer: the elapsed time, and an estimated time remaining.
//
// A true countdown is impossible: the model's answer length is not known in advance. So "remaining" is an ESTIMATE,
// always shown with a leading "~". It starts from how long past answers took and, once text is streaming, refines
// itself from the live writing speed (tokens per second). When the answer runs well past the estimate we stop showing
// a number and just say it is still running — honest beats a fake ticking clock.

/** A finished answer, remembered per model to seed the next estimate. */
export interface AnswerSample {
  ms: number // how long it took
  tokens: number // how many output tokens it produced
}

export interface Timing {
  startedAt: number // epoch ms when the prompt was sent
  now: number // epoch ms now
  tokens: number // output tokens produced so far (0 before the first token and during hidden "thinking")
}

export const elapsedMs = (t: Pick<Timing, 'startedAt' | 'now'>): number => Math.max(0, t.now - t.startedAt)

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (v.length === 0) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Writing speed measured on the current answer; null until enough has happened to be meaningful. */
export function tokensPerSec(t: Timing): number | null {
  const s = elapsedMs(t) / 1000
  return s >= 0.3 && t.tokens > 2 ? t.tokens / s : null
}

/** Estimated TOTAL duration of the current answer in ms, or null if there is nothing to go on yet.
 *  May be smaller than the elapsed time once we have overrun the estimate. */
export function estimateTotalMs(t: Timing, history: AnswerSample[]): number | null {
  const rate = tokensPerSec(t)
  const medTokens = median(history.map((h) => h.tokens))
  const medDuration = median(history.map((h) => h.ms))
  if (rate && medTokens) return (medTokens / rate) * 1000 // time to reach a typical length at the current speed
  if (medDuration) return medDuration // before text flows: fall back to how long past answers took
  return null
}

/** Estimated time remaining in ms (can be negative = we have overrun the estimate), or null if not estimable. */
export function remainingMs(t: Timing, history: AnswerSample[]): number | null {
  const est = estimateTotalMs(t, history)
  return est == null ? null : est - elapsedMs(t)
}

/** 0..~1 share of the estimate used, for a progress bar; null if not estimable. Never quite reaches 1 while running. */
export function fraction(t: Timing, history: AnswerSample[]): number | null {
  const est = estimateTotalMs(t, history)
  if (!est || est <= 0) return null
  return Math.min(0.99, Math.max(0, elapsedMs(t) / est))
}

/** mm:ss, e.g. 5000 -> "0:05", 83000 -> "1:23". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The elapsed readout, e.g. "0:12". */
export const elapsedLabel = (t: Pick<Timing, 'startedAt' | 'now'>): string => clock(elapsedMs(t))

/** The remaining readout: "~0:05", or "läuft…" when overrun/near done, or "…" when there is nothing to estimate from. */
export function remainingLabel(t: Timing, history: AnswerSample[]): string {
  const r = remainingMs(t, history)
  if (r == null) return '…'
  if (r <= 500) return 'läuft…'
  return '~' + clock(r)
}
