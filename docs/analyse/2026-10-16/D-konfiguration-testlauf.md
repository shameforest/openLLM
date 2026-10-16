# Map D: config, agent rules, Testlauf (eval), docs

Scope read completely: CLAUDE.md, PROGRESS.md, config/opencode.json, config/AGENTS.md, config/agents/review.md, config/commands/{commit,review,test}.md, config/models.json, skills/batch-autopilot/SKILL.md, scripts/eval.mjs, eval/tasks/README.md, all 13 task.json, all 13 check.* (read fully, not only skimmed), docs/{PLAN,RESEARCH,SETUP}.md, README.md, STAND.md. Extra (to verify claims): web/src/requests.ts, web/src/models.test.ts, scripts/install.ps1 (l.96-175), eval/results/verlauf.jsonl, grep over web/src, companion, scripts. Nothing was run that loads a model; no project file was changed. A rule-matching simulation (last match wins, `*` = any, trailing ` *` = optional args) was run with node on stdin only.

Legend: "sicher" = read directly in the file (or arithmetic/simulation on file contents); "Verdacht" = depends on OpenCode/Ollama behaviour recalled from memory or unmeasured impact, confidence given in %.

---

## 1. config/opencode.json, key by key

JSON parses (node), 90 bash rules, no duplicate keys (checked). Top-level keys: `$schema, _note, model, autoupdate, share, provider, mcp, permission, agent`.

