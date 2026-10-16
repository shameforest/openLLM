# OpenDante — architecture map (macro → micro)

Snapshot of 2026-10-16 (commit after `5a0a6e3`). Built from a full read of every source file (four area reports in
`docs/analyse/2026-10-16/`, each with file:line detail) plus spot checks in the main session. Line numbers there go
stale; the structure here changes slowly. Read this before answering "how does X work / where is X / why does X fail".
Labels: **[verified]** = run or measured on the Shadow PC; **[code]** = read in the code, not run; **[suspect]** = plausible, unproven.

---------------------------------------------------------------------------------------------------------------------

## 1. The big picture

OpenDante does not train or host a model itself. It wires four local programs together and adds a desktop UI:

```
 Chrome --app window (web UI, React)  ──HTTP+SSE──►  OpenCode 1.x  "opencode serve" :4096   (agent harness, MIT)
        │            │                                   │  provider ollama, /v1 OpenAI-compatible
        │            │                                   ▼
        │            └──────────HTTP (direct)────────►  Ollama :11434  ──►  llama-server.exe (runner, holds the 18 GB model)
        │
        └──HTTP──►  Companion :4097 (companion/server.mjs, zero-dependency Node)
                        serves web/dist, chats, settings, skills, folders, git, Claude proxy, updates
                        └──► api.anthropic.com (only the paid Claude modes)
```

- **The browser talks to all three servers directly.** The companion never talks to OpenCode or Ollama.
- **The agent is the local model** (default `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M`). Claude is only an optional,
  paid add-on (Offload / Audit), never the background agent.
- **Folder = query parameter.** Every OpenCode call carries `?directory=<workdir>`, and so does the event stream. The
  stream is folder-bound, not session-bound (this matters for AN-06).
- **Undo and the "changes" line need git.** OpenCode snapshots only git folders, so "Sicherung einschalten" =
  companion `POST /git/prepare` (writes `.gitignore`) + OpenCode `POST /project/git/init`.
- **One GPU, two projects.** OpenDali (ComfyUI :8188, its server :3790) and OpenDante cannot share the 24 GB. Only the
  launcher guards this, and only for OpenDali → OpenDante (AN-15).

### Where things live on disk
| What | Where | Written by |
|---|---|---|
| Repo (code, config sources) | `C:\openLLM` | git |
| OpenCode config actually used | `~\.config\opencode\` (`opencode.json`, `AGENTS.md`, `agents\`, `commands\`, `skills\`) | `install.ps1` (copies from `config\`, `skills\`), companion (AGENTS.md user block, uploaded skills) |
| OpenCode sessions DB | `~\.local\share\opencode\opencode.db` | OpenCode |
| Chats (Verlauf) | `~\.opendante\chats\<id>.json` + `<id>.meta.json` | companion |
| Claude key + model | `~\.opendante\claude-key.json` (plaintext) **and** browser localStorage `openllm.modes` | companion / UI |
| Claude spend today | `~\.opendante\claude-usage.json` (UTC day) | companion |
| Cloned GitHub projects | `~\OpenDante-Projekte\<repo>` | companion |
| Default agent working folder | `~\code` (OpenCode's cwd) | `start.ps1` |
| Testlauf results | `eval\results\` (git-ignored), `verlauf.jsonl` = history | `scripts\eval.mjs` |
| Launch signature | `logs\opencode-launch.txt` | `start.ps1` |

Companion env overrides: `OPENDANTE_ROOT`, `OPENDANTE_DATA`, `OPENDANTE_COMPANION_PORT`, `OPENDANTE_ORIGINS`,
`OPENDANTE_PROJECTS`, `OPENDANTE_MODEL`, `OPENCODE_CONFIG_DIR`. Browser overrides (for test instances):
localStorage `openllm.base` (OpenCode URL), `openllm.companion` (companion URL).

---------------------------------------------------------------------------------------------------------------------

## 2. Install and start

### install.ps1 (6 steps; `-SkipModel`, `-Model <tag>`)
1. Scoop (installs via `iex get.scoop.sh` if missing).
2. OpenCode via scoop; update, but roll back with `scoop reset opencode@<old>` if the new version is not `1.*`.
3. Ollama (downloads `OllamaSetup.exe`, silent install) if missing.
4. **User env vars:** `OLLAMA_CONTEXT_LENGTH=65536`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_FLASH_ATTENTION=1`,
   `OLLAMA_KEEP_ALIVE=60m`, `OPENCODE_EXPERIMENTAL_PLAN_MODE=1`. They only take effect after Ollama is restarted
   (the tray app keeps its old environment; seen 2026-10-16: still 5m) **[verified]**.
