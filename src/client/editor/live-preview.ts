import { Facet, StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { renderMarkdown } from '../lib/markdown/renderer'
import { enhancePreview, renderPendingMermaid } from '../lib/markdown/enhance'
import { t } from '../lib/i18n'
import { hydrateDrawio } from '../lib/markdown/drawio'
import { decodeDataValue } from '../lib/markdown/data-attr'

export interface LivePreviewOptions {
  math: boolean
  mermaid: boolean
  onEditDiagram?: (id: string, xml: string) => void
}

export const livePreviewOptions = Facet.define<LivePreviewOptions, LivePreviewOptions>({
  combine: (values) => values[0] ?? { math: true, mermaid: true },
})
const previewFocus = StateEffect.define<boolean>()
const inlineClasses: Record<string, string> = { StrongEmphasis: 'cm-md-strong', Emphasis: 'cm-md-em', Strikethrough: 'cm-md-strike', InlineCode: 'cm-md-code', Link: 'cm-md-link', Autolink: 'cm-md-link' }

class RenderedMarkdown extends WidgetType {
  constructor(readonly source: string, readonly block: boolean, readonly kind: string, readonly options: LivePreviewOptions) { super() }

  eq(other: RenderedMarkdown) {
    return this.source === other.source && this.block === other.block && this.kind === other.kind && this.options.math === other.options.math && this.options.mermaid === other.options.mermaid
  }

  toDOM(view: EditorView) {
    const dom: HTMLElement = document.createElement(this.block ? 'div' : 'span')
    dom.className = `cm-live-rendered ink-prose ${this.block ? 'cm-live-block' : 'cm-live-inline'}`
    dom.dataset.liveKind = this.kind
    dom.title = t('editor.edit_rendered')
    dom.setAttribute('aria-label', t('editor.edit_rendered'))
    dom.tabIndex = 0
    dom.innerHTML = renderMarkdown(this.source).html
    dom.querySelectorAll('button:not([data-drawio-edit]), .heading-anchor').forEach((node) => node.remove())
    hydrateDrawio(dom)
    if (!this.block) {
      const paragraph = dom.querySelector('p')
      if (paragraph) paragraph.replaceWith(...paragraph.childNodes)
    }
    const edit = (target: EventTarget | null) => {
      const diagram = target instanceof Element ? target.closest<HTMLElement>('[data-drawio]') : null
      if (diagram && this.options.onEditDiagram) {
        this.options.onEditDiagram(diagram.dataset.drawioId ?? '', decodeDataValue(diagram.dataset.drawio))
        return
      }
      const start = view.posAtDOM(dom)
      const sourceLine = target instanceof Element ? Number(target.closest('[data-line]')?.getAttribute('data-line') ?? 0) : 0
      const offset = Number.isSafeInteger(sourceLine) && sourceLine >= 0 ? sourceLine : 0
      const line = view.state.doc.line(Math.min(view.state.doc.lines, view.state.doc.lineAt(start).number + offset))
      const position = Math.min(start + this.source.length - 1, line.to)
      view.dispatch({ selection: { anchor: Math.max(start, position) }, scrollIntoView: true })
      view.focus()
    }
    dom.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      edit(event.target)
    })
    dom.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      edit(event.target)
    })
    dom.addEventListener('click', (event) => event.preventDefault())
    dom.addEventListener('load', () => view.requestMeasure(), true)
    void enhancePreview(dom, { ...this.options, dark: document.documentElement.dataset.theme === 'dark', codeBlockCollapseLines: 0 }).then(async () => {
      if (!dom.isConnected) return
      if (this.options.mermaid) await renderPendingMermaid(dom, document.documentElement.dataset.theme === 'dark')
      if (dom.isConnected) view.requestMeasure()
    }).catch(() => {})
    return dom
  }

  ignoreEvent() { return true }
}

class ListMarker extends WidgetType {
  constructor(readonly label: string) { super() }
  eq(other: ListMarker) { return this.label === other.label }
  toDOM() {
    const dom = document.createElement('span')
    dom.className = 'cm-live-list-marker'
    dom.textContent = this.label
    return dom
  }
  ignoreEvent() { return false }
}

class TaskCheckbox extends WidgetType {
  constructor(readonly checked: boolean) { super() }
  eq(other: TaskCheckbox) { return this.checked === other.checked }
  toDOM(view: EditorView) {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cm-live-task'
    input.checked = this.checked
    input.setAttribute('aria-label', t('editor.toggle_task'))
    input.addEventListener('mousedown', (event) => event.preventDefault())
    input.addEventListener('change', () => {
      const from = view.posAtDOM(input)
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(from, from + 3))) return
      view.dispatch({ changes: { from, to: from + 3, insert: input.checked ? '[x]' : '[ ]' }, userEvent: 'input' })
      view.focus()
    })
    return input
  }
  ignoreEvent() { return true }
}

