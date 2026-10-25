export const TERMINAL_TOOLS = [
  { name: 'Claude Code', command: 'claude' },
  { name: 'Codex', command: 'codex' },
  { name: 'PyAgent', command: 'pyagent' },
  { name: 'DSH', command: 'dsh' },
] as const;

export function terminalUrl(value: string): string {
  const url = new URL(value);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('terminal_url');
  if (location.protocol === 'https:' && url.protocol !== 'wss:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('terminal_url');
  return url.href;
}

export function quoteTerminalPath(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function canApplyTerminalFile(exported: { noteId: string; base: string }, activeId: string | undefined, content: string): boolean {
  return exported.noteId === activeId && exported.base === content;
}
