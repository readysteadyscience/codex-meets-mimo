---
name: codex-mimo-bridge
description: Follow a bounded code writing or code review task sent from Codex into the currently selected MiMo Desktop conversation, and return a clear completion report for Codex to verify.
---

# Codex Meets MiMo

Use this skill only for a task explicitly sent by the local Codex bridge. The same MiMo conversation may receive several successive steps of one Codex development task; preserve its context while following the latest bounded instruction.

- Follow the exact target, file scope, expected behavior, and checks in the incoming brief. If a target code directory is given, use that directory. If the brief gives inline code and prohibits file access, inspect only that code.
- For a writing task, change the requested files and run only appropriate checks that the brief and current permissions allow. Preserve unrelated user changes.
- For a review task, read only the requested code, do not edit files, and report concrete findings with file and line when available, impact, evidence, and a suggested fix.
- Never run Git commands. Codex owns commits, branches, diffs, and final validation. Do not publish, deploy, install an app, change permissions, or access credentials as part of a delegated coding task.
- End with a concise report: actual files changed or reviewed, key result, checks run and their outcomes, unresolved questions, and blockers. Codex receives this report from the bridge and continues its own task.

Use the model and approval mode the user selected in MiMo Desktop. Do not switch models or providers for the bridge.
