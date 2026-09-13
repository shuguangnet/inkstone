import type { Env } from '../env'

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatRequest {
  messages: readonly AiMessage[]
  maxTokens?: number
  temperature?: number
}

/** Yields incremental text deltas; throws on upstream failure. */
export type AiStream = AsyncGenerator<string>

export interface AiProvider {
  readonly id: 'workers_ai' | 'openai_compat'
  readonly model: string
  stream(request: AiChatRequest): AsyncGenerator<string>
}

const DEFAULT_MAX_TOKENS = 2_048

export class WorkersAiProvider implements AiProvider {
  readonly id = 'workers_ai' as const
  constructor(
    private readonly ai: NonNullable<Env['AI']>,
    readonly model: string,
  ) {}

  async *stream(request: AiChatRequest): AiStream {
    const stream = await this.ai.run(this.model, {
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? 0.7,
      stream: true,
    }) as ReadableStream<Uint8Array>
    for await (const delta of parseDataLines(stream, (payload) => {
      if (typeof payload === 'string') return payload
      if (payload && typeof payload === 'object') {
        const response = (payload as Record<string, unknown>).response
        if (typeof response === 'string') return response
      }
      return ''
    })) {
      yield delta
    }
  }
}

export class OpenAiCompatProvider implements AiProvider {
  readonly id = 'openai_compat' as const
  constructor(
    private readonly apiKey: string | null,
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async *stream(request: AiChatRequest): AiStream {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey !== null) headers.Authorization = `Bearer ${this.apiKey}`
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        stream: true,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature ?? 0.7,
      }),
    })
    if (!response.ok || !response.body) {
      throw new Error(`ai_upstream_error_${response.status}`)
    }
    for await (const delta of parseDataLines(response.body, (payload) => {
      if (payload && typeof payload === 'object') {
        const choices = (payload as Record<string, unknown>).choices
        if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
          const delta = (choices[0] as Record<string, unknown>).delta
          if (delta && typeof delta === 'object') {
            const content = (delta as Record<string, unknown>).content
            if (typeof content === 'string') return content
          }
        }
      }
      return ''
    })) {
      yield delta
    }
  }
}

/** Parses SSE-ish streams: `data: <json|text>` lines; `[DONE]` terminates. */
async function* parseDataLines(
  body: ReadableStream<Uint8Array>,
  extract: (payload: unknown) => string,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        const delta = parseLine(line, extract)
        if (delta) yield delta
      }
    }
    const tail = parseLine(buffer.replace(/\r$/, ''), extract)
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}

function parseLine(line: string, extract: (payload: unknown) => string): string {
  if (line === '' || line === 'data: [DONE]') return ''
  const payload = line.startsWith('data:') ? line.slice(5).trim() : line
  if (payload === '') return ''
  try {
    return extract(JSON.parse(payload))
  } catch {
    return extract(payload)
  }
}

/** Chat models usable through the Workers AI binding (curated; the platform
 * has no list endpoint available from inside a Worker). */
export const WORKERS_AI_CHAT_MODELS: readonly string[] = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-2-7b-chat-int8',
  '@cf/qwen/qwen1.5-14b-chat-awq',
  '@cf/mistral/mistral-7b-instruct-v0.1',
]

/** Extracts model ids from an OpenAI-compatible `/models` response. */
export function parseModelsResponse(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const data = (payload as Record<string, unknown>).data
  if (!Array.isArray(data)) return []
  const ids: string[] = []
  for (const item of data) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const id = (item as Record<string, unknown>).id
      if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

export function resolveAiModel(settings: { provider: string; model: string }): string {
  if (settings.provider === 'openai_compat') {
    if (!settings.model) throw new Error('ai_model_not_configured')
    return settings.model
  }
  return settings.model || 'DEFAULT'
}
