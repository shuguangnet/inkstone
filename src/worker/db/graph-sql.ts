/** SQL fragments for the relationship graph.
 *
 * D1 rejects any statement with more than 100 bound parameters, so nothing in
 * this module may scale its parameter count with the number of notes in the
 * graph. Note id lists travel as a single JSON array consumed by `json_each`,
 * and degrees come from grouped scans joined on the candidate rows instead of
 * per-row correlated subqueries.
 */

export const GRAPH_EDGE_CANDIDATE_LIMIT = 10_000

/** Degree columns for a note aliased as `n`. Requires {@link GRAPH_DEGREE_JOINS}. */
export const GRAPH_DEGREE_SELECT = `
    (COALESCE(deg_in.count, 0) + COALESCE(deg_out.count, 0) - COALESCE(deg_self.count, 0)) AS degree,
    COALESCE(deg_in.count, 0) AS in_degree,
    COALESCE(deg_out.count, 0) AS out_degree`

/** Binds the owning user id three times, in this order. */
export const GRAPH_DEGREE_JOINS = `
    LEFT JOIN (SELECT target_note_id AS id, COUNT(*) AS count FROM links
       WHERE user_id = ? AND target_note_id IS NOT NULL
       GROUP BY target_note_id) deg_in ON deg_in.id = n.id
    LEFT JOIN (SELECT source_note_id AS id, COUNT(*) AS count FROM links
       WHERE user_id = ? AND target_note_id IS NOT NULL
       GROUP BY source_note_id) deg_out ON deg_out.id = n.id
    LEFT JOIN (SELECT source_note_id AS id, COUNT(*) AS count FROM links
       WHERE user_id = ? AND target_note_id IS NOT NULL
         AND source_note_id = target_note_id
       GROUP BY source_note_id) deg_self ON deg_self.id = n.id`

/** Binds the user id, the note id array as JSON, and the row limit. */
export function graphEdgeQuery(includeUnresolved: boolean): string {
  const unresolved = includeUnresolved ? ' OR target_note_id IS NULL' : ''
  return `SELECT source_note_id, target_note_id, target_key, target_title FROM links
         WHERE user_id = ?1 AND source_note_id IN (SELECT value FROM json_each(?2))
           AND (target_note_id IN (SELECT value FROM json_each(?2))${unresolved})
         ORDER BY source_note_id ASC, target_key ASC LIMIT ?3`
}

/** Binds the user id and the note id array as JSON. */
export const GRAPH_TAGS_QUERY = `SELECT nt.note_id, t.name, t.color FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id AND t.user_id = ?1
         WHERE nt.note_id IN (SELECT value FROM json_each(?2))
         ORDER BY t.name COLLATE NOCASE ASC`

/** Serializes the id list once so it can be bound as a single parameter. */
export function graphIdList(ids: readonly string[]): string {
  return JSON.stringify(ids)
}

/** Highest bound-parameter count any graph statement can produce. Used by the
 * regression test that guards the D1 limit. */
export const GRAPH_MAX_BOUND_PARAMETERS = 5
