/**
 * Authentication policy — pure, shared, testable.
 *
 * DentAI uses a 4-digit PIN because clinicians sign in on a shared
 * chairside workstation between patients and speed matters. A 4-digit secret
 * is only acceptable when it is (a) never a trivially guessable value and
 * (b) protected by durable lockout. Both rules live here so registration,
 * PIN change, PIN recovery and the test suite cannot disagree about them.
 *
 * No master/universal PIN exists anywhere in this product by design. Clinician
 * lockout recovery is handled by an operator-issued, single-use, expiring
 * recovery token (scripts/issue-recovery-token.ts) that is written to the
 * audit trail — see docs/runbooks/notifiable-data-breach.md.
 */

export const PIN_LENGTH = 4;

/** Values a human or an attacker reaches for first. */
const COMMON_WEAK_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '0123', '3210', '9876', '6789',
  '1212', '2121', '1010', '0101', '1122', '2211', '6969',
  '1357', '2468', '1379', '1478', '1590', '0258', '2580', '0852',
  '1004', '2000', '1112', '1123', '1223', '2345', '3456', '4567', '5678',
]);

/** True when the PIN is exactly four digits. */
export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/**
 * True when a PIN must not be accepted: repeated digits, an ascending or
 * descending run, or one of the common values above.
 */
export function isWeakPin(pin: string): boolean {
  if (!isValidPinFormat(pin)) return true;
  if (COMMON_WEAK_PINS.has(pin)) return true;

  const digits = pin.split('').map(Number);
  // Repeated digit (0000, 7777)
  if (digits.every((d) => d === digits[0])) return true;
  // Monotonic run in either direction (1234, 6543)
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) return true;
  // Two-digit repeating pair (1212, 3434)
  if (digits[0] === digits[2] && digits[1] === digits[3]) return true;

  return false;
}

/** Human-readable reason a PIN was rejected, for the API response. */
export function weakPinMessage(pin: string): string {
  if (!isValidPinFormat(pin)) return `PIN must be exactly ${PIN_LENGTH} digits.`;
  return 'That PIN is too easy to guess. Avoid repeated digits, runs like 1234, and common values.';
}

// --- Login lockout ---------------------------------------------------------

/** Failed attempts allowed for one account before it is locked. */
export const LOGIN_MAX_ATTEMPTS = 5;
/** How long an account stays locked once the limit is hit. */
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Brute-force throttling is two-layered, and deliberately NOT keyed by IP:
 *
 *  1. **Per account (durable, this function).** Five wrong PINs lock that one
 *     account for 15 minutes, stored in the database so it survives cold starts
 *     and is shared across instances.
 *  2. **Per source address (HTTP layer).** A request-rate limiter caps how fast
 *     any one address can hit the credential endpoints at all.
 *
 * An IP-keyed *account lockout* was deliberately removed: dental clinics sit
 * behind one NAT address, so a single clinician fumbling their PIN five times
 * would lock out every colleague in the practice. Rate-limit the address,
 * account-lock the credential.
 */
export function loginAttemptKeys(dentistId: string, ip: string | undefined): string[] {
  void ip;
  return [`dentist:${dentistId}`];
}

// --- Sessions --------------------------------------------------------------

/** Session lifetime for a chairside workstation. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours, covers a clinic day;
export const SESSION_TTL_SECONDS_MAX = 7 * 24 * 60 * 60;

// --- Recovery tokens (operator-issued break-glass) -------------------------

/** Operator-issued recovery token lifetime. */
export const RECOVERY_TOKEN_TTL_MS = 60 * 60 * 1000;
