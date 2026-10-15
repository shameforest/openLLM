# OpenDante — project notes for the coding agent and for Claude

## What this is
A free, open-source, **local** AI coding agent — a Claude Code equivalent that runs on the user's own GPU with open-weight models, with no paid APIs. We do **not** train a model. We **assemble and configure**: extend the OpenCode harness, drive it with a local open-weight model served by Ollama, add the missing pieces (web search, browser testing, more models), and ship it with a one-command installer like the sibling project OpenDali.

Product/display name is "OpenDante"; the Git repo and filesystem paths keep the old name (`openllm`, `C:\openLLM`) so nothing breaks. Read `docs/PLAN.md` (architecture, milestones) and `docs/RESEARCH.md` (models, harness, servers — with reliability caveats) before working.

## The user
- Not a programmer, writes German. Answer in **German** and explain every technical term in one plain sentence the first time it appears.
- Wants calibrated judgments: verdict + confidence (0–100) + what would flip it. Mark each factual claim as "checked (source)" or "from memory".
- Cost-aware delegation (skill `savetokens`): architecture, design decisions, hard debugging and final review stay with the main model; well-specified build/test/lookup work goes to `sonnet`/`haiku`. Always verify delegated work. End a delegating turn with one line per delegation.
- Commercial use is required → the model **and** the tool licenses must allow it (Apache-2.0 / MIT). Re-read each LICENSE on download day.

## Hardware (shared with OpenDali — never at the same time)
- Shadow cloud PC, Windows 11. NVIDIA Quadro RTX 6000 24 GB, Turing (sm_75): no BF16, no FP8 compute. 41 GB RAM. ~85 GB free disk after OpenDali.
- A local LLM and ComfyUI (OpenDali) cannot both hold the 24 GB at once. The launcher unloads one before the other runs.
- INT4/INT8 GGUF (llama.cpp / Ollama) runs fine on Turing. vLLM FP8/Marlin kernels largely need Ampere+ → not our path.

## Decisions so far (M0)
- **Harness: extend OpenCode** — github.com/anomalyco/opencode, MIT [checked 2026-10-14: repo page; the old `sst/opencode` redirects here]. No fork: markdown agents + one plugin + MCP servers.
- **Model server: Ollama** (MIT), same ggml kernels as llama.cpp, auto model-swap. Fall back to `llama-server` for tool-call issues or >2 parallel agents.
- **Model: Qwen3.8-27B family, Apache-2.0**, installed and running on the Shadow PC. Measured 2026-10-15: prompt reading ~496 tokens/s, writing ~21.8 tokens/s, loading 10–45 s.
- **Default model since 2026-10-15: the uncensored (abliterated) `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M`** (user's wish; Apache-2.0 + tools + thinking on its ollama.com page). `qwen3.8:27b` and `huihui_ai/Qwen3.8-abliterated:27b-q4_K_M` stay selectable. **The list lives in one place: `config/models.json`** (UI, companion and installer read it); `config/opencode.json` must contain the same model ids.
- **OpenCode pinned to 1.x** (`"autoupdate": false`; OpenCode 2 changes config and server API). Every config change is validated with `opencode models ollama` (installer and launcher do it and roll back). A comment key inside `permission` makes the whole config invalid; `external_directory` and a plain `edit: deny` for the plan agent break plan mode (see `_note` in the config).
- **Undo and the "Dateien geändert" line need git in the working folder**: OpenCode keeps snapshots only for git folders (measured 2026-10-15). The UI offers "Sicherung einschalten" (`POST /project/git/init`).
- **Thinking:** variant `ohne-denken` (`reasoningEffort: none` → Ollama `reasoning_effort: none`) switches Qwen3.8's thinking off; `low` and `think:false` have no effect (measured). Off by default, switchable in Einstellungen.
- **OpenCode stream quirk (measured):** thinking arrives in a part of type `reasoning` whose deltas say `field:"text"` — route by part id (web/src/stream.ts), never by field.
- **Run location: Shadow PC only** (local, free). No rented server (user's choice).

## Honest expectation
On 24 GB this reaches a capable assistant for scoped, well-specified tasks, but stays **below Claude Code on long autonomous multi-file runs**. Confidence 75. Flips with a bigger/rented GPU or a notably stronger small model.

## Process
- Sessions run either in the cloud (no GPU, no Windows: only config/script/logic checks, never claim a model run worked) or **locally on the Shadow PC** (real runs possible). Check which one you are in before promising anything.
- The Shadow PC gets updates via `scripts/install.ps1` (`-SkipModel` skips the model download); the desktop icon runs `scripts/start.ps1`.
- **Testing locally:** never touch the user's running OpenDante (OpenCode 4096, companion 4097). Start a separate OpenCode (`opencode serve --port 4196`, own `XDG_CONFIG_HOME` copy of the config) and companion (4197). Before anything loads a model: `nvidia-smi`, `ollama ps` and the ComfyUI queue (OpenDali) must be idle.
- **Measure changes with the Testlauf** (`node scripts/eval.mjs`, tasks in `eval/tasks/`, results in `eval/results/`): model, rules, prompts or thinking settings count as better only if the success rate holds.
- Feature by feature: build → test (`npm test` in `web/`, `node companion/test.mjs`) → browser check → commit. Update `PROGRESS.md` at the end of every session — it is the project's memory.
