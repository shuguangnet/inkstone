/** Pulls a backup archive back from a WebDAV or S3 target — the read half
 * of bidirectional sync. Restores then flow through the standard import
 * path, so conflict rules and version-safe writes are unchanged. */
import { LIMITS } from '@shared/constants'
import type { BackupTargetConfig, S3Config } from '@shared/types'
import { client, objectUrl, type S3Secret } from './s3'
import {
  childUrl,
  webdavFetch,
} from './webdav'

const RESTORE_MAX_BYTES = Math.min(LIMITS.importUploadMaxBytes * 4, 512 * 1024 * 1024)

export function archiveObjectPath(stamp: string): { directory: string; filename: string } {
  return { directory: 'backups', filename: `inkstone-backup-${stamp}.zip` }
}

function s3Key(config: S3Config, stamp: string): string {
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '')
  const { directory, filename } = archiveObjectPath(stamp)
  return prefix === '' ? `${directory}/${filename}` : `${prefix}/${directory}/${filename}`
}

function webdavPath(config: { prefix: string }, stamp: string): string {
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '')
  const { directory, filename } = archiveObjectPath(stamp)
  return prefix === '' ? `${directory}/${filename}` : `${prefix}/${directory}/${filename}`
}

export async function fetchBackupArchive(
  config: BackupTargetConfig,
  secret: { password?: string; accessKeyId?: string; secretAccessKey?: string },
  stamp: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if ('endpoint' in config) {
    const s3Config = config as import('@shared/types').S3Config
    const aws = client(secret as S3Secret, s3Config)
    const key = s3Key(s3Config, stamp)
    const response = await aws.fetch(objectUrl(s3Config, key), { signal, redirect: 'manual' })
    return readAll(response, stamp)
  }
  const webdav = config as { url: string; username: string; prefix: string }
  const base = new URL(webdav.url)
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('Invalid WebDAV URL')
  const auth = 'Basic ' + btoa(`${webdav.username}:${secret.password ?? ''}`)
  const target = webdavPath(webdav, stamp)
  const response = await webdavFetch(childUrl(base, target), {
    method: 'GET',
    headers: { Authorization: auth },
    signal,
  }, base.origin, false)
  return readAll(response, stamp)
}

async function readAll(response: Response, stamp: string): Promise<Uint8Array> {
  if (response.status === 404) {
    throw new Error(`No backup archive ${archiveObjectPath(stamp).filename} exists on the target`)
  }
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)
  const declared = Number(response.headers.get('Content-Length') ?? '0')
  if (declared > RESTORE_MAX_BYTES) throw new Error('The remote backup exceeds the restore size limit')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The remote backup response has no body')
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > RESTORE_MAX_BYTES) {
      await reader.cancel()
      throw new Error('The remote backup exceeds the restore size limit')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}
