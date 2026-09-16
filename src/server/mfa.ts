/**
 * Multi-factor authentication for clinician accounts.
 *
 * The endpoint that existed before this accepted *any* six-digit code and there
 * was no TOTP implementation in the repository. A control that looks enforced
 * but verifies nothing is worse than no control: it appears on a clinic's
 * security questionnaire as if it were real, and it gives a false sense of
 * protection to the person relying on it.
 *
 * What is real now:
 *   - Enrolment issues a proper RFC 6238 secret; the app shows a provisioning
 *     URI that Google Authenticator / 1Password / Authy can scan.
 *   - Enrolment is only complete once the clinician proves they can produce a
 *     code, so nobody locks themselves out by scanning into a dead phone.
 *   - **Sign-in is actually gated**: an account with a confirmed factor cannot
 *     obtain a session token from a PIN alone. The login handler calls
 *     `beforeSessionIssued`, which either lets the request continue (no factor,
 *     or a valid code supplied) or answers 401 `MFA_REQUIRED` itself.
 *   - Ten single-use recovery codes, stored hashed, so a lost phone is not a
 *     support call at 8am. Using one consumes it and turns MFA off, which is
 *     what a person who has lost their second factor actually needs.
 *   - Disabling requires the account PIN *and* a current code.
 *
 * Deliberately not here: SMS. It is the weakest factor, it costs money per
 * message, and it fails in regional Australia where dentists actually are.
 */

import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpProvisioningUri,
  verifyTotp,
} from '../lib/totp';
import type { MfaStore } from './stores';

export interface MfaDeps {
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  authenticate: (req: any, res: any, next: (err?: any) => void) => any;
  store: MfaStore;
  issuer: string;
  verifyPinHash: (pin: string, salt: string, storedHash: string | undefined) => boolean;
  getDentistSalt: (dentistId: string) => string;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
}

export interface MfaService {
  /** True when this account has a confirmed second factor. */
  isEnabledFor(dentistId: string): Promise<boolean>;
  /**
   * Called from the login handler once the PIN is verified.
   *
   * Returns `{ handled: true }` when a response has already been sent (the
   * caller must stop); `{ handled: false }` when the caller may issue a session.
   */
  beforeSessionIssued(
    req: any,
    res: any,
    dentist: { id: string; name?: string }
  ): Promise<{ handled: boolean }>;
}

export function createMfaService(deps: MfaDeps): MfaService {
  return {
    async isEnabledFor(dentistId) {
      const credential = await deps.store.get(dentistId);
      return !!(credential && credential.confirmedAt);
    },

    async beforeSessionIssued(req, res, dentist) {
      const credential = await deps.store.get(dentist.id);
      if (!credential || !credential.confirmedAt) return { handled: false };

      const body = req.body || {};
      const code = typeof body.mfaCode === 'string' ? body.mfaCode : '';
      const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';

      if (recoveryCode) {
        const consumed = await deps.store.consumeRecoveryCode(
          dentist.id,
          hashRecoveryCode(recoveryCode)
        );
        if (consumed) {
          // A recovery code means the second factor is gone. Turning MFA off is
          // the standard, honest behaviour: the alternative is a clinician who
          // can sign in but is permanently one step from locked out.
          await deps.store.remove(dentist.id);
          await deps.logAudit('mfa_disabled_by_recovery_code', dentist.id, {});
          return { handled: false };
        }
        await deps.logAudit('mfa_recovery_code_rejected', dentist.id, {});
        res.status(401).json({
          error:
            'That recovery code is not valid or has already been used. Ask your practice administrator for help.',
          code: 'MFA_RECOVERY_INVALID',
          mfaRequired: true,
        });
        return { handled: true };
      }

      if (code && verifyTotp(credential.secret, code)) {
        await deps.store.touch(dentist.id);
        await deps.logAudit('mfa_verified', dentist.id, {});
        return { handled: false };
      }

      if (code) {
        await deps.logAudit('mfa_challenge_failed', dentist.id, {});
        res.status(401).json({
          error: 'That code is not correct. Codes change every 30 seconds — try the current one.',
          code: 'MFA_INVALID',
          mfaRequired: true,
        });
        return { handled: true };
      }

      // The right password, no second factor supplied yet. This is a normal step
      // in the flow, not a failure, so it is not counted as a login failure.
      res.status(401).json({
        error: 'Enter the 6-digit code from your authenticator app.',
        code: 'MFA_REQUIRED',
        mfaRequired: true,
      });
      return { handled: true };
    },
  };
}

