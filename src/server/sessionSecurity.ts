/**
 * Credential and session lifecycle routes.
 *
 * Three clinician-facing actions that the product previously lacked entirely:
 *
 *   POST /api/auth/change-pin            — change your own PIN
 *   POST /api/auth/sessions/revoke-all   — sign out every device
 *   POST /api/auth/recovery/redeem       — redeem an operator recovery token
 *
 * All three retire every session token minted before the call by advancing the
 * account's session epoch, then hand the caller a fresh token so they are not
 * signed out of the device they are standing at.
 *
 * Why that matters in a dental clinic: clinicians share a workstation between
 * patients and each has their own profile. If someone else learns a PIN (or a
 * clinician works a locum shift on a machine they do not own), "change my PIN"
 * has to mean "and whoever else is using my profile is now locked out" — not
 * "eventually, when their token expires". The same applies after a recovery:
 * if someone else was in the account, redemption is the moment they lose it.
 *
 * There is no universal/master PIN anywhere in this design. Recovery is an
 * operator-issued, single-use, expiring token (scripts/issue-recovery-token.ts)
 * that is scoped to one account and written to the audit trail.
 *
 * These handlers are registered before the legacy handlers for the same paths;
 * Express routes to the first registered match, so these are authoritative.
 * The superseded handlers in server.ts should be deleted when that file is next
 * split up.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isWeakPin, isValidPinFormat, weakPinMessage } from '../lib/authPolicy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DENTAI_DATA_DIR
  ? path.resolve(process.env.DENTAI_DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');
const RECOVERY_FILE = path.join(DATA_DIR, 'recovery_tokens.json');

export interface SessionSecurityDeps {
  logger: {
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  /** Session authentication, composed so req.dentist is populated. */
  authenticate: (req: any, res: any, next: (err?: any) => void) => any;
  dbEnabled: boolean;
  readUsersDb: () => Promise<{ dentists: any[] }>;
  writeUsersDb: (data: { dentists: any[] }) => Promise<void>;
  dbUpdateDentistPin: (id: string, pinHash: string, salt: string) => Promise<boolean>;
  dbGetDentistById: (id: string) => Promise<any | null>;
  /** Atomically consumes a recovery token hash (single-use) and returns its dentist. */
  consumeRecoveryToken: (tokenHash: string) => Promise<string | null>;
  bumpEpoch: (dentistId: string) => Promise<number>;
  recordLoginFailure: (key: string) => Promise<void>;
  clearLoginFailures: (keys: string[]) => Promise<void>;
  verifyPinHash: (pin: string, salt: string, storedHash: string | undefined) => boolean;
  getDentistSalt: (dentistId: string) => string;
  getPinHash: (pin: string, salt: string) => string;
  generateToken: (payload: { dentistId: string; name?: string; specialty?: string; epoch?: number }) => string;
  sessionTtlSeconds: number;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
}

/** Dev/JSON-mode recovery-token store (production uses the Postgres table). */
async function consumeRecoveryTokenFromFile(tokenHash: string): Promise<string | null> {
  try {
    const store = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf-8')) as {
      tokens: Record<string, { dentistId: string; usedAt: string | null; expiresAt: string }>;
    };
    const entry = store.tokens?.[tokenHash];
    if (!entry || entry.usedAt || Date.parse(entry.expiresAt) <= Date.now()) return null;
    entry.usedAt = new Date().toISOString();
    fs.writeFileSync(RECOVERY_FILE, JSON.stringify(store, null, 2));
    return entry.dentistId;
  } catch {
    return null;
  }
}

