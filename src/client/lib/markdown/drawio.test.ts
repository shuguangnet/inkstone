import { beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { createDrawioBlock } from '@shared/drawio'
import { renderMarkdown } from './renderer'
import { decodeDataValue } from './data-attr'
import { hydrateDrawio } from './drawio'

beforeAll(async () => { await initI18n() })

describe('Draw.io rendering isolation', () => {
  it('keeps diagram HTML and hostile titles inert in the Markdown document', () => {
    const xml = '<mxfile><diagram><mxGraphModel><root><mxCell value="&lt;img src=x onerror=alert(1)&gt;"/></root></mxGraphModel></diagram></mxfile>'
    const title = '"><img src=x onerror=alert(1)>'
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown(createDrawioBlock(xml, 'test', title)).html
    expect(root.querySelector('img,script,svg,mxfile')).toBeNull()
    const block = root.querySelector<HTMLElement>('[data-drawio]')!
    expect(decodeDataValue(block.dataset.drawio).trim()).toBe(xml)
    expect(block.querySelector('figcaption span')?.textContent).toBe(title)
    expect(block.dataset.drawioId).toBe('test')
    document.body.append(root)
    hydrateDrawio(root)
    const frame = block.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toBe('/drawio-viewer.html')
    root.remove()
  })
  it('leaves ordinary fenced XML as code', () => {
    const html = renderMarkdown('```xml\n<mxfile/>\n```').html
    expect(html).not.toContain('data-drawio')
    expect(html).toContain('&lt;mxfile/&gt;')
  })
})
