#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = homedir();
const installRoot = join(home, '.local', 'share', 'xiaomi-mimo-bridge');
const runtime = join(installRoot, 'runtime');
const marketplace = join(installRoot, 'marketplace');
const plugin = join(marketplace, 'plugins', 'xiaomi-mimo-bridge');
const mimoSkill = join(home, '.config', 'mimocode', 'skills', 'codex-mimo-bridge');
const mimoConfig = join(home, '.config', 'mimocode', 'mimocode.jsonc');
const marketplaceName = 'mimo-bridge-local';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status})`);
}
function copyNew(from, to) {
  if (existsSync(to)) throw new Error(`Already exists: ${to}. Keep the existing installation; this installer will not overwrite it.`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
}
function prepareMiMoConfig(pluginURL) {
  const text = existsSync(mimoConfig) ? readFileSync(mimoConfig, 'utf8') : '{}\n';
  const errors = [];
  const parsed = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid MiMo JSONC config: ${errors.map((e) => printParseErrorCode(e.error)).join(', ')}`);
  }
  if (parsed.plugin != null && (!Array.isArray(parsed.plugin) || !parsed.plugin.every((item) => typeof item === 'string'))) {
    throw new Error('MiMo config plugin setting must be an array of strings');
  }
  const next = [...new Set([...(parsed.plugin || []), pluginURL])];
  return applyEdits(text, modify(text, ['plugin'], next, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
}

if (process.platform !== 'darwin') throw new Error('This release supports macOS only');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required');
for (const name of ['codex', 'npm']) {
  const result = spawnSync('/usr/bin/which', [name], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} is required on PATH`);
}
if (!existsSync(mimoConfig)) throw new Error(`MiMo Desktop config not found: ${mimoConfig}. Install and open Xiaomi MiMo Desktop first.`);
const pluginURL = pathToFileURL(join(runtime, 'src', 'desktop-plugin.mjs')).href;
const nextConfig = prepareMiMoConfig(pluginURL);
for (const path of [installRoot, mimoSkill]) {
  if (existsSync(path)) throw new Error(`Already exists: ${path}. Refusing to overwrite a prior installation.`);
}

copyNew(join(source, 'src'), join(runtime, 'src'));
cpSync(join(source, 'package.json'), join(runtime, 'package.json'));
cpSync(join(source, 'package-lock.json'), join(runtime, 'package-lock.json'));
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
copyNew(join(source, 'distribution', 'codex-plugin'), plugin);
mkdirSync(join(plugin, 'assets'), { recursive: true });
cpSync(join(source, 'assets', 'bridge.png'), join(plugin, 'assets', 'bridge.png'));
writeFileSync(join(plugin, '.mcp.json'), JSON.stringify({
  mcpServers: {
    xiaomi_mimo_bridge: {
      command: process.execPath,
      args: [join(runtime, 'src', 'server.js')],
      env: { MIMO_BRIDGE_MODE: 'desktop', MIMO_BRIDGE_ENABLE_DISPATCH: '1' },
    },
  },
}, null, 2) + '\n', { mode: 0o600 });
mkdirSync(join(marketplace, '.agents', 'plugins'), { recursive: true });
writeFileSync(join(marketplace, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
  name: marketplaceName,
  interface: { displayName: 'MiMo Bridge' },
  plugins: [{ name: 'xiaomi-mimo-bridge', source: { source: 'local', path: './plugins/xiaomi-mimo-bridge' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Coding' }],
}, null, 2) + '\n');
run('codex', ['plugin', 'marketplace', 'add', marketplace]);
run('codex', ['plugin', 'add', `xiaomi-mimo-bridge@${marketplaceName}`]);
copyNew(join(source, 'distribution', 'mimo-skill', 'codex-mimo-bridge'), mimoSkill);
mkdirSync(dirname(mimoConfig), { recursive: true });
cpSync(mimoConfig, `${mimoConfig}.bridge-backup-${Date.now()}`);
writeFileSync(mimoConfig, nextConfig);
console.log('Installed MiMo Bridge (Codex) and Codex Bridge (MiMo). Restart MiMo Desktop and start a new Codex task to load them.');
