import { DOMParser } from '@xmldom/xmldom'

export const DRAWIO_MAX_BYTES = 512 * 1024
export const DRAWIO_ID = /^[a-zA-Z0-9_-]{1,80}$/

export interface DrawioBlock {
  id: string
  title: string
  xml: string
  from: number
  to: number
  source: string
}

export function validateDrawioXml(value: string): string {
  const xml = value.trim()
  if (!xml || new TextEncoder().encode(xml).byteLength > DRAWIO_MAX_BYTES) throw new Error('Draw.io XML must be between 1 byte and 512 KiB')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Draw.io XML must not contain document types or entities')
  let invalid = false
  const doc = new DOMParser({ onError: () => { invalid = true } }).parseFromString(xml, 'application/xml')
  if (invalid || !['mxfile', 'mxGraphModel'].includes(doc.documentElement?.nodeName ?? '')) throw new Error('Expected a valid Draw.io mxfile or mxGraphModel XML document')
  if (doc.getElementsByTagName('mxCell').length > 10000) throw new Error('Draw.io diagrams are limited to 10,000 cells')
  return xml
}

export function drawioFenceInfo(info: string): { id: string; title: string } | null {
  if (!/^drawio(?:\s|$)/i.test(info.trim())) return null
  const id = /(?:^|\s)id=([a-zA-Z0-9_-]{1,80})(?=\s|$)/.exec(info)?.[1] ?? ''
  let title = 'Draw.io'
  try { title = decodeURIComponent(/(?:^|\s)title=(\S+)/.exec(info)?.[1] ?? 'Draw.io').slice(0, 160) } catch {}
  return { id, title }
}

export function createDrawioBlock(xml: string, id: string, title: string): string {
  if (!DRAWIO_ID.test(id)) throw new Error('Invalid diagram id')
  const source = validateDrawioXml(xml)
  const fence = '`'.repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map((match) => match[0].length + 1)))
  const label = title.replace(/[\r\n]/g, ' ').trim().slice(0, 160) || 'Draw.io'
  return `${fence}drawio id=${id} title=${encodeURIComponent(label)}\n${source}\n${fence}`
}

export function listDrawioBlocks(content: string): DrawioBlock[] {
  const result: DrawioBlock[] = []
  const lines = content.split('\n')
  let offset = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!open) { offset += line.length + 1; continue }
    const start = offset
    const marker = open[1]!
    const info = drawioFenceInfo(open[2]!.trim())
    let end = index + 1
    let endOffset = offset + line.length + 1
    while (end < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t\\r]*$`).test(lines[end]!)) {
      endOffset += lines[end]!.length + 1
      end++
    }
    if (end >= lines.length) break
    const to = endOffset + lines[end]!.length
    if (info) result.push({ ...info, xml: lines.slice(index + 1, end).join('\n').trim(), from: start, to, source: content.slice(start, to) })
    index = end
    offset = to + 1
  }
  return result
}

export const EMPTY_DRAWIO_XML = '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'

export const DRAWIO_REFERENCE = `Inkstone stores editable diagrams in fenced drawio blocks inside Markdown. Use list_note_diagrams and read_diagram before changing an existing diagram. Use upsert_diagram with the current expected_rev and a stable operation_id to insert or update one diagram without replacing surrounding prose. Generate native uncompressed mxfile XML (512 KiB maximum), with mxGraphModel/root, mxCell id="0", mxCell id="1" parent="0", unique cell ids, and explicit mxGeometry. Vertices use vertex="1" parent="1", geometry x/y/width/height as="geometry". Edges use edge="1" source/target parent="1", style="edgeStyle=orthogonalEdgeStyle;rounded=1;endArrow=block;", mxGeometry relative="1" as="geometry". Escape XML attribute text (&amp;, &lt;, &quot;). Use readable labels and generous spacing. Flowchart: rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;. Decision: rhombus;whiteSpace=wrap;html=1;. Organization/mind map: hierarchy with connected vertices. Network: swimlanes or labelled service nodes and orthogonal connectors. Existing compressed drawio XML can be read and edited in the built-in Draw.io editor. The official Draw.io MCP at https://mcp.draw.io/mcp may additionally provide search_shapes/get_drawio_reference/create_diagram; that is a separate optional service, and using its hosted endpoint sends diagram data there. Inkstone tools save locally and require no external Draw.io MCP connection.`
