/**
 * Encryption boundary for stored credentials (SPEC-005). The application layer
 * depends on this small port so domain/service code never touches key material;
 * infrastructure provides the AES-256-GCM implementation with master-key
 * management. Ciphertext is opaque to the rest of the application.
 */
export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}
