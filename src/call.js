#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const allowed = new Set([
  'mimo_bridge_info', 'mimo_selected_conversation', 'mimo_dispatch', 'mimo_status', 'mimo_wait',
  'mimo_permission_reply', 'mimo_question_reply',
]);
const name = process.argv[2];
const file = process.argv[3];
if (!allowed.has(name) || (file && process.argv.length !== 4)) {
  console.error('Usage: node src/call.js <mimo_tool_name> [arguments.json]');
  process.exit(2);
}

let client;
try {
  const entries = JSON.parse(execFileSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf8', timeout: 10000 }));
  const entry = entries.find((item) => item.name === 'codex-meets-mimo');
  const config = entry?.transport;
  if (!entry?.enabled || config?.type !== 'stdio' ||
      config.args?.[0] !== fileURLToPath(new URL('./server.js', import.meta.url)) ||
      config.env?.MIMO_BRIDGE_MODE !== 'desktop' ||
      config.env?.MIMO_BRIDGE_ENABLE_DISPATCH !== '1') {
    throw new Error('Enabled Xiaomi MiMo Desktop MCP configuration was not found');
  }
  const input = file ? readFileSync(resolve(file), 'utf8') : await new Promise((resolveInput, reject) => {
    let data = '';
    if (process.stdin.isTTY) return resolveInput('{}');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.once('end', () => resolveInput(data.trim() || '{}'));
    process.stdin.once('error', reject);
  });
  const args = JSON.parse(input);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object');
  client = new Client({ name: 'xiaomi-mimo-codex-local-client', version: '0.1.0' });
  await client.connect(new StdioClientTransport({
    command: config.command, args: config.args, cwd: config.cwd || undefined,
    env: { ...process.env, ...config.env },
  }));
  const result = await client.callTool({ name, arguments: args });
  const value = result.content?.find((part) => part.type === 'text')?.text;
  if (!value) throw new Error('MiMo bridge returned no text result');
  process.stdout.write(`${value}\n`);
  if (result.isError) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  await client?.close();
}
