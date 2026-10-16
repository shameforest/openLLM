import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { type Progress, type StepSample, type TaskSample, finishStep, reduceProgress, startProgress } from './progress'
import { type FileDiff, type OcEvent, type PermissionRequest, type QuestionRequest, type Todo, abort, connectEvents, createSession, health, listPermissions, listQuestions, rejectQuestion, replyPermission, replyQuestion, revertTo, sendPrompt, serverPaths, sessionDiff, sessionTodos, summarize, unrevert, projectInfo, gitInit } from './api'
import { LOOP_HINT, autoDecision, openCodeSafeDirs } from './requests'
import { RequestCard } from './RequestCard'
import { estLoadMs, isLoaded, keepWarm, loadPct, preload, recordLoadMs } from './ollama'
import { companionPost } from './companion'
import { cleanPatch } from './diffs'
import { detectLoop } from './loops'
import { TurnActions } from './TurnActions'
import { TodoCard } from './TodoCard'
import { type Turn, emptyTurn, produced, reduceEvent, splitThinking } from './stream'
import { AUTOPILOT_PREFIX, localModelName, useSettings } from './settings'
import { expandSkillCommand, useSkills } from './skills'
import { FolderPicker, baseName } from './FolderPicker'
import { FilePicker } from './FilePicker'
import { type Attachment, IMAGE_HINT, isImageName, mergeAttachments, withAttachmentLines } from './attachments'
import { OFFLOAD_PREFIX, claudeAudit, claudeOffload, offloadTasks } from './claude'
import { type ChatUsage, addClaude, addLocal, emptyUsage, fmtExact } from './usage'
import { type Thought, ThinkingSidebar } from './ThinkingSidebar'
import { chatTitle, newChatId, useChats } from './chats'
import { Modi } from './Modi'
import { Settings } from './SettingsPanel'
import { type Msg, CONTEXT_LIMIT, toThought, wroteFiles } from './messages'
import { GIT_SKIP_KEY, STEPS_KEY, TASKS_KEY, loadList, saveList } from './storage'
import { DEMO, SIM_WPS } from './demo'
import { ChatSidebar } from './ChatSidebar'
import { Bubble } from './Bubble'
import { Clock } from './Clock'
import { UsageReadout } from './UsageReadout'

