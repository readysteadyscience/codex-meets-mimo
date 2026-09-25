import net from 'node:net';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const stateDir = join(homedir(), '.local', 'state', 'xiaomi-mimo-codex-bridge');
const socketPath = process.env.MIMO_BRIDGE_DESKTOP_SOCKET || join(stateDir, 'desktop.sock');
const singleton = Symbol.for('xiaomi-mimo-codex-bridge.desktop-listener');
const pending = new Map();

async function selectedDesktopModel(client) {
  let modelID;
  try {
    const preferences = JSON.parse(readFileSync(join(homedir(), 'Library', 'Application Support', 'Xiaomi MiMo', 'preferences.json'), 'utf8'));
    modelID = preferences.model;
  } catch { throw new Error('MiMo Desktop model selection could not be read'); }
  if (typeof modelID !== 'string' || !modelID.trim()) throw new Error('Select a model in MiMo Desktop before delegation');
  const providers = unwrap(await client.config.providers());
  const desktop = (providers?.providers || []).find((provider) => provider.id === 'mimo-desktop');
  if (!desktop?.models || !Object.hasOwn(desktop.models, modelID)) {
    throw new Error(`The MiMo Desktop selected model is unavailable through the Desktop membership provider: ${modelID}`);
  }
  return { providerID: desktop.id, modelID };
}

function unwrap(result) {
  if (result?.error) throw new Error(String(result.error?.message || result.error));
  return result?.data;
}

async function selectedSession(client) {
  const saved = JSON.parse(readFileSync(join(homedir(), 'Library', 'Application Support', 'Xiaomi MiMo', 'composer-input.json'), 'utf8'));
  const id = saved?.currentKey;
  if (typeof id !== 'string' || !/^ses_[A-Za-z0-9]+$/.test(id)) {
    throw new Error('Select an existing MiMo conversation before delegation');
  }
  const hintedDirectory = saved?.convoMeta?.[id]?.directory;
  const query = typeof hintedDirectory === 'string' && hintedDirectory.startsWith('/')
    ? { directory: hintedDirectory } : undefined;
  const session = unwrap(await client.session.get({ path: { id }, query }));
  if (session?.id !== id || typeof session.directory !== 'string') {
    throw new Error('The selected MiMo conversation is unavailable');
  }
  return session;
}

function reply(socket, value) {
  socket.end(`${JSON.stringify(value)}\n`);
}

async function pendingFor(client, sessionID, directory) {
  try {
    const result = unwrap(await client._client.get({ url: '/permission', query: directory ? { directory } : undefined }));
    if (Array.isArray(result)) return result.filter((request) => request.sessionID === sessionID);
  } catch {}
  return [...pending.values()].filter((request) => request.sessionID === sessionID);
}

async function questionsFor(client, sessionID, directory) {
  const result = unwrap(await client._client.get({ url: '/question', query: directory ? { directory } : undefined }));
  return Array.isArray(result) ? result.filter((request) => request.sessionID === sessionID) : [];
}

