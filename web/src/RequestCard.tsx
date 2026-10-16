import { useState } from 'react'
import type { PermissionRequest, QuestionRequest } from './api'
import { describePermission, whyAsked } from './requests'

// Shown above the chat box when the agent is waiting on the user: a permission prompt (a command, a file, a loop) or a
// multiple-choice question. Answering it here lets the agent continue instead of hanging. One request at a time (the
// oldest), so the user is never buried.
export function RequestCard({ perms, questions, autoAllow, workdir, safeDirs = [], onPermission, onQuestion, onReject }: {
  perms: PermissionRequest[]
  questions: QuestionRequest[]
  autoAllow: boolean
  workdir: string
  safeDirs?: string[]
  onPermission: (id: string, reply: 'once' | 'always' | 'reject', message?: string) => void
  onQuestion: (id: string, answers: string[][]) => void
  onReject: (id: string) => void
}) {
  const q = questions[0]
  if (q) return <QuestionBox key={q.id} q={q} onAnswer={onQuestion} onReject={onReject} />
  const p = perms[0]
  if (!p) return null
  return <PermissionBox key={p.id} p={p} autoAllow={autoAllow} why={whyAsked(p, workdir, safeDirs)} onReply={onPermission} more={perms.length - 1} />
}

function PermissionBox({ p, autoAllow, why, onReply, more }: { p: PermissionRequest; autoAllow: boolean; why: string; onReply: (id: string, reply: 'once' | 'always' | 'reject', message?: string) => void; more: number }) {
  const { title, detail } = describePermission(p)
  const loop = p.permission === 'doom_loop'
  // A full accent border + tinted background + a short glow, so this "needs you" card clearly stands out from the quiet
  // status cards above the chat box (which all share border-line/bg-panel) and is not overlooked.
  const btn2 = 'rounded-lg border border-accent/30 bg-panel px-3 py-1.5 text-[14px] text-ink hover:bg-user'
  return (
    <div className="attn mb-2 rounded-xl border-2 border-accent bg-accent/10 px-4 py-3" data-testid="perm-card">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-accent">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden />
        <span>{loop ? '🔁 Der Agent dreht sich im Kreis' : '🔐 Freigabe nötig —'} {!loop && <span className="text-ink">OpenDante {title}</span>}</span>
        {more > 0 && <span className="ml-auto rounded-full bg-accent/20 px-2 text-[11px] text-accent">+{more} wartet</span>}
      </div>
      {detail && <div className="mono mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-bg px-3 py-2 text-[12px] text-ink2" data-testid="perm-detail">{detail}</div>}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {loop ? (
          <>
            <button className="btn-accent" onClick={() => onReply(p.id, 'reject')} data-testid="perm-redirect">Anders weitermachen</button>
            <button className={btn2} onClick={() => onReply(p.id, 'once')} data-testid="perm-once">Trotzdem einmal</button>
          </>
        ) : (
          <>
            <button className="btn-accent" onClick={() => onReply(p.id, 'once')} data-testid="perm-once">Einmal erlauben</button>
            <button className={btn2} onClick={() => onReply(p.id, 'always')} data-testid="perm-always">Immer erlauben</button>
            <button className={btn2} onClick={() => onReply(p.id, 'reject')} data-testid="perm-reject">Ablehnen</button>
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink3">
        {loop
          ? 'Der Agent hat sich dreimal im selben Schritt gedreht. „Anders weitermachen“ bittet ihn um einen anderen Weg.'
          : autoAllow
          ? `${why || 'Dieser Schritt wartet auf dich.'} Harmlose Befehle im Arbeitsordner laufen sonst automatisch — abschaltbar unter Modi.`
          : '„Befehle automatisch erlauben“ ist aus (Modi) — darum fragt jeder Befehl einzeln nach.'}
      </p>
    </div>
  )
}

function QuestionBox({ q, onAnswer, onReject }: { q: QuestionRequest; onAnswer: (id: string, answers: string[][]) => void; onReject: (id: string) => void }) {
  // One or more questions in a request; each is single- or multiple-choice, and may allow a free-text answer.
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})
  const toggle = (qi: number, label: string, multiple: boolean) =>
    setPicked((s) => {
      const cur = s[qi] ?? []
      if (multiple) return { ...s, [qi]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] }
      return { ...s, [qi]: [label] }
    })
  const answerFor = (qi: number): string[] => {
    const c = (custom[qi] ?? '').trim()
    return c ? [...(picked[qi] ?? []), c] : (picked[qi] ?? [])
  }
  const ready = q.questions.every((_, qi) => answerFor(qi).length > 0)

  return (
    <div className="attn mb-2 rounded-xl border-2 border-accent bg-accent/10 px-4 py-3" data-testid="question-card">
      <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-accent">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden />
        <span>❓ OpenDante fragt nach — bitte antworten</span>
      </div>
      <div className="flex flex-col gap-3">
        {q.questions.map((item, qi) => (
          <div key={qi}>
            <div className="text-[14px] text-ink">{item.question}</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {item.options.map((o) => {
                const on = (picked[qi] ?? []).includes(o.label)
                return (
                  <button key={o.label} onClick={() => toggle(qi, o.label, !!item.multiple)} data-testid="question-option"
                    className={`rounded-lg border px-3 py-1.5 text-left text-[13px] ${on ? 'border-accent bg-accent/10 text-ink' : 'border-line text-ink2 hover:bg-user'}`}>
                    <span className="font-medium">{o.label}</span>
                    {o.description && <span className="text-ink3"> — {o.description}</span>}
                  </button>
                )
              })}
              {item.custom && (
                <input className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] outline-none"
                  placeholder="Eigene Antwort…" value={custom[qi] ?? ''} onChange={(e) => setCustom((s) => ({ ...s, [qi]: e.target.value }))} data-testid="question-custom" />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-accent disabled:opacity-40" disabled={!ready} data-testid="question-send"
          onClick={() => onAnswer(q.id, q.questions.map((_, qi) => answerFor(qi)))}>Antworten</button>
        <button className="rounded-lg border border-line px-3 py-1.5 text-[14px] text-ink2 hover:bg-user" data-testid="question-skip"
          onClick={() => onReject(q.id)}>Überspringen (selbst entscheiden)</button>
      </div>
    </div>
  )
}