5. `ollama pull <default from config/models.json>`.
6. Copies `config\opencode.json` over the user's file (backup `.vorher`), validates with `opencode models ollama` and
   rolls back on failure; copies AGENTS.md but keeps the user block `<!-- OPENDANTE-USER-START/END -->`; copies
   agents/commands/skills; `npm install` + `npm run build` in `web\` (success = `web\dist\index.html` exists, AN-13);
   desktop shortcut → `start.ps1`.

### start.ps1 (desktop icon), in order
1. Rebuild PATH (User + Machine + scoop shims).
2. If :8188 listens → dialog "OpenDali belegt die Grafikkarte". "Ja" runs OpenDali's own `stop.ps1` if found, else kills
   the owners of :8188/:3790. ("Nein" continues anyway.)
3. Kill orphaned `llama-server.exe` whose parent Ollama is gone (added 2026-10-16 after 17 GB were held by orphans).
4. Start `ollama serve` if :11434 is down (no readiness wait, no env check).
5. Set `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS/EXTERNAL_SKILLS/AUTOUPDATE/SHARE=1` (prompt −46 %, pinned 1.x, no sharing).
6. If :4096 runs but the config is newer than the process or the launch signature changed → restart it, unless
   `GET /session/status` shows a busy session.
7. If :4096 is down: validate config (`opencode models ollama`, error dialog on failure), start `opencode serve --port 4096` in `~\code`.
8. `-Terminal` → open the OpenCode TUI instead and stop here.
9. **Always** kill and restart the companion on :4097 (so updates take effect), wait ≤30 s for it.
10. Open Chrome/Edge `--app=http://127.0.0.1:4097`.

---------------------------------------------------------------------------------------------------------------------

## 3. One user message, end to end (web/src/App.tsx)

