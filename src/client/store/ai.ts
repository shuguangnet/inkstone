/** AI assistant state: status, panel visibility, chat history, streaming. */
import { create } from 'zustand'
import { api, ApiError } from '../lib/api'
import { getLocale } from '../lib/i18n'
import type { AiAction } from '../lib/ai'

export interface AiStatus {
  available: boolean
  reason: 'disabled' | 'not_configured' | null
  settings: {
    enabled: boolean
    provider: 'workers_ai' | 'openai_compat'
    model: string
    baseUrl: string
    hasKey: boolean
    dailyCharQuota: number
  }
  usage: { usedChars: number; quotaChars: number }
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: AiAction
  error?: string
  sources?: AiCitationSource[]
}

export interface AiCitationSource {
  index: number
  noteId: string
  title: string
}

export interface AiSelection {
  text: string
  from: number
  to: number
}

interface AiState {
  panelOpen: boolean
  selection: AiSelection | null
  /** Registered by the workspace; writes text back via CodeMirror (undo-able). */
  selectionWriter: ((text: string) => void) | null
  lastPolishedBase: string | null
  lastResultTarget: 'selection' | 'note' | null
  status: AiStatus | null
  statusLoaded: boolean
  messages: AiChatMessage[]
  streaming: boolean
  activeAction: AiAction
  setSelection: (selection: AiSelection | null) => void
  registerSelectionWriter: (writer: ((text: string) => void) | null) => void
  replaceSelection: (text: string) => void
  togglePanel: () => void
  setPanelOpen: (open: boolean) => void
  loadStatus: (force?: boolean) => Promise<void>
  setActiveAction: (action: AiAction) => void
  stop: () => void
  send: (input: {
    action?: AiAction
    noteTitle?: string
    noteContent?: string
    selection?: string
    message?: string
  }) => Promise<void>
}

let controller: AbortController | null = null
let messageSeq = 0

function nextId(): string {
  messageSeq += 1
  return `ai-${Date.now()}-${messageSeq}`
}

export const useAi = create<AiState>((set, get) => ({
  panelOpen: false,
  selection: null,
  selectionWriter: null,
  lastPolishedBase: null,
  lastResultTarget: null,
  status: null,
  statusLoaded: false,
  messages: [],
  streaming: false,
  activeAction: 'chat',

  togglePanel: () => get().setPanelOpen(!get().panelOpen),
  setPanelOpen: (open) => {
    set({ panelOpen: open })
    if (open) void get().loadStatus()
  },

  loadStatus: async (force = false) => {
    if (get().statusLoaded && !force) return
    try {
      const status = await api.ai.status()
      set({ status, statusLoaded: true })
    } catch {
      set({ status: null, statusLoaded: true })
    }
  },

  setActiveAction: (action) => set({ activeAction: action }),

  setSelection: (selection) => set({ selection }),

  registerSelectionWriter: (writer) => set({ selectionWriter: writer }),

  replaceSelection: (text) => {
    const writer = get().selectionWriter
    if (writer === null) return
    writer(text)
    set({ selection: null })
  },

  stop: () => {
    controller?.abort()
    controller = null
    set({ streaming: false })
  },

  send: async (input) => {
    if (get().streaming) return
    const action = input.action ?? get().activeAction
    const userText = input.message ?? ''
    if (userText === '' && input.selection === undefined && action === 'chat') return
    if (action === 'polish' && input.selection === undefined && input.noteContent !== undefined) {
      set({ lastPolishedBase: input.noteContent })
    }
    set({ lastResultTarget: input.selection !== undefined ? 'selection' : 'note' })
    const userMessage: AiChatMessage = {
      id: nextId(),
      role: 'user',
      content: userText || labelForAction(action),
      action,
    }
    const assistantId = nextId()
    const history: AiChatMessage[] = [...get().messages, userMessage]
    set({
      messages: [...history, { id: assistantId, role: 'assistant', content: '', action }],
      streaming: true,
    })
    controller = new AbortController()
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Inkstone-Client': '1',
          'Accept-Language': getLocale(),
        },
        signal: controller.signal,
        body: JSON.stringify({
          action,
          locale: getLocale(),
          noteTitle: input.noteTitle,
          noteContent: input.noteContent,
          selection: input.selection,
          message: userText === '' ? undefined : userText,
          history: get().messages
            .filter((message) => message.content !== '' && !message.error)
            .slice(-12)
            .map((message) => ({ role: message.role, content: message.content })),
        }),
      })
      if (!response.ok || !response.body) {
        const code = await errorCodeOf(response)
        failAssistant(assistantId, code)
        return
      }
      await consumeStream(response.body, assistantId)
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      failAssistant(assistantId, error instanceof ApiError ? error.code : 'ai_unavailable')
    } finally {
      controller = null
      set({ streaming: false })
      void get().loadStatus(true)
    }
  },
}))

async function errorCodeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string } }
    return body.error?.code ?? `http_${response.status}`
  } catch {
    return `http_${response.status}`
  }
}

async function consumeStream(body: ReadableStream<Uint8Array>, assistantId: string): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const appendDelta = (delta: string) => {
    const { messages } = useAi.getState()
    const target = messages.find((message) => message.id === assistantId)
    if (!target) return
    useAi.setState({
      messages: messages.map((message) =>
        message.id === assistantId ? { ...message, content: message.content + delta } : message),
    })
  }
  const markError = (code: string) => failAssistant(assistantId, code)
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line.startsWith('data:')) continue
      try {
        const payload = JSON.parse(line.slice(5)) as {
          delta?: string
          done?: boolean
          error?: string
          sources?: AiCitationSource[]
        }
        if (payload.sources) {
          const { messages } = useAi.getState()
          useAi.setState({
            messages: messages.map((message) =>
              message.id === assistantId ? { ...message, sources: payload.sources } : message),
          })
        }
        if (payload.delta) appendDelta(payload.delta)
        if (payload.error) markError(payload.error)
      } catch { /* ignore malformed keep-alive lines */ }
    }
  }
}

function failAssistant(assistantId: string, code: string): void {
  const { messages } = useAi.getState()
  useAi.setState({
    messages: messages.map((message) =>
      message.id === assistantId && message.content === ''
        ? { ...message, error: code }
        : message),
  })
}

function labelForAction(action: AiAction): string {
  return action
}

// Registered at module load so the streaming loop can reuse the same client id.
export const AI_CLIENT_ID = 'assistant'
