import { useRef, useState } from 'react'
import { Save, LayoutTemplate as TemplateIcon } from 'lucide-react'
import { Drawer, Menu, type MenuItem } from '../../components/overlay'
import { Button, IconButton } from '../../components/primitives'
import { Input } from '../../components/form'
import { useSession } from '../../store/session'
import { useNotes } from '../../store/notes'
import { useUi } from '../../store/ui'
import { t } from '../../lib/i18n'
import {
    BUILT_IN_TEMPLATES,
    loadUserTemplates,
    renderTemplate,
    saveUserTemplate,
    type NoteTemplate,
} from '@shared/templates'

/** "New from template" button + picker menu, plus a save-as-template dialog.
 * User templates persist client-side per account (localStorage). */
export function TemplateMenu({ folderId, rail = false }: {
    folderId?: string | null;
    rail?: boolean;
}) {
    const userId = useSession((s) => s.user?.id)
    const anchorRef = useRef<HTMLButtonElement>(null)
    const [open, setOpen] = useState(false)
    const [saveOpen, setSaveOpen] = useState(false)
    const [templateName, setTemplateName] = useState('')
    const toast = useUi((s) => s.toast)
    const activeContent = useNotes((s) => s.contents[useUi.getState().activeNoteId ?? ''] ?? '')

    const userTemplates: NoteTemplate[] = userId !== undefined ? loadUserTemplates(userId) : []

    const createFrom = (template: NoteTemplate) => {
        const rendered = renderTemplate(template)
        void useNotes.getState().createNote({
            title: rendered.name,
            content: rendered.content,
            ...(folderId !== undefined ? { folderId } : {}),
        })
        setOpen(false)
    }

    const saveCurrentAsTemplate = () => {
        if (userId === undefined) return
        const name = templateName.trim()
        if (name === '') return
        saveUserTemplate(userId, {
            id: `user-${Date.now()}`,
            name,
            content: activeContent,
        })
        setSaveOpen(false)
        setTemplateName('')
        toast({ title: t("templates.saved_toast", { name }), tone: 'success' })
    }

    const items: MenuItem[] = [
        ...BUILT_IN_TEMPLATES.map((template): MenuItem => ({
            id: template.id,
            label: template.name,
            icon: <TemplateIcon size={13}/>,
            onSelect: () => createFrom(template),
        })),
        ...(userTemplates.length > 0
            ? [{ id: 'user-header', label: t("templates.user_section"), disabled: true } as MenuItem]
            : []),
        ...userTemplates.map((template): MenuItem => ({
            id: template.id,
            label: template.name,
            icon: <TemplateIcon size={13}/>,
            onSelect: () => createFrom(template),
        })),
        { id: 'save-current', label: t("templates.save_current"), icon: <Save size={13}/>, onSelect: () => setSaveOpen(true) },
    ]

    return (<>
      {rail
        ? <IconButton ref={anchorRef} label={t("templates.new_from_template")} onClick={() => setOpen(true)}><TemplateIcon size={16}/></IconButton>
        : <IconButton ref={anchorRef} label={t("templates.new_from_template")} size="sm" onClick={() => setOpen(true)}><TemplateIcon size={14}/></IconButton>}
      <Menu anchor={anchorRef} open={open} onClose={() => setOpen(false)} items={items} width={220}/>
      <Drawer open={saveOpen} onClose={() => setSaveOpen(false)} title={t("templates.save_current")} width={320}>
        <div className="space-y-3 p-4">
          <Input
            autoFocus
            value={templateName}
            placeholder={t("templates.name_placeholder")}
            onChange={(event) => setTemplateName(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter') saveCurrentAsTemplate()
            }}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setSaveOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" variant="primary" onClick={saveCurrentAsTemplate} disabled={templateName.trim() === ''}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Drawer>
    </>)
}
