// Live progress of a running agent turn, STEP BY STEP. An agent turn is several model calls ("steps"). Measured on
// OpenCode 1.19 + Ollama (2026-10-15): each step is its own assistant message — it begins when the server creates that
// message (the model then reads its input: "prefill"), the first output arrives together with a `step-start` part, the
// model thinks/writes and may call a tool (tool arguments are NOT streamed as text), and `step-finish` closes it.
// This module follows those events, learns how long steps take on this PC, and estimates when the current step is
// done and how long the whole task may still take. Pure (time is passed in) and unit-tested.
import type { OcEvent } from './api'
import { median } from './eta'

/** One finished step, remembered (localStorage) to estimate the next ones: time until the first output, and from
 *  there to the end of the step (thinking, writing, tool call and tool run). */
export interface StepSample { prefillMs: number; postMs: number }
/** One finished task (whole turn): how long it took and how many steps it had. */
export interface TaskSample { ms: number; steps: number }

export interface Progress {
  step: number                 // number of the current step (1-based)
  stepStart: number            // when the current step began
  firstDelta: number | null    // first streamed character of the current step
  chars: number                // characters streamed in the current step (for the speed readout)
  open: boolean                // a step is in progress (false between step-finish and the next step)
  kind: 'reasoning' | 'text' | null // what the last streamed piece was
  kinds: Record<string, string> // part id → part type
  msgs: Record<string, true>   // assistant message ids seen (one per step)
  seen: Record<string, true>   // step-finish part ids already handled
  done: StepSample[]           // steps finished in this turn
}

export const startProgress = (now: number): Progress =>
  ({ step: 1, stepStart: now, firstDelta: null, chars: 0, open: true, kind: null, kinds: {}, msgs: {}, seen: {}, done: [] })

/** Close the current step and remember how long it took. Does nothing if no step is open. */
export function finishStep(p: Progress, now: number): Progress {
  if (!p.open) return p
  const first = p.firstDelta ?? now
  return { ...p, open: false, done: [...p.done, { prefillMs: Math.max(0, first - p.stepStart), postMs: Math.max(1, now - first) }] }
}

function newStep(p: Progress, now: number): Progress {
  const closed = finishStep(p, now)
  return { ...closed, step: p.step + 1, stepStart: now, firstDelta: null, chars: 0, open: true, kind: null }
}

export function reduceProgress(p: Progress, e: OcEvent, now: number): Progress {
  const q = (e.properties ?? {}) as Record<string, any>
  if (e.type === 'message.updated') {
    const info = q.info
    if (info?.role !== 'assistant' || typeof info.id !== 'string' || p.msgs[info.id]) return p
    const msgs = { ...p.msgs, [info.id]: true as const }
    // The first assistant message belongs to the step that began when the prompt was sent.
    const fresh = Object.keys(p.msgs).length === 0 && p.open && p.chars === 0
    return fresh ? { ...p, msgs } : { ...newStep(p, now), msgs }
  }
  if (e.type === 'message.part.updated') {
    const part = q.part
    if (!part || typeof part.id !== 'string') return p
    if (p.kinds[part.id] !== part.type) p = { ...p, kinds: { ...p.kinds, [part.id]: String(part.type) } }
    if (part.type === 'step-finish' && !p.seen[part.id]) return finishStep({ ...p, seen: { ...p.seen, [part.id]: true } }, now)
    return p
  }
  if (e.type === 'message.part.delta') {
    const delta = typeof q.delta === 'string' ? q.delta : ''
    if (!delta) return p
    const base = p.open ? p : newStep(p, now) // output without a new message: treat as a new step
    const kind = q.field === 'reasoning' || base.kinds[q.partID] === 'reasoning' ? 'reasoning' : 'text'
    return { ...base, chars: base.chars + delta.length, firstDelta: base.firstDelta ?? now, kind }
  }
  return p
}

// ---- estimates ----

/** Used until this PC has finished a few steps (rough values for Qwen3.8 27B on the Shadow PC). */
export const PRIOR = { prefillMs: 8000, postMs: 20_000 }
const MIN_SAMPLES = 3
/** A prefill this long was a model load (18 GB into the graphics card), not normal reading: not learned from. */
const LOAD_MS = 30_000

