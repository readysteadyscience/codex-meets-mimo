import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function git(cwd, ...args) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }

async function fixture(mode, enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'mimo-bridge-test-'));
  const workspace = join(dir, 'workspace');
  const state = join(dir, 'state');
  execFileSync('mkdir', ['-p', workspace]);
  git(workspace, 'init', '-q');
  git(workspace, 'config', 'user.name', 'Bridge Test');
  git(workspace, 'config', 'user.email', 'bridge@example.invalid');
  writeFileSync(join(workspace, 'README.md'), 'test\n');
  git(workspace, 'add', 'README.md');
  git(workspace, 'commit', '-qm', 'fixture');
  const fake = join(dir, 'fake-mimo');
  writeFileSync(fake, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
${mode === 'success' ? "writeFileSync(join(process.cwd(), 'result.txt'), 'written by fake MiMo\\n');" : ''}
console.log(JSON.stringify(${mode === 'success' ? "{type:'text', sessionID:'fake-session', part:{text:'Completed fake coding task'}}" : "{type:'error', sessionID:'fake-session', error:{data:{message:'Model authentication failed'}}}"}));
`);
  chmodSync(fake, 0o755);
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/server.js')], cwd: resolve('.'), env: { ...process.env, MIMO_BRIDGE_STATE_DIR: state, MIMO_BRIDGE_MIMO_BIN: fake, MIMO_BRIDGE_MODE: 'cli-test', MIMO_BRIDGE_ENABLE_DISPATCH: enabled ? '1' : '0' } });
  const client = new Client({ name: 'bridge-test', version: '1' });
  await client.connect(transport);
  return { dir, workspace, client, transport };
}

function value(result) { return JSON.parse(result.content[0].text); }

test('dispatch returns a durable receipt and completed coding result', async () => {
  const f = await fixture('success');
  try {
    const tools = await f.client.listTools();
    assert.deepEqual(tools.tools.map((x) => x.name).sort(), ['mimo_bridge_info', 'mimo_dispatch', 'mimo_permission_reply', 'mimo_question_reply', 'mimo_selected_conversation', 'mimo_status', 'mimo_wait']);
    const dispatched = value(await f.client.callTool({ name: 'mimo_dispatch', arguments: { workspace: f.workspace, instructions: 'Write one harmless result file and report completion.' } }));
    assert.match(dispatched.id, /^[0-9a-f-]{36}$/);
    let result;
    for (let i = 0; i < 8; i++) {
      result = value(await f.client.callTool({ name: 'mimo_wait', arguments: { id: dispatched.id, timeout_seconds: 2 } }));
      if (result.status === 'completed') break;
    }
    assert.equal(result.status, 'completed');
    assert.equal(result.response, 'Completed fake coding task');
    assert.equal(result.mimo_session_id, 'fake-session');
    assert.ok(result.changed_files.some((x) => x.includes('result.txt')));
  } finally { await f.client.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('error event fails even when MiMo exits zero; existing changes are recorded', async () => {
  const f = await fixture('error');
  try {
    writeFileSync(join(f.workspace, 'dirty.txt'), 'existing');
    const dispatched = value(await f.client.callTool({ name: 'mimo_dispatch', arguments: { workspace: f.workspace, instructions: 'Attempt a harmless coding task in this fixture.' } }));
    let result;
    for (let i = 0; i < 8; i++) {
      result = value(await f.client.callTool({ name: 'mimo_wait', arguments: { id: dispatched.id, timeout_seconds: 2 } }));
      if (result.status === 'failed') break;
    }
    assert.equal(result.status, 'failed');
    assert.match(result.error, /authentication failed/);
    assert.ok(result.initial_git_status.some((line) => line.includes('dirty.txt')));
  } finally { await f.client.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('disabled configuration refuses delegation', async () => {
  const f = await fixture('success', false);
  try {
    const info = value(await f.client.callTool({ name: 'mimo_bridge_info', arguments: {} }));
    assert.equal(info.dispatch_enabled, false);
    const result = await f.client.callTool({ name: 'mimo_dispatch', arguments: { workspace: f.workspace, instructions: 'Write a harmless file only after authorization.' } });
    assert.equal(result.isError, true);
    assert.match(value(result).error, /disabled by configuration/);
  } finally { await f.client.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('Desktop receiver dispatches and reports completion through the original MCP client', async () => {
  const f = await fixture('success');
  const socketPath = join(f.dir, 'desktop.sock');
  let defaultAnswered = false;
  let dispatchCount = 0;
  const receiver = net.createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk;
      if (!data.includes('\n')) return;
      const request = JSON.parse(data.slice(0, data.indexOf('\n')));
      if (request.op === 'selected') {
        socket.end(JSON.stringify({ ok: true, session_id: 'selected-session', directory: f.workspace, title: 'Selected conversation' }) + '\n');
      } else if (request.op === 'dispatch') {
        dispatchCount++;
        if (request.directory) {
          assert.equal(request.directory, realpathSync(f.workspace));
          writeFileSync(join(f.workspace, 'desktop-result.txt'), 'from Desktop receiver\n');
        }
        socket.end(JSON.stringify({ ok: true, session_id: 'selected-session', session_directory: f.workspace,
          baseline_message_id: dispatchCount === 2 ? 'assistant-old' : null }) + '\n');
      } else if (request.op === 'status') {
        const previous = [
          { info: { id: 'user-old', role: 'user' }, parts: [{ type: 'text', text: 'old request' }] },
          { info: { id: 'assistant-old', role: 'assistant', finish: 'stop' }, parts: [{ type: 'text', text: 'Old completed response' }] },
        ];
        const messages = dispatchCount === 1 ? previous : [
          ...previous,
          { info: { id: 'user-new', role: 'user' }, parts: [{ type: 'text', text: 'new request' }] },
          ...(defaultAnswered ? [{ info: { id: 'assistant-new', role: 'assistant', finish: 'stop' }, parts: [{ type: 'text', text: 'New Desktop work done' }] }] : []),
        ];
        socket.end(JSON.stringify({ ok: true, status: null, messages }) + '\n');
      } else if (request.op === 'questions') {
        socket.end(JSON.stringify({ ok: true, requests: dispatchCount === 1 || defaultAnswered ? [] : [{ id: 'question-1', questions: [{ question: 'Which scope?', header: 'Scope', options: [{ label: 'Fixture', description: 'Use the fixture' }] }] }] }) + '\n');
      } else if (request.op === 'answer') {
        assert.equal(request.question_id, 'question-1');
        assert.deepEqual(request.answers, [['Fixture']]);
        defaultAnswered = true;
        socket.end(JSON.stringify({ ok: true }) + '\n');
      } else socket.end(JSON.stringify({ ok: true, surface: 'MiMo Desktop plugin' }) + '\n');
    });
  });
  receiver.listen(socketPath);
  await once(receiver, 'listening');
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/server.js')], cwd: resolve('.'), env: {
    ...process.env, MIMO_BRIDGE_STATE_DIR: join(f.dir, 'desktop-state'), MIMO_BRIDGE_MODE: 'desktop',
    MIMO_BRIDGE_DESKTOP_SOCKET: socketPath, MIMO_BRIDGE_ENABLE_DISPATCH: '1',
  } });
  const client = new Client({ name: 'desktop-bridge-test', version: '1' });
  try {
    await client.connect(transport);
    const info = value(await client.callTool({ name: 'mimo_bridge_info', arguments: {} }));
    assert.equal(info.execution_surface, 'MiMo Desktop');
    const selected = value(await client.callTool({ name: 'mimo_selected_conversation', arguments: {} }));
    assert.equal(selected.session_id, 'selected-session');
    const dispatched = value(await client.callTool({ name: 'mimo_dispatch', arguments: { workspace: f.workspace, instructions: 'Write the harmless fixture result file and report it.' } }));
    assert.equal(dispatched.mimo_session_id, 'selected-session');
    const completed = value(await client.callTool({ name: 'mimo_wait', arguments: { id: dispatched.id, timeout_seconds: 2 } }));
    assert.equal(completed.status, 'completed');
    assert.equal(completed.response, 'Old completed response');
    assert.ok(completed.changed_files.some((line) => line.includes('desktop-result.txt')));
    const defaultChat = value(await client.callTool({ name: 'mimo_dispatch', arguments: { instructions: 'Reply briefly from the default MiMo conversation.' } }));
    assert.equal(defaultChat.workspace, null);
    assert.equal(defaultChat.mimo_session_id, 'selected-session');
    const question = value(await client.callTool({ name: 'mimo_wait', arguments: { id: defaultChat.id, timeout_seconds: 2 } }));
    assert.equal(question.pending_questions?.[0]?.id, 'question-1');
    const answered = value(await client.callTool({ name: 'mimo_question_reply', arguments: { id: defaultChat.id, question_id: 'question-1', answers: [['Fixture']] } }));
    assert.equal(answered.question_id, 'question-1');
    const defaultResult = value(await client.callTool({ name: 'mimo_wait', arguments: { id: defaultChat.id, timeout_seconds: 2 } }));
    assert.equal(defaultResult.status, 'completed');
    assert.equal(defaultResult.response, 'New Desktop work done');
    assert.deepEqual(defaultResult.changed_files, []);
  } finally {
    await client.close();
    await f.client.close();
    await new Promise((resolve) => receiver.close(resolve));
    rmSync(f.dir, { recursive: true, force: true });
  }
});
