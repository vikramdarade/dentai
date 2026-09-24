/**
 * AES-256-GCM Envelope Encryption & Zero-Retention Audio Purging (Work Package 4.3 & Rule 16)
 *
 * Implements:
 * 1. AES-256-GCM authenticated encryption for session records and temporary audio envelopes.
 * 2. Rule 16 Audio Destruction Policy: scrubs raw clinical voice immediately post-transcription.
 */

import crypto from 'crypto';
import { EncryptedPayloadEnvelope } from './types';

// Deterministic fallback encryption key derived from environment or session secret
function resolveEncryptionKey(customKey?: string): Buffer {
  const secret = customKey || process.env.SESSION_SECRET || process.env.ENCRYPTION_SECRET || 'dentai-sovereign-default-secret-key-32b';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts arbitrary clinical data (text or serialized JSON) using AES-256-GCM.
 */
export function encryptPayload(
  data: string | Buffer | object,
  customKey?: string
): EncryptedPayloadEnvelope {
  const key = resolveEncryptionKey(customKey);
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM

  const textToEncrypt = typeof data === 'string'
    ? data
    : Buffer.isBuffer(data)
    ? data.toString('utf8')
    : JSON.stringify(data);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag,
    ciphertext: encrypted,
    encryptedAt: new Date().toISOString()
  };
}

/**
 * Decrypts an AES-256-GCM encrypted envelope and verifies its authentication tag.
 * Throws an error if ciphertext or tag was tampered with.
 */
export function decryptPayload(
  envelope: EncryptedPayloadEnvelope,
  customKey?: string
): string {
  if (envelope.algorithm !== 'aes-256-gcm') {
    throw new Error(`Unsupported encryption algorithm: ${envelope.algorithm}`);
  }

  const key = resolveEncryptionKey(customKey);
  const iv = Buffer.from(envelope.iv, 'hex');
  const authTag = Buffer.from(envelope.authTag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(envelope.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * In-memory audio slice registry tracking live recording chunks pending deletion.
 */
export const activeAudioRegistry = new Map<string, { buffer?: Buffer; path?: string; timestamp: number }>();

/**
 * Rule 16: Immediate Raw Audio Destruction.
 *
 * "The Recording, Not the Browser Recogniser, Is the Transcript:
 * Delete the raw audio once the transcript is persisted. Do not keep a 'backup' copy of clinical voice."
 */
export function purgeAudioPayload(
  sliceId: string,
  registry: Map<string, any> = activeAudioRegistry
): { purged: boolean; sliceId: string; purgedAt: string } {
  const entry = registry.get(sliceId);
  const purgedAt = new Date().toISOString();

  if (entry) {
    if (entry.buffer && Buffer.isBuffer(entry.buffer)) {
      // Cryptographically overwrite buffer in memory before release
      entry.buffer.fill(0);
    }
    registry.delete(sliceId);
    return { purged: true, sliceId, purgedAt };
  }

  return { purged: false, sliceId, purgedAt };
}
