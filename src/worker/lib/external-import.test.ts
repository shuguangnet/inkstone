import { describe, expect, it } from 'vitest';
import {
    decodeXmlEntities,
    isNotionExportEntry,
    parseEvernoteEnex,
    rewriteNotionLinks,
    stripNotionIdentifiers,
} from './external-import';

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

describe('Notion export helpers', () => {
    it('detects Notion identifier suffixes', () => {
        expect(isNotionExportEntry('Meeting notes ab12cd34ab12cd34ab12cd34ab12cd34.md')).toBe(true);
        expect(isNotionExportEntry('notes/My page 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d/image.png')).toBe(true);
        expect(isNotionExportEntry('notes/plain.md')).toBe(false);
        expect(isNotionExportEntry('notes/data.csv')).toBe(false);
    });

    it('strips identifiers from all segments and records renames', () => {
        const cleaned = stripNotionIdentifiers(
            'Projects/Team meeting 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d/Team meeting 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d.md',
        );
        expect(cleaned.path).toBe('Projects/Team meeting/Team meeting.md');
        expect(cleaned.renames.length).toBe(2);
    });

    it('leaves non-Notion paths untouched', () => {
        const cleaned = stripNotionIdentifiers('notes/plain.md');
        expect(cleaned.path).toBe('notes/plain.md');
        expect(cleaned.renames).toEqual([]);
    });

    it('rewrites links in note bodies to the cleaned paths', () => {
        const rewritten = rewriteNotionLinks(
            '[link](Team%20meeting%200a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d/Team%20meeting%200a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d.md) and ![img](Team%20meeting%200a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d/img.png)',
            [
                {
                    from: 'Team meeting 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
                    to: 'Team meeting',
                },
            ],
        );
        expect(rewritten).toContain('(Team meeting/Team meeting.md)');
        expect(rewritten).toContain('(Team meeting/img.png)');
    });
});
