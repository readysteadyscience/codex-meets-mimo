import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('one installer configures both sides without replacing other MiMo plugins', { skip: process.platform !== 'darwin' }, () => {
  const temp = mkdtempSync(join(tmpdir(), 'mimo-bridge-install-'));
  try {
    const home = join(temp, 'home');
    const bin = join(temp, 'bin');
    mkdirSync(join(home, '.config', 'mimocode'), { recursive: true });
    mkdirSync(bin);
    const config = join(home, '.config', 'mimocode', 'mimocode.jsonc');
    writeFileSync(config, '{\n  // existing setting\n  "theme": "dark",\n  "plugin": ["file:///example/other.mjs"],\n}\n');
    writeFileSync(join(bin, 'codex'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BRIDGE_TEST_CODEX_LOG"\n', { mode: 0o755 });
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, BRIDGE_TEST_CODEX_LOG: join(temp, 'codex.log') };
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'install.mjs')], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const changed = readFileSync(config, 'utf8');
    assert.match(changed, /existing setting/);
    assert.match(changed, /file:\/\/\/example\/other\.mjs/);
    assert.match(changed, /desktop-plugin\.mjs/);
    assert.ok(existsSync(join(home, '.config', 'mimocode', 'skills', 'codex-mimo-bridge', 'SKILL.md')));
    const installed = join(home, '.local', 'share', 'xiaomi-mimo-bridge');
    assert.ok(existsSync(join(installed, 'marketplace', 'plugins', 'xiaomi-mimo-bridge', 'assets', 'bridge.png')));
    const mcp = JSON.parse(readFileSync(join(installed, 'marketplace', 'plugins', 'xiaomi-mimo-bridge', '.mcp.json')));
    assert.ok(existsSync(mcp.mcpServers.xiaomi_mimo_bridge.args[0]));
    const calls = readFileSync(join(temp, 'codex.log'), 'utf8');
    assert.match(calls, /plugin marketplace add/);
    assert.match(calls, /plugin add xiaomi-mimo-bridge@mimo-bridge-local/);
    const rerun = spawnSync(process.execPath, [join(root, 'scripts', 'install.mjs')], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(rerun.status, 0);
    assert.equal(readFileSync(config, 'utf8'), changed);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
