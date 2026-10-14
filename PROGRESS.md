# openLLM — progress / project memory
Read this first every session. Update it at the end of every session.

## Goal
A free, local, open-source Claude Code equivalent on the user's 24 GB GPU. Assemble + configure OpenCode + Ollama + a local open-weight model; add web search, browser testing and more models; ship with a one-command Windows installer.

## Status
**M0 done** (research + plan + scaffold). **M1 in progress** — installer, config and launcher written; not yet run on Windows.

## Decisions (see CLAUDE.md / docs for detail)
- Harness: extend OpenCode (MIT, anomalyco/opencode). Server: Ollama (MIT). First model: **qwen3.8:27b** (Apache-2.0, ~18 GB). One model first, blind test later. Local-only, 24 GB, Windows. GPU shared with OpenDali — not at the same time.

## Verified 2026-10-14 (main session, via WebSearch/WebFetch)
- Model exists; Ollama tag `qwen3.8:27b` (~18 GB Q4_K_M, runs on 24 GB). Released 14 Aug 2026, Apache-2.0. **Benchmarks are Alibaba-reported, not independently replicated.** Confirm the official ollama.com/library page + LICENSE on download day (ollama.com was not directly reachable from the cloud).
- OpenCode install on Windows: `scoop install opencode` (also choco / `npm i -g @opencode/cli@latest`). Repo renamed sst→anomalyco.
- OpenCode local model: a `provider.ollama` block with `npm: @ai-sdk/openai-compatible` and `options.baseURL: http://localhost:11434/v1` → `config/opencode.json`.

## Open / to verify on the Shadow PC
- OpenCode's exact global config path (assumed `~/.config/opencode/opencode.json`).
- Whether `scoop install opencode` / `scoop` bootstrap and the silent OllamaSetup.exe run work as written (all untested on Windows).
- Ollama env vars take effect (context 65536, kv q8_0) — check `ollama ps` for CPU spill.
- WSL/Docker availability for the M3 sandbox (nested virtualization on Shadow unverified).

## Files so far
- `CLAUDE.md`, `README.md`, `docs/PLAN.md`, `docs/RESEARCH.md`, `docs/SETUP.md`
- `config/opencode.json` (valid JSON, verified structure)
- `scripts/install.ps1` (Scoop → OpenCode; OllamaSetup → Ollama; env vars; model pull; config copy; desktop shortcut)
- `scripts/start.ps1` (warns if OpenDali holds the GPU; starts Ollama; opens OpenCode TUI)

## Next step
User runs `scripts/install.ps1` on the Shadow PC and sends the log + a screenshot. Fix what breaks (likely: OpenCode config path, Ollama install flags). Then finish M1: a first autonomous mini-task with proof (e.g. "build a small script", agent plans/edits/runs/tests).

## Log
- 2026-10-14: Repo created (empty). M0 scaffold (CLAUDE.md, PLAN, RESEARCH) pushed to `main`. M1 foundation written (installer, config, launcher, SETUP). OpenCode identity + install, model tag, and local-provider config verified by the main session. Research delegated to two `sonnet` agents; synthesis/plan/verification by the main session. Nothing run on Windows/GPU yet (no such hardware in the cloud).
