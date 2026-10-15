import { companionPost } from './companion'

// The two automatic Claude modes (paid API, only when Auto is on). The companion holds the key and makes the call.

// Prepended to a prompt when "Mit Claude beschleunigen" + Automatic are on. The LOCAL model keeps the decision — it
// marks ONLY self-contained, harmless subtasks, so no project context or sensitive detail ever leaves the machine.
export const OFFLOAD_PREFIX =
  'Hilfsregel: Du darfst in sich geschlossene, UNBEDENKLICHE Teilaufgaben an einen stärkeren Helfer auslagern. ' +
  'Wenn ein Teil OHNE Projektgeheimnisse, echte Namen oder sensiblen Zusammenhang für sich allein lösbar ist ' +
  '(z. B. eine Standard-Hilfsfunktion, ein Algorithmus, eine Formel), umschließe NUR diese eigenständige ' +
  'Aufgabenbeschreibung mit <<<CLAUDE und >>> (jeweils auf eigener Zeile). Sensibles und Zusammenhängendes löst du ' +
  'selbst. Nutze das sparsam und nur, wenn es wirklich hilft.\n\n'

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

export interface ClaudeReply { text: string; model: string; usage?: { input_tokens: number; output_tokens: number } }

export const claudeAudit = (content: string, model: string) =>
  companionPost<ClaudeReply>('/claude', { system: AUDIT_SYSTEM, prompt: content, model })

export const claudeOffload = (task: string, model: string) =>
  companionPost<ClaudeReply>('/claude', { system: OFFLOAD_SYSTEM, prompt: task, model })

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

/** Pull out the <<<CLAUDE … >>> blocks the local model marked for offload. */
export function offloadTasks(text: string): string[] {
  const out: string[] = []
  const re = /<<<CLAUDE([\s\S]*?)>>>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) { const t = m[1].trim(); if (t) out.push(t) }
  return out
}
