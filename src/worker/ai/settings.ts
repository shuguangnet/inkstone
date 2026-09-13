import { decryptAiCredential, encryptAiCredential } from '../lib/crypto'
import type { Env } from '../env'

export type AiProvider = 'workers_ai' | 'openai_compat'

export interface AiSettingsRow {
  user_id: string
  enabled: number
  provider: AiProvider
  model: string
  base_url: string
  credential: string | null
  daily_char_quota: number
  updated_at: number
}

export interface AiSettings {
  enabled: boolean
  provider: AiProvider
  model: string
  baseUrl: string
  hasKey: boolean
  dailyCharQuota: number
}

export const DEFAULT_CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const DEFAULT_QUOTA_CHARS = 50_000

function toSettings(row: AiSettingsRow | null): AiSettings {
  return {
    enabled: row?.enabled === 1,
    provider: row?.provider === 'openai_compat' ? 'openai_compat' : 'workers_ai',
    model: row?.model ?? '',
    baseUrl: row?.base_url ?? '',
    hasKey: Boolean(row?.credential),
    dailyCharQuota: row?.daily_char_quota ?? DEFAULT_QUOTA_CHARS,
  }
}

export async function loadAiSettings(db: D1Database, userId: string): Promise<AiSettings> {
  const row = await db
    .prepare('SELECT * FROM ai_settings WHERE user_id = ?1')
    .bind(userId)
    .first<AiSettingsRow>()
  return toSettings(row)
}

export interface SaveAiSettingsInput {
  enabled?: boolean
  provider?: AiProvider
  model?: string
  baseUrl?: string
  /** Plaintext API key; omitted keeps the stored one, empty string removes it. */
  apiKey?: string
  dailyCharQuota?: number
}

export async function saveAiSettings(
  env: Env,
  userId: string,
  input: SaveAiSettingsInput,
): Promise<AiSettings> {
  const current = await loadAiSettings(env.DB, userId)
  const provider = input.provider ?? current.provider
  let model = (input.model ?? current.model).trim()
  const baseUrl = (input.baseUrl ?? current.baseUrl).trim()
  if (provider === 'workers_ai' && !model) model = DEFAULT_CHAT_MODEL
  let credential = (await loadRow(env, userId))?.credential ?? null
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim()
    if (trimmed === '') {
      credential = null
    } else {
      if (trimmed.length > 4096) throw new Error('ai_key_too_long')
      credential = await encryptAiCredential(env, userId, trimmed)
    }
  }
  const quota = Math.max(0, Math.min(
    input.dailyCharQuota ?? current.dailyCharQuota,
    5_000_000,
  ))
  const enabled = input.enabled ?? current.enabled
  // Completeness (endpoint/model present) is enforced at chat time via the
  // availability check, so users can save a draft configuration without the
  // UI rejecting intermediate states (e.g. right after switching provider).
  if (baseUrl !== '' && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('ai_base_url_invalid')
  }
  await env.DB.prepare(
    `INSERT INTO ai_settings
       (user_id, enabled, provider, model, base_url, credential, daily_char_quota, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       provider = excluded.provider,
       model = excluded.model,
       base_url = excluded.base_url,
       credential = excluded.credential,
       daily_char_quota = excluded.daily_char_quota,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, enabled ? 1 : 0, provider, model, baseUrl, credential, quota, Date.now())
    .run()
  return loadAiSettings(env.DB, userId)
}

async function loadRow(env: Env, userId: string): Promise<AiSettingsRow | null> {
  return env.DB.prepare('SELECT * FROM ai_settings WHERE user_id = ?1')
    .bind(userId)
    .first<AiSettingsRow>()
}

export async function loadAiApiKey(env: Env, userId: string): Promise<string | null> {
  const row = await loadRow(env, userId)
  if (!row?.credential) return null
  return decryptAiCredential(env, userId, row.credential)
}