// The OpenDante desktop app: a Claude-like chat over the local OpenCode server. The answer streams in live and drives the
// step-by-step progress readout (progress.ts: current step, its countdown, the whole task). When the server is not
// running it falls back to a simulated answer so the window is never dead — the same render path is used either way.
// The main window shows only final answers; the process (thinking, tool steps, Claude handoffs) lives in the
// right-hand Gedankengang sidebar.

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [run, setRun] = useState<{ startedAt: number; turn: Turn; prog: Progress; sim?: boolean; stopped?: boolean; agent: 'plan' | 'build' } | null>(null)
  const [todos, setTodos] = useState<Todo[]>([]) // the agent's own task list for the current chat (OD-18)
  const [ctxUsed, setCtxUsed] = useState(0)      // tokens the model read in the last step = how full its context is (OD-19)
  const [ctxNote, setCtxNote] = useState('')
  const [usage, setUsage] = useState<ChatUsage>(emptyUsage) // tokens in this chat: local vs Claude
  const [stepSamples, setStepSamples] = useState<StepSample[]>(() => loadList(STEPS_KEY))
  const [taskSamples, setTaskSamples] = useState<TaskSample[]>(() => loadList(TASKS_KEY))
  const [online, setOnline] = useState<boolean | null>(null)
  const [load, setLoad] = useState<{ startedAt: number; pct: number } | null>(null) // model being loaded into the GPU
  const loadingRef = useRef(false)
  const [, setTick] = useState(0)
  const modes = useSettings()
  const skills = useSkills()
  const modesActive = [modes.autopilot, modes.offload, modes.audit].filter(Boolean).length
  const [modiOpen, setModiOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([]) // files chosen for the next message ("Datei anhängen")
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
    setPerms([]); setQuestions([]); autoReplied.current.clear()
    setTodos([]); setCtxUsed(0); setCtxNote('')
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
      setTodos([]); setCtxUsed(0); setCtxNote('')
      if (c.sessionId) void sessionTodos(c.sessionId, c.workdir || '').then(setTodos).catch(() => {})
      if ((c.workdir || '') !== modes.workdir) { resumeDirRef.current = c.workdir || ''; modes.set({ workdir: c.workdir || '' }) }
    } catch (e) {
      setHistoryMsg(`Chat ließ sich nicht öffnen: ${String((e as Error).message || e)}`)
    }
    void ensureLoaded() // start loading the model into the GPU while the user reads the reopened chat
  }

  // Load the model into the GPU ahead of time (on start, on model change, when reopening a chat) and show a progress
  // bar while it loads — so the first answer no longer waits ~30 s. Also keeps it warm (keepWarmMin).
  async function ensureLoaded() {
    if (loadingRef.current || online !== true || !modes.localModel) return
    if (await isLoaded(modes.localModel)) { void keepWarm(modes.localModel, modes.keepWarmMin); return }
    loadingRef.current = true
    const startedAt = Date.now()
    setLoad({ startedAt, pct: 1 })
    try { await preload(modes.localModel, modes.keepWarmMin); recordLoadMs(Date.now() - startedAt) } catch { /* Ollama busy or model not downloaded */ }
    setLoad(null)
    loadingRef.current = false
  }

  // Preload whenever the server comes online or the chosen model changes.
  useEffect(() => { if (online === true) void ensureLoaded() }, [online, modes.localModel]) // eslint-disable-line react-hooks/exhaustive-deps

  // Advance the loading percentage while a load is in flight (estimate; it snaps to done when the load resolves).
  useEffect(() => {
    if (!load) return
    const id = window.setInterval(() => setLoad((l) => (l ? { ...l, pct: loadPct(Date.now() - l.startedAt, estLoadMs()) } : l)), 500)
    return () => window.clearInterval(id)
  }, [load?.startedAt])

  // Requests the agent is waiting on: permission prompts (a command, a file outside the project, a loop it is stuck in)
  // and multiple-choice questions. Without an answer the agent waits forever — this was the main reason long tasks
  // seemed to freeze. They arrive as events AND are polled on (re)connect in case the window missed one.
  const [perms, setPerms] = useState<PermissionRequest[]>([])
  const [questions, setQuestions] = useState<QuestionRequest[]>([])
  const autoReplied = useRef<Set<string>>(new Set()) // permission ids auto-answered, so we never answer twice
  const [serverDir, setServerDir] = useState('') // the server's own folder, used when no working folder is chosen
  const [safeDirs, setSafeDirs] = useState<string[]>([]) // OpenCode's own data/state folders (plan mode writes plans there)
  const effectiveDir = modes.workdir || serverDir
  // Is the working folder a git repository? Only there does OpenCode keep file snapshots, i.e. the list of changed
  // files and "Rückgängig" work. null = not known yet. Folders where the user said "Nicht mehr fragen" are remembered.
  const [hasGit, setHasGit] = useState<boolean | null>(null)
  const [gitSkip, setGitSkip] = useState<string[]>(() => loadList<string>(GIT_SKIP_KEY))
  useEffect(() => {
    if (!online) return
    let alive = true
    setHasGit(null)
    void projectInfo(modes.workdir).then((p) => { if (alive) setHasGit(p.vcs === 'git') }).catch(() => {})
    return () => { alive = false }
  }, [online, modes.workdir])
  async function enableGit() {
    try {
      // First a .gitignore (and a refusal for the home folder or a drive root): without it OpenCode would snapshot
      // node_modules & co. before every step (measured 86 s instead of 5 s, OD-26). No init if this step fails.
      const prep = await companionPost<{ created: boolean }>('/git/prepare', { path: effectiveDir })
      const p = await gitInit(modes.workdir)
      setHasGit(p.vcs === 'git')
      setCtxNote(p.vcs === 'git'
        ? `Sicherung ist an: ab dem nächsten Auftrag siehst du geänderte Dateien und kannst sie rückgängig machen.${prep.created ? ' Hilfsordner wie node_modules bleiben außen vor (.gitignore angelegt).' : ''}`
        : '')
    } catch (e) { setCtxNote(`Sicherung ließ sich nicht einschalten: ${String((e as Error).message || e)}`) }
  }
  const skipGit = () => { const s = [...gitSkip, effectiveDir]; setGitSkip(s); saveList(GIT_SKIP_KEY, s) }

  // Feed one event into the active turn, the progress, and the pending-request lists.
  const feed = useCallback((e: OcEvent) => {
    setRun((prev) => (prev && !prev.turn.done ? { ...prev, turn: reduceEvent(prev.turn, e), prog: reduceProgress(prev.prog, e, Date.now()) } : prev))
    const p = (e.properties ?? {}) as Record<string, any>
    switch (e.type) {
      case 'permission.asked': setPerms((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, p as PermissionRequest])); break
      case 'permission.replied': { const id = p.requestID ?? p.data?.requestID; setPerms((xs) => xs.filter((x) => x.id !== id)); break }
      case 'question.asked': setQuestions((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, p as QuestionRequest])); break
      case 'question.replied': case 'question.rejected': { const id = p.requestID ?? p.data?.requestID; setQuestions((xs) => xs.filter((x) => x.id !== id)); break }
      case 'todo.updated': if (p.sessionID === sessionRef.current && Array.isArray(p.todos)) setTodos(p.todos as Todo[]); break
    }
  }, [])

  // Connect to the local server; retry every 5 s while it is down (it shares the GPU with OpenDali). On every (re)connect,
  // fetch any requests already waiting, so a reload or a short disconnect never leaves the agent stuck with no visible prompt.
  useEffect(() => {
    let disconnect = () => {}
    let alive = true
    const syncRequests = () => {
      void listPermissions(modes.workdir).then((xs) => { if (alive) setPerms(xs) }).catch(() => {})
      void listQuestions(modes.workdir).then((xs) => { if (alive) setQuestions(xs) }).catch(() => {})
    }
    const check = () => health().then((h) => {
      if (!alive) return
      setOnline(!!h)
      if (h) {
        disconnect = connectEvents(feed, (ok) => setOnline(ok), modes.workdir); syncRequests()
        void serverPaths().then((p) => { if (alive) { setServerDir(p.directory || ''); setSafeDirs(openCodeSafeDirs(p)) } }).catch(() => {})
      }
    })
    check()
    const id = window.setInterval(() => { if (alive && online !== true) check() }, 5000)
    const reSync = window.setInterval(() => { if (alive && online === true) syncRequests() }, 8000) // safety net for a missed event
    return () => { alive = false; disconnect(); window.clearInterval(id); window.clearInterval(reSync); simRef.current() }
  }, [feed, online, modes.workdir])

  // Answer a permission request and drop it from the list.
  const answerPerm = useCallback(async (id: string, reply: 'once' | 'always' | 'reject', message?: string) => {
    setPerms((xs) => xs.filter((x) => x.id !== id))
    await replyPermission(id, reply, modes.workdir, message).catch(() => {})
  }, [modes.workdir])

  // Auto-answer: while "Befehle automatisch erlauben" is on, allow safe requests at once and turn a loop around with a
  // hint, so a long task keeps moving. Risky ones (push, delete) still wait for the user. Runs for event- and poll-found
  // requests alike; `autoReplied` guards against answering the same id twice.
  useEffect(() => {
    if (!modes.autoAllow) return
    for (const p of perms) {
      if (autoReplied.current.has(p.id)) continue
      const d = autoDecision(p, effectiveDir, safeDirs)
      if (!d) continue
      autoReplied.current.add(p.id)
      void answerPerm(p.id, d.reply, 'message' in d ? d.message : undefined)
    }
  }, [perms, modes.autoAllow, answerPerm, effectiveDir, safeDirs])

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
    // The agent of the last answer counts: a plan that was switched to "build" and carried out in the same turn is no
    // longer a plan waiting for "Plan umsetzen".
    const agent = t.agent === 'plan' || t.agent === 'build' ? t.agent : run.agent
    setMessages((m) => [...m, { role: 'assistant', text: t.text, reasoning: t.reasoning, tools: t.tools, error: t.error, agent, userMsg: t.userMsg }])
    if (!run.sim) {
      setUsage((u) => addLocal(u, t)) // the offline preview is not real work, so it is not counted
      // How full is the model's context? The last step read everything so far (instructions + conversation).
      const steps = Object.values(t.perMsg)
      if (steps.length) setCtxUsed(steps[steps.length - 1].input)
      // Keep the model loaded after the answer, so the next question starts at once instead of after ~45 s (OD-15).
      void keepWarm(modes.localModel, modes.keepWarmMin)
      // Which files did this turn change? Shown under the answer with "Ansehen" and "Rückgängig" (OD-09).
      const sid = sessionRef.current
      // OpenCode lists changes per user message; plan mode's switch to build adds a second one inside the turn.
      if (sid && t.userMsg && hasGit !== false) {
        const um = t.userMsg
        void Promise.all(t.userMsgs.map((id) => sessionDiff(sid, id, modes.workdir).catch(() => [] as FileDiff[]))).then((ds) => {
          // Plan mode's own notes (.opencode/plans/*.md in a git folder) are not work the user asked for.
          const files = ds.flat()
            .map((f) => (f.patch ? { ...f, ...cleanPatch(f.patch) } : f)) // line-ending-only changes do not count (OD-31)
            .filter((f) => ((f.additions || 0) + (f.deletions || 0) > 0 || f.status === 'added' || f.status === 'deleted') && !/(^|[\\/])\.opencode[\\/]plans[\\/]/.test(f.file ?? ''))
          setMessages((m) => m.map((x) => (x.role === 'assistant' && x.userMsg === um ? { ...x, changes: files } : x)))
        })
      }
    }
    if (!t.error && t.text.trim() && (modes.offload || modes.audit)) void postProcessClaude(t)
    // Learn how long steps and tasks take on this PC (real runs only; a step cut off by "Stopp" is not a fair sample).
    if (!run.sim && !t.error && produced(t) > 0) {
      const fin = run.stopped ? run.prog : finishStep(run.prog, Date.now())
      if (fin.done.length) {
        const steps = [...stepSamples, ...fin.done].slice(-60)
        setStepSamples(steps); saveList(STEPS_KEY, steps)
      }
      if (!run.stopped) {
        const tasks = [...taskSamples, { ms: Date.now() - run.startedAt, steps: fin.step }].slice(-30)
        setTaskSamples(tasks); saveList(TASKS_KEY, tasks)
      }
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

  /** Send the typed request — or `override` (e.g. "Plan umsetzen", a loop redirect). Plan mode sends it to OpenCode's
   *  read-only "plan" agent; everything else to "build". Undone turns are dropped here, as OpenCode drops them too.
   *  The attached files (chips above the input) go along with a typed request only, never with an `override`. */
  async function send(override?: { text: string; agent: 'plan' | 'build' }) {
    const prompt = (override?.text ?? input).trim()
    if (!prompt || running) return
    const agent = override?.agent ?? (modes.planFirst ? 'plan' : 'build')
    const files = override ? [] : attachments
    if (!override) { setInput(''); setAttachments([]) }
    setCtxNote('')
    setMessages((m) => [...m.filter((x) => !x.reverted), { role: 'user', text: withAttachmentLines(prompt, files) }])
    const startedAt = Date.now()
    setRun({ startedAt, turn: emptyTurn(), prog: startProgress(startedAt), sim: !online, agent })
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
        // Carrying out runs without thinking unless "Gründlich" is chosen; a plan is always thought through (OD-29).
        const variant = agent === 'plan' || modes.thinkMode === 'gruendlich' ? undefined : 'ohne-denken'
        try {
          await sendPrompt(sessionRef.current, text, modes.localModel, modes.workdir, agent, variant, files)
        } catch {
          // A reopened chat whose OpenCode session no longer exists: continue in a fresh session (the window keeps
          // the old messages, the model starts without them).
          sessionRef.current = (await createSession(title, modes.workdir)).id
          await sendPrompt(sessionRef.current, text, modes.localModel, modes.workdir, agent, variant, files)
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
          const r = await claudeOffload(task, modes.claudeModel, modes.claudeDailyUsd)
          setUsage((u) => addClaude(u, 'offload', r.usage))
          finishClaude({ role: 'assistant', kind: 'claude', text: `↗ Teilergebnis von Claude (${r.model}):\n\n${r.text}` })
        } catch (e) { finishClaude({ role: 'assistant', kind: 'claude', text: `↗ Claude-Auslagerung ging nicht: ${String((e as Error).message || e)}` }) }
      }
    }
    if (modes.audit) {
      setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: '🔍 Claude prüft das Ergebnis …', pending: true }])
      try {
        const r = await claudeAudit(text, modes.claudeModel, modes.claudeDailyUsd)
        setUsage((u) => addClaude(u, 'audit', r.usage))
        finishClaude({ role: 'assistant', kind: 'claude', text: `🔍 Claude-Audit (${r.model}):\n\n${r.text}` })
      } catch (e) { finishClaude({ role: 'assistant', kind: 'claude', text: `🔍 Claude-Audit ging nicht: ${String((e as Error).message || e)}` }) }
    }
  }

  async function stopRun() {
    simRef.current() // stop the offline preview if it is the one running
    if (sessionRef.current) await abort(sessionRef.current, modes.workdir)
    setRun((prev) => (prev && !prev.turn.done ? { ...prev, stopped: true, turn: { ...prev.turn, done: true } } : prev))
  }

  // Undo a turn and everything after it (OD-09): OpenCode puts the files back to their state before that turn's user
  // message. The window greys those messages out; "Wiederherstellen" (unrevert) takes it back until the next prompt.
  async function undoTurn(assistantIndex: number) {
    const sid = sessionRef.current
    const um = messages[assistantIndex]?.userMsg
    if (!sid || !um || running) return
    try {
      await revertTo(sid, um, modes.workdir)
      let from = assistantIndex
      while (from > 0 && messages[from].role !== 'user') from--
      setMessages((m) => m.map((x, i) => (i >= from ? { ...x, reverted: true } : x)))
    } catch (e) { setCtxNote(`Rückgängig ging nicht: ${String((e as Error).message || e)}`) }
  }
  async function restoreTurns() {
    const sid = sessionRef.current
    if (!sid) return
    try {
      await unrevert(sid, modes.workdir)
      setMessages((m) => m.map((x) => (x.reverted ? { ...x, reverted: false } : x)))
    } catch (e) { setCtxNote(`Wiederherstellen ging nicht: ${String((e as Error).message || e)}`) }
  }

  // Condense the conversation into a summary to free the model's context window (OD-19).
  async function condense() {
    const sid = sessionRef.current
    if (!sid || running) return
    setCtxNote('verdichtet das bisherige Gespräch …')
    try {
      await summarize(sid, modes.localModel, modes.workdir)
      setCtxUsed(0); setCtxNote('Gespräch verdichtet — das Modell hat wieder Platz.')
    } catch (e) { setCtxNote(`Verdichten ging nicht: ${String((e as Error).message || e)}`) }
  }

  // The agent goes in circles (OD-23): stop it and send a redirect, so it changes course instead of repeating. The
  // redirect waits in a queue until the stopped turn is committed (sending earlier would see "still running").
  const queued = useRef<{ text: string; agent: 'plan' | 'build' } | null>(null)
  async function redirectLoop() {
    queued.current = { text: LOOP_HINT, agent: 'build' }
    await stopRun()
  }
  useEffect(() => {
    if (run || !queued.current) return
    const q = queued.current
    queued.current = null
    void send(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  // Add one or more folders (from the in-app browser) and switch to the first. The workdir effect starts a fresh session.
  function addFolders(paths: string[]) {
    if (paths.length) modes.addFolders(paths)
    setPlusOpen(false)
  }
  // Switch to a saved folder.
  const switchFolder = (path: string) => { modes.set({ workdir: path }); setPlusOpen(false) }
  // Files chosen in the in-app file browser wait as chips above the input until the next message is sent.
  const addAttachments = (files: Attachment[]) => setAttachments((a) => mergeAttachments(a, files))

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
  // For the line under each answer: the latest local answer (gets "Plan umsetzen") and the first undone one ("Wiederherstellen").
  const lastAnswerIndex = messages.reduce((acc, m, i) => (m.role === 'assistant' && !m.kind ? i : acc), -1)
  const firstRevertedAnswer = messages.findIndex((m) => m.reverted && m.role === 'assistant' && !m.kind)
  const loopReason = run && !run.turn.done ? detectLoop(run.turn.tools) : null

  return (
    <div className="flex h-full">
      <ChatSidebar running={running} stopRun={stopRun} startNewChat={startNewChat} setModiOpen={setModiOpen} modesActive={modesActive}
        setSettingsOpen={setSettingsOpen} chats={chats} activeChat={activeChat} openChat={openChat} historyMsg={historyMsg}
        skills={skills} setInput={setInput} inputRef={inputRef} modes={modes} online={online} />

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
            {messages.map((m, i) => (
              <Fragment key={i}>
                <div className={m.reverted ? 'opacity-40' : undefined}><Bubble m={m} /></div>
                {m.role === 'assistant' && !m.kind && !running && !(m.reverted && i !== firstRevertedAnswer) && (
                  <TurnActions
                    info={{ changes: m.changes ?? null, reverted: !!m.reverted, isPlan: m.agent === 'plan' && !m.reverted && !wroteFiles(m), isLast: i === lastAnswerIndex }}
                    onUndo={() => void undoTurn(i)} onRestore={() => void restoreTurns()}
                    onRunPlan={() => void send({ text: 'Setze den Plan jetzt Schritt für Schritt um. Führe dabei die Aufgabenliste und prüfe jeden Schritt.', agent: 'build' })} />
                )}
              </Fragment>
            ))}
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
            {(perms.length > 0 || questions.length > 0) && (
              <RequestCard perms={perms} questions={questions} autoAllow={modes.autoAllow} workdir={effectiveDir} safeDirs={safeDirs}
                onPermission={(id, reply, msg) => void answerPerm(id, reply, msg)}
                onQuestion={(id, answers) => { setQuestions((xs) => xs.filter((x) => x.id !== id)); void replyQuestion(id, answers, modes.workdir).catch(() => {}) }}
                onReject={(id) => { setQuestions((xs) => xs.filter((x) => x.id !== id)); void rejectQuestion(id, modes.workdir).catch(() => {}) }} />
            )}
            {(running || todos.some((t) => t.status === 'pending' || t.status === 'in_progress')) && <TodoCard todos={todos} />}
            {!running && online && hasGit === false && !gitSkip.includes(effectiveDir) && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-[13px]" data-testid="git-hint">
                <span className="min-w-0 flex-1 text-ink2">
                  🛟 In diesem Ordner sind <b>„Rückgängig“</b> und die Liste geänderter Dateien aus. OpenDante kann Dateistände nur in einem
                  Git-Ordner sichern (Git = Versionsverwaltung; legt nur einen versteckten Ordner <span className="mono">.git</span> an).
                </span>
                <span className="flex shrink-0 gap-2">
                  <button className="btn-accent !py-1 !text-[13px]" onClick={() => void enableGit()} data-testid="git-enable">Sicherung einschalten</button>
                  <button className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink3 hover:bg-user" onClick={skipGit} data-testid="git-skip">Nicht mehr fragen</button>
                </span>
              </div>
            )}
            {running && loopReason && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/40 bg-panel px-4 py-2.5 text-[13px]" data-testid="loop-warning">
                <span className="text-amber-300">🔁 {loopReason}</span>
                <button className="btn-accent !py-1 !text-[13px]" onClick={() => void redirectLoop()} data-testid="loop-redirect">Anders weitermachen</button>
              </div>
            )}
            {run && !run.turn.done && <Clock startedAt={run.startedAt} prog={run.prog} tools={run.turn.tools} steps={stepSamples} tasks={taskSamples} model={modes.localModel} waiting={perms.length > 0 || questions.length > 0} retry={run.turn.retry} />}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5" data-testid="attachment-chips">
                {attachments.map((a) => (
                  <span key={a.path} className="inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-line bg-panel py-1 pl-2.5 pr-1 text-[12px] text-ink2" data-testid="attachment-chip" title={a.path}>
                    <span aria-hidden>📎</span>
                    <span className="truncate">{a.name}</span>
                    {isImageName(a.name) && <span className="shrink-0 cursor-help text-ink3" title={IMAGE_HINT} data-testid="attachment-image-hint">🖼 Bild</span>}
                    <button className="shrink-0 rounded-md px-1.5 py-0.5 text-ink3 hover:bg-line hover:text-ink2" title="Entfernen" aria-label={`${a.name} entfernen`}
                      onClick={() => setAttachments((xs) => xs.filter((x) => x.path !== a.path))} data-testid="attachment-remove">✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel px-3 py-2">
              <div className="relative">
                <button className="mb-1 flex size-9 items-center justify-center rounded-full border border-line text-[18px] text-ink2 hover:bg-user" aria-label="Hinzufügen" onClick={() => setPlusOpen((o) => !o)} data-testid="plus">+</button>
                {plusOpen && (
                  <div className="absolute bottom-11 left-0 z-10 w-80 rounded-xl border border-line bg-panel p-1 text-[13px]" data-testid="plus-menu">
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => { setFilePickerOpen(true); setPlusOpen(false) }} data-testid="attach-file">📎 Datei anhängen…</button>
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => { setPickerOpen(true); setPlusOpen(false) }} data-testid="pick-folder">📁 Ordner hinzufügen…</button>
                    {modes.folders.length > 0 && (
                      <div className="mt-1 border-t border-line pt-1">
                        <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-ink3">Arbeitsordner</div>
                        {modes.folders.map((f) => (
                          <div key={f} className={`flex items-center gap-1 rounded-lg px-2 py-1 ${f === modes.workdir ? 'bg-user' : 'hover:bg-user'}`} data-testid="folder-row">
                            <button className="min-w-0 flex-1 text-left" onClick={() => switchFolder(f)} title={f} data-testid="folder-switch">
                              <span className="flex items-center gap-1.5">
                                <span className={`size-1.5 shrink-0 rounded-full ${f === modes.workdir ? 'bg-accent' : 'bg-transparent'}`} />
                                <span className="truncate text-ink2">{baseName(f)}</span>
                              </span>
                              <span className="mono ml-3 block truncate text-[11px] text-ink3">{f}</span>
                            </button>
                            <button className="shrink-0 rounded-md px-1.5 py-1 text-ink3 hover:bg-line hover:text-ink2" title="Aus der Liste entfernen"
                              onClick={() => modes.removeFolder(f)} data-testid="folder-remove">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 border-t border-line px-3 py-1.5 text-[12px] text-ink3">
                      Aktiv: <span className="mono break-all text-ink2">{modes.workdir ? baseName(modes.workdir) : 'Serverordner (Standard)'}</span>
                      {modes.workdir && <button className="ml-2 text-ink3 underline hover:text-ink2" onClick={() => { modes.set({ workdir: '' }); setPlusOpen(false) }}>Standard</button>}
                    </div>
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
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-ink3">
              {/* Plan mode (OD-22): the next request goes to the read-only plan agent; "Plan umsetzen" then runs it. */}
              <label className="inline-flex cursor-pointer items-center gap-1.5" title="Der Agent liest nur und schreibt einen Plan. Unter der Antwort startest du ihn mit „Plan umsetzen“.">
                <input type="checkbox" className="accent-[var(--color-accent)]" checked={modes.planFirst} onChange={(e) => modes.set({ planFirst: e.target.checked })} data-testid="plan-first" />
                <span className={modes.planFirst ? 'text-accent' : ''}>Erst planen, dann umsetzen</span>
              </label>
              <span>{online ? 'Antworten kommen vom lokalen Modell auf deiner Grafikkarte.' : 'Vorschau mit simulierter Antwort — echte Anbindung aktiv, sobald der Server läuft.'}</span>
              {/* Context gauge (OD-19): how full the model's working memory is, and a button to condense the chat. */}
              {ctxUsed > 0 && (
                <span className="inline-flex items-center gap-1.5" data-testid="ctx-gauge"
                  title={`Das Modell sieht höchstens ${fmtExact(CONTEXT_LIMIT)} Tokens auf einmal. Im letzten Schritt waren es ${fmtExact(ctxUsed)} (Anweisungen + Gespräch). Wird es voll, verdichtet OpenCode selbst; „Verdichten“ macht das sofort.`}>
                  <span className="flex h-1.5 w-12 overflow-hidden rounded-full bg-line"><span className={`h-full ${ctxUsed / CONTEXT_LIMIT > 0.75 ? 'bg-amber-400' : 'bg-ink3'}`} style={{ width: `${Math.min(100, (ctxUsed / CONTEXT_LIMIT) * 100)}%` }} /></span>
                  Gedächtnis {Math.round((ctxUsed / CONTEXT_LIMIT) * 100)} % voll
                  {!running && sessionRef.current && <button className="underline hover:text-ink2" onClick={() => void condense()} data-testid="ctx-condense">Verdichten</button>}
                </span>
              )}
            </div>
            {ctxNote && <p className="mt-1 text-center text-[11px] text-accent" data-testid="ctx-note">{ctxNote}</p>}
          </div>
        </div>
      </main>
      <FolderPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addFolders} />
      <FilePicker open={filePickerOpen} onClose={() => setFilePickerOpen(false)} onPick={addAttachments} />
      <ThinkingSidebar open={modes.thinkingOpen} onToggle={() => modes.set({ thinkingOpen: !modes.thinkingOpen })} items={thoughts} />
      <Modi open={modiOpen} onClose={() => setModiOpen(false)} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {load && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" data-testid="model-loading">
          <div className="w-[min(92vw,420px)] rounded-2xl border border-line bg-panel p-5 text-center">
            <div className="text-[15px] font-medium">Modell wird in die Grafikkarte geladen …</div>
            <div className="mt-1 text-[13px] text-ink3"><span className="mono">{localModelName(modes.localModel)}</span> · einmalig, danach bleibt es warm</div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${load.pct}%` }} />
            </div>
            <div className="mono mt-1.5 text-[13px] text-ink2">{load.pct}%</div>
          </div>
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes slide { 0% { left: -33% } 100% { left: 100% } }`}</style>
    </div>
  )
}
