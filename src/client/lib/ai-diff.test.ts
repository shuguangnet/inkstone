import { describe, expect, it } from 'vitest';
import { diffLines } from './ai-diff';

describe('diffLines', () => {
  it('marks structure-only keep as same and changed prose as add/remove pairs', () => {
    const result = diffLines('# Title\n\nold sentence here\n', '# Title\n\nbetter sentence here\n');
    expect(result.some((line) => line.kind === 'same' && line.text === '# Title')).toBe(true);
    expect(result.filter((line) => line.kind === 'removed').map((line) => line.text)).toContain('old sentence here');
    expect(result.filter((line) => line.kind === 'added').map((line) => line.text)).toContain('better sentence here');
  });

  it('returns identical input as all-same lines', () => {
    const result = diffLines('a\nb', 'a\nb');
    expect(result.every((line) => line.kind === 'same')).toBe(true);
  });

  it('handles pure additions', () => {
    const result = diffLines('a', 'a\nb');
    expect(result.filter((line) => line.kind === 'added').map((line) => line.text)).toEqual(['b']);
  });
});
