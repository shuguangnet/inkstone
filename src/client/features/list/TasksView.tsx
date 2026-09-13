import { useEffect, useState } from 'react'
import { CheckSquare, RefreshCw } from 'lucide-react'
import { api, type AggregatedTask } from '../../lib/api'
import { IconButton } from '../../components/primitives'
import { Empty } from '../../components/feedback'
import { useNotes } from '../../store/notes'
import { t } from '../../lib/i18n'

/** Aggregated open-task view across the whole notebook. */
export function TasksView() {
    const [tasks, setTasks] = useState<AggregatedTask[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [reload, setReload] = useState(0)
    const openNote = useNotes((s) => s.openNote)
    const notes = useNotes((s) => s.notes)
    const cursor = useNotes((s) => s.cursor)

    useEffect(() => {
        const controller = new AbortController()
        let cancelled = false
        api.tasks(controller.signal)
            .then((result) => {
                if (!cancelled) setTasks(result.tasks)
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err))
            })
        return () => {
            cancelled = true
            controller.abort()
        }
    }, [reload, cursor])

    const grouped = new Map<string, AggregatedTask[]>()
    for (const task of tasks ?? []) {
        const bucket = grouped.get(task.noteId) ?? []
        bucket.push(task)
        grouped.set(task.noteId, bucket)
    }

    return (<div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <CheckSquare size={13} className="text-[var(--accent)]"/>
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">
          {t("tasks.title")}{tasks !== null && ` · ${tasks.length}`}
        </span>
        <span className="flex-1"/>
        <IconButton label={t("tasks.refresh")} size="sm" onClick={() => setReload((value) => value + 1)}>
          <RefreshCw size={12}/>
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error !== null && <p className="px-2 py-4 text-xs text-[var(--danger)]">{error}</p>}
        {tasks !== null && tasks.length === 0 && (
          <Empty title={t("tasks.empty_title")} description={t("tasks.empty_desc")}/>
        )}
        {[...grouped.entries()].map(([noteId, items]) => (<div key={noteId} className="mb-3">
          <button type="button"
            className="mb-1 block w-full truncate px-2 text-left text-[11px] font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            onClick={() => void openNote(noteId)}
          >
            {notes[noteId]?.title ?? items[0]!.noteTitle}
          </button>
          {items.map((task, index) => (<button key={`${noteId}-${index}`} type="button"
              className="block w-full rounded-[var(--r-md)] px-2 py-1 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              onClick={() => void openNote(noteId)}
          >
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full border border-[var(--text-quaternary)] align-middle"/>
            {task.text}
          </button>))}
        </div>))}
      </div>
    </div>)
}
