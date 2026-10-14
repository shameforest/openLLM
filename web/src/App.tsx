import { useEffect, useRef, useState } from 'react'
import { type AnswerSample, type Timing, elapsedLabel, fraction, remainingLabel } from './eta'

// MVP shell for the openLLM desktop app, in a Claude-like dark layout. The answer is SIMULATED for now (streamed word
// by word) so the two time readouts — elapsed and estimated-remaining — can be seen working. The real wiring to the
// local OpenCode server replaces the simulation once its API is confirmed; the timer logic (eta.ts) stays as is.

interface Msg { role: 'user' | 'assistant'; text: string }
interface Run { startedAt: number; tokens: number; total: number; thinkMs: number; words: string[]; done: boolean }

const KEY = 'openllm.samples'
const RATE = 28 // simulated writing speed, tokens/second
const DEMO = (
  'Klar, das habe ich mir angesehen. Ich lege zuerst die Datei an, pruefe dann den Aufbau und fuehre die Tests aus, ' +
  'damit wir sicher sind, dass alles wirklich funktioniert. Falls etwas fehlschlaegt, sage ich dir genau, woran es ' +
  'lag und was ich geaendert habe. Das Ergebnis fasse ich am Ende in einem kurzen Satz zusammen, so bleibt es ' +
  'nachvollziehbar und du musst nichts selbst durchsuchen.'
).split(' ')

function loadHistory(): AnswerSample[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

/** The two time readouts plus a thin progress bar, shown while an answer is being written. */
function Clock({ run, history }: { run: Run; history: AnswerSample[] }) {
  const t: Timing = { startedAt: run.startedAt, now: Date.now(), tokens: run.tokens }
  const thinking = run.tokens === 0
  const frac = fraction(t, history)
  return (
    <div className="mb-2 rounded-xl border border-line bg-panel px-4 py-2.5" data-testid="clock">
      <div className="flex items-center justify-between text-[13px]">
        <span className="inline-flex items-center gap-2 text-ink2">
          <span className="size-2 rounded-full bg-live" style={{ animation: 'pulse 1.2s ease-in-out infinite' }} />
          {thinking ? 'denkt nach…' : 'schreibt…'}
        </span>
        <span className="mono flex items-center gap-4">
          <span title="vergangene Zeit">{elapsedLabel(t)}</span>
          <span className="text-ink3" title="geschätzte Restzeit (lernt aus früheren Antworten)">
            {remainingLabel(t, history)}
          </span>
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${(frac ?? 0.04) * 100}%` }} />
      </div>
    </div>
  )
}

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [history, setHistory] = useState<AnswerSample[]>(loadHistory)
  const [, setTick] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, run])

  // Drive the simulated stream: reveal words at RATE after a short "thinking" pause, then record the sample.
  useEffect(() => {
    if (!run || run.done) return
    const id = window.setInterval(() => {
      const el = Date.now() - run.startedAt
      const revealed = el > run.thinkMs ? Math.min(run.total, Math.floor(((el - run.thinkMs) / 1000) * RATE)) : 0
      setMessages((ms) => {
        const copy = ms.slice()
        copy[copy.length - 1] = { role: 'assistant', text: run.words.slice(0, revealed).join(' ') }
        return copy
      })
      setTick((x) => x + 1)
      if (revealed >= run.total) {
        window.clearInterval(id)
        const next = [...history, { ms: el, tokens: run.total }].slice(-20)
        setHistory(next)
        try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
        setRun({ ...run, tokens: run.total, done: true })
      } else {
        setRun({ ...run, tokens: revealed })
      }
    }, 100)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.startedAt])

  const running = !!run && !run.done

  function send() {
    const prompt = input.trim()
    if (!prompt || running) return
    setInput('')
    const total = 30 + Math.floor(Math.random() * (DEMO.length - 30))
    setMessages((m) => [...m, { role: 'user', text: prompt }, { role: 'assistant', text: '' }])
    setRun({ startedAt: Date.now(), tokens: 0, total, thinkMs: 500 + Math.random() * 1200, words: DEMO.slice(0, total), done: false })
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="size-3 rounded-full bg-accent" />
          <span className="text-[15px] font-semibold tracking-tight">openLLM</span>
        </div>
        <button className="mx-3 mb-3 rounded-lg border border-line px-3 py-2 text-left text-[14px] text-ink2 hover:bg-user"
          onClick={() => { setMessages([]); setRun(null) }}>+ Neuer Chat</button>
        <div className="px-4 py-1 text-[11px] uppercase tracking-wider text-ink3">Verlauf</div>
        <div className="flex-1 overflow-y-auto px-3 text-[13px] text-ink3">
          <p className="px-1 py-2">Noch keine Unterhaltungen.</p>
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-ink3">Skills</div>
          <p className="mt-1 text-[13px] text-ink3">Bald: eigene Skills hochladen und nutzen.</p>
        </div>
        <div className="border-t border-line px-4 py-3 text-[12px] text-ink2">
          <span className="mono">Qwen3.8 27B</span> · lokal
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col gap-5 px-6 py-8">
            {messages.length === 0 && (
              <div className="m-auto text-center">
                <div className="mb-2 text-[22px] font-semibold">Womit kann ich helfen?</div>
                <div className="text-[14px] text-ink3">Lokaler Programmier-Assistent · läuft auf deiner Grafikkarte</div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'self-end' : 'self-start'}>
                {m.role === 'user' ? (
                  <div className="max-w-[560px] rounded-2xl bg-user px-4 py-2.5 text-[15px] leading-relaxed">{m.text}</div>
                ) : (
                  <div className="max-w-[640px]">
                    <div className="mb-1 text-[12px] font-medium text-accent">openLLM</div>
                    <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{m.text}<Caret show={running && i === messages.length - 1} /></div>
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-line bg-bg px-6 py-4">
          <div className="mx-auto max-w-[760px]">
            {run && !run.done && <Clock run={run} history={history} />}
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel px-3 py-2">
              <textarea
                className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-ink3"
                placeholder="Beschreibe, was gebaut werden soll…" rows={1} value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button
                className="mb-1 rounded-lg bg-accent px-3 py-1.5 text-[14px] font-medium text-[#1a1410] disabled:opacity-40"
                onClick={send} disabled={!input.trim() || running} data-testid="send">Senden</button>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-ink3">Vorschau mit simulierter Antwort — echte Anbindung an das lokale Modell folgt.</p>
          </div>
        </div>
      </main>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>
    </div>
  )
}

function Caret({ show }: { show: boolean }) {
  if (!show) return null
  return <span className="ml-0.5 inline-block w-[7px] translate-y-[1px] border-b-2 border-accent" style={{ animation: 'pulse 1s step-end infinite' }}>&nbsp;</span>
}