function buildPreview(state: EditorState, focused: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const protectedRanges: { from: number; to: number }[] = []
  const inlineRanges: { from: number; to: number }[] = []
  const lines = new Map<number, Set<string>>()
  const options = state.facet(livePreviewOptions)
  const active = (from: number, to: number, includeEnd = false) => state.selection.ranges.some((selection) => selection.empty
    ? focused && selection.head >= from && (includeEnd ? selection.head <= to : selection.head < to)
    : selection.from < to && selection.to > from)
  const mark = (from: number, to: number, className: string) => {
    if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to))
  }
  const hide = (from: number, to: number) => {
    if (from < to) ranges.push(Decoration.replace({}).range(from, to))
  }
  const lineStyle = (from: number, to: number, className: string) => {
    const last = state.doc.lineAt(to).number
    for (let n = state.doc.lineAt(from).number; n <= last; n++) {
      const position = state.doc.line(n).from
      const names = lines.get(position) ?? new Set<string>()
      names.add(className)
      lines.set(position, names)
    }
  }
  const render = (from: number, to: number, block: boolean, kind: string) => {
    ranges.push(Decoration.replace({ widget: new RenderedMarkdown(state.sliceDoc(from, to), block, kind, options), block }).range(from, to))
    protectedRanges.push({ from, to })
  }
  syntaxTree(state).iterate({
    enter(ref) {
      const { from, to, name } = ref
      const node = ref.node
      if (name === 'FencedCode' || name === 'CodeBlock' || name === 'Table' || name === 'HTMLBlock' || name === 'HorizontalRule') {
        const diagram = name === 'FencedCode' && /^\s*(?:`{3,}|~{3,})drawio(?:\s|$)/i.test(state.sliceDoc(from, to))
        const selection = state.selection.main
        const selected = !selection.empty && selection.from < to && selection.to > from
        if (diagram ? !selected : !active(from, to, true)) render(from, to, true, name)
        else lineStyle(from, to, name === 'Table' ? 'cm-live-table-source' : name === 'FencedCode' || name === 'CodeBlock' ? 'cm-md-codeblock-line' : 'cm-md-meta')
        protectedRanges.push({ from, to })
        return false
      }
      if (name === 'Paragraph') {
        const text = state.sliceDoc(from, to)
        if (options.math && /^\$\$\s*[\s\S]+?\s*\$\$$/.test(text) && !active(from, to, true)) {
          render(from, to, state.doc.lineAt(from).from === from, 'math')
          return false
        }
        inlineRanges.push({ from, to })
      }
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)
      if (heading) {
        lineStyle(from, to, `cm-md-h${heading[1]}`)
        inlineRanges.push({ from, to })
      }
      if (name === 'HeaderMark') {
        const end = state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to
        if (!active(from, end)) hide(from, end)
        else mark(from, to, 'cm-md-meta')
      }
      if (name === 'Blockquote') lineStyle(from, to, 'cm-live-quote')
      if (name === 'QuoteMark') {
        const end = state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to
        if (!active(from, end)) hide(from, end)
      }
      if (name === 'ListMark') {
        const end = state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to
        if (!active(from, end)) {
          const task = /^\s*\[[ xX]\]/.test(state.sliceDoc(to, state.doc.lineAt(to).to))
          ranges.push(Decoration.replace({ widget: task ? undefined : new ListMarker(/^\d/.test(state.sliceDoc(from, to)) ? state.sliceDoc(from, to).replace(/\)$/, '.') : '•') }).range(from, end))
        }
      }
      if (name === 'TaskMarker') {
        if (!active(from, to)) ranges.push(Decoration.replace({ widget: new TaskCheckbox(/[xX]/.test(state.sliceDoc(from, to))) }).range(from, to))
        if (/\[[xX]\]/.test(state.sliceDoc(from, to))) mark(to, node.parent?.to ?? to, 'cm-md-task-done')
      }
      if (inlineClasses[name]) {
        mark(from, to, inlineClasses[name])
        if (name === 'InlineCode' || name === 'Link' || name === 'Autolink') protectedRanges.push({ from, to })
        if (!active(from, to)) {
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (/^(?:EmphasisMark|StrikethroughMark|CodeMark|LinkMark|URL|LinkTitle|LinkLabel)$/.test(child.name) && !(name === 'Autolink' && child.name === 'URL')) hide(child.from, child.to)
          }
        }
        if (name === 'InlineCode') return false
      }
      if (name === 'Image') {
        protectedRanges.push({ from, to })
        if (!active(from, to)) render(from, to, false, 'image')
        return false
      }
    },
  })
  for (const { from, to } of inlineRanges) {
    const text = state.sliceDoc(from, to)
    for (const match of text.matchAll(/(?<!\\)==([^=\n]+)==|(?<![\\$])\$(?![\s$])([^\n$]+?)(?<!\s)\$(?!\$)/g)) {
      const start = from + match.index!
      const end = start + match[0].length
      if (protectedRanges.some((range) => start < range.to && end > range.from)) continue
      if (match[1]) {
        mark(start, end, 'cm-live-highlight')
        if (!active(start, end)) { hide(start, start + 2); hide(end - 2, end) }
      } else if (options.math && !active(start, end)) render(start, end, false, 'math')
    }
  }
  for (const [position, names] of lines) ranges.push(Decoration.line({ class: [...names].join(' ') }).range(position))
  return Decoration.set(ranges, true)
}

export const livePreviewField = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
  create: (state) => ({ focused: false, decorations: buildPreview(state, false) }),
  update(value, transaction) {
    let focused = value.focused
    for (const effect of transaction.effects) if (effect.is(previewFocus)) focused = effect.value
    if (transaction.docChanged || transaction.selection || focused !== value.focused || syntaxTree(transaction.startState) !== syntaxTree(transaction.state) || transaction.startState.facet(livePreviewOptions) !== transaction.state.facet(livePreviewOptions)) {
      return { focused, decorations: buildPreview(transaction.state, focused) }
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export const livePreview = [
  livePreviewField,
  EditorView.focusChangeEffect.of((_state, focused) => previewFocus.of(focused)),
]
