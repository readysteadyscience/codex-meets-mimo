# Codex Meets MiMo

[简体中文](README.zh-CN.md) · English

Send coding or code review work from Codex to the conversation currently selected in Xiaomi MiMo Desktop. MiMo reports back to the same Codex task; Codex checks the result.

## Install

Requires macOS, Node.js 22+, Codex CLI, and Xiaomi MiMo Desktop signed in on the same Mac.

```sh
curl -fsSL https://raw.githubusercontent.com/readysteadyscience/codex-meets-mimo/main/install.sh | bash
```

Restart MiMo Desktop and start a new Codex task. In MiMo, select the conversation and model you want to use.

## Use

Tell Codex: “Let Xiaomi MiMo write this part of the code. Give it a specific task, then check its changes and run the tests.” You can also ask MiMo for a read-only code review. Both plugins are named **Codex Meets MiMo**.

MiMo uses your Desktop membership and does not run Git. Keep the originating Codex task open until MiMo returns. You can add the same project folder in MiMo yourself when project context is needed.

[MIT License](LICENSE) · Not affiliated with Xiaomi or OpenAI.
