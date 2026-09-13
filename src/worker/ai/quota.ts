const MAX_INPUT_CHARS = 32_000
const MAX_MESSAGE_CHARS = 8_000

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export interface AiQuotaState {
  usedChars: number
  quotaChars: number
  remainingChars: number
}

export async function loadQuota(
  db: D1Database,
  userId: string,
  quotaChars: number,
): Promise<AiQuotaState> {
  const row = await db
    .prepare('SELECT chars FROM ai_usage WHERE user_id = ?1 AND day = ?2')
    .bind(userId, todayKey())
    .first<{ chars: number }>()
  const usedChars = row?.chars ?? 0
  return { usedChars, quotaChars, remainingChars: Math.max(0, quotaChars - usedChars) }
}

/** Adds consumed characters; overwrites are capped so counters never go negative. */
export async function recordUsage(db: D1Database, userId: string, chars: number): Promise<void> {
  if (chars <= 0) return
  await db.prepare(
    `INSERT INTO ai_usage (user_id, day, chars, requests) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET
       chars = chars + excluded.chars,
       requests = requests + 1`,
  )
    .bind(userId, todayKey(), chars)
    .run()
}

/** Guards input size and enforces one in-flight AI request per user per isolate. */
export class AiGuard {
  private static readonly inflight = new Set<string>()

  static validateInput(action: string, userMessage: string, selection: string, noteContent: string): void {
    if (userMessage.length > MAX_MESSAGE_CHARS) throw new Error('ai_message_too_long')
    const total = selection.length + noteContent.length
    if (total > MAX_INPUT_CHARS) throw new Error('ai_input_too_long')
    if (!/^[a-z_]+$/.test(action)) throw new Error('ai_action_invalid')
  }

  static acquire(userId: string): boolean {
    if (AiGuard.inflight.has(userId)) return false
    AiGuard.inflight.add(userId)
    return true
  }

  static release(userId: string): void {
    AiGuard.inflight.delete(userId)
  }
}
