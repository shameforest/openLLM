import { useState } from 'react'
import { type ChatMeta, relDate } from './chats'

// One row in the Verlauf: click to reopen; on hover, rename (inline) or delete (asks once).
export function HistoryItem({ c, active, disabled, onOpen, onRename, onDelete }: {
  c: ChatMeta; active: boolean; disabled: boolean; onOpen: () => void; onRename: (title: string) => void; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.title)
  const [confirm, setConfirm] = useState(false)

  if (editing) {
    const save = () => { const t = name.trim(); if (t && t !== c.title) onRename(t); setEditing(false) }
    return (
      <input autoFocus className="w-full rounded-md border border-accent bg-bg px-2 py-1.5 text-[13px] outline-none" value={name}
        onChange={(e) => setName(e.target.value)} onBlur={save} data-testid="history-rename-input"
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setName(c.title); setEditing(false) } }} />
    )
  }
  // The WHOLE row opens the chat (a click anywhere, not just on the title). The rename/delete controls sit on top and
  // stop the click from also opening, so they stay usable. (Earlier only the narrow title was clickable, so clicks on
  // the right of the row did nothing.)
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }
  return (
    <div role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) onOpen() }}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen() } }}
      title={`${c.title}\n${c.workdir || 'Standardordner'} · ${c.messages} Nachrichten`}
      className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 ${active ? 'bg-user text-ink' : 'text-ink2 hover:bg-user'} ${disabled ? 'cursor-default opacity-50' : ''}`}
      data-testid="history-item" aria-current={active ? 'true' : undefined}>
      <span className="min-w-0 flex-1 truncate">{c.title}</span>
      {confirm ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          <span className="text-ink3">löschen?</span>
          <button className="rounded px-1 text-red-400 hover:bg-line" onClick={stop(onDelete)} data-testid="history-delete-yes">Ja</button>
          <button className="rounded px-1 text-ink3 hover:bg-line" onClick={stop(() => setConfirm(false))}>Nein</button>
        </span>
      ) : (
        <>
          {/* Date when idle; the two actions appear on hover in its place. */}
          <span className="shrink-0 text-[11px] text-ink3 group-hover:hidden">{relDate(c.updatedAt)}</span>
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button className="rounded px-1 py-0.5 text-[12px] text-ink3 hover:bg-line hover:text-ink2" title="Umbenennen"
              onClick={stop(() => { setName(c.title); setEditing(true) })} data-testid="history-rename">✎</button>
            <button className="rounded px-1 py-0.5 text-[12px] text-ink3 hover:bg-line hover:text-red-400" title="Löschen"
              onClick={stop(() => setConfirm(true))} data-testid="history-delete">🗑</button>
          </span>
        </>
      )}
    </div>
  )
}
