import { describe, expect, it } from 'vitest';
import { buildChatMessages } from './prompts';

describe('buildChatMessages', () => {
  it('wraps note content in data delimiters and adds the action instruction', () => {
    const messages = buildChatMessages({
      action: 'polish',
      noteTitle: 'My note',
      noteContent: 'some text',
    });
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('strictly as data');
    const noteMessage = messages.find((message) => message.content.includes('<note title="My note">'));
    expect(noteMessage).toBeDefined();
    expect(messages.some((message) => message.content.includes('Polish the selected prose'))).toBe(true);
  });

  it('passes selections as delimited data and bounds history', () => {
    const messages = buildChatMessages({
      action: 'explain',
      selection: 'selected text',
      history: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `m${index}`,
      })),
    });
    expect(messages.some((message) => message.content.includes('<selection>'))).toBe(true);
    const historyMessages = messages.filter((message) => message.content.startsWith('m'));
    expect(historyMessages.length).toBeLessThanOrEqual(12);
  });
});
