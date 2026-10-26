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

/** Breadth-first neighbourhood of the centered note. Binds the center id, the
 * owning user id, and the search depth, in that order. */
export const GRAPH_LOCAL_NEIGHBORHOOD = `WITH RECURSIVE neighborhood(id, depth) AS (
      SELECT ? AS id, 0 AS depth
      UNION
      SELECT CASE WHEN l.source_note_id = neighborhood.id THEN l.target_note_id ELSE l.source_note_id END,
        neighborhood.depth + 1
      FROM neighborhood
      JOIN links l ON l.user_id = ? AND l.target_note_id IS NOT NULL
        AND (l.source_note_id = neighborhood.id OR l.target_note_id = neighborhood.id)
      JOIN notes adjacent ON adjacent.id = CASE
        WHEN l.source_note_id = neighborhood.id THEN l.target_note_id ELSE l.source_note_id END
        AND adjacent.user_id = l.user_id AND adjacent.deleted_at IS NULL AND adjacent.is_archived = 0
      WHERE neighborhood.depth < ?
    ), nearby AS (SELECT id, MIN(depth) AS depth FROM neighborhood GROUP BY id)`

/** Local-mode node query: binds the neighbourhood parameters, then the degree
 * joins, then the `where` clause parameters, then the row limit. */
export function graphLocalNodesQuery(where: string): string {
  return `${GRAPH_LOCAL_NEIGHBORHOOD}
       SELECT n.id, n.title, n.folder_id, f.name AS folder_name, f.color AS folder_color,
         ${GRAPH_DEGREE_SELECT}, nearby.depth
       FROM nearby JOIN notes n ON n.id = nearby.id
       LEFT JOIN folders f ON f.id = n.folder_id AND f.user_id = n.user_id
       ${GRAPH_DEGREE_JOINS}
       WHERE ${where}
       ORDER BY nearby.depth ASC, degree DESC, n.updated_at DESC, n.id ASC LIMIT ?`
}

/** Local-mode node count; binds the neighbourhood parameters and `where`. */
export function graphLocalCountQuery(where: string): string {
  return `${GRAPH_LOCAL_NEIGHBORHOOD}
       SELECT COUNT(*) AS count FROM nearby JOIN notes n ON n.id = nearby.id
       WHERE ${where}`
}

/** Global node query: binds the degree joins, `where`, then the row limit. */
export function graphNodesQuery(where: string): string {
  return `SELECT n.id, n.title, n.folder_id, f.name AS folder_name, f.color AS folder_color,
         ${GRAPH_DEGREE_SELECT}
       FROM notes n LEFT JOIN folders f ON f.id = n.folder_id AND f.user_id = n.user_id
       ${GRAPH_DEGREE_JOINS}
       WHERE ${where}
       ORDER BY degree DESC, n.updated_at DESC, n.id ASC LIMIT ?`
}

/** Global node count; binds `where`. */
export function graphCountQuery(where: string): string {
  return `SELECT COUNT(*) AS count FROM notes n WHERE ${where}`
}
