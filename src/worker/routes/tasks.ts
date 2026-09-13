import { Hono } from 'hono'
import type { AppBindings } from '../env'
import { requireAuth } from '../middleware/auth'

export const tasksRoutes = new Hono<AppBindings>()

const TASK_LINE = /^[-*]\s+\[([ xX])\]\s*(.*)$/
const MAX_SCAN_NOTES = 1_000
const MAX_TASK_TEXT = 160
const MAX_TASKS = 200

export interface AggregatedTask {
    noteId: string
    noteTitle: string
    text: string
    line: number
}

/** Extracts open `- [ ]` task lines across a user's active notes. */
export function extractOpenTasks(notes: readonly { id: string; title: string; content: string }[]): AggregatedTask[] {
    const tasks: AggregatedTask[] = []
    for (const note of notes) {
        const lines = note.content.split('\n')
        for (const [index, raw] of lines.entries()) {
            const match = TASK_LINE.exec(raw.trim())
            if (match === null || match[1] !== ' ') continue
            const text = (match[2] ?? '').trim().slice(0, MAX_TASK_TEXT)
            if (text === '') continue
            tasks.push({ noteId: note.id, noteTitle: note.title, text, line: index + 1 })
            if (tasks.length >= MAX_TASKS) return tasks
        }
    }
    return tasks
}

tasksRoutes.get('/', requireAuth, async (c) => {
    const userId = c.get('userId')
    const { results } = await c.env.DB.prepare(
        'SELECT id, title, content FROM notes WHERE user_id = ?1 AND deleted_at IS NULL AND is_archived = 0 ORDER BY updated_at DESC LIMIT ?2',
    ).bind(userId, MAX_SCAN_NOTES).all<{ id: string; title: string; content: string }>()
    return c.json({ tasks: extractOpenTasks(results ?? []) })
})
