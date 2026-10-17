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

// OD-63: a short German word for a permission kind, used where a stored grant is listed without its full detail.
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'bash': return 'Befehl'
    case 'edit': return 'Datei ändern'
    case 'external_directory': return 'Ordner außerhalb des Projekts'
    case 'webfetch': return 'Webseite abrufen'
    case 'websearch': return 'Websuche'
    case 'task': return 'Hilfs-Agent'
    default: return kind
  }
}

// OD-63: does this request match a pattern the user already chose "Immer erlauben" for (in the current folder)?
// We match on OpenCode's own `always` patterns, so the same command/file type is recognised exactly as OpenCode would.
export function matchesAlways(p: PermissionRequest, grants: { pat: string }[]): boolean {
  if (!p.always?.length || !grants.length) return false
  const set = new Set(grants.map((g) => g.pat))
  return p.always.some((pat) => set.has(pat))
}

// OD-71 "Voll-Automatik": the user chose to run a prompt to the very end with ZERO prompts, so GRANT every request. The
// one thing not granted blindly is a doom-loop — the agent is turned around with a hint instead of repeating forever, so
// the run can actually reach its end. (OpenCode's own `deny` rules — shutdown, format, mass-delete — still apply below us,
// so even full auto cannot run those.)
export function fullAutoDecision(p: PermissionRequest): { reply: 'once' } | { reply: 'reject'; message: string } {
  if (p.permission === 'doom_loop') return { reply: 'reject', message: LOOP_HINT }
  return { reply: 'once' }
}

