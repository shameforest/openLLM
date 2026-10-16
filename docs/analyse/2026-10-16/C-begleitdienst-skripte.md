# Map C: companion + scripts (OpenDante, C:\openLLM)

Scope: `companion/server.mjs` (486 lines), `companion/test.mjs` (163), `scripts/install.ps1` (206), `scripts/start.ps1` (130). All four read completely, plus PROGRESS.md and CLAUDE.md. Read-only; no server started by me, no process killed, no model loaded. Environment seen: Windows 11, Windows PowerShell 5.1.26100, Node v24.19.0, git 2.55.0; at the time nothing listened on 4000-4999 / 11434 / 8188 (checked with netstat).

What I ran (all harmless, nothing in the project changed):
- `node companion/test.mjs` (it starts its own companion, see section 4): **47 `ok:` lines, 0 FAIL, "all companion checks passed"**.
- Pure-computation probes in the scratchpad (deleted afterwards): `new URL`, `decodeURIComponent`, `path.join/normalize/resolve`, the `modelOk` / `repoName` / skill-description regexes, an unhandled-rejection exit. Two PowerShell 5.1 probes on temp files (variable scoping in `foreach`; BOM-less UTF-8 round trip through `Get-Content -Raw` + `Add-Content -Encoding UTF8`).

Labels: **sicher** = verified by code reading plus an executed probe or the test run. **Verdacht** = derived from code/known semantics, not executed end to end.

---------------------------------------------------------------------

## 1. Companion (companion/server.mjs)

### 1.1 Configuration, env vars, data locations

| Name | Default | Used for | Line |
|---|---|---|---|
| `OPENDANTE_ROOT` | parent of `companion/` | repo root; `web/dist` and `config/models.json` are read from it; also the `cwd` and `Set-Location` target of `/update/app` | 14, 15, 20, 180 |
| `OPENCODE_CONFIG_DIR` | `~/.config/opencode` | where AGENTS.md, `skills/`, `opencode.json` live (same variable name OpenCode itself knows; here it only redirects the companion) | 16 |
| `OPENDANTE_COMPANION_PORT` | 4097 | listen port; also builds the allowed origins | 17, 34 |
| `OPENDANTE_MODEL` | `config/models.json` `.default`, fallback `qwen3.8:27b` | default for `ollama pull` | 19-21 |
| `OPENDANTE_PROJECTS` | `~/OpenDante-Projekte` | clone target, `/repos` listing | 24 |
| `OPENDANTE_DATA` | `~/.opendante` | `chats/<id>.json` + `<id>.meta.json`, `claude-key.json`, `claude-usage.json` (the last two sit in `path.dirname(CHATS)` = the data dir) | 25, 28, 360 |
| `OPENDANTE_ORIGINS` | empty | comma-separated extra allowed origins | 36 |

The server listens only on `127.0.0.1` (L486). No other env var is read. The companion never talks to OpenCode (4096) or Ollama (11434); the browser does that directly. Its only outbound network calls: `https://api.anthropic.com/v1/messages` (L394, L414) and the `git`/`ollama` child processes.

start.ps1 sets for the companion process: `OPENDANTE_ROOT` (start.ps1:113) and, inherited, the four `OPENCODE_DISABLE_*` switches (they are set at start.ps1:58-61, before the companion starts). It does not set `OPENDANTE_DATA`, port, or origins.

### 1.2 Request pipeline (L442-449)

1. `new URL(req.url, 'http://x')` (L443) - **outside** the try/catch (see F3).
2. `res.cors = corsFor(req)` (L444): only if `Origin` is in `ALLOWED_ORIGINS` the answer carries `access-control-allow-origin: <that origin>`, `vary: Origin`, allow-headers `content-type`, allow-methods `GET,POST,OPTIONS`. Never `*`.
3. `originOk` (L38, L445): **no Origin header = allowed** ("a local tool, not a page"); Origin present and not in the set = HTTP 403 `{error:'Fremde Herkunft abgelehnt.'}`. Allowed set (L33-37): `http://127.0.0.1:<PORT>`, `http://localhost:<PORT>`, `http://127.0.0.1:5173`, `http://localhost:5173` (Vite dev) + `OPENDANTE_ORIGINS`. `Origin: null` is rejected. No `Host` header check anywhere.
4. `OPTIONS` (L446): 204 with `res.cors` (empty for no-Origin requests). Comes after the origin check, so a foreign preflight gets 403 (test L35-36).
5. Every `POST` must have `content-type` starting with `application/json`, else 415 `{error:'Nur JSON-Anfragen.'}` (L447-449). Runs before routing, so also `POST /health` and unknown POST paths.
6. Routing inside `try`; any thrown error -> **HTTP 400** `{error: String(e.message)}` (L481-483), including internal errors (messages can contain absolute paths).
7. Unknown non-GET request -> 404 `{error:'not found'}` (L480). **Every unmatched GET goes to `serveStatic`** (L479), so the 404 JSON is unreachable for GET; HEAD gets the 404 JSON.

`readBody` (L45-50): collects the whole body, `JSON.parse`, empty body -> `{}`. No size limit.

### 1.3 Route table

Response is JSON with HTTP 200 unless noted; all errors are 400 `{error}` (L481-483). "state" = local file/process effects.

