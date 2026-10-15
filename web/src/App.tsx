import { useCallback, useEffect, useRef, useState } from 'react'
import { type AnswerSample, type Timing, elapsedLabel, fraction, remainingLabel } from './eta'
import { type OcEvent, abort, connectEvents, createSession, health, sendPrompt } from './api'
import { type Turn, type ToolCall, emptyTurn, produced, reduceEvent, splitThinking } from './stream'
import { AUTOPILOT_PREFIX, localModelName, useSettings } from './settings'
import { companionPost } from './companion'
import { expandSkillCommand, useSkills } from './skills'
import { OFFLOAD_PREFIX, claudeAudit, claudeOffload, hideOffloadMarkers, offloadTasks } from './claude'
import { type ChatUsage, addClaude, addLocal, emptyUsage, fmtExact, usageSplit } from './usage'
import { type Thought, ThinkingSidebar } from './ThinkingSidebar'
import { chatTitle, newChatId, relDate, useChats } from './chats'
import { Modi } from './Modi'
import { Settings } from './SettingsPanel'

// The OpenDante desktop app: a Claude-like chat over the local OpenCode server. The answer streams in live and drives the
// two time readouts (elapsed + estimated remaining, eta.ts). When the server is not running it falls back to a
// simulated answer so the window is never dead — the same render path is used either way.
// The main window shows only final answers; the process (thinking, tool steps, Claude handoffs) lives in the
// right-hand Gedankengang sidebar.

interface Msg { role: 'user' | 'assistant'; text: string; reasoning?: string; tools?: ToolCall[]; error?: string | null; kind?: 'claude'; pending?: boolean }

/** One assistant message → its process entry for the sidebar (thinking, tool steps, subtasks handed to Claude). */
function toThought(key: string, prompt: string, m: Msg, live: boolean): Thought {
  const split = splitThinking(m.text)
  const thinking = [m.reasoning || '', split.thinking].filter((x) => x.trim()).join('\n')
  return { key, prompt, thinking, tools: m.tools ?? [], offloads: offloadTasks(split.answer), live }
}

const KEY = 'openllm.samples'
const DEMO = (
  'Klar. Ich lege die Datei an, pruefe den Aufbau und fuehre die Tests aus, damit wir sicher sind, dass alles ' +
  'wirklich laeuft. Falls etwas fehlschlaegt, sage ich dir genau, woran es lag und was ich geaendert habe, und fasse ' +
  'das Ergebnis am Ende in einem Satz zusammen.'
).split(' ')
const SIM_WPS = 8 // words/second for the fallback preview

