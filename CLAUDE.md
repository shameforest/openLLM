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
- **First model: Qwen3.8-27B, Apache-2.0** — name and scores are UNVERIFIED (from web-search summaries only; Hugging Face/Ollama were unreachable in the cloud). Confirm the exact Ollama tag and the LICENSE file on download day. Start with ONE model, add the others + a blind test later.
- **Default model since 2026-10-15: the uncensored (abliterated) `orcarouter/Qwen3.8-27B-Uncensored:q4_K_M`** (user's wish; Apache-2.0 + tools + thinking on its ollama.com page). The original `qwen3.8:27b` and `huihui_ai/Qwen3.8-abliterated:27b-q4_K_M` stay selectable in Einstellungen. Keep `LOCAL_MODELS` (web/src/settings.ts), `config/opencode.json` and `install.ps1` in sync.
- **OpenCode stream quirk (measured):** thinking arrives in a part of type `reasoning` whose deltas say `field:"text"` — route by part id (web/src/stream.ts), never by field.
- **Run location: Shadow PC only** (local, free). No rented server (user's choice).

## Honest expectation
On 24 GB this reaches a capable assistant for scoped, well-specified tasks, but stays **below Claude Code on long autonomous multi-file runs**. Confidence 75. Flips with a bigger/rented GPU or a notably stronger small model.

## Process (mirror OpenDali)
- Development happens in these cloud sessions (the user only has credit here). The Shadow PC gets updates by running one installer command (`scripts/install.ps1`, to be built). Real runs, speed and the model blind test happen on the Shadow PC; the user sends screenshots/logs.
- Milestone by milestone (M1–M5 in `PLAN.md`), one feature at a time: build → test → fix → show proof → start the next.
- Update `PROGRESS.md` at the end of every session — it is the project's memory.
- Here in the cloud there is **no GPU and no Windows**: we can check config/JSON/script structure and logic, not real model runs. Say so; never claim a local run worked without the user's proof.
