import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';

const MAX_FILE = 2 * 1024 * 1024;
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);

export async function startTerminalBridge({ origins, port = 31789, workspace = join(homedir(), '.inkstone', 'writing'), token = randomBytes(32).toString('hex'), authorizeUrl, shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash') }) {
  if (!origins?.length || origins.some((origin) => new URL(origin).origin !== origin)) throw new Error('Specify explicit --origin values (scheme and host only)');
  if (authorizeUrl) {
    const url = new URL(authorizeUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/api/terminal/authorize' || url.username || url.password || url.search || url.hash) throw new Error('Authorization URL must point to the local Inkstone /api/terminal/authorize endpoint');
  }
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const root = await realpath(workspace);
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FILE + 65536, perMessageDeflate: false });
  let pendingUpgrades = 0;
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    const reject = (status) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
    if (!origins.includes(req.headers.origin) || req.url !== '/terminal' || wss.clients.size + pendingUpgrades >= 4) {
      reject('403 Forbidden');
      return;
    }
    pendingUpgrades++;
    try {
      if (authorizeUrl) {
        if (!req.headers.cookie) { reject('401 Unauthorized'); return; }
        const response = await fetch(authorizeUrl, { headers: { Cookie: req.headers.cookie }, redirect: 'manual', signal: AbortSignal.timeout(4000) });
        const allowed = response.ok && (await response.json()).authorized === true;
        if (!allowed) { reject('403 Forbidden'); return; }
      }
      if (!socket.destroyed) wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
    } catch { reject('503 Service Unavailable'); }
    finally { pendingUpgrades--; }
  });
  wss.on('connection', (ws) => {
    let authenticated = false;
    let terminal;
    const files = new Map();
    const send = (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
    const timeout = setTimeout(() => ws.close(1008, 'Authentication timeout'), 5000);
    const heartbeat = setInterval(() => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    }, 30000);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const close = () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      terminal?.kill();
      terminal = undefined;
    };
    ws.on('close', close);
    ws.on('error', close);
    const startShell = () => {
      authenticated = true;
      clearTimeout(timeout);
      terminal = pty.spawn(shell, [], { name: 'xterm-256color', cols: 100, rows: 24, cwd: root, env: { ...process.env, TERM: 'xterm-256color' } });
      terminal.onData((data) => {
        if (ws.bufferedAmount > 4 * MAX_FILE) { ws.close(1009, 'Output overflow'); return; }
        send({ type: 'output', data });
      });
      terminal.onExit(({ exitCode }) => { send({ type: 'exit', exitCode }); ws.close(1000); });
      send({ type: 'ready' });
    };
    if (authorizeUrl) {
      try { startShell(); }
      catch { send({ type: 'error', message: 'Could not start server shell' }); ws.close(1011); }
    }
    let queue = Promise.resolve();
    ws.on('message', (raw) => {
      queue = queue.then(async () => {
        const msg = JSON.parse(raw.toString());
        if (!authenticated) {
          const candidate = Buffer.from(typeof msg.token === 'string' ? msg.token : '');
          const secret = Buffer.from(token);
          if (msg.type !== 'auth' || candidate.length !== secret.length || !timingSafeEqual(candidate, secret)) {
            ws.close(1008, 'Invalid pairing token');
            return;
          }
          authenticated = true;
          clearTimeout(timeout);
          startShell();
          return;
        }
        if (msg.type === 'input' && typeof msg.data === 'string' && msg.data.length <= 65536) terminal?.write(msg.data);
        else if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) terminal?.resize(Math.max(2, Math.min(400, msg.cols)), Math.max(2, Math.min(150, msg.rows)));
        else if (msg.type === 'export') {
          if (!validId(msg.noteId) || typeof msg.content !== 'string' || Buffer.byteLength(msg.content) > MAX_FILE) throw new Error('Invalid note or file too large (2 MiB maximum)');
          if (files.size >= 100) throw new Error('Session export limit reached; reconnect');
          const path = join(root, `${msg.noteId}-${randomUUID()}.md`);
          const file = await open(path, 'wx', 0o600);
          try { await file.writeFile(msg.content, 'utf8'); } finally { await file.close(); }
          const fileId = randomUUID();
          files.set(fileId, { path, noteId: msg.noteId });
          send({ type: 'exported', requestId: msg.requestId, fileId, path, noteId: msg.noteId });
        } else if (msg.type === 'read') {
          const entry = files.get(msg.fileId);
          if (!entry) throw new Error('Unknown session file');
          const actual = await realpath(entry.path);
          if (actual !== entry.path) throw new Error('Symbolic links are not allowed');
          const file = await open(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
          try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Invalid file or file too large (2 MiB maximum)');
            const buffer = Buffer.alloc(MAX_FILE + 1);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
            if (bytesRead > MAX_FILE) throw new Error('File too large');
            send({ type: 'file', requestId: msg.requestId, fileId: msg.fileId, noteId: entry.noteId, content: buffer.subarray(0, bytesRead).toString('utf8') });
          } finally { await file.close(); }
        }
      }).catch((error) => {
        send({ type: 'error', message: error instanceof SyntaxError ? 'Invalid message' : error.message });
      });
    });
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  return { server, token, port: server.address().port, close: async () => {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise((accept) => server.close(accept));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const values = (key) => args.flatMap((arg, index) => arg === key ? [args[index + 1]] : []);
  const authorizeUrl = values('--authorize-url')[0] || 'http://127.0.0.1:7712/api/terminal/authorize';
  try {
    const bridge = await startTerminalBridge({ origins: values('--origin'), port: Number(values('--port')[0] || 31789), workspace: values('--workspace')[0], authorizeUrl });
    console.log(`Inkstone terminal: ws://127.0.0.1:${bridge.port}/terminal\nAuthentication: Inkstone owner session\nAllowed sites: ${values('--origin').join(', ')}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void bridge.close().then(() => process.exit()); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
