import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const defaultSocket = join(homedir(), '.local', 'state', 'xiaomi-mimo-codex-bridge', 'desktop.sock');

export function desktopRequest(request, timeoutMs = 10000) {
  const path = process.env.MIMO_BRIDGE_DESKTOP_SOCKET || defaultSocket;
  return new Promise((resolve, reject) => {
    const socket = net.connect(path);
    let output = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error('MiMo Desktop bridge timed out')));
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > 2_000_000) return fail(new Error('MiMo Desktop bridge response is too large'));
      const end = output.indexOf('\n');
      if (end < 0 || settled) return;
      try {
        const response = JSON.parse(output.slice(0, end));
        if (!response.ok) throw new Error(String(response.error || 'MiMo Desktop bridge rejected request'));
        settled = true;
        socket.end();
        resolve(response);
      } catch (error) { fail(error); }
    });
    socket.once('error', fail);
    socket.once('end', () => { if (!settled) fail(new Error('MiMo Desktop bridge closed without a response')); });
  });
}
