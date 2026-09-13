/** Per-note client-side encryption: PBKDF2-SHA256 (150k) derives an AES-GCM
 * key from a passphrase; the body is stored as `inkstone-enc:v1:`
 * + base64(salt).base64(iv).base64(ciphertext). The server only ever sees the
 * prefix, so full-text and semantic indexing skip encrypted bodies. */
import { ENCRYPTED_NOTE_PREFIX } from '@shared/constants'

const PBKDF2_ITERATIONS = 150_000

export function isEncryptedNote(content: string): boolean {
    return content.startsWith(ENCRYPTED_NOTE_PREFIX);
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptNoteContent(content: string, passphrase: string): Promise<string> {
    if (passphrase === '') throw new Error('passphrase_required');
    if (isEncryptedNote(content)) throw new Error('already_encrypted');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv as BufferSource },
            key,
            new TextEncoder().encode(content) as BufferSource,
        ),
    );
    return `${ENCRYPTED_NOTE_PREFIX}${toBase64(salt)}.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decryptNoteContent(stored: string, passphrase: string): Promise<string> {
    if (!isEncryptedNote(stored)) throw new Error('not_encrypted');
    const parts = stored.slice(ENCRYPTED_NOTE_PREFIX.length).split('.');
    if (parts.length !== 3) throw new Error('invalid_payload');
    const [saltText, ivText, dataText] = parts as [string, string, string];
    const key = await deriveKey(passphrase, fromBase64(saltText));
    try {
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64(ivText) as BufferSource },
            key,
            fromBase64(dataText) as BufferSource,
        );
        return new TextDecoder().decode(plaintext);
    } catch {
        throw new Error('wrong_passphrase');
    }
}
