import { Hono } from 'hono'
import { z } from 'zod'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { searchMcpNotes } from '../mcp/retrieval'
import { requireAuth } from '../middleware/auth'
import { buildChatMessages, type AiAction } from './prompts'
import { AiGuard, loadQuota, recordUsage } from './quota'
import {
  OpenAiCompatProvider,
  parseModelsResponse,
  WORKERS_AI_CHAT_MODELS,
  WorkersAiProvider,
  type AiProvider,
} from './provider'
import { loadAiApiKey, loadAiSettings, saveAiSettings, type SaveAiSettingsInput } from './settings'

const ACTIONS: readonly AiAction[] = [
  'chat', 'polish', 'expand', 'shorten', 'translate_en', 'translate_zh',
  'explain', 'formal', 'casual', 'summarize', 'title', 'tags', 'continue',
]

const chatRequestSchema = z.object({
  action: z.enum(ACTIONS as [AiAction, ...AiAction[]]),
  locale: z.enum(['en-US', 'zh-CN']),
  noteTitle: z.string().max(512).optional(),
  noteContent: z.string().optional(),
  selection: z.string().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(8_000),
  })).max(24).optional(),
  message: z.string().max(8_000).optional(),
})

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['workers_ai', 'openai_compat']).optional(),
  model: z.string().max(200).optional(),
  baseUrl: z.string().max(2_000).optional(),
  apiKey: z.string().max(4_096).optional(),
  dailyCharQuota: z.number().int().min(0).max(5_000_000).optional(),
})

export const aiRoutes = new Hono<AppBindings>()

aiRoutes.use('*', requireAuth)

aiRoutes.get('/status', async (c) => {
  const userId = c.get('userId')
  const settings = await loadAiSettings(c.env.DB, userId)
  const quota = await loadQuota(c.env.DB, userId, settings.dailyCharQuota)
  const available = aiAvailable(c.env, settings)
  return c.json({
    available,
    reason: available ? null : (c.env.AI || settings.hasKey ? 'disabled' : 'not_configured'),
    settings: {
      enabled: settings.enabled,
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl,
      hasKey: settings.hasKey,
      dailyCharQuota: settings.dailyCharQuota,
    },
    usage: { usedChars: quota.usedChars, quotaChars: quota.quotaChars },
  })
})

