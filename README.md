# Codex Meets MiMo-Bridge

A local, macOS bridge for delegating code writing and read-only code review from a Codex task to the conversation currently selected in Xiaomi MiMo Desktop. The Codex task waits for MiMo's report, then verifies the files or review findings itself. MiMo never runs Git as part of a delegated task.

The Codex plugin is named **MiMo Bridge**. The MiMo skill is named **Codex Bridge**. Codex uses the included shared icon; MiMo Desktop currently presents the skill with its own default icon.

## Requirements

- macOS, Node.js 22+, `npm`, and Codex CLI installed and available on `PATH`.
- Xiaomi MiMo Desktop installed, opened, and signed in with a working Desktop membership. Choose a model and select the conversation to receive work. The bridge uses that selected model and Desktop membership provider; it does not use MiMo CLI OAuth or an API key.
- Both apps on the same Mac. The transport is a local Unix socket, not a network service.

## One-command install

Paste this in Terminal on the Mac running both apps:

```sh
curl -fsSL https://raw.githubusercontent.com/readysteadyscience/codex-meets-mimo-bridge/main/install.sh | bash
```

The installer downloads the public source into a temporary directory, installs both components, backs up MiMo's configuration, and removes the temporary download. It does not require users to clone or maintain the repository. It refuses to overwrite a previous installation. It does not ask for passwords or tokens. **Restart MiMo Desktop and start a new Codex task** afterwards so both apps load the components.

In Codex, verify with `codex plugin list` and ask for `mimo_bridge_info`. In MiMo, check **Plugins → Other → Codex Bridge**. Choose a MiMo conversation before dispatching. You may add the same project directory to MiMo yourself, but the bridge does not require or manage project lists.

For source inspection or contribution, use `git clone` and `npm ci` separately. Review the installer before running it if you prefer.

## Use

Tell Codex, for example: “This development stage's code writing is assigned to Xiaomi MiMo. Plan a bounded step, send MiMo precise files, expected behavior and checks, then validate the returned code yourself.” Codex calls `mimo_dispatch`, stays in the originating task, and uses `mimo_wait`/`mimo_status` until MiMo finishes. Follow-up steps can reuse the same MiMo conversation. For a review, Codex sends `kind: review`, then checks MiMo's findings against the code.

The originating Codex task must remain running to receive and display the result. This bridge cannot inject a message into a task after that task has ended. Permissions and clarification questions are relayed for explicit handling. MiMo's report is evidence to inspect, not automatic acceptance.

## Data and boundaries

The MiMo receiver listens at `~/.local/state/xiaomi-mimo-codex-bridge/desktop.sock` with mode `0600`; task receipts are stored in the same private local state directory. Any process running as the same macOS user can potentially connect to a same-user Unix socket, so install this only in a trusted user account. The bridge does not send source to a separate bridge server. MiMo processing follows the user's MiMo Desktop account and service settings.

The installer changes only its own install directory, the MiMo skill directory, MiMo's `plugin` config array, and Codex plugin registration. It does not edit project files during installation. Delegated MiMo tasks may edit the project files specified by Codex. The installer does not uninstall or change any existing global MCP entry, so older local bridges may need manual removal after migration.

## Development

```sh
npm ci
npm test
npm run test:install
```

This project is not affiliated with Xiaomi or OpenAI. Licensed under [MIT](LICENSE).
