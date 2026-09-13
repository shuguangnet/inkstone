/** Line-level three-way merge for note restore. Each side is diffed against
 * the common base with LCS; per-base-line edits (replacement, deletion, or
 * insertion) from only one side win, identical edits merge cleanly, and
 * conflicting runs keep both versions with markers. */

export interface MergeResult {
    readonly content: string
    readonly conflicts: number
}

/** Per base line: null = unchanged; otherwise the replacement lines
 * (deletion = empty array). Insertions attach before the next base line. */
function editsAgainst(base: readonly string[], other: readonly string[]): Array<string[] | null> {
    const rows = base.length
    const columns = other.length
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0))
    for (let row = rows - 1; row >= 0; row--) {
        for (let column = columns - 1; column >= 0; column--) {
            table[row]![column] = base[row] === other[column]
                ? table[row + 1]![column + 1]! + 1
                : Math.max(table[row + 1]![column]!, table[row]![column + 1]!)
        }
    }
    const edits: Array<string[] | null> = new Array(rows + 1).fill(null)
    let pending: string[] = []
    const flushInto = (index: number) => {
        if (pending.length > 0) edits[index] = pending
        pending = []
    }
    let row = 0
    let column = 0
    while (row < rows && column < columns) {
        if (base[row] === other[column] && table[row]![column] === table[row + 1]![column + 1]! + 1) {
            flushInto(row)
            row++
            column++
            continue
        }
        if (table[row + 1]![column]! >= table[row]![column + 1]!) {
            // base line deleted (or replaced by lines already in pending)
            flushInto(row)
            if (edits[row] === null) edits[row] = []
            row++
            continue
        }
        pending.push(other[column]!)
        column++
    }
    while (row < rows) {
        flushInto(row)
        if (edits[row] === null) edits[row] = []
        row++
    }
    while (column < columns) {
        pending.push(other[column]!)
        column++
    }
    flushInto(rows)
    return edits
}

export function threeWayMerge(base: string, mine: string, theirs: string): MergeResult {
    if (mine === theirs) return { content: mine, conflicts: 0 }
    if (base === mine) return { content: theirs, conflicts: 0 }
    if (base === theirs) return { content: mine, conflicts: 0 }

    const baseLines = base.split('\n')
    const mineEdits = editsAgainst(baseLines, mine.split('\n'))
    const theirEdits = editsAgainst(baseLines, theirs.split('\n'))

    const output: string[] = []
    let conflicts = 0
    const total = baseLines.length + 1
    let index = 0
    while (index < total) {
        const mineEdit = mineEdits[index] ?? null
        const theirEdit = theirEdits[index] ?? null
        const identity = index < baseLines.length ? [baseLines[index]!] : []
        if (mineEdit === null && theirEdit === null) {
            output.push(...identity)
            index++
            continue
        }
        if (mineEdit !== null && theirEdit !== null &&
            mineEdit.join('\n') !== theirEdit.join('\n')) {
            // Coalesce consecutive conflicting indices into one block.
            let end = index
            while (end + 1 < total) {
                const nextMine = mineEdits[end + 1] ?? null
                const nextTheirs = theirEdits[end + 1] ?? null
                if (nextMine === null && nextTheirs === null) break
                if (nextMine !== null && nextTheirs !== null &&
                    nextMine.join('\n') === nextTheirs.join('\n')) break
                end++
            }
            conflicts++
            output.push('<<<<<<< current')
            for (let run = index; run <= end; run++) {
                output.push(...(mineEdits[run] ?? (run < baseLines.length ? [baseLines[run]!] : [])))
            }
            output.push('=======')
            for (let run = index; run <= end; run++) {
                output.push(...(theirEdits[run] ?? (run < baseLines.length ? [baseLines[run]!] : [])))
            }
            output.push('>>>>>>> restored')
            index = end + 1
            continue
        }
        output.push(...(mineEdit ?? theirEdit ?? identity))
        index++
    }
    return { content: output.join('\n'), conflicts }
}
