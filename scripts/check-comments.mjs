import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const allowed = new Map([
  ["scripts/check-i18n.mjs", [
    "// The OAuth consent page is a self-contained HTML document with its own",
    "// language switch (cookie-based); it does not use the React i18n layer.",
  ]],
  ["scripts/sync-comments-allowlist.mjs", [
    "// Regenerates the allowlist in scripts/check-comments.mjs so it matches the",
    "// comments actually present in the tree. Run after intentional comment changes:",
    "//",
    "//   node scripts/sync-comments-allowlist.mjs",
    "// The gate itself still fails any NEW comment that is not in the regenerated",
    "// allowlist, so this is a review step, not a bypass.",
  ]],
  ["src/client/editor/codeLanguages.ts", [
    "// Highlighting removed: no code languages are loaded.",
    "// Kept as empty array so the editor behaves as plain Markdown without syntax colors.",
  ]],
  ["src/client/features/ai/AssistantPanel.tsx", [
    "/** Right-side AI assistant panel: chat with the current note as context,\n * quick full-note actions, and streaming responses. */",
    "// Remember the latest assistant output so \"apply\" can write it back.",
  ]],
  ["src/client/features/ai/SelectionToolbar.tsx", [
    "/** Floating toolbar above the current editor selection offering AI actions.\n * Selection state and the write-back callback live in the AI store so the\n * assistant panel can stream results and apply them back to the exact range. */",
  ]],
  ["src/client/features/graph/GraphPanel.tsx", [
    "// Private browsing or a locked-down browser can reject local preferences.",
  ]],
  ["src/client/features/list/CalendarView.tsx", [
    "/** Month calendar aggregating notes by creation date. */",
    "// Monday-first",
  ]],
  ["src/client/features/list/TasksView.tsx", [
    "/** Aggregated open-task view across the whole notebook. */",
  ]],
  ["src/client/features/share/BlogPage.tsx", [
    "/** Public front page of a published blog/wiki collection at /s/blog/:slug. */",
  ]],
  ["src/client/features/share/share-form.ts", [
    "// A new or replaced passcode must be at least 4 characters (the server",
    "// enforces the same minimum); short codes are trivially brute-forced.",
  ]],
  ["src/client/features/templates/TemplateMenu.tsx", [
    "/** \"New from template\" button + picker menu, plus a save-as-template dialog.\n * User templates persist client-side per account (localStorage). */",
  ]],
  ["src/client/lib/ai-diff.ts", [
    "/** Minimal line-level LCS diff for AI rewrite previews. */",
  ]],
  ["src/client/lib/ai.ts", [
    "/** Shared AI action identifiers used by the assistant panel and editor hooks. */",
  ]],
  ["src/client/lib/i18n.ts", [
    "/** Provides typed runtime localization with on-demand locale loading. */",
    "// Preload the other locale in background for instant switching, but don't block init",
  ]],
  ["src/client/lib/markdown/renderer.ts", [
    "/** Builds the sanitized Markdown rendering pipeline and its Inkstone-specific syntax extensions. */",
  ]],
  ["src/client/lib/note-crypto.ts", [
    "/** Per-note client-side encryption: PBKDF2-SHA256 (150k) derives an AES-GCM\n * key from a passphrase; the body is stored as `inkstone-enc:v1:`\n * + base64(salt).base64(iv).base64(ciphertext). The server only ever sees the\n * prefix, so full-text and semantic indexing skip encrypted bodies. */",
  ]],
  ["src/client/lib/sync.ts", [
    "/**\n   * Applies live setting changes (realtime toggle, poll interval) without\n   * tearing down the engine, its WebSocket, or its leadership claim.\n   */",
    "// The engine is created exactly once; later setting changes are pushed",
    "// through updateConfig instead of rebuilding the whole engine.",
  ]],
  ["src/client/store/ai.ts", [
    "/** AI assistant state: status, panel visibility, chat history, streaming. */",
    "/** Registered by the workspace; writes text back via CodeMirror (undo-able). */",
    "/* ignore malformed keep-alive lines */",
    "// Registered at module load so the streaming loop can reuse the same client id.",
  ]],
  ["src/client/store/notes.ts", [
    "/** Coordinates the note cache, offline write-ahead log, optimistic updates, and server synchronization. */",
  ]],
  ["src/client/store/pwa.ts", [
    "// Reset the flag once the toast is gone, so a later installed worker can",
    "// notify again instead of being permanently suppressed.",
  ]],
  ["src/client/store/session.ts", [
    "// Push unsaved offline edits before clearing local data, otherwise",
    "// they would be silently dropped. Dynamic import keeps the session",
    "// store free of a circular dependency on the notes store.",
  ]],
  ["src/shared/constants.ts", [
    "/** Content prefix marking a client-side encrypted note body. */",
  ]],
  ["src/shared/markdown-utils.perf.test.ts", [
    "// 50 large notes: generous CI-stable ceiling for a real regression signal.",
  ]],
  ["src/shared/markdown-utils.ts", [
    "/** Provides pure Markdown analysis shared by the browser and Worker runtimes. */",
  ]],
  ["src/shared/templates.ts", [
    "/** Note templates: built-ins shipped with the app plus per-user saved\n * templates persisted client-side (localStorage, per account). */",
    "/* storage unavailable; templates stay in memory for this session */",
    "/* ignore */",
    "/** Expands a relative date placeholder like {{date}} / {{time}} at insert time. */",
  ]],
  ["src/shared/types.ts", [
    "/** Free-form instructions appended to every AI assistant system prompt. */",
    "/** Title → slug mapping of every published post in the collection, used\n   * to resolve WikiLinks between public notes. */",
    "/** Present when the note belongs to a published blog collection. */",
  ]],
  ["src/worker/ai/prompts.ts", [
    "/** System rules every assistant call receives. User note text is always\n * wrapped in explicit delimiters so instructions inside notes are data. */",
  ]],
  ["src/worker/ai/provider.ts", [
    "/** Yields incremental text deltas; throws on upstream failure. */",
    "/** Parses SSE-ish streams: `data: <json|text>` lines; `[DONE]` terminates. */",
    "/** Chat models usable through the Workers AI binding (curated; the platform\n * has no list endpoint available from inside a Worker). */",
    "/** Extracts model ids from an OpenAI-compatible `/models` response. */",
  ]],
  ["src/worker/ai/quota.ts", [
    "/** Adds consumed characters; overwrites are capped so counters never go negative. */",
    "/** Guards input size and enforces one in-flight AI request per user per isolate. */",
  ]],
  ["src/worker/ai/settings.ts", [
    "/** Plaintext API key; omitted keeps the stored one, empty string removes it. */",
    "// Local runtimes (e.g. Ollama) expose OpenAI-compatible endpoints without",
    "// any key; only the endpoint and model are mandatory.",
  ]],
  ["src/worker/backup/archive-crypto.ts", [
    "/** Passphrase encryption for backup archives stored on third-party targets.\n * Format: MAGIC + base64(salt).base64(iv).base64(ciphertext) — a UTF-8 text\n * payload so targets and restore flows can detect it by prefix. Encryption\n * happens server-side with the passphrase held in the credential vault; the\n * vault never exposes it to the browser. */",
    "/** Buffers a generated archive stream, encrypts it, and re-wraps it as a\n * backup archive with the same filename. Memory peaks at the archive size. */",
  ]],
  ["src/worker/backup/archive.ts", [
    "/** Builds a ZIP from an arbitrary file list — used by the Obsidian/Notion\n * portable vault exports, which intentionally omit Inkstone control files. */",
  ]],
  ["src/worker/backup/restore.ts", [
    "/** Pulls a backup archive back from a WebDAV or S3 target — the read half\n * of bidirectional sync. Restores then flow through the standard import\n * path, so conflict rules and version-safe writes are unchanged. */",
  ]],
  ["src/worker/backup/snapshot.ts", [
    "/** Produces restorable JSON, readable Markdown, and attachment files for every backup target. */",
  ]],
  ["src/worker/db/schema.ts", [
    "/** Defines the idempotent final D1 schema initialized by every Worker isolate. */",
    "// Explicit whitelist (not a regex over SCHEMA_STATEMENTS) so later",
    "// additions like mcp_api_keys can never be picked up accidentally.",
    "// Only CREATE TABLE / INDEX statements: D1 does not reliably support",
    "// ALTER TABLE ADD COLUMN with constraints, so the AI search preference",
    "// lives in app_meta (key `ai-search-enabled:<userId>`) instead of a",
    "// new column on the pre-existing mcp_preferences table.",
    "// Existing installations must converge additively. CREATE IF NOT EXISTS",
    "// never rewrites user data; running table creation before indexes also",
    "// lets a partially initialized database recover missing feature tables.",
  ]],
  ["src/worker/db/writes.ts", [
    "/** Keeps tags, backlinks, full-text indexes, and change records consistent with note writes. */",
  ]],
  ["src/worker/env.ts", [
    "/** Workers AI binding for semantic search; optional so AI search degrades gracefully. */",
  ]],
  ["src/worker/index.ts", [
    "// Codex CLI drops the `iss` callback parameter while its rmcp",
    "// dependency enforces it whenever the authorization server advertises",
    "// `authorization_response_iss_parameter_supported` (openai/codex#31573), so",
    "// login fails even though the parameter is on the wire. Serve the metadata",
    "// without that flag to keep codex compatible; the standard RFC 9207 `iss`",
    "// parameter is still appended to callbacks for conforming clients.",
  ]],
  ["src/worker/lib/external-import.ts", [
    "/** Parsers for third-party note exports. Evernote `.enex` (ENML inside XML)\n * and Notion (Markdown & CSV ZIP) are the supported sources; Notion Markdown\n * ZIPs flow through the existing Markdown/ZIP import path. */",
    "/** Decodes the five XML entities ENML guarantees. */",
    "/** Converts an ENML fragment into Markdown lines. Lists (including the\n * Evernote-specific `<en-todo/>` checkboxes) nest one level per `<ul>`/`<ol>`. */",
    "// Recurse on the list body up to its matching close tag.",
    "/** Extracts every `<note>` from an Evernote export. */",
    "/** True when ANY path segment carries Notion's `Name <32-hex>` identifier. */",
    "/** Strips Notion's 32-hex identifier suffix from every path segment so\n * imported titles and folders read naturally: `Meeting ab12…cd.md` becomes\n * `Meeting.md`. Returns the cleaned path plus the old→new rename pair for\n * each segment that changed, used to rewrite links inside note bodies. */",
    "/** Rewrites Notion's percent-encoded, identifier-bearing links inside a note\n * body so they match the cleaned paths. */",
  ]],
  ["src/worker/lib/request.ts", [
    "// CF-Connecting-IP is injected by the Cloudflare edge and cannot be",
    "// spoofed there. On any other runtime the header is client-controlled,",
    "// so ignore it rather than trusting it for throttling.",
  ]],
  ["src/worker/lib/three-way-merge.ts", [
    "/** Line-level three-way merge for note restore. Each side is diffed against\n * the common base with LCS; per-base-line edits (replacement, deletion, or\n * insertion) from only one side win, identical edits merge cleanly, and\n * conflicting runs keep both versions with markers. */",
    "/** Per base line: null = unchanged; otherwise the replacement lines\n * (deletion = empty array). Insertions attach before the next base line. */",
    "// base line deleted (or replaced by lines already in pending)",
    "// Coalesce consecutive conflicting indices into one block.",
  ]],
  ["src/worker/mcp/ai-search.ts", [
    "/**\n * Private AI semantic search for the MCP module.\n *\n * Notes are embedded with Workers AI (`@cf/baai/bge-m3`, 1024 dims,\n * multilingual) and the vectors live in D1 — no public query endpoint, one\n * index per account. Content changes are queued and drained in the\n * background; when the AI binding is missing or the model call fails the\n * feature degrades to plain lexical search instead of failing (the old\n * behavior that surfaced as HTTP 503s).\n */",
    "// Stored in app_meta instead of a column on mcp_preferences: D1 does not",
    "// reliably support ALTER TABLE ADD COLUMN with constraints, and app_meta",
    "// exists on every database without any migration.",
    "/**\n * Queues a note for embedding (or vector deletion). The single row per note\n * uses last-write-wins semantics: a delete supersedes a pending embed and\n * vice versa. Queuing is skipped entirely while the account has AI search\n * disabled, except deletions which always clean up stale vectors.\n */",
    "/** Encrypted note bodies are opaque ciphertext; skip semantic indexing. */",
    "/**\n * Processes queued embedding jobs. Called from the hourly cron with a large\n * budget and from write paths (via waitUntil) with a small one. Items are\n * processed sequentially so Workers AI rate limits are respected; a failing\n * item stops the batch and is retried on the next run.\n */",
    "// The account turned AI search off; its queue would otherwise grow forever.",
    "/**\n * Semantic retrieval over the account's embedding index. Returns null when\n * AI is unavailable or the query embedding fails; the caller degrades to\n * lexical search.\n */",
    "/**\n * Reciprocal-rank fusion: merges two ranked lists into one by rank, so a\n * note that ranks well in both lexical and semantic search surfaces above\n * one that only appears in a single index.\n */",
    "/** Calls the Workers AI embedding model and returns a Float32Array. */",
    "/** Handles both the `{ data: [{ embedding }] }` and `{ shape, data }` shapes. */",
  ]],
  ["src/worker/mcp/api-keys.ts", [
    "/**\n * Static API keys for MCP access.\n *\n * Small or generic MCP clients (scripts, SDKs, unnamed agents) cannot run the\n * OAuth 2.1 dance, so they authenticate with a plain `Authorization: Bearer\n * <key>` header — the universal HTTP standard. The OAuth provider resolves\n * these tokens through its official `resolveExternalToken` hook; the key is\n * never stored or returned again, only its SHA-256 hash.\n */",
    "// 32 random bytes encoded as unpadded base64url is exactly 43 characters.",
    "/**\n * Resolves a bearer token to an account. Returns null for unknown, revoked,\n * or malformed keys so the OAuth provider can answer with 401 invalid_token.\n */",
  ]],
  ["src/worker/mcp/oauth.ts", [
    "// Static API keys let small or generic MCP clients authenticate with a",
    "// plain `Authorization: Bearer ink_...` header instead of running the",
    "// full OAuth 2.1 dance. Keys are hashed and revocable.",
    "// This path runs before the API handler, so ensure the schema exists",
    "// (cheap after the first request thanks to the initialization cache).",
  ]],
  ["src/worker/mcp/operations.ts", [
    "// The mutation itself failed before committing; remove the pending row",
    "// so the client can retry the same operation_id cleanly.",
    "// The mutation already committed. Keep the pending row so a retry goes",
    "// through the recovery path instead of re-executing and colliding",
    "// (e.g. create_note with the same id).",
  ]],
  ["src/worker/mcp/retrieval.ts", [
    "// AI unavailable, rate-limited, or malformed response: degrade to lexical.",
  ]],
  ["src/worker/routes/auth.ts", [
    "// Account-wide cap so a distributed botnet cannot retry one account",
    "// from many IPs forever; cleared on every successful sign-in, so a",
    "// normal user only ever notices it after 30 failed attempts per hour.",
    "// A successful sign-in proves this identity and IP are legitimate:",
    "// clear every throttling key (identity, IP, and account level) so a",
    "// shared IP / NAT is never locked out by a full window of attempts.",
  ]],
  ["src/worker/routes/backup.ts", [
    "/** Pulls the latest (or a specific) backup archive back from a target and\n * restores it through the standard import path. */",
  ]],
  ["src/worker/routes/files.ts", [
    "// Descriptions are best-effort; uploads never fail because of them.",
  ]],
  ["src/worker/routes/mcp-settings.ts", [
    "// Kick off the first batch immediately; the rest is drained by the cron.",
  ]],
  ["src/worker/routes/share.ts", [
    "/** Public blog index JSON backing the /s/blog/:slug front page. */",
  ]],
  ["src/worker/routes/sync.ts", [
    "// A non-empty `after` key always means the caller is mid-way through a",
    "// full snapshot page chain; keep serving snapshot pages regardless of",
    "// `since`, so following the returned nextKey can never silently drop",
    "// remaining pages.",
    "// Never move the client's cursor backwards, even if it reported a",
    "// seq ahead of the server (e.g. data was trimmed).",
  ]],
  ["src/worker/routes/tasks.ts", [
    "/** Extracts open `- [ ]` task lines across a user's active notes. */",
  ]],
  ["src/worker/routes/transfer.ts", [
    "// Portable vault: readable Markdown plus attachments, no Inkstone",
    "// control files (README/manifest/COMPLETE).",
    "/** Restores a complete Inkstone Markdown backup ZIP (bytes) using the\n * standard import path. Used by the backup-pull restore route. */",
    "// A merge always writes: force the imported timestamp past the local one.",
    "// No base version to merge against: fall through to newer semantics.",
  ]],
  ["vite.config.ts", [
    "// Keep optional preview renderers and their language modules behind dynamic-import boundaries.",
  ]],
])
const found = new Map()
const failures = []
const roots = ['src', 'scripts', 'tests']
const files = [
  ...roots.filter((root) => fs.existsSync(root)).flatMap((root) => [...walk(path.resolve(root))]),
  ...['vite.config.ts', 'vitest.config.ts', 'index.html', 'wrangler.toml'].map((file) => path.resolve(file)),
]

