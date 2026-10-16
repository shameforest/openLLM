import type { ToolCall } from './stream'

// OD-55: reliable live progress that does not depend on the model maintaining its todo list. While a task runs, show
// what the agent is really doing right now and what it has already touched — signals taken straight from the tool
// calls, which the model cannot "forget" to update (unlike `todowrite`). This is why a long run no longer looks stuck
// even when the task list above it stays unchanged.

const VERB: Record<string, string> = {
  read: 'liest', edit: 'bearbeitet', write: 'schreibt', patch: 'ändert', multiedit: 'bearbeitet', apply_patch: 'ändert',
  bash: 'führt aus', webfetch: 'ruft ab', websearch: 'sucht im Web', list: 'sieht im Ordner nach', glob: 'sucht Dateien',
  grep: 'durchsucht', todowrite: 'plant', todoread: 'liest die Liste', skill: 'nutzt einen Skill',
}
const FILE_TOOL = /^(edit|write|patch|multiedit|apply_patch)$/

/** Short, readable target of a tool call: a file path → its last two segments; a command → its first ~60 chars, one line. */
function shortTarget(tool: string, title?: string): string {
  if (!title) return ''
  if (tool === 'bash') { const one = title.replace(/\s+/g, ' ').trim(); return one.length > 60 ? `${one.slice(0, 59)}…` : one }
  const parts = title.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

/** The distinct files this run has created or changed (newest last), from the completed edit/write/patch calls. */
export function changedFiles(tools: ToolCall[]): string[] {
  const seen = new Set<string>()
  for (const t of tools) if (FILE_TOOL.test(t.tool) && t.title) seen.add(t.title)
  return [...seen]
}

export function ActivityCard({ tools }: { tools: ToolCall[] }) {
  if (!tools.length) return null
  const last = tools[tools.length - 1]
  const changed = changedFiles(tools)
  const verb = VERB[last.tool] ?? `nutzt ${last.tool}`
  const target = shortTarget(last.tool, last.title)
  return (
    <div className="mb-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-[13px]" data-testid="activity-card">
      <div className="flex items-center gap-2">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-ink2" data-testid="activity-now">
          {verb}{target ? <> <span className="mono text-ink">{target}</span></> : <> …</>}
        </span>
        <span className="mono shrink-0 text-ink3" data-testid="activity-steps">{tools.length} Schritte</span>
      </div>
      {changed.length > 0 && (
        <div className="mt-1 text-[12px] text-ink3" data-testid="activity-files">
          {changed.length} Datei{changed.length > 1 ? 'en' : ''} geändert: <span className="mono text-ink2">{changed.slice(-4).map((f) => shortTarget('edit', f)).join(', ')}</span>{changed.length > 4 ? ' …' : ''}
        </div>
      )}
    </div>
  )
}
