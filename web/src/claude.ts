import { companionPost } from './companion'

// The two automatic Claude modes (paid API, only when Auto is on). The companion holds the key and makes the call.

// Prepended to a prompt when the Claude-Hilfe slider is above 0. The LOCAL model keeps the decision — it marks ONLY
// self-contained, harmless subtasks, so no project context or sensitive detail ever leaves the machine. The marker is
// described with a filled-in example (not the bare token pair) because the small local model otherwise just echoes the
// rule; a second gate (offloadAllowed) and a budget drop anything that still slips through.
export const OFFLOAD_PREFIX =
  'Hilfsregel: Für in sich geschlossene, UNBEDENKLICHE Teilaufgaben darfst du einen stärkeren Helfer nutzen. ' +
  'Eignet sich, was OHNE Projektgeheimnisse, echte Namen, Zugangsdaten oder sensiblen/heiklen Zusammenhang für sich ' +
  'allein lösbar ist (z. B. eine Standard-Hilfsfunktion, ein Algorithmus, eine Formel, ein Regex). So gibst du eine ' +
  'solche Aufgabe ab — schreibe sie vollständig und eigenständig zwischen zwei Markierungszeilen, etwa:\n' +
  '<<<CLAUDE\nSchreibe eine Python-Funktion is_leap_year(jahr) nach den gregorianischen Regeln, mit Docstring.\n>>>\n' +
  'Nur der Text zwischen den Markierungen wird abgegeben, sonst nichts. Sensibles, Heikles und alles, was den ' +
  'Projektzusammenhang braucht, löst du selbst. Nutze es sparsam und nur, wenn es wirklich Zeit spart.\n\n'

const AUDIT_SYSTEM =
  'Du bist ein strenger Senior-Reviewer. Das Folgende ist das Ergebnis eines schwächeren, lokalen Open-Source-Modells. ' +
  'Prüfe vor allem: (1) Funktioniert es wirklich / ist es lauffähig? (2) Konkrete Fehler oder Bugs. (3) Typische ' +
  'Schwächen kleiner Modelle: halbfertige Logik, erfundene/falsche Programmierschnittstellen, fehlende Randfälle, ' +
  'Behauptungen ohne ausgeführten Test. Antworte auf Deutsch, knapp, als nummerierte Punkte mit Schweregrad ' +
  '(kritisch / mittel / klein). Schließe mit EINEM Satz Gesamturteil: funktioniert / mit Mängeln / fehlerhaft.'

const OFFLOAD_SYSTEM =
  'Löse die folgende, in sich geschlossene Teilaufgabe vollständig und korrekt. Gib nur die fertige Lösung zurück ' +
  '(Code mit kurzen deutschen Kommentaren, falls es Code ist), ohne Rückfragen. Wenn die Aufgabe ohne zusätzlichen ' +
  'Zusammenhang nicht eindeutig lösbar ist, sage das in einem Satz, statt zu raten.'

// MIN floor (Claude-Hilfe): the local model did almost all the work, so Claude improves the finished answer once — the
// "geschickte Kommunikation über die Ergebnisse" the user asked for. It gets the request and the local answer and returns
// an improved version; if the answer is already good, it says so and adds only small refinements.
const IMPROVE_SYSTEM =
  'Du bist ein starker Senior-Entwickler. Unten steht die Anfrage eines Nutzers und die Antwort eines schwächeren, ' +
  'lokalen Modells darauf. Verbessere die Antwort: behebe konkrete Fehler, ergänze Fehlendes oder Randfälle, mache ' +
  'Code lauffähig und sauber. Ist die Antwort bereits gut, bestätige das in einem Satz und ergänze höchstens kleine ' +
  'Verbesserungen — erfinde nichts dazu. Antworte auf Deutsch und gib die VERBESSERTE Fassung zurück (bei Code den ' +
  'vollständigen, lauffähigen Code mit kurzen Kommentaren), ohne Rückfragen.'

export interface ClaudeReply { text: string; model: string; usage?: { input_tokens: number; output_tokens: number }; costUsd?: number; todayUsd?: number }

// capUsd: daily spending cap in USD (Einstellungen; 0 = none). The companion refuses the call once today's spend reached it.
export const claudeAudit = (content: string, model: string, capUsd = 0) =>
  companionPost<ClaudeReply>('/claude', { system: AUDIT_SYSTEM, prompt: content, model, capUsd })

export const claudeOffload = (task: string, model: string, capUsd = 0) =>
  companionPost<ClaudeReply>('/claude', { system: OFFLOAD_SYSTEM, prompt: task, model, capUsd, kind: 'offload' })

/** MIN floor: ask Claude to improve the finished local answer. Sends the request + the answer (like the audit, this is
 *  the whole result, so it is NOT an "offload" kind and reaches the normal key/cap check, not the offload-only gate). */
export const claudeImprove = (request: string, answer: string, model: string, capUsd = 0) => {
  const prompt = `ANFRAGE DES NUTZERS:\n${request || '(nicht verfügbar — verbessere die Antwort für sich)'}\n\nANTWORT DES LOKALEN MODELLS:\n${answer}`
  return companionPost<ClaudeReply>('/claude', { system: IMPROVE_SYSTEM, prompt, model, capUsd })
}

