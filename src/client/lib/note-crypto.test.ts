import { describe, expect, it } from 'vitest';
import { decryptNoteContent, encryptNoteContent, isEncryptedNote } from './note-crypto';
import { ENCRYPTED_NOTE_PREFIX } from '@shared/constants';

describe('note crypto round trip', () => {
    it('encrypts to the marked prefix and decrypts back', async () => {
        const encrypted = await encryptNoteContent('# Secret\n\nbody text', 'pass-phrase');
        expect(isEncryptedNote(encrypted)).toBe(true);
        expect(encrypted.startsWith(ENCRYPTED_NOTE_PREFIX)).toBe(true);
        expect(encrypted).not.toContain('Secret');
        const decrypted = await decryptNoteContent(encrypted, 'pass-phrase');
        expect(decrypted).toBe('# Secret\n\nbody text');
    });

    it('rejects a wrong passphrase', async () => {
        const encrypted = await encryptNoteContent('hello', 'right');
        await expect(decryptNoteContent(encrypted, 'wrong')).rejects.toThrow('wrong_passphrase');
    });

    it('does not double-encrypt', async () => {
        const encrypted = await encryptNoteContent('hello', 'p');
        await expect(encryptNoteContent(encrypted, 'p')).rejects.toThrow('already_encrypted');
    });
});