export type MfaRoutesDeps = MfaDeps;

/**
 * Sign-in guard, installed on `/api/auth/login` *before* the route handler.
 *
 * Why it is a response interceptor rather than a line inside the login handler:
 * the handler owns PIN verification, lockout accounting and audit, and it should
 * keep owning them. What must not be possible is a path where a session token
 * leaves the building without the second factor being checked — so the guard
 * watches for a successful response body (one carrying `token` + `dentist.id`)
 * and decides before that body reaches the client.
 *
 * Failure behaviour is closed, not open: if the MFA store cannot be read, the
 * token is withheld and the clinician is asked to try again. A security control
 * that fails open is not a control.
 */
export function createLoginMfaGuard(
  service: MfaService,
  logger: { error: (message: string, error?: any, context?: Record<string, any>) => void }
) {
  return function loginMfaGuard(req: any, res: any, next: (err?: any) => void) {
    const originalJson = res.json.bind(res);

    res.json = (body: any) => {
      const accountId =
        body && typeof body === 'object' && body.token && body.dentist?.id ? body.dentist.id : null;
      if (!accountId) return originalJson(body);

      return Promise.resolve(
        service.beforeSessionIssued(req, res, { id: accountId, name: body.dentist?.name })
      )
        .then((gate) => {
          // A 401 (code required, code wrong, recovery code rejected) has
          // already been sent by the service. The minted token is discarded
          // with it, which is the whole point.
          if (gate.handled) return undefined;
          return originalJson({ ...body, mfaVerified: true });
        })
        .catch((err: any) => {
          logger.error('Two-factor check failed during sign-in:', err?.message || err, {
            url: req.originalUrl,
          });
          return res.status(503).json({
            error:
              'Two-factor verification is unavailable, so sign-in is paused. Please try again shortly.',
            code: 'MFA_UNAVAILABLE',
          });
        });
    };

    return next();
  };
}