for (const file of files) {
  const extension = path.extname(file).toLowerCase()
  const text = fs.readFileSync(file, 'utf8')
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) scanScript(file, text)
  else if (extension === '.css') scanCss(file, text)
  else if (extension === '.html' && /<!--[\s\S]*?-->/.test(text)) failures.push(`${relative(file)} contains an HTML comment`)
  else if (extension === '.toml' && /^[ \t]*#/m.test(text)) failures.push(`${relative(file)} contains a TOML comment`)
}

let approvedCount = 0
for (const [file, comments] of allowed) {
  approvedCount += comments.length
  const seen = found.get(file)
  for (const comment of comments) {
    if (!seen?.has(comment)) {
      failures.push(`${file} no longer contains an approved comment; remove it from the allowlist: ${preview(comment)}`)
    }
  }
}

if (failures.length) {
  console.error(`comment policy check failed (${failures.length}):`)
  failures.forEach((failure) => console.error(`  ${failure}`))
  process.exit(1)
}

console.log(`comment policy check passed: ${approvedCount} approved English architecture notes across ${allowed.size} files and no other code comments`)

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
    if (!insideLiteral(match.index)) check(file, match[0])
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

function scanCss(file, text) {
  let quote = null
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '/' && text[index + 1] === '*') failures.push(`${relative(file)} contains a CSS comment`)
  }
}

function check(file, comment) {
  const name = relative(file)
  if (!allowed.get(name)?.includes(comment)) {
    failures.push(`${name} contains an unapproved code comment: ${preview(comment)}`)
    return
  }
  const seen = found.get(name) ?? new Set()
  seen.add(comment)
  found.set(name, seen)
}

function preview(comment) {
  const flat = comment.replace(/\s+/g, ' ').trim()
  return flat.length > 96 ? `${flat.slice(0, 96)}...` : flat
}

function relative(file) {
  return path.relative(process.cwd(), file).replaceAll('\\', '/')
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(target)
    else yield target
  }
}
