/**
 * Retention policy — the decision, expressed once.
 *
 * Every consultation already carries `retentionYears` / `retentionUntil`
 * (7 years by default, the Australian dental norm) and
 * docs/legal/retention-and-deletion.md tells practices that records are deleted
 * or de-identified after that. Nothing executed it, which made the promise
 * unproven. This module holds the *decision*; the sweep that applies it lives in
 * src/server/retention.ts.
 *
 * Default action is **delete**, for two reasons:
 *  - At the retention horizon the record is no longer needed for care, so
 *    keeping a de-identified copy is a liability with no clinical benefit.
 *  - "De-identification" of a consultation is only as good as the transcript
 *    inside it. A dictated transcript can contain a name, an employer, a
 *    school, a spouse — free text is not reliably de-identifiable by rule, so
 *    advertising that as the default would overstate the privacy control.
 *    A practice that genuinely needs de-identified records for a registry can
 *    opt in with DENTAI_RETENTION_ACTION=deidentify and do so knowingly.
 *
 * Either way a **tombstone** is kept: identifiers and clinical content are
 * gone, but the record's id, dates and clinic remain so counts, invoices and
 * the audit trail still reconcile. A tombstone carries no patient information.
 */

export type RetentionAction = 'delete' | 'deidentify';

export interface RetentionPolicy {
  action: RetentionAction;
  /** When true, the sweep reports what it would do and changes nothing. */
  dryRun: boolean;
  /** Records handled per sweep, to keep a single tick bounded. */
  batchSize: number;
}

export const DEFAULT_RETENTION_BATCH = 25;

export function retentionPolicyFromEnv(env: Record<string, string | undefined> = process.env): RetentionPolicy {
  const raw = String(env.DENTAI_RETENTION_ACTION || '').toLowerCase();
  const action: RetentionAction = raw === 'deidentify' ? 'deidentify' : 'delete';
  // Off unless explicitly enabled. A destructive sweep must never be something
  // a founder discovers by reading the logs after the fact.
  const enabled = String(env.DENTAI_RETENTION_ENABLED || '').toLowerCase() === 'true';
  const dryRun =
    !enabled || String(env.DENTAI_RETENTION_DRY_RUN || '').toLowerCase() === 'true';
  const batchSize = Number(env.DENTAI_RETENTION_BATCH) > 0
    ? Math.min(Number(env.DENTAI_RETENTION_BATCH), 200)
    : DEFAULT_RETENTION_BATCH;
  return { action, dryRun, batchSize };
}

/** True when the record is past its horizon and has not been handled already. */
export function isPastRetention(
  consultation: { retentionUntil?: string | null; deidentifiedAt?: string | null },
  now: Date = new Date()
): boolean {
  if (!consultation.retentionUntil) return false;
  if (consultation.deidentifiedAt) return false;
  const until = Date.parse(consultation.retentionUntil);
  if (Number.isNaN(until)) return false;
  return until <= now.getTime();
}

/**
 * The record that survives a retention action: id, dates, clinic, and a note
 * that the content was removed deliberately under the retention policy.
 */
export function buildTombstone(
  consultation: any,
  action: RetentionAction,
  atIso: string
): Record<string, any> {
  return {
    id: consultation.id,
    dentistId: consultation.dentistId,
    clinicId: consultation.clinicId,
    date: consultation.date,
    time: consultation.time,
    appointmentType: consultation.appointmentType,
    templateId: consultation.templateId,
    status: 'Archived',
    retentionAction: action,
    retentionUntil: consultation.retentionUntil,
    deidentifiedAt: atIso,
    retentionNote:
      action === 'delete'
        ? 'Clinical content deleted under the practice retention policy.'
        : 'Direct identifiers and transcript removed under the practice retention policy.',
    // Deliberately empty: a tombstone must not contain patient information.
    firstName: '',
    lastName: '',
    dob: '',
    transcript: [],
    patientSummary: '',
    findings: {},
    noteOrigin: consultation.noteOrigin,
    revisions: Array.isArray(consultation.revisions) ? consultation.revisions.slice(-1) : [],
  };
}

/**
 * Best-effort de-identification, for practices that deliberately keep a
 * de-identified record. Removes direct identifiers and the transcript, and
 * scrubs obvious name patterns from the remaining free text. It is not a
 * guarantee — see the note at the top of this file — and the caller records
 * that limitation alongside the action in the audit trail.
 */
export function deidentifyConsultation(consultation: any, atIso: string): Record<string, any> {
  const tombstone = buildTombstone(consultation, 'deidentify', atIso);
  const findings = consultation.findings || {};
  const scrub = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return (
      value
        // Capitalised word pairs are the usual shape of a person's name in a
        // note ("Sarah Nguyen", "Dr Chen", "Smith St").
        .replace(/\b([A-Z][a-z]{1,})\s+([A-Z][a-z]{1,})\b/g, '[name]')
        .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[date]')
        .replace(/\b0[2-9]\d{2}\s?\d{3}\s?\d{3}\b/g, '[phone]')
    );
  };
  const scrubbedFindings: Record<string, string> = {};
  for (const [key, value] of Object.entries(findings as Record<string, unknown>)) {
    scrubbedFindings[key] = scrub(value);
  }
  return {
    ...tombstone,
    findings: scrubbedFindings,
    deidentificationMethod: 'rule-based; free text may retain identifying details',
  };
}

/** Applies the configured action and returns the record to store. */
export function applyRetentionAction(
  consultation: any,
  policy: Pick<RetentionPolicy, 'action'>,
  atIso: string
): Record<string, any> {
  return policy.action === 'deidentify'
    ? deidentifyConsultation(consultation, atIso)
    : buildTombstone(consultation, 'delete', atIso);
}
