import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startTerminalBridge } from './local-terminal.mjs';

const origin = 'https://writing.example';
function inbox(ws) {
  const buffered = [];
  const pending = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const index = pending.findIndex((entry) => entry.type === msg.type);
    if (index < 0) buffered.push(msg);
    else { const [entry] = pending.splice(index, 1); clearTimeout(entry.timer); entry.resolve(msg); }
  });
  return (type) => {
    const index = buffered.findIndex((msg) => msg.type === type);
    if (index >= 0) return Promise.resolve(buffered.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const entry = { type, resolve, timer: setTimeout(() => reject(new Error(`Timeout: ${type}`)), 5000) };
      pending.push(entry);
    });
  };
}
async function connect(bridge, token = bridge.token) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/terminal`, { origin });
  const receive = inbox(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'auth', token }));
  return { ws, receive, send: (msg) => ws.send(JSON.stringify(msg)) };
}

test('terminal bridge: origin, token, PTY, note snapshots and file boundary', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'inkstone-terminal-'));
  const bridge = await startTerminalBridge({ origins: [origin], port: 0, workspace, shell: '/bin/bash' });
  try {
    await assert.rejects(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/terminal`, { origin: 'https://evil.example' });
      ws.once('open', () => { ws.close(); resolve(); });
      ws.once('error', reject);
    }), /403/);
    const bad = await connect(bridge, 'wrong');
    assert.equal(await new Promise((resolve) => bad.ws.once('close', resolve)), 1008);
    const { ws, receive, send } = await connect(bridge);
    await receive('ready');
    send({ type: 'input', data: "printf '\\nINKSTONE_PTY_OK\\n'\r" });
    let output = '';
    while (!output.includes('\r\nINKSTONE_PTY_OK\r\n')) output += (await receive('output')).data;
    send({ type: 'export', noteId: '../escape', content: 'bad', requestId: 'invalid' });
    assert.match((await receive('error')).message, /Invalid note/);
    send({ type: 'export', noteId: 'note1', content: '# Draft\nHello \u4e16\u754c', requestId: '1' });
    const exported = await receive('exported');
    assert.equal(exported.requestId, '1');
    assert.equal(exported.noteId, 'note1');
    send({ type: 'read', fileId: exported.fileId, requestId: '2' });
    assert.equal((await receive('file')).content, '# Draft\nHello \u4e16\u754c');
    await writeFile(exported.path, '# Revised\nUpdated');
    send({ type: 'read', fileId: exported.fileId, requestId: '3' });
    assert.equal((await receive('file')).content, '# Revised\nUpdated');
    send({ type: 'export', noteId: 'note1', content: 'Second snapshot', requestId: '4' });
    assert.notEqual((await receive('exported')).path, exported.path);
    send({ type: 'read', fileId: '/etc/passwd', requestId: '5' });
    assert.match((await receive('error')).message, /Unknown session file/);
    await rm(exported.path);
    await symlink('/etc/passwd', exported.path);
    send({ type: 'read', fileId: exported.fileId, requestId: '6' });
    assert.match((await receive('error')).message, /Symbolic links/);
    send({ type: 'export', noteId: 'note2', content: 'a'.repeat(2 * 1024 * 1024 + 1), requestId: '7' });
    assert.match((await receive('error')).message, /too large/);
    ws.close(1000);
    await new Promise((resolve) => ws.once('close', resolve));
    const next = await connect(bridge);
    await next.receive('ready');
    next.send({ type: 'read', fileId: exported.fileId, requestId: '8' });
    assert.match((await next.receive('error')).message, /Unknown session file/);
    next.ws.close(1000);
    await new Promise((resolve) => next.ws.once('close', resolve));
  } finally { await bridge.close(); await rm(workspace, { recursive: true, force: true }); }
});

test('owner session mode starts directly and fails closed for missing, rejected or expired sessions', async () => {
  const { createServer } = await import('node:http');
  let allow = true;
  let checks = 0;
  const authorizer = createServer((req, res) => {
    checks++;
    assert.equal(req.url, '/api/terminal/authorize');
    const authorized = allow && req.headers.cookie === 'session=owner';
    res.writeHead(authorized ? 200 : 403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authorized }));
  });
  await new Promise((resolve) => authorizer.listen(0, '127.0.0.1', resolve));
  const workspace = await mkdtemp(join(tmpdir(), 'inkstone-session-terminal-'));
  const bridge = await startTerminalBridge({ origins: [origin], port: 0, workspace, authorizeUrl: `http://127.0.0.1:${authorizer.address().port}/api/terminal/authorize` });
  const rejected = async (cookie, site = origin) => {
    await assert.rejects(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/terminal`, { origin: site, headers: cookie ? { Cookie: cookie } : {} });
      ws.once('open', () => { ws.terminate(); resolve(); });
      ws.once('error', reject);
    }), /401|403|503/);
  };
  try {
    await rejected();
    assert.equal(checks, 0);
    await rejected('session=owner', 'https://evil.example');
    assert.equal(checks, 0);
    await rejected('session=member');
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/terminal`, { origin, headers: { Cookie: 'session=owner' } });
    const receive = inbox(ws);
    await receive('ready');
    ws.send(JSON.stringify({ type: 'input', data: "printf '\\nSESSION_PTY_OK\\n'\r" }));
    let output = '';
    while (!output.includes('\r\nSESSION_PTY_OK\r\n')) output += (await receive('output')).data;
    ws.close(1000);
    await new Promise((resolve) => ws.once('close', resolve));
    allow = false;
    await rejected('session=owner');
    await new Promise((resolve) => authorizer.close(resolve));
    await rejected('session=owner');
  } finally {
    await bridge.close();
    if (authorizer.listening) await new Promise((resolve) => authorizer.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
});

test('shell can run Node CLI tools when the inherited PATH omits the runtime', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'inkstone-runtime-path-'));
  const bridge = await startTerminalBridge({ origins: [origin], port: 0, workspace, shell: '/bin/sh' });
  const inheritedPath = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent';
    const { ws, receive, send } = await connect(bridge);
    await receive('ready');
    process.env.PATH = inheritedPath;
    send({ type: 'input', data: "node -p 'process.version'\r" });
    let output = '';
    while (!output.includes(process.version)) output += (await receive('output')).data;
    assert.doesNotMatch(output, /not found/);
    ws.close(1000);
    await new Promise((resolve) => ws.once('close', resolve));
  } finally {
    process.env.PATH = inheritedPath;
    await bridge.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
