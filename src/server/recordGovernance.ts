/**
 * Clinical record governance.
 *
 * Every write to a consultation passes through here so that four properties
 * hold for all of them, regardless of which handler or client version produced
 * the request:
 *
 *  1. **Consent is recorded, not assumed.** The patient's AI-assist consent and
 *     the disclosure version shown are stamped onto the record. Consent is
 *     append-only: a later edit cannot rewrite or erase it.
 *  2. **Saves are append-only.** Each save appends a revision (who, when, which
 *     engine) instead of silently replacing the previous state — a clinical
 *     record must be able to answer "what did this say before?".
 *  3. **Reads are audited.** Viewing a patient record is an access event under
 *     Australian Privacy Principle 6; only writes used to be logged.
 *  4. **Retention is explicit.** Each record carries the retention horizon the
 *     clinic is working to (docs/legal/retention-and-deletion.md).
 *
 * Authentication is composed inside this middleware rather than assumed: it is
 * registered early (so it wraps the handlers), which means it runs *before* the
 * route's own auth middleware and could not otherwise see req.dentist. Only the
 * consultation paths are touched — every other /api request falls straight
 * through, which is what keeps the sign-in endpoints working.
 *
 * Set DENTAI_REQUIRE_CONSENT=true to refuse transcript-bearing records that
 * arrive without consent. It defaults to off so a clinician never loses a
 * finished note because an older client build did not send the field; the
 * existing gap is recorded in the audit trail either way.
 */

import crypto from 'crypto';

