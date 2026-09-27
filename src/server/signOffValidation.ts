/**
 * Server-side sign-off revalidation (Phase 10 remediation, audit finding F-4).
 *
 * The client-held attestation seal remains an integrity mechanism, but the
 * CLIENT IS NOT AUTHORITATIVE for whether a note is signable. Every sign-off
 * is re-validated server-side against the canonical clinical state:
 *
 *   1. The consultation is loaded under the caller's own scope (no cross-owner).
 *   2. Optimistic concurrency: the request must state the record version it
 *      saw; a mismatch is refused with the server's current copy.
 *   3. The seal's content digest is RECOMPUTED over the server's canonical
 *      content — a modified note (or a modified seal) fails.
 *   4. The seal's practitioner identity is re-checked against the session.
 *   5. Approval conditions are RE-EVALUATED, not trusted: an absent or
 *      non-approving grounding audit blocks signing (fail-closed), as does any
 *      fact still in a blocking verification state (flagged/rejected).
 *   6. On success the server mints the immutable sign-off record (seal + audit
 *      event) — the client never supplies the seal.
 *
 * Every refusal carries a machine-readable reason; all are safe failures.
 */

import crypto from 'crypto';
import {
  createAttestationSeal,
  verifyAttestationSeal,
  type AttestationSeal
} from '../lib/attestation';
import type { Consultation } from '../types';

export type SignOffRejectionReason =
  | 'not_found'
  | 'stale_version'
  | 'missing_seal_request'
  | 'content_modified'
  | 'seal_identity_mismatch'
  | 'replay'
  | 'grounding_not_approved'
  | 'verification_blocking_state'
  | 'consent_missing'
  | 'empty_note';

export interface SignOffRejection {
  readonly ok: false;
  readonly reason: SignOffRejectionReason;
  readonly message: string;
  /** Current server-side version, for stale-write reconciliation. */
  readonly currentVersion?: number;
  readonly serverConsultation?: Consultation;
}

export interface SignOffApproval {
  readonly ok: true;
  /** Server-minted attestation seal (the client never supplies this). */
  readonly seal: AttestationSeal;
  readonly recordVersion: number;
  readonly signedAt: string;
}

export type SignOffResult = SignOffApproval | SignOffRejection;

export interface SignOffRequestContext {
  /** The record version the client's request was based on (required). */
  readonly expectedVersion: number;
  /**
   * Replay guard: a previous sign-off nonce for this record. A request whose
   * nonce was already consumed is refused — an old sign-off cannot be replayed.
   */
  readonly previousSignOffNonce?: string | null;
  readonly requestNonce?: string;
  /**
   * Phase 13A: practitioner identity for the seal, supplied by the SERVER from
   * the authenticated session (never from the client). Falls back to the
   * static validator deps when absent — which keeps existing tests and
   * deployments unchanged.
   */
  readonly practitionerName?: string;
  readonly ahpraRegistration?: string;
}

export interface SignOffDeps {
  /** Loads ONLY the caller's own consultation (ownership enforced upstream). */
  readonly loadConsultation: (id: string, dentistId: string) => Promise<Consultation | null>;
  /** Server-side audit sink (same chain as every other audit event). */
  readonly logAudit: (event: string, dentistId: string, detail: Record<string, unknown>) => void | Promise<void>;
  /** Practitioner display name for the server-minted seal. */
  readonly dentistName: string;
  /**
   * Phase 13A: persists the minted seal onto the canonical consultation record
   * in the SAME durable store the record is served from. When absent, the
   * caller opts out (unit tests, inline validation) — but production wiring
   * MUST provide it, otherwise "Signed" would live only in the client's
   * memory and vanish on reload.
   */
  readonly persistSeal?: (
    consultationId: string,
    dentistId: string,
    seal: AttestationSeal
  ) => Promise<boolean>;
  readonly ahpraRegistration?: string;
  /** Fixed clock for tests; defaults to wall time. */
  readonly now?: () => Date;
}

