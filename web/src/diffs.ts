// OD-31: OpenCode's write tool on Windows turns LF line endings into CRLF. The patch then shows every untouched line
// as removed and added again (measured: "+5 −2" for 3 new lines). For the "Dateien geändert" line and the Vorher/Nachher
// view, lines that differ only by a trailing \r count as unchanged. Display only; the files themselves are not touched.

const bare = (l: string) => l.replace(/\r$/, '')

/** The patch without line-ending-only changes, and its real numbers of added and removed lines. */
export function cleanPatch(patch: string): { patch: string; additions: number; deletions: number } {
  const out: string[] = []
  let additions = 0
  let deletions = 0
  let minus: string[] = []
  let plus: string[] = []
  const flush = () => {
    // Pair every removed line with an identical added line (ignoring \r): both become one unchanged line.
    const used = new Set<number>()
    const matched = new Set<number>()
    minus.forEach((m, i) => {
      const j = plus.findIndex((p, k) => !used.has(k) && p === m)
      if (j >= 0) { used.add(j); matched.add(i) }
    })
    minus.forEach((m, i) => { if (!matched.has(i)) { out.push('-' + m); deletions++ } })
    plus.forEach((p, k) => { if (used.has(k)) out.push(' ' + p); else { out.push('+' + p); additions++ } })
    minus = []
    plus = []
  }
  for (const raw of patch.split('\n')) {
    const line = bare(raw)
    if (line.startsWith('-') && !line.startsWith('---')) minus.push(line.slice(1))
    else if (line.startsWith('+') && !line.startsWith('+++')) plus.push(line.slice(1))
    else { flush(); out.push(line) }
  }
  flush()
  return { patch: out.join('\n'), additions, deletions }
}
