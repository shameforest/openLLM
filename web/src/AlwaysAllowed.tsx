import type { AlwaysGrant } from './storage'
import { kindLabel } from './requests'
import { useEscape } from './useEscape'
import { baseName } from './FolderPicker'

// OD-63: shows the standing permissions the user granted with "Immer erlauben" in this folder, and lets them take any
// back. OpenDante owns this list: a granted pattern is answered by OpenDante itself (with "einmal") the next time the
// agent asks, so revoking here is enough — the agent asks again from then on.
export function AlwaysAllowed({ open, dir, grants, onClose, onRevoke, onClearAll }: {
  open: boolean
  dir: string
  grants: AlwaysGrant[]
  onClose: () => void
  onRevoke: (pat: string) => void
  onClearAll: () => void
}) {
  useEscape(open, onClose)
  if (!open) return null
  const fmtDate = (at: number) => { try { return new Date(at).toLocaleDateString('de-DE') } catch { return '' } }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-2xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="always-allowed">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">🔓 Dauer-Freigaben</div>
            <div className="mono mt-1 truncate text-[12px] text-ink3" title={dir}>{dir ? baseName(dir) : 'Serverordner (Standard)'}</div>
          </div>
          <button className="shrink-0 rounded-md px-2 py-1 text-ink3 hover:bg-user hover:text-ink2" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)" data-testid="always-close">✕</button>
        </div>

        <div className="min-h-[160px] flex-1 overflow-y-auto px-3 py-3" data-testid="always-list">
          {grants.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-ink3" data-testid="always-empty">
              Noch nichts dauerhaft erlaubt. Wenn du bei einer Nachfrage <b>„Immer erlauben“</b> wählst, erscheint das hier und kann jederzeit zurückgenommen werden.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {grants.map((g) => (
                <li key={g.pat} className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2" data-testid="always-row">
                  <div className="min-w-0 flex-1">
                    <div className="mono truncate text-[13px] text-ink" title={g.pat}>{g.pat}</div>
                    <div className="text-[11px] text-ink3">{kindLabel(g.kind)}{g.at ? ` · seit ${fmtDate(g.at)}` : ''}</div>
                  </div>
                  <button className="shrink-0 rounded-md border border-line px-2 py-1 text-[12px] text-ink2 hover:bg-user" onClick={() => onRevoke(g.pat)} data-testid="always-revoke">Widerrufen</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-[12px] text-ink3">{grants.length > 0 ? `${grants.length} dauerhaft erlaubt — gilt nur für diesen Ordner.` : 'Gilt je Ordner.'}</span>
          {grants.length > 0 && <button className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink2 hover:bg-user" onClick={onClearAll} data-testid="always-clear">Alle widerrufen</button>}
        </div>
      </div>
    </div>
  )
}