async function handle(client, input) {
  if (input?.op === 'ping') return { ok: true, surface: 'MiMo Desktop plugin' };
  if (input?.op === 'skills') {
    const skills = unwrap(await client._client.get({ url: '/skill' }));
    return { ok: true, names: Array.isArray(skills) ? skills.map((skill) => skill.name) : [] };
  }
  if (input?.op === 'selected') {
    const session = await selectedSession(client);
    return { ok: true, session_id: session.id, directory: session.directory, title: session.title };
  }
  if (input?.op === 'dispatch') {
    const directory = input.directory;
    const prompt = input.prompt;
    if ((directory != null && (typeof directory !== 'string' || !directory.startsWith('/'))) || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Invalid directory or prompt');
    }
    const session = await selectedSession(client);
    const query = { directory: session.directory };
    const model = await selectedDesktopModel(client);
    const prior = unwrap(await client.session.messages({ path: { id: session.id }, query: { ...query, limit: 20 } })) || [];
    const baselineMessageID = prior.at(-1)?.info?.id || null;
    const startedAt = Date.now();
    unwrap(await client.session.promptAsync({
      path: { id: session.id }, query,
      body: { model, parts: [{ type: 'text', text: prompt }] },
    }));
    return { ok: true, session_id: session.id, session_directory: session.directory,
      baseline_message_id: baselineMessageID, started_at_ms: startedAt, selected_model: model };
  }
  if (input?.op === 'status') {
    if (typeof input.session_id !== 'string') throw new Error('Invalid status request');
    const query = input.directory ? { directory: input.directory } : undefined;
    const [statuses, messages] = await Promise.all([
      client.session.status({ query }),
      client.session.messages({ path: { id: input.session_id }, query: { ...query, limit: 20 } }),
    ]);
    return { ok: true, status: unwrap(statuses)?.[input.session_id] || null, messages: unwrap(messages) || [] };
  }
  if (input?.op === 'pending') {
    if (typeof input.session_id !== 'string') throw new Error('Invalid session ID');
    return { ok: true, requests: await pendingFor(client, input.session_id, input.directory) };
  }
  if (input?.op === 'questions') {
    if (typeof input.session_id !== 'string') throw new Error('Invalid session ID');
    return { ok: true, requests: await questionsFor(client, input.session_id, input.directory) };
  }
  if (input?.op === 'answer') {
    const request = (await questionsFor(client, input.session_id, input.directory)).find((item) => item.id === input.question_id);
    if (!request) throw new Error('Question is not pending for this session');
    if (!Array.isArray(input.answers) || input.answers.length !== request.questions.length || !input.answers.every((answer) => Array.isArray(answer) && answer.every((item) => typeof item === 'string'))) {
      throw new Error('Provide one answer array for each pending question');
    }
    unwrap(await client._client.post({
      url: '/question/{requestID}/reply', path: { requestID: request.id },
      query: input.directory ? { directory: input.directory } : undefined,
      body: { answers: input.answers },
    }));
    return { ok: true, question_id: request.id };
  }
  if (input?.op === 'reply') {
    const request = (await pendingFor(client, input.session_id, input.directory)).find((item) => item.id === input.permission_id);
    if (!request) throw new Error('Permission request is not pending for this session');
    if (!['once', 'reject'].includes(input.response)) throw new Error('Only once or reject is allowed');
    unwrap(await client._client.post({
      url: '/permission/{requestID}/reply', path: { requestID: request.id },
      query: input.directory ? { directory: input.directory } : undefined, body: { reply: input.response },
    }));
    pending.delete(request.id);
    return { ok: true, permission_id: request.id, response: input.response };
  }
  if (input?.op === 'abort') {
    if (typeof input.session_id !== 'string') throw new Error('Invalid abort request');
    unwrap(await client.session.abort({ path: { id: input.session_id }, query: input.directory ? { directory: input.directory } : undefined }));
    return { ok: true };
  }
  throw new Error('Unknown operation');
}

export const server = async ({ client }) => {
  if (globalThis[singleton]) return {};
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  if (existsSync(socketPath)) {
    if (!lstatSync(socketPath).isSocket()) throw new Error('Bridge socket path is occupied by a non-socket file');
    const active = await new Promise((resolve) => {
      const probe = net.connect(socketPath);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', (error) => resolve(error.code !== 'ECONNREFUSED' ? error : false));
    });
    if (active) throw new Error(`Bridge socket already exists: ${String(active?.message || 'live listener')}`);
    unlinkSync(socketPath);
  }
  const listener = net.createServer((socket) => {
    socket.setTimeout(10000, () => socket.destroy());
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      if (data.length > 40000) return socket.destroy();
      const end = data.indexOf('\n');
      if (end < 0) return;
      socket.pause();
      try {
        const input = JSON.parse(data.slice(0, end));
        void handle(client, input).then((value) => reply(socket, value), (error) => reply(socket, { ok: false, error: String(error?.message || error) }));
      } catch (error) { reply(socket, { ok: false, error: String(error?.message || error) }); }
    });
  });
  listener.listen(socketPath, () => chmodSync(socketPath, 0o600));
  process.once('exit', () => {
    try { if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath); } catch {}
  });
  globalThis[singleton] = listener;
  return {
    event: async ({ event }) => {
      if (['permission.updated', 'permission.asked'].includes(event.type) && event.properties?.id) pending.set(event.properties.id, event.properties);
      if (event.type === 'permission.replied' && event.properties?.permissionID) pending.delete(event.properties.permissionID);
    },
  };
};
