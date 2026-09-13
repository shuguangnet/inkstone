import { describe, expect, it } from 'vitest';
import { parseEvernoteEnex, decodeXmlEntities } from './external-import';

describe('decodeXmlEntities', () => {
    it('decodes the guaranteed entities and numeric refs', () => {
        expect(decodeXmlEntities('&lt;b&gt; &amp; &quot;q&quot; &#65; &#x42;')).toBe('<b> & "q" A B');
    });
});

describe('parseEvernoteEnex', () => {
    const enex = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<en-export>',
        '  <note>',
        '    <title>Meeting &amp; notes</title>',
        '    <created>20260101T080000Z</created>',
        '    <en-note>',
        '      <h1>Decisions</h1>',
        '      <div>We agreed on &lt;v2&gt;</div>',
        '      <en-todo checked="true"/> done item',
        '      <en-todo/> open item',
        '      <ul><li>first</li><li>second</li></ul>',
        '      <b>bold text</b>',
        '    </en-note>',
        '  </note>',
        '  <note>',
        '    <title>Empty</title>',
        '    <en-note></en-note>',
        '  </note>',
        '</en-export>',
    ].join('\n');

    it('extracts note titles, created stamps, and converts ENML to Markdown', () => {
        const notes = parseEvernoteEnex(enex);
        expect(notes.length).toBe(1);
        const note = notes[0]!;
        expect(note.title).toBe('Meeting & notes');
        expect(note.createdAt).toBe('2026-01-01T08:00:00Z');
        expect(note.content).toContain('# Decisions');
        expect(note.content).toContain('We agreed on <v2>');
        expect(note.content).toContain('- [x] done item');
        expect(note.content).toContain('- [ ] open item');
        expect(note.content).toContain('- first');
        expect(note.content).toContain('- second');
        expect(note.content).toContain('**bold text**');
    });

    it('returns no notes when nothing has content', () => {
        expect(parseEvernoteEnex('<en-export></en-export>')).toEqual([]);
    });
});
