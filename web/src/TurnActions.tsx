import { useState } from 'react'
import type { FileDiff } from './api'
import { useEscape } from './useEscape'

// The line under an answer (OD-09, OD-22): which files the turn changed (+ a Vorher/Nachher view), undo / restore, and
// for a plan from the plan agent the button that carries it out.
export interface TurnInfo {
  changes: FileDiff[] | null // null = not known (no session, or not loaded yet)
  reverted: boolean
  isPlan: boolean
  isLast: boolean
}

export function TurnActions({ info, onUndo, onRestore, onRunPlan }: {
  info: TurnInfo
  onUndo: () => void
  onRestore: () => void
  onRunPlan: () => void
}) {
  const [showDiff, setShowDiff] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const files = info.changes ?? []
  const add = files.reduce((s, f) => s + (f.additions || 0), 0)
  const del = files.reduce((s, f) => s + (f.deletions || 0), 0)

  if (info.reverted) {
    return (
      <div className="-mt-3 self-start text-[12px] text-ink3" data-testid="turn-reverted">
        ↶ Rückgängig gemacht · <button className="text-ink2 underline hover:text-ink" onClick={onRestore} data-testid="turn-restore">Wiederherstellen</button>
        <span className="ml-1">(geht, solange du keinen neuen Auftrag sendest)</span>
      </div>
    )
  }
  if (!files.length && !(info.isPlan && info.isLast)) return null
  return (
    <div className="-mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 self-start text-[12px] text-ink3" data-testid="turn-actions">
      {info.isPlan && info.isLast && (
        <button className="btn-accent !py-1 !text-[13px]" onClick={onRunPlan} data-testid="run-plan">▶ Plan umsetzen</button>
      )}
      {files.length > 0 && (
        <>
          <span data-testid="turn-changes">📝 {files.length} {files.length === 1 ? 'Datei' : 'Dateien'} geändert <span className="mono text-emerald-400">+{add}</span> <span className="mono text-red-400">−{del}</span></span>
          <button className="text-ink2 underline hover:text-ink" onClick={() => setShowDiff(true)} data-testid="turn-diff">Ansehen</button>
          {confirm ? (
            <span>
              Diesen und alle späteren Aufträge rückgängig machen?{' '}
              <button className="text-red-400 underline" onClick={() => { setConfirm(false); onUndo() }} data-testid="turn-undo-yes">Ja</button>{' '}
              <button className="underline" onClick={() => setConfirm(false)}>Nein</button>
            </span>
          ) : (
            <button className="text-ink2 underline hover:text-ink" onClick={() => setConfirm(true)} data-testid="turn-undo">Rückgängig</button>
          )}
        </>
      )}
      {showDiff && <DiffModal files={files} onClose={() => setShowDiff(false)} />}
    </div>
  )
}

function DiffModal({ files, onClose }: { files: FileDiff[]; onClose: () => void }) {
  const [open, setOpen] = useState(0)
  useEscape(true, onClose)
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-[860px] flex-col rounded-2xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="diff-modal">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-[15px] font-semibold">Änderungen dieses Auftrags</div>
          <button className="rounded-md px-2 py-1 text-ink3 hover:bg-user" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-60 shrink-0 overflow-y-auto border-r border-line p-2">
            {files.map((f, i) => (
              <button key={i} onClick={() => setOpen(i)} className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] ${i === open ? 'bg-user text-ink' : 'text-ink2 hover:bg-user'}`} title={f.file}>
                <span className={f.status === 'added' ? 'text-emerald-400' : f.status === 'deleted' ? 'text-red-400' : 'text-ink3'}>
                  {f.status === 'added' ? '+ ' : f.status === 'deleted' ? '− ' : '~ '}
                </span>
                {(f.file ?? '').split(/[\\/]/).pop()}
              </button>
            ))}
          </div>
          <pre className="mono min-w-0 flex-1 overflow-auto p-3 text-[12px] leading-relaxed" data-testid="diff-patch">
            {(files[open]?.patch ?? '(kein Inhalt)').split('\n').map((l, i) => (
              <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'bg-emerald-500/10 text-emerald-300' : l.startsWith('-') && !l.startsWith('---') ? 'bg-red-500/10 text-red-300' : l.startsWith('@@') ? 'text-sky-400' : 'text-ink2'}>{l || ' '}</div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  )
}
