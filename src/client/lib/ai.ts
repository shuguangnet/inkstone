import type { MessageKey } from '@shared/locales/en-US'

/** Shared AI action identifiers used by the assistant panel and editor hooks. */
export type AiAction = 
  | 'chat'
  | 'polish'
  | 'expand'
  | 'shorten'
  | 'translate_en'
  | 'translate_zh'
  | 'explain'
  | 'formal'
  | 'casual'
  | 'summarize'
  | 'title'
  | 'tags'
  | 'continue'

export type MessageKeyLike = Parameters<typeof import('../lib/i18n').t>[0]

export const SELECTION_ACTIONS: readonly { action: AiAction; labelKey: MessageKey }[] = [
  { action: 'polish', labelKey: 'ai.action.polish' },
  { action: 'expand', labelKey: 'ai.action.expand' },
  { action: 'shorten', labelKey: 'ai.action.shorten' },
  { action: 'translate_zh', labelKey: 'ai.action.translate_zh' },
  { action: 'translate_en', labelKey: 'ai.action.translate_en' },
  { action: 'explain', labelKey: 'ai.action.explain' },
  { action: 'formal', labelKey: 'ai.action.formal' },
  { action: 'casual', labelKey: 'ai.action.casual' },
]