/** Keep the companion in sync with the "Claude-Hilfe" slider and the daily cap, so the MCP offload tool
 *  (companion/claude-mcp.mjs), which OpenCode calls without the browser, honours the same on/off and budget. */
export const setOffloadPrefs = (offloadShare: number, dailyUsd: number) =>
  companionPost('/offload-prefs', { offloadShare, dailyUsd })

/** Share of the work done locally vs by Claude, from output-token counts (the best available proxy). */
export function taskSplit(localOutTokens: number, claudeOutTokens: number): { localPct: number; claudePct: number } {
  const total = localOutTokens + claudeOutTokens || 1
  const localPct = Math.round((localOutTokens / total) * 100)
  return { localPct, claudePct: 100 - localPct }
}

/** The main window shows only the answer: replace each <<<CLAUDE … >>> handoff block with a short note (the task text
 *  itself is shown in the Gedankengang sidebar). A block still streaming in (no >>> yet) is cut off too. */
export function hideOffloadMarkers(text: string): string {
  const note = '↗ Teilaufgabe an Claude übergeben (Ergebnis folgt unten).'
  return text.replace(/<<<CLAUDE[\s\S]*?>>>/g, note).replace(/<<<CLAUDE[\s\S]*$/, note)
}

// The example task from OFFLOAD_PREFIX — if the model copies it verbatim, it is not a real offload and must be dropped.
const PREFIX_EXAMPLE = 'is_leap_year'

/** Pull out the <<<CLAUDE … >>> blocks the local model marked for offload, keeping only real tasks: the rule echo
 *  ("und", "…"), empty or too-short blocks, a copied example, and nested markers are dropped (F22). */
export function offloadTasks(text: string): string[] {
  const out: string[] = []
  const re = /<<<CLAUDE([\s\S]*?)>>>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const t = m[1].trim()
    if (t.length < 15) continue                 // "und", "...", empty — the model echoing the rule
    if (t.includes('<<<CLAUDE')) continue        // nested/garbled
    if (t.includes(PREFIX_EXAMPLE)) continue      // the example copied verbatim
    out.push(t)
  }
  return out
}

// A second, independent gate: even a block the local model marked "harmless" must not leave the PC if it looks
// sensitive or against Anthropic's usage policy. A heuristic backstop (false alarms only keep work local, which is
// safe); the primary protection is the local model marking only self-contained benign parts. Keep in sync with the
// companion's server-side check in server.mjs.
const OFFLOAD_SENSITIVE: RegExp[] = [
  /\b(sex|sexual|sexuell|porn|porno|nsfw|nackt|nude|naked|explicit|explizit|eroti|fetisch|xxx|onlyfans|deepnude|intim)\w*/i,
  /face[\s-]?swap|faceswap|gesichtstausch|deepfake/i,
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,                                   // e-mail address
  /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})/, // keys/tokens
  /\b(passwort|password|api[-_ ]?key|secret|token|zugangsdaten|kreditkart|credit[\s-]?card|iban)\w*/i,
  /\b(klarname|personenbezogen|privatadresse|echte[rn]? namen?)\b/i,
]

/** Whether a marked subtask may be sent to Claude. Blocks sensitive/policy-risky content and over-large blocks. */
export function offloadAllowed(task: string): { ok: boolean; reason?: string } {
  if (OFFLOAD_SENSITIVE.some((re) => re.test(task)))
    return { ok: false, reason: 'bleibt lokal: könnte Sensibles enthalten (z. B. explizite Inhalte, echte Namen oder Zugangsdaten).' }
  if (task.length > 4000)
    return { ok: false, reason: 'bleibt lokal: zu groß/zusammenhängend für eine eigenständige Teilaufgabe.' }
  return { ok: true }
}

/** Max additional Claude output tokens so Claude's share of the combined work stays at or below `share` (0..1).
 *  `localTokens`/`claudeTokens` = the whole task so far. Returns 0 when nothing more may be offloaded. */
export function offloadBudget(share: number, localTokens: number, claudeTokens: number): number {
  const s = Math.max(0, Math.min(0.9, share))
  if (s === 0) return 0
  const allowed = (s / (1 - s)) * localTokens // claude/(local+claude) ≤ s  ⇔  claude ≤ s/(1−s)·local
  return Math.max(0, Math.round(allowed - claudeTokens))
}

/** MIN floor: should Claude improve the finished answer? True when a minimum share is set and Claude's actual share of
 *  the work so far is still below it — typically because the local model marked little or nothing for offload. */
export function claudeShareBelow(minShare: number, localTokens: number, claudeTokens: number): boolean {
  if (minShare <= 0) return false
  const total = localTokens + claudeTokens
  if (total <= 0) return true // nothing measured yet → below the floor
  return claudeTokens / total < minShare - 0.001 // tiny epsilon so being exactly at the floor does not retrigger
}
