import { describe, expect, it } from 'vitest'
import {
  millisecondsUntilNextMinute,
  scheduledCronForDate,
} from '../scripts/vps-scheduler.mjs'

describe('VPS scheduler', () => {
  it('maps UTC trigger minutes to the configured Cloudflare cron expressions', () => {
    expect(scheduledCronForDate(new Date('2026-08-16T10:00:00Z'))).toBe('0 * * * *')
    expect(scheduledCronForDate(new Date('2026-08-16T10:15:00Z'))).toBe('15,45 * * * *')
    expect(scheduledCronForDate(new Date('2026-08-16T10:45:00Z'))).toBe('15,45 * * * *')
    expect(scheduledCronForDate(new Date('2026-08-16T10:30:00Z'))).toBeNull()
  })

  it('waits until just after the next minute boundary', () => {
    expect(millisecondsUntilNextMinute(Date.parse('2026-08-16T10:00:30.000Z'))).toBe(30_100)
    expect(millisecondsUntilNextMinute(Date.parse('2026-08-16T10:00:59.900Z'))).toBe(200)
  })
})
