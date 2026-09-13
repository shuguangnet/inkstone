import { Hono, type Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { LIMITS } from '@shared/constants'
import type { PublicNote, ShareInfo } from '@shared/types'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { isValidSlug, newSlug } from '../lib/id'
import { JSON_BODY_LIMITS, readJson, readOptionalJson, requestClientIp } from '../lib/request'
import { hashPassword, verifyPassword } from '../lib/password'
import {
  createShareAssetSession,
  shareAssetCookieName,
} from '../lib/share-asset-session'
import {
  assertNotLocked,
  clearLoginFailures,
  consumeAttemptBudget,
  recordLoginFailure,
  ThrottleError,
} from '../lib/throttle'
import { requireAuth } from '../middleware/auth'


export const shareManageRoutes = new Hono<AppBindings>()

export const shareRoutes = new Hono<AppBindings>()

export const sharePageRoutes = new Hono<AppBindings>()

interface ShareRow {
  slug: string
  note_id: string
  user_id: string
  password_hash: string | null
  expires_at: number | null
  views: number
  created_at: number
}

function toShareInfo(row: ShareRow, origin: string): ShareInfo {
  return {
    slug: row.slug,
    noteId: row.note_id,
    url: `${origin}/s/${row.slug}`,
    hasPassword: Boolean(row.password_hash),
    expiresAt: row.expires_at,
    views: row.views,
    createdAt: row.created_at,
  }
}


shareManageRoutes.use('*', requireAuth)

shareManageRoutes.post('/blog', async (c) => {
  const userId = c.get('userId')
  const body = await readJson<{ folderId?: unknown }>(c, JSON_BODY_LIMITS.small)
  if (typeof body?.folderId !== 'string' || body.folderId === '') {
    throw ApiError.badRequest('Missing folderId')
  }
  const folder = await c.env.DB.prepare(
    'SELECT id, name FROM folders WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL',
  ).bind(body.folderId, userId).first<{ id: string; name: string }>()
  if (folder === null) throw ApiError.notFound('Folder not found')

  const noteRows = await c.env.DB.prepare(
    `SELECT id, title FROM notes
      WHERE user_id = ?1 AND folder_id = ?2 AND deleted_at IS NULL AND is_archived = 0
      ORDER BY updated_at DESC`,
  ).bind(userId, folder.id).all<{ id: string; title: string }>()
  const notes = noteRows.results ?? []
  if (notes.length === 0) throw ApiError.badRequest('The folder has no publishable notes')

  const now = Date.now()
  const slugs: Array<{ slug: string; title: string }> = []
  for (const note of notes) {
    let slugRow = await c.env.DB.prepare(
      'SELECT slug FROM shares WHERE note_id = ?1 AND user_id = ?2',
    ).bind(note.id, userId).first<{ slug: string }>()
    if (slugRow === null) {
      const slug = newSlug()
      await c.env.DB.prepare(
        `INSERT INTO shares (slug, note_id, user_id, password_hash, expires_at, views, created_at)
         VALUES (?1, ?2, ?3, NULL, NULL, 0, ?4)`,
      ).bind(slug, note.id, userId, now).run()
      slugRow = { slug }
    }
    slugs.push({ slug: slugRow.slug, title: note.title })
  }

  const slug = newSlug()
  await c.env.DB.prepare(
    `INSERT INTO blog_collections (slug, user_id, folder_id, title, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(slug, userId, folder.id, folder.name, now, now).run()
  await c.env.DB.prepare(
    'DELETE FROM blog_collections WHERE folder_id = ?1 AND user_id = ?2 AND slug <> ?3',
  ).bind(folder.id, userId, slug).run()

  return c.json({ slug, url: `${new URL(c.req.url).origin}/s/blog/${slug}`, title: folder.name, notes: slugs.length })
})

shareManageRoutes.delete('/blog/:slug', async (c) => {
  const userId = c.get('userId')
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) throw ApiError.badRequest('Invalid blog slug')
  await c.env.DB.prepare(
    'DELETE FROM blog_collections WHERE slug = ?1 AND user_id = ?2',
  ).bind(slug, userId).run()
  return c.json({ ok: true })
})

shareManageRoutes.get('/:noteId', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM shares WHERE note_id = ?1 AND user_id = ?2`,
  )
    .bind(c.req.param('noteId'), c.get('userId'))
    .first<ShareRow>()
  if (!row) return c.json({ share: null })
  return c.json({ share: toShareInfo(row, new URL(c.req.url).origin) })
})

shareManageRoutes.post('/:noteId', async (c) => {
  const userId = c.get('userId')
  const noteId = c.req.param('noteId')
  const body = await readJson<{ password?: string | null; expiresIn?: number | null }>(c, JSON_BODY_LIMITS.small)

  const note = await c.env.DB.prepare(
    `SELECT id FROM notes WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(noteId, userId)
    .first<{ id: string }>()
  if (!note) throw ApiError.notFound('Note not found')

  const slug = newSlug()
  if (body.password !== undefined && body.password !== null && typeof body.password !== 'string') {
    throw ApiError.badRequest('password must be a string or null')
  }
  if (typeof body.password === 'string' && body.password.length > LIMITS.passwordMaxLength) {
    throw ApiError.badRequest(`The access password must not exceed ${LIMITS.passwordMaxLength} characters`)
  }
  if (typeof body.password === 'string' && body.password.length > 0 && body.password.length < 4) {
    throw ApiError.badRequest('The access password must be at least 4 characters')
  }
  if (
    body.expiresIn !== undefined &&
    body.expiresIn !== null &&
    (!Number.isFinite(body.expiresIn) || body.expiresIn < 0)
  ) {
    throw ApiError.badRequest('expiresIn must be a non-negative number or null')
  }
  const expiresAt =
    typeof body.expiresIn === 'number' && body.expiresIn > 0
        ? Date.now() + Math.min(body.expiresIn, 365 * 24 * 60 * 60 * 1000)
        : null

  const replacePassword = body.password === null || typeof body.password === 'string'
  const passwordHash =
    body.password === null
      ? null
      : typeof body.password === 'string' && body.password
        ? await hashPassword(body.password)
        : null

  const written = await c.env.DB.prepare(
    `INSERT INTO shares (slug, note_id, user_id, password_hash, expires_at, views, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
     ON CONFLICT(note_id) DO UPDATE SET
       password_hash = CASE WHEN ?7 = 1 THEN excluded.password_hash ELSE shares.password_hash END,
       expires_at = CASE WHEN ?8 = 1 THEN excluded.expires_at ELSE shares.expires_at END
     WHERE shares.user_id = excluded.user_id`,
  )
    .bind(
      slug,
      noteId,
      userId,
      passwordHash,
      expiresAt,
      Date.now(),
      replacePassword ? 1 : 0,
      body.expiresIn !== undefined ? 1 : 0,
    )
    .run()
  if (!written.meta.changes) throw new ApiError(409, 'conflict', 'Share state changed. Refresh and try again')

  const row = await c.env.DB.prepare(`SELECT * FROM shares WHERE note_id = ?1 AND user_id = ?2`)
    .bind(noteId, userId)
    .first<ShareRow>()
  return c.json({ share: toShareInfo(row!, new URL(c.req.url).origin) })
})

shareManageRoutes.delete('/:noteId', async (c) => {
  const noteId = c.req.param('noteId')
  const userId = c.get('userId')
  await c.env.DB.prepare(`DELETE FROM shares WHERE note_id = ?1 AND user_id = ?2`)
    .bind(noteId, userId)
    .run()
  return c.json({ ok: true })
})


/** Public blog index JSON backing the /s/blog/:slug front page. */
shareRoutes.get('/blog/:slug', async (c) => {
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) throw ApiError.notFound('The blog does not exist')
  const collection = await c.env.DB.prepare(
    'SELECT slug, user_id, folder_id, title FROM blog_collections WHERE slug = ?1',
  ).bind(slug).first<{ slug: string; user_id: string; folder_id: string; title: string }>()
  if (collection === null) throw ApiError.notFound('The blog does not exist')
  const { results } = await c.env.DB.prepare(
    `SELECT s.slug, n.title, n.excerpt, n.updated_at
       FROM notes n JOIN shares s ON s.note_id = n.id AND s.user_id = n.user_id
      WHERE n.user_id = ?1 AND n.folder_id = ?2 AND n.deleted_at IS NULL AND n.is_archived = 0
      ORDER BY n.updated_at DESC`,
  ).bind(collection.user_id, collection.folder_id).all<{
    slug: string
    title: string
    excerpt: string
    updated_at: number
  }>()
  const posts = (results ?? []).map((row) => ({
    slug: row.slug,
    title: row.title || 'Untitled note',
    excerpt: row.excerpt,
    updatedAt: row.updated_at,
  }))
  return c.json({
    slug: collection.slug,
    title: collection.title,
    siteName: c.env.APP_NAME || 'Inkstone',
    posts,
  })
})

shareRoutes.post('/:slug', async (c) => {
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) throw ApiError.notFound('The link does not exist or has been revoked')
  const body = await readOptionalJson<{ password?: string }>(c, JSON_BODY_LIMITS.small, {})
  const password = typeof body.password === 'string'
    ? body.password.slice(0, LIMITS.passwordMaxLength)
    : ''

  const share = await c.env.DB.prepare(`SELECT * FROM shares WHERE slug = ?1`)
    .bind(slug)
    .first<ShareRow>()
  if (!share) throw ApiError.notFound('The link does not exist or has been revoked')
  if (share.expires_at && share.expires_at < Date.now()) throw ApiError.notFound('The link has expired')

  if (share.password_hash) {
    if (!password) {
      return c.json({ error: { code: 'password_required', message: 'An access password is required' } }, 401)
    }
    const throttleKeys = [
      `share:${slug}:ip:${requestClientIp(c)}`,
      { key: `share-slug:${slug}`, freeFails: 40 },
    ]
    const workKeys = [
      {
        key: `share-work:${slug}:ip:${requestClientIp(c)}`,
        maxAttempts: 8,
        windowMs: 10 * 60 * 1000,
      },
      {
        key: `share-work-slug:${slug}`,
        maxAttempts: 60,
        windowMs: 10 * 60 * 1000,
      },
    ]
    try {
      await consumeAttemptBudget(c.env.DB, workKeys)
      await assertNotLocked(c.env.DB, throttleKeys)
    } catch (err) {
      if (err instanceof ThrottleError) {
        throw new ApiError(429, 'too_many_attempts', `Too many attempts. Try again in ${err.retryAfterSec} seconds`, {
          retryAfter: err.retryAfterSec,
        })
      }
      throw err
    }
    if (!(await verifyPassword(password, share.password_hash))) {
      await recordLoginFailure(c.env.DB, throttleKeys)
      return c.json({ error: { code: 'password_invalid', message: "Incorrect passcode" } }, 401)
    }
    await clearLoginFailures(c.env.DB, [
      ...throttleKeys,
      ...workKeys.map((target) => target.key),
    ])
  }

  const note = await c.env.DB.prepare(
    `SELECT n.title, n.content, n.folder_id, n.created_at, n.updated_at, u.name, u.avatar_url
       FROM notes n JOIN users u ON u.id = n.user_id
      WHERE n.id = ?1 AND n.user_id = ?2 AND n.deleted_at IS NULL`,
  )
    .bind(share.note_id, share.user_id)
    .first<{
      title: string
      content: string
      folder_id: string | null
      created_at: number
      updated_at: number
      name: string
      avatar_url: string
    }>()
  if (!note) throw ApiError.notFound('The note has been deleted')

  c.executionCtx?.waitUntil(
    c.env.DB.prepare(`UPDATE shares SET views = views + 1 WHERE slug = ?1`).bind(slug).run().catch(() => {}),
  )

  if (share.password_hash) {
    const expiresAt = Math.min(
      share.expires_at ?? Number.MAX_SAFE_INTEGER,
      Date.now() + 12 * 60 * 60 * 1000,
    )
    const token = await createShareAssetSession(c.env.DB, slug, share.password_hash, expiresAt)
    setCookie(c, shareAssetCookieName(slug), token, {
      path: '/api/files/',
      httpOnly: true,
      sameSite: 'Strict',
      maxAge: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
      secure: new URL(c.req.url).protocol === 'https:',
    })
  }

  const blogRow = await c.env.DB.prepare(
    'SELECT slug, title FROM blog_collections WHERE user_id = ?1 AND folder_id = ?2',
  ).bind(share.user_id, note.folder_id).first<{ slug: string; title: string }>()
  let blog: PublicNote['blog']
  if (blogRow && note.folder_id !== null) {
    const linked = await c.env.DB.prepare(
      `SELECT n.title, s.slug
         FROM notes n JOIN shares s ON s.note_id = n.id AND s.user_id = n.user_id
        WHERE n.user_id = ?1 AND n.folder_id = ?2 AND n.deleted_at IS NULL AND n.is_archived = 0`,
    ).bind(share.user_id, note.folder_id).all<{ title: string; slug: string }>()
    blog = {
      slug: blogRow.slug,
      title: blogRow.title,
      links: (linked.results ?? [])
        .filter((row) => row.title !== '')
        .map((row) => ({ title: row.title, slug: row.slug })),
    }
  }

  const body_: PublicNote = {
    title: note.title,
    content: note.content,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    author: { name: note.name, avatarUrl: note.avatar_url },
    site: { name: c.env.APP_NAME || 'Inkstone' },
    share: { slug },
    ...(blog === undefined ? {} : { blog }),
  }
  return c.json(body_)
})


sharePageRoutes.get('/blog/:slug', async (c) => {
  const slug = c.req.param('slug')
  const url = new URL(c.req.url)
  let collection: { title: string } | null = null
  if (isValidSlug(slug)) {
    collection = await c.env.DB.prepare(
      'SELECT title FROM blog_collections WHERE slug = ?1',
    ).bind(slug).first<{ title: string }>()
  }
  const shell = await renderShareShell(c, url, null)
  if (collection === null) return shell
  let html = await shell.text()
  const siteName = c.env.APP_NAME || 'Inkstone'
  const meta = [
    `<title>${escapeHtml(collection.title)} · ${escapeHtml(siteName)}</title>`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(collection.title)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta name="robots" content="noindex, nofollow" />`,
  ].join('\n    ')
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '').replace('</head>', `    ${meta}\n  </head>`)
  return c.html(html, 200, {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  })
})

sharePageRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const url = new URL(c.req.url)

  if (!isValidSlug(slug)) {
    return renderShareShell(c, url, null)
  }

  const row = await c.env.DB.prepare(
    `SELECT s.password_hash, s.expires_at, n.title, n.excerpt
       FROM shares s JOIN notes n ON n.id = s.note_id AND n.user_id = s.user_id
      WHERE s.slug = ?1 AND n.deleted_at IS NULL`,
  )
    .bind(slug)
    .first<{ password_hash: string | null; expires_at: number | null; title: string; excerpt: string }>()

  return renderShareShell(c, url, row)
})

async function renderShareShell(
  c: Context<AppBindings>,
  url: URL,
  row: { password_hash: string | null; expires_at: number | null; title: string; excerpt: string } | null,
) {
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin)))
  if (!shell.ok) return shell
  let html = await shell.text()

  const siteName = c.env.APP_NAME || 'Inkstone'
  const expired = row?.expires_at ? row.expires_at < Date.now() : false
  const title = row && !expired && !row.password_hash ? publicShareTitle(row.title) : "Content unavailable"
  const description = row && !expired && !row.password_hash ? row.excerpt : ''

  const meta = [
    `<title>${escapeHtml(title)} · ${escapeHtml(siteName)}</title>`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}" />` : '',
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="robots" content="noindex, nofollow" />`,
  ]
    .filter(Boolean)
    .join('\n    ')

  html = html.replace(/<title>[\s\S]*?<\/title>/i, '').replace('</head>', `    ${meta}\n  </head>`)

  return c.html(html, 200, {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  })
}

export function publicShareTitle(title: string): string {
  return title || 'Untitled note'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