export function registerMfaRoutes(app: any, deps: MfaRoutesDeps): MfaService {
  const service = createMfaService(deps);

  app.get('/api/auth/mfa', deps.authenticate, async (req: any, res: any) => {
    try {
      const credential = await deps.store.get(req.dentist.id);
      const remaining = credential?.confirmedAt
        ? await deps.store.countUnusedRecoveryCodes(req.dentist.id)
        : 0;
      return res.json({
        enabled: !!credential?.confirmedAt,
        enrolled: !!credential,
        recoveryCodesRemaining: remaining,
        recoveryCodesLow: !!credential?.confirmedAt && remaining <= 2,
      });
    } catch (err: any) {
      deps.logger.error('Failed to read MFA status:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not read two-factor status.' });
    }
  });

  /** Starts enrolment: stores an unconfirmed secret and returns the QR payload. */
  app.post('/api/auth/mfa/enroll', deps.authenticate, async (req: any, res: any) => {
    try {
      const existing = await deps.store.get(req.dentist.id);
      if (existing?.confirmedAt) {
        return res.status(409).json({
          error: 'Two-factor authentication is already enabled on this profile.',
          code: 'MFA_ALREADY_ENABLED',
        });
      }
      const secret = generateTotpSecret();
      await deps.store.saveSecret(req.dentist.id, secret);
      await deps.logAudit('mfa_enrollment_started', req.dentist.id, {});
      return res.json({
        secret,
        otpauthUrl: totpProvisioningUri({
          secret,
          accountName: req.dentist.name || req.dentist.id,
          issuer: deps.issuer,
        }),
        instructions:
          'Scan the code with your authenticator app, then enter the 6-digit code it shows to finish.',
      });
    } catch (err: any) {
      deps.logger.error('MFA enrolment failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not start two-factor enrolment.' });
    }
  });

  /** Completes enrolment and shows recovery codes exactly once. */
  app.post('/api/auth/mfa/confirm', deps.authenticate, async (req: any, res: any) => {
    try {
      const credential = await deps.store.get(req.dentist.id);
      if (!credential) {
        return res.status(400).json({ error: 'Start enrolment first.', code: 'MFA_NOT_ENROLLED' });
      }
      if (!verifyTotp(credential.secret, req.body?.code)) {
        await deps.logAudit('mfa_enrollment_confirm_failed', req.dentist.id, {});
        return res.status(400).json({
          error: 'That code did not match. Check your phone clock and try the current code.',
          code: 'MFA_INVALID',
        });
      }

      await deps.store.confirm(req.dentist.id);
      const { codes, hashes } = generateRecoveryCodes();
      await deps.store.replaceRecoveryCodes(req.dentist.id, hashes);
      await deps.logAudit('mfa_enabled', req.dentist.id, { recoveryCodes: codes.length });

      return res.json({
        success: true,
        recoveryCodes: codes,
        message:
          'Two-factor authentication is on. Save these recovery codes somewhere safe — each works once, and they are the only way in if you lose your phone.',
      });
    } catch (err: any) {
      deps.logger.error('MFA confirmation failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not confirm two-factor enrolment.' });
    }
  });

  /** New recovery codes, requiring the PIN and a current code. */
  app.post('/api/auth/mfa/recovery-codes', deps.authenticate, async (req: any, res: any) => {
    try {
      const credential = await deps.store.get(req.dentist.id);
      if (!credential?.confirmedAt) {
        return res.status(400).json({ error: 'Two-factor is not enabled.', code: 'MFA_NOT_ENABLED' });
      }
      const pin = req.body?.pin;
      const pinValid = deps.verifyPinHash(
        String(pin || ''),
        deps.getDentistSalt(req.dentist.id),
        req.dentist.pinHash
      );
      if (!pinValid || !verifyTotp(credential.secret, req.body?.code)) {
        await deps.logAudit('mfa_recovery_codes_denied', req.dentist.id, {});
        return res.status(401).json({ error: 'PIN and current code are both required.' });
      }
      const { codes, hashes } = generateRecoveryCodes();
      await deps.store.replaceRecoveryCodes(req.dentist.id, hashes);
      await deps.logAudit('mfa_recovery_codes_regenerated', req.dentist.id, { count: codes.length });
      return res.json({ success: true, recoveryCodes: codes });
    } catch (err: any) {
      deps.logger.error('Recovery code regeneration failed:', err?.message || err, {
        url: req.originalUrl,
      });
      return res.status(500).json({ error: 'Could not regenerate recovery codes.' });
    }
  });

  /** Turns two-factor off. Requires the PIN and a current code. */
  app.post('/api/auth/mfa/disable', deps.authenticate, async (req: any, res: any) => {
    try {
      const credential = await deps.store.get(req.dentist.id);
      if (!credential?.confirmedAt) {
        return res.status(400).json({ error: 'Two-factor is not enabled.', code: 'MFA_NOT_ENABLED' });
      }
      const pinValid = deps.verifyPinHash(
        String(req.body?.pin || ''),
        deps.getDentistSalt(req.dentist.id),
        req.dentist.pinHash
      );
      if (!pinValid || !verifyTotp(credential.secret, req.body?.code)) {
        await deps.logAudit('mfa_disable_denied', req.dentist.id, {});
        return res.status(401).json({ error: 'PIN and current code are both required.' });
      }
      await deps.store.remove(req.dentist.id);
      await deps.logAudit('mfa_disabled', req.dentist.id, {});
      return res.json({
        success: true,
        message: 'Two-factor authentication is off. We recommend turning it back on.',
      });
    } catch (err: any) {
      deps.logger.error('MFA disable failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not disable two-factor authentication.' });
    }
  });

  /** Step-up check for sensitive actions within an existing session. */
  app.post('/api/auth/mfa/verify', deps.authenticate, async (req: any, res: any) => {
    try {
      const credential = await deps.store.get(req.dentist.id);
      if (!credential?.confirmedAt) {
        // No factor configured: nothing to step up to, and saying so honestly is
        // better than returning a false "verified".
        return res.json({ verified: false, enabled: false, reason: 'NOT_ENROLLED' });
      }
      const verified = verifyTotp(credential.secret, req.body?.code);
      if (verified) {
        await deps.store.touch(req.dentist.id);
        await deps.logAudit('mfa_step_up_verified', req.dentist.id, {});
      } else {
        await deps.logAudit('mfa_step_up_failed', req.dentist.id, {});
      }
      return res.status(verified ? 200 : 401).json({ verified, enabled: true });
    } catch (err: any) {
      deps.logger.error('MFA verification failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not verify the code.' });
    }
  });

  return service;
}
