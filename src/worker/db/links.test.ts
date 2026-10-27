import { describe, expect, it } from 'vitest'
import { LINK_BASENAME_SQL, LINK_TARGET_SUBQUERY } from './writes'
import { SCHEMA_MIGRATIONS } from './schema'

const D1_MAX_BOUND_PARAMETERS = 100

/** Collapses the whitespace differences between the runtime fragment and its
 * frozen migration copy so they can be compared structurally. */
const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim()

const backfillMigration = SCHEMA_MIGRATIONS.find((migration) => migration.version === 14)

describe('wiki link resolution', () => {
  it('matches the exact title before a trailing path segment', () => {
    expect(squash(LINK_TARGET_SUBQUERY)).toContain(
      'CASE WHEN candidate.title_key = links.target_key THEN 0 ELSE 1 END AS rank',
    )
    expect(squash(LINK_TARGET_SUBQUERY)).toContain('best.rank ASC')
  })

  it('derives the trailing segment only for path-style keys', () => {
    expect(squash(LINK_BASENAME_SQL)).toBe(
      "trim(substr( links.target_key, length(rtrim(links.target_key, replace(links.target_key, '/', ''))) + 1))",
    )
    expect(squash(LINK_TARGET_SUBQUERY)).toContain("instr(links.target_key, '/') > 0")
  })

  it('orders inside a derived table so SQLite can correlate the link row', () => {
    expect(squash(LINK_TARGET_SUBQUERY).startsWith('(SELECT best.id FROM (')).toBe(true)
  })

  it('binds no parameters, so it never counts against the D1 limit', () => {
    expect(LINK_TARGET_SUBQUERY).not.toContain('?')
    expect(D1_MAX_BOUND_PARAMETERS).toBeGreaterThan(0)
  })

  it('ships a one-time backfill that resolves the same way', () => {
    expect(backfillMigration?.statements).toHaveLength(1)
    const sql = squash(backfillMigration!.statements[0]!)
    expect(sql).toContain(squash("instr(links.target_key, '/') > 0 AND candidate.title_key = trim(substr("))
    expect(sql).toContain("replace(links.target_key, '/', '')")
    expect(sql).toContain('CASE WHEN candidate.title_key = links.target_key THEN 0 ELSE 1 END AS rank')
    expect(sql.endsWith('WHERE target_note_id IS NULL')).toBe(true)
  })
})
