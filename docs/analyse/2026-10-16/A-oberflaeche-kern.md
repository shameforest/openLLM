# Map A — OpenDante web UI core (web/src + index.html + vite.config.ts)

Scope: App.tsx, main.tsx, stream.ts, api.ts, messages.ts, Bubble.tsx, ChatSidebar.tsx, HistoryItem.tsx, ThinkingSidebar.tsx,
Clock.tsx, progress.ts, eta.ts, UsageReadout.tsx, TodoCard.tsx, TurnActions.tsx, diffs.ts, loops.ts, ollama.ts, storage.ts,
demo.ts, useEscape.ts, index.css, web/index.html, web/vite.config.ts. All of them were read completely. For endpoint/localStorage
lists I also looked at the helpers these files call (chats.ts, skills.ts, claude.ts, companion.ts, settings.ts, usage.ts, requests.ts
`autoDecision`, RequestCard.tsx head) — only to cite them correctly; they are outside the scope otherwise.
Paths are relative to `C:\openLLM\web\src` unless written otherwise. "sicher" = verified by reading the code; "Verdacht" = plausible,
not proven by me (reason given). Nothing was run.

---------------------------------------------------------------------------------------------------------------------

## 1. Lifecycle of one user message

### 1.0 What is already running before the user types (preconditions)
- `main.tsx:6-10` renders `<App/>` in `StrictMode`.
- Mount effect `App.tsx:73-84`: `skills.refresh()` + `chats.refresh()` (companion `GET /skills`, `GET /chats`), retried every 2000 ms up to 10 tries
  (`App.tsx:80`) then given up for good.
