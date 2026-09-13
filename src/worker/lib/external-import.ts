/** Parsers for third-party note exports. Evernote `.enex` (ENML inside XML)
 * and Notion (Markdown & CSV ZIP) are the supported sources; Notion Markdown
 * ZIPs flow through the existing Markdown/ZIP import path. */

export interface ExternalNote {
    title: string;
    content: string;
    createdAt?: string;
}

/** Decodes the five XML entities ENML guarantees. */
export function decodeXmlEntities(text: string): string {
    return text
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replaceAll(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replaceAll('&amp;', '&');
}

function stripTags(html: string): string {
    return decodeXmlEntities(html.replace(/<[^>]*>/g, ''))
}

function inlineToMarkdown(fragment: string): string {
    return decodeXmlEntities(
        fragment
            .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
            .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
            .replace(/<(code|pre)>([\s\S]*?)<\/\1>/gi, '`$2`'),
    )
}

const BLOCK_TAG = /<\/(h[1-6]|p|div|ul|ol|li|en-todo|en-media|en-crypt)>|<(h[1-6]|p|div|ul|ol|li|en-todo|en-media|en-crypt)((?:\s[^>]*)?)\/?>|<br\s*\/?>/gi

/** Converts an ENML fragment into Markdown lines. Lists (including the
 * Evernote-specific `<en-todo/>` checkboxes) nest one level per `<ul>`/`<ol>`. */
function convertFragmentLines(fragment: string, depth: number): string[] {
    const out: string[] = []
    let paragraph = ''
    let liText = ''
    let liPrefix: string | null = null
    let headingLevel: number | null = null
    let lastIndex = 0

    const flushParagraph = () => {
        const text = paragraph.replace(/\s+/g, ' ').trim()
        if (text !== '') {
            out.push(headingLevel === null ? text : `${'#'.repeat(headingLevel)} ${text}`)
        }
        paragraph = ''
        headingLevel = null
    }
    const flushLi = () => {
        if (liPrefix === null) return
        const text = liText.replace(/\s+/g, ' ').trim()
        out.push(`${'  '.repeat(depth)}${liPrefix} ${text}`.trimEnd())
        liText = ''
        liPrefix = null
    }
    const absorb = (text: string) => {
        if (liPrefix !== null) liText += text
        else paragraph += text
    }

    let match: RegExpExecArray | null
    BLOCK_TAG.lastIndex = 0
    while ((match = BLOCK_TAG.exec(fragment)) !== null) {
        absorb(inlineToMarkdown(fragment.slice(lastIndex, match.index)))
        lastIndex = match.index + match[0].length
        const closing = match[1] !== undefined
        const tag = (match[1] ?? match[2])!.toLowerCase()
        const attrs = match[3] ?? ''
        if (tag === 'br') { flushParagraph(); continue }
        if (closing) {
            if (tag === 'li') { flushLi(); continue }
            if (tag === 'ul' || tag === 'ol') { flushLi(); continue }
            if (tag === 'en-todo') { flushLi(); continue }
            flushParagraph()
            continue
        }
        if (tag === 'en-todo') {
            flushParagraph()
            flushLi()
            liPrefix = /checked\s*=\s*"true"/i.test(attrs) ? '- [x]' : '- [ ]'
            liText = ''
            continue
        }
        if (tag === 'li') {
            flushLi()
            liPrefix = '-'
            liText = ''
            continue
        }
        if (tag === 'ul' || tag === 'ol') {
            flushParagraph()
            flushLi()
            // Recurse on the list body up to its matching close tag.
            const closeTag = `</${tag}>`
            const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi')
            let nesting = 1
            let cursor = lastIndex
            let end = -1
            let nested: RegExpExecArray | null
            while ((nested = openRe.exec(fragment)) !== null) {
                if (nested.index > cursor || true) {
                    const closeIndex = fragment.indexOf(closeTag, cursor)
                    if (nested.index < closeIndex || closeIndex === -1) nesting++
                }
                const closeIndex = fragment.indexOf(closeTag, cursor)
                if (closeIndex === -1) break
                if (nested.index < closeIndex) { nesting++; cursor = closeIndex + closeTag.length }
                else { cursor = nested.index + nested[0].length; break }
            }
            const closeIndex = fragment.indexOf(closeTag, lastIndex)
            end = closeIndex === -1 ? fragment.length : closeIndex
            out.push(...convertFragmentLines(fragment.slice(lastIndex, end), depth + 1))
            void nesting
            BLOCK_TAG.lastIndex = end
            lastIndex = end
            continue
        }
        if (tag === 'en-media' || tag === 'en-crypt') {
            flushParagraph()
            out.push('> [inkstone] unsupported Evernote block skipped')
            continue
        }
        if (/^h[1-6]$/.test(tag)) {
            flushParagraph()
            headingLevel = Number(tag[1])
            continue
        }
        flushParagraph()
    }
    absorb(inlineToMarkdown(fragment.slice(lastIndex)))
    flushParagraph()
    flushLi()
    return out
}

function convertEnmlFragment(fragment: string): string {
    return convertFragmentLines(fragment, 0)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** Extracts every `<note>` from an Evernote export. */
export function parseEvernoteEnex(xml: string): ExternalNote[] {
    const notes: ExternalNote[] = []
    const noteBlock = /<note>([\s\S]*?)<\/note>/gi
    let noteMatch: RegExpExecArray | null
    while ((noteMatch = noteBlock.exec(xml)) !== null) {
        const body = noteMatch[1]!
        const title = stripTags(/<title>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? '').trim() || 'Untitled'
        const created = /<created>([\s\S]*?)<\/created>/i.exec(body)?.[1]?.trim()
        const contentMatch = /<en-note([^>]*)>([\s\S]*?)<\/en-note>/i.exec(body)
        const content = contentMatch === null ? '' : convertEnmlFragment(contentMatch[2] ?? '')
        if (content === '') continue
        notes.push({
            title: title.slice(0, 512),
            content,
            createdAt: created !== undefined && /^\d{8}T\d{6}Z$/.test(created)
                ? `${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}T${created.slice(9, 11)}:${created.slice(11, 13)}:${created.slice(13, 15)}Z`
                : undefined,
        })
    }
    return notes
}

const NOTION_IDENTIFIER = / ([0-9a-f]{32})(\.[^.]+)?$/
const NOTION_SEGMENT_WITH_EXT = /^(.*) ([0-9a-f]{32})(\.[^.]+)?$/i

/** True when ANY path segment carries Notion's `Name <32-hex>` identifier. */
export function isNotionExportEntry(path: string): boolean {
  return path.split('/').some((segment) => NOTION_IDENTIFIER.test(segment))
}

/** Strips Notion's 32-hex identifier suffix from every path segment so
 * imported titles and folders read naturally: `Meeting ab12…cd.md` becomes
 * `Meeting.md`. Returns the cleaned path plus the old→new rename pair for
 * each segment that changed, used to rewrite links inside note bodies. */
export function stripNotionIdentifiers(path: string): {
  readonly path: string
  readonly renames: readonly { readonly from: string; readonly to: string }[]
} {
  const segments = path.split('/')
  const renames: { from: string; to: string }[] = []
  const cleaned: string[] = []
  for (const [index, segment] of segments.entries()) {
    const match = NOTION_SEGMENT_WITH_EXT.exec(segment)
    if (match === null || match[1] === '') {
      cleaned.push(segment)
      continue
    }
    const cleanedSegment = `${match[1]!}${match[3] ?? ''}`
    const from = segments.slice(0, index + 1).join('/')
    const to = [...cleaned, cleanedSegment].join('/')
    cleaned.push(cleanedSegment)
    renames.push({ from, to })
  }
  return { path: cleaned.join('/'), renames }
}

/** Rewrites Notion's percent-encoded, identifier-bearing links inside a note
 * body so they match the cleaned paths. */
export function rewriteNotionLinks(content: string, renames: readonly {
  readonly from: string
  readonly to: string
}[]): string {
  let result = content
  for (const rename of renames) {
    result = result
      .replaceAll(encodeURI(rename.from), rename.to)
      .replaceAll(rename.from.replaceAll(' ', '%20'), rename.to)
      .replaceAll(rename.from, rename.to)
  }
  return result
}
