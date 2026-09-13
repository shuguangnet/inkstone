import { Hono } from 'hono'
import { z } from 'zod'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { buildChatMessages, type AiAction } from './prompts'
import { AiGuard, loadQuota, recordUsage } from './quota'
import { OpenAiCompatProvider, WorkersAiProvider, type AiProvider } from './provider'
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
    if (message === 'ai_openai_compat_requires_endpoint_and_key') {
      throw ApiError.badRequest('OpenAI-compatible providers need an endpoint and an API key')
    }
    throw ApiError.badRequest('Invalid AI settings payload')
  }
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

  const messages = buildChatMessages({
    action: body.action,
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

function aiAvailable(env: AppBindings['Bindings'], settings: {
  enabled: boolean
  provider: string
  hasKey: boolean
  baseUrl: string
  model: string
}): boolean {
  if (!settings.enabled) return false
  if (settings.provider === 'workers_ai') return Boolean(env.AI)
  return settings.hasKey && settings.baseUrl !== '' && settings.model !== ''
}

async function resolveProvider(
  env: AppBindings['Bindings'],
  userId: string,
  settings: Awaited<ReturnType<typeof loadAiSettings>>,
): Promise<AiProvider> {
  if (settings.provider === 'workers_ai') {
    if (!env.AI) throw new ApiError(409, 'ai_not_configured', 'Workers AI binding is missing')
    return new WorkersAiProvider(env.AI, settings.model)
  }
  const apiKey = await loadAiApiKey(env, userId)
  if (!apiKey || !settings.baseUrl || !settings.model) {
    throw new ApiError(409, 'ai_not_configured', 'OpenAI-compatible provider is not fully configured')
  }
  return new OpenAiCompatProvider(apiKey, settings.baseUrl, settings.model)
}