1. **Before typing:** health check `GET /global/health` every 5 s until online; then `EventSource /event?directory=`,
   fetch open permissions/questions, `GET /path` (server folder + OpenCode's own safe dirs). `ensureLoaded()` preloads
   the model into the GPU (`POST :11434/api/generate {model, keep_alive}`) with a full-window progress overlay.
2. **send()** — prompt text is built as: `globalInstructions` + `OFFLOAD_PREFIX`? + `AUTOPILOT_PREFIX`? + the prompt
   (a leading `/skillname` becomes "Verwende den Skill …"). Attachments become OpenCode `file` parts (`file:///…`).
   First message of a chat → `POST /session {title}`. Then `POST /session/{id}/prompt_async` with
   `{agent: build|plan, model:{providerID:'ollama', modelID}, parts, variant}`; `variant = 'ohne-denken'` unless plan
   mode or thinkMode "gruendlich". **While `online` is not yet `true` the message runs the canned offline demo instead
   (AN-08).**
3. **Streaming** — every SSE event goes through two pure reducers: `stream.ts reduceEvent` (answer/thinking text, tool
   calls, tokens, errors, retry, done) and `progress.ts reduceProgress` (steps for the clock). Thinking is routed by
   **part type**, not by the delta's `field` (reasoning parts send `field:"text"` — measured quirk). Permission and
   question events go to `RequestCard`; with "Befehle automatisch erlauben" (default ON) `autoDecision()` answers them
   (section 5). `todo.updated` fills the task card. A 100 ms tick re-renders the clock.
4. **End** — `session.idle` / `session.status idle` / `session.error` / Stop sets `done`. The commit effect then: adds
   the assistant message, counts tokens (`input + cache.read + cache.write`, `output + reasoning`), sets the context
   gauge, keeps the model warm, fetches `GET /session/{id}/diff?messageID=` per user message for the changes line
   (CRLF-only changes and `.opencode/plans/` hidden), runs Claude Offload/Audit if on, learns step/task durations
   (localStorage), and the chat is saved to the companion 400 ms later.
5. **After the turn:** "Ansehen" (diff modal), "Rückgängig" (`POST …/revert {messageID}`), "Wiederherstellen"
   (`…/unrevert`), "Plan umsetzen" (sends a fixed text to the build agent), "Verdichten" (`…/summarize`).
6. **Stop** — `POST /session/{id}/abort`, then the turn is marked stopped locally (order matters, AN-07).

Reopening a chat from the Verlauf restores messages, thinking and counts and continues the **same** OpenCode session
(`sessionId`); if that session is gone, a fresh one is created silently (the model loses the history).

---------------------------------------------------------------------------------------------------------------------

## 4. Module map

### web/src (React 19, Vite 8, Tailwind 4, zustand; ~3,000 lines + tests)
| File | Role |
|---|---|
| `App.tsx` (663) | Shell and all orchestration: state, SSE wiring, send/stop/undo/condense, preload, learning, layout |
| `api.ts` | Every OpenCode HTTP call + `connectEvents` (SSE). `sessionStatus`/`sessionMessages` exist but are unused |
| `stream.ts` | Pure SSE → `Turn` reducer (text, reasoning by part id, tools, usage, retry, error, userMsgs, agent) |
| `progress.ts` | Step model + estimates: 75th percentile of learned steps, prefill > 30 s = model load (not learned), task estimate after 3 jobs |
| `eta.ts` | Legacy; only `median` and `clock` still used |
| `Clock.tsx` | Live progress card (step, countdown, tok/s, retry notice); polls `/api/ps` itself every 2 s |
| `ollama.ts` | `/api/ps`, `keepWarm`, `preload` (throws on HTTP error), load-time learning (`openllm.loadms`), `loadPct` |
| `requests.ts` | German permission texts, **`autoDecision`** (auto-allow policy), path checks, one-liner check; also used by the Testlauf |
| `RequestCard.tsx` | Permission card (Einmal / Immer / Ablehnen, loop: "Anders weitermachen") and question card |
| `messages.ts` | `Msg` type, `CONTEXT_LIMIT` (from opencode.json), `wroteFiles`, `toThought` |
| `Bubble.tsx`, `ThinkingSidebar.tsx`, `TodoCard.tsx`, `ActivityCard.tsx`, `TurnActions.tsx`, `diffs.ts` | Answer bubble, thinking sidebar, task list, live activity card (OD-55: current action + files, from `run.turn.tools`), undo/diff/plan buttons, diff cleanup |
| `loops.ts` | Loop detector (3 same errors / A-B oscillation / 4× same call) → "Anders weitermachen" |
| `ChatSidebar.tsx`, `HistoryItem.tsx`, `chats.ts` | Left column, Verlauf (rename/delete), chat store (companion `/chats`) |
| `settings.ts` | zustand store persisted as localStorage `openllm.modes` (all settings incl. the Claude key), model lists, `AUTOPILOT_PREFIX` |
| `SettingsPanel.tsx`, `Modi.tsx`, `UsageOverview.tsx`, `UsageReadout.tsx`, `usage.ts` | Einstellungen dialog, the 4 mode switches, token overview, counters |
| `claude.ts` | Offload/Audit prompts, `<<<CLAUDE … >>>` extraction, calls `POST /claude` |
| `FolderPicker.tsx`, `FilePicker.tsx`, `fs.ts`, `attachments.ts` | In-app folder/file browser (companion `/fs`), attachments as file parts |
| `skills.ts`, `projects.ts`, `companion.ts`, `storage.ts`, `demo.ts`, `useEscape.ts` | Skills list + `/slug` expansion, GitHub projects/git, companion helper, localStorage helpers, offline demo text, Escape hook |

Settings (`openllm.modes`): `autoAllow` **true**, `autopilot`/`offload`/`audit` false, `thinkMode` `schnell`,
`planFirst` false, `keepWarmMin` 60, `localModel` = models.json default, `workdir` '' (= server folder), `folders`,
`thinkingOpen`, `globalInstructions`, `apiKey`, `claudeModel` `claude-sonnet-5-5`, `claudeDailyUsd` 2.
Other localStorage: `openllm.steps` (60 step samples), `openllm.tasks` (30), `openllm.loadms` (10),
`openllm.nogit.skip`, `openllm.base`, `openllm.companion`.

### companion/server.mjs (486 lines, Node built-ins only, listens on 127.0.0.1)
Request pipeline: parse URL → CORS only for own origins → **requests without `Origin` are allowed** → POST must be JSON
(else 415) → route → any error = 400 `{error}` → unmatched GET = static file from `web/dist` (SPA fallback: no file
extension → index.html).
Routes: `/health`; `GET/POST /skills`; `GET /repos`, `POST /repo/clone` (GitHub https only, `git clone --depth 1` or
`pull --ff-only`); `GET /chats`, `GET /chats/<id>`, `POST /chats`, `/chats/rename`, `/chats/delete` (id regex
`^[a-z0-9-]{8,64}$`); `GET /fs?path=&files=1` (any folder, read-only listing); `POST /git` (status/pull/push/commit,
needs `.git`); `POST /git/prepare` (writes `.gitignore`, refuses drive roots/home/system folders); `POST /settings`
(AGENTS.md user block, key file — **an empty key deletes the key file**); `POST /claude` (Anthropic proxy, price table,
daily cap from the request's `capUsd`); `POST /claude/test`; `GET /claude/usage`; `POST /update/app` (detached
`git pull` + `install.ps1 -SkipModel`); `POST /update/models` (`ollama pull`). No shell anywhere (argv arrays); no
path traversal found.

### config/ (installed to ~/.config/opencode)
- `opencode.json`: model default, `autoupdate:false`, `share:"disabled"`, provider `ollama` (`@ai-sdk/openai-compatible`,
  `http://localhost:11434/v1`), 3 models each `limit {context 65536, output 16384}`, `temperature:true`, variant
  `ohne-denken` (`reasoningEffort: none`); `mcp.playwright` prepared but `enabled:false`; `permission` (section 5);
  `agent.plan.permission` (edit only `*opencode/plans/*.md`, own bash list). Traps are documented in its `_note`.
- `models.json`: the single model list (UI, companion, installer, Testlauf read it); `models.test.ts` checks that
  opencode.json has the same ids and default (ids only, not limits).
- `AGENTS.md`: German, concise, todo list for >3 steps, keep going, files >150 lines in parts, run tests and report
  real output, scratch scripts in `.opendante/tmp/`, `.gitignore` first in new projects, never destructive without asking.
- `commands/{commit,review,test}.md`, `agents/review.md`: only reachable from the TUI (`start.ps1 -Terminal`); the web
  UI sends `/test` as plain text (AN-20). `skills/batch-autopilot`: stage-wise work with `FORTSCHRITT.md` as memory.

---------------------------------------------------------------------------------------------------------------------

## 5. Permissions: two layers

1. **OpenCode (`opencode.json` → `permission.bash`, last match wins):** `*` ask; allow read commands, `mkdir`,
   `git status/diff/log/show/add/commit/branch/stash/checkout -b`, runners `npm npx node pnpm yarn python py pip uv
   cargo go dotnet pytest`, `ollama list/show`; ask `python -c`, `node -e`, `powershell`, `cmd /c`, `iex`, `git push`,
   `reset --hard`, `clean`, `checkout --`, `restore`; **deny** `rm del erase ri rmdir rd Remove-Item Clear-Content format
   mkfs shutdown Stop/Restart-Computer`. `edit/webfetch/websearch: allow`, `task: deny` (sub-agents fail on Ollama:
   500 "no user query found in messages").
2. **UI `autoDecision()` (requests.ts)** for whatever OpenCode marked "ask", only while autoAllow is on:
   `doom_loop` → reject + hint; `external_directory` → allow only inside OpenCode's own dirs; harmless interpreter
   one-liner (import/compute/print, denylist of write/delete/network/process APIs) → allow; `RISKY` regex (push,
   reset --hard, clean, delete aliases, format, reg add/delete, iex, pipe-to-shell, `-c`/`-e`/`-Command`) → ask;
   absolute path outside the working folder → ask; **everything else → allow** (incl. unknown permission types).
   The Testlauf uses the same function.

Since 2026-10-16 (AN-04) layer 2 judges each part of a command in a **canonical form** (`canonical()`: `& "C:\…\python.exe" -B -c` →
`python -c`, `git --no-pager push` → `git push`, `powershell -NoProfile -EncodedCommand` → `powershell -Command`), resolves `..`,
reads `cd` in order, treats `$env:`/`$HOME` paths as outside, asks for unknown request kinds, and the safe dirs are only
OpenCode's `plans`, `tool-output`, state and `%TEMP%\opencode` folders. Layer 1 passes variants like `python -B -c` on to
layer 2 (`python * -c*` ask). Regression check: `requests.test.ts` (27 tests) + 142 real agent commands from the session DB.

---------------------------------------------------------------------------------------------------------------------

## 6. Claude modes (paid, need a key; never run for real yet)
- **Autopilot** (free): prefix tells the local model to follow skill `batch-autopilot`. Effect never measured.
- **Offload (slider "Claude-Hilfe", 0–50 %, above the prompt box, since 2026-10-16):** the slider sets a budget — how
  much of a task may go to Claude, as a share of the combined work in tokens (`offloadBudget`) — and is mirrored to the
  companion (`POST /offload-prefs`). Two trigger paths, both gated by a content safety gate (`offloadAllowed` in the UI
  + `offloadBlocked` in the companion: blocks explicit/face-swap, secrets, personal data) and the daily cap:
  1. **MCP tool `claude_helfer`** (`companion/claude-mcp.mjs`, a stdio JSON-RPC server wired in opencode.json `mcp`):
     the local model calls it with a self-contained subtask; it forwards to `POST /claude {kind:'offload'}` and returns
     Claude's solution **back into the turn** (fixes AN-11's "not fed back"). Offered only when the slider is > 0
     (tools/list asks the companion), so zero token cost when off. **Proven end-to-end 2026-10-16** on the test model
     (model → OpenCode → MCP → companion → gate).
  2. **Legacy text markers** `<<<CLAUDE … >>>` (post-turn, junk/echo/example dropped — F22 fix); result shown as a bubble.
  **Measured 2026-10-16: the local 27B model does NOT spontaneously offload** — on ideal, self-contained benign tasks
  (even told it may use `claude_helfer`) it did the work itself; it calls the tool reliably only when told to directly.
  So auto-offload up to the slider rarely fires on its own with this model; the tool works reliably when invoked. The
  plumbing (slider, gate, budget, MCP tool, feedback) is solid; the spontaneous trigger is a model-behaviour limit.
