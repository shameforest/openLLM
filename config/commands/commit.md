---
description: Commit the current changes with a clear message
agent: build
---

Staged changes:
!`git diff --staged`

If nothing is staged, first stage the relevant changed files with `git add` — but never stage secrets, credentials or large build output. Then write a short, clear commit message (prefix with feat/fix/docs/refactor/test as fitting), show it to the user in one line, and run the commit. Reply in German.

Message hint from the user: $ARGUMENTS
