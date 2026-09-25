#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { createTask, publicTask, readTask, updateTask } from './store.js';
import { desktopRequest } from './desktop-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const server = new McpServer({ name: 'xiaomi-mimo-codex-bridge', version: '0.1.1' });
const terminal = new Set(['completed', 'failed', 'cancelled', 'result_unknown']);
const desktopMode = process.env.MIMO_BRIDGE_MODE === 'desktop';
const cliTestMode = process.env.MIMO_BRIDGE_MODE === 'cli-test';
const dispatchEnabled = process.env.MIMO_BRIDGE_ENABLE_DISPATCH === '1' && (desktopMode || cliTestMode);

async function ensureDesktop() {
  try { return await desktopRequest({ op: 'ping' }); }
  catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error?.code)) throw error;
  }
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', ['-a', 'Xiaomi MiMo']);
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not open Xiaomi MiMo (${code})`)));
  });
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await desktopRequest({ op: 'ping' }); }
    catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error?.code)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Xiaomi MiMo opened but its bridge plugin did not become ready: ${lastError?.message || 'unknown error'}`);
}

function response(value, error = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: error };
}

function git(workspace, args) {
  return execFileSync('git', args, { cwd: workspace, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function resolveWorkspace(input) {
  if (input == null) return { workspace: null, baseline: null, initial_git_status: [] };
  if (!input.startsWith('/')) throw new Error('workspace must be an absolute path');
  const workspace = realpathSync(resolve(input));
  if (!statSync(workspace).isDirectory()) throw new Error('workspace must be a directory');
  try {
    if (git(workspace, ['rev-parse', '--is-inside-work-tree']) === 'true') {
      return {
        workspace,
        baseline: git(workspace, ['rev-parse', 'HEAD']),
        initial_git_status: git(workspace, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean),
      };
    }
  } catch { /* A user-selected directory need not be a Git checkout. */ }
  return { workspace, baseline: null, initial_git_status: [] };
}

async function currentTask(id) {
  let task = readTask(id);
  if (desktopMode && task.mimo_session_id && !terminal.has(task.status)) {
    const [result, permissions, questions] = await Promise.all([
      desktopRequest({ op: 'status', directory: task.session_directory || task.workspace, session_id: task.mimo_session_id }),
      desktopRequest({ op: 'pending', directory: task.session_directory || task.workspace, session_id: task.mimo_session_id }),
      desktopRequest({ op: 'questions', directory: task.session_directory || task.workspace, session_id: task.mimo_session_id }),
    ]);
    const messages = result.messages || [];
    const baselineIndex = task.baseline_message_id
      ? messages.findIndex((message) => message.info?.id === task.baseline_message_id) : -1;
    const fresh = baselineIndex >= 0 ? messages.slice(baselineIndex + 1)
      : messages.filter((message) => !task.started_at_ms || message.info?.time?.created >= task.started_at_ms);
    const assistant = fresh.filter((message) => message.info?.role === 'assistant').at(-1);
    const responseText = assistant?.parts?.filter((part) => part.type === 'text').map((part) => part.text || '').join('') || '';
    const error = assistant?.info?.error?.data?.message || assistant?.info?.error?.message || null;
    const completed = Boolean(assistant?.info?.finish || assistant?.info?.time?.completed);
    const actualModel = assistant?.info?.modelID && assistant?.info?.providerID
      ? { providerID: assistant.info.providerID, modelID: assistant.info.modelID }
      : null;
    let changes = [];
    if (task.workspace && task.baseline_commit) {
      try { changes = git(task.workspace, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean); }
      catch { /* The workspace may have moved; response and error remain available. */ }
    }
    task = updateTask(id, {
      status: error ? 'failed' : completed ? 'completed' : 'running',
      response: responseText.slice(-30000),
      error: error ? String(error).slice(0, 500) : null,
      actual_model: actualModel,
      changed_files: changes,
      event_count: fresh.length,
      pending_permissions: (permissions.requests || []).map((request) => ({
        id: request.id, type: request.type || request.permission,
        title: request.title || request.patterns?.join(', ') || '',
        pattern: request.pattern || request.patterns,
      })),
      pending_questions: (questions.requests || []).map((request) => ({ id: request.id, questions: request.questions })),
    });
  }
  if (task.status === 'running' && task.worker_pid) {
    try { process.kill(task.worker_pid, 0); }
    catch { task = updateTask(id, { status: 'result_unknown', error: 'Worker exited before writing a final receipt; inspect the workspace before retrying.' }); }
  }
  return publicTask(task);
}

server.registerTool('mimo_dispatch', {
  title: 'Delegate code writing or review to Xiaomi MiMo',
  description: 'Start MiMo Desktop code writing or read-only code review after the user explicitly assigns that work. The project directory is optional; omit it for MiMo’s default conversation.',
  inputSchema: {
    workspace: z.string().min(1).optional().describe('Optional absolute path to a directory already chosen by the user; omit for MiMo default conversation'),
    kind: z.enum(['write', 'review']).default('write').describe('write: edit code; review: inspect code and return findings without editing'),
    instructions: z.string().min(10).max(30000).describe('Exact bounded coding task and acceptance conditions'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}, async ({ workspace: path, kind, instructions }) => {
  try {
    if (!dispatchEnabled) throw new Error('Dispatch is disabled by configuration. Do not substitute a free or separate API channel.');
    const { workspace, baseline, initial_git_status } = resolveWorkspace(path);
    if (cliTestMode && !workspace) throw new Error('CLI test mode requires a workspace');
    if (desktopMode) await ensureDesktop();
    const task = createTask({ workspace, baseline_commit: baseline, initial_git_status, kind, instructions });
    if (desktopMode) {
      try {
        const role = kind === 'review'
          ? 'Inspect code and return a concise review report with concrete file/line findings, impact, and suggested fixes. Do not modify files.'
          : 'Write the requested code and report changed files and checks. If no project directory was supplied, provide code in your reply rather than modifying local files.';
        const boundary = `Continue the conversation currently selected in MiMo Desktop. ${workspace ? `The target code directory is ${workspace}.` : 'No target code directory was supplied.'} ${role} Do not run Git commands; Codex owns all Git work. Preserve unrelated existing changes. Do not publish, deploy, install an app, change permissions, or access credentials. End with results and blockers.`;
        const prompt = `${instructions}\n\nBridge boundary: ${boundary}`;
        const dispatched = await desktopRequest({ op: 'dispatch', directory: workspace || undefined, title: 'Codex 委派任务', prompt }, 30000);
        updateTask(task.id, { status: 'running', mimo_session_id: dispatched.session_id,
          session_directory: dispatched.session_directory || workspace,
          baseline_message_id: dispatched.baseline_message_id || null,
          started_at_ms: dispatched.started_at_ms || null,
          selected_model: dispatched.selected_model || null });
        return response({ id: task.id, kind, status: 'running', workspace, baseline_commit: baseline,
          mimo_session_id: dispatched.session_id, session_directory: dispatched.session_directory || workspace,
          selected_model: dispatched.selected_model || null,
          next: 'Call mimo_wait or mimo_status in this same Codex task.' });
      } catch (error) {
        updateTask(task.id, { status: 'failed', error: String(error?.message || error).slice(0, 500) });
        throw error;
      }
    }
    const child = spawn(process.execPath, [resolve(here, 'worker.js'), task.id], {
      cwd: workspace, detached: true, stdio: 'ignore', env: process.env,
    });
    child.on('error', (error) => updateTask(task.id, { status: 'failed', error: `Worker launch failed: ${error.message}` }));
    child.unref();
    return response({ id: task.id, status: task.status, workspace, baseline_commit: baseline, next: 'Call mimo_wait or mimo_status in this same Codex task.' });
  } catch (error) { return response({ error: String(error.message || error) }, true); }
});

server.registerTool('mimo_bridge_info', {
  title: 'Read MiMo bridge capability',
  description: 'Read whether delegation is enabled and which MiMo execution surface this bridge uses.',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async () => response({
  version: '0.1.1',
  execution_surface: desktopMode ? 'MiMo Desktop' : cliTestMode ? 'MiMo Code CLI test fixture' : 'disabled',
  desktop_session_integration: desktopMode ? 'Unix socket receiver plugin' : 'unverified',
  desktop_membership_entitlement: desktopMode ? 'mimo-desktop model provider selected' : 'unverified',
  dispatch_enabled: dispatchEnabled,
}));

server.registerTool('mimo_selected_conversation', {
  title: 'Read the selected MiMo conversation',
  description: 'Read the conversation currently selected in MiMo Desktop before sending a delegated step. No conversation is created.',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async () => {
  try {
    if (!desktopMode) throw new Error('Selected conversation requires MiMo Desktop mode');
    await ensureDesktop();
    return response(await desktopRequest({ op: 'selected' }));
  } catch (error) { return response({ error: String(error.message || error) }, true); }
});

server.registerTool('mimo_status', {
  title: 'Read MiMo task status',
  description: 'Read a previously dispatched MiMo task receipt, including its result and changed-file summary.',
  inputSchema: { id: z.string().uuid() },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ id }) => {
  try { return response(await currentTask(id)); }
  catch (error) { return response({ error: String(error.message || error) }, true); }
});

server.registerTool('mimo_wait', {
  title: 'Wait for MiMo result',
  description: 'Wait up to 30 seconds for a task update. The calling Codex task should continue waiting and then report the result in its original window.',
  inputSchema: { id: z.string().uuid(), timeout_seconds: z.number().int().min(1).max(30).default(20) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ id, timeout_seconds }) => {
  try {
    const deadline = Date.now() + timeout_seconds * 1000;
    let prior = await currentTask(id);
    while (!terminal.has(prior.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const next = await currentTask(id);
      if (next.status !== prior.status || next.event_count !== prior.event_count || next.pending_permissions?.length || next.pending_questions?.length) return response(next);
      prior = next;
    }
    return response(prior);
  } catch (error) { return response({ error: String(error.message || error) }, true); }
});

server.registerTool('mimo_permission_reply', {
  title: 'Respond to one MiMo permission request',
  description: 'Approve once or reject a specific pending MiMo tool action for a bridge task. Inspect the request and project rules before approving; never grant a permanent approval.',
  inputSchema: { id: z.string().uuid(), permission_id: z.string().min(1), response: z.enum(['once', 'reject']) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}, async ({ id, permission_id, response: decision }) => {
  try {
    if (!desktopMode) throw new Error('Permission relay requires MiMo Desktop mode');
    const task = readTask(id);
    if (!task.mimo_session_id || terminal.has(task.status)) throw new Error('Task is not awaiting a permission');
    const pending = await currentTask(id);
    const request = pending.pending_permissions?.find((item) => item.id === permission_id);
    if (!request) throw new Error('Permission is not pending for this task');
    if (decision === 'once') {
      const detail = `${request.type || ''} ${request.title || ''} ${JSON.stringify(request.pattern || '')}`;
      if (/(^|[^a-z])git([^a-z]|$)/i.test(detail)) throw new Error('MiMo must not run Git commands; reject this permission request');
      if (task.kind === 'review' && /^(edit|write|apply_patch)$/i.test(String(request.type || ''))) {
        throw new Error('Code review is read-only; reject this permission request');
      }
    }
    await desktopRequest({ op: 'reply', directory: task.session_directory || task.workspace, session_id: task.mimo_session_id, permission_id, response: decision });
    return response({ id, permission_id, response: decision, next: 'Call mimo_wait in the same Codex task.' });
  } catch (error) { return response({ error: String(error.message || error) }, true); }
});

server.registerTool('mimo_question_reply', {
  title: 'Answer one MiMo clarification request',
  description: 'Return answers to a pending question from MiMo in this bridge task. Use known task context; ask the user when the answer cannot be inferred.',
  inputSchema: { id: z.string().uuid(), question_id: z.string().min(1), answers: z.array(z.array(z.string()).min(1)).min(1) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ id, question_id, answers }) => {
  try {
    if (!desktopMode) throw new Error('Question relay requires MiMo Desktop mode');
    const task = readTask(id);
    if (!task.mimo_session_id || terminal.has(task.status)) throw new Error('Task is not awaiting a question');
    const pending = await currentTask(id);
    const request = pending.pending_questions?.find((item) => item.id === question_id);
    if (!request) throw new Error('Question is not pending for this task');
    if (answers.length !== request.questions.length) throw new Error('Provide one answer array for each pending question');
    await desktopRequest({ op: 'answer', directory: task.session_directory || task.workspace, session_id: task.mimo_session_id, question_id, answers });
    return response({ id, question_id, next: 'Call mimo_wait in the same Codex task.' });
  } catch (error) { return response({ error: String(error.message || error) }, true); }
});

await server.connect(new StdioServerTransport());
