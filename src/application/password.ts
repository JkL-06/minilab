import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { PasswordValidationError } from '../domain/errors';

/**
 * Password hashing with node:crypto scrypt — zero dependencies, no native
 * modules. Encoded format: `scrypt$N$r$p$salt$hash` (all hex).
 *
 * scrypt parameters follow the classic interactive login profile (N=2^14,
 * r=8, p=1); the encoded string carries them so hashes stay verifiable if the
 * parameters ever change.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export const MIN_PASSWORD_LENGTH = 6;

/** Hashes a plaintext password into a self-describing scrypt string. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash.toString('hex')}`;
}

/** Constant-time comparison of a plaintext password against an encoded hash. */
export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nStr, rStr, pStr, salt, expectedHex] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  try {
    const computed = scryptSync(password, salt, KEY_LENGTH, { N: n, r, p });
    const expected = Buffer.from(expectedHex, 'hex');
    return computed.length === expected.length && timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

/** Validates a new password: non-empty string of at least MIN_PASSWORD_LENGTH chars. */
export function validateNewPassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PasswordValidationError('password must be a string');
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordValidationError(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  return value;
}