- Connection effect `App.tsx:211-230` (deps `[feed, online, modes.workdir]`):
  - `check()` = `health()` → `GET {base}/global/health` (`api.ts:30-32`, base = localStorage `openllm.base` or `http://127.0.0.1:4096`, `api.ts:16-18`).
  - on success: `setOnline(true)`, `connectEvents(feed, ok => setOnline(ok), modes.workdir)` = `EventSource GET /event?directory=<workdir>` (`api.ts:111-118`),
    `syncRequests()` (`GET /permission?directory=`, `GET /question?directory=`, `App.tsx:214-217`), `serverPaths()` (`GET /path`, `App.tsx:223`) → `serverDir`, `safeDirs`.
  - `setInterval(check, 5000)` only while `online !== true` (`App.tsx:227`); `setInterval(syncRequests, 8000)` only while `online === true` (`App.tsx:228`).
  - `es.onopen → setOnline(true)`, `es.onerror → setOnline(false)` (`api.ts:114-115`). Because `online` is an effect dependency every flip tears the EventSource down
    (`disconnect()` in cleanup, `App.tsx:229`) and builds a new one. On the first connect this happens twice (run #1 opens an ES, `setOnline(true)` re-runs the effect, run #2 opens the final one).
- Preload effect `App.tsx:153`: when `online===true` or the model changes → `ensureLoaded()` (`App.tsx:141-150`): `isLoaded(model)` (`GET :11434/api/ps`, `ollama.ts:25-27`);
  if loaded → `keepWarm`; else show blocking overlay (`App.tsx:647-658`), `preload()` = `POST :11434/api/generate {model, keep_alive}` (`ollama.ts:31-38`), then `recordLoadMs`.
  Overlay % advances every 500 ms (`App.tsx:156-160`) via `loadPct(elapsed, estLoadMs())` (`ollama.ts:55-58`).
- `projectInfo(workdir)` → `GET /project/current?directory=` sets `hasGit` (`App.tsx:175-181`).

### 1.1 Typing and sending (App.tsx)
1. `<textarea>` `App.tsx:607-610`: `onChange → setInput`; Enter without Shift → `e.preventDefault(); void send()`. Button "Senden" `App.tsx:617-618`
   (`disabled={!input.trim()}`); while `running` the same slot shows the stop button (`App.tsx:611-615`). Typing during a run is allowed; Enter then silently does nothing (`send` returns at `App.tsx:330`).
2. `send(override?)` `App.tsx:328-369`:
   - `prompt = (override?.text ?? input).trim()`; returns if empty or `running` (`329-330`). `agent = override?.agent ?? (modes.planFirst ? 'plan' : 'build')` (`331`).
   - `files = override ? [] : attachments`; typed requests clear `input` + `attachments` (`332-333`); `ctxNote` cleared (`334`).
   - Transcript: `setMessages(m => [...m.filter(x => !x.reverted), {role:'user', text: withAttachmentLines(prompt, files)}])` (`335`) — undone turns are dropped here.
   - `setRun({startedAt, turn: emptyTurn(), prog: startProgress(startedAt), sim: !online, agent})` (`336-337`). Progress step 1 therefore starts at send time (includes createSession/prompt latency and any server-side snapshot time).
   - `online` truthy → real path; else `simulate(startedAt)` (`366-368`, see 1.7).
3. Real path (`App.tsx:338-365`):
   - first message of a chat → `chatRef.current = {id: newChatId(), createdAt, title: chatTitle(prompt)}`, `setActiveChat` (`340-343`).
   - `asked = expandSkillCommand(prompt, skills.list)` (`345`); text = optional `AUTOPILOT_PREFIX` (`347`), optional `OFFLOAD_PREFIX` (`348`), then `globalInstructions` prepended (`349-350`) → final order: `gi \n\n OFFLOAD_PREFIX AUTOPILOT_PREFIX asked`.
   - no session yet → `createSession(title, workdir)` = `POST /session[?directory=] {title}` → `{id}` stored in `sessionRef` (`352`, `api.ts:34-35`).
   - `variant = (agent === 'plan' || modes.thinkMode === 'gruendlich') ? undefined : 'ohne-denken'` (`354`).
   - `sendPrompt(sessionRef, text, modes.localModel, modes.workdir, agent, variant, files)` = `POST /session/{id}/prompt_async[?directory=]`
     body `{agent, model:{providerID:'ollama', modelID}, parts:[{type:'text',text}, ...file parts], variant?}` → 204 (`api.ts:40-44`).
   - ANY failure of `sendPrompt` → new session + second `sendPrompt` (`357-362`); failure there → synthetic event `session.error {message:'Konnte den lokalen Server nicht erreichen.'}` through `feed` (`363-365`).

### 1.2 Event stream → state (feed, App.tsx:197-207)
`feed(e)` is `useCallback([])`-stable. It does two things on every SSE event:
(a) `setRun(prev => prev && !prev.turn.done ? {...prev, turn: reduceEvent(prev.turn, e), prog: reduceProgress(prev.prog, e, Date.now())} : prev)` (`198`) — events are ignored when no run is live or the turn is already done.
(b) side lists: `permission.asked`, `permission.replied`, `question.asked`, `question.replied/rejected`, `todo.updated` (`200-206`). There is NO filter by `sessionID` anywhere except `todo.updated` (`205`).

`reduceEvent` (stream.ts:57-125):
| event | handling | line |
|---|---|---|
| `message.part.delta` | needs non-empty string `delta` and `field` ∈ {`text`,`reasoning`}; segment key = `partID` (else `_<field>`); `field:'reasoning'` marks the part as reasoning if its type is still unknown; text appended to that part's segment; `compose` rebuilds `text` (all non-reasoning segments, joined `\n\n`) and `reasoning`. The part TYPE (from `kinds`), not the `field`, decides answer vs thinking (measured quirk: reasoning parts send `field:"text"`). A delta that precedes its `message.part.updated` counts as answer until the type arrives; `compose` is re-run when the type arrives, so it moves. | 60-71 |
| `message.part.updated` | records `kinds[part.id] = part.type` (recompose if changed); for `type:'tool'` upserts a `ToolCall{id, tool, status, title}` by `part.id` (status default `'running'`; `{...t, ...tc}` merge). `step-start`/`step-finish`/`text` parts only update `kinds` here. Final `part.text` is never read. | 72-89 |
| `message.updated` (user) | first user id → `userMsg`, all ids → `userMsgs` (plan mode adds a 2nd user message when it switches to build) | 94-99 |
| `message.updated` (assistant) | `agent` from `info.agent`; tokens: `input = tokens.input + cache.read + cache.write`, `output = tokens.output + tokens.reasoning`; stored per message id in `perMsg`, `usage` = sum over messages (idempotent on repeated updates) | 100-108 |
| `session.error` | `done:true`, `error = errorText(p)` (first non-empty of `error.data.message`, `error.message`, `message`; "model … not found" gets a download hint) | 110-111, 52-55 |
| `session.idle` | `done:true` | 112-113 |
| `session.status` | `idle` → `done:true, retry:null`; `retry` → `retry{attempt,message,next}`; any other (busy) → clears `retry` | 114-121 |

`reduceProgress` (progress.ts:44-69) on the same events:
- `message.updated` with NEW assistant id → new step (exception: the first assistant message while step 1 is open and `chars===0` stays step 1) (`46-53`); `newStep` closes the previous step via `finishStep` (`39-42`).
- `message.part.updated` type `step-finish` (once per part id) → `finishStep` (`54-60`) which stores `{prefillMs: firstDelta-stepStart, postMs: now-firstDelta}` (`33-37`).
- `message.part.delta` → sets `firstDelta` (first output of the step), counts `chars`, `kind` reasoning/text; a delta while no step is open starts a new step (`61-67`).
- Not handled: `session.*`, tool parts; the open step is closed by `finishStep` in the commit effect.

Permission/question events (`App.tsx:201-204`) feed `perms` / `questions` (dedupe by id). `RequestCard` (outside scope) shows `questions[0]` first, else `perms[0]`.
Auto-allow effect `App.tsx:241-250`: if `modes.autoAllow`, for every perm not in `autoReplied` → `autoDecision(p, effectiveDir, safeDirs)` (requests.ts:133) → `answerPerm(id, 'once'|'reject', message?)`
= remove from list + `POST /permission/{id}/reply[?directory=] {reply, message?}` (`233-236`, `api.ts:69-70`; errors swallowed). `doom_loop` → `reject` with `LOOP_HINT`.
User answers: `onPermission → answerPerm` (`538`), questions `POST /question/{id}/reply {answers}` (`539`) and `POST /question/{id}/reject` (`540`); both remove the card first, errors swallowed.
`todo.updated` (only for `sessionRef`) → `setTodos`; `TodoCard` is shown while `running` or any todo is pending/in_progress (`542`). Todos of a reopened chat come from `GET /session/{id}/todo` (`131`).

Live UI during the turn:
- Tick: `setInterval(setTick, 100)` while a run is live (`255-259`) re-renders the whole App ~10×/s so `Clock` (which calls `Date.now()` in render) updates.
- `Bubble` for the live run (`514-515`); `ThinkingSidebar` gets `thoughts` incl. the live item (`466-472`).
- `Clock` (`561`): `estimateStep`, `smoothEnd`, `estimateTask`, plus its own `GET :11434/api/ps` poll every 2000 ms (`Clock.tsx:20-30`).
- `detectLoop(run.turn.tools)` each render → loop warning with "Anders weitermachen" (`481`, `555-560`).

### 1.3 End of the turn → saved answer (commit effect, App.tsx:262-305, deps `[run?.turn.done]`)
Triggered when `session.idle` / `session.status idle` / `session.error` / local stop sets `turn.done`:
1. `agent = t.agent` (latest answer's agent) else `run.agent` (`267`).
2. `setMessages(m => [...m, {role:'assistant', text, reasoning, tools, error, agent, userMsg}])` (`268`).
3. Not simulated (`269`): `setUsage(addLocal(u, t))` (`270`); `ctxUsed` = input tokens of the LAST step message (`272-273`); `keepWarm(model, keepWarmMin)` = `GET /api/ps` then `POST /api/generate {model, keep_alive:'<n>m'}` (`275`, `ollama.ts:16-22`).
4. Changes line (`277-288`): if `sessionRef`, `t.userMsg`, `hasGit !== false`: `GET /session/{sid}/diff?[directory=…&]messageID=<id>` for every id in `t.userMsgs` (`api.ts:83-84`, errors → `[]`), `cleanPatch` per file, filter (additions+deletions>0 or added/deleted, and not `.opencode/plans/*`), then `setMessages(map … x.userMsg === um ? {…x, changes})`.
5. `postProcessClaude(t)` if no error, non-empty text and offload/audit on (`290`) → `POST {companion}/claude {system, prompt, model, capUsd}` per offloaded task and for the audit (`379-399`); pending placeholders replaced by `finishClaude` (`374-375`); usage via `addClaude`.
6. Learning (`292-302`, real, non-error, `produced(t)>0`): `fin = run.stopped ? run.prog : finishStep(run.prog, now)`; append `fin.done` to `stepSamples` (last 60) → localStorage `openllm.steps`; unless stopped, append `{ms: now-startedAt, steps: fin.step}` to `taskSamples` (last 30) → `openllm.tasks`.
7. `setRun(null)` (`303`).
8. Chat save effect `App.tsx:108-118` (deps `[messages, usage, run]`): only when `chatRef` set, no run, ≥1 message; after 400 ms `POST {companion}/chats {id,title,createdAt,workdir,model,sessionId,messages (without pending),usage}` (`chats.ts:74`). It re-fires after the async diff/`changes` update, after Claude replies, and after undo flags.

### 1.4 Stop / abort
- Stop button (`App.tsx:611-615`) → `stopRun()` (`401-405`): `simRef.current()` (clears demo interval) → if `sessionRef` → `await abort()` = `POST /session/{id}/abort[?directory=]`, any failure swallowed → `false` (`api.ts:46-47`) → `setRun(prev => prev && !prev.turn.done ? {...prev, stopped:true, turn:{...prev.turn, done:true}} : prev)`. The commit effect then stores what arrived and skips the task sample (`298`) and the open-step finishing (`293`).
- "+ Neuer Chat" while running calls `stopRun()` (not awaited) then `startNewChat()` (`ChatSidebar.tsx:25`).
- `redirectLoop()` (`442-446`): queue `{text: LOOP_HINT, agent:'build'}` in `queued`, `await stopRun()`; effect `App.tsx:447-453` (`[run]`) sends it once `run` is null.
- Not stopped by: workdir change (`99-104` calls `startNewChat` only), deleting the active chat (`ChatSidebar.tsx:43`), closing the window. Pending permission/question cards are not rejected on stop (the 8 s resync refreshes them).

### 1.5 Errors and retries — where they show
- `session.status retry` → `Turn.retry` → `Clock`: "Modellfehler – neuer Versuch Nr. N", reason (90 chars, or the "Modell nicht heruntergeladen" text), "nächster Versuch in ~m:ss", "Stopp beendet den Auftrag" (`Clock.tsx:51-53, 64-67`); the bar becomes indeterminate. Cleared by any non-retry `session.status` (`stream.ts:120`).
- `session.error` → turn done with `error`; `Bubble` shows red "Fehler: …" (`Bubble.tsx:29`) in the live bubble and in the saved message; such turns are not learned from and not sent to Claude (`App.tsx:290, 292`).
- HTTP-level failures of `sendPrompt`/`createSession` → fixed text 'Konnte den lokalen Server nicht erreichen.' (`App.tsx:363-365`) whatever the cause.
- Offline (`online===false`): yellow-ish banner (`App.tsx:490-494`), sent messages run the demo.
- Undo/restore/condense/git failures → `ctxNote` line (`638`); chat open failure → `historyMsg` (`134`); Claude failures → pending bubble replaced by "… ging nicht: <msg>" (`388, 397`).

### 1.6 After-turn actions on the saved answer
- `TurnActions` (`App.tsx:506-511`, only when `!running`): "Ansehen" (DiffModal), "Rückgängig" → `undoTurn(i)` = `POST /session/{id}/revert {messageID: userMsg}` then greys messages from the preceding user message onward (`409-419`); "Wiederherstellen" → `POST …/unrevert` (`420-427`); "Plan umsetzen" → `send({text:'Setze den Plan jetzt Schritt für Schritt um…', agent:'build'})` (`510`).
- "Verdichten" → `condense()` = `POST /session/{id}/summarize {providerID:'ollama', modelID}` (`430-438`); sets `ctxUsed=0`.
- "Sicherung einschalten" → `companionPost('/git/prepare',{path: effectiveDir})` then `POST /project/git/init` (`182-193`).

### 1.7 Offline demo path
`simulate(startedAt)` `App.tsx:309-323`: every 100 ms feeds fake `message.part.delta {field:'text'}` events (words from `demo.ts`, `SIM_WPS = 8` words/s after a random 0.5–1.5 s "think" delay) and finally a fake `session.idle`. Same reducer path; `sim` runs skip usage, ctx, keep-warm, diff, learning (`269, 292`) and are not saved (no `chatRef`), but Claude post-processing is NOT skipped (see finding F5).

---------------------------------------------------------------------------------------------------------------------

## 2. Per-file reference

### App.tsx (663 lines)
Purpose: the whole desktop app shell: owns chat state, SSE wiring, send/stop/undo, learning, preload, layout. Default export `App`.
Exports: `default function App()` only.
Inner functions: `startNewChat` (87), `openChat` (122), `ensureLoaded` (141), `enableGit` (182), `skipGit` (194), `feed` (197), `answerPerm` (233), `simulate` (309), `send` (328), `finishClaude` (374), `postProcessClaude` (379), `stopRun` (401), `undoTurn` (409), `restoreTurns` (420), `condense` (430), `redirectLoop` (443), `addFolders` (456), `switchFolder` (461), `addAttachments` (463).
Constants / magic numbers: mount-load retry 10 tries × 2000 ms (80); save debounce 400 ms (111); load-bar tick 500 ms, initial 1 % (146, 158); health re-check 5000 ms (227); request resync 8000 ms (228); clock tick 100 ms (257); step samples `slice(-60)` (295), task samples `slice(-30)` (299); demo `24 + rand*(DEMO.length-24)` words, think delay 500–1500 ms, interval 100 ms (310-321); context gauge amber above 0.75 (632); variant string `'ohne-denken'` (354); plan regex `/(^|[\\/])\.opencode[\\/]plans[\\/]/` (285); `MIN`-like literal none.
State (useState): `messages`(39) `input`(40) `run`(41, `{startedAt, turn, prog, sim?, stopped?, agent}`) `todos`(42) `ctxUsed`(43) `ctxNote`(44) `usage`(45) `stepSamples`(46, init from `openllm.steps`) `taskSamples`(47, `openllm.tasks`) `online`(48, null/true/false) `load`(49) `tick`(51, value unused) `modiOpen`(55) `settingsOpen`(56) `plusOpen`(57) `pickerOpen`(58) `filePickerOpen`(59) `attachments`(60) `historyMsg`(61) `activeChat`(68) `perms`(165) `questions`(166) `serverDir`(168) `safeDirs`(169) `hasGit`(173) `gitSkip`(174, init from `openllm.nogit.skip`).
Refs: `loadingRef`(50) `sessionRef`(62) `simRef`(63) `endRef`(64) `inputRef`(65) `chatRef`(67) `resumeDirRef`(69) `autoReplied`(167, Set of ids) `prevWorkdir`(98) `queued`(442).
Zustand: `useSettings()` (`modes`), `useSkills()`, `useChats()`.
Effects: mount load (73, `[]`); workdir change → `startNewChat` unless `resumeDirRef` matches (99, `[modes.workdir]`); save chat (108, `[messages, usage, run]`); preload (153, `[online, modes.localModel]`); load-% ticker (156, `[load?.startedAt]`); hasGit (175, `[online, modes.workdir]`); connect/SSE (211, `[feed, online, modes.workdir]`); auto-allow (241, `[perms, modes.autoAllow, answerPerm, effectiveDir, safeDirs]`); scroll to bottom (252, `[messages, run]`); clock tick (255, `[run]`); commit turn (262, `[run?.turn.done]`); queued redirect (447, `[run]`).
Derived each render: `modesActive`(54), `effectiveDir`(170), `running`(307), `thoughts`(466-472), `shownUsage`(476), `lastAnswerIndex`/`firstRevertedAnswer`(479-480), `loopReason`(481).
Inline JSX features: offline banner (490), empty state (497), message list with `TurnActions` (503-513), live `Bubble` (514), Claude-mode hint + `UsageReadout` (522-535), `RequestCard` (536-541), `TodoCard` (542), git hint (543-554), loop warning (555-560), `Clock` (561), attachment chips (562-574), "+" menu (576-606), textarea/send/stop (607-619), plan-first checkbox (623-626), context gauge + "Verdichten" (629-636), `ctxNote` (638), `FolderPicker`/`FilePicker`/`ThinkingSidebar`/`Modi`/`Settings` (642-646), model-loading overlay (647-658), inline `@keyframes pulse` and `slide` (659-660).

### main.tsx (10)
Imports `index.css`, renders `<App/>` into `#root` under `StrictMode`. No exports.

### stream.ts (125)
Purpose: pure reducer from OpenCode SSE events to the live `Turn`.
Exports: `ToolCall` (6), `Turn` (7), `emptyTurn` (23), `produced(t)` = text+reasoning chars (35), `splitThinking(text)` (41, legacy `<think>…</think>` splitter; offsets `+7`/`+8` at 46-47), `reduceEvent` (57).
Internal: `compose` (28), `num` (37), `errorText` (52, regex `/model .* not found/i`).
State: none (pure). `Turn` fields: text, reasoning, tools, done, usage, perMsg, kinds, segs, error, retry, userMsg, userMsgs, agent.

### api.ts (118)
Purpose: all calls to `opencode serve`.
Exports: `DEFAULT_BASE` (8), types `OcEvent`, `Health`, `PermissionRequest`, `QuestionOption`, `QuestionInfo`, `QuestionRequest`, `SessionStatus`, `FileDiff`, `Todo`; functions `baseUrl` (16), `health` (30), `createSession` (34), `sendPrompt` (40), `abort` (46), `listPermissions` (67), `listQuestions` (68), `replyPermission` (69), `replyQuestion` (71), `rejectQuestion` (73), `sessionDiff` (83), `revertTo` (87), `unrevert` (89), `sessionTodos` (91), `summarize` (93), `projectInfo` (98), `gitInit` (100), `serverPaths` (103), `sessionStatus` (105, unused), `sessionMessages` (107, unused), `connectEvents` (111).
Internal: `dirQuery` (11, `?directory=`+encodeURIComponent of trimmed dir), `call` (20; sets `content-type: application/json` only when a body exists; error text is only `METHOD path -> status`; 204 → undefined).
No timeouts/AbortSignals anywhere in this file.

### messages.ts (30)
Purpose: chat message type + helpers. Exports: `Msg` (7), `CONTEXT_LIMIT` (16-19, = first model's `limit.context` from `config/opencode.json`, fallback 65536), `wroteFiles(m)` (22), `toThought(key, prompt, m, live)` (26). Imports the whole `../../config/opencode.json`.

### Bubble.tsx (34)
Purpose: one chat entry. Export `Bubble({m, live, onShowThinking})`: user bubble; assistant shows only the answer (`splitThinking` + `hideOffloadMarkers`); "denkt nach…" + "Gedankengang ansehen ›" when live without answer; "Keine Textantwort …" when only process; red error line. Internal `Caret` (34, pulse animation).

### ChatSidebar.tsx (77)
Purpose: left column (new chat, Modi, Einstellungen, Verlauf, Skills, folder, model + online dot). Export `ChatSidebar(props)`; stateless. "Neuer Chat" = `if (running) void stopRun(); startNewChat()` (25). History delete = `if (c.id === activeChat) startNewChat(); void chats.remove(c.id)` (43). Skill click = `setInput('/<slug> ')` + focus (57).

### HistoryItem.tsx (52)
Export `HistoryItem`. State `editing`, `name`, `confirm`. Whole row is the click target; ✎ rename (inline input; Enter/blur saves, Escape cancels), 🗑 delete with inline "löschen? Ja/Nein". Rename/delete buttons use `stopPropagation` (23). `disabled` only blocks open, not rename/delete.

### ThinkingSidebar.tsx (106)
Exports `Thought` (7) and `ThinkingSidebar({open,onToggle,items})`. Internal `ThoughtBlock`. Effect (23-26): auto-scroll to bottom only if within 120 px of bottom, deps `[lastSize, items.length, open]`. `lastSize = last.thinking.length + last.tools.length` (20). Width 44 px closed / 380 px open. `<details open={latest}>` (74).

### Clock.tsx (111)
Purpose: live progress card (step n, doing-text, elapsed, countdown, tokens/s, whole-task estimate). Export `Clock({startedAt, prog, tools, steps, tasks, model, waiting, retry})`.
Constants: Ollama poll every 2000 ms to hard-coded `http://127.0.0.1:11434/api/ps` (23, 28); "tokens/s" = `charsPerSec / 4` (103); literal 3 for the learning hint (80, 100); min bar width 2 % (96); `Math.max(1000, end-now)` (48).
State: `modelReady` (19). Refs (written during render): `loadedInStep`(33), `toolSeen`(40), `stepEnd`(44). Effect (20-30, `[model]`): the `/api/ps` poll. Uses `clock` from `eta.ts`, `estimateStep/estimateTask/smoothEnd` from `progress.ts`.

### progress.ts (147)
Purpose: step-by-step progress model + estimates (pure). Exports: types `StepSample`, `TaskSample`, `Progress`, `StepEstimate`; `startProgress` (29), `finishStep` (33), `reduceProgress` (44), `PRIOR` (74 = `{prefillMs:8000, postMs:20000}`), `quantile` (80), `estimateStep` (99), `estimateTask` (131), `smoothEnd` (143).
Constants: `MIN_SAMPLES = 3` (75, not exported); `LOAD_MS = 30_000` prefill above this is a model load and not learned (77); percentile 0.75 (103-104); `genFor >= 2000` ms and `chars >= 200` for speed (124); fraction cap 0.99 (126); overdue floor 1000 ms (116, 120); `smoothEnd` time constant 2500 ms, reset above 60 000 ms difference (144-145). `quantile` index = `min(len-1, floor(q*len))` → for n ≤ 4 the "75th percentile" is the maximum.

### eta.ts (74)
Legacy answer-level estimator. Only `median` (22) and `clock` (60) are used in production (progress.ts:8, Clock.tsx:2). The rest (`AnswerSample`, `Timing`, `elapsedMs`, `tokensPerSec`, `estimateTotalMs`, `remainingMs`, `fraction`, `elapsedLabel`, `remainingLabel`) is referenced only by `eta.test.ts` (grep verified).

### UsageReadout.tsx (28)
Export `UsageReadout({u})`: Claude tokens, local/Claude percentage bar via `usageSplit`, tooltip with details; "noch nichts gezählt" when empty.

### TodoCard.tsx (25)
Export `TodoCard({todos})`: list with ✓ / ▸ / – / ○, "x von y erledigt" (cancelled excluded from y). `max-h-40` scroll.

### TurnActions.tsx (90)
Exports `TurnInfo`, `TurnActions({info,onUndo,onRestore,onRunPlan})` (state `showDiff`, `confirm`). Internal `DiffModal` (state `open` file index; `useEscape(true,onClose)`), colours `+`/`-`/`@@` lines (83). Renders nothing unless files changed or (isPlan && isLast).

### diffs.ts (35)
Export `cleanPatch(patch)` → `{patch, additions, deletions}`; strips `\r`, pairs identical removed/added lines inside each consecutive −/+ block and turns them into context (OD-31).

### loops.ts (27)
Export `detectLoop(tools)`: (1) ≥3 identical-signature errors among last 5 finished calls; (2) A B A B A B over last 6; (3) same signature 4× in a row (title required). Signature = `tool|title`. Messages German.

### ollama.ts (58)
Exports `OLLAMA` (3), `loadedModels` (6), `keepWarm` (16), `isLoaded` (25), `preload` (31), `recordLoadMs` (42), `estLoadMs` (47), `loadPct` (55). Constants: localStorage `openllm.loadms` keep last 10 (41, 44); default 30 000 ms load estimate (52, 56); ignore loads over 10 min (43); `loadPct` clamps 1..99 (57); `keepWarm` rounds minutes; `preload` falls back to `'5m'` when minutes ≤ 0 (33). `preload` throws on non-OK HTTP (37). No timeouts.

### storage.ts (6)
Exports `STEPS_KEY='openllm.steps'`, `TASKS_KEY='openllm.tasks'`, `GIT_SKIP_KEY='openllm.nogit.skip'`, `loadList<T>(key)`, `saveList(key, v)`. All wrapped in try/catch.

### demo.ts (6)
`DEMO` = 47 words (verified by counting), `SIM_WPS = 8`.

### useEscape.ts (11)
`useEscape(open, onClose)`: window `keydown` listener for Escape while `open`. Used by `TurnActions.DiffModal` (and other dialogs outside scope).

### index.css (27)
Tailwind v4 `@import` + `@theme` colour tokens (`bg #262624`, `panel #1f1e1d`, `line #37352f`, `ink #e9e6df`, `ink2 #a7a39b`, `ink3 #78736b`, `accent/live #d97757`, `user #2f2e2b`), dark `color-scheme`, `.mono`, `.btn-accent`. `@keyframes pulse/slide` are NOT here but inline in `App.tsx:659-660`.

### web/index.html (12)
`lang="de"`, title "OpenDante", `#root`, module script `/src/main.tsx`. No CSP, no favicon.

### web/vite.config.ts (8)
Plugins `react()`, `tailwindcss()`; `test: {environment:'jsdom'}`. No `base`, `server`, `build`, `fs.allow`.

---------------------------------------------------------------------------------------------------------------------

## 3. Cross-cutting lists

### 3a. localStorage keys (this area)
| key | where | meaning |
|---|---|---|
| `openllm.base` | read `api.ts:17` | OpenCode server URL override (tests); default `http://127.0.0.1:4096` |
| `openllm.companion` | read `companion.ts:6` (used by chats/skills/claude/git calls) | companion URL override; default `http://127.0.0.1:4097` |
| `openllm.steps` | `STEPS_KEY` `storage.ts:2`; read `App.tsx:46`, written `App.tsx:296` | learned step samples `{prefillMs, postMs}`, last 60 |
| `openllm.tasks` | `TASKS_KEY` `storage.ts:3`; read `App.tsx:47`, written `App.tsx:300` | learned task samples `{ms, steps}`, last 30 |
| `openllm.nogit.skip` | `GIT_SKIP_KEY` `storage.ts:4`; read `App.tsx:174`, written `App.tsx:194` | folders for which the "Sicherung einschalten" hint is hidden |
| `openllm.loadms` | `ollama.ts:41` (written 44, read 49) | last 10 model-load durations (ms) for the loading bar |
| `openllm.modes` | `settings.ts:80` (zustand persist, whole state incl. `apiKey`, `globalInstructions`) | all settings/modes; outside my files but this is where `modes.*` comes from |
No other direct `localStorage` use in the scoped files. (Not used any more anywhere: `openllm.samples`, which PROGRESS.md:51 still lists.)

### 3b. HTTP endpoints called
OpenCode (`baseUrl()`, optional `?directory=<workdir>`):
- `GET /global/health` — api.ts:31 (App.tsx:218)
- `GET /event[?directory=]` (SSE) — api.ts:113 (App.tsx:222)
- `GET /path` — api.ts:103 (App.tsx:223)
- `GET /project/current[?directory=]` — api.ts:98 (App.tsx:179)
- `POST /project/git/init[?directory=]` — api.ts:100 (App.tsx:187)
- `POST /session[?directory=]` body `{title}` — api.ts:34-35 (App.tsx:352, 360)
- `POST /session/{id}/prompt_async[?directory=]` body `{agent, model:{providerID:'ollama',modelID}, parts, variant?}` — api.ts:41 (App.tsx:356, 361)
- `POST /session/{id}/abort[?directory=]` — api.ts:47 (App.tsx:403)
- `GET /session/{id}/diff?[directory=…&]messageID=` — api.ts:83-84 (App.tsx:281)
- `POST /session/{id}/revert[?directory=]` body `{messageID}` — api.ts:87-88 (App.tsx:414)
- `POST /session/{id}/unrevert[?directory=]` — api.ts:89-90 (App.tsx:424)
- `GET /session/{id}/todo[?directory=]` — api.ts:91 (App.tsx:131)
- `POST /session/{id}/summarize[?directory=]` body `{providerID:'ollama', modelID}` — api.ts:93-94 (App.tsx:435)
- `GET /permission[?directory=]` — api.ts:67 (App.tsx:215)
- `GET /question[?directory=]` — api.ts:68 (App.tsx:216)
- `POST /permission/{id}/reply[?directory=]` body `{reply, message?}` — api.ts:69-70 (App.tsx:235)
- `POST /question/{id}/reply[?directory=]` body `{answers}` — api.ts:71-72 (App.tsx:539)
- `POST /question/{id}/reject[?directory=]` — api.ts:73-74 (App.tsx:540)
- DEFINED BUT NEVER CALLED: `GET /session/status` (api.ts:105), `GET /session/{id}/message` (api.ts:107)
Companion (`COMPANION`):
- `POST /git/prepare` body `{path}` — App.tsx:186
- `GET /chats` — chats.ts:66 (App.tsx:78); `POST /chats` — chats.ts:74 (App.tsx:112); `GET /chats/{id}` — chats.ts:78 (App.tsx:125); `POST /chats/rename` — chats.ts:87; `POST /chats/delete` — chats.ts:92 (ChatSidebar)
- `GET /skills` (2 s timeout) — skills.ts:19 (App.tsx:78)
- `POST /claude` body `{system, prompt, model, capUsd}` — claude.ts:30/33 (App.tsx:385, 394)
Ollama (`http://127.0.0.1:11434`):
- `GET /api/ps` — ollama.ts:7 (via `isLoaded`/`keepWarm`) and a second, duplicate fetch in Clock.tsx:23 (every 2 s during a run)
- `POST /api/generate` body `{model, keep_alive}` (no prompt) — ollama.ts:20 (`keepWarm`) and ollama.ts:34 (`preload`)

### 3c. Settings (zustand `useSettings`) read by this area
- `workdir` — folder for every request (`?directory=`), SSE folder, effect that starts a fresh chat on change, shown in sidebar/menus.
- `folders` / `addFolders` / `removeFolder` — "+" menu list (App.tsx:582-598).
- `localModel` — model id for `sendPrompt`/`summarize`/preload/keep-warm/Clock `/api/ps` match/saved with the chat/name in overlay + sidebar.
- `planFirst` — next request goes to agent `plan` (App.tsx:331, checkbox 624).
- `thinkMode` ('schnell'|'gruendlich') — `variant` 'ohne-denken' unless 'gruendlich' or plan agent (App.tsx:354).
- `autopilot` / `offload` / `audit` — prompt prefixes (347-348), Claude post-processing (290, 381, 391), hint row (522), `modesActive` badge (54).
- `autoAllow` — auto-answering of permission requests (242) and wording in RequestCard.
- `globalInstructions` — prepended to every prompt (349-350).
- `apiKey` — only `.trim()` to choose between usage readout and "Schlüssel fehlt" hint (523); read from the browser copy, not from the companion.
- `claudeModel` / `claudeDailyUsd` — passed to `claudeOffload`/`claudeAudit` (385, 394); `claudeModel` shown in the hint (526).
- `keepWarmMin` — `keepWarm` after answers and `preload`/`ensureLoaded` (143, 147, 275).
- `thinkingOpen` — sidebar open/closed (`ThinkingSidebar open`, `showThinking`, 477, 644).
- `set(...)` — used for `thinkingOpen`, `planFirst`, `workdir`.

---------------------------------------------------------------------------------------------------------------------

## 4. Findings

Format: ID · status · file:line · reason. Ordered roughly by impact.

### A. Likely real bugs / races
- **F1 · sicher (mechanism) / Verdacht (frequency) · App.tsx:211-230, api.ts:114-115, stream.ts:112-121** — No catch-up after an SSE gap. `es.onerror` sets `online=false`, the effect cleanup closes the EventSource and a new one opens later; events sent in between (notably `session.idle` / `session.status idle`) are lost and `turn.done` never becomes true → the UI stays "running" (clock ticking, send disabled) until the user presses Stop. Only permissions/questions are re-synced on reconnect (`syncRequests`, 214-217). `sessionStatus` (api.ts:105) and `sessionMessages` (api.ts:107) exist precisely for this but are never called (F17). No watchdog/timeout exists.
- **F2 · sicher · App.tsx:197-207, stream.ts:57-125, progress.ts:44-69** — No session filter. The stream is folder-bound, not session-bound (PROGRESS.md:39), so a second window, the TUI (`start.ps1 -Terminal`), or a session left running after a folder change/New Chat feeds its deltas/steps/`agent`/`session.idle` into the current turn (and can end it). Only `todo.updated` checks `sessionID` (205). `perms`/`questions` (GET /permission, /question, events) are unfiltered too, so another session's prompts show up as cards and set Clock `waiting`.
- **F3 · sicher · App.tsx:98-104, ChatSidebar.tsx:43** — Changing the working folder, or deleting the active chat, calls `startNewChat()` without `stopRun()`: the UI forgets the run but the server session keeps working (and writing files) in the old folder. Only the "+ Neuer Chat" button stops (ChatSidebar.tsx:25).
- **F4 · sicher · App.tsx:401-405** — `stopRun` awaits `abort()` BEFORE marking the turn stopped. If the server's idle/error event arrives first (normal: abort makes the server go idle), the turn is completed by `reduceEvent` and the commit effect runs with `run.stopped` unset → the cut-off step is learned as a normal sample and the cut-off task is stored as a task sample (292-300), and Claude audit/offload may run on the partial answer (290). Also: if the user starts a new run before `abort` resolves, the `setRun` callback (404) marks the NEW run as stopped/done locally while the server keeps working. `abort` failures are swallowed (`api.ts:47`), so the UI claims "stopped" although the agent may continue.
- **F5 · sicher · App.tsx:290 (vs 269, 292)** — `postProcessClaude` is not gated on `!run.sim`: in the offline preview with Offload/Audit on and a stored key, a paid Claude call is made on the canned demo text. Not gated on `run.stopped` either.
- **F6 · sicher · App.tsx:374-399** — `postProcessClaude`/`finishClaude` have no chat guard. If the user opens another chat or starts a new one while a Claude call is in flight, `finishClaude` finds no `pending` (replaced by `setMessages`) and appends the Claude answer to the newly open chat (`[...m, final]`, 375), and `addClaude` counts the cost in the wrong chat's usage. The comment "(sequential, so at most one is pending)" (373) is also not guaranteed: the next turn can finish while an audit is still pending, and `finishClaude` replaces the FIRST pending placeholder.
- **F7 · Verdacht · stream.ts:112-118, App.tsx:430-438, 447-453** — Stale idle events can end a NEW turn at once (empty answer). OpenCode emits both `session.idle` and `session.status {idle}` for one transition (PROGRESS.md:40); the queued loop redirect sends the next prompt as soon as the run is committed, and "Verdichten" (`condense`, 430) does not block `send` (it is `running===false`), so the idle events of a still-running summarisation or the second copy of an idle can hit the freshly started run. Not measured.
- **F8 · sicher · App.tsx:355-365** — `sendPrompt` failure handling is too broad: every error (not only "session gone") silently starts a fresh session (model loses all context, the window still shows the old messages, no notice), and the final catch (363) always says 'Konnte den lokalen Server nicht erreichen.' even for HTTP 400/404/500 (`api.ts:25` drops the response body, so the real reason is never shown).
- **F9 · sicher · App.tsx:337-338, 48, 218-224, api.ts:115** — `sim: !online` / `if (online)`: while `online` is `null` (first seconds) or `false` after any SSE hiccup (`onerror`), a sent message runs the canned demo ("Klar. Ich lege die Datei an …") and nothing reaches the model; the banner appears only for `online===false` (490). Demo also never shows its last word: `DEMO` has 47 words but `24 + floor(rand*(47-24))` ≤ 46 (App.tsx:310).
- **F10 · sicher · App.tsx:647-658, ollama.ts:34, App.tsx:142** — The preload overlay is `fixed inset-0` with no cancel/timeout and `preload()` has no AbortSignal: a hanging or failing-slowly load (PROGRESS log 2026-10-16: up to 5 min) blocks the whole window. Switching the model while a load is in flight returns early at 142 (`loadingRef`), so the new model is not preloaded (the effect at 153 does not re-run).
- **F11 · Verdacht · App.tsx:153, 141-150 vs CLAUDE.md "Hardware"** — Preload runs automatically whenever the window is online and the model is not resident, with no check that the shared GPU is free (OpenDali/ComfyUI). The "never at the same time" guard exists only in the launcher (`start.ps1`). Opening OpenDante while ComfyUI holds the VRAM would trigger an 18 GB load attempt.
- **F12 · Verdacht · stream.ts:87 + loops.ts:6, 14-15** — Loop detector false positives: `{...t, ...tc}` overwrites an existing `title` with `undefined` whenever a later tool state has no `title` (spread copies undefined values). If OpenCode's `error` tool state carries no title (from memory — not verified), all failed `bash` calls share the signature `bash|`, and 3 DIFFERENT failing commands within the last 5 finished calls trigger "Derselbe Schritt ist 3-mal fehlgeschlagen". `loops.test.ts` only tests errors WITH titles; `stream.test.ts:126` even asserts `title: undefined` after completion.
- **F13 · Verdacht · messages.ts:22-23 vs App.tsx:285, 508** — `wroteFiles` counts any completed `write|edit|patch|multiedit|apply_patch` tool call, while the changes list deliberately hides plan files (`.opencode/plans/*.md`). The plan agent writes its plan with exactly such a tool (config/opencode.json: plan agent may edit `*opencode/plans/*.md`), so a plan answer that stays in plan mode may be classified as "plan already carried out" → no "Plan umsetzen" button (`isPlan` false, 508). No test covers `wroteFiles`. PROGRESS only proves the "Yes → build" path.
- **F14 · sicher · diffs.ts:29-30, TurnActions.tsx:83** — `---`/`+++` header test misclassifies content: a removed line whose text starts with `--` (SQL/Lua comment → `--- …`) or an added line starting with `++` (`++i` → `+++i`) is treated as a file header: not counted in additions/deletions, not coloured. Also the pairing (diffs.ts:18-21) ignores order, so a pure re-ordering of lines inside a replaced block is reported as "no change". Display only.
- **F15 · sicher · progress.ts:77 + App.tsx:299** — Learning is skewed: prefill ≥ 30 s is always treated as "model load" and dropped (also long legitimately-uncached prefills of big contexts: 15k tokens at ~496 tok/s ≈ 30 s), samples are not keyed by model (`storage.ts:2` is global, `Clock` gets `model` only for the `/api/ps` check), and the task sample uses wall-clock `Date.now() - run.startedAt` including user wait time on permission cards, model loading and the pre-first-step server overhead (git snapshot up to 86 s measured), so the "Gesamt ~…" estimate drifts upward.

### B. Dead / duplicate code and stale comments
- **F16 · sicher · eta.ts:9-57, 66-74** — Still-needed parts of `eta.ts` are only `median` (22-27) and `clock` (60-63). `AnswerSample`, `Timing`, `elapsedMs`, `tokensPerSec`, `estimateTotalMs`, `remainingMs`, `fraction`, `elapsedLabel`, `remainingLabel` are used only by `eta.test.ts`; the file header (1-6) describes the replaced approach. Suggest: move `median` + `clock` next to `progress.ts` (or `time.ts`), delete the rest and the matching tests. Note `median` filters `x > 0` while `quantile` filters `x >= 0`.
- **F17 · sicher · api.ts:65, 105-108** — `SessionStatus`, `sessionStatus`, `sessionMessages` are never imported (grep). See F1 for what they could be used for.
- **F18 · sicher · Clock.tsx:23-28 vs ollama.ts:3-10** — `/api/ps` is fetched by a duplicate hard-coded implementation in `Clock` (own URL literal, own name matching) instead of `loadedModels()`/`OLLAMA`. Similar duplicate literals: "3" samples in Clock.tsx:80, 100 vs `MIN_SAMPLES` (progress.ts:75, not exported); "~4 chars = 1 token" in Clock.tsx:103 and usage.ts:29.
- **F19 · sicher · App.tsx:371-373** — Misplaced comment: lines 371-372 ("Stop the running answer …") describe `stopRun` (401) but sit above `finishClaude`.
- **F20 · sicher · App.tsx:659-660** — `@keyframes pulse`/`slide` live in an inline `<style>` inside `App` instead of `index.css`; works only because every user of them is rendered below `App`.
- **F21 · sicher · messages.ts:5, 16-19** — Imports the entire `config/opencode.json` (incl. the long `_note`, permission list, MCP block) into the client bundle just to read one number, and takes the FIRST model's `limit.context`, not the selected model's (harmless today: all three are 65536).
- **F22 · sicher · ollama.ts:33 vs settings.ts `keepWarmMin` comment / PROGRESS log 2026-10-16** — `preload` sends `keep_alive:'5m'` when `keepWarmMin` is 0 while the setting text says "0 = Ollama's default", and install.ps1 now sets `OLLAMA_KEEP_ALIVE=60m`; `keepWarm` (ollama.ts:17) returns early for 0. Inconsistent. The `keepWarm` doc comment (ollama.ts:14-15, "Only called right after an answer, when the model is loaded anyway") is also outdated: it is now also called from `ensureLoaded` (App.tsx:143).
- **F23 · sicher · stream.ts `kinds` vs progress.ts `kinds`** — Two reducers track the same part-type map separately (Turn.kinds 14, Progress.kinds 23) on the same event stream; `msgs`/`seen`/`perMsg` similarly overlap. Not a bug, but double bookkeeping.

### C. Performance / UX
- **F24 · sicher · App.tsx:255-259, 466-472, 503-513** — A 100 ms `setTick` re-renders the whole App (message list, `splitThinking` + `offloadTasks` for every message via `toThought`, no `useMemo`/`React.memo`) 10×/s, plus once per streamed delta. Cost grows with chat length. The tick effect depends on `[run]`, so the interval is re-created on every delta. Better: tick inside `Clock`; memoise `thoughts`.
- **F25 · sicher · App.tsx:252** — Auto-scroll on every change of `messages`/`run` with `behavior:'smooth'` and no "only when already at bottom" check (compare ThinkingSidebar.tsx:25): the user cannot scroll up to read while the answer streams.
- **F26 · sicher · stream.ts:28-31, 70** — `compose` rebuilds the full text/reasoning strings on every delta (O(n²) over a long answer; limit.output is 16 384 tokens). Probably negligible but runs inside the `setRun` updater (also double-invoked by StrictMode in dev).
- **F27 · sicher · Clock.tsx:34, 41, 44-47** — Refs are written during render (`loadedInStep`, `toolSeen`, `stepEnd`); under StrictMode's dev double render the second pass sees `dt≈0` and `smoothEnd` stops smoothing. Production unaffected.
- **F28 · sicher · App.tsx:80** — Skills/Verlauf loading gives up after 10 tries (~20 s); if the companion starts later the lists stay empty/"…" until a reload. `chats.refresh`/`chats.load` also have no timeout (chats.ts:66, 78).
- **F29 · sicher · ThinkingSidebar.tsx:62 + App.tsx:466-472** — The live item has key `'live'` and becomes `m<i>` on commit, so `ThoughtBlock` is unmounted/remounted at the end of every turn (the user's manual fold state of that block is lost).
- **F30 · Verdacht · stream.ts:119-121** — `retry` is cleared only by `session.status` events, not by the first delta or tool part. If OpenCode does not send a `busy` status after a successful retry, "Modellfehler – neuer Versuch" stays on screen until the turn ends.
- **F31 · Verdacht (low) · HistoryItem.tsx:13-17** — Escape calls `setName(c.title); setEditing(false)`, but `save` (bound to `onBlur`) has the OLD `name` in its closure; if the browser fires `blur` while unmounting the focused input, the edited name is saved despite Escape.
- **F32 · Verdacht (low) · App.tsx:218-228** — `health()` has no timeout (api.ts:31/20-27) and the 5 s interval can start overlapping checks; if two resolve OK before the re-render, `disconnect` is overwritten and the first EventSource leaks, doubling every delta ("HalloHallo"). Unlikely.
- **F33 · Verdacht (low) · web/vite.config.ts + messages.ts:5 + settings.ts:3** — `npm run dev` may refuse to serve `../../config/*.json` (outside `web/`, no `server.fs.allow`, no root `package.json`/workspace so Vite's allow list is `web/`). `build`, `vitest` and the companion-served `dist` are unaffected. From memory of Vite behaviour, not tried.
- **F34 · sicher · settings.ts persist `openllm.modes` + App.tsx:523** — The Claude key lives in browser localStorage (zustand persist, no `partialize`) and App's "Schlüssel fehlt" hint is driven by that copy, not by the companion's key file (`~/.opendante/claude-key.json`, PROGRESS log 2026-10-16). Clearing browser data shows the hint although the companion still has the key (or the reverse). Outside my scope; flagged for the settings/companion mapper.

### D. Contradictions with PROGRESS.md / CLAUDE.md
- **F35 · sicher · PROGRESS.md:51** says "`progress.ts` replaces the old `eta.ts`" and lists localStorage `samples`; `eta.ts` still exists and is imported (F16), `openllm.samples` is not used anywhere, while `openllm.modes`, `openllm.nogit.skip`, `openllm.loadms` are missing from the list.
- **F36 · sicher · PROGRESS.md:23** names `settings.thinkOff` ("Off by default"); the code has `thinkMode` ('schnell' default) and no `thinkOff` (grep). CLAUDE.md and PROGRESS.md:75 are right.
- **F37 · sicher · PROGRESS.md:45** "UI keeps the model ~60 min warm, only if already loaded" — superseded by `ensureLoaded`/`preload` (App.tsx:141-150, ollama.ts:29-38), which loads the model proactively on start, model change and chat open (as the 2026-10-16 log entry says).
- **F38 · sicher · PROGRESS.md:10 / :11** "98 Vitest (13 files)" — the log (line 80) says 129 Vitest and the folder has 17 test files.
- **F39 · Verdacht (low) · stream.ts:105 vs PROGRESS.md:41** — PROGRESS says `output` already includes thinking (`reasoning` = 0 measured); the code sums `output + reasoning`. Correct today (reasoning is 0 with Ollama) but would double count if a provider ever reports `reasoning` as a subset of `output`.
- **F40 · sicher · CLAUDE.md "Undo … needs git"** matches App.tsx:182-193 (prepare → init); **PROGRESS.md:65** (75th percentile, 30 s load cut-off, 3-job minimum) matches progress.ts:74-139; **PROGRESS.md:66** (8 s resync, re-fetch on reconnect) matches App.tsx:211-230 — listed so the caller knows these claims were checked and hold.
