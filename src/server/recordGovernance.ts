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
import { pipelineMetrics } from '../lib/pipelineMetrics';

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

    /**
     * Path only — never the query string.
     *
     * These decisions used to run against `originalUrl`, which includes the
     * query, while every pattern is anchored with `$`. Appending one parameter
     * (?x=1) made all three patterns fail, so the middleware returned early and a
     * consultation write or read fell straight through to its handler with no
     * consent gate, no revision stamp, no retention stamp, no stale-write guard
     * and no read audit — and Express still served the request, because route
     * matching ignores the query string. That made the consent control opt-out
     * from the client side. Strip the query before every decision, and use the
     * stripped form for the audit label so a caller cannot inflate it either.
     */
    const pathname: string = originalUrl.split('?')[0].split('#')[0];

    const isConsultationWrite = method === 'POST' && /^\/api\/consultations\/?$/.test(pathname);
    const isConsultationUpdate =
      (method === 'PUT' || method === 'PATCH') && /^\/api\/consultations\/[^/?]+$/.test(pathname);
    const isConsultationRead =
      method === 'GET' &&
      (/^\/api\/consultations\/?$/.test(pathname) ||
        /^\/api\/clinics\/[^/]+\/consultations\/?$/.test(pathname));

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
                route: pathname,
                count,
                scope: /^\/api\/clinics\//.test(pathname) ? 'clinic' : 'own',
              })
            ).catch(() => {});
          }
          return originalJson(body);
        };
        return next();
      }

      const body = req.body;
      if (!body || typeof body !== 'object') return next();

      // Phase 11: server-derived integrity fields are NOT client-writable. The
      // chairside client PUTs the whole consultation object (including the
      // grounding audit it displays), so without this strip a stale or tampered
      // client could re-assert an approving audit — or carry a previous
      // approval across a content-modifying edit — and self-authorise a
      // sign-off. Approval state is recomputed server-side below; the client's
      // copy is discarded on every write.
      // Phase 13A: `attestation` joins the server-owned set. The seal is
      // minted by the sign-off endpoint from the authenticated session and
      // persisted server-side; a client that could POST/PUT its own seal
      // would be able to assert "Signed" without the clinician ever signing.
      for (const derived of ['groundingAudit', 'groundingReport', 'sovereignty', 'facts', 'recordVersion', 'revisions', 'identityNeedsReview', 'attestation']) {
        delete body[derived];
      }

      // Phase 9: a clinician edit to an AI-generated record is a correction
      // event — counted PHI-free (ids only) so the correction rate is
      // observable without ever storing what was corrected.
      if (isConsultationUpdate) {
        pipelineMetrics.recordCounter('clinicianCorrection');
      }

      const now = new Date().toISOString();
      const transcript = Array.isArray(body.transcript) ? body.transcript : [];
      const hasTranscript = transcript.length > 0;
      const consentWasSupplied = isValidConsent(body.consent);

      // ---- The record's own consent (updates) ------------------------------
      // Consent is a property of the RECORD, not of each request: it is captured
      // once (chairside, at intake, or by the durable worker) and append-only
      // from then on. An update therefore has to be COVERED by consent; it does
      // not have to re-assert it. Requiring each request to repeat the consent
      // made a record whose consent was already on file unsavable the moment it
      // carried a transcript: the save was refused 400, queued, and retried
      // forever, and the record could never be signed.
      //
      // The stored record is loaded here because the decision below needs it;
      // the update branch further down reuses this same copy.
      let existing: any = null;
      if (isConsultationUpdate) {
        try {
          const id = pathname.split('/').filter(Boolean).pop();
          const all = await deps.listConsultations(dentistId);
          existing = all.find((c: any) => c.id === id) || null;
        } catch (loadErr: any) {
          deps.logger.warn('Could not load existing consultation for revision stamping:', loadErr?.message || loadErr);
        }
      }

      // Consent already on file: the canonical object this middleware / the
      // worker writes, or the legacy flat pair the sign-off gate also accepts —
      // so a record captured by an older build stays covered without widening
      // what counts as consent.
      const consentOnFile = isValidConsent(existing?.consent)
        ? true
        : Boolean(existing?.consentObtained && typeof existing?.consentCapturedAt === 'string' && existing.consentCapturedAt);

      // ---- Consent ---------------------------------------------------------
      if (hasTranscript && deps.requireConsent && !consentWasSupplied && !consentOnFile) {
        // The patient's consent is the legal basis for processing their
        // consultation content, so an enforcing deployment refuses the record
        // rather than storing content it cannot justify.
        await deps.logAudit('consultation_rejected_no_consent', dentistId, { route: pathname });
        return res.status(400).json({
          error:
            'This consultation cannot be saved because AI-assist consent has not been recorded for it. ' +
            'Record the patient\u2019s consent and save again — your transcript is still on this device.',
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
            deps.logAudit('consultation_without_consent_captured', dentistId, { route: pathname })
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
      // `existing` was loaded above (the consent decision needs it).

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