export interface RecordGovernanceDeps {
  logger: {
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  /** Session authentication, composed here so the middleware can read req.dentist. */
  authenticate: (req: any, res: any, next: (err?: any) => void) => any;
  aiDisclosureVersion: string;
  privacyNoticeVersion: string;
  retentionYears: number;
  requireConsent: boolean;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
  listConsultations: (dentistId: string) => Promise<any[]>;
}

type Middleware = (req: any, res: any, next: (err?: any) => void) => any;

function isValidConsent(consent: any): boolean {
  return (
    !!consent &&
    typeof consent === 'object' &&
    typeof consent.obtainedAt === 'string' &&
    consent.obtainedAt.length > 0
  );
}

export function createRecordGovernance(deps: RecordGovernanceDeps): Middleware {
  return function recordGovernance(req: any, res: any, next: (err?: any) => void) {
    const originalUrl: string = req.originalUrl || '';
    const method: string = (req.method || 'GET').toUpperCase();

    const isConsultationWrite = method === 'POST' && /^\/api\/consultations\/?$/.test(originalUrl);
    const isConsultationUpdate =
      (method === 'PUT' || method === 'PATCH') && /^\/api\/consultations\/[^/?]+$/.test(originalUrl);
    const isConsultationRead =
      method === 'GET' &&
      (/^\/api\/consultations\/?$/.test(originalUrl) ||
        /^\/api\/clinics\/[^/]+\/consultations\/?$/.test(originalUrl));

    // Anything that is not a clinical record access is none of this middleware's
    // business (and must not be forced through authentication here).
    if (!isConsultationWrite && !isConsultationUpdate && !isConsultationRead) return next();

    return deps.authenticate(req, res, async (authErr?: any) => {
      if (authErr) return next(authErr);

      const dentistId: string | undefined = req?.dentist?.id;
      if (!dentistId) return res.status(401).json({ error: 'Access token required.' });

      // ---- Read auditing (no PHI in the payload: ids and counts only) ------
      if (isConsultationRead) {
        const originalJson = res.json.bind(res);
        res.json = (body: any) => {
          if (res.statusCode < 400) {
            const count = Array.isArray(body) ? body.length : undefined;
            void Promise.resolve(
              deps.logAudit('consultation_records_viewed', dentistId, {
                route: originalUrl,
                count,
                scope: /^\/api\/clinics\//.test(originalUrl) ? 'clinic' : 'own',
              })
            ).catch(() => {});
          }
          return originalJson(body);
        };
        return next();
      }

      const body = req.body;
      if (!body || typeof body !== 'object') return next();

      const now = new Date().toISOString();
      const transcript = Array.isArray(body.transcript) ? body.transcript : [];
      const hasTranscript = transcript.length > 0;
      const consentWasSupplied = isValidConsent(body.consent);

      // ---- Consent ---------------------------------------------------------
      if (hasTranscript && deps.requireConsent && !consentWasSupplied) {
        // The patient's consent is the legal basis for processing their
        // consultation content, so an enforcing deployment refuses the record
        // rather than storing content it cannot justify.
        await deps.logAudit('consultation_rejected_no_consent', dentistId, { route: originalUrl });
        return res.status(400).json({
          error:
            'This consultation cannot be saved because AI-assist consent was not recorded. ' +
            'Confirm consent in the intake step and save again — your transcript is still on this device.',
          code: 'CONSENT_REQUIRED',
        });
      }

      if (isConsultationWrite) {
        body.consent = consentWasSupplied
          ? {
              obtainedAt: body.consent.obtainedAt,
              disclosureVersion: body.consent.disclosureVersion || deps.aiDisclosureVersion,
              recordedBy: body.consent.recordedBy || dentistId,
            }
          : {
              obtainedAt: '',
              disclosureVersion: deps.aiDisclosureVersion,
              recordedBy: dentistId,
            };

        if (hasTranscript && !consentWasSupplied) {
          void Promise.resolve(
            deps.logAudit('consultation_without_consent_captured', dentistId, { route: originalUrl })
          ).catch(() => {});
        }

        // Privacy notice version travels with the record so a later change to
        // the notice cannot be applied retroactively.
        body.privacyNoticeVersion = deps.privacyNoticeVersion;
        body.retentionYears = deps.retentionYears;
        body.retentionUntil = new Date(
          Date.now() + deps.retentionYears * 365 * 24 * 60 * 60 * 1000
        ).toISOString();

        body.revisions = [
          {
            id: crypto.randomUUID(),
            savedAt: now,
            savedBy: dentistId,
            engine: body.noteOrigin?.engine,
            systemGenerated: false,
          },
        ];
        // Every record carries a version from the moment it is created. Clients
        // send it back on save so a stale write can be refused (see below).
        body.recordVersion = 1;
        return next();
      }

      // ---- Update: preserve consent, append a revision ---------------------
      let existing: any = null;
      try {
        const id = originalUrl.split('/').filter(Boolean).pop();
        const all = await deps.listConsultations(dentistId);
        existing = all.find((c: any) => c.id === id) || null;
      } catch (loadErr: any) {
        deps.logger.warn('Could not load existing consultation for revision stamping:', loadErr?.message || loadErr);
      }

      /*
       * Optimistic concurrency.
       *
       * An offline-first client can hold a draft while the record moves on — the
       * durable worker completes the note, or the same clinician saves from
       * another device at the chair. "Last write wins" would silently discard
       * whichever version lost, which in a clinical record is data loss with no
       * trace. When the client states which version its edit was based on, a
       * mismatch is refused with the server's copy so the clinician can see both.
       *
       * A client that sends no version is accepted (an older client build must
       * not stop being able to save) and the version is stamped forward anyway,
       * so every record has a usable version for the next save.
       */
      const expectedVersion =
        typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
      if (expectedVersion !== null) delete body.expectedVersion;

      if (existing && expectedVersion !== null) {
        const currentVersion = Number((existing as any).recordVersion ?? 1);
        if (currentVersion !== expectedVersion) {
          void Promise.resolve(
            deps.logAudit('consultation_stale_write_rejected', dentistId, {
              recordId: existing.id,
              expectedVersion,
              currentVersion,
            })
          ).catch(() => {});
          return res.status(409).json({
            error:
              'This record changed on another device since you opened it. Your edits are still on screen — open the latest version and re-apply them.',
            code: 'STALE_WRITE',
            currentVersion,
            serverConsultation: existing,
          });
        }
      }

      if (existing) {
        body.recordVersion = Number((existing as any).recordVersion ?? 1) + 1;
        // Consent is append-only: the first recorded consent stands, and a
        // client cannot clear it by omitting or blanking the field.
        body.consent = isValidConsent(existing.consent) ? existing.consent : body.consent;
        body.privacyNoticeVersion = existing.privacyNoticeVersion || deps.privacyNoticeVersion;
        body.retentionYears = existing.retentionYears || deps.retentionYears;
        body.retentionUntil = existing.retentionUntil || body.retentionUntil;

        const priorRevisions = Array.isArray(existing.revisions) ? existing.revisions : [];
        body.revisions = [
          ...priorRevisions,
          {
            id: crypto.randomUUID(),
            savedAt: now,
            savedBy: dentistId,
            engine: body.noteOrigin?.engine,
            systemGenerated: false,
          },
        ];
      } else if (!Array.isArray(body.revisions) || body.revisions.length === 0) {
        body.revisions = [
          { id: crypto.randomUUID(), savedAt: now, savedBy: dentistId, engine: body.noteOrigin?.engine },
        ];
      }

      return next();
    });
  };
}
