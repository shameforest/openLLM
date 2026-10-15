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

// Never answered automatically — the user decides:
// - uploading or throwing work away (git push / reset --hard / clean / checkout -- / restore),
// - deleting, also through aliases (ri, erase, rd …) and system-changing tools; most are also denied in opencode.json,
// - "download and run" (… | iex, Invoke-Expression, curl … | sh) and interpreter one-liners (python -c, node -e,
//   powershell -Command, cmd /c): with these any other rule can be bypassed, e.g. python -c "shutil.rmtree(…)".
const RISKY = new RegExp([
  String.raw`\bgit\s+(-C\s+\S+\s+)?(push|reset\s+--hard|clean|checkout\s+--|restore)\b`,
  String.raw`(^|[\s;&|(])(rm|del|erase|ri|rd|rmdir|Remove-Item|Clear-Content|Clear-RecycleBin|format|Format-Volume|mkfs|diskpart|shutdown|Stop-Computer|Restart-Computer|takeown|icacls)(\s|$)`,
  String.raw`\breg(\.exe)?\s+(delete|add)\b|\bSet-ExecutionPolicy\b`,
  String.raw`\b(iex|Invoke-Expression)\b|\|\s*(sh|bash|pwsh|powershell)\b`,
  String.raw`\b(python3?|py)\s+-c\b|\bnode\s+(-e|-p|--eval|--print)\b|\b(powershell|pwsh)(\.exe)?\s+(-c\b|-Command\b|-EncodedCommand\b|-enc\b)|\bcmd(\.exe)?\s+/c\b`,
].join('|'), 'i')

/** Absolute paths in a command (C:\…, \\server\…, ~\…) that are NOT inside the working folder. */
export function pathsOutside(text: string, workdir: string): string[] {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const wd = workdir ? norm(workdir) : ''
  const found = text.match(/(?:[a-zA-Z]:[\\/]|\\\\|~[\\/])[^\s"'`;|&<>]*/g) ?? []
  return found.filter((p) => !wd || !(norm(p) === wd || norm(p).startsWith(wd + '\\')))
}

/** Message sent with an automatic "no" to a loop, so the model changes course instead of trying the same again. */
export const LOOP_HINT =
  'Du hast denselben Schritt dreimal wiederholt, ohne weiterzukommen. Wiederhole ihn nicht. Prüfe, woran es scheitert, ' +
  'versuche einen anderen Weg, oder schreibe kurz, was dich blockiert und was du als Nächstes vorschlägst.'

/** What the automatic mode does with a request: allow it once, turn a loop around, or leave it to the user (null).
 *  Work inside the working folder runs on its own; anything outside it, and anything on the risky list, asks. */
export function autoDecision(p: PermissionRequest, workdir = ''): { reply: 'once' } | { reply: 'reject'; message: string } | null {
  if (p.permission === 'doom_loop') return { reply: 'reject', message: LOOP_HINT }
  if (p.permission === 'external_directory') return null // outside the project folder: the user decides
  const text = `${str(p.metadata?.command)} ${(p.patterns ?? []).join(' ')}`
  if (RISKY.test(text)) return null
  if (p.permission === 'bash' && pathsOutside(text, workdir).length > 0) return null
  return { reply: 'once' }
}

/** Why a request was left to the user — shown on the card so it is clear it was not forgotten. */
export function whyAsked(p: PermissionRequest, workdir = ''): string {
  if (p.permission === 'external_directory') return 'Zugriff außerhalb des Arbeitsordners entscheidest du.'
  const text = `${str(p.metadata?.command)} ${(p.patterns ?? []).join(' ')}`
  if (RISKY.test(text)) return 'Hochladen, Löschen, Herunterladen-und-Ausführen und Programm-Einzeiler fragen immer nach.'
  if (p.permission === 'bash' && pathsOutside(text, workdir).length > 0) return 'Der Befehl greift auf einen Ort außerhalb des Arbeitsordners zu.'
  return ''
}
