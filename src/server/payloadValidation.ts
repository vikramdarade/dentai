/**
 * Transcript payload validation.
 *
 * The generation routes checked that `transcript` was an array and bounded its
 * length, but never that the entries were usable. `[1, 2, 3]` was accepted and
 * enqueued as a job — which then burned a model call producing nothing, or
 * failed in the worker with an error a clinician could not act on. A clinical
 * record is also not the place to discover that `text` was an object.
 *
 * This runs as path-scoped middleware registered before the handlers, so the
 * rule is enforced once, for both the synchronous and asynchronous generation
 * paths, rather than being re-implemented (and forgotten) per route.
 *
 * Validation is deliberately permissive about *what* is said and strict about
 * *shape*: clinicians dictate odd things, and a transcript that looks unusual is
 * still a valid transcript.
 */

type Middleware = (req: any, res: any, next: (err?: any) => void) => any;

const MAX_ENTRIES = 5_000;
const MAX_TEXT_LENGTH = 20_000;
/** 'Dialogue' and 'Clinical Comment' are the capture roles the recorder emits. */
const ALLOWED_SENDERS = new Set(['Dentist', 'Patient', 'Dialogue', 'Clinical Comment']);

const CLINICAL_TRIGGER_REGEX = /(?:#\d{1,2}|\b(tooth|teeth|fdi|pain|decay|caries|restorative|composite|resin|anesthe|numb|lidocaine|articaine|mepivacaine|infiltrat|block|carpule|clamp|dam|etch|bond|cure|shade|prep|crown|veneer|bridge|implant|scaling|calculus|plaque|prophy|probe|probing|pocket|gingiv|bleeding|perio|pulp|rct|root canal|canal|apex|extract|forceps|elevator|suture|socket|alveol|bite|occlus|floss|brush|hygiene|fluoride|x-ray|bitewing|periapical|opg|cbct|panoram|fracture|chipped|sensitive|abscess|swelling|drain|penicillin|amoxicillin|ibuprofen|paracetamol)\b)/i;

/**
 * Post-operative and aftercare language — deliberately kept separate from the
 * procedure vocabulary above.
 *
 * The horizon filter treats anything it cannot recognise as room noise and drops
 * it once a long trailing tail builds up. Ordinary aftercare advice contains no
 * procedure vocabulary at all: "keep the gauze in for half an hour", "no smoking
 * tonight", "the script is at reception", "ring us if it swells". Without this
 * list a genuine post-op handover could be discarded before the note was
 * generated, and nothing downstream would report it.
 *
 * The entries are intentionally broad; each one only makes the filter more
 * conservative (it keeps more of the transcript).
 */
const AFTERCARE_TRIGGER_REGEX = /\b(rinse|gauze|mouthwash|salt\s?water|smok|numbing|numbness|ice\s?pack|ice|pack|heal|rehabilitat|script|prescription|medication|antibiotic|analgesic|painkiller|panadeine|nurofen|soft diet|diet|food|eat|eating|drink|straw|follow[\s-]?up|review|recall|reception|appointment|aftercare|swallow|temperature|soreness|discomfort|pressure|nause|drowsy|dizzy|bleed|swollen|tender|avoid|exercise|lift|rest)\b/i;

/**
 * Clinical Horizon Filter.
 *
 * When a recording runs long because the microphone was left running after the
 * patient left (45-90 minutes is common), this keeps the consultation and drops
 * the trailing room turnover: vacuum hiss, instrument restyling, unrelated
 * banter.
 *
 * It is a heuristic, and it is worth being precise about that, because the
 * outcome is silent — an utterance it recognises as neither clinical nor
 * aftercare is removed from the transcript the note is generated from, and
 * nothing downstream reports that a trim occurred. It therefore only trims when a
 * long tail (more than 15 utterances) has accumulated after the last recognised
 * clinical utterance, and the recognition vocabulary deliberately includes
 * aftercare language so a post-op handover is never mistaken for noise.
 *
 * This does not guarantee "zero loss" of anything. If clinical advice is phrased
 * entirely outside the vocabulary below and more than 15 such utterances follow
 * the last recognised one, it will be trimmed.
 */
export function clinicalHorizonFilter<T extends { sender?: string; text: string }>(transcript: T[]): T[] {
  if (!Array.isArray(transcript) || transcript.length <= 20) {
    return transcript;
  }

  // Find the last significant clinical-or-aftercare utterance.
  let lastClinicalIndex = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const text = transcript[i].text;
    if (CLINICAL_TRIGGER_REGEX.test(text) || AFTERCARE_TRIGGER_REGEX.test(text)) {
      lastClinicalIndex = i;
      break;
    }
  }

  // If no clinical triggers were found, return the full transcript
  if (lastClinicalIndex === -1) {
    return transcript;
  }

  // Only filter if there is a significant trailing tail of post-procedure room turnover noise (>15 non-clinical utterances)
  const trailingCount = transcript.length - (lastClinicalIndex + 1);
  if (trailingCount <= 15) {
    return transcript;
  }

  // Allow a graceful 15-utterance margin after the last clinical discussion
  // to capture closing patient instructions ("rinse gently", "see reception for your next appointment")
  const cutoffIndex = Math.min(transcript.length, lastClinicalIndex + 16);
  return transcript.slice(0, cutoffIndex);
}