- **Audit (toggle in Modi):** after each turn the answer *prose* (not the files the tools wrote) goes to Claude for review.
- Spend: price table in the companion, daily cap per UTC day (the cap value still comes from the request — AN-10, open).

---------------------------------------------------------------------------------------------------------------------

## 7. Testlauf (scripts/eval.mjs + eval/tasks)
`node scripts/eval.mjs --base http://127.0.0.1:4196 [--level schwer] [--repeat 2] [--variant ohne-denken] [--tasks a,b] [--keep]`.
Per task: copy `start/` to `~/.opendante/eval/<stamp>/`, `git init`, new session, `prompt_async` (agent build), poll
every 2 s (permissions via `autoDecision`, questions rejected), stop at idle or `timeoutMin` (abort), metrics from
`GET /session/{id}/message`, run `check.*` (exit 0 = solved, 60 s limit), delete passed sessions, write
`eval/results/<stamp>_<label>.{md,json}` and a line in `verlauf.jsonl`.
13 tasks: 7 leicht (fix-offbyone, roemisch, umbenennen, wortzaehler, code-lesen, todo-modul, js-export), 6 schwer
(bugjagd, feature-csv, klassen-umbau, cli-aufgaben, js-rechner, log-analyse); checks pin start files by hash and use
hidden inputs and reference models. **Pitfalls:** default `--base` is the live 4096 (always pass 4196); default
variant = thinking ON (the app default is off → pass `--variant ohne-denken`); a timed-out run still counts as solved
if its files are right; 12/12 vs 9/12 is p≈0.11, not significant.

