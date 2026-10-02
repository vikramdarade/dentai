/**
 * Session Splitter.
 *
 * Two patients are sometimes recorded back-to-back under one running
 * consultation (the chair is turned over, the recorder keeps rolling). This
 * module partitions the transcript at a chosen utterance boundary so the
 * clinician can file each half under its own patient.
 *
 * Session A keeps the original record and id. Session B is a new record with a
 * freshly minted `sess-${Date.now()}` id, because the original id is already
 * referenced by schedule rows, audio segments and the revision trail — minting
 * a new one for the tail is the only direction that cannot orphan those links.
 * Session B starts `In Review`: a split is a human's claim that the tail
 * belongs to another patient, and that claim needs confirming before the record
 * is treated as signed-off care.
 */
import type { Consultation, TranscriptItem } from '../types';

export interface TranscriptSplit {
  /** The original record (same id) carrying utterances `[0, splitIndex)`. */
  sessionA: Consultation;
  /** The new record carrying utterances `[splitIndex, end)`. */
  sessionB: Consultation;
}

/**
 * Partition `session.transcript` at `splitIndex`: the utterance at that index
 * becomes the first utterance of Session B.
 *
 * @throws when the transcript has fewer than two utterances — there is nothing
 * to separate, and silently no-oping would hide the operator's mistake.
 */
export function splitConsultationTranscript(session: Consultation, splitIndex: number): TranscriptSplit {
  const transcript: TranscriptItem[] = Array.isArray(session.transcript) ? session.transcript : [];
  if (transcript.length < 2) {
    throw new Error('Cannot separate a session with fewer than two utterances.');
  }

  // Clamp so both halves are non-empty: 1 <= splitIndex <= length - 1.
  const index = Math.min(Math.max(Math.trunc(splitIndex), 1), transcript.length - 1);

  const sessionA: Consultation = {
    ...session,
    transcript: transcript.slice(0, index),
  };

  const sessionB: Consultation = {
    ...session,
    id: `sess-${Date.now()}`,
    transcript: transcript.slice(index),
    createdAt: new Date().toISOString(),
    status: 'In Review',
    // These are per-encounter links, not per-patient content: the day-sheet row
    // and the server-maintained revision/version trail belong to Session A.
    scheduleItemId: undefined,
    revisions: undefined,
    recordVersion: undefined,
    // The documentation on the original record was written for the WHOLE merged
    // transcript, so it belongs to the first patient. Copying it onto the tail
    // filed patient A's diagnosis, progress note and treatment plan under
    // patient B's record — the same text on two charts, one of them wrong.
    // Session B therefore starts with no clinical content and has to be drafted
    // from its own utterances; `findings`/`patientSummary` are required fields,
    // so they are present but empty rather than dropped.
    clinicalProgressNote: undefined,
    patientSummary: '',
    findings: {
      chiefComplaint: '',
      history: '',
      toothFindings: '',
      findingsGingival: '',
      diagnosis: '',
      treatmentPerformed: '',
      recommendations: '',
      recallRequirements: '',
    },
    facts: undefined,
    proposedTreatments: undefined,
    specialistReferral: undefined,
    treatmentQuote: undefined,
  };

  return { sessionA, sessionB };
}

/** Speaker turn counts per side of a proposed split — used by the modal UI. */
export function summarizeSplit(session: Consultation, splitIndex: number): {
  sessionACount: number;
  sessionBCount: number;
} {
  const length = Array.isArray(session.transcript) ? session.transcript.length : 0;
  const index = Math.min(Math.max(Math.trunc(splitIndex), 0), length);
  return { sessionACount: index, sessionBCount: length - index };
}