| # | Method + path | Request (body / query) | Response | Reads / writes / spawns | Validation and safety | Lines |
|---|---|---|---|---|---|---|
| 1 | any `/health` | - | `{ok:true, service:'opendante-companion'}` | none | no method check | 451 |
| 2 | GET `/skills` | - | `[{slug,name,description}]` sorted by name | reads `CFG/skills/*/SKILL.md` | name/description parsed by regex from the `---` head; description cut at first quote/apostrophe (`Don't` -> `Don`) and a folded `>` yields `>` (probe-verified) | 452, 84-99 |
| 3 | POST `/skills` | `{name, content}` | `{ok:true, slug}` | writes `CFG/skills/<slug>/SKILL.md` (overwrites; mkdir -p) | slug = lowercase, `[^a-z0-9-]+` -> `-`, trim dashes, empty -> error "Ungueltiger Name". No path traversal possible. No size limit | 469-473, 101-108 |
| 4 | GET `/repos` | - | `[{name,path}]` | reads dirs under `PROJECTS` that contain a `.git` directory | read-only | 453, 223-233 |
| 5 | POST `/repo/clone` | `{url}` | `{ok, name, path, updated, out, err}` | `git clone --depth 1 <url> <PROJECTS>/<name>` or, if `<dest>/.git` exists, `git -C <dest> pull --ff-only`; mkdir of PROJECTS | `repoName()` regex `^https://github.com/<owner>/<repo>(.git)?/?$` (case-insensitive); name chars `[\w.-]`, `.`/`..` rejected; argv array, no shell; URL passed to git is the trimmed original and always starts with `https://github.com/` | 460, 201-220 |
| 6 | GET `/chats` | - | meta[] newest first (`id,title,createdAt,updatedAt,workdir,model,messages(count),usage`) | reads all `<data>/chats/*.meta.json`; half-written ones skipped | - | 454, 305-315 |
| 7 | GET `/chats/<id>` | id = `pathname.slice(7)` (not URL-decoded) | the full chat JSON | reads `<id>.json` | `chatIdOk` `^[a-z0-9-]{8,64}$`; `..%2F..%2Fx` rejected (test L74) | 457, 317-320, 283 |
| 8 | POST `/chats` | chat `{id, title, createdAt, workdir, model, messages[], usage, ...}` | meta | writes `<id>.json` (whole object + meta) and `<id>.meta.json`; mkdir | id regex; `messages` must be an array; title cut to 120; client extras are stored verbatim; two non-atomic writes | 458, 285-302 |
| 9 | POST `/chats/rename` | `{id, title}` | meta | load + re-save both files (bumps `updatedAt`) | id regex; empty title rejected; max 120 | 455, 323-330 |
| 10 | POST `/chats/delete` | `{id}` | `{ok:true, id}` | `fs.rm` both files (`force`) | id regex | 456, 333-338 |
| 11 | GET `/fs` | `?path=<abs dir>` and optional `&files=1` | no path: `{path:'', parent:null, dirs:[roots...]}`; with path: `{path, parent, dirs:[{name,path}], files?:[{name,path,size}]}`. Errors: "Ordner nicht lesbar: <code>" | `readdir`/`stat` of **any** path; roots = drive letters A-Z that `stat` as dirs + Benutzer, Desktop, Dokumente, OpenDante-Projekte | no allow-list; `path.resolve` (relative paths resolve against companion cwd, UNC paths accepted); hides names starting `$` and `System Volume Information`; max 500 files; directories only follow symlinks if they stat as dir/file | 459, 154-170, 115-150 |
| 12 | POST `/git` | `{path, action: status/pull/push/commit, message}` | `{code, out, err}` of the git call (commit failing at `add` returns the add result) | `git -C <path> status --short --branch` / `pull --ff-only` / `push` / `add -A` then `commit -m <message>` | `path.resolve(String(dir||''))` must contain a `.git` **directory**; action whitelist; commit needs a non-empty message (passed as one argv element); no shell | 461, 236-250 |
| 13 | POST `/git/prepare` | `{path}` | `{created: true/false}` | writes `<path>/.gitignore` (default: node_modules/, .venv/, venv/, __pycache__/, *.pyc, dist/, build/, .next/, .cache/, target/, .opendante/) only if none exists | path must be an existing directory; refuses drive root, home, Desktop, Documents, Downloads, `X:\Windows`, `X:\Program Files[ (x86)]`, `X:\ProgramData` (German error "...nicht ein...") | 462, 264-277 |
| 14 | POST `/settings` | `{globalInstructions, apiKey, claudeModel}` | `{ok:true}` | (a) rewrites `CFG/AGENTS.md` marker block, (b) writes or **deletes** `<data>/claude-key.json`, (c) removes `provider.anthropic` from `CFG/opencode.json` if present | missing/empty `apiKey` = delete the key file; key only trimmed, no format check | 463-468, 56-81 |
| 15 | POST `/claude` | `{system, prompt, model, capUsd}` | `{text, model, usage:{input_tokens,output_tokens}, costUsd, todayUsd}` | reads key file (legacy fallback `opencode.json`); POST to api.anthropic.com `max_tokens 4096`; updates `<data>/claude-usage.json` | no key -> "Kein Claude-Schluessel gespeichert..."; cap check uses the **request's** `capUsd` (see F5); `model` not whitelisted (unknown model billed at the Opus rate) | 474, 385-406 |
| 16 | POST `/claude/test` | `{model}` | `{ok, model}` or `{ok:false, model?, error}` | key file read; 1-token ping (`max_tokens 1`) | not counted in the usage file, not capped; network errors returned as `{ok:false,error}` | 475, 409-423 |
| 17 | GET `/claude/usage` | - | `{date, usd, calls}` (date = UTC `YYYY-MM-DD`; other day = zeros) | reads `<data>/claude-usage.json` | - | 476, 368-374 |
| 18 | POST `/update/app` | (body ignored) | `{started:true}` or `{started:false, note}` (non-Windows) | spawns detached `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '<ROOT>'; git pull; ./scripts/install.ps1 -SkipModel"` | `stdio:'ignore'`, `unref()`, no `windowsHide`, no `error` listener (F7), no lock against double start | 477, 175-184 |
| 19 | POST `/update/models` | `{model}` | `{started:true}` | spawns detached `ollama pull <model or MODEL>` | `modelOk` regex `^[\w.-]+(\/[\w.-]+)?(:[\w.-]+)?$` (checked before the platform check); argv array. Regex accepts a leading dash (F19) | 478, 175-184, 23 |
| 20 | GET anything else | - | static file from `web/dist` | reads `web/dist` | see 1.4 | 479, 426-440 |

