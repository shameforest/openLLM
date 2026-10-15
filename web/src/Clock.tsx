import { useEffect, useRef, useState } from 'react'
import { clock } from './eta'
import { type Progress, type StepSample, type TaskSample, estimateStep, estimateTask, smoothEnd } from './progress'
import type { ToolCall, Turn } from './stream'

// The live progress card above the chat box (re-rendered ~10×/s by the parent): which step the agent is on and what it
// is doing, a countdown until that step is done, the speed, and an estimate for the whole task. The bar fills per step;
// while a tool runs (its duration depends on the command) it shows a moving stripe instead.
export function Clock({ startedAt, prog, tools, steps, tasks, model, waiting, retry }: {
  startedAt: number; prog: Progress; tools: ToolCall[]; steps: StepSample[]; tasks: TaskSample[]; model: string; waiting: boolean
  retry: Turn['retry']
}) {
  const now = Date.now()
  const est = estimateStep(prog, steps, now)
  const runningTool = tools.find((t) => t.status === 'running' || t.status === 'pending')

  // Is the model already in the graphics card? After a few idle minutes Ollama unloads it, and loading 18 GB takes
  // about a minute — ask Ollama every 2 s so that wait is named honestly instead of shown as a countdown.
  const [modelReady, setModelReady] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const want = model.toLowerCase()
    const check = () => fetch('http://127.0.0.1:11434/api/ps')
      .then((r) => r.json())
      .then((j) => { if (alive) setModelReady(Array.isArray(j.models) && j.models.some((m: { name?: string; model?: string }) => [m.name, m.model].some((n) => String(n).toLowerCase() === want))) })
      .catch(() => { if (alive) setModelReady(null) })
    check()
    const id = window.setInterval(check, 2000)
    return () => { alive = false; window.clearInterval(id) }
  }, [model])
  const loading = est.phase === 'prefill' && modelReady === false
  // Right after a load the model reads the whole instruction block once without its cache (measured: ~25 s) — expected.
  const loadedInStep = useRef<number | null>(null)
  if (loading) loadedInStep.current = prog.step
  const afterLoad = est.phase === 'prefill' && !loading && loadedInStep.current === prog.step
  const overdue = est.phase === 'prefill' && est.overrun && !loading // first output later than usual
  const long = est.overrun && est.phase !== 'prefill' // step itself longer than usual

  // When did we first see the running tool (for "läuft seit …")? Kept across renders.
  const toolSeen = useRef<Record<string, number>>({})
  if (runningTool && !toolSeen.current[runningTool.id]) toolSeen.current[runningTool.id] = now

  // Smooth the countdowns: ease the predicted end time instead of jumping with every speed wobble; reset per step.
  const stepEnd = useRef<{ step: number; end: number; at: number } | null>(null)
  const prevEnd = stepEnd.current?.step === prog.step ? stepEnd.current : null
  const end = smoothEnd(prevEnd?.end ?? null, now + est.remainingMs, prevEnd ? now - prevEnd.at : 0)
  stepEnd.current = { step: prog.step, end, at: now }
  const stepLeft = Math.max(1000, end - now)
  const task = estimateTask(prog.step, stepLeft, tasks)

  const indeterminate = !!retry || waiting || !!runningTool || est.phase === 'between' || loading || overdue || long
  const doing = retry
    ? `Modellfehler – neuer Versuch Nr. ${retry.attempt}`
    : waiting
    ? 'wartet auf deine Antwort unten ↑'
    : runningTool
    ? `führt aus: ${runningTool.tool}${runningTool.title ? ` · ${runningTool.title}` : ''}`
    : loading ? 'lädt das Modell in die Grafikkarte…'
    : est.phase === 'prefill' ? (prog.step === 1 ? 'liest den Auftrag ein…' : 'liest die Ergebnisse ein…')
    : est.phase === 'thinking' ? 'denkt nach…'
    : est.phase === 'writing' ? 'schreibt…'
    : 'bereitet den nächsten Schritt vor…'

  const retryReason = retry ? (/model .* not found/i.test(retry.message) ? 'Modell nicht heruntergeladen (Einstellungen → Updates)' : retry.message.slice(0, 90)) : ''
  const stepText = retry
    ? `${retry.next > now ? `nächster Versuch in ~${clock(retry.next - now)} · ` : ''}${retryReason || 'Grund unbekannt'} · Stopp beendet den Auftrag`
    : waiting
    ? 'der Countdown pausiert, bis du geantwortet hast'
    : runningTool
    ? `läuft seit ${clock(now - toolSeen.current[runningTool.id])} · Dauer hängt vom Befehl ab`
    : est.phase === 'between' ? 'gleich geht es weiter'
    : loading ? `seit ${clock(est.stepElapsedMs)} · einmalig nach einer Pause, dauert etwa 1 Min. · danach ~${clock(est.writeMs)}`
    : overdue && afterLoad ? `seit ${clock(est.stepElapsedMs)} · nach dem Laden liest es alles einmal komplett ein · danach ~${clock(est.writeMs)}`
    : overdue ? `erste Ausgabe dauert länger als üblich (seit ${clock(est.stepElapsedMs)}) · danach ~${clock(est.writeMs)}`
    : long ? `Schritt ${prog.step} dauert länger als üblich (seit ${clock(est.stepElapsedMs)})`
    : `Schritt ${prog.step} fertig in ~${clock(stepLeft)}${est.learned ? '' : ' (grob)'}`
  const taskText = task.remainingMs != null
    ? `Gesamt ~${clock(task.remainingMs)} · typisch ${task.typicalSteps} Schritte`
    : task.typicalSteps != null ? `Gesamt offen · schon mehr Schritte als üblich (${task.typicalSteps})`
    : `Gesamt offen · lernt aus deinen Aufgaben (${Math.min(tasks.length, 3)}/3)`

  return (
    <div className="mb-2 rounded-xl border border-line bg-panel px-4 py-2.5" data-testid="clock">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="inline-flex min-w-0 items-center gap-2 text-ink2">
          <span className="size-2 shrink-0 rounded-full bg-live" style={{ animation: 'pulse 1.2s ease-in-out infinite' }} />
          <span className="shrink-0 font-medium text-ink" data-testid="clock-step">Schritt {prog.step}</span>
          <span className="truncate" data-testid="clock-doing">{doing}</span>
        </span>
        <span className="mono shrink-0" title="Zeit seit dem Absenden">{clock(now - startedAt)}</span>
      </div>
      <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`Schritt ${prog.step}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(est.fraction * 100)}>
        {indeterminate
          ? <div className="absolute inset-y-0 w-1/3 rounded-full bg-accent/70" style={{ animation: 'slide 1.4s ease-in-out infinite' }} />
          : <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(2, est.fraction * 100)}%` }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-[12px] text-ink3">
        <span className="mono" data-testid="clock-countdown"
          title={est.learned ? 'Aus den letzten Schritten auf deinem PC und der aktuellen Schreibgeschwindigkeit.' : 'Noch grob: Erfahrungswerte für dieses Modell. Nach 3 fertigen Schritten auf deinem PC wird es genauer.'}>
          {stepText}
        </span>
        {est.charsPerSec != null && <span className="mono" title="aktuelle Schreibgeschwindigkeit (~4 Zeichen = 1 Token)">≈ {Math.round(est.charsPerSec / 4)} Tokens/s</span>}
        <span className="mono" data-testid="clock-task"
          title="Wie viele Schritte ein Auftrag braucht, entscheidet die KI selbst. Die Schätzung nimmt die typische Schrittzahl deiner bisherigen Aufträge.">
          {taskText}
        </span>
      </div>
    </div>
  )
}
