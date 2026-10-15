import type { ChatMeta } from './chats'
import { fmtExact, savedTokens, totalUsage, usageSplit } from './usage'

// Einstellungen → Übersicht: totals over every saved chat — how much went to Claude, and how many Claude tokens were
// saved because the local model did the work.
export function UsageOverview({ chats, loaded }: { chats: ChatMeta[]; loaded: boolean }) {
  if (!loaded) return <p className="text-[13px] text-ink3">Lädt… (der lokale Dienst startet mit OpenDante)</p>
  const u = totalUsage(chats.map((c) => c.usage))
  const split = usageSplit(u)
  if (!split) return <p className="text-[13px] text-ink3" data-testid="overview-empty">Noch keine gespeicherten Chats mit Antworten.</p>
  const approx = u.localEstimated ? '≈' : ''
  return (
    <div data-testid="overview">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="An Claude ausgelagert" value={`${approx}${split.claudePct} %`} tone="text-sky-400"
          sub={`der erzeugten Tokens · ${u.offloads} Teilaufgabe${u.offloads === 1 ? '' : 'n'}`} testid="overview-claude-pct" />
        <Tile label="Gespart durch lokal" value={`${approx}${fmtExact(savedTokens(u))}`} tone="text-accent"
          sub="Claude-Tokens, die dein PC übernommen hat" testid="overview-saved" />
      </div>

      <div className="mt-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-sky-400" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${split.localPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[12px]">
          <span className="text-accent">Lokal {approx}{split.localPct} %</span>
          <span className="text-sky-400">Claude {approx}{split.claudePct} %</span>
        </div>
      </div>

      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-ink3">
            <th className="py-1 font-normal" />
            <th className="py-1 text-right font-normal">gelesen</th>
            <th className="py-1 text-right font-normal">erzeugt</th>
          </tr>
        </thead>
        <tbody className="mono">
          <tr className="border-t border-line">
            <td className="py-1.5 font-sans text-accent">Lokal</td>
            <td className="py-1.5 text-right">{fmtExact(u.localIn)}</td>
            <td className="py-1.5 text-right">{approx}{fmtExact(u.local)}</td>
          </tr>
          <tr className="border-t border-line">
            <td className="py-1.5 font-sans text-sky-400">Claude</td>
            <td className="py-1.5 text-right">{fmtExact(u.claudeIn)}</td>
            <td className="py-1.5 text-right">{fmtExact(u.claudeOut)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[12px] text-ink3">
        Claude erzeugt: Teilaufgaben {fmtExact(u.offloadOut)} · Prüfung {fmtExact(u.auditOut)} · über {chats.length} Chat{chats.length === 1 ? '' : 's'}.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-ink3">
        <span className="text-ink2">So wird gerechnet:</span> „Ausgelagert“ ist Claudes Anteil an allen erzeugten Tokens (Antworten + Denken).
        „Gespart“ ist alles, was das lokale Modell gelesen und geschrieben hat. So viele Tokens hätte Claude ungefähr
        verarbeiten müssen, wenn es alles allein gemacht hätte. Das ist eine Schätzung, weil Claude etwas anders zählt.
        {u.localEstimated && ' ≈ heißt: Für einige Antworten hat der lokale Server keine Zahl gemeldet, dort gilt ~4 Zeichen = 1 Token.'}
      </p>
    </div>
  )
}

function Tile({ label, value, sub, tone, testid }: { label: string; value: string; sub: string; tone: string; testid: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg px-3 py-2.5">
      <div className="text-[12px] text-ink3">{label}</div>
      <div className={`mono mt-0.5 text-[22px] font-semibold leading-tight ${tone}`} data-testid={testid}>{value}</div>
      <div className="mt-0.5 text-[12px] text-ink3">{sub}</div>
    </div>
  )
}
