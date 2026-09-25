---
name: xiaomi-mimo-delegation
description: Delegate code writing or code review to Xiaomi MiMo Desktop when the user assigns a task or development stage to MiMo; receive each result and continue the originating Codex task.
---

# Xiaomi MiMo code delegation

Use when the user clearly assigns code writing or code review to MiMo, including one instruction that covers an entire development stage. Merely mentioning MiMo is not a delegation. For a stage-level assignment, dispatch each later code-writing step to MiMo automatically until that stage ends or the user changes the assignment. Codex owns planning, task wording, Git, final review, and validation.

1. Ground the user's request in the current project plan, relevant code and rules. The user normally adds the same folder to MiMo and has MiMo read the project and development checklist; neither action is a plugin prerequisite. If no project path is supplied, use the default MiMo conversation.
2. Turn each bounded step into a specific Chinese task brief using [delegation briefs](references/delegation-brief.md). Include verified file/module scope, expected behavior, compatibility constraints, acceptance checks, and the exact report needed. Do not invent unknown paths or pass through a vague request. Use `kind: write` or `kind: review` in `mimo_dispatch`; the model follows the user's current choice in MiMo Desktop. MiMo does not run Git commands. Dispatch continues in the conversation currently selected by the user in MiMo; never create a fresh conversation for every step.
3. Call `mimo_bridge_info` and require the Desktop execution surface with dispatch enabled. Read `mimo_selected_conversation` and send the step to that conversation. Keep this originating Codex task active; use `mimo_wait` / `mimo_status` until completion. If the running Codex task has not loaded the MCP tools, start a new Codex task after installation. Inspect pending permission commands before approving only once or rejecting. For `mimo_question_reply`, answer from established task context; ask the user when a material answer is unknown.
4. When MiMo completes, immediately show its result in a concise, explicit message in this original Codex task: task kind, changed files or review findings, checks, blockers, and actual model. Then do Codex's own work. For code writing, inspect the actual changed files, run applicable tests and project gates, and handle fixes. For code review, check the report against the referenced code and decide follow-up. If the active stage has another writing step, repeat steps 1–4 in the same Codex task without another user prompt. MiMo completion is not acceptance or release authority.

The MiMo-side receiver is a JavaScript Desktop plugin; Codex-side tools are MCP. The bridge waits inside the active Codex task and cannot restart that task after it has ended. See the public repository README for installation and limitations.
