/**
 * Inbound PMS Webhook Authentication & Signature Verification.
 *
 * Enforces HMAC-SHA256 signature verification over incoming webhook requests
 * from Practice Management Systems or automation bridges (e.g. Zapier, Cliniko, Core Practice).
 *
 * Expected Header Format:
 *   x-dentai-signature: t=<unix-seconds>,v1=<hex>
 *
 * Where:
 *   v1 = HMAC_SHA256(secret, `${t}.${rawBody}`) as lowercase hex
 */

import crypto from 'crypto';

export interface PmsSignatureCheckInput {
  secret: string | undefined;
  header: string | undefined;
  payload: string | Buffer | undefined;
  toleranceSeconds?: number;
  now?: () => number;
}

export type PmsSignatureCheckResult =
  | { ok: true; timestamp: number }
  | {
      ok: false;
      reason:
        | 'no_secret'
        | 'missing_header'
        | 'malformed_header'
        | 'timestamp_out_of_tolerance'
        | 'no_matching_signature';
    };

/**
 * Constant-time string comparison preventing timing attacks.
 */
export function signaturesMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

/**
 * Helper to generate a valid signature header for testing and authorized senders.
 */
export function signPmsWebhookPayload(secret: string, rawBody: string | Buffer, timestamp?: number): string {
  const t = typeof timestamp === 'number' ? timestamp : Math.floor(Date.now() / 1000);
  const payloadStr = typeof rawBody === 'string' ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';
  const toSign = `${t}.${payloadStr}`;
  const hmac = crypto.createHmac('sha256', secret).update(toSign, 'utf8').digest('hex').toLowerCase();
  return `t=${t},v1=${hmac}`;
}

/**
 * Verifies an inbound webhook signature.
 * Fails closed and never throws.
 */
export function verifyPmsWebhookSignature(input: PmsSignatureCheckInput): PmsSignatureCheckResult {
  const { secret, header, payload, toleranceSeconds = 300, now = () => Math.floor(Date.now() / 1000) } = input;

  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return { ok: false, reason: 'no_secret' };
  }

  if (!header || typeof header !== 'string' || !header.trim()) {
    return { ok: false, reason: 'missing_header' };
  }

  if (payload === undefined || payload === null) {
    return { ok: false, reason: 'no_matching_signature' };
  }

  // Parse t=<timestamp>,v1=<sig>
  const parts = header.split(',').map(s => s.trim());
  let timestampStr: string | undefined;
  const signatures: string[] = [];

  for (const part of parts) {
    if (part.startsWith('t=')) {
      timestampStr = part.slice(2);
    } else if (part.startsWith('v1=')) {
      signatures.push(part.slice(3).toLowerCase());
    }
  }

  if (!timestampStr || signatures.length === 0) {
    return { ok: false, reason: 'malformed_header' };
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, reason: 'malformed_header' };
  }

  const currentSec = now();
  if (Math.abs(currentSec - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const payloadStr = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : '';
  const toSign = `${timestamp}.${payloadStr}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(toSign, 'utf8').digest('hex').toLowerCase();

  const matches = signatures.some(sig => signaturesMatch(sig, expectedSig));
  if (!matches) {
    return { ok: false, reason: 'no_matching_signature' };
  }

  return { ok: true, timestamp };
}

// In-memory / ephemeral replay cache for duplicate event detection
const seenWebhookEvents = new Map<string, number>();
const REPLAY_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Checks if a webhook event ID / signature has already been processed to prevent replay.
 */
export function checkAndRecordWebhookReplay(eventId: string): boolean {
  const now = Date.now();
  // Clean expired
  for (const [id, ts] of seenWebhookEvents.entries()) {
    if (now - ts > REPLAY_TTL_MS) {
      seenWebhookEvents.delete(id);
    }
  }

  if (seenWebhookEvents.has(eventId)) {
    return true; // Is a duplicate / replay
  }

  seenWebhookEvents.set(eventId, now);
  return false;
}
