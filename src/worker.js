import { spawn, execFileSync } from 'node:child_process';
import { readTask, updateTask } from './store.js';

const id = process.argv[2];
const task = readTask(id);
let mimo;
let stopped = false;
const prompt = `${task.instructions}\n\nBridge boundary: work only inside the provided workspace. Do not commit, push, publish, deploy, install an app, change permissions, or access credentials. End with a concise list of changed files, checks run, and any blockers.`;

function git(args) {
  try { return execFileSync('git', args, { cwd: task.workspace, encoding: 'utf8', timeout: 10000 }).trim(); }
  catch { return ''; }
}

function finish(status, extra = {}) {
  const changes = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean);
  updateTask(id, { status, changed_files: changes, ...extra });
}

process.on('SIGTERM', () => {
  stopped = true;
  if (mimo && !mimo.killed) mimo.kill('SIGTERM');
});

try {
  updateTask(id, { status: 'running', worker_pid: process.pid });
  mimo = spawn(process.env.MIMO_BRIDGE_MIMO_BIN || 'mimo', ['run', '--format', 'json', '--dir', task.workspace, prompt], {
    cwd: task.workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  let buffer = '';
  let stderr = '';
  let eventCount = 0;
  let response = '';
  let error = null;
  let sessionID = null;
  const consume = (line) => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { error = 'MiMo emitted non-JSON output'; return; }
    eventCount++;
    sessionID ||= event.sessionID || null;
    if (event.type === 'error') error = String(event.error?.data?.message || event.error?.message || 'MiMo reported an error').slice(0, 500);
    if (event.type === 'text') response += String(event.part?.text || event.text || '');
    if (response.length > 30000) response = response.slice(-30000);
    if (eventCount % 20 === 0) updateTask(id, { event_count: eventCount, mimo_session_id: sessionID, response });
  };
  mimo.stdout.setEncoding('utf8');
  mimo.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      consume(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  });
  mimo.stderr.setEncoding('utf8');
  mimo.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  mimo.on('error', (e) => { error = `MiMo process could not start: ${e.message}`; });
  mimo.on('close', (code, signal) => {
    if (buffer) consume(buffer);
    const extra = { event_count: eventCount, mimo_session_id: sessionID, response, exit_code: code, signal };
    if (stopped) finish('cancelled', extra);
    else if (error || code !== 0) finish('failed', { ...extra, error: error || stderr.slice(0, 500) || `MiMo exited ${code}` });
    else finish('completed', extra);
  });
} catch (e) {
  finish('failed', { error: String(e?.message || e).slice(0, 500) });
}