aiRoutes.get('/models', async (c) => {
  const userId = c.get('userId')
  const settings = await loadAiSettings(c.env.DB, userId)
  if (settings.provider === 'workers_ai') {
    return c.json({ models: WORKERS_AI_CHAT_MODELS, source: 'curated' })
  }
  const apiKey = await loadAiApiKey(c.env, userId)
  if (settings.baseUrl === '') {
    throw new ApiError(409, 'ai_not_configured', 'Save an endpoint and API key first')
  }
  let response: Response
  try {
    response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: apiKey === null ? {} : { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    throw new ApiError(502, 'ai_unavailable', 'Could not reach the model endpoint')
  }
  if (!response.ok) {
    throw new ApiError(502, 'ai_unavailable', `The endpoint returned ${response.status}`)
  }
  const payload: unknown = await response.json().catch(() => null)
  const models = parseModelsResponse(payload)
  if (models.length === 0) throw new ApiError(502, 'ai_unavailable', 'The endpoint returned no models')
  return c.json({ models, source: 'endpoint' })
})

aiRoutes.put('/settings', async (c) => {
  const userId = c.get('userId')
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw ApiError.badRequest('Invalid AI settings payload')
  const input = parsed.data as SaveAiSettingsInput
  try {
    const settings = await saveAiSettings(c.env, userId, input)
    return c.json({ ok: true, settings: { ...settings } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ai_settings_invalid'
    if (message === 'ai_openai_compat_requires_endpoint') {
      throw ApiError.badRequest('OpenAI-compatible providers need an endpoint')
    }
    if (message === 'ai_openai_compat_requires_model') {
      throw ApiError.badRequest('OpenAI-compatible providers need a model')
    }
    throw ApiError.badRequest('Invalid AI settings payload')
  }
})

aiRoutes.get('/usage', async (c) => {
  const userId = c.get('userId')
  const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { results } = await c.env.DB.prepare(
    'SELECT day, chars, requests FROM ai_usage WHERE user_id = ?1 AND day >= ?2 ORDER BY day ASC',
  ).bind(userId, since).all<{ day: string; chars: number; requests: number }>()
  return c.json({ days: results ?? [] })
})

aiRoutes.post('/chat', async (c) => {
  const userId = c.get('userId')
  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw ApiError.badRequest('Invalid AI chat payload')
  const body = parsed.data

  const settings = await loadAiSettings(c.env.DB, userId)
  if (!settings.enabled || !aiAvailable(c.env, settings)) {
    throw new ApiError(409, 'ai_not_configured', 'AI assistant is not configured')
  }
  AiGuard.validateInput(body.action, body.message ?? '', body.selection ?? '', body.noteContent ?? '')
  const quota = await loadQuota(c.env.DB, userId, settings.dailyCharQuota)
  const estimated = (body.selection?.length ?? 0) + (body.noteContent?.length ?? 0) + (body.message?.length ?? 0)
  if (quota.remainingChars < Math.min(estimated, 1_000)) {
    throw new ApiError(429, 'ai_quota_exceeded', 'Daily AI quota exhausted')
  }
  if (!AiGuard.acquire(userId)) {
    throw new ApiError(429, 'ai_busy', 'Another AI request is already running')
  }

  let context: { noteId: string; title: string; snippet: string }[] | undefined
  if (body.action === 'ask' && (body.message ?? '') !== '') {
    try {
      const retrieval = await searchMcpNotes(
        c.env, userId, new URL(c.req.url).origin, c.get('database').ftsEnabled,
        { query: body.message!, limit: 6, mode: 'auto' },
      )
      context = retrieval.results.map((hit) => ({ noteId: hit.id, title: hit.title, snippet: hit.snippet }))
    } catch {
      context = undefined
    }
  }

  const userSettings = asRecord(safeParseJson(c.get('user').settingsRaw))
  const userAi = asRecord(userSettings.ai)
  const customInstructions = typeof userAi.customInstructions === 'string'
    ? userAi.customInstructions
    : undefined

  const messages = buildChatMessages({
    customInstructions,
    action: body.action,
    context,
    noteTitle: body.noteTitle,
    noteContent: body.noteContent,
    selection: body.selection,
    history: body.history,
    userMessage: body.message,
  })

  let provider: AiProvider
  try {
    provider = await resolveProvider(c.env, userId, settings)
  } catch (error) {
    AiGuard.release(userId)
    if (error instanceof ApiError) throw error
    throw new ApiError(409, 'ai_not_configured', 'AI provider is not fully configured')
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let consumed = 0
      try {
        if (context !== undefined && context.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            sources: context.map((entry, index) => ({ index: index + 1, noteId: entry.noteId, title: entry.title })),
          })}\n\n`))
        }
        for await (const delta of provider.stream({ messages })) {
          consumed += delta.length
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`))
        }
        await recordUsage(c.env.DB, userId, consumed)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, chars: consumed })}\n\n`))
      } catch (error) {
        const code = error instanceof Error && error.message.startsWith('ai_upstream_error')
          ? 'ai_unavailable' : 'ai_unavailable'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: code })}\n\n`))
        if (consumed > 0) await recordUsage(c.env.DB, userId, consumed)
      } finally {
        AiGuard.release(userId)
        controller.close()
      }
    },
    cancel() {
      AiGuard.release(userId)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  })
})

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeParseJson(text: string | undefined): unknown {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function aiAvailable(env: AppBindings['Bindings'], settings: {
  enabled: boolean
  provider: string
  hasKey: boolean
  baseUrl: string
  model: string
}): boolean {
  if (!settings.enabled) return false
  if (settings.provider === 'workers_ai') return Boolean(env.AI)
  return settings.baseUrl !== '' && settings.model !== ''
}

export async function resolveProvider(
  env: AppBindings['Bindings'],
  userId: string,
  settings: Awaited<ReturnType<typeof loadAiSettings>>,
): Promise<AiProvider> {
  if (settings.provider === 'workers_ai') {
    if (!env.AI) throw new ApiError(409, 'ai_not_configured', 'Workers AI binding is missing')
    return new WorkersAiProvider(env.AI, settings.model)
  }
  const apiKey = await loadAiApiKey(env, userId)
  if (!settings.baseUrl || !settings.model) {
    throw new ApiError(409, 'ai_not_configured', 'OpenAI-compatible provider is not fully configured')
  }
  return new OpenAiCompatProvider(apiKey, settings.baseUrl, settings.model)
}
