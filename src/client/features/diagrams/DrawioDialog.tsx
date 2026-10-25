import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY_DRAWIO_XML, createDrawioBlock, listDrawioBlocks, validateDrawioXml } from '@shared/drawio'
import { Modal, confirm } from '../../components/overlay'
import { Button } from '../../components/primitives'
import { useNotes } from '../../store/notes'
import { getLocale, t } from '../../lib/i18n'
import { useDiagrams } from './store'

export function DrawioDialog() {
  const session = useDiagrams((state) => state.session)
  return session ? <DrawioEditor key={`${session.noteId}:${session.block?.id ?? 'new'}`} /> : null
}

function DrawioEditor() {
  const session = useDiagrams.getState().session!
  const frame = useRef<HTMLIFrameElement>(null)
  const [title, setTitle] = useState(session.block?.title ?? t('drawio.default_title'))
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const dirty = useRef(false)
  const latest = useRef(session.block?.xml ?? EMPTY_DRAWIO_XML)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const timer = useRef(0)
  const titleRef = useRef(title)
  titleRef.current = title
  const send = useCallback((message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), location.origin), [])
  const close = useCallback(async () => {
    if (saving.current) return
    if (dirty.current && !await confirm({ title: t('drawio.discard_title'), description: t('drawio.discard_hint'), confirmLabel: t('drawio.discard'), tone: 'danger' })) return
    useDiagrams.getState().close()
  }, [])
  const save = useCallback((xml: string) => {
    try {
      const validated = validateDrawioXml(xml)
      const state = useNotes.getState()
      const note = state.notes[session.noteId]
      const content = state.contents[session.noteId]
      if (!note || note.deletedAt || content === undefined) throw new Error(t('drawio.note_unavailable'))
      let next: string
      if (session.block) {
        const matches = listDrawioBlocks(content).filter((block) => block.id ? block.id === session.block!.id : block.xml === session.block!.xml)
        if (matches.length !== 1 || matches[0]!.source !== session.block.source) throw new Error(t('drawio.conflict'))
        const block = matches[0]!
        const replacement = createDrawioBlock(validated, block.id || crypto.randomUUID(), titleRef.current)
        next = content.slice(0, block.from) + replacement + content.slice(block.to)
      } else {
        const block = createDrawioBlock(validated, crypto.randomUUID(), titleRef.current)
        const anchor = Math.min(session.anchor, content.length)
        if (content !== session.base) throw new Error(t('drawio.conflict'))
        next = `${content.slice(0, anchor)}\n\n${block}\n\n${content.slice(anchor)}`
      }
      state.editContent(session.noteId, next)
      dirty.current = false
      useDiagrams.getState().close()
    } catch (error) { setError(error instanceof Error ? error.message : t('drawio.save_error')) }
    finally { window.clearTimeout(timer.current); saving.current = false; setBusy(false) }
  }, [session])
  const requestSave = () => {
    if (!ready || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    send({ action: 'export', format: 'xml' })
    timer.current = window.setTimeout(() => { saving.current = false; setBusy(false); setError(t('drawio.save_error')) }, 10000)
  }
  useEffect(() => {
    let initialized = false
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || typeof event.data !== 'string' || event.data.length > 2_100_000) return
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.event === 'init') {
        initialized = true
        setReady(true)
        setError('')
        send({ action: 'load', xml: latest.current, autosave: 1, title: titleRef.current })
      } else if (message.event === 'autosave' && typeof message.xml === 'string') {
        latest.current = message.xml
        dirty.current = true
      } else if ((message.event === 'save' || message.event === 'export') && typeof message.xml === 'string') save(message.xml)
      else if (message.event === 'exit') void close()
    }
    window.addEventListener('message', receive)
    const loading = window.setTimeout(() => { if (!initialized) setError(t('drawio.load_error')) }, 20000)
    return () => { window.removeEventListener('message', receive); window.clearTimeout(loading); window.clearTimeout(timer.current) }
  }, [close, save, send])
  useEffect(() => { if (ready) setError('') }, [ready])
  const url = `/drawio/?embed=1&proto=json&spin=1&libraries=1&saveAndExit=1&noSaveBtn=0&noExitBtn=0&offline=1&lang=${getLocale() === 'zh-CN' ? 'zh' : 'en'}&ui=kennedy&dark=0`
  return <Modal open onClose={() => void close()} title={t('drawio.title')} width={1440} footer={<>
    <Button onClick={() => void close()}>{t('common.cancel')}</Button>
    <Button disabled={!ready || busy} onClick={requestSave}>{busy ? t('drawio.saving') : t('drawio.save')}</Button>
  </>}>
    <label className="mb-2 flex items-center gap-2 text-xs">{t('drawio.name')}<input className="min-w-0 flex-1 rounded border border-[var(--border-default)] bg-transparent px-2 py-1.5" maxLength={160} value={title} onChange={(event) => { setTitle(event.target.value); dirty.current = true }}/></label>
    {!ready && <p role="status" className="pb-2 text-xs text-[var(--text-tertiary)]">{t('drawio.loading')}</p>}
    {error && <p role="alert" className="pb-2 text-xs text-[var(--danger)]">{error}</p>}
    <iframe ref={frame} title={t('drawio.title')} src={url} sandbox="allow-scripts allow-same-origin allow-downloads" className="h-[65dvh] min-h-[360px] w-full rounded border border-[var(--border-subtle)] bg-white"/>
  </Modal>
}
