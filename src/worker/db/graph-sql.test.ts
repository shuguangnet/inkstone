import { describe, expect, it } from 'vitest';
import {
  GRAPH_DEGREE_JOINS,
  GRAPH_MAX_BOUND_PARAMETERS,
  GRAPH_TAGS_QUERY,
  graphEdgeQuery,
  graphIdList,
} from './graph-sql';

// D1 rejects any statement with more than 100 bound parameters. Graph queries
// used to expand the note id list into `IN (?,?,…)` placeholders, so any graph
// of 50 notes or more (the API minimum) failed with
// `D1_ERROR: too many SQL variables at offset 359`.
const D1_MAX_BOUND_PARAMETERS = 100;

function countBindings(sql: string): number {
  return sql.replace(/'[^']*'/g, "''").match(/\?/g)?.length ?? 0;
}

describe('graph SQL parameter budget', () => {
  it('counts every distinct binding form used by the graph', () => {
    expect(countBindings('?1 ?2 ?3 ?')).toBe(4);
    expect(countBindings("SELECT '?' WHERE x = ?1")).toBe(1);
  });

  it('stays under the D1 bound-parameter ceiling', () => {
    for (const sql of [
      graphEdgeQuery(false),
      graphEdgeQuery(true),
      GRAPH_TAGS_QUERY,
      GRAPH_DEGREE_JOINS,
    ]) {
      expect(countBindings(sql)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    }
    expect(GRAPH_MAX_BOUND_PARAMETERS).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
  });

  it('binds the id list once as JSON instead of one placeholder per note', () => {
    for (const sql of [graphEdgeQuery(false), graphEdgeQuery(true), GRAPH_TAGS_QUERY]) {
      expect(sql).toContain('json_each(?2)');
      expect(sql).not.toContain('IN (?,');
    }
    expect(graphIdList(['a', 'b'])).toBe('["a","b"]');
  });

  it('only exposes unresolved targets when the caller asked for them', () => {
    expect(graphEdgeQuery(false)).not.toContain('target_note_id IS NULL');
    expect(graphEdgeQuery(true)).toContain('OR target_note_id IS NULL');
  });
});