export function registerSessionSecurityRoutes(app: any, deps: SessionSecurityDeps): void {
  /** Persists a new PIN hash for a dentist in whichever store is active. */
  async function persistPin(dentistId: string, pinHash: string, salt: string): Promise<boolean> {
    if (deps.dbEnabled) return deps.dbUpdateDentistPin(dentistId, pinHash, salt);
    const users = await deps.readUsersDb();
    const idx = users.dentists.findIndex((d: any) => d.id === dentistId);
    if (idx === -1) return false;
    users.dentists[idx].pinHash = pinHash;
    users.dentists[idx].salt = salt;
    await deps.writeUsersDb(users);
    return true;
  }

  function issueToken(dentist: any, epoch: number): string {
    return deps.generateToken({
      dentistId: dentist.id,
      name: dentist.name,
      specialty: dentist.specialty,
      epoch,
    });
  }

  app.post('/api/auth/change-pin', deps.authenticate, async (req: any, res: any) => {
    try {
      const { currentPin, newPin } = req.body || {};
      if (!isValidPinFormat(currentPin) || !isValidPinFormat(newPin)) {
        return res.status(400).json({ error: 'Current and new PIN must both be exactly 4 digits.' });
      }
      if (isWeakPin(newPin)) {
        return res.status(400).json({ error: weakPinMessage(newPin), code: 'WEAK_PIN' });
      }
      if (currentPin === newPin) {
        return res.status(400).json({ error: 'The new PIN must be different from the current PIN.' });
      }

      const dentist = req.dentist;
      const currentValid =
        deps.verifyPinHash(currentPin, dentist.salt || deps.getDentistSalt(dentist.id), dentist.pinHash) ||
        deps.verifyPinHash(currentPin, deps.getDentistSalt(dentist.id), dentist.pinHash);

      if (!currentValid) {
        // A wrong current PIN is a credential-guessing attempt, so it counts
        // against the same durable throttle as a failed sign-in.
        await deps.recordLoginFailure(`dentist:${dentist.id}`);
        await deps.logAudit('pin_change_denied', dentist.id, { reason: 'invalid_current_pin' });
        return res.status(401).json({ error: 'Current PIN is incorrect.' });
      }

      const salt = deps.getDentistSalt(dentist.id);
      const saved = await persistPin(dentist.id, deps.getPinHash(newPin, salt), salt);
      if (!saved) return res.status(404).json({ error: 'Dentist profile not found.' });

      const epoch = await deps.bumpEpoch(dentist.id);
      await deps.logAudit('pin_changed', dentist.id, { sessionsInvalidated: true, epoch });

      return res.json({
        success: true,
        token: issueToken(dentist, epoch),
        sessionTtlSeconds: deps.sessionTtlSeconds,
        message: 'PIN updated. Other devices have been signed out.',
      });
    } catch (err: any) {
      deps.logger.error('PIN change failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Failed to change PIN.' });
    }
  });

  app.post('/api/auth/sessions/revoke-all', deps.authenticate, async (req: any, res: any) => {
    try {
      const dentist = req.dentist;
      const epoch = await deps.bumpEpoch(dentist.id);
      await deps.logAudit('all_sessions_revoked', dentist.id, { epoch, self: true });

      return res.json({
        success: true,
        token: issueToken(dentist, epoch),
        sessionTtlSeconds: deps.sessionTtlSeconds,
        message: 'Every other device has been signed out. This device stays signed in.',
      });
    } catch (err: any) {
      deps.logger.error('Session revocation failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Failed to sign other devices out.' });
    }
  });

  app.post('/api/auth/recovery/redeem', async (req: any, res: any) => {
    try {
      const { token, newPin } = req.body || {};
      if (typeof token !== 'string' || token.trim().length < 20) {
        return res.status(400).json({ error: 'A valid recovery token is required.' });
      }
      if (!isValidPinFormat(newPin)) {
        return res.status(400).json({ error: 'New PIN must be exactly 4 digits.' });
      }
      if (isWeakPin(newPin)) {
        return res.status(400).json({ error: weakPinMessage(newPin), code: 'WEAK_PIN' });
      }

      const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
      const dentistId = deps.dbEnabled
        ? await deps.consumeRecoveryToken(tokenHash)
        : await consumeRecoveryTokenFromFile(tokenHash);

      if (!dentistId) {
        await deps.logAudit('recovery_token_rejected', 'unknown', {});
        return res.status(401).json({
          error: 'That recovery token is invalid, already used, or expired. Ask your administrator for a new one.',
        });
      }

      const dentist = deps.dbEnabled
        ? await deps.dbGetDentistById(dentistId)
        : (await deps.readUsersDb()).dentists.find((d: any) => d.id === dentistId);

      if (!dentist) return res.status(404).json({ error: 'Dentist profile not found.' });

      const salt = deps.getDentistSalt(dentistId);
      const saved = await persistPin(dentistId, deps.getPinHash(newPin, salt), salt);
      if (!saved) return res.status(404).json({ error: 'Dentist profile not found.' });

      // Clear the lockout that usually prompted the recovery, and retire every
      // session: if someone else was in this account, this is where they lose it.
      await deps.clearLoginFailures([`dentist:${dentistId}`]);
      const epoch = await deps.bumpEpoch(dentistId);
      await deps.logAudit('credential_recovered', dentistId, { method: 'operator_recovery_token', epoch });

      return res.json({
        success: true,
        token: issueToken(dentist, epoch),
        sessionTtlSeconds: deps.sessionTtlSeconds,
        dentist: { id: dentist.id, name: dentist.name, specialty: dentist.specialty },
      });
    } catch (err: any) {
      deps.logger.error('Recovery redemption failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Failed to complete credential recovery.' });
    }
  });
}