Tests: `npm test` in `web/` = 17 files, 147 Vitest [verified 2026-10-16]; `node companion/test.mjs` = 52 checks
[verified]; `npm run e2e` = 8-step smoke with mocked servers in system Chrome. Untested: every component except
FilePicker, the stores, Claude request bodies, `autoDecision` for non-bash types and the hole classes above.

---------------------------------------------------------------------------------------------------------------------

## 8. Findings backlog (prioritised; IDs AN-xx)

Status: open unless marked. Details and line numbers: `docs/analyse/2026-10-16/<A|B|C|D>-*.md` (finding IDs there in brackets).

### P1 — can break the app, lose data or run unwanted commands
| ID | Finding | Evidence |
|---|---|---|
| AN-01 | ~~**Companion dies on one malformed URL**~~ **Fixed 2026-10-16**: URL parsed inside try, `/%` → 400, Host-header allow-list, unhandled-rejection guard, stream/spawn error handlers; 5 new checks in `companion/test.mjs` (fail on the old server). Was: (`GET /%` or `//`): `decodeURIComponent`/`new URL` throw outside the try, unhandled rejection ends Node; UI dead until next start. Any web page could fire it (no-Origin GETs are allowed). Fix: parse inside try, `await serveStatic`, `process.on('unhandledRejection')`, Host-header allow-list. | [verified] throwaway companion :4297 (C-F3, C-F4) |
| AN-02 | ~~`start.ps1` loop variable `$root` overwrote `$Root` → after "Ja" in the OpenDali dialog the app never opened.~~ **Fixed 2026-10-16** (renamed `$daliRoot`). | [verified] PS 5.1 probe (C-F1) |
| AN-03 | ~~`install.ps1` garbles umlauts~~ **Fixed 2026-10-16** (reads/appends AGENTS.md as UTF-8 via .NET; 3 simulated runs keep äöüß). Was: `install.ps1` garbles umlauts in the user's global-instructions block on every install/update (`Get-Content -Raw` reads BOM-less UTF-8 as ANSI). Fix: `-Encoding UTF8`. | [verified by agent probe] (C-F2) |
| AN-04 | **Fixed 2026-10-16** (`requests.ts` judges a canonical form of every command part: program name without path/.exe/quotes, interpreter/git options skipped, PowerShell/cmd code detection; `..` resolved, relative `..` read in `cd` order, `$env:`/`$HOME` paths outside; drive-root workdir no longer contains everything; downloads from non-local URLs, publish, robocopy /MIR, net/netsh/setx/taskkill … ask; safe dirs narrowed to `plans` + `tool-output`; unknown permission kinds ask; config asks for `python * -c`, `git branch -D`, `find -delete`, `npm publish`, plan agent denies deletes). Checked on 142 real agent commands: 3 decisions changed, all intended. Was: Auto-allow / config holes: interpreter or git with `.exe`, full path, or a flag before `-c`/`push`; `powershell -NoProfile -EncodedCommand`; `robocopy /MIR`, `net user`, `setx`, `taskkill`; `..`/relative/`$env:` paths; one-liner denylist bypass (`from os import remove as r`); `find -delete`, `npm publish`, `git branch -D` allowed by config; whole OpenCode data dir counted as safe; unknown permission types allowed. Fix: normalise the program token (strip quotes/path/.exe, skip flags), resolve `..`, treat relative paths with `..` and `$env:`/`$HOME` as outside, extend RISKY, fail closed for unknown types, narrow config allows. | [verified] sample (B-F1..F10, D-F-A2..A6) |
| AN-05 | **Fixed 2026-10-16**: after every reconnect and every 8 s (turns older than 15 s) the UI asks `GET /session/status`; an idle session is rebuilt from `GET /session/{id}/message` (`turnFromMessages`) and ended; a turn with a gap re-reads its final text and is not learned from. Verified on a real stored session (48 messages). Was: UI can hang on "läuft" forever after an SSE gap: events during the reconnect (incl. idle) are lost, only permissions are re-synced. Fix: on reconnect call `GET /session/status` (+ messages) for the active session. | [code] (A-F1) |
| AN-06 | **Partly fixed 2026-10-16**: events of other sessions no longer change or end the current turn (`eventSession`); permission cards of other sessions still show. Was: No session filter on events: another session in the same folder (TUI, second window, a run left over after a folder change) feeds text into / ends the current turn; its permission cards show up too. | [code] (A-F2) |
| AN-07 | Folder change and deleting the active chat start a new chat without aborting the running server session (it keeps writing files). Stop marks the turn only after `abort()` returns, so idle can win the race → cut-off turn learned as normal and sent to Claude. | [code] (A-F3, A-F4) |
| AN-08 | While `online` is still `null` (first seconds) or after any SSE blip, a sent message runs the canned demo text instead of the model; with Offload/Audit + key, that demo text is sent to Claude (paid). | [code] (A-F5, A-F9, B-F19) |
| AN-09 | Claude key can be wiped: "Speichern"/"Verbindung testen" send the localStorage copy; empty → companion deletes `claude-key.json` (e.g. new Chrome profile, or `localhost` vs `127.0.0.1` origin). Key also sits in plaintext in localStorage. | [code] (B-F24, B-F25, C-F9) |