const loadHistory = (): AnswerSample[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [run, setRun] = useState<{ startedAt: number; turn: Turn; sim?: boolean } | null>(null)
  const [usage, setUsage] = useState<ChatUsage>(emptyUsage) // tokens in this chat: local vs Claude
  const [history, setHistory] = useState<AnswerSample[]>(loadHistory)
  const [online, setOnline] = useState<boolean | null>(null)
  const [, setTick] = useState(0)
  const modes = useSettings()
  const skills = useSkills()
  const modesActive = [modes.autopilot, modes.offload, modes.audit].filter(Boolean).length
  const [modiOpen, setModiOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [folderMsg, setFolderMsg] = useState('')
  const [historyMsg, setHistoryMsg] = useState('')
  const sessionRef = useRef<string | null>(null)
  const simRef = useRef<() => void>(() => {})
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chats = useChats()
  const chatRef = useRef<{ id: string; createdAt: number; title: string } | null>(null) // the chat being saved
  const [activeChat, setActiveChat] = useState<string | null>(null) // highlighted in the Verlauf
  const resumeDirRef = useRef<string | null>(null) // reopening a chat switches to its folder without clearing it

  // Load the installed skills and the Verlauf from the companion. Retry a few times so the lists still fill when the
  // companion (port 4097) finishes starting a moment after this window opens.
  useEffect(() => {
    let alive = true
    let tries = 0
    const tick = async () => {
      if (!alive) return
      const ok = (await Promise.all([skills.refresh(), chats.refresh()])).every(Boolean)
      if (!alive) return
      if (!ok && ++tries < 10) window.setTimeout(tick, 2000)
    }
    void tick()
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Empty window, fresh OpenCode session, nothing counted — "+ Neuer Chat" and a folder change. */
  function startNewChat() {
    sessionRef.current = null
    chatRef.current = null
    setActiveChat(null)
    setMessages([]); setRun(null); setUsage(emptyUsage())
  }

  // Changing the working folder (from the "+" menu or from Einstellungen) starts a fresh session in the new folder —
  // except when the change comes from reopening a chat that lives in that folder.
  const prevWorkdir = useRef(modes.workdir)
  useEffect(() => {
    if (prevWorkdir.current === modes.workdir) return
    prevWorkdir.current = modes.workdir
    if (resumeDirRef.current === modes.workdir) { resumeDirRef.current = null; return }
    startNewChat()
  }, [modes.workdir]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save the chat to the Verlauf whenever it changed and no answer is streaming (after each answer and each Claude
  // reply). Placeholders ("Claude bearbeitet …") are left out so a reopened chat never shows a stuck one.
  useEffect(() => {
    const c = chatRef.current
    if (!c || run || messages.length === 0) return
    const id = window.setTimeout(() => {
      void chats.save({
        id: c.id, title: c.title, createdAt: c.createdAt, workdir: modes.workdir, model: modes.localModel,
        sessionId: sessionRef.current, messages: messages.filter((m) => !m.pending), usage,
      }).catch(() => { /* companion not running: the chat stays in the window, the next save retries */ })
    }, 400)
    return () => window.clearTimeout(id)
  }, [messages, usage, run]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Reopen a saved chat: its messages, thinking and token counts come back, and the next message continues in the same
   *  OpenCode session, so the model still knows everything said before. */
  async function openChat(id: string) {
    if (run || id === activeChat) return
    try {
      const c = await chats.load<Msg>(id)
      sessionRef.current = c.sessionId
      chatRef.current = { id: c.id, createdAt: c.createdAt, title: c.title }
      setActiveChat(c.id); setHistoryMsg('')
      setMessages(c.messages); setRun(null); setUsage({ ...emptyUsage(), ...c.usage })
      if ((c.workdir || '') !== modes.workdir) { resumeDirRef.current = c.workdir || ''; modes.set({ workdir: c.workdir || '' }) }
    } catch (e) {
      setHistoryMsg(`Chat ließ sich nicht öffnen: ${String((e as Error).message || e)}`)
    }
  }

  // Feed one event into the active turn (used by both the real SSE stream and the fallback simulator).
  const feed = useCallback((e: OcEvent) => {
    setRun((prev) => (prev && !prev.turn.done ? { ...prev, turn: reduceEvent(prev.turn, e) } : prev))
  }, [])

  // Connect to the local server; retry every 5 s while it is down (it shares the GPU with OpenDali).
  useEffect(() => {
    let disconnect = () => {}
    let alive = true
    const check = () => health().then((h) => {
      if (!alive) return
      setOnline(!!h)
      if (h) disconnect = connectEvents(feed, (ok) => setOnline(ok), modes.workdir)
    })
    check()
    const id = window.setInterval(() => { if (alive && online !== true) check() }, 5000)
    return () => { alive = false; disconnect(); window.clearInterval(id); simRef.current() }
  }, [feed, online, modes.workdir])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, run])

  // Tick the clock ~10x/s while an answer is in flight.
  useEffect(() => {
    if (!run || run.turn.done) return
    const id = window.setInterval(() => setTick((x) => x + 1), 100)
    return () => window.clearInterval(id)
  }, [run])

  // When a turn ends, commit it to the transcript and remember how long / how much it was (for the estimate).
  useEffect(() => {
    if (!run || !run.turn.done) return
    const t = run.turn
    setMessages((m) => [...m, { role: 'assistant', text: t.text, reasoning: t.reasoning, tools: t.tools, error: t.error }])
    if (!run.sim) setUsage((u) => addLocal(u, t)) // the offline preview is not real work, so it is not counted
    if (!t.error && t.text.trim() && (modes.offload || modes.audit)) void postProcessClaude(t)
    if (!t.error && produced(t) > 0) {
      const next = [...history, { ms: Date.now() - run.startedAt, tokens: produced(t) }].slice(-20)
      setHistory(next)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
    }
    setRun(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.turn.done])

  const running = !!run && !run.turn.done

  function simulate(startedAt: number) {
    const total = 24 + Math.floor(Math.random() * (DEMO.length - 24))
    const thinkMs = 500 + Math.random() * 1000
    let shown = 0
    const id = window.setInterval(() => {
      const el = Date.now() - startedAt
      const target = el > thinkMs ? Math.min(total, Math.floor(((el - thinkMs) / 1000) * SIM_WPS)) : 0
      if (target > shown) {
        feed({ id: 'sim', type: 'message.part.delta', properties: { field: 'text', delta: (shown ? ' ' : '') + DEMO.slice(shown, target).join(' ') } })
        shown = target
      }
      if (shown >= total) { window.clearInterval(id); feed({ id: 'sim', type: 'session.idle', properties: {} }) }
    }, 100)
    simRef.current = () => window.clearInterval(id)
  }

  async function send() {
    const prompt = input.trim()
    if (!prompt || running) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: prompt }])
    const startedAt = Date.now()
    setRun({ startedAt, turn: emptyTurn(), sim: !online })
    if (online) {
      // A real chat goes into the Verlauf (the offline preview does not).
      if (!chatRef.current) {
        chatRef.current = { id: newChatId(), createdAt: startedAt, title: chatTitle(prompt) }
        setActiveChat(chatRef.current.id)
      }
      try {
        const asked = expandSkillCommand(prompt, skills.list) // turn a /skillname command into a skill instruction
        let text = asked
        if (modes.autopilot) text = AUTOPILOT_PREFIX + text
        if (modes.offload) text = OFFLOAD_PREFIX + text // let the local model mark benign subtasks for Claude
        const gi = modes.globalInstructions.trim()
        if (gi) text = `${gi}\n\n${text}` // global instructions apply to every message
        const title = chatRef.current.title
        if (!sessionRef.current) sessionRef.current = (await createSession(title, modes.workdir)).id
        try {
          await sendPrompt(sessionRef.current, text, modes.localModel, modes.workdir)
        } catch {
          // A reopened chat whose OpenCode session no longer exists: continue in a fresh session (the window keeps
          // the old messages, the model starts without them).
          sessionRef.current = (await createSession(title, modes.workdir)).id
          await sendPrompt(sessionRef.current, text, modes.localModel, modes.workdir)
        }
      } catch {
        feed({ id: 'err', type: 'session.error', properties: { message: 'Konnte den lokalen Server nicht erreichen.' } })
      }
    } else {
      simulate(startedAt)
    }
  }

  // Stop the running answer: abort it on the server (and the fallback simulator), then finish the turn locally so the
  // transcript keeps what arrived so far.
  // Replace the current pending Claude placeholder with its final text (sequential, so at most one is pending).
  const finishClaude = (final: Msg) =>
    setMessages((m) => { const i = m.findIndex((x) => x.pending); if (i < 0) return [...m, final]; const c = [...m]; c[i] = final; return c })

  // After a local answer: (auto) send marked subtasks to Claude, and/or have Claude audit the whole result. Paid API.
  // Each finished call adds its exact API token usage to the chat counter above the chat box right away.
  async function postProcessClaude(t: Turn) {
    const text = splitThinking(t.text).answer || t.text // review/offload the final answer, not the thinking
    if (modes.offload) {
      for (const task of offloadTasks(text)) {
        setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: '↗ Claude bearbeitet eine Teilaufgabe …', pending: true }])
        try {
          const r = await claudeOffload(task, modes.claudeModel)
          setUsage((u) => addClaude(u, 'offload', r.usage))
          finishClaude({ role: 'assistant', kind: 'claude', text: `↗ Teilergebnis von Claude (${r.model}):\n\n${r.text}` })
        } catch (e) { finishClaude({ role: 'assistant', kind: 'claude', text: `↗ Claude-Auslagerung ging nicht: ${String((e as Error).message || e)}` }) }
      }
    }
    if (modes.audit) {
      setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: '🔍 Claude prüft das Ergebnis …', pending: true }])
      try {
        const r = await claudeAudit(text, modes.claudeModel)
        setUsage((u) => addClaude(u, 'audit', r.usage))
        finishClaude({ role: 'assistant', kind: 'claude', text: `🔍 Claude-Audit (${r.model}):\n\n${r.text}` })
      } catch (e) { finishClaude({ role: 'assistant', kind: 'claude', text: `🔍 Claude-Audit ging nicht: ${String((e as Error).message || e)}` }) }
    }
  }

  async function stopRun() {
    simRef.current() // stop the offline preview if it is the one running
    if (sessionRef.current) await abort(sessionRef.current, modes.workdir)
    setRun((prev) => (prev && !prev.turn.done ? { ...prev, turn: { ...prev.turn, done: true } } : prev))
  }

  // Let the user hand the agent a real folder on this PC. The browser can't read a folder path, so the local helper
  // service opens the native folder dialog and returns the chosen absolute path; we then work in that folder.
  async function pickFolder() {
    setFolderMsg('Ordner-Auswahl geöffnet…')
    try {
      const r = await companionPost<{ path?: string; note?: string }>('/pick-folder')
      if (r.path) {
        modes.set({ workdir: r.path }) // the workdir effect starts a fresh session
        setFolderMsg(''); setPlusOpen(false)
      } else {
        setFolderMsg(r.note || 'Keine Auswahl getroffen.')
      }
    } catch {
      setFolderMsg('Der lokale Dienst läuft noch nicht — Ordnerwahl erst nach dem Start von OpenDante.')
    }
  }

  // The process of every answer, for the right-hand sidebar (the live turn last).
  const thoughts: Thought[] = []
  let lastPrompt = ''
  messages.forEach((m, i) => {
    if (m.role === 'user') lastPrompt = m.text
    else if (!m.kind) thoughts.push(toThought(`m${i}`, lastPrompt, m, false))
  })
  if (run) thoughts.push(toThought('live', lastPrompt, { role: 'assistant', text: run.turn.text, reasoning: run.turn.reasoning, tools: run.turn.tools }, !run.turn.done))

  // Counter shown above the chat box: committed turns plus the running one (live estimate until the server's count
  // arrives). A finished run is still counted here until the commit effect moves it into `usage` in the same update.
  const shownUsage = run && !run.sim ? addLocal(usage, run.turn) : usage
  const showThinking = () => modes.set({ thinkingOpen: true })

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="size-3 rounded-full bg-accent" />
          <span className="text-[15px] font-semibold tracking-tight">OpenDante</span>
        </div>
        <button className="mx-3 rounded-lg border border-line px-3 py-2 text-left text-[14px] text-ink2 hover:bg-user"
          onClick={() => { if (running) void stopRun(); startNewChat() }} data-testid="new-chat">+ Neuer Chat</button>
        <button className="mx-3 mb-3 mt-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-[14px] text-ink2 hover:bg-user"
          onClick={() => setModiOpen(true)} data-testid="open-modi">
          <span>Modi</span>
          {modesActive > 0 && <span className="rounded-full bg-accent/20 px-2 text-[12px] text-accent">{modesActive} an</span>}
        </button>
        <button className="mx-3 mb-3 rounded-lg border border-line px-3 py-2 text-left text-[14px] text-ink2 hover:bg-user"
          onClick={() => setSettingsOpen(true)} data-testid="open-settings">Einstellungen</button>
        <div className="px-4 py-1 text-[11px] uppercase tracking-wider text-ink3">Verlauf</div>
        <div className="flex-1 overflow-y-auto px-3 text-[13px]" data-testid="history">
          {chats.list.length === 0 ? (
            <p className="px-1 py-2 text-ink3">{chats.loaded ? 'Noch keine Unterhaltungen.' : '…'}</p>
          ) : (
            <div className="flex flex-col gap-0.5 pb-2">
              {chats.list.map((c) => (
                <button key={c.id} onClick={() => void openChat(c.id)} disabled={running && c.id !== activeChat}
                  title={`${c.title}\n${c.workdir || 'Standardordner'} · ${c.messages} Nachrichten`}
                  className={`flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left disabled:opacity-50 ${c.id === activeChat ? 'bg-user text-ink' : 'text-ink2 hover:bg-user'}`}
                  data-testid="history-item" aria-current={c.id === activeChat ? 'true' : undefined}>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-[11px] text-ink3">{relDate(c.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
          {historyMsg && <p className="px-1 py-1 text-[12px] text-accent">{historyMsg}</p>}
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-ink3">Skills</div>
          {skills.list.length === 0 ? (
            <p className="mt-1 text-[13px] text-ink3">{skills.loaded ? 'Noch keine — über Einstellungen hochladen.' : '…'}</p>
          ) : (
            <div className="mt-1 flex flex-col gap-0.5">
              {skills.list.map((sk) => (
                <button key={sk.slug} className="rounded-md px-1.5 py-1 text-left text-[13px] text-ink2 hover:bg-user" title={sk.description || sk.name}
                  onClick={() => { setInput(`/${sk.slug} `); inputRef.current?.focus() }} data-testid={`skill-${sk.slug}`}>
                  <span className="mono text-accent">/{sk.slug}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-line px-4 py-2 text-[12px] text-ink3" title={modes.workdir || 'Der Ordner, in dem OpenCode gestartet wurde'}>
          <span className="uppercase tracking-wider">Ordner</span>
          <div className="mono mt-0.5 break-all text-ink2">{modes.workdir || 'Standard (Serverordner)'}</div>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-ink2">
          <span className="min-w-0 truncate" title={modes.localModel}><span className="mono">{localModelName(modes.localModel)}</span> · lokal</span>
          <span className="inline-flex items-center gap-1.5" title={online ? 'verbunden' : 'Server nicht erreichbar'}>
            <span className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-ink3'}`} />
            {online === null ? '…' : online ? 'bereit' : 'offline'}
          </span>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {online === false && (
          <div className="border-b border-line bg-panel px-6 py-2 text-center text-[12px] text-ink2">
            Lokaler Server nicht erreichbar — starte OpenDante (<span className="mono">opencode serve</span>). Solange läuft eine Vorschau.
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col gap-5 px-6 py-8">
            {messages.length === 0 && !run && (
              <div className="m-auto text-center">
                <div className="mb-2 text-[22px] font-semibold">Womit kann ich helfen?</div>
                <div className="text-[14px] text-ink3">Lokaler Programmier-Assistent · läuft auf deiner Grafikkarte</div>
              </div>
            )}
            {messages.map((m, i) => <Bubble key={i} m={m} />)}
            {run && <Bubble m={{ role: 'assistant', text: run.turn.text, reasoning: run.turn.reasoning, tools: run.turn.tools, error: run.turn.error }} live={!run.turn.done}
              onShowThinking={modes.thinkingOpen ? undefined : showThinking} />}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-line bg-bg px-6 py-4">
          <div className="mx-auto max-w-[760px]">
            {(modes.offload || modes.audit) && (
              modes.apiKey.trim() ? (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1 text-[12px] text-sky-400/80">
                    Automatisch über Claude ({modes.claudeModel}): {modes.offload && 'unbedenkliche Teilaufgaben werden ausgelagert'}{modes.offload && modes.audit && ' · '}{modes.audit && 'das Ergebnis wird am Ende geprüft'}. Kostet API-Gebühren.
                  </div>
                  <UsageReadout u={shownUsage} />
                </div>
              ) : (
                <div className="mb-2 text-[12px] text-amber-400/90">
                  Für diesen Modus fehlt noch dein Claude-Schlüssel — in Einstellungen → Claude-Verbindung eintragen. Bis dahin passiert nichts Zusätzliches.
                </div>
              )
            )}
            {run && !run.turn.done && <Clock startedAt={run.startedAt} chars={produced(run.turn)} thinking={run.turn.text === ''} history={history} />}
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel px-3 py-2">
              <div className="relative">
                <button className="mb-1 flex size-9 items-center justify-center rounded-full border border-line text-[18px] text-ink2 hover:bg-user" aria-label="Hinzufügen" onClick={() => setPlusOpen((o) => !o)} data-testid="plus">+</button>
                {plusOpen && (
                  <div className="absolute bottom-11 left-0 z-10 w-72 rounded-xl border border-line bg-panel p-1 text-[13px]" data-testid="plus-menu">
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => void pickFolder()} data-testid="pick-folder">📁 Ordner auf diesem PC wählen…</button>
                    <div className="px-3 py-1.5 text-[12px] text-ink3">
                      Arbeitsordner: <span className="mono break-all text-ink2">{modes.workdir || 'Serverordner (Standard)'}</span>
                    </div>
                    {modes.workdir && (
                      <button className="w-full rounded-lg px-3 py-1.5 text-left text-ink3 hover:bg-user" onClick={() => { modes.set({ workdir: '' }); setPlusOpen(false) }}>↺ Auf Standardordner zurücksetzen</button>
                    )}
                    {folderMsg && <div className="px-3 py-1.5 text-[12px] text-accent">{folderMsg}</div>}
                    <div className="my-1 border-t border-line" />
                    <div className="rounded-lg px-3 py-2 text-ink3">Datei anhängen (bald)</div>
                    <div className="rounded-lg px-3 py-2 text-ink3">Kontext / Referenz einfügen (bald)</div>
                  </div>
                )}
              </div>
              <textarea ref={inputRef} className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-ink3"
                placeholder="Beschreibe, was gebaut werden soll… (oder /skillname)" rows={1} value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
              {running ? (
                <button className="mb-1 flex size-9 items-center justify-center rounded-lg bg-accent text-[#1a1410]"
                  onClick={() => void stopRun()} data-testid="stop" aria-label="Stoppen" title="Läuft – zum Abbrechen klicken">
                  <span className="size-3 rounded-[2px] bg-[#1a1410]" />
                </button>
              ) : (
                <button className="mb-1 rounded-lg bg-accent px-3 py-1.5 text-[14px] font-medium text-[#1a1410] disabled:opacity-40"
                  onClick={() => void send()} disabled={!input.trim()} data-testid="send">Senden</button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-ink3">
              {online ? 'Antworten kommen vom lokalen Modell auf deiner Grafikkarte.' : 'Vorschau mit simulierter Antwort — echte Anbindung aktiv, sobald der Server läuft.'}
            </p>
          </div>
        </div>
      </main>
      <ThinkingSidebar open={modes.thinkingOpen} onToggle={() => modes.set({ thinkingOpen: !modes.thinkingOpen })} items={thoughts} />
      <Modi open={modiOpen} onClose={() => setModiOpen(false)} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>
    </div>
  )
}

// One chat entry. Assistant entries show ONLY the final answer: thinking, tool steps and the <<<CLAUDE handoff text
// live in the Gedankengang sidebar.
function Bubble({ m, live = false, onShowThinking }: { m: Msg; live?: boolean; onShowThinking?: () => void }) {
  if (m.role === 'user') {
    return <div className="self-end"><div className="max-w-[560px] rounded-2xl bg-user px-4 py-2.5 text-[15px] leading-relaxed">{m.text}</div></div>
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

// Live token counter for this chat, shown next to the "Automatisch über Claude …" line: Claude's generated tokens
// (exact, from the API) and the percent split of all generated tokens between the local model and Claude.
function UsageReadout({ u }: { u: ChatUsage }) {
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

function Clock({ startedAt, chars, thinking, history }: { startedAt: number; chars: number; thinking: boolean; history: AnswerSample[] }) {
  const t: Timing = { startedAt, now: Date.now(), tokens: chars }
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
            {remainingLabel(t, history) === '…' ? 'Rest: lernt noch' : `noch ${remainingLabel(t, history)}`}
          </span>
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${(fraction(t, history) ?? 0.04) * 100}%` }} />
      </div>
    </div>
  )
}

const Caret = () => <span className="ml-0.5 inline-block w-[7px] translate-y-[1px] border-b-2 border-accent" style={{ animation: 'pulse 1s step-end infinite' }}>&nbsp;</span>