export interface ValidationProblem {
  error: string;
  code: string;
}

/**
 * Returns the first problem with a transcript, or null when it is usable.
 * Pure, so the rule is unit-testable without an HTTP server.
 */
export function validateTranscript(transcript: unknown): ValidationProblem | null {
  if (transcript === undefined || transcript === null) return null; // optional on some paths
  if (!Array.isArray(transcript)) {
    return { error: 'transcript must be an array of entries.', code: 'TRANSCRIPT_INVALID' };
  }
  if (transcript.length > MAX_ENTRIES) {
    return {
      error: `Transcript contains too many entries (maximum ${MAX_ENTRIES}). Split the consultation or trim the transcript.`,
      code: 'TRANSCRIPT_TOO_LONG',
    };
  }
  for (let index = 0; index < transcript.length; index += 1) {
    const entry: any = transcript[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        error: `Transcript entry ${index + 1} is not an object with "sender" and "text".`,
        code: 'TRANSCRIPT_ENTRY_INVALID',
      };
    }
    if (typeof entry.text !== 'string') {
      return {
        error: `Transcript entry ${index + 1} has no text.`,
        code: 'TRANSCRIPT_ENTRY_INVALID',
      };
    }
    if (entry.text.length > MAX_TEXT_LENGTH) {
      return {
        error: `Transcript entry ${index + 1} is longer than ${MAX_TEXT_LENGTH} characters.`,
        code: 'TRANSCRIPT_ENTRY_TOO_LONG',
      };
    }
    if (entry.sender !== undefined && typeof entry.sender !== 'string') {
      return {
        error: `Transcript entry ${index + 1} has an invalid sender.`,
        code: 'TRANSCRIPT_ENTRY_INVALID',
      };
    }
    if (typeof entry.sender === 'string' && entry.sender.length > 0 && !ALLOWED_SENDERS.has(entry.sender)) {
      // Unknown roles are mapped to 'Dialogue' by the client, so a stray value
      // here means a hand-crafted request; refusing is clearer than guessing.
      return {
        error: `Transcript entry ${index + 1} has an unrecognised sender "${entry.sender.slice(0, 40)}".`,
        code: 'TRANSCRIPT_SENDER_INVALID',
      };
    }
  }
  return null;
}

/** Rejects an empty transcript on paths that require one. */
export function validateTranscriptionRequirements(body: any, options: { requireIntake: boolean }): ValidationProblem | null {
  const transcript = validateTranscript(body?.transcript);
  if (transcript) return transcript;

  if (options.requireIntake) {
    const intake = body?.intakeData;
    // Wording kept compatible with the long-standing API contract.
    if (!intake || typeof intake !== 'object' || Array.isArray(intake)) {
      return {
        error: 'Missing or invalid intakeData or transcript in request body.',
        code: 'INTAKE_REQUIRED',
      };
    }
    if (typeof intake.appointmentType !== 'string' || intake.appointmentType.trim() === '') {
      return {
        error: 'Missing or invalid intakeData or transcript in request body.',
        code: 'INTAKE_REQUIRED',
      };
    }
  }

  if (Array.isArray(body?.transcript) && body.transcript.length === 0 && options.requireIntake) {
    return {
      error: 'Transcript is empty — record or type dialogue first.',
      code: 'TRANSCRIPT_EMPTY',
    };
  }
  return null;
}

export function createTranscriptValidation(options: {
  requireIntake: boolean;
  onlyMethod?: string;
}): Middleware {
  const method = (options.onlyMethod || 'POST').toUpperCase();
  return function transcriptValidation(req, res, next) {
    if (String(req.method || '').toUpperCase() !== method) return next();
    const problem = validateTranscriptionRequirements(req.body, options);
    if (problem) return res.status(400).json(problem);
    return next();
  };
}
