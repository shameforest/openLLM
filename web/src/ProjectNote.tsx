import { useEffect, useRef, useState } from 'react'
import { useEscape } from './useEscape'
import { getProjectNote, saveProjectNote } from './companion'
import { baseName } from './FolderPicker'

// OD-41: a per-project memory. OpenDante prepends this note to every prompt in this folder, so a new chat in the same
// project does not start from zero. The note lives in the project as .opendante/projektnotiz.md; the agent can also
// write it ("Projekt kennenlernen"), and it is shown here to read and edit.
export function ProjectNote({ open, workdir, onClose, onSaved, onLearn }: {
  open: boolean
  workdir: string
  onClose: () => void
  onSaved: (note: string) => void
  onLearn: () => void
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const loaded = useRef('')
  useEscape(open, onClose)
  useEffect(() => {
    if (!open) return
    setStatus('lädt…')
    void getProjectNote(workdir).then((r) => { setText(r.note || ''); loaded.current = r.note || ''; setStatus('') }).catch(() => setStatus(''))
  }, [open, workdir])
  if (!open) return null

  const save = async () => {
    setStatus('speichert…')
    try { await saveProjectNote(workdir, text); loaded.current = text; onSaved(text.trim()); setStatus('✓ gespeichert') }
    catch (e) { setStatus(`✗ ${String((e as Error).message || e)}`) }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-2xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()} data-testid="project-note">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[16px] font-semibold">📓 Projektnotiz</div>
          <button className="rounded-lg px-2 py-1 text-[18px] text-ink3 hover:bg-user" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)">✕</button>
        </div>
        <p className="mb-3 text-[12px] text-ink3">
          Dauerhafter Kontext zu <span className="mono text-ink2">{workdir ? baseName(workdir) : '—'}</span>: Zweck, Aufbau, wichtige Befehle, Konventionen.
          OpenDante stellt diese Notiz jeder neuen Nachricht in diesem Projekt voran — so beginnt ein neuer Chat nicht bei null.
        </p>
        {!workdir ? (
          <div className="rounded-lg border border-line bg-bg px-3 py-6 text-center text-[13px] text-ink3" data-testid="note-no-folder">
            Für den Standard-Serverordner gibt es keine Projektnotiz. Wähle über „+ → Ordner hinzufügen" ein Projekt.
          </div>
        ) : (
          <>
            <textarea className="mono min-h-[220px] flex-1 resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink outline-none"
              placeholder="z. B. Zweck: … · Start: npm run dev · Tests: npm test · Konvention: Kommentare auf Deutsch"
              value={text} onChange={(e) => setText(e.target.value)} data-testid="note-text" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn-accent" onClick={() => void save()} disabled={text === loaded.current} data-testid="note-save">Speichern</button>
              <button className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[14px] text-ink hover:bg-user" onClick={onLearn} data-testid="note-learn" title="Der Agent sieht sich das Projekt an und schreibt die Notiz selbst.">✨ Projekt automatisch kennenlernen</button>
              <span className="text-[12px] text-ink3" data-testid="note-status">{status}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
