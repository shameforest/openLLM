import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { type Progress, type StepSample, type TaskSample, finishStep, reduceProgress, startProgress } from './progress'
import { type FileDiff, type ModelCaps, type OcEvent, type PermissionRequest, type QuestionRequest, type Todo, abort, activeModelTakesImages, connectEvents, createSession, health, listModelCaps, listPermissions, listQuestions, rejectQuestion, replyPermission, replyQuestion, revertTo, sendPrompt, serverPaths, sessionDiff, sessionMessages, sessionStatus, sessionTodos, summarize, unrevert, projectInfo, gitInit } from './api'
import { LOOP_HINT, autoDecision, fullAutoDecision, matchesAlways, openCodeSafeDirs } from './requests'
import { RequestCard } from './RequestCard'
import { estLoadMs, isLoaded, keepWarm, loadPct, preload, recordLoadMs } from './ollama'
import { companionPost, getKnowledgeContext, getProjectNote, saveImageAttachment } from './companion'
import { ProjectNote } from './ProjectNote'
import { cleanPatch } from './diffs'
import { detectLoop } from './loops'
import { TurnActions } from './TurnActions'
import { TodoCard } from './TodoCard'
import { ActivityCard } from './ActivityCard'
import { type StoredMessage, type Turn, emptyTurn, eventSession, lastTurn, produced, reduceEvent, splitThinking, turnFromMessages } from './stream'
import { AUTOPILOT_PREFIX, OFFLOAD_SHARE_MAX, localModelName, useSettings } from './settings'
import { expandSkillCommand, useSkills } from './skills'
import { FolderPicker, baseName } from './FolderPicker'
import { FilePicker } from './FilePicker'
import { type Attachment, IMAGE_HINT, blobToBase64, isImageName, mergeAttachments, withAttachmentLines } from './attachments'
import { OFFLOAD_PREFIX, claudeAudit, claudeImprove, claudeOffload, claudeShareBelow, offloadAllowed, offloadBudget, offloadTasks, setOffloadPrefs } from './claude'
import { type ChatUsage, addClaude, addLocal, emptyUsage, fmtExact, turnTokens } from './usage'
import { type Thought, ThinkingSidebar } from './ThinkingSidebar'
import { chatTitle, newChatId, useChats } from './chats'
import { Modi } from './Modi'
import { Settings } from './SettingsPanel'
import { type Msg, CONTEXT_LIMIT, toThought, wroteFiles } from './messages'
import { ALWAYS_KEY, GIT_SKIP_KEY, STEPS_KEY, TASKS_KEY, type AlwaysGrant, loadList, loadMap, saveList, saveMap } from './storage'
import { AlwaysAllowed } from './AlwaysAllowed'
import { FullAutoConfirm } from './FullAutoConfirm'
import { ProjectPanel } from './ProjectPanel'
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

