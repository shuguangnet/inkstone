import { describe, expect, it } from 'vitest';
import { canApplyTerminalFile, quoteTerminalPath, terminalUrl } from './terminal';

describe('terminal integration', () => {
  it('quotes file paths without evaluating shell characters', () => {
    expect(quoteTerminalPath("/draft/it's $(whoami).md")).toBe("'/draft/it'\\''s $(whoami).md'");
  });
  it('prevents overwriting newer editor text or a different note', () => {
    const exported = { noteId: 'a', base: 'draft' };
    expect(canApplyTerminalFile(exported, 'a', 'draft')).toBe(true);
    expect(canApplyTerminalFile(exported, 'a', 'new edits')).toBe(false);
    expect(canApplyTerminalFile(exported, 'b', 'draft')).toBe(false);
    expect(canApplyTerminalFile(exported, undefined, 'draft')).toBe(false);
  });
  it('rejects non-WebSocket URLs and credentials', () => {
    expect(terminalUrl('wss://notes.example/writing-terminal/terminal')).toBe('wss://notes.example/writing-terminal/terminal');
    for (const value of ['https://notes.example', 'javascript:alert(1)', 'wss://user:secret@notes.example', 'wss://notes.example/?token=secret']) {
      expect(() => terminalUrl(value)).toThrow();
    }
  });
});
