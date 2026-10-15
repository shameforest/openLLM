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

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').replace(/\\\*$/, '').toLowerCase()
const inside = (p: string, dirs: string[]) => dirs.some((d) => d && (norm(p) === norm(d) || norm(p).startsWith(norm(d) + '\\')))

// An absolute path: quoted (may contain spaces, e.g. "C:\Program Files\…") or unquoted up to the next space or operator.
const START = String.raw`(?:[a-zA-Z]:[\\/]|\\\\|~[\\/])`
const PATH = new RegExp(`"(${START}[^"]*)"|'(${START}[^']*)'|(${START}[^\\s"'\`;|&<>]*)`, 'g')
// Starting an installed program (python.exe from Program Files, git, node …) is not access to files outside the
// project; found in the real test (& "C:\Program Files\Python312\python.exe" zahlen.py). Its arguments are still checked.
const PROGRAM = /\.(exe|cmd|bat|com)$/i
const PROGRAM_DIRS = /^(c:\\program files( \(x86\))?|c:\\windows|c:\\python\d*)\\|\\appdata\\local\\programs\\/

/** Absolute paths in a command (C:\…, \\server\…, ~\…) that are NOT inside the working folder or another safe folder
 *  (OpenCode's own data folder, where plan mode stores its plans). Installed programs are ignored. */
export function pathsOutside(text: string, workdir: string, safe: string[] = []): string[] {
  const found = [...text.matchAll(PATH)].map((m) => m[1] ?? m[2] ?? m[3])
  return found.filter((p) => !inside(p, [workdir, ...safe]) && !(PROGRAM.test(p) && PROGRAM_DIRS.test(norm(p))))
}

/** OpenCode's own data and state folders (from GET /path), e.g. …\.local\share\opencode\plans for plan mode. Its config
 *  folder is deliberately NOT included: there the agent could change its own permissions. */
export function openCodeSafeDirs(paths: { state?: string; home?: string } | null): string[] {
  if (!paths?.state) return []
  const data = paths.state.replace(/([\\/])state([\\/])opencode$/i, '$1share$2opencode')
  return data !== paths.state ? [paths.state, data] : [paths.state]
}

// OD-24: interpreter one-liners stay on the risky list, EXCEPT short checks that only import, compute and print
// (measured 2026-10-15: 3 of 7 Testlauf tasks stopped on such a one-liner although AGENTS.md said not to use them).
// Each part of a command chain is judged on its own (see splitCommand); inside a part nothing may follow the quoted
// code, and the code must not contain the quote character (that would end the string and append another command). Every write/delete/network/process/dynamic-code call and
// shell expansion ($( ), ${ }, backticks) makes it ask again. False alarms only cost a question.
const ONE_LINER = /^(?:(?:python3?|py)\s+-c|node\s+(?:-e|-p|--eval|--print))\s+(["'])([\s\S]*)\1$/i
const INTERPRETER = /^(?:(?:python3?|py)\s+-c|node\s+(?:-e|-p|--eval|--print))\b/i
const ONE_LINER_DANGER = new RegExp([
  String.raw`\bopen\s*\([^)]*['"][^'"]*[wax+]`, // open(…, 'w' / 'a' / 'x' / '+')
  String.raw`\.(write_text|write_bytes|write|unlink|rmdir|rename|touch|mkdir|chmod|symlink_to|hardlink_to)\s*\(`,
  String.raw`\b(remove|unlink|rmdir|removedirs|rename|renames|makedirs|mkdir|chmod|chown|truncate|system|popen|spawn\w*|exec[lv]\w*|kill|startfile|rmtree|move|copy\w*)\s*\(`,
  String.raw`\bos\.replace\s*\(|(pathlib|Path\s*\()[\s\S]*\.replace\s*\(`, // replacing files, not str.replace
  String.raw`\b(shutil|subprocess|socket|urllib|requests|http|ftplib|smtplib|ctypes|winreg|webbrowser|multiprocessing|asyncio|importlib|pickle|marshal|child_process|fs|net|https|dgram|worker_threads|vm)\b`,
  String.raw`\b(__import__|exec|eval|compile|globals|setattr|delattr|require|import|Function)\s*\(`,
  String.raw`\bprocess\.(exit|kill|binding|dlopen)\b`,
  String.raw`\$\(|\$\{|` + '`',
].join('|'), 'i')

/** Top-level parts of a command line, split at `;`, `&&`, `||` and line breaks outside quotes; a PowerShell
 *  `if ($?) { … }` wrapper is removed. null = unbalanced quotes (then nothing is auto-allowed). The model chains its
 *  checks (measured: `python x.py; python -c "print('check')"`), so each part is judged on its own. */
export function splitCommand(cmd: string): string[] | null {
  const parts: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (quote) { cur += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === ';' || ch === '\n' || ch === '\r') { parts.push(cur); cur = ''; continue }
    if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) { parts.push(cur); cur = ''; i++; continue }
    cur += ch
  }
  if (quote) return null
  parts.push(cur)
  return parts
    .map((p) => p.trim().replace(/^if\s*\(\s*\$\?\s*\)\s*\{\s*/i, '').replace(/^\}\s*/, '').replace(/\s*\}$/, '').trim())
    .filter(Boolean)
}

