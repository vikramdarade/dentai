/**
 * Flag-Only Treatment-Status & Attribution Contradiction Flags (Phase 5)
 *
 * DETERMINISTIC VALIDATION PRIMITIVE — not a second clinical reasoning layer.
 * These checks run at the server seam after hosted note generation and may only
 * APPEND verification-required conditions to the grounding report. They never
 * rewrite, delete or alter clinical content generated upstream (flag-only rule).
 *
 * Semantics enforced (Phase 5 constraints):
 * - planned ≠ performed:  a note asserting performed treatment that was only
 *   planned/discussed in the transcript is flagged unverified.
 * - negated ≠ performed:  a note asserting performed treatment while the
 *   transcript negates or declines it is flagged as a conflict.
 * - performed ≠ verified: flags never certify; they only force clinician review.
 * - patient report ≠ clinician observation: patient-labelled symptom wording
 *   echoed into clinician findings without corroborating clinician narration
 *   is flagged for attribution confirmation.
 */

import { collectStatusSignals } from './treatmentStatus';

/** Minimal structural subset of GroundingReport the flags operate on. */
export interface FlagableGroundingReport {
  groundingScore: number;
  isFullyGrounded: boolean;
  unverifiedClaims: string[];
}

export interface ContradictionInput {
  /** Treatment/plan sections of the generated note (raw, unmodified). */
  noteTreatmentText: ReadonlyArray<string | undefined>;
  /** Objective/assessment sections of the generated note (raw, unmodified). */
  noteObjectiveText: ReadonlyArray<string | undefined>;
  /** Diarized transcript utterances ({ sender, text }). */
  transcript: ReadonlyArray<{ sender?: string; text?: string }>;
}

/** Deterministic patient-voice marker (symptom/self-report phrasing). */
const PATIENT_SYMPTOM_RE = /\b(?:my\s+(?:tooth|teeth)|i\s+(?:think|feel)|it\s+(?:feels|is|gets?)\s+(?:loose|sore|painful|sensitive|cracked))\b/i;

/**
 * Light morphological normalization for token corroboration so that natural
 * inflection ("feel" vs "feels", "chews" vs "chew") does not defeat a genuine
 * clinician corroboration match. Applied to BOTH sides of every comparison.
 */
function stemToken(word: string): string {
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

function normalizeAndStem(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(stemToken)
    .join(' ');
}

/**
 * Appends flag-only contradiction warnings to the supplied report.
 * Mutates only `report.unverifiedClaims`, `report.isFullyGrounded` and
 * `report.groundingScore`; never the note content itself.
 */
export function appendContradictionFlags(
  report: FlagableGroundingReport,
  input: ContradictionInput
): void {
  const transcript = input.transcript || [];

  // ---- Treatment-status contradictions -----------------------------------
  const noteTreatmentText = input.noteTreatmentText.filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );

  if (noteTreatmentText.length > 0) {
    const transcriptSignals = collectStatusSignals(transcript.map(t => t?.text));
    const noteStatus = collectStatusSignals(noteTreatmentText);

    // planned ≠ performed / negated ≠ performed / discussed ≠ performed:
    // a note asserting performed treatment while the transcript negates or
    // declines it is a critical conflict; a note asserting performed treatment
    // that was never spoken as performed (planned/discussed only) is unverified.
    if (noteStatus.performed && !noteStatus.negated && (transcriptSignals.negated || transcriptSignals.declined)) {
      report.unverifiedClaims.push(
        'Treatment status conflict: the note records treatment as performed, but the transcript negates or declines it. Clinician verification required before signing.'
      );
      report.isFullyGrounded = false;
      report.groundingScore = Math.min(report.groundingScore, 69);
    } else if (noteStatus.performed && !noteStatus.negated && !transcriptSignals.performed) {
      report.unverifiedClaims.push(
        'Treatment status unconfirmed: the note records treatment as performed, but no performed treatment was spoken in the transcript (it may be planned or discussed only). Clinician verification required before signing.'
      );
      report.isFullyGrounded = false;
      report.groundingScore = Math.min(report.groundingScore, 84);
    }
  }

  // ---- Patient-report vs clinician-observation (conservative) -------------
  const objectiveText = input.noteObjectiveText
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n')
    .toLowerCase();
  if (objectiveText) {
    const patientSymptomUtterances = transcript.filter(
      t => t?.sender === 'Patient' && typeof t?.text === 'string' && PATIENT_SYMPTOM_RE.test(t.text)
    );
    const clinicianTexts = transcript
      .filter(t => t?.sender === 'Dentist' && typeof t?.text === 'string')
      .map(t => t.text!.toLowerCase());

    for (const u of patientSymptomUtterances) {
      const tokens = normalizeAndStem(u.text!).split(' ').filter(w => w.length > 3);
      if (tokens.length === 0) continue;
      const objectiveStemmed = normalizeAndStem(objectiveText);
      const overlap = tokens.filter(w => objectiveStemmed.includes(w)).length;
      const corroboratedByClinician = clinicianTexts.some(c => {
        const cStemmed = normalizeAndStem(c);
        return tokens.every(w => cStemmed.includes(w));
      });
      if (!corroboratedByClinician && overlap / tokens.length >= 0.6) {
        report.unverifiedClaims.push(
          'Attribution review: a patient-reported description appears in the clinician findings without corroborating clinician narration. Confirm who observed this before signing.'
        );
        report.isFullyGrounded = false;
        break;
      }
    }
  }
}
