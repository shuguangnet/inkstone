import { describe, expect, it } from 'vitest';
import { canApplyTerminalFile, quoteTerminalPath } from './terminal';

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
});
