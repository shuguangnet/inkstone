export const TERMINAL_TOOLS = [
  { name: 'Claude Code', command: 'claude' },
  { name: 'Codex', command: 'codex' },
  { name: 'Pi', command: 'pi' },
  { name: 'PyAgent', command: 'pyagent' },
  { name: 'DSH', command: 'dsh' },
] as const;

export function quoteTerminalPath(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function canApplyTerminalFile(exported: { noteId: string; base: string }, activeId: string | undefined, content: string): boolean {
  return exported.noteId === activeId && exported.base === content;
}
