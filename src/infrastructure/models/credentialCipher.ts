import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SecretCipher } from '../../application/secretCipher';

const PREFIX = 'v1';
const IV_BYTES = 12;
const KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * AES-256-GCM credential cipher (SPEC-005, ARCHITECTURE security baseline:
 * "encrypt provider credentials at rest"). Each payload is a versioned
 * `v1:<iv>:<authTag>:<ciphertext>` string so the format can evolve later.
 * Wrong keys or tampered payloads fail decryption loudly.
 */
export class AesGcmCredentialCipher implements SecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('Credential cipher key must be 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== PREFIX) {
      throw new Error('Unsupported credential payload');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }
}

/**
 * Resolves the master key: from the `MODEL_GATEWAY_KEY` env var (64 hex chars)
 * when set, otherwise from (or creating) a key file next to the database. Using
 * a key file keeps credentials decryptable across application restarts with no
 * env plumbing, and the DB itself never stores the key.
 */
export function getOrCreateCredentialCipher(
  keyHex: string | undefined,
  keyFilePath: string,
): SecretCipher {
  const envKey = keyHex?.trim();
  if (envKey) {
    if (!KEY_HEX_PATTERN.test(envKey)) {
      throw new Error('MODEL_GATEWAY_KEY must be 64 hex characters (32 bytes)');
    }
    return new AesGcmCredentialCipher(Buffer.from(envKey, 'hex'));
  }

  let stored: string | null = null;
  try {
    stored = readFileSync(keyFilePath, 'utf8').trim();
  } catch {
    // key file does not exist yet
  }
  if (!stored || !KEY_HEX_PATTERN.test(stored)) {
    const generated = randomBytes(32).toString('hex');
    mkdirSync(dirname(keyFilePath), { recursive: true });
    try {
      writeFileSync(keyFilePath, generated, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch {
      // Another process won the race to create it; read what it wrote.
    }
    stored = readFileSync(keyFilePath, 'utf8').trim();
  }
  return new AesGcmCredentialCipher(Buffer.from(stored, 'hex'));
}
