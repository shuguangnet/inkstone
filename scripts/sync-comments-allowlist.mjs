// Regenerates the allowlist in scripts/check-comments.mjs so it matches the
// comments actually present in the tree. Run after intentional comment changes:
//
//   node scripts/sync-comments-allowlist.mjs
//
// The gate itself still fails any NEW comment that is not in the regenerated
// allowlist, so this is a review step, not a bypass.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const roots = ['src', 'scripts', 'tests']
const files = [
  ...roots.filter((root) => fs.existsSync(root)).flatMap((root) => [...walk(path.resolve(root))]),
  ...['vite.config.ts', 'vitest.config.ts', 'index.html', 'wrangler.toml'].map((file) => path.resolve(file)),
]

const found = new Map()
for (const file of files) {
  const extension = path.extname(file).toLowerCase()
  const text = fs.readFileSync(file, 'utf8')
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) scanScript(file, text)
}

const entries = [...found.entries()]
  .filter(([, comments]) => comments.length > 0)
  .sort(([left], [right]) => left.localeCompare(right))

const rendered = entries.map(([file, comments]) => {
  const items = comments.map((comment) => JSON.stringify(comment)).join(',\n    ')
  return `  [${JSON.stringify(file)}, [\n    ${items},\n  ]],`
}).join('\n')

const checkerPath = path.resolve('scripts/check-comments.mjs')
let source = fs.readFileSync(checkerPath, 'utf8')
const start = source.indexOf('const allowed = new Map([')
const end = source.indexOf('\n])', start)
if (start === -1 || end === -1) throw new Error('allowlist block not found in check-comments.mjs')
source = `${source.slice(0, start)}const allowed = new Map([\n${rendered}${source.slice(end)}`
fs.writeFileSync(checkerPath, source)
console.log(`allowlist synced: ${entries.length} files, ${entries.reduce((sum, [, list]) => sum + list.length, 0)} comments`)

function scanScript(file, text) {
  const scriptKind = file.endsWith('.tsx') || file.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind)
  const literalRanges = []
  collectLiterals(source)
  literalRanges.sort((left, right) => left.start - right.start)

  const comments = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g
  for (const match of text.matchAll(comments)) {
    if (!insideLiteral(match.index)) collect(file, match[0])
  }

  function collectLiterals(node) {
    if (
      ts.isRegularExpressionLiteral(node) ||
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) literalRanges.push({ start: node.getStart(source), end: node.getEnd() })
    ts.forEachChild(node, collectLiterals)
  }

  function insideLiteral(index) {
    return literalRanges.some((range) => index >= range.start && index < range.end)
  }
}

function collect(file, comment) {
  const name = path.relative(process.cwd(), file).replaceAll('\\', '/')
  const list = found.get(name) ?? []
  if (!list.includes(comment)) list.push(comment)
  found.set(name, list)
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(target)
    else yield target
  }
}