// Never answered automatically — the user decides:
// - uploading or throwing work away (git push / reset --hard / clean / checkout -- / restore / branch -D / stash drop),
// - deleting, also through aliases (ri, erase, rd …) and system-changing tools; most are also denied in opencode.json,
// - downloading from the internet, "download and run" (… | iex, curl … | sh), publishing packages,
// - interpreter one-liners (python -c, node -e, powershell -Command, cmd /c): with these any other rule can be
//   bypassed, e.g. python -c "shutil.rmtree(…)" — except the harmless ones below (OD-24).
// The rules are checked against each part of the command in a canonical form (see `canonical`), so the way a program
// is written does not matter: `& "C:\…\python.exe" -B -c`, `git.exe --no-pager push`, `"rm" x` (AN-04).
const RISKY = new RegExp([
  String.raw`\bgit\s+(push\b|reset\s+--(hard|merge|keep)\b|clean\b|checkout\s+(--|\.)(\s|$)|checkout\b[^;|&]*\s--\s|restore\b(?!\s+--staged\b)|branch\s+(-[dDfM]|--delete|--force)\b|stash\s+(drop|clear)\b|filter-branch\b|update-ref\s+-d\b|reflog\s+(expire|delete)\b)`,
  String.raw`(^|[\s;&|(])(rm|del|erase|ri|rd|rmdir|Remove-Item|Clear-Content|Clear-RecycleBin|Format-Volume|mkfs|diskpart|shutdown|Stop-Computer|Restart-Computer|takeown|icacls|kill|spps|taskkill|Stop-Process|Stop-Service|Remove-ItemProperty|setx|netsh|schtasks|wmic|bcdedit|vssadmin|cipher)(\s|$)`,
  String.raw`(^|[;&|(]\s*)format\s`, // "format c:" — not "npm run format" / "dotnet format"
  String.raw`\brobocopy\b[^;|&]*\s\/(mir|purge|move?)\b|\bnet1?\s+(user|localgroup|share|stop|accounts)\b|\bsc\s+(create|delete|config|stop|failure)\s`,
  String.raw`(\.|::)Delete\s*\(`, // [IO.File]::Delete(…), $_.Delete()
  String.raw`\breg(\.exe)?\s+(delete|add|import|restore|load)\b|\bSet-ExecutionPolicy\b`,
  String.raw`\b(iex|Invoke-Expression)\b|\|\s*&?\s*(sh|bash|pwsh|powershell|cmd|python3?|py|node)\b`,
  String.raw`\b(npm|pnpm|yarn|cargo|uv)\s+publish\b|\bdotnet\s+nuget\s+push\b|\bfind\b[^;|&]*\s-(delete|exec|execdir|ok)\b`,
  // Start-Process python x.py is just running a script (measured in the Testlauf); a shell or inline code is not
  String.raw`\bStart-Process\b[^;|]*\b(powershell|pwsh|cmd)\b|\bStart-Process\b[^;|]*\b(python3?|py|node)\b[^;|]*["'\s](-c|-e|--eval)\b|-Verb\s+RunAs\b`,
  String.raw`(^|[\s;&|(])(python3?|py)\s+-c\b|(^|[\s;&|(])node\s+(-e|-p|--eval|--print)\b|(^|[\s;&|(])(powershell|pwsh)\s+-Command\b|(^|[\s;&|(])cmd\s+\/c\b`,
].join('|'), 'i')
// Downloading: only to a non-local address (curl http://localhost:3000 tests the agent's own server).
const DOWNLOADER = /\b(curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|Start-BitsTransfer|bitsadmin|certutil)\b/i
const REMOTE_URL = /\b(https?|ftp):\/\/(?!(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/i

// ---- canonical form of one command part ----
const tokens = (s: string): string[] => s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
/** The bare program name, however it is written: & "C:\…\Python312\python.exe" → python, git.exe → git, "rm" → rm. */
const progName = (tok: string) => (tok.replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase()
const PS_VALUE_FLAGS = /^-(ExecutionPolicy|ep|ex|WindowStyle|w|Version|v|OutputFormat|o|of|InputFormat|if|inp|ConfigurationName|config|WorkingDirectory|wd|PSConsoleFile|SettingsFile)$/i

/** A command part rewritten so the rules see what actually runs: the call operator `&` and a program's folder and
 *  `.exe` are dropped, and options that may stand before the interesting one are skipped:
 *  `& "C:\Program Files\Python312\python.exe" -B -c "…"` → `python -c "…"`, `git --no-pager -C x push` → `git push`,
 *  `powershell -NoProfile -EncodedCommand …` / `powershell "Remove-Item x"` → `powershell -Command`, `cmd /d /c` → `cmd /c`. */
export function canonical(part: string): string {
  const t = tokens(part.trim())
  while (t[0] === '&' || t[0] === '.') t.shift()
  if (!t.length) return ''
  const name = progName(t[0])
  const rest = t.slice(1)
  if (name === 'python' || name === 'python3' || name === 'py') {
    while (rest.length && rest[0].startsWith('-') && rest[0] !== '-c' && rest[0] !== '-m' && rest[0] !== '-') {
      if (/^-[a-zA-Z]+c$/.test(rest[0]) && !/^-[XW]/.test(rest[0])) { rest[0] = '-c'; break } // -Bc "…" = -B -c "…"
      rest.splice(0, /^-[XW]$/.test(rest[0]) ? 2 : 1)
    }
    if (rest[0] === '-') rest[0] = '-c' // `… | python -` runs code from the pipe
  } else if (name === 'node') {
    while (rest.length && rest[0].startsWith('-') && !/^(-e|-p|--eval|--print)$/.test(rest[0])) {
      if (/^-(pe|ep)$/.test(rest[0])) { rest[0] = '-e'; break }
      rest.splice(0, /^(-r|--require|--import|--loader|--experimental-loader)$/.test(rest[0]) ? 2 : 1)
    }
  } else if (name === 'powershell' || name === 'pwsh') {
    let i = 0, runsCode = false, file = false
    while (i < rest.length) {
      const a = rest[i]
      if (/^-(c|command|e|ec|enc|encodedcommand|cwa|commandwithargs)$/i.test(a)) { runsCode = true; break }
      if (/^-(f|file)$/i.test(a)) { file = true; break }
      if (!a.startsWith('-') || a === '-') { runsCode = true; break } // a bare argument is a command; "-" = code from the pipe
      i += PS_VALUE_FLAGS.test(a) ? 2 : 1
    }
    return runsCode ? `${name} -Command ${rest.slice(i + 1).join(' ')}`.trim() : file ? `${name} -File ${rest.slice(i + 1).join(' ')}`.trim() : name
  } else if (name === 'cmd') {
    if (rest.some((a) => /^\/[ck]$/i.test(a))) return `cmd /c ${rest.filter((a) => !/^\/\w$/.test(a)).join(' ')}`.trim()
  } else if (name === 'git') {
    while (rest.length && rest[0].startsWith('-')) {
      rest.splice(0, /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/.test(rest[0]) ? 2 : 1)
    }
  }
  return [name, ...rest].join(' ')
}

/** The parts of a command for the rules: split at ; && || | and line breaks outside quotes, each in canonical form. */
function canonicalParts(cmd: string): string[] {
  return (splitCommand(cmd) ?? [cmd]).flatMap((p) => splitPipes(p)).map(canonical).filter(Boolean)
}
const splitPipes = (s: string): string[] => {
  const out: string[] = []
  let cur = '', quote: string | null = null
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '|') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

const riskyPart = (p: string) => RISKY.test(p) || (DOWNLOADER.test(p) && REMOTE_URL.test(p))
/** Risky in any form: the raw text (catches operators across parts) or any canonical part. */
export function risky(text: string): boolean {
  return riskyPart(text) || canonicalParts(text).some(riskyPart)
}

// ---- paths ----
const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').replace(/\\\*$/, '').toLowerCase()
/** Resolve `.` and `..` segments, so C:\work\demo\..\..\x is judged as C:\x (AN-04). */
const resolveDots = (p: string): string => {
  const s = p.replace(/\//g, '\\')
  const lead = /^(\\\\|[a-zA-Z]:\\|~\\)?/.exec(s)![0]
  const out: string[] = []
  for (const seg of s.slice(lead.length).split('\\')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return lead + out.join('\\')
}
// A drive root (or nothing) as working folder must not make every path "inside".
const usable = (d: string) => !!d && !/^[a-z]:$/.test(norm(d))
const inside = (p: string, dirs: string[]) => {
  const n = norm(resolveDots(p))
  return dirs.filter(usable).some((d) => n === norm(d) || n.startsWith(norm(d) + '\\'))
}

// An absolute path: quoted (may contain spaces, e.g. "C:\Program Files\…") or unquoted up to the next space or operator.
// The drive letter must not follow a letter, so "https://…" is not read as the path "s:/…".
const START = String.raw`(?:(?<![A-Za-z0-9])[a-zA-Z]:[\\/]|\\\\|~[\\/])`
const PATH = new RegExp(`"(${START}[^"]*)"|'(${START}[^']*)'|(${START}[^\\s"'\`;|&<>]*)`, 'g')
// A relative path that climbs out: `..`, `..\x`, `.\..\x`; resolved against the working folder.
const REL = /(?:^|[\s"'=(,])((?:\.[\\/])*\.\.(?:[\\/][^\s"'`;|&<>]*)?)(?=$|[\s"'`;|&<>),])/g
// A path built from a variable ($env:USERPROFILE\…, $HOME\…, %APPDATA%\…) or a change into such a folder: its real
// target is unknown here, so it counts as outside.
const VAR_PATH = /(\$env:\w+|\$HOME\b|%\w+%)[\\/][^\s"'`;|&<>]*|\b(?:cd|Set-Location|sl|pushd|chdir)\s+(~|\$HOME|\$env:\w+|%\w+%)(?=$|[\s;"'])/gi
// Starting an installed program (python.exe from Program Files, git, node …) is not access to files outside the
// project; found in the real test (& "C:\Program Files\Python312\python.exe" zahlen.py). Its arguments are still checked.
const PROGRAM = /\.(exe|cmd|bat|com)$/i
const PROGRAM_DIRS = /^(c:\\program files( \(x86\))?|c:\\windows|c:\\python\d*)\\|\\appdata\\local\\programs\\/

const CD = /^(?:cd|Set-Location|sl|pushd|chdir)(?:\s+-(?:Path|LiteralPath))?\s+(["']?)([^"';|&]+?)\1\s*$/i

/** Relative paths that climb above the working folder, read part by part like the shell does: `cd src; type ..\a.txt`
 *  stays inside, `cd ..; dir` does not. After a change into a folder named by a variable ($orig) the position is
 *  unknown, and the parts after it are not judged (measured in the Testlauf: Set-Location $orig; … Set-Location ..\..). */
function climbsOut(text: string, workdir: string, safe: string[]): string[] {
  const dirs = [workdir, ...safe]
  const found: string[] = []
  let cwd = workdir
  let known = usable(workdir)
  for (const part of splitCommand(text) ?? [text]) {
    const cd = CD.exec(part.trim())
    if (cd) {
      const t = cd[2].trim()
      if (/^[a-zA-Z]:[\\/]|^\\\\/.test(t)) { cwd = t; known = true } // absolute: judged by PATH
      else if (/[$%~]/.test(t)) known = false // variable or home: VAR_PATH judges the target itself
      else if (known) { cwd = resolveDots(`${cwd}\\${t}`); if (!inside(cwd, dirs)) found.push(t) }
      continue
    }
    if (!usable(workdir)) { found.push(...[...part.matchAll(REL)].map((m) => m[1])); continue }
    if (!known) continue
    for (const m of part.matchAll(REL)) if (!inside(`${cwd}\\${m[1]}`, dirs)) found.push(m[1])
  }
  return found
}

/** Paths in a command that are NOT inside the working folder or another safe folder (OpenCode's plans and tool-output
 *  folders): absolute ones (C:\…, \\server\…, ~\…) after resolving `..`, relative ones that climb above the working
 *  folder, and variable-based ones. Installed programs are ignored. */
export function pathsOutside(text: string, workdir: string, safe: string[] = []): string[] {
  const abs = [...text.matchAll(PATH)].map((m) => m[1] ?? m[2] ?? m[3])
    .filter((p) => !inside(p, [workdir, ...safe]) && !(PROGRAM.test(p) && PROGRAM_DIRS.test(norm(p))))
  const vars = [...text.matchAll(VAR_PATH)].map((m) => m[0])
  return [...abs, ...climbsOut(text, workdir, safe), ...vars]
}

/** OpenCode's own folders the agent may use (from GET /path): its state folder, the plans folder of plan mode, the
 *  tool-output folder (where OpenCode saves a long command output and tells the agent to read it), and its scratch
 *  folder %TEMP%\opencode (measured: 3 of 11 asks in the hard Testlauf). NOT the whole data folder (it also holds the
 *  session database and snapshots) and NOT the config folder (there the agent could change its own permissions). */
export function openCodeSafeDirs(paths: { state?: string; home?: string } | null): string[] {
  if (!paths?.state) return []
  const data = paths.state.replace(/([\\/])state([\\/])opencode$/i, '$1share$2opencode')
  const dirs = data !== paths.state ? [paths.state, `${data}\\plans`, `${data}\\tool-output`] : [paths.state]
  if (paths.home && /^[a-z]:\\/i.test(paths.home)) dirs.push(`${paths.home}\\AppData\\Local\\Temp\\opencode`)
  return dirs
}

// OD-24: interpreter one-liners stay on the risky list, EXCEPT short checks that only import, compute and print
// (measured 2026-10-15: 3 of 7 Testlauf tasks stopped on such a one-liner although AGENTS.md said not to use them).
// Each part of a command chain is judged on its own (see splitCommand); inside a part nothing may follow the quoted
// code, and the code must not contain the quote character (that would end the string and append another command).
// Every write/delete/network/process/dynamic-code call and shell expansion ($( ), ${ }, backticks) makes it ask
// again. False alarms only cost a question.
// Both are tested against the canonical form of a part, so `python.exe -B -c "…"` is judged like `python -c "…"`.
const ONE_LINER = /^(?:(?:python3?|py)\s+-c|node\s+(?:-e|-p|--eval|--print))\s+(["'])([\s\S]*)\1$/i
const INTERPRETER = /^(?:(?:python3?|py)\s+-c|node\s+(?:-e|-p|--eval|--print))(\s|$)/i
const ONE_LINER_DANGER = new RegExp([
  // imports that hide a dangerous call behind another name: from os import remove as r; getattr(os, 'remove')
  String.raw`\bfrom\s+(os|shutil|subprocess|pathlib|socket|sys)\b[\w.]*\s+import\b|\b(getattr|operator)\b`,
  String.raw`\.open\s*\(\s*['"][rbt]*[wax+]`, // Path('a').open('w')
  String.raw`\b(sqlite3|zipfile|tarfile|runpy|fetch)\b`,
  // open(…, 'w' / 'a' / 'x' / '+') as 2nd argument or mode=…; a file NAME with an "a" in it is no write (false alarm
  // measured in the hard Testlauf: open('aufgaben.json', encoding='utf-8'))
  String.raw`\bopen\s*\(\s*[^,()]+,\s*['"][rbt]*[wax+][rwabxt+]*['"]|\bmode\s*=\s*['"][rbt]*[wax+]`,
  String.raw`\.(write_text|write_bytes|write|unlink|rmdir|rename|touch|mkdir|chmod|symlink_to|hardlink_to)\s*\(`,
  String.raw`\b(remove|unlink|rmdir|removedirs|rename|renames|makedirs|mkdir|chmod|chown|truncate|system|popen|spawn\w*|exec[lv]\w*|kill|startfile|rmtree|move|copy\w*)\s*\(`,
  String.raw`\bos\.replace\s*\(|(pathlib|Path\s*\()[\s\S]*\.replace\s*\(`, // replacing files, not str.replace
  String.raw`\b(shutil|subprocess|socket|urllib|requests|http|ftplib|smtplib|ctypes|winreg|webbrowser|multiprocessing|asyncio|importlib|pickle|marshal|child_process|fs|net|https|dgram|worker_threads|vm)\b`,
  String.raw`\b(__import__|exec|eval|compile|globals|setattr|delattr|Function)\s*\(`,
  // node: loading the project's own modules (import('./index.mjs'), require('../x')) is like `python -c "import x"`;
  // any other module (fs, child_process, an npm package) still asks
  String.raw`\b(require|import)\s*\(\s*(?!['"]\.\.?\/)`,
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
  const split = splitCommand(command)
  if (!split) return false
  // Text piped into a shell or interpreter is code too (`… | powershell -`, `… | python -`): never harmless.
  if (split.some((p) => splitPipes(p).slice(1).some((s) => /^(python3?|py|node|powershell|pwsh|cmd|sh|bash|iex|invoke-expression)\b/.test(canonical(s))))) return false
  const parts = split.flatMap(splitPipes).map(canonical).filter(Boolean)
  if (!parts.some((p) => INTERPRETER.test(p))) return false
  return parts.every((p) => (INTERPRETER.test(p) ? oneLinerOk(p) : !riskyPart(p)))
}

/** Message sent with an automatic "no" to a loop, so the model changes course instead of trying the same again. */
export const LOOP_HINT =
  'Du hast denselben Schritt dreimal wiederholt, ohne weiterzukommen. Wiederhole ihn nicht. Prüfe, woran es scheitert, ' +
  'versuche einen anderen Weg, oder schreibe kurz, was dich blockiert und was du als Nächstes vorschlägst.'

/** What the automatic mode does with a request: allow it once, turn a loop around, or leave it to the user (null).
 *  Work inside the working folder runs on its own; anything outside it, and anything on the risky list, asks. */
// Kinds of requests the automatic mode may answer at all. Anything else — a kind a newer OpenCode adds — asks (AN-04).
const KNOWN = new Set(['bash', 'edit', 'write', 'patch', 'multiedit', 'read', 'glob', 'grep', 'list', 'skill', 'todowrite', 'todoread', 'webfetch', 'websearch'])

export function autoDecision(p: PermissionRequest, workdir = '', safe: string[] = []): { reply: 'once' } | { reply: 'reject'; message: string } | null {
  if (p.permission === 'doom_loop') return { reply: 'reject', message: LOOP_HINT }
  const command = str(p.metadata?.command)
  if (p.permission === 'external_directory') {
    // Outside the project folder the user decides — except OpenCode's own folders (plans, tool output, scratch).
    const targets = [...(p.patterns ?? []), str(p.metadata?.filepath), str(p.metadata?.directory)].filter(Boolean)
    return targets.length > 0 && targets.every((t) => inside(t, safe)) ? { reply: 'once' } : null
  }
  if (!KNOWN.has(p.permission)) return null
  // The whole command line is read in order (a `cd` changes what `..` means); the patterns OpenCode adds are single
  // commands without that context, so only their absolute and variable paths count.
  const outside = pathsOutside(command || (p.patterns ?? []).join('; '), workdir, safe).length > 0 ||
    (command !== '' && pathsOutside((p.patterns ?? []).join(' ').replace(REL, ' '), workdir, safe).length > 0)
  if (p.permission === 'bash' && harmlessOneLiner(command) && !outside) return { reply: 'once' }
  if ([command, ...(p.patterns ?? [])].some(risky)) return null
  if (outside) return null
  return { reply: 'once' }
}

/** Why a request was left to the user — shown on the card so it is clear it was not forgotten. */
export function whyAsked(p: PermissionRequest, workdir = '', safe: string[] = []): string {
  if (p.permission === 'external_directory') return 'Zugriff außerhalb des Arbeitsordners entscheidest du.'
  if (p.permission !== 'doom_loop' && !KNOWN.has(p.permission)) return 'Diese Art Anfrage kennt der Automatikmodus nicht – du entscheidest.'
  const command = str(p.metadata?.command)
  if (pathsOutside(command || (p.patterns ?? []).join('; '), workdir, safe).length > 0) return 'Der Befehl greift auf einen Ort außerhalb des Arbeitsordners zu.'
  if ([command, ...(p.patterns ?? [])].some(risky)) return 'Hochladen, Löschen, Herunterladen und Programm-Einzeiler, die schreiben oder löschen, fragen immer nach.'
  return ''
}
