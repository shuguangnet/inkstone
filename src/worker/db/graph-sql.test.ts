import { describe, expect, it } from 'vitest';
import {
  GRAPH_DEGREE_JOINS,
  GRAPH_LOCAL_NEIGHBORHOOD,
  GRAPH_TAGS_QUERY,
  graphCountQuery,
  graphEdgeQuery,
  graphIdList,
  graphLocalCountQuery,
  graphLocalNodesQuery,
  graphNodesQuery,
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

  // The widest filter set the route can build: user, title, folder, tag and
  // the orphan-excluding EXISTS (four bindings beyond the user id).
  const widestWhere = 'n.user_id = ? AND n.title LIKE ? AND n.folder_id = ? AND t.name = ? AND EXISTS (SELECT 1 FROM links WHERE user_id = ?)';

  it('stays under the D1 bound-parameter ceiling', () => {
    const statements = [
      graphEdgeQuery(false),
      graphEdgeQuery(true),
      GRAPH_TAGS_QUERY,
      GRAPH_DEGREE_JOINS,
      GRAPH_LOCAL_NEIGHBORHOOD,
      graphNodesQuery(widestWhere),
      graphCountQuery(widestWhere),
      graphLocalNodesQuery(widestWhere),
      graphLocalCountQuery(widestWhere),
    ];
    for (const sql of statements) {
      expect(countBindings(sql)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    }
  });

  it('keeps the note count out of the parameter budget', () => {
    // A 5,000-note graph binds exactly as many parameters as a 1-note graph.
    const ids = graphIdList(Array.from({ length: 5000 }, (_, index) => `note-${index}`));
    // `?2` appears twice in the edge query, so the textual count is 4 while the
    // statement binds three values.
    for (const sql of [graphEdgeQuery(false), graphEdgeQuery(true), GRAPH_TAGS_QUERY]) {
      expect(countBindings(sql)).toBeLessThanOrEqual(4);
    }
    expect(ids.startsWith('["note-0",')).toBe(true);
    expect(ids.split(',').length).toBe(5000);
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
