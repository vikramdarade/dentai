/**
 * AI-assist consent — one capture, one canonical object, never an assumption.
 *
 * ## Why this module exists
 *
 * A consultation that carries a transcript must be able to answer "what was the
 * patient told, and who recorded it". The server enforces that in two places:
 * `src/server/recordGovernance.ts` refuses a transcript-bearing write without
 * consent when `DENTAI_REQUIRE_CONSENT=true`, and `src/server/signOffValidation.ts`
 * refuses to mint an attestation seal for one. The canonical shape the record
 * carries is:
 *
 *     consent = { obtainedAt, disclosureVersion, recordedBy }
 *
 * The chairside cockpit had no way to produce that object: consent was captured
 * in the day-schedule queue as a flat pair (`consentObtained` +
 * `consentCapturedAt`), and the cockpit's own writes never carried either. On an
 * enforcing deployment every save that included the transcript was therefore
 * refused 400 CONSENT_REQUIRED, silently queued, and retried forever — the
 * consultation could be recorded but never persisted.
 *
 * ## The rule
 *
 * A consent object is produced ONLY from evidence that exists:
 *
 *   - a canonical consent already recorded on the record (server-echoed, and
 *     append-only), or
 *   - a capture this session's clinician explicitly made, with the disclosure
 *     wording shown at the time.
 *
 * Nothing else. A missing flag, a flag with no instant, an absent record — all
 * yield `null`. There is deliberately no default, no back-dating and no
 * "assumed" consent, because "no consent" is the state the gate exists to
 * represent.
 */

import { AI_DISCLOSURE_VERSION } from './compliance';
import type { Consultation, ConsultationConsent } from '../types';

/** The flat capture pair a day-schedule item (and a pre-canonical record) carries. */
export interface ConsentCaptureFields {
  consentObtained?: boolean;
  consentCapturedAt?: string;
  consentPractitionerId?: string;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The canonical consent object for a captured consent, or `null` when no
 * capture happened.
 *
 * A flag without a capture instant is not a capture — it is a checkbox someone
 * ticked, and it cannot say *when* the patient was told anything. It yields
 * `null` so the write stays refused rather than carrying a consent that cannot
 * be evidenced.
 *
 * @param recordedBy — the authenticated practitioner, used only when the capture
 *   itself did not name one (`consentPractitionerId`).
 */
export function consentFromCapture(
  capture: ConsentCaptureFields | null | undefined,
  recordedBy?: string
): ConsultationConsent | null {
  if (!capture?.consentObtained) return null;
  const obtainedAt = cleanText(capture.consentCapturedAt);
  if (!obtainedAt) return null;
  return {
    obtainedAt,
    disclosureVersion: AI_DISCLOSURE_VERSION,
    recordedBy: cleanText(capture.consentPractitionerId) || cleanText(recordedBy),
  };
}

/**
 * The consent already recorded on a consultation, or `null`.
 *
 * This is a READ of server-held state (the record echo), never a construction:
 * a record with no `consent.obtainedAt` has no recorded consent, whatever else
 * the object contains.
 */
export function recordedConsent(record: Partial<Consultation> | null | undefined): ConsultationConsent | null {
  const consent = record?.consent as Partial<ConsultationConsent> | undefined;
  const obtainedAt = cleanText(consent?.obtainedAt);
  if (!obtainedAt) return null;
  return {
    obtainedAt,
    disclosureVersion: cleanText(consent?.disclosureVersion) || AI_DISCLOSURE_VERSION,
    recordedBy: cleanText(consent?.recordedBy),
  };
}

/**
 * The consent a write for this encounter may carry.
 *
 * A consent already on the record wins (the server treats consent as
 * append-only: the first recorded consent stands), otherwise a capture made in
 * this session is attached. Otherwise `null`, and a transcript-bearing write
 * will be refused — visibly, not silently.
 */
export function consentForWrite(
  record: Partial<Consultation> | null | undefined,
  sessionCapture?: ConsultationConsent | null
): ConsultationConsent | null {
  return recordedConsent(record) ?? sessionCapture ?? null;
}