| Line | Key | Value / meaning |
|---|---|---|
| 2 | `$schema` | `https://opencode.ai/config.json` |
| 3 | `_note` | Long top-level comment (top-level underscore keys are tolerated; models.test.ts:22-34 only forbids `_` keys nested inside blocks). Content: pinned to OpenCode 1.x; comment key inside `permission` would invalidate the config; `limit.context/output` must be set (default 0); output 16384 not 8192 (2 of 6 hard tasks cut off, measured 2026-10-15); `temperature` must be true; `task=deny` because sub-agents hit Ollama "no user query found in messages"; bash rules = last match wins; no `external_directory` and no plain `edit:deny` for plan agent (would override OpenCode's built-in plan-file exception); variant `ohne-denken`; thinking numbers 12/12 in 74 min vs 11/12 in 167 min (verified against eval/results/verlauf.jsonl: 4442 s and 10025 s). |
| 4 | `model` | `ollama/orcarouter/Qwen3.8-27B-Uncensored:q4_K_M` (= `"ollama/" + models.json.default`, enforced by models.test.ts:18-21). |
| 5 | `autoupdate` | `false` (pin to 1.x). |
| 6 | `share` | `"disabled"` (no session sharing). |
| 8-33 | `provider.ollama` | `npm: "@ai-sdk/openai-compatible"` (l.9, unpinned, fetched by OpenCode on first use, from memory), `name: "Ollama (local)"`, `options.baseURL: "http://localhost:11434/v1"` (l.11, `localhost` not `127.0.0.1`; works as measured; eval.mjs uses 127.0.0.1). |
| 13-18 | model `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M` | name "Qwen3.8 27B Uncensored (local)", `temperature: true`, `limit {context 65536, output 16384}`, `variants {"ohne-denken": {reasoningEffort: "none"}}` |
| 19-24 | model `qwen3.8:27b` | identical limits/variants |
| 25-30 | model `huihui_ai/Qwen3.8-abliterated:27b-q4_K_M` | identical limits/variants |
| 34-36 | `mcp.playwright` | `type local`, `command ["npx","@playwright/mcp@latest"]`, `enabled: false` (M3 browser test prepared but off). |
| 37-53 | `permission` | see below. |
| 54-61 | `agent.plan.permission` | see below. |

Not set (so OpenCode defaults apply): `lsp` (off, measured no gain), `instructions`, `small_model`, `default_agent`, `compaction`, `snapshot`, `external_directory`, `doom_loop`, `question`, sampling (`temperature` value, `top_p`). Context match: `limit.context` 65536 = `OLLAMA_CONTEXT_LENGTH` 65536 set in scripts/install.ps1:103; KV `q8_0`, flash attention, keep-alive 60m, `OPENCODE_EXPERIMENTAL_PLAN_MODE=1` also from install.ps1:103-110.

### 1.1 Global `permission` (l.37-53)

Flat rules (l.38-41): `edit: allow`, `webfetch: allow`, `websearch: allow`, `task: deny`.

`bash` (l.42-52), in file order; **last matching rule wins**, so later lines override earlier ones:

| Line | Action | Patterns |
|---|---|---|
| 43 | ask | `*` (default for everything unlisted) |
| 44 | allow | `ls*`, `dir*`, `cat *`, `type *`, `grep *`, `rg *`, `find *`, `echo *`, `tree*`, `pwd*`, `head *`, `tail *`, `which *`, `where *` |
| 45 | allow | PowerShell read-ish: `Get-ChildItem*`, `Get-Content*`, `Test-Path*`, `Select-String*`, `Select-Object*`, `Where-Object*`, `ForEach-Object*`, `Measure-Object*`, `Sort-Object*`, `Get-Command*`, `Get-Location*`, `Resolve-Path*`, `Out-String*`, `Format-Table*`, `Format-List*`, `Write-Output*`, `Write-Host*` |
| 46 | allow | `mkdir *`, `New-Item*`, `md *` |
| 47 | allow | `git status` (exact), `git diff*`, `git log*`, `git show*`, `git add*`, `git commit*`, `git branch*`, `git checkout -b*`, `git stash*`, `git restore --staged*` |
| 48 | allow | runners: `npm *`, `npx *`, `node *`, `pnpm *`, `yarn *`, `python *`, `python3 *`, `py *`, `pytest*`, `pip *`, `uv *`, `cargo *`, `go *`, `dotnet *`, `ollama list*`, `ollama show*` |
| 49 | ask | `python -c*`, `python3 -c*`, `py -c*`, `node -e*`, `node --eval*`, `node -p*`, `powershell*`, `pwsh*`, `cmd /c*`, `Invoke-Expression*`, `iex *` |
| 50 | ask | `git push*`, `git reset --hard*`, `git clean*`, `git checkout -- *`, `git restore *` |
| 51 | deny | `rm *`, `del *`, `erase *`, `ri *`, `rmdir *`, `rd *`, `Remove-Item*`, `Clear-Content*`, `format *`, `mkfs*`, `Stop-Computer*`, `Restart-Computer*`, `shutdown*` |

Simulation results (own, node): `python -c "..."` -> ask; `python -B -c "..."` -> allow; `node -e` -> ask; `node --input-type=module -e` -> allow; `rm x` -> deny; `git restore --staged f` -> ask (the allow on l.47 is overridden by l.50); `git status -s` -> ask; `git checkout .` -> ask via `*`; `git reset --soft` -> ask via `*`; `find . -delete` -> allow; `git branch -D`, `git stash drop`, `npm publish` -> allow.

### 1.2 `agent.plan.permission` (l.54-61)

- `edit` (l.57): `{"*": "deny", "*opencode\\plans\\*.md": "allow", "*opencode/plans/*.md": "allow"}`: object form (not plain `deny`), both separators, so plan mode may write only its plan file (proven 2026-10-15, PROGRESS L28). This explicit block is needed because global `edit: allow` would otherwise override OpenCode's built-in plan restriction (from memory of agent merge order, consistent with `_note`).
- `bash` (l.58): `"*": ask` then allow: `git diff*`, `git log*`, `git status`, `grep *`, `rg *`, `cat *`, `ls*`, `dir*`, `Get-ChildItem*`, `Get-Content*`.
- Because plan's `*: ask` comes after the global rules, the global allow list (l.44-48) and global deny list (l.51) are replaced in plan mode (Verdacht, see F-A6).
- No `agent.build` entry: build uses the global rules. `agent.review` comes from config/agents/review.md. `task: deny` is global (l.41), so no agent can start sub-agents on its own.
- The UI picks the variant: `agent === 'plan' || thinkMode === 'gruendlich' ? undefined : 'ohne-denken'` (web/src/App.tsx:354). So plan mode thinks, build mode does not (default `thinkMode: 'schnell'`, settings.ts:65).

---

## 2. AGENTS.md, commands, review agent, batch-autopilot

### 2.1 config/AGENTS.md rules (installed to `~/.config/opencode/AGENTS.md`, a user block between `<!-- OPENDANTE-USER-START/END -->` is preserved by install.ps1:156-163)

| Line | Rule | Related measured problem (source) |
|---|---|---|
| 3 | Identity: OpenDante, local agent, plans/writes/runs/tests/fixes | - |
| 6 | Reply in German; explain each technical term once | user profile (CLAUDE.md) |
| 7 | Be concise, do not over-think simple tasks | Overthinking: one first step thought 47,894 chars (~11 min) (PROGRESS L75). A prompt rule did not fix it; the variant `ohne-denken` did (12/12 in 74 min vs 11/12 in 167 min). |
| 10 | >3 steps: write a `todowrite` task list, mark `in_progress`/`completed` | UI task-list card (TodoCard.tsx), stuck-turn investigation (PROGRESS L66) |
| 11 | Keep going until list done; stop only for the user's decisions; in plan mode no edits, numbered plan | stuck turns; plan mode (PROGRESS L21) |
| 12 | Small steps, check each | local model loses the thread on long tasks (PROGRESS L35, L55) |
| 13 | Files >~150 lines in parts (skeleton, then one function per edit) | OD-36: `max_tokens` 8192 cut the answer, file never written (PROGRESS L74), fixed with 16384 + this rule: hard tasks 3/6 -> 11/12 |
| 14 | Run tests/build, report real output, never claim without a command; else `py_compile` / `node --check` | Language servers measured no gain (PROGRESS L77); this rule "covers the cheap part" |
| 15 | Try things via scripts in `.opendante/tmp/`; cannot delete files; short import/compute/print `python -c`/`node -e` run on their own, others need OK and stop work | OD-24: 3 of 7 Testlauf tasks stopped on `python -c` one-liners despite the older rule (PROGRESS L71, requests.ts:65-66) |
| 16 | New project: write `.gitignore` first (`node_modules/ .venv/ __pycache__/ dist/ build/ .opendante/`) | OD-26: 20,000 `node_modules` files without `.gitignore` = 86 s before first request, 5 s with (PROGRESS L72) |
| 17 | Minimal edits, match style | - |
| 18 | Commit after a working change; branch before risky work | allowed by config l.47 (`git commit*`, `git checkout -b*`) |
| 21 | Never run destructive commands without asking (delete, `push --force`, `reset --hard`, format) | config l.50-51 |
| 22 | Do not touch files outside the project without asking | OpenCode default `external_directory: ask`, UI card (requests.ts:136-140) |
| 23 | Unclear task or user decision: ask one question | `question` tool; Testlauf rejects questions (eval.mjs:127-131) |
| 26-27 | Be honest about limits, split long tasks, mark checked vs guess, give confidence | user wants calibrated judgments (CLAUDE.md) |

### 2.2 Commands and agent

- `commands/commit.md` (`agent: build`): embeds `!git diff --staged`; if nothing staged, stage relevant files (never secrets/large build output), write short message with feat/fix/docs/refactor/test prefix, show it in one line, commit; reply German; `$ARGUMENTS` = message hint.
- `commands/review.md` (`agent: review`): embeds `!git diff HEAD`, asks for bugs/risks/simple improvements, no edits; `$ARGUMENTS` = extra focus.
- `commands/test.md` (`agent: build`): find and run the project's tests (package.json test script, pytest folder, Makefile), show real output, on failure diagnose + minimal fix + rerun until pass or blocked, never delete/skip tests; reply German.
- `agents/review.md`: `mode: subagent`, `temperature: 0.1`, permission `edit: deny`, `webfetch: deny`, bash `*: ask` + allow `git diff*`, `git log*`, `git show*`, `grep *`, `rg *`, `cat *`, `ls*`. System prompt: careful reviewer, real correctness/security bugs with file+line and a concrete failing case, ranked, no edits, German, brief. (`websearch` not denied here, inherits global allow.)
- **Reachability:** none of the three commands is reachable from the web UI (see F-B1); they work in TUI mode (`start.ps1 -Terminal`). Status per PROGRESS L28: `/test` "not yet proven on a real program"; `/review` and `/commit` are not mentioned as ever run.

### 2.3 skills/batch-autopilot/SKILL.md (German; name `batch-autopilot`)

Purpose: big/complex jobs the local model cannot do in one go. Three named weaknesses with counter-measures: overthinking (think short, act early, check the real result); losing the thread/original task (never work from memory, file `FORTSCHRITT.md` is the memory, re-read each stage); tool drift after many steps (one stage per pass, then consciously start fresh).

Procedure:
1. Step 0 (once): create/update `FORTSCHRITT.md` with sections Ziel (original task copied verbatim, never changed), Plan (numbered small steps), Erledigt (empty), Aktueller Schritt, Nächster Schritt, Offene Fragen/Risiken; show the plan in one sentence; start step 1.
2. Each stage loop: (1) read FORTSCHRITT.md completely; (2) take only the current step; (3) implement in small parts, sanity-check after each file change; (4) run the program/tests and read real output, never claim success without running; (5) update FORTSCHRITT.md (move step to Erledigt, set current/next, note open questions); (6) commit (`git add` + `git commit`); (7) report in one German sentence.
3. After ~8 steps or when answers get messy: begin a new stage "with an empty head" (the file carries the state).
4. Always: Ziel is untouchable; small verifiable steps; never delete/skip tests to look green; same step failed 3 times -> stop, write into Offene Fragen, ask the user one clear question; dangerous commands never without asking.
5. Done: all steps in Erledigt and tests pass -> run full tests a last time, 2-3 sentence summary, say what the user should check.

How it is triggered: UI Autopilot mode prepends `AUTOPILOT_PREFIX` ("Arbeite nach dem Skill "batch-autopilot": ... FORTSCHRITT.md als Gedächtnis ... Tests nach jedem Schritt", web/src/settings.ts:85-86) or user types `/batch-autopilot` (expanded by skills.ts:37-45). Effect was never measured (PROGRESS L31) and the Testlauf has no autopilot option.

---

## 3. config/models.json and the match with opencode.json

Structure: `_note` (string), `default` (string id), `models[]` of `{id, name, note}`. Three entries: `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M` (default, "zensurfrei (abliteriert) · Standard · 18 GB"), `qwen3.8:27b` ("Originalfassung von Alibaba · 17 GB"), `huihui_ai/Qwen3.8-abliterated:27b-q4_K_M` ("zensurfreie Alternative · 18 GB").

Readers: web/src/settings.ts:3 (`LOCAL_MODELS`, `DEFAULT_LOCAL_MODEL`), companion/server.mjs:18-20 (default, update-name regex l.22), scripts/install.ps1:10-20 (which model to pull), scripts/eval.mjs:26 (default model).

Contract with opencode.json: same id set + `model === "ollama/" + default` + no nested `_` keys, enforced by web/src/models.test.ts:10-35 (`npm test` in web/).

**Current state (checked with node): they match.** Same three ids, same default, `opencode.json:4` = `ollama/` + default. Differences that are not errors:
- Display names differ (`name` in models.json without "(local)" suffix, opencode.json with it).
- `limit`, `variants`, `temperature` exist only in opencode.json and are repeated three times (l.14-18, 20-24, 26-30); the test compares ids only, so drift in limits/variants of one model would not be caught.
- Fallback in companion/server.mjs:20 is `'qwen3.8:27b'` (the original), not the uncensored default, used only if models.json cannot be read (sicher, low).
- models.json `_note` says licenses "all Apache-2.0 ... checked on ollama.com 2026-10-15", but PROGRESS L15 says the uncensored model's tool-call fidelity was an uploader claim and L34 still lists "Confirm the official model page + LICENSE of qwen3.8:27b on download day" as open. The two abliterated variants are third-party fine-tunes; their license field on ollama.com is uploader-declared (Verdacht 50%: the Apache-2.0 claim for these derivatives is not verified in a LICENSE file).

---

## 4. Testlauf (scripts/eval.mjs)

### 4.1 CLI

`node scripts/eval.mjs [--base URL] [--model ID] [--variant NAME] [--tasks a,b] [--level leicht|schwer] [--repeat N] [--label TEXT] [--keep] [--help]` (eval.mjs:29-31).
- `--base` default `http://127.0.0.1:4096` (l.33). `--model` default `models.json.default` (l.34). `--variant` default `''` = thinking ON (l.35). `--repeat` min 1 (l.36). `--label` default = short model name (+ ` · variant`) (l.37). `--keep` keeps sessions and work folders. `--tasks` comma list of ids; `--level` filter (`level` missing = `leicht`). Unknown flags are silently ignored (parseArgs l.42-53).
- Env: `OLLAMA_HOST` (default 127.0.0.1:11434), `COMFY_URL` (default 127.0.0.1:8188). Exit codes: 2 = no server or no tasks, 3 = ComfyUI queue not empty.
- Imports `autoDecision`, `openCodeSafeDirs` straight from `web/src/requests.ts` (Node 24 type stripping), so the Testlauf answers permission prompts with the same rules as the app's "Befehle automatisch erlauben".

### 4.2 How one run goes

1. `preflight()` (l.65-85): `GET /global/health`; ComfyUI `/queue` must be empty (errors = ignore); `GET /api/ps`; if the model is not loaded, `POST /api/generate {model, keep_alive:'30m'}` (HTTP errors swallowed, l.82).
2. `GET /path` -> `safeDirs` (OpenCode state/data/temp dirs, requests.ts:57-63). Run folder base: `~/.opendante/eval/<stamp>/` with `<task>-<n>`.
3. `runTask` (l.99-175): copy `eval/tasks/<id>/start/` into the fresh folder (skips `.keep`, l.102); `POST /project/git/init?directory=` (so snapshot/undo behave like a real project); `POST /session` with title `Testlauf <id>`; `POST /session/{id}/prompt_async` with `{agent:'build', model:{providerID:'ollama', modelID}, parts:[{type:'text', text: task.prompt}], variant?}`; timer starts right before this call.
4. Poll loop every 2 s (after a 1.5 s sleep, l.115-140): `GET /permission` (only this session; each id once): `autoDecision()` -> `once` counts as `autoAllowed`; null (needs user) -> counts as `asks`, recorded in `asked[]` (`permission: command`, 300 chars) and answered `reject` with a German hint (ANSWER_REFUSED, l.40); doom loops get `reject` + LOOP_HINT. `GET /question`: rejected, counted in `questions`. `GET /session/status`: no entry or `idle` -> done. Time limit = `task.timeoutMin` (default 10) min: `POST /session/{id}/abort`, `timedOut = true`.
5. Metrics from `GET /session/{id}/message` (l.144-158): `steps` = number of assistant messages; `read` = input + cache.read + cache.write; `written` = output + reasoning (PROGRESS L41: output already includes thinking); `tools` = parts of type `tool`; `toolErrors` = tool parts with `state.status === 'error'`; `error` = last assistant `info.error` message. `seconds` = wall clock from step 3 to idle/abort (includes polling granularity; excludes model preload and the check).
6. Check (l.160-165): `task.check = [cmd, ...args]`; args that exist in the task folder are made absolute (so `check.py` runs from `eval/tasks/<id>/`), cwd = the run folder, `spawnSync` timeout 60 s. Exit code 0 = solved; last output line (max 200 chars) is the failure text.
7. Cleanup: passed sessions are deleted via `DELETE /session/{id}` unless `--keep` (l.168); failed sessions stay (id in the report). At the end the whole `<stamp>` folder is removed with 5 retries after making git object files writable (l.238-251).
8. Results: `eval/results/<stamp>_<label>.md` (table per task: result, duration, steps, tools(errors), tokens read/written, asks, check text, model error, plus list "Hätte nachgefragt"), `<same>.json` (summary + all runs with `passed,timedOut,seconds,steps,tools,toolErrors,tokensRead,tokensWritten,asks,asked,autoAllowed,questions,error,check,session,workdir`), and one line appended to `verlauf.jsonl` (`stamp,model,variant,label,level,repeat,passed,total,seconds,tokensWritten,asks`). `eval/results/` is git-ignored (.gitignore). Prints the last 5 earlier history lines.

Existing history (eval/results/verlauf.jsonl, checked): 7 runs. Easy tasks: 7/7 with thinking (1140 s), 7/7 without (947 s), 7/7 after OD-24/33 (878 s). Hard x2: uncensored thinking on 11/12 (10025 s, 191,873 tokens written), uncensored off 12/12 (4442 s, 70,992), original `qwen3.8:27b` off 9/12 (3584 s), uncensored off + LSP on 5/6 (2154 s, repeat 1). These match CLAUDE.md L27-29 and PROGRESS L75-77.

### 4.3 The 13 tasks (all prompts German; "start" = files copied into the folder; checks never in `start/` — verified by listing)

| id | level | language | min | agent must... | check verifies |
|---|---|---|---|---|---|
| `fix-offbyone` | leicht | Python | 8 | fix `median` (even length) in `statistik.py` without touching `test_statistik.py` | SHA-256 of test file unchanged; 6 `mittelwert` + 13 `median` cases (1e-9), input copied each time; `python -B test_statistik.py` exits 0 |
| `roemisch` | leicht | Python | 8 | create `roemisch.py` with `zu_roemisch` (1..3999, ValueError outside) and `von_roemisch` (start/ empty) | 24 fixed pairs both ways; all 1..3999 equal a reference table and round-trip; ValueError for 0, 4000, -1, -5, 10000; `von_roemisch` returns int |
| `umbenennen` | leicht | Python | 10 | rename `berechne_preis` -> `gesamtpreis` in `lager.py`, `bestellung.py`, `rechnung.py` (def, calls, imports, comments, docstrings) | old name absent case-insensitively in the 3 files; `lager.gesamtpreis` exists, `lager.berechne_preis` gone; behaviour values (bulk-discount 10 x 100 = 900, 20 x 5 = 90 ...), `bestellsumme`, `bestelltext`, `rechnungszeile`, `rechnungssumme` |
| `wortzaehler` | leicht | Python | 8 | create `wortzaehler.py`: top-3 words of a UTF-8 file, `wort: anzahl`, ties alphabetical | runs script on 3 temp files (umlauts, ties across top-3 border, case folding, CRLF-tolerant) and compares stdout exactly |
| `code-lesen` | leicht | Python | 6 | find the one function that calls `speichere()` directly, write only its name to `antwort.txt` | SHA-256 of all 4 source files unchanged; `antwort.txt` (BOM/quotes/backticks stripped) == `pruefe_bestand` |
| `todo-modul` | leicht | Python | 20 | create `todo.py` (`TodoListe`: hinzufuegen/erledigen/offen/erledigt/speichern/laden) and own `test_todo.py` (start/ empty) | ~40 asserts: IDs from 1, KeyError (99, 0, -1, 5), idempotent `erledigen`, independent instances, JSON save/load (no BOM, str and Path, umlauts, next ID preserved, empty and all-done lists); `test_todo.py` has >=5 `def test_` and >=5 lines starting `assert`, and exits 0 |
| `js-export` | leicht | JavaScript (node) | 8 | repair `summe.mjs` so `node test.mjs` passes | SHA-256 of `test.mjs`; 17 `summe` cases (strings via trim, ignore NaN/null/booleans/objects/arrays, 1000 ones, 0.1+0.2 tolerance); `node test.mjs` exits 0 |
| `bugjagd` | schwer | Python | 25 | find three hidden bugs in a 5-file shop (rounding, double discount, overselling) without changing `test_shop.py`, Decimal kept | SHA-256 of test file; `test_shop.py` passes; 14 `runde`, 6 `steuer`, 13 `anwenden` cases; 400 random invoices vs an integer-cent reference model (every line netto/steuer/brutto, totals, voucher); Lager overselling cases (duplicate articles, atomic all-or-nothing, freigeben/ausliefern/wareneingang); `Bestellung.aufgeben` |
| `feature-csv` | schwer | Python | 25 | extend `umsatz.py` with `--gruppe {monat,kategorie}` and `--format {text,json}` | SHA-256 of `verkaeufe.csv`; default output char-identical to the hard-coded original (3 invocations); combinations with `--ab`; JSON shape/types (int counts, numeric umsatz); empty result cases; hidden second CSV (BOM, CRLF, blank line, negative quantities, umlauts, year change); error cases exit 2 with empty stdout; invalid choices exit 2 |
| `klassen-umbau` | schwer | Python | 25 | refactor `konten.py` into class `Bank` with module-level thin wrappers delegating to one default instance, `main.py` untouched and same output | SHA-256 of `main.py`; AST: class `Bank` present, no `global`, no mutable module-level assignment; `main.py` output exact; ~45-line probe script run on module and on `Bank()` vs recorded original output (exception types/messages, keyword args); second probe: instance independence, no mutable module/class variables, exactly one `Bank` instance at module level, atomic transfers, module vs Bank isolation |
| `cli-aufgaben` | schwer | Python | 30 | create `aufgaben.py` CLI (5 subcommands, JSON storage, exact outputs/exit codes) and own `test_aufgaben.py` (start/ empty) | 6 scenarios run in parallel threads: full flow with exact stdout and exact file content, no stray files; default `aufgaben.json` and no file created by `liste`/`statistik`; prepared file with `naechste_id` 10; percent rounding (5 cases); error paths (exit 1 and 2, exact stderr, files unchanged, corrupt JSON); own tests: >=6 `def test_`, >=6 `assert`, mentions "aufgaben", runs exit 0 in a copy of the folder |
| `js-rechner` | schwer | JavaScript (node) | 25 | repair + extend a 4-module calculator (`berechne`) incl. `^`, unary minus, `Syntaxfehler` messages; `test.mjs` unchanged | SHA-256 of `test.mjs`; 93 valid expressions (strict `===`), 9 division-by-zero cases (message exactly `Division durch Null`), 63 invalid inputs + 6 non-strings (message starts `Syntaxfehler`), up to 400 seeded random expressions vs a reference tree evaluator; `node test.mjs` exits 0 |
| `log-analyse` | schwer | Python | 20 | create `analyse.py` that turns `zugriffe.log` into `bericht.json` (counts, top 5 paths, hourly mean with half-up rounding, error rate) and run it | SHA-256 of `zugriffe.log`; `bericht.json` in the work folder equals regex/Fraction reference; re-runs `analyse.py` on a copy, on a hidden 160-line log with CRLF, junk lines, no final newline and rounding ties, on a log with no valid lines, and on a missing file (exit 1, exact stderr, no `bericht.json`) |

README timeouts and kinds match task.json for all 13 (checked). Hash-pinned start files compare after CRLF->LF normalisation (README l.40, implemented in each check).

---

## 5. Docs: milestones, open items, outdated claims

### 5.1 Milestones (PLAN.md:46-53) with current state (PROGRESS, STAND)

| M | PLAN text | Status now |
|---|---|---|
| M0 Recherche und Plan | done | done (PLAN.md:48) |
| M1 Fundament | done "seit 2026-10-15" | done; PROGRESS L8 dates the proof 2026-10-14 (small date mismatch). Installer end to end proven, `web/dist` builds. |
| M2 Projekt-Bedienung | done | done in the UI (skills `/name`, plan mode, task list, permission cards + auto-allow, undo via git snapshots, history), browser-tested 2026-10-15. Not proven: `/test`, `/review`, `/commit` (and they are not reachable from the UI), reliable `skill` loading (conf 60, PROGRESS L32). |
| M3 Autonomie und Sicherheit | partly | done: loop detection (doom_loop card), context gauge. Config only, never tested in PROGRESS: `websearch/webfetch` allow. Open: sandbox (WSL/Docker, nested virtualization on Shadow unverified), Playwright MCP (configured, `enabled:false`, opencode.json:35), image input. The M3 proof ("Testlauf that builds and checks a small web app") does not exist. STAND.md:15-16 lists Playwright + sandbox as next. |
| M4 Power | partly | done: 3 models selectable, Testlauf, usage overview lokal/Claude. Deliberately off: sub-agents. Open: hooks, headless run ("Betrieb ohne Fenster"). "Testlauf report per model": only uncensored and original measured; huihui never. |
| M5 Oberfläche und Feinschliff | ongoing | own chat UI exists (React/Vite), Vorladen + Ladebalken added 2026-10-16 and proven on Shadow PC. Before/after screenshots proof: not checked. |

STAND.md header: `meilenstein: M3`, `fortschritt: 65` ("2 fertig, M3 + M4 weit"), consistent with PLAN.

### 5.2 Open items (union of PROGRESS L27-34, STAND, PLAN, RESEARCH, Log)

1. `/test` command unproven on a real program (PROGRESS L28); `/review` and `/commit` never mentioned/run.
2. Asks that remain by design (one-liners that start programs or write files; model mistyping its path once).
3. M3: enable Playwright MCP, WSL/Docker sandbox check, image input.
4. Never run for real (cost/no key): Anthropic call via `/claude`, Audit, Offload (conf 50, needs `<<<CLAUDE ... >>>`), Claude half of token counter, effect of Autopilot prefix. Log 2026-10-16 (PROGRESS L82): end-to-end key lookup confirmed in cloud; user still has to restart, re-save the key, press "Verbindung testen".
5. Does the local model reliably call the `skill` tool for a named skill (conf 60).
6. Fixed instruction block ~9.5k tokens per request; first `git push` needs GitHub login.
7. Confirm official model page + LICENSE of `qwen3.8:27b` on download day (PROGRESS L34; RESEARCH.md:67 item 1); WSL/Docker on Shadow (RESEARCH.md:68 item 3).
8. Root cause unknown: Ollama exited with code -1 at 10:35 and 10:46 leaving orphaned `llama-server.exe` that held 17.4 GB (PROGRESS L80). Mitigation (start.ps1 clears orphans) is in, cause is not.
9. "GPU nicht auslasten beim Laden" deliberately not built (PROGRESS L81).
10. Blind test of other models from RESEARCH.md:17-24 (Qwen3.6-27B, Qwen3.6-35B-A3B, Devstral Small 2, Muse Glimmer): not started; the three installed models are all Qwen3.8 variants.
11. STAND: user tries OpenDante in daily use; new Verbesserer run after a week; learning item "Git snapshots".
12. Hooks, headless run (PLAN M4).

### 5.3 Outdated or contradicted claims

| Where | Claim | Reality (source) |
|---|---|---|
| docs/SETUP.md:5 | "Noch nicht auf Windows getestet ... erster Entwurf" | Installer proven end to end (PROGRESS L9) |
| docs/SETUP.md:39 | table: first model "Qwen3.8-27B" | install pulls the uncensored default (`models.json`, install.ps1:20) |
| docs/SETUP.md:44 | double-click opens a terminal window with the assistant in `C:\Users\...\code` | start.ps1 opens a Chrome `--app` window with the own UI; TUI only with `-Terminal` (PROGRESS L10) |
| docs/SETUP.md:46 | web UI "kommt in einem späteren Schritt (M5)" | exists |
| docs/SETUP.md:34-41 | install list | omits companion, web build (install.ps1:172+), env vars (context, KV q8_0, flash attention, keep-alive 60m, plan mode) |
| docs/PLAN.md:61 | Testlauf "7 feste Aufgaben" | 13 (7 leicht + 6 schwer), README.md:9 is correct |
| docs/PLAN.md:49 | M1 running "seit 2026-10-15" | PROGRESS L8: proven 2026-10-14 |
| docs/PLAN.md:38-40 | model "zuerst eines ... Wahl am Download-Tag prüfen" | decided: Qwen3.8-27B family, uncensored default since 2026-10-15 |
| docs/PLAN.md:10-24 | architecture diagram: terminal + Chrome window both on OpenCode | omits the companion service (port 4097) and the own React UI; l.24 "zwei Oberflächen ... Terminal und Web-Oberfläche" now terminal + own UI |
| docs/PLAN.md:31 | OpenCode "liest dieselben Dateien wie Claude Code (CLAUDE.md, .claude/skills)" | launcher sets `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` and `..._EXTERNAL_SKILLS=1` (start.ps1:58-59) so `.claude/skills` are deliberately hidden; project `CLAUDE.md` is read only as AGENTS.md fallback |
| docs/PLAN.md:51 | "Websuche/-abruf erlaubt" listed as M3 done | only the permission is set (opencode.json:39-40); no run ever used it (Verdacht 55% that `websearch` is not even available without extra provider/env, from memory) |
| docs/PLAN.md:67 | Turing first-request slowness "in der Konfiguration abgefangen" | nothing in opencode.json does that; the slow resume was model unload after 5 min + orphaned runners, fixed by `ensureLoaded()`, `OLLAMA_KEEP_ALIVE=60m` and orphan cleanup (PROGRESS L80-81) |
| docs/RESEARCH.md:19 | "überdenkt stark -> Denkstufe niedrig stellen" | `low` has no effect; only `reasoning_effort: none` works (variant `ohne-denken`) (PROGRESS L23) |
| docs/RESEARCH.md:24 | "Start: nur Qwen3.8-27B. Die anderen drei und ein Blindtest folgen später" | the other installed models are Qwen3.8 abliterated variants, not the 3 researched ones |
| docs/RESEARCH.md:34 | expected ~30-40 tokens/s on the RTX 6000 | measured ~21.8 tok/s writing, ~496 tok/s reading (CLAUDE.md L22) |
| docs/RESEARCH.md:63 | Ollama settings incl. `NUM_PARALLEL=1` | install.ps1:103-108 sets context, KV q8_0, flash attention, keep-alive; `OLLAMA_NUM_PARALLEL` is not set (sicher) |
| PROGRESS.md:10 | "98 Vitest (13 files)" | Log L80/82: 129 resp. 125 Vitest |
| PROGRESS.md:11 | "Testlauf (7 tasks) ... first baseline" | 13 tasks, many runs (History L71-77) |
| PROGRESS.md:7 | "Status (2026-10-15)" | Log has 2026-10-16 entries (preload, Claude key file) |
| PROGRESS.md:17 | skills load unchanged from `.claude/skills` (verified) | disabled by start.ps1:58-59 (PROGRESS L20) |
| PROGRESS.md:23 | thinking switch "Off by default (`settings.thinkOff`)" | setting renamed `thinkMode`, default `'schnell'` = thinking off for carrying out (settings.ts:41,65; PROGRESS L75) |
| PROGRESS.md:46-47 | Claude key + model stored in `opencode.json` `anthropic` provider | moved to `~/.opendante/claude-key.json` (Log L82). install.ps1:129-142 still preserves a legacy `provider.anthropic` block (dead path) |
| PROGRESS.md:71 | "thinking stays on by default" | superseded by L75 (OD-29) |
| README.md:5 | "Stand (2026-10-15)" | newer work (preload, key file) not reflected |
| README.md:9, CLAUDE.md:41, eval.mjs header | how to compare variants | do not say that the thinking-off numbers need `--variant ohne-denken`; default run is thinking ON (see F-C2) |
| scripts/eval.mjs:8 | example `--variant wenig-denken` | no such variant in opencode.json (only `ohne-denken`) |
| web `SettingsPanel.tsx:133` | `data-testid="think-off"` on the `thinkMode` select | stale test id only, cosmetic |

---

## 6. Findings

Format: ID, file:line, one-sentence reason, certainty.

### A. Config and permissions

- **F-A1** config/opencode.json:47 vs :50. `"git restore --staged*": "allow"` can never take effect because `"git restore *": "ask"` (l.50) also matches and comes later (last match wins). **sicher**.
- **F-A2** config/opencode.json:48-49. The one-liner asks match only when `-c`/`-e` is the first argument: `python -B -c`, `python -X utf8 -c`, `python -u -c`, `python -I -c`, `python - <<EOF`, `node --input-type=module -e`, `node -pe` hit `python *`/`node *` allow, run inline code with no prompt, and the RISKY filter (requests.ts:28-34) never sees them because no request is created. This defeats the policy in AGENTS.md:15 and the comment at requests.ts:23-27 ("with these any other rule can be bypassed, e.g. python -c shutil.rmtree"). **sicher** (rule semantics, simulated).
- **F-A3** config/opencode.json:44. `"find *": "allow"` also allows `find . -delete` and `find ... -exec rm`, bypassing the `rm`/`del` deny on l.51 (Windows `find.exe` is harmless, GNU find via Git Bash is not). **sicher** at rule level; impact depends on which `find` runs.
- **F-A4** config/opencode.json:47. `git branch*` allows `-D/-d/-f`, `git stash*` allows `drop`/`clear`, `git commit*` allows `--amend`: local but destructive, contradicts AGENTS.md:21 "never destructive without asking". **sicher**.
- **F-A5** config/opencode.json:48 with :39-40. `npm *`, `npx *`, `pnpm *`, `yarn *`, `pip *`, `uv *`, `cargo *`, `go *`, `dotnet *` allow every subcommand (`npm publish`, `cargo publish`, `uv publish`, `dotnet nuget push`, `npx <any-package>` download-and-run), and `python *`/`node *` run any script, so the `rm` deny (l.51) is a speed bump, not a barrier; together with `webfetch: allow` a prompt-injected web page can end in code execution without any question. **sicher** (rule level), real-world impact Verdacht.
- **F-A6** config/opencode.json:58 and web/src/requests.ts:141-144. In plan mode the plan agent's `bash: {"*": "ask", ...}` is merged after the global rules, so `rm`/`del`/`Remove-Item`/`shutdown` become `ask` instead of `deny` and the global allow list disappears (merge order from memory of OpenCode agent.ts); and `autoDecision` answers `once` for every asked bash request that is not on the RISKY list and not outside the folder, so with `autoAllow` ON (default) plan mode's "no edits" is not enforced for bash (`mkdir`, `echo > f`, `python x.py`, `git commit`). **Verdacht** 55% (autoDecision part is sicher; merge order is the uncertain part).
- **F-A7** config/opencode.json:44-47 and 58. Whether the Windows bash tool runs Git Bash, cmd or PowerShell decides which pattern groups can ever match (`Get-ChildItem*` etc. only under PowerShell, `ls*` etc. only under a POSIX shell), and whether OpenCode splits `a; b`, `a | b` and PowerShell script blocks into separately checked commands (it does for bash grammar, from memory); if not, `Get-ChildItem | Remove-Item` matches `Get-ChildItem*` allow and the deny on l.51 (anchored at the start) never fires. Not documented anywhere in the repo. **Verdacht** 40%.
- **F-A8** config/opencode.json:47 and 58. `"git status": "allow"` is exact, so `git status -s/--short/--porcelain` asks (auto-approved in the UI, a question in TUI). **sicher**, low.
- **F-A9** config/opencode.json:35. `@playwright/mcp@latest` is unpinned (against the "pinned" philosophy of l.3/5) and no permission rules exist for MCP tools; disabled today, so no live effect. **sicher**, low.
- **F-A10** config/opencode.json:9. `@ai-sdk/openai-compatible` is unpinned and (from memory) fetched from npm by OpenCode at first use: an offline fresh install may fail at the first model call even though `opencode models ollama` passes. **Verdacht** 35%.
- **F-A11** config/opencode.json:16 (and 22, 28). `output: 16384` of `context: 65536`: OpenCode reserves the output budget when deciding overflow/compaction (from memory: usable context = context minus min(output, 32000)), i.e. auto-compaction near ~49k tokens, while the UI gauge may assume 64k. **Verdacht** 40%.
- **F-A12** config/opencode.json:14-30 and web/src/models.test.ts:18-21. `limit`, `variants`, `temperature` are triplicated and only the ids are tested; a change to one model's limits is not caught. **sicher**, low.
- **F-A13** config/opencode.json:13-30. No sampling parameters are set; the effective temperature/top_p are OpenCode's per-model defaults (from memory 0.55 for Qwen), unmeasured and unrecorded in Testlauf results; relevant for run-to-run variance. **Verdacht** 35%.
- **F-A14** config/opencode.json:40 with docs/PLAN.md:51. `websearch: allow` is counted as M3 progress but never exercised; OpenCode 1.x registers its web search only under certain provider/env conditions (from memory). **Verdacht** 55%.
- **F-A15** config/models.json:2 vs PROGRESS.md:34. Licence claim "all Apache-2.0 ... checked" for third-party abliterated fine-tunes rests on the uploader-declared ollama.com field; the commercial-use requirement (CLAUDE.md L12) asks for the LICENSE on download day. **Verdacht** 50%.
- **F-A16** companion/server.mjs:20. Fallback default `'qwen3.8:27b'` is the original model, not the uncensored default of models.json. **sicher**, low (only on read failure).

### B. AGENTS.md, commands, review agent, skill

- **F-B1** config/commands/*.md, config/agents/review.md vs web/src. The UI never calls OpenCode's command endpoint (no `/session/{id}/command` anywhere in web/src; only skill `/slug` expansion, skills.ts:37-45), so `/review`, `/test`, `/commit` typed in the UI are sent as plain text; the commands and the `review` agent exist only for TUI use (`start.ps1 -Terminal`). **sicher** 85%.
- **F-B2** config/agents/review.md:3 and config/commands/review.md:3. `mode: subagent` plus `agent: review`: OpenCode runs a command whose agent is a subagent as a subtask via the `task` machinery (from memory), which is the path that fails against Ollama with `500 "no user query found in messages"` (PROGRESS L45); `task: deny` (opencode.json:41) may or may not apply to user-invoked subtasks. `/review` was never run. **Verdacht** 50%. Possible fix: `mode: all` or `subtask: false`.
- **F-B3** config/commands/review.md:9 and commit.md:7. The `!`git diff ...`` output is injected unbounded into the prompt (a big diff or lockfile fills the 64k context next to the ~9.5k fixed block), and `git diff HEAD` errors in a repo without a first commit, which is exactly what "Sicherung einschalten" creates. **sicher** (git behaviour), impact Verdacht.
- **F-B4** config/AGENTS.md:15. "Short `python -c` ... run on their own" is true only in the UI with autoAllow ON (requests.ts:120-124,141); with the config alone (opencode.json:49) they ask and "stop your work", so in TUI mode the sentence is false. **sicher**.
- **F-B5** config/AGENTS.md:15. "You cannot delete files yourself" holds for direct `rm`/`del`, not for scripts (`python *`, `node *` allowed, opencode.json:48); it is a prompt statement, not a guarantee. **sicher**.
- **F-B6** config/AGENTS.md:7. "Do not over-think" did not stop the measured 47,894-char thinking step; only the `ohne-denken` variant did (CLAUDE.md L27). Rule is ineffective for hidden reasoning. **sicher** (measured), informational.
- **F-B7** skills/batch-autopilot/SKILL.md:33-34. "Beginne eine neue Etappe mit leerem Kopf" is not executable by the model: it has no tool to reset context or open a new session (`task: deny`), so within one turn the context keeps growing; only the user/UI can start a new session. **Verdacht** 60%.
- **F-B8** skills/batch-autopilot/SKILL.md:14,30. Creates and commits `FORTSCHRITT.md` in the user's project root (AGENTS.md:15 keeps scratch in `.opendante/`) and duplicates the `todowrite` list of AGENTS.md:10; step 6 fails in non-git folders (no fallback). **sicher**, low.
- **F-B9** web/src/settings.ts:85-86. The Autopilot prefix and the skill have never been measured (PROGRESS L31) and the Testlauf cannot select them. **sicher**.

### C. Eval

- **F-C1** scripts/eval.mjs:33 vs CLAUDE.md:40. Default `--base` is `127.0.0.1:4096`, the user's live OpenDante, which CLAUDE.md forbids touching (test instance is 4196); a plain `node scripts/eval.mjs` shares config, GPU and session DB with the user. **sicher**.
- **F-C2** scripts/eval.mjs:8,35. Header example uses `--variant wenig-denken`, which does not exist (opencode.json:17 has only `ohne-denken`; an unknown variant is probably ignored silently, so the run would be mislabeled thinking-on, Verdacht 50%). The default `VARIANT=''` means thinking ON, whereas the app default is "schnell" (App.tsx:354) and the key measurements used `--variant ohne-denken`; README.md:9 and CLAUDE.md:41 do not tell you to pass it. **sicher** for the doc part.
- **F-C3** scripts/eval.mjs:132-133 and 58-62. `st = await api('/session/status').catch(() => ({}))` followed by `!st[session.id] -> break` treats any failed or timed-out status request as "session idle", ends the run early and checks a half-done folder (false failure); `api()` has no fetch timeout, so a hung server blocks beyond `timeoutMin`. **sicher** (code); frequency unknown.
- **F-C4** scripts/eval.mjs:134-138,165,194. A run that hits the time limit is aborted but still checked; `passed` is independent of `timedOut`, so correct files at abort time count as solved (report shows the check mark). Success rate ignores overtime. **sicher**.
- **F-C5** eval/tasks/todo-modul/check.py:131-136 and cli-aufgaben/check.py:235-242. "Own tests" are verified only by counting `def test_` and lines starting with `assert` plus exit code 0; trivial tests (`assert True`) pass. **sicher**.
- **F-C6** eval/results/verlauf.jsonl and CLAUDE.md:29. Samples are small: 12/12 vs 9/12 (uncensored vs original) gives one-sided Fisher p = 220/2024 = 0.109, 12/12 vs 11/12 is noise; CLAUDE.md states "measured" without that caveat. The time gap 74 vs 167 min is the solid result. The summary (eval.mjs:199-200) records no hash of `opencode.json`/`AGENTS.md`/requests.ts or git commit, so a result cannot be tied to a rule change. **sicher**.
- **F-C7** scripts/eval.mjs:106 and tasks list. Coverage gaps: always `agent: 'build'` (plan agent, the three commands, review agent, batch-autopilot, global-instructions block, attachments are not exercised); `huihui_ai/...` never measured; the easy 7 were last run before the 16k output limit and the "schnell" default (verlauf: 2026-10-15_15-29). **sicher**.
- **F-C8** scripts/eval.mjs:65-85 (l.82). Preflight ignores HTTP errors of the preload (`.catch(()=>'')`) and does not check free VRAM: the 2026-10-16 incident (orphaned `llama-server.exe` holding 17.4 GB, PROGRESS L80) would make the run measure load failures or 5-min timeouts. **sicher** (code), incident documented.
- **F-C9** scripts/eval.mjs:211,230. Result file names use minute-resolution stamp + label; two runs with the same label in the same minute overwrite each other and share/delete the same work base folder. **sicher**, unlikely.
- **F-C10** scripts/eval.mjs:42-53. Unknown flags are ignored (`--leve schwer` runs all 13 tasks). **sicher**, low.
- **F-C11** eval/tasks/wortzaehler, cli-aufgaben, feature-csv, log-analyse check.py (env `PYTHONIOENCODING=utf-8`). Checks force UTF-8 stdout, so a solution that prints umlauts without handling the Windows console encoding passes although it would garble or crash in a default cp1252/cp850 console. **Verdacht** 45% (design choice, reality gap).
- **F-C12** eval/tasks/code-lesen/check.py:14,38-45. Passes with the right function name alone (guessable, does not prove reading) and with quote/backtick wrapping stripped. **sicher**, low; acceptable for an "easy" task.
- **F-C13** eval/tasks/README.md:34 says checks need <10 s (heavy <15 s); cli-aufgaben/check.py runs 22 `ok()` + 10 `fehler()` calls with 15 s each plus a 40 s own-test run inside the 60 s `spawnSync` timeout (eval.mjs:163); on a loaded machine (Ollama running) this is the check most likely to flake. **Verdacht** 30%.
- Positive checks (no finding): no check or solution file under any `start/` (listed), hash pinning normalises CRLF, checks use hidden second inputs (feature-csv, log-analyse), reference models are independent of the solution, README table (ids, kinds, minutes) matches all 13 task.json.

### D. Docs

- **F-D1** docs/SETUP.md:5,39,44,46 and docs/PLAN.md:61,49,38-40,10-24,31,51,67, docs/RESEARCH.md:19,24,34,63, PROGRESS.md:7,10,11,17,23,46-47,71: stale statements listed in section 5.3. **sicher** (each contradicted by a newer file/log line).
- **F-D2** PROGRESS.md:81 vs :80. Newest-first log: the entry "Shadow-Beweis offen" for Vorladen (L81) is superseded by L80 (proven); a reader taking entries in order may think it is still open. **sicher**, low.
- **F-D3** STAND.md Erledigt list. Misses the 2026-10-16 Claude-key fix (PROGRESS L82) and the open user action (re-save key, "Verbindung testen"). **sicher**, low.