### P2 — wrong numbers, wasted time, misleading UI
| ID | Finding |
|---|---|
| AN-10 | Daily Claude cap is whatever the request sends (missing/0/empty field = no cap); check before the call, no lock → overshoot. Any local process (also the agent via `curl`) can call `/claude`, `/settings`, `/skills` without a token. (C-F5, C-F6, B-F23) |
| AN-11 | **Partly fixed 2026-10-16**: Claude results now land in the chat they belong to (chat-id guard); the offload/audit post-processing no longer runs for the offline demo or a stopped turn; the wrong Modi privacy claim removed. **Mostly fixed 2026-10-16**: the MCP tool `claude_helfer` returns the result into the turn (feedback), so the local model sees it; the legacy marker path still only shows a bubble; Audit still reviews only the answer prose. (B-F17, F20) |
| AN-12 | Preload overlay blocks the whole window with no timeout/cancel; a model switch during a load is ignored; preload does not check that the GPU is free (OpenDali). (A-F10, A-F11) |
| AN-13 | Installer reports "Oberfläche gebaut" with a stale `web/dist` after a failed build (checks only that the file exists). (C-F11) |
| AN-14 | Ollama env (KEEP_ALIVE, context) never reaches an already running Ollama; launcher neither restarts nor warns. (C-F15) |
| AN-15 | GPU guard is one-way and optional: "Nein" in the OpenDali dialog continues, nothing re-checks VRAM, nothing unloads Ollama before OpenDali. (C-F14) |
| AN-16 | Every `sendPrompt` failure silently opens a fresh session (model loses context) and shows "Konnte den lokalen Server nicht erreichen" whatever the real error; Einstellungen likewise maps every error to the offline hint. (A-F8, B-F27) |
| AN-17 | Testlauf: default `--base` 4096 (the user's live instance); failed `/session/status` = idle → early end; timed-out runs count as solved; "own tests" checks count asserts only; no config hash in results. (D-F-C1..C6) |
| AN-18 | Learning skew: prefill ≥ 30 s always treated as model load; samples not per model; task time includes waiting on permission cards. (A-F15) |
| AN-19 | Whole App re-renders 10×/s during a run, no memoisation; auto-scroll forces the view down while streaming (cannot scroll up to read). (A-F24, A-F25) |

### P3 — gaps, dead code, stale docs
| ID | Finding |
|---|---|
| AN-20 | Slash commands `/commit`, `/review`, `/test` and the review agent are unreachable from the web UI (no command endpoint call); `/review` as subagent likely hits the Ollama task-500. (D-F-B1, B2) |
| AN-21 | Dead code: most of `eta.ts` (+8 tests), `api.sessionStatus/sessionMessages` (useful for AN-05), `companionHealth`, `costUsd/todayUsd`; duplicate `/api/ps` poll in Clock. (A-F16..F18, B 6D) |
| AN-22 | Stale docs: SETUP.md (untested on Windows, terminal UI), PLAN.md (7 tasks, Turing note), RESEARCH.md (thinking "low"), header of install.ps1, comments in settings.ts/Modi.tsx/claude.ts/server.mjs about the key location and defaults. (D 5.3, B 6D, C E) |
| AN-23 | Companion robustness: no timeout/credential-prompt guard on git (`push` can hang forever), no `error` handler on `/update/*` spawn and static streams, no listen-error handler, no logs (runs hidden). (C-F7, F8, F18, F25) |
| AN-24 | Testlauf coverage: plan agent, commands, autopilot, attachments, huihui model never measured; easy tasks not re-run since the 16k limit and the "schnell" default. (D-F-C7) |

Root cause still unknown: what killed `ollama serve` (exit −1) twice on 2026-10-16 10:35/10:46.

---------------------------------------------------------------------------------------------------------------------

## 9. Where to look for …
| Question | Start here |
|---|---|
| Answer text wrong/missing, thinking in the answer | `stream.ts reduceEvent`, part type routing; `Bubble.tsx` |
| Stuck "läuft", no end | SSE in `App.tsx` connect effect, `api.ts connectEvents`, AN-05/06; `GET /permission` (unanswered card?) |
| Command asked or not asked | `opencode.json permission.bash` first, then `requests.ts autoDecision`; test with the snippet in section 5 |
| Countdown/progress odd | `progress.ts`, `Clock.tsx`, localStorage `openllm.steps/tasks` |
| Model slow to start / not on GPU | `ollama ps`, `nvidia-smi`, orphaned `llama-server.exe`, Ollama `server.log` in `%LOCALAPPDATA%\Ollama`, `ollama.ts`/`ensureLoaded` |
| Undo/changes line empty | is the folder a git repo (`GET /project/current`)? `.gitignore`? `diffs.ts` filter |
| Claude key "missing" | `~\.opendante\claude-key.json`, localStorage `openllm.modes.apiKey`, `POST /claude/test` |
| App window blank / "Dienst startet nicht" | companion process on :4097, `web\dist` built?, AN-01 crash |
| Config change has no effect | `~\.config\opencode\opencode.json` vs `config\`, launch signature, `opencode models ollama` |
| Measuring a change | `node scripts/eval.mjs --base http://127.0.0.1:4196 --level schwer --repeat 2 --variant ohne-denken` on a test instance |
