import { useEffect, useRef, useState } from 'react'
import { type FsEntry, type FsFile, type FsListing, listDir } from './fs'
import { type Attachment, LARGE_FILE_BYTES, fmtKB } from './attachments'
import { useEscape } from './useEscape'

const MAX_LISTED = 500 // the companion lists at most this many files per folder

// In-app file browser for "Datei anhängen" (same look as FolderPicker): browse into folders, tick one or several FILES,
// and attach them all to the next message. The ticks survive navigating between folders. Always visible inside the app window.
export function FilePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (files: Attachment[]) => void }) {
  const [listing, setListing] = useState<FsListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Attachment[]>([])
  const latest = useRef(0) // only the newest folder request may fill the list

  const go = (path?: string) => {
    const mine = ++latest.current
    setLoading(true); setError('')
    listDir(path, true)
      .then((l) => { if (mine === latest.current) setListing(l) })
      .catch((e) => { if (mine === latest.current) setError(String((e as Error).message || e)) })
      .finally(() => { if (mine === latest.current) setLoading(false) })
  }
  // Open at the roots each time the dialog is shown.
  useEffect(() => { if (open) { setPicked([]); go(undefined) } }, [open])
  useEscape(open, onClose)
  if (!open) return null

  const isPicked = (p: string) => picked.some((x) => x.path === p)
  const toggle = (f: FsFile) => setPicked((s) => (s.some((x) => x.path === f.path) ? s.filter((x) => x.path !== f.path) : [...s, { path: f.path, name: f.name, size: f.size }]))
  const here = listing?.path || ''
  const dirs = listing?.dirs ?? []
  const files = listing?.files ?? []

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-2xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="file-picker">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">Datei auf diesem PC anhängen</div>
            <div className="mono mt-1 truncate text-[12px] text-ink3" data-testid="fp-here" title={here}>{here || 'Dieser PC'}</div>
          </div>
          <button className="shrink-0 rounded-md px-2 py-1 text-ink3 hover:bg-user hover:text-ink2" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)" data-testid="fp-close">✕</button>
        </div>

        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px]">
          <button className="rounded-md border border-line px-2 py-1 text-ink2 hover:bg-user disabled:opacity-40"
            onClick={() => go(listing?.parent || undefined)} disabled={listing?.parent === null} data-testid="fp-up">↑ Zurück</button>
          <button className="rounded-md border border-line px-2 py-1 text-ink3 hover:bg-user" onClick={() => go(undefined)} data-testid="fp-roots">Dieser PC</button>
          {loading && <span className="text-ink3">lädt…</span>}
        </div>

        <div className="min-h-[220px] flex-1 overflow-y-auto px-2 py-2" data-testid="fp-list">
          {error ? (
            <p className="px-3 py-4 text-[13px] text-amber-400/90">{error}</p>
          ) : listing && dirs.length === 0 && files.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-ink3">Dieser Ordner ist leer.</p>
          ) : (
            <>
              {dirs.map((d: FsEntry) => (
                <div key={d.path} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-user">
                  <span className="size-4 shrink-0" aria-hidden />
                  <button className="min-w-0 flex-1 truncate text-left text-[14px] text-ink2 hover:text-ink" onClick={() => go(d.path)} title={d.path} data-testid="fp-open">
                    📁 {d.name}
                  </button>
                </div>
              ))}
              {files.map((f: FsFile) => (
                <div key={f.path} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isPicked(f.path) ? 'bg-accent/10' : 'hover:bg-user'}`} data-testid="fp-file">
                  <input type="checkbox" className="size-4 shrink-0 accent-[var(--color-accent)]" checked={isPicked(f.path)}
                    onChange={() => toggle(f)} data-testid="fp-check" aria-label={`${f.name} auswählen`} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => toggle(f)} title={f.path} data-testid="fp-file-name">
                    <span className="block truncate text-[14px] text-ink2 hover:text-ink">📄 {f.name}</span>
                    {f.size > LARGE_FILE_BYTES && <span className="ml-5 block text-[11px] text-amber-400/90" data-testid="fp-large">groß – kostet viel Kontext</span>}
                  </button>
                  <span className="shrink-0 text-[12px] text-ink3" data-testid="fp-size">{fmtKB(f.size)}</span>
                </div>
              ))}
              {files.length >= MAX_LISTED && <p className="px-3 py-2 text-[12px] text-ink3">Es werden nur die ersten {MAX_LISTED} Dateien dieses Ordners gezeigt.</p>}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-[12px] text-ink3" data-testid="fp-count">{picked.length > 0 ? `${picked.length} ausgewählt` : 'Dateien ankreuzen'}</span>
          <button className="btn-accent disabled:opacity-40" disabled={picked.length === 0} onClick={() => { onPick(picked); onClose() }} data-testid="fp-confirm">
            Anhängen ({picked.length})
          </button>
        </div>
      </div>
    </div>
  )
}
