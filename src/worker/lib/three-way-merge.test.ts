import { describe, expect, it } from 'vitest';
import { threeWayMerge } from './three-way-merge';

describe('threeWayMerge', () => {
    const base = 'title\nalpha\nbeta\ngamma\nfooter';

    it('takes theirs when only they changed a region', () => {
        const mine = base;
        const theirs = 'title\nalpha\nBETA v2\ngamma\nfooter';
        expect(threeWayMerge(base, mine, theirs)).toEqual({ content: theirs, conflicts: 0 });
    });

    it('takes mine when only they did not change', () => {
        const mine = 'title\nalpha\nbeta\ngamma\nnew footer';
        expect(threeWayMerge(base, mine, base)).toEqual({ content: mine, conflicts: 0 });
    });

    it('merges disjoint edits from both sides', () => {
        const mine = 'title\nalpha\nbeta\ngamma\nfooter\nappended by me';
        const theirs = 'renamed by them\nalpha\nbeta\ngamma\nfooter';
        const result = threeWayMerge(base, mine, theirs);
        expect(result.conflicts).toBe(0);
        expect(result.content).toContain('renamed by them');
        expect(result.content).toContain('appended by me');
    });

    it('marks overlapping different edits as conflicts, keeping both sides', () => {
        const mine = 'title\nalpha\nMINE\ngamma\nfooter';
        const theirs = 'title\nalpha\nTHEIRS\ngamma\nfooter';
        const result = threeWayMerge(base, mine, theirs);
        expect(result.conflicts).toBe(1);
        expect(result.content).toContain('<<<<<<< current');
        expect(result.content).toContain('MINE');
        expect(result.content).toContain('=======');
        expect(result.content).toContain('THEIRS');
        expect(result.content).toContain('>>>>>>> restored');
    });

    it('returns mine untouched for identical content', () => {
        expect(threeWayMerge(base, base, base)).toEqual({ content: base, conflicts: 0 });
    });
});
