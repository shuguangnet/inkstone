import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { history, undo } from '@codemirror/commands'
import { mergeSettings } from '@shared/constants'
import { livePreview, livePreviewField } from './live-preview'

function editor(doc: string, cursor = doc.length) {
  let state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage }), history(), livePreview] })
  const effect = state.facet(EditorView.focusChangeEffect)[0]!(state, true)!
  state = state.update({ effects: effect }).state
  return state
}

function decorations(state: EditorState) {
  const result: { from: number; to: number; className?: string; replacement: boolean; kind?: string }[] = []
  state.field(livePreviewField).decorations.between(0, state.doc.length, (from, to, decoration) => {
    result.push({ from, to, className: decoration.spec.class, replacement: decoration.spec.widget !== undefined || decoration.spec.inclusive !== undefined || (!decoration.spec.class && from < to), kind: decoration.spec.widget?.kind })
  })
  return result
}

function hiddenText(state: EditorState) {
  return decorations(state).filter((range) => range.replacement).map(({ from, to }) => state.sliceDoc(from, to))
}

describe('live Markdown editing', () => {
  it('renders completed inline syntax and headings without changing saved Markdown', () => {
    const doc = '# Heading\n\n**bold** and *italic* and ~~gone~~ and `code` and ==marked=='
    const state = editor(doc)
    expect(state.doc.toString()).toBe(doc)
    expect(hiddenText(state)).toEqual(expect.arrayContaining(['# ', '**', '*', '~~', '`', '==']))
    expect(decorations(state).map((range) => range.className)).toEqual(expect.arrayContaining(['cm-md-h1', 'cm-md-strong', 'cm-md-em', 'cm-md-strike', 'cm-md-code', 'cm-live-highlight']))
  })

  it('reveals inline syntax at the cursor and across all selected ranges', () => {
    const state = editor('**bold** plain', 4)
    expect(hiddenText(state)).not.toContain('**')
    const moved = state.update({ selection: { anchor: state.doc.length } }).state
    expect(hiddenText(moved)).toEqual(['**', '**'])
    const selected = moved.update({ selection: EditorSelection.range(0, moved.doc.length) }).state
    expect(hiddenText(selected)).toEqual([])
  })

  it('renders on the closing delimiter transaction and preserves undo', () => {
    let state = editor('**bold*')
    state = state.update({ changes: { from: state.doc.length, insert: '*' }, selection: { anchor: 8 }, userEvent: 'input.type' }).state
    expect(hiddenText(state)).toEqual(['**', '**'])
    expect(undo({ state, dispatch: (transaction) => { state = transaction.state } })).toBe(true)
    expect(state.doc.toString()).toBe('**bold*')
  })

  it('renders tables and fenced code away from the cursor, then reveals them for editing', () => {
    const doc = '| A | B |\n| --- | --- |\n| C | D |\n\n```md\n**literal**\n```\n\nEnd'
    const state = editor(doc)
    expect(decorations(state).map((range) => range.kind)).toEqual(expect.arrayContaining(['Table', 'FencedCode']))
    expect(hiddenText(state)).not.toContain('**')
    const table = state.update({ selection: { anchor: 3 } }).state
    expect(decorations(table).map((range) => range.kind)).not.toContain('Table')
    expect(table.doc.toString()).toBe(doc)
  })

  it('keeps formatting examples inside inline and fenced code literal', () => {
    const state = editor('`**literal** ==literal== $x$`\n\n```md\n# raw\n- [ ] raw\n```\n\nEnd')
    expect(decorations(state).map((range) => range.className)).not.toContain('cm-md-strong')
    expect(decorations(state).map((range) => range.className)).not.toContain('cm-live-highlight')
    expect(decorations(state).filter((range) => range.kind === 'math')).toEqual([])
  })

  it('renders image, formula, link and task syntax without dropping source content', () => {
    const doc = '![alt](https://example.com/image.png)\n\n$x^2$ and [label](https://example.com)\n\n- [ ] task\n\nEnd'
    const state = editor(doc)
    expect(decorations(state).map((range) => range.kind)).toEqual(expect.arrayContaining(['image', 'math']))
    expect(hiddenText(state)).toContain('https://example.com')
    expect(hiddenText(state)).toContain('[ ]')
    expect(state.doc.toString()).toBe(doc)
  })

  it('enables live preview for existing settings and preserves an explicit source preference', () => {
    expect(mergeSettings({ editor: { fontSize: 17 } }).editor.livePreview).toBe(true)
    expect(mergeSettings({ editor: { livePreview: false } }).editor.livePreview).toBe(false)
    expect(mergeSettings({}).preview.layout).toBe('edit')
  })
})