No route returns the Claude key, and no route reads the key into a response or error text.

### 1.4 Static serving and SPA fallback (L426-440)

- `rel = decodeURIComponent(new URL(req.url,'http://x').pathname)`; if `rel === '/'` or the path has **no extension** -> `/index.html` (SPA fallback; this is also why an unmatched API GET such as an old companion's missing route silently returns HTML - the 2026-10-14 "empty skills list" bug in PROGRESS).
- `file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))`, then `file.startsWith(DIST)` else 403. Traversal probes (`/..%2f..%2fwindows/win.ini`, `/C:/Windows/win.ini`, `/..\..\x.ini`) all end **inside** `web\dist` (probe output: `C:\openLLM\web\dist\windows\win.ini`, `...\dist\C:\Windows\win.ini` (invalid on NTFS -> 404), `...\dist\x.ini`). **sicher: no path traversal in static serving.**
- Must be a regular file (`stat.isFile()`), else the 404 text "web/dist fehlt - bitte scripts/install.ps1 ausfuehren..." (also used for any missing file).
- MIME map has only 10 types (html, js, css, json, svg, png, ico, woff2, webmanifest); everything else is `application/octet-stream` (no `.map`, `.mjs`, `.txt`, `.jpg`, `.webp`, `.gif`, `.woff`, `.ttf`, `.wasm`). No cache, security or length headers; file is streamed with `createReadStream(...).pipe(res)` without an error handler (F8).

### 1.5 How opencode.json and AGENTS.md are edited

AGENTS.md (`setGlobalInstructions`, L56-64), file `CFG/AGENTS.md`:
- Markers: `<!-- OPENDANTE-USER-START -->` ... `<!-- OPENDANTE-USER-END -->` (L53). The same literal markers are duplicated in install.ps1:159.
- Algorithm: read file (empty if missing) -> regex `\n*START[\s\S]*?END\n*` replaced by `\n` (first block only) -> `\s*$` trimmed -> append `\n\nSTART\n## Persoenliche Anweisungen des Nutzers\n<text>\nEND\n` when the text is non-empty, else just `\n`. Writes UTF-8 without BOM; mkdir -p of `CFG`. Called on every `/settings` POST, even when only the key changed.
- Weak spot: if the user's text contains the literal END marker the next replace stops early and leaves a tail (F27).

opencode.json (L76-80): the companion **does not add anything** any more. On every `/settings` POST it parses `CFG/opencode.json`; only if `provider.anthropic` exists it deletes that key and rewrites the whole file with `JSON.stringify(cfg,null,2)` (non-atomic; a JSONC/invalid file just fails the parse and is skipped). `readAnthropic()` still reads a legacy key from `provider.anthropic.options.apiKey` as a fallback (L347-352) - effectively dead after the first save (F31).

### 1.6 Claude key storage, /claude proxy, daily cap

- Key + model: `<data>/claude-key.json` = `{apiKey, model}` plain text, default model `claude-sonnet-5-5` (L71). No special file mode (irrelevant on Windows; inherits the profile ACL). Never logged (the only console output is the listen line, L486), never returned by any route, not in error texts.
- Besides the companion file, the **browser stores the same key in localStorage** `openllm.modes` (web/src/settings.ts:56 field `apiKey`, persist name at :80) and re-sends it on every save (web/src/SettingsPanel.tsx:161, 166). Because POST `/settings` deletes the key file when `apiKey` is empty, losing the localStorage (cleared site data, or opening the app via `localhost` instead of `127.0.0.1`, which is a different origin) wipes the key on the next save (F9).
- Proxy: `callClaude` -> `fetch('https://api.anthropic.com/v1/messages')` with `x-api-key`, `anthropic-version: 2023-06-01`, `max_tokens 4096`, one user message. No timeout/AbortSignal. Cost = `(in*priceIn + out*priceOut)/1e6` from `CLAUDE_PRICES` {opus-5-5 [4,20], sonnet-5-5 [2,10], haiku-5-5 [0.1,0.5]} (L358, comment says "cached 2026-10-06" - **not re-checked by me**; unknown models are billed as Opus).
- Daily cap: the number comes from the **request body** (`capUsd`, L385/388): `cap = Number(capUsd)||0`, `if (cap>0 && todayUsd >= cap)` -> error "Tageslimit fuer Claude erreicht ..." (checked before the network call, test L47-48). Usage file `{date,usd,calls}`, date = UTC day (reset 00:00 UTC = 01:00/02:00 German time). Usage is added **after** a successful response only (L404); failed calls cost nothing. See F5/F6.

### 1.7 Git / clone / update: how processes are spawned

- `runCmd(cmd,args,cwd)` (L188-198): `spawn(cmd, args, {cwd})`, **no `shell`**, stdio piped, collects stdout/stderr, resolves `{code,out,err}`; has an `error` listener (ENOENT -> `code -1`). No timeout, no `GIT_TERMINAL_PROMPT`/`stdin` handling (F18).
- `runUpdate` (L175-184): `spawn(cmd,args,{detached:true, stdio:'ignore', cwd:ROOT})` + `unref()`; no `error` listener (F7). Only on win32.
- Argument handling: URL (must begin `https://github.com/`), absolute `dest`/`p` after `path.resolve`/`path.join`, commit message as the single value after `-m`, model name by regex. **No command injection found (sicher)**; the residual risk is option injection of a leading `-` in `modelOk` (F19) and the single-quote interpolation of `ROOT` into the PowerShell string (L180; harmless for `C:\openLLM`).

---------------------------------------------------------------------

## 2. scripts/install.ps1

Parameters (L9-14): `-Model <ollama tag>` (default: `config\models.json` `.default`, read with `Get-Content -Raw | ConvertFrom-Json`, L20), `-SkipModel` (skips step 5 only). No other switches. `$ErrorActionPreference="Stop"`, `$ProgressPreference="SilentlyContinue"`. Transcript to `logs\install-<timestamp>.log` (L21-24). `Fail()` prints the log path ("schick Claude diese Datei"), stops the transcript and `exit 1` (L28-32). Steps are labelled `[n/6]` (L26).

| Step | Lines | What it does |
|---|---|---|
| (pre) | 33-42 | `Refresh-Path`: **replaces** `$env:Path` by User + Machine + `~\scoop\shims`. |
| 1/6 Scoop | 44-53 | If no `scoop`: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` (try/catch), `Invoke-RestMethod https://get.scoop.sh \| Invoke-Expression`, re-check, else Fail. |
| 2/6 OpenCode | 55-81 | Not installed: `scoop install opencode`, Fail if still missing. Installed: remember `opencode --version`, `scoop update opencode 2>$null`, and if the new version is not `1.*` while the old was, `scoop reset opencode@<before>` with a yellow message. Afterwards Fail if the version is non-empty and not `1.`; an empty version string passes silently. |
| 3/6 Ollama | 83-98 | If no `ollama`: download `https://ollama.com/download/OllamaSetup.exe` to `%TEMP%`, run `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` hidden with `-Wait`, sleep 2 s, `Refresh-Path`, Fail if missing. No checksum/signature verification (F29). |
| 4/6 Ollama settings | 100-111 | **User-scope** env vars: `OLLAMA_CONTEXT_LENGTH=65536`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KEEP_ALIVE=60m`, `OPENCODE_EXPERIMENTAL_PLAN_MODE=1`. The message says "wirkt nach Neustart von Ollama/OpenCode"; nothing restarts them (F15). |
| 5/6 Model | 113-122 | Unless `-SkipModel`: `ollama pull $Model`; non-zero exit -> Fail. No free-disk check for the ~18 GB. |
| 6/6 Config + shortcut | 124-206 | see below |

Step 6 details:
- Creates `~\.config\opencode\{agents,commands,skills}` (L127-128).
- **opencode.json** (L129-154): if a target exists, read `.provider.anthropic` into `$keepAnthropic` (legacy) and copy the file to `opencode.json.vorher` (overwritten at every run, one generation). `Copy-Item -Force config\opencode.json` over it (the user's whole file is replaced). If `$keepAnthropic` -> re-inject it via `Add-Member` and write with `ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8` (BOM in 5.1). **Validation**: with `$ErrorActionPreference="Continue"`, `& opencode models ollama 2>&1 | Out-String`; `$LASTEXITCODE -ne 0` -> restore `.vorher` (if it exists), print the ANSI-stripped output, Fail. This proves "config loads", not that the model ids match `config\models.json` (that drift is guarded only by `web/src/models.test.ts` per the `_note` in models.json).
- **AGENTS.md** (L155-163): extract the user block with `(?s)<!-- OPENDANTE-USER-START -->.*?<!-- OPENDANTE-USER-END -->` from the old file, copy `config\AGENTS.md` over it, then `Add-Content -Encoding UTF8` the block back. **This corrupts non-ASCII text (F2).**
- Copies `config\agents\*.md`, `config\commands\*.md` (-Force) and `skills\*` recursively (-Force) into the config dir (L164-169). Files removed from the repo are never removed from the config dir; shipped skills overwrite same-named uploaded ones.
- **Web build** (L172-192): installs `nodejs-lts` via scoop if `node` is missing; if `npm` exists: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, in `web\`: `npm install --no-audit --no-fund *> logs\web-build.log` then `npm run build *>> ...`; success is decided only by `Test-Path web\dist\index.html` (F11). On failure prints the last 20 log lines and continues (exit code stays 0).
- **Desktop shortcut** (L194-201): `OpenDante.lnk` on the Desktop -> `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<Root>\scripts\start.ps1"`, working dir = Root; recreated at every run.
- Final lines: success message + hint to stop OpenDali before using OpenDante (L203-205).

Header comment (L1-7) still says "first draft ... VERIFY ... not yet run" (stale, F36).

---------------------------------------------------------------------

## 3. scripts/start.ps1 (exact order)

Param: `-Terminal` (open the OpenCode TUI instead of the web window). `$ErrorActionPreference="Continue"`. Helpers: `Note` (MessageBox), `Up($port)` = `Get-NetTCPConnection -LocalPort <p> -State Listen` truthiness (L9-11) - says nothing about *which* process listens.

1. **PATH** rebuilt from User + Machine + `~\scoop\shims` (L6-7).
2. **OpenDali/GPU check** (L17-35): only if port **8188** listens. MessageBox Yes/No. "Yes": look for `scripts\stop.ps1` in `$env:OPENDALI_ROOT`, `<parent of Root>\AI`, `C:\ai`, `C:\OpenDali`; first hit is run in-process (`& $s`) and `$stopped=$true`; if none, `Stop-Process -Force` on the owners of ports 8188 and 3790; 500 ms sleep. "No": nothing happens, start continues. No re-check afterwards. **The loop variable `$root` overwrites `$Root` (F1).**
3. **Orphaned runner cleanup** (L41-44): `$liveOllama` = PIDs of processes named `ollama`; every `Win32_Process` named `llama-server.exe` whose `ExecutablePath` matches `*\Ollama\*` and whose parent PID is not in that list is stopped. A runner belonging to a live Ollama is left alone.
4. **Ollama** (L45-49): if 11434 is not listening: find `ollama` (else MessageBox + `exit 1`), `Start-Process -WindowStyle Hidden ollama serve`. No readiness wait; an already-running Ollama is never checked for its environment or health.
5. **Work dir** `~\code` created (L52-53); it is the working directory of `opencode serve`.
6. **OpenCode env switches** for this process and its children (L58-61): `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`, `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`, `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_SHARE=1`. `$launchSig = "v2;skills-own-only;autoupdate-off;share-off"`, `$sigFile = <Root>\logs\opencode-launch.txt`, `$cfgFile = ~\.config\opencode\opencode.json`; `logs\` is created; `opencode` resolved via `Get-Command` else MessageBox + `exit 1` (L62-67).
7. **OpenCode restart decision** (L72-86), only if 4096 listens: take the first listener PID; `$sigOk` = sigFile exists and equals `$launchSig`; `$cfgNewer` = config `LastWriteTime` > process `StartTime`. If `$proc -and ($cfgNewer -or -not $sigOk)`: ask `GET http://127.0.0.1:4096/session/status` (3 s timeout); `busy` = any returned entry with `type -ne "idle"`; exceptions are swallowed so `busy` stays false. Not busy -> `Stop-Process -Force`, sleep 600 ms. Busy -> leave it running (and try again at the next launch).
8. **OpenCode start** (L87-98), if 4096 does not listen: validate config with `& opencode models ollama 2>&1`; non-zero -> MessageBox (first 500 chars of the cleaned output, path of the config) + `exit 1`. Else `Start-Process -WindowStyle Hidden opencode serve --port 4096 -WorkingDirectory ~\code` and write the signature file (ascii). No readiness wait, no check that the start worked.
9. **-Terminal** (L100-103): open a new PowerShell with `Set-Location '<work>'; & '<opencode>'` and `exit 0` (so the companion is not started in this mode).
10. **Companion** (L108-114): `node` via `Get-Command` else MessageBox + `exit 1`; **always** `Stop-Process -Force` the owner(s) of 4097 (whatever program it is), sleep 300 ms, `$env:OPENDANTE_ROOT=$Root`, `Start-Process -WindowStyle Hidden node <Root>\companion\server.mjs -WorkingDirectory <Root>` (no log redirection).
11. **Wait** up to 30 s for 4097 to listen (400 ms polls), else MessageBox "Der OpenDante-Dienst startet nicht." + `exit 1` (L117-118). Only "listening", not `/health`.
12. **Window** (L120-130): first existing of Chrome (ProgramFiles, ProgramFiles(x86), LocalAppData) then Edge (x86, ProgramFiles) -> `--app=http://127.0.0.1:4097 --window-size=1400,920` in the user's normal profile; else the default browser. Every launch opens another window.

---------------------------------------------------------------------

## 4. companion/test.mjs

Does it need a model or the real companion? No. It creates three temp dirs (`opendante-*`, `-proj-*`, `-data-*`), spawns **its own** `server.mjs` on a random port `4096 + floor(rand*500) + 50` (= 4146..4645, L12) with `OPENCODE_CONFIG_DIR`, `OPENDANTE_PROJECTS`, `OPENDANTE_DATA` pointing to the temp dirs and `stdio:'ignore'`, waits up to 4 s for `/health`, runs checks via `fetch`, kills the child and deletes the temp dirs in `finally`, exit code = failures?1:0. No network call to Anthropic happens (cap and missing-key paths fail before `fetch`). It needs `git` on PATH (real `git init` + `git status`). Safe to run: I checked first that nothing listened on 4000-4999.

What it covers (47 checks): foreign Origin POST 403 / GET 403 without CORS header / non-JSON POST 415 / own origin gets CORS / foreign preflight 403 (L27-36); settings -> AGENTS.md block + dedicated key file (L38-42); daily cap refusal, usage report, new-day reset (L44-52); skill slug + SKILL.md + listing with description (L54-59); chats: empty list, save+meta, newest-first metadata only, full load, bad id (POST and GET), rename (meta and full file), delete, bad delete id (L61-86); `/fs` roots, sub-folder list, parent string, missing folder error (L88-95), `files=1` listing/sorting/`$`-noise/no `files` key without the flag/roots (L97-112); `/update/models` bad name -> error, nothing run (L114-115); `/repos` empty, non-GitHub clone refused, `git status` in a real repo, non-repo refused (L117-128); `/git/prepare` creates `.gitignore`, keeps an existing one, refuses home and drive root (L130-143); empty key removes the key file, user block replaced not duplicated (L145-150); `/claude` and `/claude/test` without key fail cleanly (L152-155).

Result of my run: `ok:` x47, no `FAIL:`, final line "all companion checks passed". 

Not covered: static serving / SPA fallback / traversal, malformed URLs (`/%`), `OPTIONS` with an own origin, a successful `/claude` call, valid `/repo/clone`, `/git` commit/pull/push, valid `/update/*`, `OPENDANTE_ORIGINS`, body size, concurrency, `repoName` edge cases (`...`, `con`), `/git` with empty path.
Test hygiene issues: F10 (random port can hit a running dev companion); the child's early exit (EADDRINUSE) is not detected; `fs.rm(noRepo)` appears twice (L141, L143, harmless).

---------------------------------------------------------------------

## 5. Findings

Ordered by importance. File:line, one-sentence reason, label.

### A. Bugs that will bite the user

| ID | Where | Finding | Label |
|---|---|---|---|
| F1 | start.ps1:24 (uses `$Root` at 63, 65, 113, 114) | `foreach ($root in ...)` is the **same variable** as `$Root` (PowerShell is case-insensitive, `foreach` opens no scope); after the OpenDali prompt is answered "Ja" `$Root` is `C:\OpenDali` (or the found stop-script root), so the sig file path is wrong, `C:\OpenDali\logs` gets created (L65), `OPENDANTE_ROOT` is wrong and `node C:\OpenDali\companion\server.mjs` does not exist -> after killing the old companion (L110) the app never opens ("Der OpenDante-Dienst startet nicht" after 30 s). Probe in PS 5.1: `$Root='C:\openLLM'; foreach($root in ...){}` leaves `C:\OpenDali`. Introduced by commit cb0e4b6 (2026-10-16); the "Ja" path was not exercised on the Shadow PC according to PROGRESS. Fix idea: rename the loop variable. | **sicher** |
| F2 | install.ps1:159-163 | `Get-Content -Raw` reads the BOM-less UTF-8 AGENTS.md (which the companion writes) as ANSI in Windows PowerShell 5.1 and `Add-Content -Encoding UTF8` writes it back double-encoded: "Persoenliche" (with umlaut) becomes `PersÃ¶nliche`, "hoeflich" becomes `hÃ¶flich` (probe bytes `C3 83 C2 B6`). Every install.ps1 run, including `/update/app`, further garbles the user's global instructions (German text) until the next Save in Einstellungen rewrites the block from localStorage. Fix idea: read with `-Encoding UTF8` / `[IO.File]::ReadAllText`. | **sicher** |
| F3 | server.mjs:427 (+429, 479) and 443 | Crash by malformed URL: `decodeURIComponent` throws on `/%` and `/%zz`, and `serveStatic` is returned without `await` inside the `try`, so the rejection is not caught; `new URL(req.url,'http://x')` at L443 is outside the `try` and throws for `//`. The async request listener's rejection becomes an unhandledRejection, which terminates Node (probe: exit code 1 with stack trace). The companion has no `process.on('unhandledRejection')`, runs hidden and is not restarted until the next start.ps1. Probe-verified: both throw, `[eval] Promise.reject` exits 1. End-to-end via a live HTTP request **not run** (no server allowed). | **Verdacht** (conf 85) |
| F4 | server.mjs:38 and 442-449 | `originOk` accepts requests **without** Origin, but browsers omit Origin on cross-site `no-cors` GETs (`<img>`, `<script>`, navigation), so any web page the user visits can fire GETs at every GET route (cannot read the reply): triggers F3, makes the PC open `fs.readdir('\\\\host\\share')` through `/fs?path=\\host\share` (SMB reach-out), etc. Also no `Host` check, so DNS rebinding (attacker hostname -> 127.0.0.1, same-origin, GETs carry no Origin) could **read** `/chats`, `/chats/<id>`, `/fs`, `/skills`, `/repos`; POSTs would still be blocked by the Origin check. Needs a Host allow-list (`127.0.0.1:4097`/`localhost:4097`). | **Verdacht** (conf 60; the omitted-Origin behaviour is standard browser behaviour, not tested here) |
| F5 | server.mjs:385-388, 474 | The "server-side" daily cap is whatever the caller sends: omitting `capUsd` or sending 0 disables it. PROGRESS.md:24 says it is enforced in the companion. There is no auth token, so any local process (and the local uncensored agent through a shell `curl` to `127.0.0.1:4097`, which sends no Origin) can spend the Claude key unlimited, or call `POST /settings` / `POST /skills` to rewrite its own AGENTS.md instructions or skills. Store the cap server-side (e.g. in `claude-key.json`) and consider a per-session token. | **sicher** (cap logic), **Verdacht** (agent abuse path; depends on `requests.ts` auto-allow for `curl`) |
| F6 | server.mjs:375-381, 389-404 | Cap race: the check happens before the call and usage is added after, with a read-modify-write on `claude-usage.json` and no lock, so parallel offload/audit calls all pass and lost updates under-count the spend; a single call can also overshoot the cap (`>=` check, input unbounded). | **sicher** (logic) |
| F9 | server.mjs:463-468, 71-73; web/src/SettingsPanel.tsx:161,166; web/src/settings.ts:56,80 | Missing/empty `apiKey` in POST `/settings` deletes `claude-key.json` (and the legacy key in opencode.json). The UI re-sends the key from localStorage `openllm.modes`; if that is empty (cleared site data, or the app opened as `http://localhost:4097` instead of `http://127.0.0.1:4097` = different origin) the next Save wipes the key. Same plaintext key also sits in the browser profile (visible to extensions of the Chrome profile used by `--app`). | **sicher** (code); impact on the user depends on how the window is opened |
| F10 | test.mjs:12-16, 24 | Random test port range 4146-4645 contains the manual test ports 4196/4197 from CLAUDE.md; the port is not checked free and the child's exit is ignored. If a dev companion listens there, `/health` answers from *that* instance and the test then POSTs settings (deletes its `claude-key.json`), overwrites `claude-usage.json`, saves/renames chats `chat-test-0001` in its real data dir. Probability about 0.4 percent per run while a dev companion is up. Use port 0 / a free-port probe. | **sicher** (logic) |
| F11 | install.ps1:184 | Web build success = `Test-Path web\dist\index.html`; an old `dist` survives a failed `tsc`/`vite build`, so the installer prints "Oberflaeche gebaut" with a stale UI. npm exit codes are never checked. | **sicher** |
| F15 | install.ps1:100-111, start.ps1:45-49 | Ollama env vars are set (User scope) after Ollama was installed/started and nothing restarts a running Ollama; start.ps1 starts Ollama only if 11434 is down and never compares env. A tray-app Ollama keeps the old values (context default instead of 65536, `KEEP_ALIVE 5m`) - exactly what PROGRESS.md Log 2026-10-16 recorded. A launcher check (e.g. restart Ollama once after install) is missing. | **sicher** (code), effect confirmed by PROGRESS |

### B. Robustness

| ID | Where | Finding | Label |
|---|---|---|---|
| F7 | server.mjs:181 | `runUpdate` has no `child.on('error')`; if `ollama` (or `powershell.exe`) cannot be found, Node emits an unhandled `error` event and the companion crashes (while `runCmd` handles it). | **Verdacht** (Node semantics) |
| F8 | server.mjs:435 | `createReadStream(file).pipe(res)` without an `error` listener; a file vanishing/locked between `stat` and open (e.g. during `/update/app` rebuilding `web/dist`) throws uncaught. | **Verdacht** (low) |
| F12 | start.ps1:80-84 | `/session/status` is called without `directory`; per PROGRESS.md:39 OpenCode routes are folder-bound, so sessions running in another folder may not be listed and OpenCode is killed mid-task; a 3 s timeout/exception also counts as "not busy". | **Verdacht** (conf 45; the directory scope of this route was not checked) |
| F13 | start.ps1:76, install.ps1:137 | `cfgNewer` compares file mtime with the process start: if OpenCode rewrites `opencode.json` at every start (PROGRESS.md Log 2026-10-16 says it rewrites its config on start) it is "newer" at every launch -> restart every time; conversely `Copy-Item` preserves the source mtime, so restoring an older config does not trigger a restart. | **Verdacht** (conf 40; measure `LastWriteTime` vs process `StartTime` after a plain start) |
| F14 | start.ps1:17-35 | Only port 8188 is checked; answering "No" continues anyway (LLM next to ComfyUI); after "Yes" nothing re-checks that the GPU is free; no VRAM check (`nvidia-smi`); in the other direction nothing unloads the Ollama model before OpenDali. Port kill hits whatever owns 8188/3790. CLAUDE.md says "the launcher unloads one before the other runs". | **sicher** (logic) |
| F16 | start.ps1:96-98, 45-49 | OpenCode and Ollama are started without readiness wait; the signature file is written even if `opencode serve` dies immediately (port taken, crash), so a failed start is invisible until the 30 s wait for the companion succeeds and the UI shows "offline". | **sicher** (logic) |
| F17 | start.ps1:110-111 | The companion restart kills whatever listens on 4097 and a second double-click while the app is open restarts the companion under the running window (save/claude call in flight is lost) and opens a second window. | **sicher** |
| F18 | server.mjs:188-198 | `runCmd` has no timeout and sets no `GIT_TERMINAL_PROMPT=0`/closes no stdin: `git push`/`pull`/`clone` of a private repo without stored credentials can wait for a prompt forever and the HTTP request never answers (UI first-push login is mentioned in PROGRESS.md:33). | **Verdacht** (conf 60) |
| F25 | server.mjs:486 and start.ps1:114 | No `server.on('error')` (EADDRINUSE or other listen error = crash), no request/error logging, companion runs hidden with output discarded - a crash leaves no trace. | **sicher** |
| F33 | server.mjs:175-184 | `/update/app` has no lock (double click = two parallel `git pull` + `npm install`), runs `install.ps1` even if `git pull` failed, and `npm install` (not `npm ci`) may dirty a tracked `package-lock.json`, which makes the next `git pull` fail. The running companion is not restarted by the update. | **Verdacht** (low) |
| F35 | server.mjs:118-121 | `/fs` roots `stat` every drive letter A-Z; a dead mapped network drive can block for the SMB timeout. | **Verdacht** (low) |
| F20 | server.mjs:236-237, 266 | `path.resolve('')` is the companion's cwd = the OpenDante repo: `POST /git {action:'commit', message:'x'}` without `path` does `git add -A` + `commit` in `C:\openLLM` itself (probe: `path.resolve('')` = cwd). The UI always sends a path. | **sicher** (low) |
| F21 | server.mjs:213-217 | Clone target is `PROJECTS/<repo name>` only: `a/app` and later `b/app` collide and the second request silently `pull`s the first repo (reports `updated:true`). Windows reserved names (`con`, `nul`) pass `repoName` and fail in git; `...` resolves oddly on NTFS. | **sicher** (collision), **Verdacht** (names) |
| F22 | server.mjs:267-272 | The `prepareBackup` block list is narrow: `C:\Users`, `...\AppData`, `Pictures`, `Videos`, `OneDrive` are allowed, so a backup (`git init` by OpenCode) there would again be huge. | **Verdacht** (low) |
| F23 | server.mjs:45-50 | `readBody` has no size limit (local DoS; also chats are written unbounded). | **sicher** (low) |
| F24 | server.mjs:481-483 | Every error (including ENOENT/EACCES) is HTTP 400 and the message may contain absolute paths. | **sicher** (low) |
| F19 | server.mjs:23 | `modelOk` allows a leading dash (`--insecure`, `-h` match, probe-verified) -> option injection into `ollama pull`; no `--` separator. Impact low, no code execution. | **sicher** |

### C. Security notes (checked and found OK, so the caller does not re-check)

- **No path traversal** in `/chats` (id regex `^[a-z0-9-]{8,64}$`, ids without dot so `<id>.json` vs `<id>.meta.json` cannot collide; reserved device names are all shorter than 8 chars), `/skills` (slug whitelist), static serving (three probes stay inside `web\dist`), `/git/prepare` (writes only `<dir>\.gitignore`). `/fs` and `/git` deliberately accept any absolute path (read-only listing / git on any repo) - an unrestricted folder browser by design, which makes F4 matter.
- **No command injection** in clone/git/update: no shell anywhere, argv arrays, GitHub-only URL, absolute destination, commit message as `-m` value.
- **Origin bypass**: only via "no Origin" (F4); `Origin: null`, foreign origin, foreign preflight and form posts (`text/plain` -> 415, and Origin present on POST -> 403) are blocked (also test-covered).
- **Key leakage**: key never in responses, logs or errors from the companion; legacy transcript risk: if a legacy `provider.anthropic` block is merged by install.ps1 and `opencode models` then fails, OpenCode's error text could echo config content into `logs\install-*.log`, which the Fail message tells the user to send to Claude (conf 15, legacy installs only). Plaintext copy in browser localStorage: F9.
- `//evil.com/skills` is parsed to pathname `/skills` (probe) - route aliasing, harmless.

### D. Windows-specific traps (summary)

PowerShell variables are case-insensitive (F1); PS 5.1 `Get-Content` defaults to ANSI and `Set-Content/Add-Content -Encoding UTF8` writes a BOM for new files (F2, install.ps1:141); `Copy-Item` keeps the source mtime (F13); `Refresh-Path` replaces the whole PATH with User-first order (install.ps1:36, start.ps1:6); `Start-Process -WindowStyle Hidden` hides crashes (F25); `spawn(..., {detached:true})` without `windowsHide` opens a console window for `/update/*` (probably wanted as progress display); `Get-NetTCPConnection -State Listen` cannot tell programs apart; `startsWith(DIST)` check is case-sensitive but safe because `path.join` keeps DIST's casing; `prepareBackup` blocklist regex is backslash-only (Windows paths); the orphan-runner cleanup depends on the runner being named `llama-server.exe` under an `\Ollama\` folder (observed on this Ollama build, not guaranteed for other versions).

### E. Dead code, stale comments, contradictions with PROGRESS.md / CLAUDE.md

| ID | Where | Finding |
|---|---|---|
| F31 | install.ps1:129-142, server.mjs:347-352 | `$keepAnthropic` re-injection and `readAnthropic` legacy fallback belong to the old key location; since `claude-key.json` (server.mjs:28) the first `/settings` save deletes `provider.anthropic` again, so the two pieces fight each other and are effectively dead. |
| C1 | PROGRESS.md:46, 47, 51 vs server.mjs:28, 71, 344 | PROGRESS says the key + model live in an `anthropic` provider inside opencode.json and that install.ps1 "PRESERVES the user's Claude key"; the code stores them in `~/.opendante/claude-key.json` (PROGRESS Log 2026-10-16 has the new fact, the API section was not updated). |
| C2 | server.mjs:1-4, 341 | Header and comment still say the key is stored in/read from OpenCode's config. |
| C3 | PROGRESS.md:24 | "daily cap enforced in the companion" is only true if the caller sends `capUsd` (F5). |
| C4 | PROGRESS.md:47 | Route list lacks `/health`, `/git/prepare`, `/claude/test`, `/chats/rename|delete`, `GET /fs?files=1`, and the push/pull/status actions of `/git`. |
| C5 | CLAUDE.md "Testing locally" vs test.mjs:12 | Manual test companion is 4197 (OpenCode 4196); the automatic test picks a random port that can be exactly those (F10). |
| C6 | CLAUDE.md "launcher unloads one before the other" vs start.ps1:17-35 | Only OpenDali is stopped, only on port 8188 and only if the user agrees (F14). |
| F36 | install.ps1:1-7, 109 | Header "first draft ... VERIFY ... not yet run" contradicts PROGRESS ("install proven end to end"); typo "CLII client". |
| F26 | server.mjs:92-93 | Skill name/description regexes scan the whole file (not just the `---` head) and truncate at quotes (probe: `Don't skip` -> `Don`; folded YAML gives `>`). Cosmetic. |
| F27 | server.mjs:60 | User text containing `<!-- OPENDANTE-USER-END -->` leaves a tail after the next replace. |
| F37 | server.mjs:43 | MIME map is minimal (see 1.4). |
| F29 | install.ps1:49, 89-91 | Scoop (`iex` of get.scoop.sh) and OllamaSetup.exe are run without checksum/signature verification; `/update/app` executes whatever `git pull` brings. Standard for this kind of installer, but unverified supply chain. |
| F30 | install.ps1:137, 164-169 | Config files are overwritten wholesale; `.vorher` keeps one generation only; deleted repo files are never removed from the config dir. |
| - | test.mjs:141,143 | duplicate `fs.rm(noRepo)`. |

### F. Not verified / open

- Real Anthropic call, and the numbers in `CLAUDE_PRICES` (comment says cached 2026-10-06) - not checked.
- Whether OpenCode rewrites `opencode.json` on every start (F13), and whether `GET /session/status` is folder-scoped (F12).
- End-to-end crash of the companion by `GET /%` or `GET //` (F3): reproduce with a throw-away companion on a spare port: `curl --path-as-is http://127.0.0.1:<port>/%`.
- Behaviour of `ollama pull` with `--insecure` (F19) and of git credential prompts under the hidden companion (F18).