/** The value below which `q` of the numbers lie (0..1), or null for no numbers. */
export function quantile(xs: number[], q: number): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (v.length === 0) return null
  return v[Math.min(v.length - 1, Math.floor(q * v.length))]
}

export interface StepEstimate {
  phase: 'prefill' | 'thinking' | 'writing' | 'between'
  remainingMs: number   // until the current step is done (at least 1 s while running)
  writeMs: number       // the part after the first output (shown as "danach ~…" while the first output is overdue)
  stepElapsedMs: number // since the current step began
  fraction: number      // 0..0.99 of the current step
  charsPerSec: number | null // live speed of the visible text, if measurable
  overrun: boolean      // longer than a typical step: the UI stops counting down and says so
  learned: boolean      // based on this PC's own history (else on PRIOR)
}

/** Countdown for the current step. "Typical" is the 75th percentile of this PC's past steps, so most steps finish
 *  within the countdown; the rest are announced as "länger als üblich" instead of a clock that runs backwards. */
export function estimateStep(p: Progress, samples: StepSample[], now: number): StepEstimate {
  const valid = samples.filter((s) => s && s.prefillMs >= 0 && s.postMs > 0)
  const prefills = valid.map((s) => s.prefillMs).filter((x) => x < LOAD_MS)
  const learned = valid.length >= MIN_SAMPLES
  const typPre = (prefills.length >= MIN_SAMPLES && quantile(prefills, 0.75)) || PRIOR.prefillMs
  const typPost = (learned && quantile(valid.map((s) => s.postMs), 0.75)) || PRIOR.postMs
  const elapsed = Math.max(0, now - p.stepStart)
  const base = { stepElapsedMs: elapsed, learned }

  if (!p.open) return { ...base, phase: 'between', remainingMs: 0, writeMs: 0, fraction: 0, charsPerSec: null, overrun: false }

  let remaining: number
  let writeMs: number
  let overrun = false
  if (p.firstDelta == null) {
    writeMs = typPost
    let pre = typPre - elapsed
    if (pre < 1000) { overrun = true; pre = 1000 } // first output overdue: hold, never count up
    remaining = pre + writeMs
  } else {
    remaining = typPost - (now - p.firstDelta)
    if (remaining < 1000) { overrun = true; remaining = 1000 }
    writeMs = remaining
  }
  const genFor = p.firstDelta != null ? now - p.firstDelta : 0
  const charsPerSec = genFor >= 2000 && p.chars >= 200 ? (p.chars / genFor) * 1000 : null
  const phase = p.firstDelta == null ? 'prefill' : p.kind === 'reasoning' ? 'thinking' : 'writing'
  return { ...base, phase, remainingMs: remaining, writeMs, fraction: Math.min(0.99, elapsed / (elapsed + remaining)), charsPerSec, overrun }
}

/** Whole task: "step N of typically M" and the time left, from this PC's past tasks. remainingMs is null when it cannot
 *  be estimated honestly (too few past tasks, or already past the typical number of steps). */
export function estimateTask(step: number, stepRemainingMs: number, tasks: TaskSample[]):
  { typicalSteps: number | null; remainingMs: number | null } {
  const withSteps = tasks.filter((t) => t && t.steps > 0 && t.ms > 0)
  if (withSteps.length < MIN_SAMPLES) return { typicalSteps: null, remainingMs: null }
  const typicalSteps = Math.max(1, Math.round(median(withSteps.map((t) => t.steps)) ?? 1))
  if (step > typicalSteps) return { typicalSteps, remainingMs: null }
  const perStep = median(withSteps.map((t) => t.ms / t.steps)) ?? 0
  return { typicalSteps, remainingMs: stepRemainingMs + (typicalSteps - step) * perStep }
}

/** Ease a displayed end time toward a new prediction (time constant ~2.5 s), so the countdown runs smoothly instead
 *  of jumping. A big change resets it. */
export function smoothEnd(prev: number | null, target: number, dtMs: number): number {
  if (prev == null || Math.abs(target - prev) > 60_000) return target
  const a = 1 - Math.exp(-Math.max(0, dtMs) / 2500)
  return prev + (target - prev) * a
}
