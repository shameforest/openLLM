import { type Modes, useSettings } from './settings'

const ROWS: { key: keyof Modes; title: string; desc: string }[] = [
  {
    key: 'autopilot',
    title: 'Autopilot – in Etappen arbeiten',
    desc: 'Für große Aufträge: OpenDante arbeitet in kleinen Schritten mit einem Gedächtnis-Dokument (FORTSCHRITT.md), erinnert sich selbst an den Ursprungsauftrag und den Stand und macht automatisch weiter — gegen Abschweifen und Vergessen.',
  },
  {
    key: 'offload',
    title: 'Mit Claude beschleunigen',
    desc: 'Lagert in sich geschlossene, unbedenkliche Teilaufgaben an Claude aus und holt das Ergebnis zurück. Bei „Automatisch" (Einstellungen) geschieht das von selbst über deinen Claude-Schlüssel — kostet API-Gebühren. Bei „Manuell" per Kopieren/Einfügen (kostenlos). Dein Projektzusammenhang und Sensibles bleiben lokal; der lokale Agent entscheidet selbst, welchen harmlosen Teil er abgibt.',
  },
  {
    key: 'audit',
    title: 'Claude-Audit (Abschlussprüfung)',
    desc: 'Lässt den fertigen Code/Text am Ende vom stärksten Claude-Modell (Opus/Sonnet, wählbar in den Einstellungen) prüfen — gezielt auf die typischen Schwächen kleiner Modelle und ob das Ergebnis wirklich lauffähig und fehlerfrei ist. Ein abschließendes Sicherheitsnetz. Bei „Automatisch" läuft die Prüfung von selbst (kostet API-Gebühren), bei „Manuell" per Kopieren/Einfügen.',
  },
]

export function Modi({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings()
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
          Claude erhält nur in sich geschlossene, unbedenkliche Teile — nie deinen ganzen Zusammenhang. Ob die Übergabe <span className="text-ink2">automatisch</span> (über deinen Claude-Schlüssel, kostet Gebühren) oder <span className="text-ink2">manuell</span> (Kopieren/Einfügen, kostenlos) läuft, stellst du in den Einstellungen unter „Claude-Verbindung" ein. Dort wählst du auch das Modell (Opus/Sonnet).
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
