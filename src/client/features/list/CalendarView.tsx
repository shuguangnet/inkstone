import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '../../components/primitives'
import { useNotes } from '../../store/notes'
import { useUi } from '../../store/ui'
import { t } from '../../lib/i18n'

/** Month calendar aggregating notes by creation date. */
export function CalendarView() {
    const notes = useNotes((s) => s.notes)
    const openNote = useNotes((s) => s.openNote)
    const openView = useUi((s) => s.openView)
    const now = new Date()
    const [month, setMonth] = useState({ year: now.getFullYear(), monthIndex: now.getMonth() })
    const [selectedDay, setSelectedDay] = useState<string | null>(null)

    const byDay = useMemo(() => {
        const map = new Map<string, string[]>()
        for (const note of Object.values(notes)) {
            if (note.isArchived || note.deletedAt !== undefined) continue
            const key = new Date(note.createdAt).toISOString().slice(0, 10)
            const bucket = map.get(key) ?? []
            bucket.push(note.id)
            map.set(key, bucket)
        }
        return map
    }, [notes])

    const grid = useMemo(() => {
        const first = new Date(Date.UTC(month.year, month.monthIndex, 1))
        const startOffset = (first.getUTCDay() + 6) % 7 // Monday-first
        const daysInMonth = new Date(Date.UTC(month.year, month.monthIndex + 1, 0)).getUTCDate()
        const cells: Array<{ day: number | null; key: string }> = []
        for (let index = 0; index < startOffset; index++) cells.push({ day: null, key: `pad-${index}` })
        for (let day = 1; day <= daysInMonth; day++) {
            cells.push({ day, key: `${month.year}-${month.monthIndex}-${day}` })
        }
        return cells
    }, [month])

    const monthLabel = new Date(Date.UTC(month.year, month.monthIndex, 1)).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long',
    })
    const dayPrefix = `${month.year}-${String(month.monthIndex + 1).padStart(2, '0')}-`
    const dayNotes = selectedDay !== null
        ? (byDay.get(selectedDay) ?? []).map((id) => notes[id]).filter(Boolean)
        : []

    const shiftMonth = (delta: number) => {
        const next = new Date(Date.UTC(month.year, month.monthIndex + delta, 1))
        setMonth({ year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() })
        setSelectedDay(null)
    }

    return (<div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2">
        <CalendarDays size={13} className="text-[var(--accent)]"/>
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">{t("calendar.title")}</span>
        <span className="flex-1"/>
        <IconButton label={t("calendar.previous_month")} size="sm" onClick={() => shiftMonth(-1)}><ChevronLeft size={13}/></IconButton>
        <span className="text-xs font-medium text-[var(--text-secondary)]">{monthLabel}</span>
        <IconButton label={t("calendar.next_month")} size="sm" onClick={() => shiftMonth(1)}><ChevronRight size={13}/></IconButton>
      </div>
      <div className="shrink-0 px-3 pt-3">
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-[var(--text-quaternary)]">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-0.5">
          {grid.map((cell) => {
              if (cell.day === null) return <span key={cell.key}/>
              const key = `${dayPrefix}${String(cell.day).padStart(2, '0')}`
              const count = byDay.get(key)?.length ?? 0
              const selected = selectedDay === key
              return (<button key={cell.key} type="button"
                  className={cnCell(selected, count > 0)}
                  onClick={() => setSelectedDay(selected ? null : key)}
              >
                <span className={count > 0 ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-quaternary)]'}>{cell.day}</span>
                {count > 0 && <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-[var(--accent)]"/>}
              </button>)
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {selectedDay === null && <p className="px-2 py-3 text-xs text-[var(--text-quaternary)]">{t("calendar.pick_a_day")}</p>}
        {selectedDay !== null && dayNotes.length === 0 && (
          <p className="px-2 py-3 text-xs text-[var(--text-quaternary)]">{t("calendar.no_notes_that_day")}</p>
        )}
        {dayNotes.map((note) => (<button key={note!.id} type="button"
            className="block w-full truncate rounded-[var(--r-md)] px-2 py-1.5 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            onClick={() => void openNote(note!.id)}
        >
          {note!.title === '' ? t("notes.untitled") : note!.title}
        </button>))}
        {selectedDay !== null && (<button type="button"
            className="mt-1 w-full rounded-[var(--r-md)] px-2 py-1.5 text-left text-xs text-[var(--accent)] hover:bg-[var(--bg-hover)]"
            onClick={() => {
                openView('all')
                void useNotes.getState().createNote({ title: selectedDay, open: true })
            }}
        >
          + {t("calendar.create_note_for_day")}
        </button>)}
      </div>
    </div>)
}

function cnCell(selected: boolean, hasNotes: boolean): string {
    const base = 'flex h-9 flex-col items-center justify-center rounded-[var(--r-md)] text-[11px]'
    if (selected) return `${base} bg-[var(--accent)]/20`
    if (hasNotes) return `${base} hover:bg-[var(--bg-hover)]`
    return `${base} text-[var(--text-quaternary)]`
}
