import { useEffect, useState } from 'react'
import { type FsEntry, type FsListing, baseName, listDir } from './fs'

// In-app folder browser (replaces the native Windows dialog, which opened behind the app window). Browse into folders,
// tick one or several, and add them all as working folders at once. Always visible inside the app window.
export function FolderPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (paths: string[]) => void }) {
  const [listing, setListing] = useState<FsListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  const go = (path?: string) => {
    setLoading(true); setError('')
    listDir(path).then((l) => setListing(l)).catch((e) => setError(String((e as Error).message || e))).finally(() => setLoading(false))
  }
  // Open at the roots each time the dialog is shown.
  useEffect(() => { if (open) { setPicked([]); go(undefined) } }, [open])
  if (!open) return null

  const toggle = (p: string) => setPicked((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))
  const here = listing?.path || ''
  const canPickHere = !!here // a drive root or a real folder — not the roots list

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-2xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="folder-picker">
        <div className="border-b border-line px-5 py-3">
          <div className="text-[15px] font-semibold">Ordner auf diesem PC wählen</div>
          <div className="mono mt-1 truncate text-[12px] text-ink3" data-testid="fp-here" title={here}>{here || 'Dieser PC'}</div>
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
          ) : listing && listing.dirs.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-ink3">Keine Unterordner. Du kannst diesen Ordner unten auswählen.</p>
          ) : (
            listing?.dirs.map((d: FsEntry) => (
              <div key={d.path} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${picked.includes(d.path) ? 'bg-accent/10' : 'hover:bg-user'}`}>
                <input type="checkbox" className="size-4 shrink-0 accent-[var(--color-accent)]" checked={picked.includes(d.path)}
                  onChange={() => toggle(d.path)} data-testid="fp-check" aria-label={`${d.name} auswählen`} />
                <button className="min-w-0 flex-1 truncate text-left text-[14px] text-ink2 hover:text-ink" onClick={() => go(d.path)} title={d.path} data-testid="fp-open">
                  📁 {d.name}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-[12px] text-ink3" data-testid="fp-count">{picked.length > 0 ? `${picked.length} ausgewählt` : 'Ordner ankreuzen oder den aktuellen nehmen'}</span>
          <div className="flex gap-2">
            <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={onClose}>Abbrechen</button>
            {canPickHere && picked.length === 0 && (
              <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={() => { onPick([here]); onClose() }} data-testid="fp-take-here">Diesen Ordner</button>
            )}
            <button className="btn-accent disabled:opacity-40" disabled={picked.length === 0} onClick={() => { onPick(picked); onClose() }} data-testid="fp-confirm">
              {picked.length > 1 ? `${picked.length} Ordner übernehmen` : 'Übernehmen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { baseName }
