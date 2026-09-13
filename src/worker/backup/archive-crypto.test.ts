import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_ENCRYPTION_MAGIC,
  decryptArchiveBytes,
  encryptArchiveBytes,
  isEncryptedArchive,
} from './archive-crypto';

describe('backup archive encryption', () => {
  it('round-trips bytes under a passphrase', async () => {
    const payload = new TextEncoder().encode('PK\x03\x04 fake zip bytes');
    const encrypted = await encryptArchiveBytes(payload, 'secret-pass');
    expect(new TextDecoder().decode(encrypted).startsWith(ARCHIVE_ENCRYPTION_MAGIC)).toBe(true);
    expect(isEncryptedArchive(encrypted)).toBe(true);
    const decrypted = await decryptArchiveBytes(encrypted, 'secret-pass');
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(payload));
  });

  it('leaves plain archives untouched and rejects wrong passphrases', async () => {
    const payload = new TextEncoder().encode('plain zip');
    expect(isEncryptedArchive(payload)).toBe(false);
    expect(await decryptArchiveBytes(payload, null)).toEqual(payload);
    const encrypted = await encryptArchiveBytes(payload, 'right');
    await expect(decryptArchiveBytes(encrypted, 'wrong')).rejects.toThrow('archive_wrong_passphrase');
    await expect(decryptArchiveBytes(encrypted, null)).rejects.toThrow('archive_passphrase_required');
  });
});
