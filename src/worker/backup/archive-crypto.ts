/** Passphrase encryption for backup archives stored on third-party targets.
 * Format: MAGIC + base64(salt).base64(iv).base64(ciphertext) — a UTF-8 text
 * payload so targets and restore flows can detect it by prefix. Encryption
 * happens server-side with the passphrase held in the credential vault; the
 * vault never exposes it to the browser. */

const MAGIC = 'inkstone-benc:v1:'
const PBKDF2_ITERATIONS = 150_000

export const ARCHIVE_ENCRYPTION_MAGIC = MAGIC

export function isEncryptedArchive(payload: Uint8Array): boolean {
  if (payload.byteLength < MAGIC.length) return false
  const prefix = new TextDecoder().decode(payload.slice(0, MAGIC.length))
  return prefix === MAGIC
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptArchiveBytes(payload: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (passphrase === '') throw new Error('passphrase_required')
  if (isEncryptedArchive(payload)) return payload
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, payload as BufferSource),
  )
  const text = `${MAGIC}${toBase64(salt)}.${toBase64(iv)}.${toBase64(ciphertext)}`
  return new TextEncoder().encode(text)
}

export async function decryptArchiveBytes(
  payload: Uint8Array,
  passphrase: string | null,
): Promise<Uint8Array> {
  if (!isEncryptedArchive(payload)) return payload
  if (passphrase === null || passphrase === '') throw new Error('archive_passphrase_required')
  const text = new TextDecoder().decode(payload)
  const parts = text.slice(MAGIC.length).split('.')
  if (parts.length !== 3) throw new Error('invalid_archive_payload')
  const [saltText, ivText, dataText] = parts as [string, string, string]
  const key = await deriveKey(passphrase, fromBase64(saltText))
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivText) as BufferSource },
      key,
      fromBase64(dataText) as BufferSource,
    )
    return new Uint8Array(plaintext)
  } catch {
    throw new Error('archive_wrong_passphrase')
  }
}

/** Buffers a generated archive stream, encrypts it, and re-wraps it as a
 * backup archive with the same filename. Memory peaks at the archive size. */
export async function encryptArchive(
  archive: import('./archive').BackupArchive,
  passphrase: string,
): Promise<import('./archive').BackupArchive> {
  const reader = archive.stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const encrypted = await encryptArchiveBytes(bytes, passphrase)
  return {
    filename: archive.filename,
    byteLength: BigInt(encrypted.byteLength),
    byteLengthNumber: encrypted.byteLength,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encrypted)
        controller.close()
      },
    }),
  }
}
