/** Minimal line-level LCS diff for AI rewrite previews. */

export type DiffLineKind = 'same' | 'added' | 'removed'

export interface DiffLine {
    readonly kind: DiffLineKind;
    readonly text: string;
}

export function diffLines(before: string, after: string): DiffLine[] {
    const left = before.split('\n');
    const right = after.split('\n');
    const rows = left.length;
    const columns = right.length;
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
    for (let row = rows - 1; row >= 0; row--) {
        for (let column = columns - 1; column >= 0; column--) {
            table[row]![column] = left[row] === right[column]
                ? table[row + 1]![column + 1]! + 1
                : Math.max(table[row + 1]![column]!, table[row]![column + 1]!);
        }
    }
    const result: DiffLine[] = [];
    let row = 0;
    let column = 0;
    while (row < rows && column < columns) {
        if (left[row] === right[column]) {
            result.push({ kind: 'same', text: left[row]! });
            row++;
            column++;
        } else if (table[row + 1]![column]! >= table[row]![column + 1]!) {
            result.push({ kind: 'removed', text: left[row]! });
            row++;
        } else {
            result.push({ kind: 'added', text: right[column]! });
            column++;
        }
    }
    while (row < rows) {
        result.push({ kind: 'removed', text: left[row]! });
        row++;
    }
    while (column < columns) {
        result.push({ kind: 'added', text: right[column]! });
        column++;
    }
    return result;
}
