import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const stateDir = process.env.MIMO_BRIDGE_STATE_DIR || join(homedir(), '.local', 'state', 'codex-meets-mimo');

export function prepareStore() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
}

function taskPath(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid task ID');
  return join(stateDir, `${id}.json`);
}

export function createTask(input) {
  prepareStore();
  const now = new Date().toISOString();
  const task = {
    id: randomUUID(),
    status: 'queued',
    created_at: now,
    updated_at: now,
    workspace: input.workspace,
    baseline_commit: input.baseline_commit,
    initial_git_status: input.initial_git_status || [],
    kind: input.kind || 'write',
    selected_model: null,
    actual_model: null,
    instructions: input.instructions,
    worker_pid: null,
    mimo_session_id: null,
    session_directory: null,
    baseline_message_id: null,
    started_at_ms: null,
    event_count: 0,
    response: '',
    error: null,
    changed_files: [],
    pending_permissions: [],
    pending_questions: [],
  };
  const fd = openSync(taskPath(task.id), 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(task, null, 2)); } finally { closeSync(fd); }
  return task;
}

export function readTask(id) {
  prepareStore();
  return JSON.parse(readFileSync(taskPath(id), 'utf8'));
}

export function updateTask(id, patch) {
  const task = { ...readTask(id), ...patch, updated_at: new Date().toISOString() };
  const temp = join(stateDir, `.${id}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(task, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temp, taskPath(id));
  return task;
}

export function publicTask(task) {
  const { instructions, worker_pid, ...safe } = task;
  return safe;
}