const oneLinerOk = (part: string): boolean => {
  const m = ONE_LINER.exec(part)
  if (!m) return false
  const [, quote, code] = m
  return code.trim().length > 0 && !code.includes(quote) && !ONE_LINER_DANGER.test(code)
}

/** A command with at least one interpreter one-liner, where every one-liner only imports, computes and prints and
 *  every other part is not on the risky list — runs on its own like any harmless command. */
export function harmlessOneLiner(command: string): boolean {
  const parts = splitCommand(command)
  if (!parts || !parts.some((p) => INTERPRETER.test(p))) return false
  return parts.every((p) => (INTERPRETER.test(p) ? oneLinerOk(p) : !RISKY.test(p)))
}

/** Message sent with an automatic "no" to a loop, so the model changes course instead of trying the same again. */
export const LOOP_HINT =
  'Du hast denselben Schritt dreimal wiederholt, ohne weiterzukommen. Wiederhole ihn nicht. Prüfe, woran es scheitert, ' +
  'versuche einen anderen Weg, oder schreibe kurz, was dich blockiert und was du als Nächstes vorschlägst.'

/** What the automatic mode does with a request: allow it once, turn a loop around, or leave it to the user (null).
 *  Work inside the working folder runs on its own; anything outside it, and anything on the risky list, asks. */
export function autoDecision(p: PermissionRequest, workdir = '', safe: string[] = []): { reply: 'once' } | { reply: 'reject'; message: string } | null {
  if (p.permission === 'doom_loop') return { reply: 'reject', message: LOOP_HINT }
  const text = `${str(p.metadata?.command)} ${(p.patterns ?? []).join(' ')}`
  if (p.permission === 'external_directory') {
    // Outside the project folder the user decides — except OpenCode's own data folder (plan mode stores plans there).
    const targets = [...(p.patterns ?? []), str(p.metadata?.filepath), str(p.metadata?.directory)].filter(Boolean)
    return targets.length > 0 && targets.every((t) => inside(t, safe)) ? { reply: 'once' } : null
  }
  if (p.permission === 'bash' && harmlessOneLiner(str(p.metadata?.command)) && pathsOutside(text, workdir, safe).length === 0) return { reply: 'once' }
  if (RISKY.test(text)) return null
  if (p.permission === 'bash' && pathsOutside(text, workdir, safe).length > 0) return null
  return { reply: 'once' }
}

/** Why a request was left to the user — shown on the card so it is clear it was not forgotten. */
export function whyAsked(p: PermissionRequest, workdir = '', safe: string[] = []): string {
  if (p.permission === 'external_directory') return 'Zugriff außerhalb des Arbeitsordners entscheidest du.'
  const text = `${str(p.metadata?.command)} ${(p.patterns ?? []).join(' ')}`
  if (RISKY.test(text)) return 'Hochladen, Löschen, Herunterladen-und-Ausführen und Programm-Einzeiler, die schreiben oder löschen, fragen immer nach.'
  if (p.permission === 'bash' && pathsOutside(text, workdir, safe).length > 0) return 'Der Befehl greift auf einen Ort außerhalb des Arbeitsordners zu.'
  return ''
}
