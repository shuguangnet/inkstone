import { useEffect, useRef, useState } from 'react';
import { Bot, Sparkles, Square, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton, Button } from '../../components/primitives';
import { diffLines } from '../../lib/ai-diff';
import { useAi } from '../../store/ai';
import { useActiveNote, useNotes } from '../../store/notes';
import type { AiChatMessage } from '../../store/ai';
import { t, useLocale } from '../../lib/i18n';
import type { MessageKey } from '@shared/locales/en-US';
import type { AiAction } from '../../lib/ai';

const AI_ERRORS = {
  ai_not_configured: 'ai.error.ai_not_configured',
  ai_quota_exceeded: 'ai.error.ai_quota_exceeded',
  ai_busy: 'ai.error.ai_busy',
  ai_unavailable: 'ai.error.ai_unavailable',
  http_403: 'ai.error.http_403',
} as const;

const QUICK_ACTIONS: readonly { action: AiAction; labelKey: MessageKey }[] = [
  { action: 'ask', labelKey: 'ai.action.ask' },
  { action: 'polish', labelKey: 'ai.action.polish' },
  { action: 'summarize', labelKey: 'ai.action.summarize' },
  { action: 'title', labelKey: 'ai.action.title' },
  { action: 'tags', labelKey: 'ai.action.tags' },
  { action: 'continue', labelKey: 'ai.action.continue' },
];

/** Right-side AI assistant panel: chat with the current note as context,
 * quick full-note actions, and streaming responses. */
function renderContent(message: AiChatMessage) {
    const parts = message.content.split(/(\[\d+\])/g);
    return parts.map((part, index) => {
        const citation = /^\[(\d+)\]$/.exec(part);
        if (citation === null) return <span key={index}>{part}</span>;
        const source = message.sources?.find((entry) => entry.index === Number(citation[1]));
        if (source === undefined) return <span key={index}>{part}</span>;
        return (<button key={index} type="button"
            title={source.title}
            className="mx-0.5 rounded-[var(--r-sm)] bg-[var(--accent)]/15 px-1 align-middle text-[11px] text-[var(--accent)] hover:bg-[var(--accent)]/30"
            onClick={() => void useNotes.getState().openNote(source.noteId)}
        >
            {citation[1]}
        </button>);
    });
}

