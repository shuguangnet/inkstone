import { pathToFileURL } from 'node:url'

const DEFAULT_ENDPOINT = 'http://app:7712/_internal/scheduled'

export function scheduledCronForDate(date) {
  const minute = date.getUTCMinutes()
  if (minute === 0) return '0 * * * *'
  if (minute === 15 || minute === 45) return '15,45 * * * *'
  return null
}

export function millisecondsUntilNextMinute(now = Date.now()) {
  return 60_000 - (now % 60_000) + 100
}

async function trigger(endpoint, cron) {
  const token = process.env.INKSTONE_SCHEDULE_TOKEN
  if (!token) throw new Error('INKSTONE_SCHEDULE_TOKEN is required')
  const url = new URL(endpoint)
  url.searchParams.set('cron', cron)
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(300_000),
  })
  if (!response.ok) throw new Error(`scheduled endpoint returned ${response.status}`)
  console.log(`[inkstone-scheduler] completed ${cron} at ${new Date().toISOString()}`)
}

async function main() {
  const endpoint = process.env.INKSTONE_SCHEDULE_URL || DEFAULT_ENDPOINT
  console.log(`[inkstone-scheduler] targeting ${endpoint}`)

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, millisecondsUntilNextMinute()))
    const cron = scheduledCronForDate(new Date())
    if (!cron) continue
    try {
      await trigger(endpoint, cron)
    } catch (error) {
      console.error(`[inkstone-scheduler] ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
