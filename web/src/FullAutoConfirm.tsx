import { useEscape } from './useEscape'

// OD-71: shown ONCE, the first time the user starts "Voll-Automatik", so they knowingly opt into a mode that answers
// every permission and question on its own. After they confirm (fullAutoAck), it never appears again and no longer
// interrupts a run.
export function FullAutoConfirm({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  useEscape(open, onCancel)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-[460px] rounded-2xl border-2 border-accent bg-panel p-5" onClick={(e) => e.stopPropagation()} data-testid="full-auto-confirm">
        <div className="text-[16px] font-semibold text-accent">⚡ Voll-Automatik starten?</div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          OpenDante führt diesen Auftrag <b>bis zum Ende ohne Nachfrage</b> aus: Alle Freigaben — auch <b>Dateien ändern, Befehle ausführen, git push und Herunterladen</b> — und alle Rückfragen werden automatisch beantwortet, die K.I. wählt dabei selbst den Weg.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-ink3">
          Nutze das nur in Ordnern, denen du vertraust. Ein Sicherheits-Boden bleibt bestehen: Herunterfahren, Formatieren und Massen­löschen verweigert OpenDante weiterhin. Du kannst den Lauf jederzeit mit „Stoppen“ abbrechen. Diesen Hinweis zeige ich nur dieses eine Mal.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink2 hover:bg-user" onClick={onCancel} data-testid="full-auto-cancel">Abbrechen</button>
          <button className="btn-accent" onClick={onConfirm} data-testid="full-auto-go">Verstanden, starten</button>
        </div>
      </div>
    </div>
  )
}
