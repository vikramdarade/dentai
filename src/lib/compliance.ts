/**
 * Compliance constants shared by the client and the server.
 *
 * The rule this file exists to enforce: whenever a patient's information is
 * captured or generated, the record must say *what the patient was told* and
 * *which engine produced the content*. Changing the wording of a disclosure
 * means bumping its version here — old records keep the version they were
 * captured under, which is what makes the consent trail auditable.
 *
 * Australian context: Privacy Act 1988 (Cth), Australian Privacy Principles
 * 3 (collection notice) and 5 (notification), and the Notifiable Data Breaches
 * scheme. See docs/legal/ for the clinic-facing documents.
 */

/** Bump when the in-app disclosure wording in PatientIntake changes. */
export const AI_DISCLOSURE_VERSION = '2026-09-ai-assist-v1';

/** Bump when the in-product privacy notice materially changes. */
export const PRIVACY_NOTICE_VERSION = '2026-09-16';

/**
 * Practice-level agreement versions.
 *
 * These are separate from the patient-facing disclosure: they are the terms the
 * *practice* accepts (service terms, and the data-processing terms that make the
 * practice the data controller and DentAI the processor). Bumping a version
 * here invalidates prior acceptances and requires re-acceptance — see
 * src/server/practiceAgreement.ts and docs/legal/practice-agreement-checklist.md.
 */
export const TERMS_VERSION = '2026-09-16';
export const DPA_VERSION = '2026-09-dpa-v1';

/** Where recordings are sent for transcription / note generation. */
export const PROCESSING_REGIONS = {
  /**
   * Note generation. Vertex AI in an Australian region is the primary route;
   * the fallback Gemini developer endpoint processes outside Australia, which
   * is why this must be disclosed rather than assumed.
   */
  noteGeneration: 'Australia (primary) — outside Australia if the Australian route is unavailable',
  /** Database (Neon) region for stored records. */
  storage: 'Australia (Sydney) where the database project is configured for it',
} as const;

/** Disclosure text shown with the intake consent step. Keep in sync with the version above. */
export const AI_DISCLOSURE_TEXT =
  'DentAI uses artificial intelligence to draft clinical notes from this consultation. ' +
  'The draft is an assistive record only — the treating practitioner reviews and remains ' +
  'responsible for its accuracy. Consultation content is processed by our AI provider ' +
  '(Google) and stored in our encrypted clinical database. Where the Australian processing ' +
  'region is unavailable, processing may occur outside Australia; you can decline AI ' +
  'processing and the note can be drafted offline on this device.';

/** Default records-retention horizon for Australian dental practices. */
export const DEFAULT_RETENTION_YEARS = 7;

/** Errors-per-minute ceiling for the optional outbound alert webhook. */
export const ALERT_WEBHOOK_MAX_PER_MINUTE = 10;