// Sent by the "Fortsetzen" button after a stopped or interrupted turn: the agent first checks where it stood (its task
// list / FORTSCHRITT.md and the files on disk) and then carries on, instead of starting over.
const CONTINUE_PROMPT =
  'Mach dort weiter, wo du aufgehört hast. Sieh dir zuerst deinen Stand an: deine Aufgabenliste (todowrite) ' +
  'bzw. FORTSCHRITT.md, falls vorhanden, und den aktuellen Stand der Dateien im Arbeitsordner. Setze dann die ' +
  'nächste offene Teilaufgabe um. Wiederhole nichts, was schon fertig ist.'

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  // `gap`: the live stream was interrupted during this turn, so events may be missing (AN-05) — the answer is re-read
  // from the server at the end and the turn is not used to learn timings.
  const [run, setRun] = useState<{ startedAt: number; turn: Turn; prog: Progress; sim?: boolean; stopped?: boolean; gap?: boolean; agent: 'plan' | 'build' } | null>(null)
  const runRef = useRef(run)
  runRef.current = run
  const [todos, setTodos] = useState<Todo[]>([]) // the agent's own task list for the current chat (OD-18)
  const [todosAt, setTodosAt] = useState(0) // when the model last changed its list (live todo.updated), 0 = not seen (OD-56)
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
  const modesActive = [modes.autopilot, modes.offloadShare > 0 || modes.offloadMin > 0, modes.audit].filter(Boolean).length
  const [modiOpen, setModiOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([]) // files chosen for the next message ("Datei anhängen")
  const [projectNote, setProjectNote] = useState('') // OD-41: per-project memory, prepended to every prompt in this folder
  const [noteOpen, setNoteOpen] = useState(false)
  const [always, setAlways] = useState<Record<string, AlwaysGrant[]>>(() => loadMap<AlwaysGrant>(ALWAYS_KEY)) // OD-63: folder → standing "Immer erlauben" grants
  const [alwaysOpen, setAlwaysOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false) // OD-73: the project view (name, instructions, knowledge, capacity)
  const [historyMsg, setHistoryMsg] = useState('')
  const sessionRef = useRef<string | null>(null)
  const simRef = useRef<() => void>(() => {})
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chats = useChats()
  const chatRef = useRef<{ id: string; createdAt: number; title: string } | null>(null) // the chat being saved
  const lastPromptRef = useRef('') // the last user request (clean text), for the MIN-floor "Claude verbessert das Ergebnis" call
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
    setFullAuto(false); autoRejectedQ.current.clear() // OD-71: a fresh chat is never silently in Voll-Automatik
    setTodos([]); setTodosAt(0); setCtxUsed(0); setCtxNote('')
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

  // Save the chat so it can be reopened and continued later. Save the whole state (messages + session id + usage) to
  // the companion. Placeholders ("Claude bearbeitet …") are left out so a reopened chat never shows a stuck one.
  const usageRef = useRef(usage)
  usageRef.current = usage
  const persistChat = useCallback((msgs: Msg[], u: ChatUsage = usageRef.current) => {
    const c = chatRef.current
    if (!c || msgs.length === 0) return
    void chats.save({
      id: c.id, title: c.title, createdAt: c.createdAt, workdir: modes.workdir, model: modes.localModel,
      sessionId: sessionRef.current, messages: msgs.filter((m) => !m.pending), usage: u,
    }).catch(() => { /* companion not running: the chat stays in the window, the next save retries */ })
  }, [modes.workdir, modes.localModel]) // eslint-disable-line react-hooks/exhaustive-deps
  // Debounced save after each answer and Claude reply (and whenever the transcript settles while idle).
  useEffect(() => {
    if (run || messages.length === 0) return
    const id = window.setTimeout(() => persistChat(messages), 400)
    return () => window.clearTimeout(id)
  }, [messages, usage, run, persistChat])

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
      setTodos([]); setTodosAt(0); setCtxUsed(0); setCtxNote('')
      if (c.sessionId) void sessionTodos(c.sessionId, c.workdir || '').then(setTodos).catch(() => {})
      if ((c.workdir || '') !== modes.workdir) { resumeDirRef.current = c.workdir || ''; modes.set({ workdir: c.workdir || '' }) }
      if (c.sessionId) void syncFromServer(c.sessionId, c.workdir || '', c.messages) // catch up on work done while closed
    } catch (e) {
      setHistoryMsg(`Chat ließ sich nicht öffnen: ${String((e as Error).message || e)}`)
    }
    void ensureLoaded() // start loading the model into the GPU while the user reads the reopened chat
  }

  // Reconcile a reopened chat with the OpenCode server: the turn may have finished — or still be running — while the
  // window was closed (AN: resume after stop / close / shutdown). If the session is still busy, re-attach the live view
  // so the running answer streams in; if the last saved message is an unanswered prompt, fetch the answer the server
  // produced in the meantime and append it. Only reads from the server; the local session keeps all its context.
  async function syncFromServer(sid: string, workdir: string, saved: Msg[]) {
    if (online !== true) return
    let status: Record<string, import('./api').SessionStatus> = {}
    try { status = await sessionStatus(workdir) } catch { return }
    if (sid !== sessionRef.current) return
    const busy = !!status[sid] && status[sid].type !== 'idle'
    const lastIsUser = saved.length > 0 && saved[saved.length - 1].role === 'user'
    if (!busy && !lastIsUser) return // nothing changed since the chat was saved
    let msgs: StoredMessage[]
    try { msgs = await sessionMessages(sid, workdir) } catch { return }
    if (sid !== sessionRef.current) return
    const turn = lastTurn(msgs)
    if (busy) {
      // The agent is still working: re-attach a live view. The stream (filtered to this session) keeps updating it and
      // the commit effect ends it on idle. gap=true so this partly-known turn is not used to learn timings.
      const startedAt = Date.now()
      setRun({ startedAt, turn, prog: startProgress(startedAt), gap: true, agent: turn.agent === 'plan' ? 'plan' : 'build' })
      return
    }
    // Idle and the last saved message had no answer: the turn finished while the window was closed. Append its result.
    if (lastIsUser && (turn.text.trim() || turn.tools.length > 0 || turn.error)) {
      const answer: Msg = { role: 'assistant', text: turn.text, reasoning: turn.reasoning, tools: turn.tools, error: turn.error, agent: turn.agent === 'plan' ? 'plan' : 'build', userMsg: turn.userMsg }
      const next = [...saved, answer]
      setMessages(next)
      if (!turn.error) { const u = addLocal(usageRef.current, turn); setUsage(u); persistChat(next, u) } else persistChat(next)
      if (turn.perMsg && Object.values(turn.perMsg).length) setCtxUsed(Object.values(turn.perMsg).slice(-1)[0].input)
    }
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

  // Mirror the "Claude-Hilfe" slider and the daily cap to the companion, so the MCP offload tool (which OpenCode calls
  // without the browser) uses the same on/off and budget.
  useEffect(() => {
    const id = window.setTimeout(() => { void setOffloadPrefs(modes.offloadShare, modes.claudeDailyUsd).catch(() => {}) }, 400)
    return () => window.clearTimeout(id)
  }, [modes.offloadShare, modes.claudeDailyUsd])

  // OD-41: keep the current project's note loaded (empty for the default server folder) so send() can prepend it, and
  // refresh it when the working folder changes (and after a turn — the agent may have written it via "kennenlernen").
  const loadNote = useCallback(() => {
    if (online !== true || !modes.workdir) { setProjectNote(''); return }
    void getProjectNote(modes.workdir).then((r) => setProjectNote(r.note || '')).catch(() => {})
  }, [online, modes.workdir])
  useEffect(() => { loadNote() }, [loadNote])

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
  const [fullAuto, setFullAuto] = useState(false) // OD-71: run the current turn to the end, auto-answering EVERY prompt (per run, resets when done)
  const [fullAutoConfirm, setFullAutoConfirm] = useState(false) // the one-time risk dialog is open
  const autoRejectedQ = useRef<Set<string>>(new Set()) // question ids auto-skipped in Full Auto, so we never answer twice
  const [serverDir, setServerDir] = useState('') // the server's own folder, used when no working folder is chosen
  const [safeDirs, setSafeDirs] = useState<string[]>([]) // OpenCode's own data/state folders (plan mode writes plans there)
  const [modelCaps, setModelCaps] = useState<Record<string, ModelCaps>>({}) // OD-72: what the running OpenCode says each model can take (image?)
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
    // The stream carries every session of the folder (a second window, the terminal app, a run left over from the
    // previous chat). Only this chat's session may change the answer or end it (AN-06).
    const sid = eventSession(e)
    if (!sid || !sessionRef.current || sid === sessionRef.current)
      setRun((prev) => (prev && !prev.turn.done ? { ...prev, turn: reduceEvent(prev.turn, e), prog: reduceProgress(prev.prog, e, Date.now()) } : prev))
    const p = (e.properties ?? {}) as Record<string, any>
    switch (e.type) {
      case 'permission.asked': setPerms((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, p as PermissionRequest])); break
      case 'permission.replied': { const id = p.requestID ?? p.data?.requestID; setPerms((xs) => xs.filter((x) => x.id !== id)); break }
      case 'question.asked': setQuestions((xs) => (xs.some((x) => x.id === p.id) ? xs : [...xs, p as QuestionRequest])); break
      case 'question.replied': case 'question.rejected': { const id = p.requestID ?? p.data?.requestID; setQuestions((xs) => xs.filter((x) => x.id !== id)); break }
      case 'todo.updated': if (p.sessionID === sessionRef.current && Array.isArray(p.todos)) { setTodos(p.todos as Todo[]); setTodosAt(Date.now()) } break
    }
  }, [])

  // Events can be missed while the stream reconnects — among them the one that ends the turn, which left the window
  // on "läuft" forever (AN-05). So ask the server directly: is this chat's session still working? If not, the answer
  // is read back from the stored messages and the turn ends. `afterGap`: called right after a reconnect (any age);
  // otherwise it is the periodic watchdog, which leaves young turns alone (the server may not have started yet).
  const resyncRun = useCallback(async (afterGap: boolean) => {
    const r = runRef.current, sid = sessionRef.current
    if (!r || r.turn.done || r.sim || !sid) return
    if (afterGap) setRun((prev) => (prev && prev.startedAt === r.startedAt ? { ...prev, gap: true } : prev))
    else if (Date.now() - r.startedAt < 15_000) return
    let busy: boolean
    try { const st = await sessionStatus(modes.workdir); busy = !!st[sid] && st[sid].type !== 'idle' } catch { return }
    if (busy) return
    let msgs: Awaited<ReturnType<typeof sessionMessages>>
    try { msgs = await sessionMessages(sid, modes.workdir) } catch { return }
    if (sid !== sessionRef.current) return
    setRun((prev) => (prev && prev.startedAt === r.startedAt && !prev.turn.done
      ? { ...prev, gap: true, turn: { ...turnFromMessages(prev.turn, msgs, prev.startedAt), done: true, retry: null } } : prev))
  }, [modes.workdir])

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
        void resyncRun(true) // a turn running across a reconnect may have ended unseen
        void serverPaths().then((p) => { if (alive) { setServerDir(p.directory || ''); setSafeDirs(openCodeSafeDirs(p)) } }).catch(() => {})
        void listModelCaps().then((c) => { if (alive) setModelCaps(c) }) // OD-72: so we can warn if the running model can't read images
      }
    })
    check()
    const id = window.setInterval(() => { if (alive && online !== true) check() }, 5000)
    // safety net for a missed event: open requests, and a turn whose end never arrived
    const reSync = window.setInterval(() => { if (alive && online === true) { syncRequests(); void resyncRun(false) } }, 8000)
    return () => { alive = false; disconnect(); window.clearInterval(id); window.clearInterval(reSync); simRef.current() }
  }, [feed, online, modes.workdir, resyncRun])

  // Answer a permission request and drop it from the list.
  const answerPerm = useCallback(async (id: string, reply: 'once' | 'always' | 'reject', message?: string) => {
    setPerms((xs) => xs.filter((x) => x.id !== id))
    await replyPermission(id, reply, modes.workdir, message).catch(() => {})
  }, [modes.workdir])

  // OD-63: record a standing "Immer erlauben" grant for the current folder. OpenDante keeps the list (so it can be shown
  // and revoked under "Dauer-Freigaben"); matching requests are then answered by OpenDante itself with "einmal", instead
  // of handing OpenCode an opaque rule we could no longer see or take back.
  const grantAlways = useCallback((pats: string[], kind: string) => {
    if (!pats.length) return
    setAlways((a) => {
      const have = a[effectiveDir] ?? []
      const add = pats.filter((p) => !have.some((g) => g.pat === p)).map((p) => ({ pat: p, kind, at: Date.now() }))
      if (!add.length) return a
      const next = { ...a, [effectiveDir]: [...have, ...add] }
      saveMap(ALWAYS_KEY, next)
      return next
    })
  }, [effectiveDir])
  const revokeAlways = useCallback((pat: string) => setAlways((a) => {
    const next = { ...a, [effectiveDir]: (a[effectiveDir] ?? []).filter((g) => g.pat !== pat) }
    saveMap(ALWAYS_KEY, next); return next
  }), [effectiveDir])
  const clearAlways = useCallback(() => setAlways((a) => { const next = { ...a, [effectiveDir]: [] }; saveMap(ALWAYS_KEY, next); return next }), [effectiveDir])

  // From the card: "Immer erlauben" becomes a stored grant plus a one-off yes; "Einmal"/"Ablehnen" go straight through.
  const onPermissionReply = useCallback((id: string, reply: 'once' | 'always' | 'reject', message?: string) => {
    if (reply === 'always') {
      const p = perms.find((x) => x.id === id)
      if (p) grantAlways(p.always ?? [], p.permission)
      void answerPerm(id, 'once', message)
      return
    }
    void answerPerm(id, reply, message)
  }, [perms, grantAlways, answerPerm])

  // Auto-answer: honour a standing "Immer erlauben" grant first (the user's own rule, even if general auto-allow is off);
  // then, while "Befehle automatisch erlauben" is on, allow safe requests at once and turn a loop around with a hint, so
  // a long task keeps moving. Risky ones (push, delete) still wait. Runs for event- and poll-found requests alike;
  // `autoReplied` guards against answering the same id twice.
  useEffect(() => {
    for (const p of perms) {
      if (autoReplied.current.has(p.id)) continue
      // OD-71: Voll-Automatik grants everything (only loops get turned around), so the run never stops for a prompt.
      if (fullAuto) { autoReplied.current.add(p.id); const d = fullAutoDecision(p); void answerPerm(p.id, d.reply, 'message' in d ? d.message : undefined); continue }
      if (matchesAlways(p, always[effectiveDir] ?? [])) { autoReplied.current.add(p.id); void answerPerm(p.id, 'once'); continue }
      if (!modes.autoAllow) continue
      const d = autoDecision(p, effectiveDir, safeDirs)
      if (!d) continue
      autoReplied.current.add(p.id)
      void answerPerm(p.id, d.reply, 'message' in d ? d.message : undefined)
    }
  }, [perms, fullAuto, modes.autoAllow, answerPerm, effectiveDir, safeDirs, always])

  // OD-71: in Voll-Automatik skip every question too, so the agent decides itself ("die K.I. wählt den Weg selbst").
  useEffect(() => {
    if (!fullAuto) return
    for (const q of questions) {
      if (autoRejectedQ.current.has(q.id)) continue
      autoRejectedQ.current.add(q.id)
      setQuestions((xs) => xs.filter((x) => x.id !== q.id))
      void rejectQuestion(q.id, modes.workdir).catch(() => {})
    }
  }, [questions, fullAuto, modes.workdir])

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
    setFullAuto(false) // OD-71: the run is over → disarm Voll-Automatik; the next prompt needs a fresh click
    autoRejectedQ.current.clear()
    const t = run.turn
    // The agent of the last answer counts: a plan that was switched to "build" and carried out in the same turn is no
    // longer a plan waiting for "Plan umsetzen".
    const agent = t.agent === 'plan' || t.agent === 'build' ? t.agent : run.agent
    const answer: Msg = { role: 'assistant', text: t.text, reasoning: t.reasoning, tools: t.tools, error: t.error, agent, userMsg: t.userMsg, stopped: run.stopped || run.gap || undefined }
    setMessages((m) => [...m, answer])
    // The stream had a gap during this turn: parts of the text may be missing — take the server's stored version.
    if (run.gap && !run.sim && sessionRef.current) {
      const sid = sessionRef.current, um = t.userMsg, since = run.startedAt
      void sessionMessages(sid, modes.workdir).then((msgs) => {
        const full = turnFromMessages(t, msgs, since)
        setMessages((m) => m.map((x) => ((um ? x.role === 'assistant' && x.userMsg === um : x === answer)
          ? { ...x, text: full.text, reasoning: full.reasoning, tools: full.tools, userMsg: x.userMsg ?? full.userMsg } : x)))
      }).catch(() => { /* keep what arrived live */ })
    }
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
    // Hand suitable work to Claude — but never for the offline demo or a turn the user stopped (AN-08).
    if (!run.sim && !run.stopped && !run.gap && !t.error && t.text.trim() && (modes.offloadShare > 0 || modes.offloadMin > 0 || modes.audit)) {
      const localTotal = usageRef.current.local + turnTokens(t).tokens
      void postProcessClaude(t, localTotal)
    }
    // Learn how long steps and tasks take on this PC (real runs only; a step cut off by "Stopp" is not a fair sample).
    if (!run.sim && !run.gap && !t.error && produced(t) > 0) {
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
    if (!run.sim) loadNote() // OD-41: the agent may have written/updated the project note this turn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.turn.done])

  const running = !!run && !run.turn.done
  // The chat looks interrupted (a stop, a closed window, a shutdown mid-answer): the last message is an unanswered
  // prompt, or the last answer errored or stayed empty. Then offer "Fortsetzen" instead of making the user retype.
  const lastMsg = messages[messages.length - 1]
  const openTodos = todos.some((t) => t.status === 'pending' || t.status === 'in_progress')
  // Offer "Fortsetzen" when the chat was cut short: an unanswered prompt, an errored or empty answer, a turn marked
  // stopped (Stopp or a stream gap), or an answer that still has open task-list items (a big task left half-done).
  const canContinue = !running && online === true && !!sessionRef.current && !!lastMsg && !lastMsg.kind &&
    (lastMsg.role === 'user' || !!lastMsg.error || !!lastMsg.stopped || openTodos ||
      (lastMsg.role === 'assistant' && !lastMsg.text.trim() && !(lastMsg.tools?.length)))

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
    lastPromptRef.current = prompt // remembered for a possible MIN-floor improvement of this turn's answer
    const agent = override?.agent ?? (modes.planFirst ? 'plan' : 'build')
    const files = override ? [] : attachments
    if (!override) { setInput(''); setAttachments([]) }
    setCtxNote('')
    const userMsg: Msg = { role: 'user', text: withAttachmentLines(prompt, files) }
    const nextMsgs = [...messages.filter((x) => !x.reverted), userMsg]
    setMessages(nextMsgs)
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
        if (modes.offloadShare > 0) text = OFFLOAD_PREFIX + text // let the local model mark benign subtasks for Claude
        // OD-73: project knowledge as reference context — all of it when it fits the window, else the parts most relevant
        // to this prompt (local search). Empty/offline → nothing prepended, so it never blocks sending.
        if (modes.workdir) { const kc = await getKnowledgeContext(modes.workdir, prompt); if (kc.text.trim()) text = `Projektwissen (Referenz zu diesem Projekt):\n${kc.text.trim()}\n\n${text}` }
        if (projectNote.trim()) text = `Projektnotiz zu diesem Projekt (dauerhafter Kontext):\n${projectNote.trim()}\n\n${text}` // OD-41
        const gi = modes.globalInstructions.trim()
        if (gi) text = `${gi}\n\n${text}` // global instructions apply to every message
        const title = chatRef.current.title
        if (!sessionRef.current) sessionRef.current = (await createSession(title, modes.workdir)).id
        // Save the chat NOW, with the prompt and the session id — so closing the window or a shutdown mid-answer still
        // leaves a chat in the Verlauf that can be reopened and continued (the answer is fetched back from the server).
        persistChat(nextMsgs)
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
  // Each finished call adds its exact API token usage to the chat counter above the chat box right away. `localTotal` =
  // the task's local tokens so far; the slider's share caps how much Claude output may be added on top (budget), and a
  // safety gate keeps sensitive or policy-risky blocks local no matter what the local model marked.
  async function postProcessClaude(t: Turn, localTotal: number) {
    const text = splitThinking(t.text).answer || t.text // review/offload the final answer, not the thinking
    const myChat = chatRef.current?.id // a Claude reply must land in the chat it belongs to, not whichever is open now
    const inChat = (final: Msg) => { if (chatRef.current?.id === myChat) finishClaude(final) }
    let claudeOut = usageRef.current.claudeOut
    if (modes.offloadShare > 0) {
      for (const task of offloadTasks(text)) {
        const gate = offloadAllowed(task)
        if (!gate.ok) { if (chatRef.current?.id === myChat) setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: `↗ Teilaufgabe ${gate.reason}` }]); continue }
        if (offloadBudget(modes.offloadShare, localTotal, claudeOut) < 50) { // share of the task reached
          if (chatRef.current?.id === myChat) setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: `↗ Claude-Budget für diese Aufgabe erreicht (${Math.round(modes.offloadShare * 100)} %) – den Rest macht das lokale Modell.` }])
          break
        }
        if (chatRef.current?.id === myChat) setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: '↗ Claude bearbeitet eine Teilaufgabe …', pending: true }])
        try {
          const r = await claudeOffload(task, modes.claudeModel, modes.claudeDailyUsd)
          claudeOut += r.usage?.output_tokens ?? 0
          setUsage((u) => addClaude(u, 'offload', r.usage))
          inChat({ role: 'assistant', kind: 'claude', text: `↗ Teilergebnis von Claude (${r.model}):\n\n${r.text}` })
        } catch (e) { inChat({ role: 'assistant', kind: 'claude', text: `↗ Claude-Auslagerung ging nicht: ${String((e as Error).message || e)}` }) }
      }
    }
    // MIN floor (Claude-Hilfe): the local model offloaded little or nothing, so Claude's share stayed below the minimum
    // → have Claude improve the finished answer once, so at least some Claude value is guaranteed (the user's wish).
    if (claudeShareBelow(modes.offloadMin, localTotal, claudeOut)) {
      if (chatRef.current?.id === myChat) setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: '↗ Claude verbessert das Ergebnis …', pending: true }])
      try {
        const r = await claudeImprove(lastPromptRef.current, text, modes.claudeModel, modes.claudeDailyUsd)
        claudeOut += r.usage?.output_tokens ?? 0
        setUsage((u) => addClaude(u, 'improve', r.usage))
        inChat({ role: 'assistant', kind: 'claude', text: `↗ Von Claude verbesserte Fassung (${r.model}):\n\n${r.text}` })
      } catch (e) { inChat({ role: 'assistant', kind: 'claude', text: `↗ Claude-Verbesserung ging nicht: ${String((e as Error).message || e)}` }) }
    }
    if (modes.audit) {
      if (chatRef.current?.id === myChat) setMessages((m) => [...m, { role: 'assistant', kind: 'claude', text: '🔍 Claude prüft das Ergebnis …', pending: true }])
      try {
        const r = await claudeAudit(text, modes.claudeModel, modes.claudeDailyUsd)
        setUsage((u) => addClaude(u, 'audit', r.usage))
        inChat({ role: 'assistant', kind: 'claude', text: `🔍 Claude-Audit (${r.model}):\n\n${r.text}` })
      } catch (e) { inChat({ role: 'assistant', kind: 'claude', text: `🔍 Claude-Audit ging nicht: ${String((e as Error).message || e)}` }) }
    }
  }

  async function stopRun() {
    setFullAuto(false) // stopping disarms Voll-Automatik
    simRef.current() // stop the offline preview if it is the one running
    if (sessionRef.current) await abort(sessionRef.current, modes.workdir)
    setRun((prev) => (prev && !prev.turn.done ? { ...prev, stopped: true, turn: { ...prev.turn, done: true } } : prev))
  }

  // OD-71: arm Voll-Automatik for THIS prompt and send it. The very first time, show the one-time risk notice instead.
  function runFullAuto() {
    if (!input.trim() || running) return
    if (!modes.fullAutoAck) { setFullAutoConfirm(true); return }
    setFullAuto(true)
    void send()
  }
  function confirmFullAuto() {
    modes.set({ fullAutoAck: true })
    setFullAutoConfirm(false)
    setFullAuto(true)
    void send()
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

  // Images pasted (Strg+V) or dropped into the prompt box: the browser can't write to disk, so the companion saves each
  // one and returns its path; then it attaches like a picked file and the vision model reads it with the next message.
  const [attaching, setAttaching] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  async function attachImages(items: { name: string; blob: Blob }[]) {
    if (!items.length) return
    setAttaching((n) => n + items.length)
    for (const { name, blob } of items) {
      try {
        const saved = await saveImageAttachment(name, await blobToBase64(blob))
        addAttachments([{ path: saved.path, name: saved.name, size: saved.size }])
      } catch (e) { setCtxNote(`Bild konnte nicht angehängt werden: ${String((e as Error).message || e)}`) }
      finally { setAttaching((n) => n - 1) }
    }
  }
  const imagesFrom = (list: DataTransferItemList | null | undefined): { name: string; blob: File }[] =>
    [...(list ?? [])].filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it, i) => { const f = it.getAsFile(); return f ? { name: f.name || `einfuegung-${Date.now()}-${i}.${it.type.split('/')[1] || 'png'}`, blob: f } : null })
      .filter((x): x is { name: string; blob: File } => !!x)

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
            {/* Claude-Hilfe (OD-64): two sliders — "Höchstens" caps how much Claude may take over opportunistically
                (benign subtasks the local model marks); "Mindestens" is a floor — if the local model offloaded too
                little, Claude improves the finished answer so a bit of Claude value is guaranteed. A safety gate still
                decides WHAT may leave the PC. MIN ≤ MAX is enforced: moving one thumb past the other pushes the other. */}
            <div className="mb-2" data-testid="offload-row">
              <div className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-[12px] text-ink2">↗ Claude-Hilfe</span>
                {(modes.offloadShare > 0 || modes.offloadMin > 0 || modes.audit) && <UsageReadout u={shownUsage} />}
              </div>
              <div className="mt-1 flex items-center gap-3">
                <label htmlFor="offload-share" className="w-[72px] shrink-0 text-[11px] text-ink3" title="So viel darf Claude höchstens von der Aufgabe übernehmen — nur unbedenkliche, in sich geschlossene Teilaufgaben.">Höchstens</label>
                <input id="offload-share" type="range" min={0} max={Math.round(OFFLOAD_SHARE_MAX * 100)} step={5}
                  value={Math.round(modes.offloadShare * 100)}
                  onChange={(e) => { const v = Number(e.target.value) / 100; modes.set({ offloadShare: v, ...(v < modes.offloadMin ? { offloadMin: v } : {}) }) }}
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-accent" data-testid="offload-share" aria-label="Höchstens an Claude" />
                <span className="mono w-9 shrink-0 text-right text-[12px] text-ink2" data-testid="offload-share-value">{Math.round(modes.offloadShare * 100)} %</span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <label htmlFor="offload-min" className="w-[72px] shrink-0 text-[11px] text-ink3" title="Erreicht Claude diesen Anteil nicht von selbst, lässt OpenDante die fertige Antwort einmal von Claude verbessern.">Mindestens</label>
                <input id="offload-min" type="range" min={0} max={Math.round(OFFLOAD_SHARE_MAX * 100)} step={5}
                  value={Math.round(modes.offloadMin * 100)}
                  onChange={(e) => { const v = Number(e.target.value) / 100; modes.set({ offloadMin: v, ...(v > modes.offloadShare ? { offloadShare: v } : {}) }) }}
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-accent" data-testid="offload-min" aria-label="Mindestens von Claude" />
                <span className="mono w-9 shrink-0 text-right text-[12px] text-ink2" data-testid="offload-min-value">{Math.round(modes.offloadMin * 100)} %</span>
              </div>
              {(modes.offloadShare > 0 || modes.offloadMin > 0) && !modes.apiKey.trim() ? (
                <div className="mt-1 text-[11px] text-amber-400/90" data-testid="offload-nokey">Dafür fehlt noch dein Claude-Schlüssel — Einstellungen → Claude-Verbindung. Bis dahin bleibt alles lokal.</div>
              ) : (
                <div className="mt-1 text-[11px] text-ink3" data-testid="offload-help">
                  {modes.offloadShare === 0 && modes.offloadMin === 0
                    ? 'Aus — alles läuft lokal und kostenlos. „Höchstens“ lässt Claude unbedenkliche Teilaufgaben übernehmen; „Mindestens“ lässt Claude die fertige Antwort verbessern, falls das lokale Modell zu wenig abgibt (kostet API-Gebühren).'
                    : [
                        modes.offloadShare > 0
                          ? `Bis zu ${Math.round(modes.offloadShare * 100)} % gehen an Claude (${modes.claudeModel}) — nur unbedenkliche, in sich geschlossene Teile, Sensibles bleibt lokal.`
                          : 'Kein selbsttätiges Auslagern von Teilaufgaben.',
                        modes.offloadMin > 0
                          ? `Mindestens ${Math.round(modes.offloadMin * 100)} %: Bleibt Claudes Anteil darunter, verbessert Claude am Ende die fertige Antwort.`
                          : '',
                      ].filter(Boolean).join(' ')}
                </div>
              )}
            </div>
            {(perms.length > 0 || questions.length > 0) && (
              <RequestCard perms={perms} questions={questions} autoAllow={modes.autoAllow} workdir={effectiveDir} safeDirs={safeDirs}
                onPermission={onPermissionReply}
                onQuestion={(id, answers) => { setQuestions((xs) => xs.filter((x) => x.id !== id)); void replyQuestion(id, answers, modes.workdir).catch(() => {}) }}
                onReject={(id) => { setQuestions((xs) => xs.filter((x) => x.id !== id)); void rejectQuestion(id, modes.workdir).catch(() => {}) }} />
            )}
            {(running || todos.some((t) => t.status === 'pending' || t.status === 'in_progress')) && (
              <>
                <TodoCard todos={todos} />
                {/* OD-56: the model does not always update its list while it works — say so, and point to the live activity. */}
                {running && todosAt > 0 && Date.now() - todosAt > 120_000 && (
                  <div className="mb-2 -mt-1 px-1 text-[12px] text-ink3" data-testid="todo-stale">
                    Liste zuletzt vor {Math.round((Date.now() - todosAt) / 60_000)} Min aktualisiert — der Agent arbeitet weiter, er aktualisiert sie nicht immer sofort (siehe unten).
                  </div>
                )}
              </>
            )}
            {/* OD-55: what the agent is really doing now — independent of whether it maintains its task list. */}
            {run && !run.turn.done && run.turn.tools.length > 0 && <ActivityCard tools={run.turn.tools} />}
            {/* OD-71: a loud, always-visible reminder while Voll-Automatik runs, with a Stop. */}
            {running && fullAuto && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-accent bg-accent/10 px-4 py-2.5 text-[13px]" data-testid="full-auto-banner">
                <span className="flex items-center gap-2 text-accent">
                  <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden />
                  ⚡ Voll-Automatik läuft — alle Freigaben und Rückfragen werden automatisch beantwortet, bis der Auftrag fertig ist.
                </span>
                <button className="btn-accent shrink-0 !py-1 !text-[13px]" onClick={() => void stopRun()} data-testid="full-auto-stop">Stoppen</button>
              </div>
            )}
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
            {canContinue && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-[13px]" data-testid="continue-bar">
                <span className="min-w-0 flex-1 text-ink2">
                  ⏸ Dieser Auftrag wurde unterbrochen. OpenDante macht dort weiter, wo es aufgehört hat — es prüft zuerst seinen Stand und die Dateien.
                </span>
                <button className="btn-accent shrink-0 !py-1 !text-[13px]" onClick={() => void send({ text: CONTINUE_PROMPT, agent: 'build' })} data-testid="continue-run">Fortsetzen</button>
              </div>
            )}
            {(attachments.length > 0 || attaching > 0) && (
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
                {attaching > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-panel px-2.5 py-1 text-[12px] text-ink3" data-testid="attachment-pending">🖼 Bild wird angehängt…</span>}
              </div>
            )}
            {/* OD-72: fail loud — if the running OpenCode reports no image support for the active local model, say so
                instead of silently sending text-only and getting "I can't read images". Usually a stale config → restart. */}
            {attachments.some((a) => isImageName(a.name)) && activeModelTakesImages(modelCaps, 'ollama', modes.localModel) === false && (
              <div className="mb-2 rounded-xl border border-amber-400/50 bg-panel px-4 py-2.5 text-[13px]" data-testid="image-unsupported">
                <span className="text-amber-300">⚠ Das aktive lokale Modell liest gerade keine Bilder. Bitte OpenDante einmal neu starten (Desktop-Icon) — sonst wird das Bild ignoriert und das Modell antwortet, es könne keine Bilder lesen.</span>
              </div>
            )}
            <div className={`flex items-end gap-2 rounded-2xl border bg-panel px-3 py-2 ${dragOver ? 'border-accent ring-2 ring-accent/40' : 'border-line'}`}
              onDragOver={(e) => { if ([...(e.dataTransfer?.items ?? [])].some((it) => it.kind === 'file')) { e.preventDefault(); setDragOver(true) } }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
              onDrop={(e) => { const imgs = imagesFrom(e.dataTransfer?.items); if (imgs.length) { e.preventDefault(); setDragOver(false); void attachImages(imgs) } else setDragOver(false) }}>
              <div className="relative">
                <button className="mb-1 flex size-9 items-center justify-center rounded-full border border-line text-[18px] text-ink2 hover:bg-user" aria-label="Hinzufügen" onClick={() => setPlusOpen((o) => !o)} data-testid="plus">+</button>
                {plusOpen && (
                  <div className="absolute bottom-11 left-0 z-10 w-80 rounded-xl border border-line bg-panel p-1 text-[13px]" data-testid="plus-menu">
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => { setFilePickerOpen(true); setPlusOpen(false) }} data-testid="attach-file">📎 Datei anhängen… <span className="text-ink3">(Bilder auch mit Strg+V oder Ziehen)</span></button>
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => { setPickerOpen(true); setPlusOpen(false) }} data-testid="pick-folder">📁 Ordner hinzufügen…</button>
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => { setNoteOpen(true); setPlusOpen(false) }} data-testid="open-note" title="Dauerhafter Projekt-Kontext, der jeder Nachricht vorangestellt wird">📓 Projektnotiz{projectNote.trim() ? ' ✓' : '…'}</button>
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => { setProjectOpen(true); setPlusOpen(false) }} data-testid="open-project" title="Projekt: Name, Anweisungen und Wissen dieses Ordners">📁 Projekt</button>
                    <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-user" onClick={() => { setAlwaysOpen(true); setPlusOpen(false) }} data-testid="open-always" title="Dauerhaft erlaubte Befehle/Dateien ansehen und widerrufen">🔓 Dauer-Freigaben{(always[effectiveDir]?.length) ? ` (${always[effectiveDir].length})` : '…'}</button>
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
                onPaste={(e) => { const imgs = imagesFrom(e.clipboardData?.items); if (imgs.length) { e.preventDefault(); void attachImages(imgs) } }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
              {running ? (
                <button className="mb-1 flex size-9 items-center justify-center rounded-lg bg-accent text-[#1a1410]"
                  onClick={() => void stopRun()} data-testid="stop" aria-label="Stoppen" title="Läuft – zum Abbrechen klicken">
                  <span className="size-3 rounded-[2px] bg-[#1a1410]" />
                </button>
              ) : (
                <div className="mb-1 flex items-center gap-2">
                  <button className="rounded-lg border border-accent/40 px-2.5 py-1.5 text-[13px] text-ink2 hover:bg-accent/10 hover:text-ink disabled:opacity-40"
                    onClick={runFullAuto} disabled={!input.trim()} data-testid="full-auto"
                    title="Führt diesen Auftrag bis zum Ende aus und beantwortet ALLE Freigaben und Rückfragen automatisch (die K.I. wählt selbst).">⚡ Voll-Automatik</button>
                  <button className="rounded-lg bg-accent px-3 py-1.5 text-[14px] font-medium text-[#1a1410] disabled:opacity-40"
                    onClick={() => void send()} disabled={!input.trim()} data-testid="send">Senden</button>
                </div>
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
      <ProjectNote open={noteOpen} workdir={modes.workdir} onClose={() => setNoteOpen(false)} onSaved={(n) => setProjectNote(n)}
        onLearn={() => { setNoteOpen(false); void send({ text: 'Lerne dieses Projekt kennen: Sieh dir die wichtigsten Dateien an (README, package.json o. Ä., Einstiegspunkte, Ordnerstruktur) und schreibe eine KURZE Projektnotiz (Markdown, höchstens ~25 Zeilen) mit Zweck, Aufbau, wichtigen Befehlen (Start/Test/Build) und Konventionen. Lege den Ordner .opendante an, falls nötig, und speichere die Notiz in .opendante/projektnotiz.md. Gib am Ende nur einen kurzen Satz aus, dass die Notiz geschrieben wurde.', agent: 'build' }) }} />
      <AlwaysAllowed open={alwaysOpen} dir={effectiveDir} grants={always[effectiveDir] ?? []} onClose={() => setAlwaysOpen(false)} onRevoke={revokeAlways} onClearAll={clearAlways} />
      <ProjectPanel open={projectOpen} dir={modes.workdir} instructions={projectNote} onClose={() => setProjectOpen(false)} onOpenInstructions={() => { setProjectOpen(false); setNoteOpen(true) }} />
      <FullAutoConfirm open={fullAutoConfirm} onCancel={() => setFullAutoConfirm(false)} onConfirm={confirmFullAuto} />
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
