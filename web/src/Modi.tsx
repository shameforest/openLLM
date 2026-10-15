import { type Modes, useSettings } from './settings'
import { useEscape } from './useEscape'

const ROWS: { key: keyof Modes; title: string; desc: string }[] = [
  {
    key: 'autoAllow',
    title: 'Befehle automatisch erlauben (empfohlen)',
    desc: 'Lässt harmlose Schritte im Arbeitsordner ohne Nachfrage laufen, damit große Aufträge nicht nach dem ersten Schritt stehen bleiben. Immer nachgefragt wird bei: Hochladen (git push), Löschen, Zugriff außerhalb des Arbeitsordners, „Herunterladen und Ausführen“ und Programm-Einzeilern, die schreiben oder löschen (kurze Prüfungen, die nur rechnen und ausgeben, laufen von selbst). Dreht sich der Agent im Kreis, wird er automatisch umgelenkt. Aus: jeder Schritt fragt einzeln.',
  },
  {
    key: 'autopilot',
    title: 'Autopilot – in Etappen arbeiten',
    desc: 'Für große Aufträge: OpenDante arbeitet in kleinen Schritten mit einem Gedächtnis-Dokument (FORTSCHRITT.md), erinnert sich selbst an den Ursprungsauftrag und den Stand und macht automatisch weiter — gegen Abschweifen und Vergessen.',
  },
  {
    key: 'offload',
    title: 'Mit Claude beschleunigen',
    desc: 'Lagert automatisch in sich geschlossene, unbedenkliche Teilaufgaben an Claude aus und holt das Ergebnis zurück — ohne Eingabe deinerseits. Der lokale Agent entscheidet selbst, welchen harmlosen Teil er abgibt; dein Projektzusammenhang und Sensibles bleiben lokal. Braucht einen Claude-Schlüssel (Einstellungen) und kostet API-Gebühren.',
  },
  {
    key: 'audit',
    title: 'Claude-Audit (Abschlussprüfung)',
    desc: 'Lässt den fertigen Code/Text am Ende automatisch vom stärksten Claude-Modell (Opus/Sonnet, wählbar in den Einstellungen) prüfen — gezielt auf die typischen Schwächen kleiner Modelle und ob das Ergebnis wirklich lauffähig und fehlerfrei ist. Ein abschließendes Sicherheitsnetz. Braucht einen Claude-Schlüssel und kostet API-Gebühren.',
  },
]

export function Modi({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings()
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-[560px] rounded-2xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()} data-testid="modi">
        <div className="mb-1 text-[17px] font-semibold">Modi</div>
        <p className="mb-4 text-[13px] text-ink3">Alles ist standardmäßig aus. Ohne diese Schalter läuft jede Aufgabe vollständig lokal in OpenDante.</p>
        <div className="flex flex-col divide-y divide-line">
          {ROWS.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium">{r.title}</div>
                <div className="mt-0.5 text-[13px] text-ink2">{r.desc}</div>
              </div>
              <Switch on={s[r.key]} onClick={() => s.toggle(r.key)} testid={r.key} />
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-ink3">
          Beide Modi laufen <span className="text-ink2">automatisch über deinen Claude-Schlüssel</span> (Einstellungen → Claude-Verbindung) und kosten API-Gebühren — du musst pro Aufgabe nichts eingeben. Claude erhält dabei nur in sich geschlossene, unbedenkliche Teile, nie deinen ganzen Zusammenhang. Ohne hinterlegten Schlüssel passiert nichts Zusätzliches.
        </p>
        <div className="mt-4 text-right">
          <button className="rounded-lg bg-accent px-3 py-1.5 text-[14px] font-medium text-[#1a1410]" onClick={onClose}>Fertig</button>
        </div>
      </div>
    </div>
  )
}

function Switch({ on, onClick, testid }: { on: boolean; onClick: () => void; testid: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={onClick} data-testid={`switch-${testid}`}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line'}`}>
      {/* knob: fixed 2px from the left, travels exactly 20px so it lands 2px from the right (44 − 20 − 2·2) */}
      <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}