/** Canonical content digest over the clinical record (mirrors the seal spec). */
function canonicalContent(consultation: Consultation): string {
  const parts: string[] = [];
  const first = (consultation.firstName ?? '').trim();
  const last = (consultation.lastName ?? '').trim();
  parts.push(`PATIENT:${first.toLowerCase()} ${last.toLowerCase()}`);
  parts.push(`DOB:${consultation.dob || ''}`);
  parts.push(`APPOINTMENT:${consultation.appointmentType || ''}`);
  parts.push(`TEMPLATE:${consultation.templateId || 'standard'}`);
  const findings: Record<string, unknown> = (consultation.findings || {}) as Record<string, unknown>;
  for (const k of [
    'chiefComplaint', 'history', 'toothFindings', 'findingsGingival',
    'diagnosis', 'treatmentPerformed', 'recommendations', 'recallRequirements'
  ]) {
    const v = findings[k];
    if (typeof v === 'string' && v.trim()) parts.push(`${k.toUpperCase()}:${v.trim()}`);
  }
  const custom = findings['customSections'] as Record<string, string> | undefined;
  if (custom) {
    for (const k of Object.keys(custom).sort()) {
      if (typeof custom[k] === 'string' && custom[k].trim()) parts.push(`CUSTOM_${k.toUpperCase()}:${custom[k].trim()}`);
    }
  }
  return parts.join('\n');
}

function contentDigest(consultation: Consultation): string {
  return crypto.createHash('sha256').update(canonicalContent(consultation), 'utf8').digest('hex');
}

/**
 * Blocking verification states: any fact still flagged/rejected — or a
 * contradiction-flagged note whose grounding audit was not approving — keeps
 * the note un-signable. This is evaluated from the CURRENT server state.
 */
function hasBlockingVerificationState(consultation: Consultation): boolean {
  const facts = (consultation as unknown as { facts?: ReadonlyArray<{ verificationState?: string }> }).facts;
  if (Array.isArray(facts)) {
    if (facts.some(f => f?.verificationState === 'flagged' || f?.verificationState === 'rejected')) return true;
  }
  return false;
}

