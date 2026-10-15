import { splitThinking } from './stream'
import { hideOffloadMarkers } from './claude'
import type { Msg } from './messages'

// One chat entry. Assistant entries show ONLY the final answer: thinking, tool steps and the <<<CLAUDE handoff text
// live in the Gedankengang sidebar.
export function Bubble({ m, live = false, onShowThinking }: { m: Msg; live?: boolean; onShowThinking?: () => void }) {
  if (m.role === 'user') {
    return <div className="self-end"><div className="max-w-[560px] whitespace-pre-wrap rounded-2xl bg-user px-4 py-2.5 text-[15px] leading-relaxed">{m.text}</div></div>
  }
  const isClaude = m.kind === 'claude'
  const split = splitThinking(m.text)
  const answer = isClaude ? m.text : hideOffloadMarkers(split.answer)
  const hadProcess = !!(m.reasoning?.trim() || split.thinking.trim() || m.tools?.length)
  const waiting = live && !answer.trim() // still only thinking, no final answer yet
  return (
    <div className="max-w-[640px] self-start" data-testid={isClaude ? 'claude-answer' : 'answer'}>
      <div className={`mb-1 text-[12px] font-medium ${isClaude ? 'text-sky-400' : 'text-accent'}`}>{isClaude ? 'Claude (bezahlt)' : 'OpenDante'}</div>
      {answer.trim() ? (
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{answer}{live && <Caret />}</div>
      ) : waiting ? (
        <div className="text-[14px] text-ink3">
          <span className="italic">denkt nach…</span>
          {onShowThinking && <button className="ml-2 text-[13px] hover:text-ink2 hover:underline" onClick={onShowThinking} data-testid="show-thinking">Gedankengang ansehen ›</button>}
        </div>
      ) : hadProcess ? (
        <div className="text-[13px] italic text-ink3">Keine Textantwort — die ausgeführten Schritte stehen im Gedankengang.</div>
      ) : null}
      {m.error && <div className="mt-2 text-[13px] text-red-400">Fehler: {m.error}</div>}
    </div>
  )
}

const Caret = () => <span className="ml-0.5 inline-block w-[7px] translate-y-[1px] border-b-2 border-accent" style={{ animation: 'pulse 1s step-end infinite' }}>&nbsp;</span>
