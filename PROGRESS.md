# openLLM — progress / project memory
Read this first every session. Update it at the end of every session.

## Goal
A free, local, open-source Claude Code equivalent on the user's 24 GB GPU. Assemble + configure OpenCode + Ollama + a local open-weight model; add web search, browser testing and more models; ship with a one-command Windows installer.

## Status
**M0 done** — research + plan + repo scaffold. **Starting M1** (foundation).

## Decisions (see CLAUDE.md for detail)
- Harness: extend OpenCode (MIT). Server: Ollama (MIT). First model: Qwen3.8-27B (Apache-2.0, name UNVERIFIED — confirm at download). One model first, blind test later. Local-only, 24 GB, Windows.

## Open / to verify before it is coded
- Exact Ollama tag for the first model and its real LICENSE file (ollama.com was not reachable from the cloud research).
- OpenCode's current install command and the exact config keys for a local OpenAI-compatible endpoint (Ollama).
- Whether the Shadow PC allows WSL/Docker for the sandbox milestone (nested virtualization unverified).

## Next step
M1: verify the three facts above, then write `scripts/install.ps1` (Ollama + one model + OpenCode, wired together) and a launcher, plus a first autonomous mini-task with proof.

## Log
- 2026-10-14: Repo created (empty). Scaffold + CLAUDE.md + PLAN + RESEARCH committed. Research delegated to two `sonnet` agents; synthesis, hardware fit and plan by the main session. OpenCode identity verified by the main session (anomalyco/opencode, MIT).
