import { useEffect, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { Sparkles } from 'lucide-react'
import { SELECTION_ACTIONS, type AiAction } from '../../lib/ai'
import { useAi } from '../../store/ai'
import { t } from '../../lib/i18n'

/** Floating toolbar above the current editor selection offering AI actions.
 * Selection state and the write-back callback live in the AI store so the
 * assistant panel can stream results and apply them back to the exact range. */
export function SelectionToolbar({ view }: {
    view: EditorView | null;
}) {
    const setSelection = useAi((s) => s.setSelection);
    const registerSelectionWriter = useAi((s) => s.registerSelectionWriter);
    const send = useAi((s) => s.send);
    const streaming = useAi((s) => s.streaming);
    const selection = useAi((s) => s.selection);
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

    useEffect(() => {
        if (view === null) {
            registerSelectionWriter(null);
            return;
        }
        registerSelectionWriter((text) => {
            const current = useAi.getState().selection;
            if (current === null) return;
            view.dispatch({ changes: { from: current.from, to: current.to, insert: text } });
            view.focus();
        });
        const readSelection = () => {
            const range = view.state.selection.main;
            if (range.empty) {
                setSelection(null);
                setCoords(null);
                return;
            }
            const text = view.state.sliceDoc(range.from, range.to);
            if (text.length > 8_000) {
                setSelection(null);
                setCoords(null);
                return;
            }
            setSelection({ text, from: range.from, to: range.to });
            const anchors = view.coordsAtPos(range.from);
            const head = view.coordsAtPos(range.to);
            if (anchors && head) {
                setCoords({
                    top: Math.min(anchors.top, head.top) - 4,
                    left: (anchors.left + head.right) / 2,
                });
            }
        };
        readSelection();
        const dom = view.dom;
        document.addEventListener('selectionchange', readSelection);
        dom.addEventListener('blur', readSelection);
        return () => {
            document.removeEventListener('selectionchange', readSelection);
            dom.removeEventListener('blur', readSelection);
            setSelection(null);
            registerSelectionWriter(null);
        };
    }, [view, setSelection, registerSelectionWriter]);

    if (view === null || selection === null || coords === null) return null;

    const run = (action: AiAction) => {
        setCoords(null);
        void send({
            action,
            selection: selection.text,
            noteTitle: undefined,
        });
        useAi.getState().setPanelOpen(true);
    };

    return (<div
        className="fixed z-[120] flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-[var(--r-lg)] border border-[var(--border-default)] bg-[var(--bg-overlay)] p-0.5 shadow-[var(--shadow-modal)]"
        style={{ top: coords.top, left: coords.left }}
    >
        <Sparkles size={11} className="ml-1 text-[var(--accent)]"/>
        {SELECTION_ACTIONS.map((item) => (<button
            key={item.action}
            type="button"
            disabled={streaming}
            className="rounded-[var(--r-md)] px-1.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
            onClick={() => run(item.action)}
        >
            {t(item.labelKey)}
        </button>))}
    </div>);
}
