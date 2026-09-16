/**
 * Time-based one-time passwords (RFC 6238) and recovery codes.
 *
 * The previous MFA endpoint accepted any six digits and there was no TOTP
 * library in the project, so the control was decorative — worse than absent,
 * because it appears on a clinic's security questionnaire as if it were real.
 *
 * This is a small, dependency-free implementation of the standard so that
 * Google Authenticator, 1Password, Authy and Microsoft Authenticator all work
 * against it. The algorithm is fixed at the interoperable default:
 * HMAC-SHA1, 6 digits, 30-second step, which is what RFC 6238 §5.2 specifies
 * for TOTP and what every authenticator app assumes when it scans a QR code.
 *
 * Verified against the RFC 6238 Appendix B test vectors in
 * tests/totp.test.ts — including the SHA-1 vector set (the one the standard
 * defines for interoperability).
 */

import crypto from 'crypto';

export const TOTP_ALGORITHM = 'SHA1';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/** Default acceptance window: the current step plus one either side (±30s). */
export const TOTP_DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Fresh 160-bit secret (the size RFC 4226 recommends for HMAC-SHA1). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The HOTP value for a specific counter (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const digest = crypto.createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The TOTP code for a moment in time. */
export function totpAt(secretBase32: string, at: Date | number = Date.now()): string {
  const seconds = at instanceof Date ? Math.floor(at.getTime() / 1000) : Math.floor(at / 1000);
  return hotp(base32Decode(secretBase32), Math.floor(seconds / TOTP_PERIOD_SECONDS));
}

export interface TotpVerifyOptions {
  /** Number of steps either side of now that are accepted. Default 1 (±30s). */
  window?: number;
  /** Injectable for tests. */
  now?: Date | number;
}

/**
 * Verifies a submitted code.
 *
 * The window exists because phone clocks drift and a clinician is standing at a
 * chairside workstation with a patient waiting; refusing a code that expired
 * nine seconds ago is a support call, not a security win. Widening it to
 * minutes would be a real weakening — one step each way is the common standard.
 */
export function verifyTotp(
  secretBase32: string,
  code: unknown,
  options: TotpVerifyOptions = {}
): boolean {
  if (typeof code !== 'string') return false;
  const candidate = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(candidate)) return false;

  const window = options.window ?? TOTP_DEFAULT_WINDOW;
  const nowMs =
    options.now === undefined
      ? Date.now()
      : options.now instanceof Date
        ? options.now.getTime()
        : options.now;
  const step = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }

  // Constant-time comparison on every candidate, and every candidate is always
  // checked so timing does not reveal how close the code was.
  let matched = false;
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secret, step + offset);
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;
  }
  return matched;
}

/** `otpauth://` URI for the QR code an authenticator app scans. */
export function totpProvisioningUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = params.issuer || 'DentAI';
  const label = encodeURIComponent(`${issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: TOTP_ALGORITHM,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/* ---------------------------------------------------------------------------
 * Recovery codes
 *
 * An authenticator can be lost, and a clinician who cannot sign in cannot treat
 * patients. Recovery codes are the alternative that does not require the
 * founder to be awake: ten single-use codes, hashed at rest, consumed one at a
 * time. They are shown exactly once.
 * ------------------------------------------------------------------------- */

export const RECOVERY_CODE_COUNT = 10;

/** A 10-character code from an unambiguous alphabet (no 0/O/1/I/L). */
export function generateRecoveryCode(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): {
  codes: string[];
  hashes: string[];
} {
  const codes: string[] = [];
  const seen = new Set<string>();
  while (codes.length < count) {
    const code = generateRecoveryCode();
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return { codes, hashes: codes.map(hashRecoveryCode) };
}
