import { useState } from 'react'
import { applyBriefing, auditBriefing, offloadBriefing } from './handoff'

export type HandoffKind = 'offload' | 'audit'

// The copy/paste bridge to Claude Code: prepare a clean request → you paste it into Claude Code → paste the answer back.
export function Handoff({ kind, onClose, onApply }: { kind: HandoffKind; onClose: () => void; onApply: (text: string) => void }) {
  const [src, setSrc] = useState('')
  const [answer, setAnswer] = useState('')
  const [copied, setCopied] = useState(false)
  const briefing = src.trim()
    ? (kind === 'offload' ? offloadBriefing(src) : auditBriefing('code', src))
    : ''

  const copy = () => {
    if (!briefing) return
    navigator.clipboard?.writeText(briefing).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }).catch(() => {})
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-y-auto rounded-2xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()} data-testid="handoff">
        <div className="mb-3 text-[16px] font-semibold">
          {kind === 'offload' ? 'Teilaufgabe an Claude Code' : 'Audit durch Claude Code'}
        </div>

        <label className="text-[13px] text-ink2">
          {kind === 'offload' ? '1. Beschreibe die eigenständige Teilaufgabe (ohne Projektgeheimnisse):' : '1. Füge den Plan oder den Code ein, der geprüft werden soll:'}
        </label>
        <textarea className="mt-1 min-h-[80px] rounded-lg border border-line bg-bg p-2 text-[14px] outline-none"
          value={src} onChange={(e) => setSrc(e.target.value)} />

        <div className="mt-3 flex items-center justify-between">
          <label className="text-[13px] text-ink2">2. Das geht an Claude Code — kopieren und dort einfügen:</label>
          <button className="rounded-md border border-line px-2 py-1 text-[12px] text-ink2 hover:bg-user disabled:opacity-40" onClick={copy} disabled={!briefing}>
            {copied ? 'kopiert ✓' : 'kopieren'}
          </button>
        </div>
        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-2 text-[12px] text-ink">{briefing || '…'}</pre>

        <label className="mt-3 text-[13px] text-ink2">3. Claudes Antwort hier einfügen:</label>
        <textarea className="mt-1 min-h-[80px] rounded-lg border border-line bg-bg p-2 text-[14px] outline-none"
          value={answer} onChange={(e) => setAnswer(e.target.value)} />

        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" onClick={onClose}>Abbrechen</button>
          <button className="rounded-lg bg-accent px-3 py-1.5 text-[14px] font-medium text-[#1a1410] disabled:opacity-40"
            disabled={!answer.trim()} onClick={() => { onApply(applyBriefing(kind, answer)); onClose() }}>
            An OpenDante übergeben
          </button>
        </div>
      </div>
    </div>
  )
}
