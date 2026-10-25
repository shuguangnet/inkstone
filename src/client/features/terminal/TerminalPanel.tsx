import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button } from '../../components/primitives';
import { useActiveNote, useNotes } from '../../store/notes';
import { t, useLocale } from '../../lib/i18n';
import { diffLines } from '../../lib/ai-diff';
import { canApplyTerminalFile, quoteTerminalPath, TERMINAL_TOOLS } from '../../lib/terminal';

import { TerminalWindow } from './TerminalWindow';

type Exported = { noteId: string; base: string; fileId: string; path: string };

export function TerminalPanel() {
  useLocale();
  const { note, content, loaded } = useActiveNote();
  const [status, setStatus] = useState<'offline' | 'connecting' | 'ready'>('connecting');
  const [error, setError] = useState('');
  const [command, setCommand] = useState<string>('codex');
  const [exported, setExported] = useState<Exported | null>(null);
  const [incoming, setIncoming] = useState<{ fileId: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const connectionRun = useRef(0);
  const connectionAbort = useRef<AbortController | null>(null);
  const request = useRef<{ id: string; noteId: string; base: string; type: 'export' | 'read' } | null>(null);
  const snapshot = useRef(exported);
  snapshot.current = exported;
  const current = useRef({ note, content });
  current.current = { note, content };

  useEffect(() => {
    setIncoming(null);
    setExported(null);
    request.current = null;
    setBusy(false);
  }, [note?.id]);

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000, theme: { background: '#151820', foreground: '#e2e8f0' } });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(host.current);
    terminal.current = term;
    fit.current = addon;
    const resize = () => {
      addon.fit();
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    const input = term.onData((data) => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'input', data }));
    });
    return () => { socket.current?.close(); observer.disconnect(); input.dispose(); term.dispose(); };
  }, []);

  const send = (message: object) => {
    if (socket.current?.readyState !== WebSocket.OPEN || status !== 'ready') return false;
    socket.current.send(JSON.stringify(message));
    return true;
  };
  const connect = useCallback(async () => {
    const attempt = ++connectionRun.current;
    connectionAbort.current?.abort();
    socket.current?.close(1000);
    socket.current = null;
    const controller = new AbortController();
    connectionAbort.current = controller;
    setStatus('connecting');
    setError('');
    setExported(null);
    setIncoming(null);
    setBusy(false);
    request.current = null;
    terminal.current?.reset();
    const authorizationTimeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/terminal/authorize', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (attempt !== connectionRun.current) return;
      if (!response.ok || (await response.json()).authorized !== true) {
        setStatus('offline');
        setError(t(response.status === 401 ? 'terminal.sign_in' : response.status === 403 ? 'terminal.owner_only' : 'terminal.unavailable'));
        return;
      }
    } catch {
      if (attempt === connectionRun.current) { setStatus('offline'); setError(t('terminal.unavailable')); }
      return;
    } finally { window.clearTimeout(authorizationTimeout); }
    if (attempt !== connectionRun.current) return;
    const address = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/writing-terminal/terminal`;
    let ws: WebSocket;
    try { ws = new WebSocket(address); } catch { setStatus('offline'); setError(t('terminal.unavailable')); return; }
    socket.current = ws;
    const timer = window.setTimeout(() => {
      if (attempt !== connectionRun.current) return;
      ws.close();
      setError(t('terminal.connect_error'));
    }, 8000);
    ws.onmessage = (event) => {
      if (attempt !== connectionRun.current) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'ready') {
        window.clearTimeout(timer);
        setStatus('ready');
        fit.current?.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.current?.cols || 100, rows: terminal.current?.rows || 24 }));
        terminal.current?.focus();
      } else if (msg.type === 'output') terminal.current?.write(msg.data);
      else if (msg.type === 'error') {
        setError(msg.message);
        setBusy(false);
        request.current = null;
      } else if (msg.type === 'exported' || msg.type === 'file') {
        const pending = request.current;
        if (!pending || pending.id !== msg.requestId || pending.noteId !== current.current.note?.id) return;
        request.current = null;
        setBusy(false);
        if (msg.type === 'exported' && pending.type === 'export') setExported({ noteId: pending.noteId, base: pending.base, path: msg.path, fileId: msg.fileId });
        else if (msg.type === 'file' && msg.fileId === snapshot.current?.fileId) setIncoming({ fileId: msg.fileId, content: msg.content });
      }
    };
    ws.onerror = () => { if (attempt === connectionRun.current) setError(t('terminal.connect_error')); };
    ws.onclose = (event) => {
      window.clearTimeout(timer);
      if (socket.current !== ws) return;
      socket.current = null;
      setStatus('offline');
      setBusy(false);
      request.current = null;
      setExported(null);
      setIncoming(null);
      if (event.code !== 1000) setError(t('terminal.connect_error'));
    };
  }, []);
  useEffect(() => {
    void connect();
    return () => {
      connectionRun.current++;
      connectionAbort.current?.abort();
      socket.current?.close(1000);
      socket.current = null;
    };
  }, [connect]);
  const disconnect = () => {
    connectionRun.current++;
    connectionAbort.current?.abort();
    socket.current?.close(1000);
    socket.current = null;
    setStatus('offline');
    setBusy(false);
    setExported(null);
    setIncoming(null);
    request.current = null;
    setError('');
  };
  const exportCurrent = () => {
    if (!note || !loaded) return;
    const id = crypto.randomUUID();
    request.current = { id, noteId: note.id, base: content, type: 'export' };
    if (send({ type: 'export', requestId: id, noteId: note.id, content })) { setBusy(true); setIncoming(null); }
  };
  const readFile = () => {
    if (!exported) return;
    const id = crypto.randomUUID();
    request.current = { id, noteId: exported.noteId, base: exported.base, type: 'read' };
    if (send({ type: 'read', fileId: exported.fileId, requestId: id })) setBusy(true);
  };
  const writeInput = (data: string) => {
    if (send({ type: 'input', data })) terminal.current?.focus();
  };
  const canApply = exported && incoming && incoming.fileId === exported.fileId && canApplyTerminalFile(exported, note?.id, content);
  const previewLines = useMemo(() => {
    if (!exported || !incoming) return [];
    if ((exported.base.split('\n').length * incoming.content.split('\n').length) > 500000 || exported.base.length + incoming.content.length > 200000) return null;
    return diffLines(exported.base, incoming.content);
  }, [exported, incoming]);
  const inputClass = 'min-w-0 rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 text-xs';
  return <TerminalWindow header={<>
      <strong className="text-xs">{t('terminal.title')}</strong>
      <span role="status" className="text-xs text-[var(--text-tertiary)]">{t(`terminal.${status}`)}</span>
      {status !== 'offline' && <Button size="sm" onClick={disconnect}>{t('terminal.disconnect')}</Button>}
    </>}>
    {status === 'offline' && <div className="flex items-center gap-2 px-3 pb-2">
      <Button size="sm" onClick={() => void connect()}>{t('terminal.wake')}</Button>
    </div>}
    {status === 'ready' && <div className="flex flex-wrap gap-2 px-3 pb-2">
      <Button size="sm" disabled={!note || !loaded || busy} onClick={exportCurrent}>{t('terminal.export')}</Button>
      <select aria-label={t('terminal.tool')} className={inputClass} onChange={(event) => setCommand(event.target.value)} defaultValue="codex">
        {TERMINAL_TOOLS.map((tool) => <option key={tool.name} value={tool.command}>{tool.name}</option>)}
      </select>
      <input aria-label={t('terminal.command')} className={`${inputClass} w-28`} value={command} onChange={(event) => setCommand(event.target.value)}/>
      <Button size="sm" disabled={!command.trim() || /[\r\n\x00-\x1f\x7f]/.test(command)} onClick={() => writeInput(command + '\r')}>{t('terminal.launch')}</Button>
      <Button size="sm" disabled={!exported} onClick={() => exported && writeInput(quoteTerminalPath(exported.path))}>{t('terminal.reference')}</Button>
      <Button size="sm" disabled={!exported || busy} onClick={readFile}>{t('terminal.read')}</Button>
      {exported && <span className="w-full truncate text-xs text-[var(--text-tertiary)]" title={exported.path}>{exported.path}</span>}
    </div>}
    {error && <p role="alert" className="px-3 pb-1 text-xs text-[var(--danger)]">{error}</p>}
    <div className="flex min-h-0 flex-1">
      <div ref={host} className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#151820] p-2"/>
      {incoming && exported && <div className="flex w-1/2 min-w-0 flex-col border-l border-[var(--border-subtle)] p-2">
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <Button size="sm" disabled={!canApply || incoming.content === content} onClick={() => {
            const active = current.current;
            if (!canApplyTerminalFile(exported, active.note?.id, active.content)) return;
            useNotes.getState().editContent(exported.noteId, incoming.content);
            setExported({ ...exported, base: incoming.content });
            setIncoming(null);
          }}>{t('terminal.apply')}</Button>
          <Button size="sm" onClick={() => setIncoming(null)}>{t('terminal.dismiss')}</Button>
        </div>
        {previewLines === null && <p className="pb-2 text-xs text-[var(--text-tertiary)]">{t('terminal.large_preview')}</p>}
        {!canApply && <p role="alert" className="pb-2 text-xs text-[var(--danger)]">{t('terminal.conflict')}</p>}
        <pre className="min-h-0 flex-1 overflow-auto text-xs whitespace-pre-wrap break-words">{previewLines === null ? incoming.content.slice(0, 200000) : previewLines.map((line, index) => <div key={index} className={line.kind === 'added' ? 'bg-green-500/15' : line.kind === 'removed' ? 'bg-red-500/15 line-through' : ''}>{line.text || ' '}</div>)}</pre>
      </div>}
    </div>
  </TerminalWindow>;
}
