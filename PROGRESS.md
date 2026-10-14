# openLLM — progress / project memory
Read this first every session. Update it at the end of every session.

## Goal
A free, local, open-source Claude Code equivalent on the user's 24 GB GPU. Assemble + configure OpenCode + Ollama + a local open-weight model; add browser testing and more models; ship with a one-command Windows installer.

## Status
**M1 PROVEN on the Shadow PC** (2026-10-14). Stack installed (OpenCode 1.19.0, Ollama 0.40.4, qwen3.8:27b) and config verified via `opencode debug config`. First autonomous task passed: `opencode run` reached the local model with NO auth prompt, the agent created a file (Write tool) and ran a shell command (`type`, auto-allowed by our permissions) and reported in German. **Next: prove M2 in use — the build/test loop and plan mode on a small real program.**

## Decisions (see CLAUDE.md / docs for detail)
- Harness: OpenCode (MIT, anomalyco/opencode) — **pin OpenCode 1.x** (v2 changes the config schema). Server: Ollama (MIT). First model: `qwen3.8:27b` (Apache-2.0, ~18 GB). One model first, blind test later. Local-only, 24 GB, Windows. GPU shared with OpenDali — not at the same time.

## Verified 2026-10-14 (main session + sonnet lookup, reviewed)
- Model: Ollama tag `qwen3.8:27b` (~18 GB Q4_K_M, Apache-2.0). Benchmarks are Alibaba-reported, not independent. Confirm the official page + LICENSE on download day.
- OpenCode v1.19.0 schema (confidence ~90, nothing run): config at `~/.config/opencode/opencode.json` (global) + project root; `$schema=https://opencode.ai/config.json`; model `provider/model`. **Trap: `limit.context`/`limit.output` default to 0 → set both; `temperature` defaults false → set `true`.** Instructions file is `AGENTS.md` (CLAUDE.md only a fallback). Agents in `~/.config/opencode/agents/*.md` (YAML frontmatter + body); commands in `commands/*.md` with `$ARGUMENTS`, `!` for shell injection, `@` for files. Permissions: key `permission`, values allow/ask/deny, per-tool + bash per-pattern, last match wins (put `*` first). Plan vs build: built-in `plan`/`build` agents, Tab to switch; formal approval gate via `OPENCODE_EXPERIMENTAL_PLAN_MODE=1`. Ollama /v1 can't set context → `OLLAMA_CONTEXT_LENGTH` env (set to 65536).

## Open / to verify on the Shadow PC
- RESOLVED 2026-10-14: `scoop install opencode` → 1.19.0 (v2 is a separate package `versions/opencode2`); config loads from `%USERPROFILE%\.config\opencode`; install.ps1 runs end to end. Fixed along the way: a `try`-as-expression crash, the scoop-shims PATH, and the Ollama installer's app menu hijacking the console.
- RESOLVED 2026-10-14: OpenCode reaches Ollama with NO auth prompt; first autonomous task passed (create file + run command + report). The model shows a "Thinking..." reasoning step (overthinking trait) — consider turning reasoning down if coding feels slow.
- OPEN: prove the build/test loop (`/test`) and plan mode on a small real program; check whether `python`/`node` are on PATH (if not, add a runtime via scoop).
- M3: Node.js + enable the Playwright MCP; WSL/Docker sandbox (nested virtualization on Shadow unverified).

## Files
- Docs: `CLAUDE.md`, `README.md`, `LICENSE` (MIT), `.gitignore`, `docs/PLAN.md`, `docs/RESEARCH.md`, `docs/SETUP.md`
- Config (installed to ~/.config/opencode/): `config/opencode.json` (model + provider + mcp + permission + plan agent), `config/AGENTS.md`, `config/agents/review.md`, `config/commands/{review,test,commit}.md` — all validated (JSON + YAML frontmatter).
- Scripts: `scripts/install.ps1` (Scoop→OpenCode, OllamaSetup→Ollama, env vars incl. plan mode, model pull, config tree copy, shortcut), `scripts/start.ps1`.

## Next step
1. User runs `scripts/install.ps1` on the Shadow PC → send log + `opencode --version` + a screenshot. Confirm OpenCode is 1.x and the config loads.
2. Then M1 proof: a first autonomous mini-task (agent plans → edits → runs → tests). Then M3: Node + enable Playwright MCP, sandbox check (WSL/Docker), image input.

## Log
- 2026-10-14: M0 scaffold + M1 foundation + MIT license pushed. M2 agent config written (opencode.json with the limit/temperature fix, AGENTS.md, review subagent, /review /test /commit commands, permission tiers, plan-mode gate). OpenCode v1.19.0 schema looked up by a `sonnet` agent, reviewed and applied by the main session. Nothing run on Windows/GPU.
