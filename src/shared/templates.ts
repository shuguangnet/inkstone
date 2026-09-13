/** Note templates: built-ins shipped with the app plus per-user saved
 * templates persisted client-side (localStorage, per account). */

export interface NoteTemplate {
    id: string;
    name: string;
    content: string;
}

export const BUILT_IN_TEMPLATES: readonly NoteTemplate[] = [
    {
        id: 'builtin-daily',
        name: 'Daily note',
        content: [
            '# Daily note',
            '',
            '## Plan',
            '- [ ] ',
            '',
            '## Log',
            '',
        ].join('\n'),
    },
    {
        id: 'builtin-meeting',
        name: 'Meeting notes',
        content: [
            '# Meeting notes',
            '',
            '- Date: ',
            '- Attendees: ',
            '',
            '## Agenda',
            '',
            '## Decisions',
            '',
            '## Action items',
            '- [ ] ',
            '',
        ].join('\n'),
    },
    {
        id: 'builtin-book',
        name: 'Book notes',
        content: [
            '# Book notes',
            '',
            '- Title: ',
            '- Author: ',
            '- Rating: ',
            '',
            '## Key ideas',
            '',
            '## Quotes',
            '',
            '## Takeaways',
            '- [ ] ',
            '',
        ].join('\n'),
    },
    {
        id: 'builtin-weekly',
        name: 'Weekly review',
        content: [
            '# Weekly review',
            '',
            '## Wins',
            '',
            '## Setbacks',
            '',
            '## Lessons',
            '',
            '## Next week',
            '- [ ] ',
            '',
        ].join('\n'),
    },
];

const STORAGE_PREFIX = 'inkstone:templates:';
declare const localStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
};

export function templatesStorageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`;
}

export function loadUserTemplates(userId: string): NoteTemplate[] {
    try {
        const raw = localStorage.getItem(templatesStorageKey(userId));
        if (raw === null) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is NoteTemplate =>
            item !== null && typeof item === 'object' &&
            typeof (item as NoteTemplate).id === 'string' &&
            typeof (item as NoteTemplate).name === 'string' &&
            typeof (item as NoteTemplate).content === 'string');
    } catch {
        return [];
    }
}

export function saveUserTemplate(userId: string, template: NoteTemplate): NoteTemplate[] {
    const templates = loadUserTemplates(userId).filter((item) => item.id !== template.id);
    const next = [...templates, template].slice(-20);
    try {
        localStorage.setItem(templatesStorageKey(userId), JSON.stringify(next));
    } catch { /* storage unavailable; templates stay in memory for this session */ }
    return next;
}

export function deleteUserTemplate(userId: string, templateId: string): NoteTemplate[] {
    const next = loadUserTemplates(userId).filter((item) => item.id !== templateId);
    try {
        localStorage.setItem(templatesStorageKey(userId), JSON.stringify(next));
    } catch { /* ignore */ }
    return next;
}

/** Expands a relative date placeholder like {{date}} / {{time}} at insert time. */
export function renderTemplate(template: NoteTemplate, now = new Date()): NoteTemplate {
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    return {
        ...template,
        content: template.content
            .replaceAll('{{date}}', date)
            .replaceAll('{{time}}', time),
    };
}
