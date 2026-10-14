// The copy/paste bridge to Claude Code. There is NO automatic connection (no paid API, by the user's choice), so the
// app only PREPARES text: a clean, self-contained request to paste into Claude Code, and it takes Claude's answer back
// as a briefing for the local model. Only self-contained, benign sub-tasks belong here; sensitive work stays local and
// nothing about the wider task is included unless the user puts it in.

/** A standalone request for Claude Code — deliberately without the surrounding project context (privacy + it keeps the
 *  task benign and self-contained). The user decides what goes in. */
export function offloadBriefing(task: string): string {
  return [
    'Eigenständige Teilaufgabe — bitte nur genau diese erledigen. Antworte knapp mit dem Ergebnis (Code/Text), ohne Rückfragen zum größeren Zusammenhang:',
    '',
    task.trim(),
  ].join('\n')
}

/** Ask Claude Code to audit either the plan (at the start) or the finished code (at the end). */
export function auditBriefing(kind: 'plan' | 'code', content: string): string {
  const what =
    kind === 'plan'
      ? 'Prüfe diesen Plan / diese Vorgehensweise auf Lücken, Risiken und bessere Ansätze.'
      : 'Prüfe diesen Code auf Fehler, Risiken und einfache Verbesserungen.'
  return [
    `Audit-Anfrage. ${what} Gib eine kurze, nummerierte Liste konkreter Punkte zurück (wichtigste zuerst). Schreib den Code nicht komplett neu.`,
    '',
    '```',
    content.trim(),
    '```',
  ].join('\n')
}

/** Turn Claude Code's pasted answer into a prompt the local model acts on. */
export function applyBriefing(source: 'offload' | 'audit', answer: string): string {
  const head =
    source === 'audit'
      ? 'Hier ist ein Audit von einem stärkeren Modell. Setze die sinnvollen Punkte um, prüfe nach jeder Änderung mit den Tests, und lass weg, was nicht passt:'
      : 'Hier ist das Ergebnis einer ausgelagerten Teilaufgabe. Baue es passend ein und prüfe, dass alles zusammen funktioniert:'
  return `${head}\n\n${answer.trim()}`
}