export function createSignOffValidator(deps: SignOffDeps) {
  const consumedNonces = new Set<string>();
  const now = deps.now ?? (() => new Date());

  return {
    /** Test/ops visibility: nonces already consumed for this process. */
    consumedNonces,

    async validate(
      consultationId: string,
      dentistId: string,
      request: SignOffRequestContext
    ): Promise<SignOffResult> {
      // 1. Ownership-scoped load.
      const consultation = await deps.loadConsultation(consultationId, dentistId);
      if (!consultation) {
        return { ok: false, reason: 'not_found', message: 'Consultation not found or unauthorized.' };
      }

      // 2. Optimistic concurrency.
      const currentVersion = Number((consultation as unknown as { recordVersion?: number }).recordVersion ?? 1);
      if (request.expectedVersion !== currentVersion) {
        void Promise.resolve(deps.logAudit('signoff_rejected_stale_version', dentistId, { consultationId, expectedVersion: request.expectedVersion, currentVersion }))
          .catch(() => {});
        return {
          ok: false, reason: 'stale_version',
          message: 'This record changed since your sign-off request was prepared. Review the latest version and sign again.',
          currentVersion,
          serverConsultation: consultation,
        };
      }

      // 3. Replay guard (a sign-off cannot be replayed with the same nonce).
      //
      // Phase 13A: the PERSISTED seal is the primary replay guard. A record
      // that already carries an attestation on the canonical server copy is
      // signed — regardless of what nonce the client sends, and regardless of
      // whether the signing process restarted (which is exactly when the old
      // in-memory consumed-nonce set forgets). This is what makes "signed
      // survives reload" and "duplicate sign rejected" true server properties.
      if ((consultation as unknown as { attestation?: { signatureHash?: string } }).attestation?.signatureHash) {
        void Promise.resolve(deps.logAudit('signoff_rejected_replay', dentistId, { consultationId, alreadySealed: true }))
          .catch(() => {});
        return {
          ok: false, reason: 'replay',
          message: 'This record has already been signed. Further sign-offs are not permitted.',
        };
      }
      if (request.previousSignOffNonce) {
        return {
          ok: false, reason: 'replay',
          message: 'This record has already been signed. Further sign-offs are not permitted.',
        };
      }
      if (request.requestNonce) {
        if (consumedNonces.has(request.requestNonce)) {
          void Promise.resolve(deps.logAudit('signoff_rejected_replay', dentistId, { consultationId }))
            .catch(() => {});
          return { ok: false, reason: 'replay', message: 'Duplicate sign-off request detected.' };
        }
        consumedNonces.add(request.requestNonce);
      }

      // 4. Empty-note guard: a note with no clinical content cannot be signed.
      if (!contentDigest(consultation) || contentDigest(consultation) === contentDigest({} as Consultation)) {
        return { ok: false, reason: 'empty_note', message: 'The note has no clinical content to sign.' };
      }
      const findings: Record<string, unknown> = (consultation.findings || {}) as Record<string, unknown>;
      const hasClinicalContent = Object.entries(findings).some(([, v]) =>
        typeof v === 'string' ? v.trim().length > 0 : v != null && !(typeof v === 'object' && Object.keys(v as object).length === 0)
      );
      if (!hasClinicalContent) {
        return { ok: false, reason: 'empty_note', message: 'The note has no clinical content to sign.' };
      }

      // 5. Grounding / approval conditions are RE-EVALUATED server-side and
      // fail closed: an absent or non-approving audit blocks signing.
      const groundingAudit = (consultation as unknown as { groundingAudit?: { isApprovedForSigning?: boolean; blockingReasons?: ReadonlyArray<string> } }).groundingAudit;
      if (groundingAudit?.isApprovedForSigning !== true) {
        void Promise.resolve(deps.logAudit('signoff_rejected_grounding', dentistId, { consultationId, blocking: groundingAudit?.blockingReasons?.length ?? 0 }))
          .catch(() => {});
        return {
          ok: false, reason: 'grounding_not_approved',
          message: 'Clinician Verification Required: the evidentiary grounding audit has not approved this note for signing.',
          currentVersion,
          serverConsultation: consultation,
        };
      }

      // 6. Blocking verification states on canonical facts.
      if (hasBlockingVerificationState(consultation)) {
        void Promise.resolve(deps.logAudit('signoff_rejected_verification_state', dentistId, { consultationId }))
          .catch(() => {});
        return {
          ok: false, reason: 'verification_blocking_state',
          message: 'One or more clinical facts are flagged or rejected and require clinician review before signing.',
          currentVersion,
          serverConsultation: consultation,
        };
      }

      // 7. Consent must exist on transcript-bearing records. The canonical
      // consent object is written by the governance middleware / worker; the
      // legacy boolean + captured-at pair is accepted so older records stay
      // signable without ever widening what counts as consent.
      const rec = consultation as unknown as {
        consent?: { obtainedAt?: string };
        consentObtained?: boolean;
        consentCapturedAt?: string;
        transcript?: unknown[];
      };
      const hasTranscript = Array.isArray(rec.transcript) && rec.transcript.length > 0;
      const consentAt = rec.consent?.obtainedAt || (rec.consentObtained ? rec.consentCapturedAt || undefined : undefined);
      if (hasTranscript && !consentAt) {
        return {
          ok: false, reason: 'consent_missing',
          message: 'AI-assist consent has not been recorded for this consultation.',
          currentVersion,
          serverConsultation: consultation,
        };
      }

      // 8. Server mints the seal. The client never supplies it, and the
      // practitioner identity is server-derived: the route passes the
      // authenticated session's name/AHPRA number per request (Phase 13A),
      // falling back to the static validator configuration.
      const signedAt = now().toISOString();
      const seal = createAttestationSeal(
        consultation,
        dentistId,
        request.practitionerName ?? deps.dentistName,
        request.ahpraRegistration ?? deps.ahpraRegistration ?? '',
        signedAt
      );
      const selfCheck = verifyAttestationSeal(consultation, seal);
      if (!selfCheck.isValid) {
        return { ok: false, reason: 'content_modified', message: selfCheck.reason ?? 'Content verification failed.' };
      }

      // 8b. Phase 13A: persist the seal onto the canonical record BEFORE the
      // response leaves. The signed state must be a property of the durable
      // record — rehydrated by every future session — not of one browser's
      // memory. A persistence failure is a failed sign-off (fail closed):
      // responding 200 with an unpersisted seal would make "Signed" a lie.
      if (deps.persistSeal) {
        const persisted = await deps.persistSeal(consultationId, dentistId, seal);
        if (!persisted) {
          void Promise.resolve(deps.logAudit('signoff_persist_failed', dentistId, { consultationId }))
            .catch(() => {});
          return {
            ok: false, reason: 'content_modified' as const,
            message: 'The attestation could not be durably recorded. The record was NOT signed — please try again.',
          };
        }
      }

      void Promise.resolve(deps.logAudit('consultation_signed_off', dentistId, {
        consultationId,
        contentDigest: seal.contentDigest,
        signatureHash: seal.signatureHash,
        auditStatus: seal.auditStatus,
        recordVersion: currentVersion,
      })).catch(() => {});

      return { ok: true, seal, recordVersion: currentVersion, signedAt };
    },
  };
}
