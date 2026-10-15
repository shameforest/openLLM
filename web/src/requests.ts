// What the agent is waiting on, in plain German, and what the "Befehle automatisch erlauben" mode answers by itself.
// Pure and unit-tested; the card that shows the requests is RequestCard.tsx.
import type { PermissionRequest } from './api'

const str = (x: unknown): string => (typeof x === 'string' ? x : '')

/** One permission request → a short title and the concrete thing (command, file, folder, address). */
export function describePermission(p: PermissionRequest): { title: string; detail: string } {
  const m = p.metadata ?? {}
  const pat = (p.patterns ?? []).join('  ')
  switch (p.permission) {
    case 'bash': return { title: 'möchte einen Befehl ausführen', detail: str(m.command) || pat }
    case 'edit': return { title: 'möchte eine Datei ändern', detail: str(m.filepath) || str(m.filePath) || pat }
    case 'external_directory': return { title: 'möchte auf einen Ordner außerhalb des Projekts zugreifen', detail: str(m.filepath) || str(m.directory) || pat }
    case 'doom_loop': return { title: 'hat dreimal genau denselben Schritt versucht (dreht sich vermutlich im Kreis)', detail: str(m.tool) || pat }
    case 'webfetch': return { title: 'möchte eine Webseite abrufen', detail: str(m.url) || pat }
    case 'websearch': return { title: 'möchte im Web suchen', detail: str(m.query) || pat }
    case 'task': return { title: 'möchte einen Hilfs-Agenten starten', detail: str(m.description) || pat }
    default: return { title: `möchte „${p.permission}“ verwenden`, detail: pat }
  }
}

// Never answered automatically: anything that uploads, throws work away or deletes (deletes are also denied in
// opencode.json, so they normally never get this far).
const RISKY = /\bgit\s+(-C\s+\S+\s+)?(push|reset\s+--hard|clean|checkout\s+--|restore)\b|\b(rm|del|rmdir|rd|Remove-Item|format|mkfs|shutdown|Stop-Computer|Restart-Computer)\b/i

/** Message sent with an automatic "no" to a loop, so the model changes course instead of trying the same again. */
export const LOOP_HINT =
  'Du hast denselben Schritt dreimal wiederholt, ohne weiterzukommen. Wiederhole ihn nicht. Prüfe, woran es scheitert, ' +
  'versuche einen anderen Weg, oder schreibe kurz, was dich blockiert und was du als Nächstes vorschlägst.'

/** What the automatic mode does with a request: allow it once, turn a loop around, or leave it to the user. */
export function autoDecision(p: PermissionRequest): { reply: 'once' } | { reply: 'reject'; message: string } | null {
  if (p.permission === 'doom_loop') return { reply: 'reject', message: LOOP_HINT }
  const text = `${str(p.metadata?.command)} ${(p.patterns ?? []).join(' ')}`
  if (RISKY.test(text)) return null
  return { reply: 'once' }
}
