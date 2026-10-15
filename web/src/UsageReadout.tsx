import { type ChatUsage, fmtExact, usageSplit } from './usage'

// Live token counter for this chat, shown next to the "Automatisch über Claude …" line: Claude's generated tokens
// (exact, from the API) and the percent split of all generated tokens between the local model and Claude.
export function UsageReadout({ u }: { u: ChatUsage }) {
  const split = usageSplit(u)
  const approx = u.localEstimated ? '≈' : ''
  const title = [
    `Claude in diesem Chat: ${fmtExact(u.claudeOut)} Tokens erzeugt (Teilaufgaben ${fmtExact(u.offloadOut)} · Prüfung ${fmtExact(u.auditOut)}), ${fmtExact(u.claudeIn)} Tokens gelesen; ${u.offloads} Teilaufgabe(n) ausgelagert.`,
    `Lokal erzeugt: ${approx}${fmtExact(u.local)} Tokens${u.localEstimated ? ' (teils geschätzt: der lokale Server hat nicht für jede Antwort eine Zahl gemeldet, dann gilt ~4 Zeichen = 1 Token)' : ' (exakt vom lokalen Server)'}.`,
    'Prozent = Anteil an allen erzeugten Tokens (Antwort + Denken) in diesem Chat. „Neuer Chat“ setzt auf null.',
  ].join('\n')
  return (
    <div className="flex shrink-0 items-center gap-2.5 text-[12px] text-ink2" title={title} data-testid="usage">
      <span><span className="mono text-sky-400" data-testid="usage-claude">{fmtExact(u.claudeOut)}</span> Claude-Tokens</span>
      {split ? (
        <>
          <span className="flex h-1.5 w-14 overflow-hidden rounded-full bg-sky-400" aria-hidden>
            <span className="h-full bg-accent transition-[width] duration-300" style={{ width: `${split.localPct}%` }} />
          </span>
          <span className="mono" data-testid="usage-split">Lokal {approx}{split.localPct} % · Claude {approx}{split.claudePct} %</span>
        </>
      ) : (
        <span className="text-ink3">noch nichts gezählt</span>
      )}
    </div>
  )
}
