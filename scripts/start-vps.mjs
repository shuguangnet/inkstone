import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicUrl = requiredPublicUrl(process.env.INKSTONE_PUBLIC_URL)
const scheduleToken = requiredScheduleToken(process.env.INKSTONE_SCHEDULE_TOKEN)
const dataDir = process.env.INKSTONE_DATA_DIR || '/data'
const appName = (process.env.INKSTONE_APP_NAME || 'Inkstone').trim()
const logLevel = process.env.INKSTONE_LOG_LEVEL || 'info'

if (!isAbsolute(dataDir)) throw new Error('INKSTONE_DATA_DIR must be an absolute path')
if (!appName || appName.length > 80) throw new Error('INKSTONE_APP_NAME must contain 1-80 characters')
if (!['debug', 'info', 'log', 'warn', 'error', 'none'].includes(logLevel)) {
  throw new Error('INKSTONE_LOG_LEVEL is invalid')
}

mkdirSync(dataDir, { recursive: true })

const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const child = spawn(process.execPath, [
  wrangler,
  'dev',
  '--config', 'dist/inkstone_vps/wrangler.json',
  '--local',
  '--ip', '0.0.0.0',
  '--port', '7712',
  '--persist-to', dataDir,
  '--log-level', logLevel,
  '--show-interactive-dev-session', 'false',
  '--var', `PUBLIC_URL:${publicUrl}`,
  '--var', `APP_NAME:${appName}`,
  '--var', `SCHEDULE_TOKEN:${scheduleToken}`,
], { stdio: 'inherit' })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})

function requiredPublicUrl(value) {
  if (!value) throw new Error('INKSTONE_PUBLIC_URL is required')
  const url = new URL(value)
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new Error('INKSTONE_PUBLIC_URL must use HTTPS, except for localhost')
  }
  return url.origin
}

function requiredScheduleToken(value) {
  if (!value || value.length < 32 || value.startsWith('replace-')) {
    throw new Error('INKSTONE_SCHEDULE_TOKEN must be a random value of at least 32 characters')
  }
  return value
}
