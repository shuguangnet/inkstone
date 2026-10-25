import { describe, expect, it } from 'vitest'
import { createDrawioBlock, drawioFenceInfo, EMPTY_DRAWIO_XML, listDrawioBlocks, validateDrawioXml } from './drawio'

describe('editable Draw.io Markdown blocks', () => {
  it('round trips XML, ids, Unicode titles and surrounding prose', () => {
    const block = createDrawioBlock(EMPTY_DRAWIO_XML, 'diagram-one', '\u7f51\u7edc\u7ed3\u6784\u4e0e\u6d41\u7a0b')
    const content = `# Before\n\n${block}\n\nAfter`
    const found = listDrawioBlocks(content)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ id: 'diagram-one', title: '\u7f51\u7edc\u7ed3\u6784\u4e0e\u6d41\u7a0b', xml: EMPTY_DRAWIO_XML, source: block })
    expect(content.slice(found[0]!.from, found[0]!.to)).toBe(block)
  })
  it('ignores examples nested in other fences and unfinished diagrams', () => {
    const block = createDrawioBlock(EMPTY_DRAWIO_XML, 'one', 'One')
    expect(listDrawioBlocks(`\`\`\`\`markdown\n${block}\n\`\`\`\``)).toEqual([])
    expect(listDrawioBlocks(`\`\`\`drawio id=one\n${EMPTY_DRAWIO_XML}`)).toEqual([])
    expect(listDrawioBlocks(`~~~drawio id=one\n${EMPTY_DRAWIO_XML}\n~~~`)).toHaveLength(1)
  })
  it('keeps source containing backtick runs inside a longer fence', () => {
    const xml = EMPTY_DRAWIO_XML.replace('Page-1', '```')
    const block = createDrawioBlock(xml, 'one', 'Code')
    expect(block.startsWith('````drawio')).toBe(true)
    expect(listDrawioBlocks(block)[0]?.xml).toBe(xml)
  })
  it('rejects malformed XML, arbitrary documents, entities and oversized input', () => {
    for (const xml of ['<html/>', '<mxfile>', '<mxfile><diagram></mxfile>', '<!DOCTYPE mxfile><mxfile/>', '<!ENTITY x "bad"><mxfile/>', 'a'.repeat(524289)]) expect(() => validateDrawioXml(xml)).toThrow()
    expect(() => createDrawioBlock(EMPTY_DRAWIO_XML, 'bad id', 'Title')).toThrow()
  })
  it('recognizes raw graph models and preserves compressed mxfile documents', () => {
    expect(validateDrawioXml('<mxGraphModel><root/></mxGraphModel>')).toContain('mxGraphModel')
    expect(validateDrawioXml('<mxfile><diagram>compressed-data</diagram></mxfile>')).toContain('compressed-data')
    expect(drawioFenceInfo('drawio id=one title=%E7%BB%93%E6%9E%84')).toEqual({ id: 'one', title: '\u7ed3\u6784' })
    expect(drawioFenceInfo('javascript')).toBeNull()
  })
})
