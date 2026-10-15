// Spotting an agent that is going in circles (OD-23). OpenCode's own `doom_loop` only catches the exact same tool call
// three times in a row; small models also oscillate between two calls or keep hitting the same error. Pure and
// unit-tested; the app shows the reason and offers "Anders weitermachen" (stop + a redirect message).
import type { ToolCall } from './stream'

const sig = (t: ToolCall) => `${t.tool}|${t.title ?? ''}`

/** A short German reason when the recent tool calls look like a loop, else null. */
export function detectLoop(tools: ToolCall[]): string | null {
  const done = tools.filter((t) => t.status === 'completed' || t.status === 'error')
  // 1) The same call failing again and again.
  const last5 = done.slice(-5)
  const errs = new Map<string, number>()
  for (const t of last5) if (t.status === 'error') errs.set(sig(t), (errs.get(sig(t)) ?? 0) + 1)
  for (const [s, n] of errs) if (n >= 3) return `Derselbe Schritt ist ${n}-mal fehlgeschlagen (${s.split('|')[0]}).`
  // 2) Pendeln zwischen zwei Aufrufen: A B A B A B.
  const last6 = done.slice(-6).map(sig)
  if (last6.length === 6 && last6[0] !== last6[1] && last6.every((s, i) => s === last6[i % 2])) {
    return `Der Agent pendelt zwischen zwei Schritten (${last6[0].split('|')[0]} ↔ ${last6[1].split('|')[0]}).`
  }
  // 3) Der gleiche Aufruf viermal hintereinander (auch mit leicht anderem Inhalt, den doom_loop nicht erkennt).
  const last4 = done.slice(-4).map(sig)
  if (last4.length === 4 && last4.every((s) => s === last4[0]) && last4[0].split('|')[1]) {
    return `Der gleiche Schritt lief viermal hintereinander (${last4[0].split('|')[0]}).`
  }
  return null
}