export function AssistantPanel({ onClose }: {
    onClose: () => void;
}) {
    const locale = useLocale();
    const messages = useAi((s) => s.messages);
    const streaming = useAi((s) => s.streaming);
    const status = useAi((s) => s.status);
    const send = useAi((s) => s.send);
    const stop = useAi((s) => s.stop);
    const activeAction = useAi((s) => s.activeAction);
    const setActiveAction = useAi((s) => s.setActiveAction);
    const { note, content } = useActiveNote();
    const editContent = useNotes((s) => s.editContent);
    const lastPolishedBase = useAi((s) => s.lastPolishedBase);
    const replaceSelection = useAi((s) => s.replaceSelection);
    const lastResultTarget = useAi((s) => s.lastResultTarget);
    const [input, setInput] = useState('');
    const listRef = useRef<HTMLDivElement>(null);
    const lastResultRef = useRef<string>('');

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [messages]);

    const statusAvailable = status?.available ?? false;

    const runAction = (action: AiAction, message?: string) => {
        setActiveAction(action);
        void send({
            action,
            message,
            noteTitle: note?.title,
            noteContent: content,
        });
    };

    // Remember the latest assistant output so "apply" can write it back.
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.content !== '' && !message.error);
    if (lastAssistant) lastResultRef.current = lastAssistant.content;
    const lastSelection = lastResultTarget === 'selection';

    const applyResult = () => {
        if (!note || lastResultRef.current === '') return;
        editContent(note.id, lastResultRef.current);
    };

    return (<aside className="flex w-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-editor)] md:w-[340px]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2">
        <Sparkles size={12} className="text-[var(--accent)]"/>
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">{t("ai.panel.title")}</span>
        <span className="flex-1"/>
        {streaming && (<IconButton label={t("ai.panel.stop")} size="sm" onClick={stop}><Square size={11}/></IconButton>)}
        <IconButton label={t("common.close")} size="sm" onClick={onClose}><X size={13}/></IconButton>
      </div>

      {!statusAvailable && (<div className="border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
        {t("ai.panel.not_configured")}
        {status?.reason === 'disabled' ? '' : ''}
      </div>)}

      {statusAvailable && (<div className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)] px-3 py-2">
        {QUICK_ACTIONS.map((item) => (<Button key={item.action} size="sm" variant="ghost"
            disabled={streaming || !note}
            onClick={() => runAction(item.action)}>
          {t(item.labelKey)}
        </Button>))}
      </div>)}

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (<div className="pt-6 text-center text-xs text-[var(--text-quaternary)]">
          <Bot size={20} className="mx-auto mb-2 opacity-40"/>
          {t("ai.panel.empty_hint")}
        </div>)}
        {messages.map((message) => (<div key={message.id} className={cn(
                'rounded-[var(--r-lg)] px-2.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                message.role === 'user'
                    ? 'ml-6 bg-[var(--accent)]/10 text-[var(--text-primary)]'
                    : 'mr-2 bg-[var(--bg-base)] text-[var(--text-secondary)]',
            )}>
          {message.error !== undefined
                ? <span className="text-[var(--danger)]">{t(message.error in AI_ERRORS ? AI_ERRORS[message.error as keyof typeof AI_ERRORS] : "ai.error.unknown")}</span>
                : message.content !== ''
                    ? renderContent(message)
                    : <span className="animate-pulse text-[var(--text-quaternary)]">…</span>}
        </div>))}
      </div>

      {statusAvailable && lastAssistant && (<div className="shrink-0 space-y-2 border-t border-[var(--border-subtle)] p-2.5">
        {lastPolishedBase !== null && (<details className="rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] text-[var(--text-tertiary)]">{t("ai.panel.diff_summary")}</summary>
          <div className="mt-1.5 max-h-56 space-y-0 overflow-y-auto font-mono text-[11px] leading-snug">
            {diffLines(lastPolishedBase, lastAssistant.content).map((line, index) => (<div key={index} className={cn(
                    'whitespace-pre-wrap break-all px-1',
                    line.kind === 'added' && 'bg-[var(--accent)]/15 text-[var(--text-primary)]',
                    line.kind === 'removed' && 'bg-[var(--danger)]/10 text-[var(--text-quaternary)] line-through',
                    line.kind === 'same' && 'text-[var(--text-quaternary)]',
                )}>{line.text === '' ? ' ' : line.text}</div>))}
          </div>
        </details>)}
        {lastSelection !== null && (<Button size="sm" className="w-full" onClick={() => replaceSelection(lastAssistant.content)}
            disabled={streaming}>
          {t("ai.panel.replace_selection")}
        </Button>)}
        {lastSelection === null && (<Button size="sm" className="w-full" onClick={applyResult} disabled={streaming || !note}>
          {t("ai.panel.apply_to_note")}
        </Button>)}
        <Button size="sm" className="w-full" onClick={() => void navigator.clipboard.writeText(lastAssistant.content)}
            disabled={streaming}>
          {t("ai.panel.copy")}
        </Button>
        <div className="flex items-end gap-1.5">
          <textarea
            value={input}
            rows={2}
            className="max-h-28 min-h-[38px] flex-1 resize-none rounded-[var(--r-lg)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
            placeholder={t(activeAction === 'chat' ? 'ai.panel.input_placeholder' : `ai.action.${activeAction}`)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (input.trim() === '' || streaming) return;
                    const text = input;
                    setInput('');
                    void runAction(activeAction, text);
                }
            }}
          />
          <IconButton
            label={t("ai.panel.send")}
            size="sm"
            disabled={streaming || input.trim() === ''}
            onClick={() => {
                if (input.trim() === '') return;
                const text = input;
                setInput('');
                void runAction(activeAction, text);
            }}
          >
            <Sparkles size={13}/>
          </IconButton>
        </div>
        <div className="text-[10px] text-[var(--text-quaternary)]">
          {status && `${status.usage.usedChars}/${status.usage.quotaChars} ${t("ai.panel.quota_chars")} · ${status.settings.model || 'workers-ai'}`}
          {' · '}
          {locale === 'zh-CN' ? t("ai.panel.context_note") : t("ai.panel.context_note")}
        </div>
      </div>)}
    </aside>);
}
