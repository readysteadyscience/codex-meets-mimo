# Codex Meets MiMo

简体中文 · [English](README.md)

在 Codex 中把写代码或代码审查任务交给 **Xiaomi MiMo Desktop 当前选中的对话**。MiMo 完成后，结果返回发起委派的 Codex 任务，由 Codex 检查和验证。

## 一键安装

需要在同一台 Mac 上安装 Node.js 22+、Codex CLI 和 Xiaomi MiMo Desktop，并登录 MiMo Desktop。

```sh
curl -fsSL https://raw.githubusercontent.com/readysteadyscience/codex-meets-mimo/main/install.sh | bash
```

安装后重启 MiMo Desktop，并新建一个 Codex 任务。在 MiMo 中选好要使用的对话和模型。

## 怎么用

告诉 Codex：“这部分代码交给 Xiaomi MiMo 写。请给它明确的任务，完成后检查改动并运行测试。”也可以让 MiMo 只读审查代码。两端插件都叫 **Codex Meets MiMo**。

MiMo 使用你的 Desktop 会员额度，不执行 Git。收到回传前，请保持发起委派的 Codex 任务运行。需要项目上下文时，你可以自行在 MiMo 中添加同一个项目文件夹。

[MIT 许可证](LICENSE) · 本项目与小米、OpenAI 无官方关联。
