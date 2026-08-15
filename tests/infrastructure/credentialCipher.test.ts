import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AesGcmCredentialCipher,
  getOrCreateCredentialCipher,
} from '../../src/infrastructure/models/credentialCipher';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

test('encrypt/decrypt round-trips the plaintext', () => {
  const cipher = new AesGcmCredentialCipher(KEY);
  const payload = cipher.encrypt('sk-openai-abcd');
  assert.equal(cipher.decrypt(payload), 'sk-openai-abcd');
});

test('ciphertext differs from the plaintext and is versioned (SPEC-005 #5)', () => {
  const cipher = new AesGcmCredentialCipher(KEY);
  const payload = cipher.encrypt('sk-topsecret');
  assert.notEqual(payload, 'sk-topsecret');
  assert.ok(!payload.includes('topsecret'), 'ciphertext never embeds the plaintext');
  assert.match(payload, /^v1:[^:]+:[^:]+:[^:]+$/, 'v1:<iv>:<tag>:<ciphertext> format');
});

test('a wrong key fails decryption loudly', () => {
  const payload = new AesGcmCredentialCipher(KEY).encrypt('sk-secret');
  assert.throws(() => new AesGcmCredentialCipher(OTHER_KEY).decrypt(payload));
});

test('a tampered payload fails decryption', () => {
  const cipher = new AesGcmCredentialCipher(KEY);
  const payload = cipher.encrypt('sk-secret');
  const parts = payload.split(':');
  parts[3] = Buffer.from('corrupted').toString('base64');
  assert.throws(() => cipher.decrypt(parts.join(':')));
});

test('an unsupported payload format is rejected', () => {
  const cipher = new AesGcmCredentialCipher(KEY);
  assert.throws(() => cipher.decrypt('plaintext'));
  assert.throws(() => cipher.decrypt('v2:a:b:c'));
});

test('getOrCreateCredentialCipher uses the env key when provided and rejects a malformed one', () => {
  const keyHex = 'ab'.repeat(32);
  const cipher = getOrCreateCredentialCipher(keyHex, join(tmpdir(), 'unused.key'));
  assert.ok(cipher instanceof AesGcmCredentialCipher);

  assert.throws(() => getOrCreateCredentialCipher('not-a-hex-key', join(tmpdir(), 'unused.key')));
  assert.throws(() => getOrCreateCredentialCipher('a'.repeat(10), join(tmpdir(), 'unused.key')));
});

test('key-file cipher persists across process instances (SPEC-005 restart)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'minilab-key-'));
  try {
    const keyFile = join(dir, 'model-gateway.key');

    const first = getOrCreateCredentialCipher(undefined, keyFile);
    const payload = first.encrypt('sk-restart');
    assert.equal(first.decrypt(payload), 'sk-restart');

    // A second, independent instance reads the same key file and can decrypt.
    const second = getOrCreateCredentialCipher(undefined, keyFile);
    assert.equal(second.decrypt(payload), 'sk-restart', 'key file survives "restart"');

    // A mismatched explicit key cannot decrypt what the file-created cipher wrote.
    const wrong = getOrCreateCredentialCipher(randomBytes(32).toString('hex'), keyFile);
    assert.throws(() => wrong.decrypt(payload));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
