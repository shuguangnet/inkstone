import { describe, expect, it } from 'vitest';
import { countText, deriveExcerpt, extractTags } from './markdown-utils';

const bigBody = [
    '# Performance fixture',
    '',
    '- [ ] task one #perf',
    'some prose with `code` and a [link](https://example.com) plus #tags sprinkled #in',
    '```ts',
    'const x = 1',
    '```',
    '',
].join('\n').repeat(40);

describe('markdown derived-field performance (per note write)', () => {
    it('derives excerpt, counts, and tags for a large note quickly', () => {
        const start = performance.now();
        for (let index = 0; index < 50; index++) {
            expect(deriveExcerpt(bigBody).length).toBeGreaterThan(0);
            expect(countText(bigBody).words).toBeGreaterThan(0);
            expect(extractTags(bigBody).length).toBeGreaterThan(0);
        }
        const elapsed = performance.now() - start;
        // 50 large notes: generous CI-stable ceiling for a real regression signal.
        expect(elapsed).toBeLessThan(2_000);
    });

    it('handles 10k summaries worth of aggregate derivation well under a second', () => {
        const start = performance.now();
        let words = 0;
        for (let index = 0; index < 10_000; index++) {
            words += countText(bigBody.slice(0, 400)).words;
        }
        const elapsed = performance.now() - start;
        expect(words).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(1_000);
    });
});
