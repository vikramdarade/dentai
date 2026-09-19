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
 * Intelligent Clinical Horizon Filter (Apple-grade semantic noise pruning).
 * When recordings run long (e.g. 45+ to 90+ minutes) because the mic was left on
 * after the patient left, this filter separates the active clinical consultation
 * from trailing post-op silence, vacuum hiss, or room turnover banter.
 */
export function clinicalHorizonFilter<T extends { sender?: string; text: string }>(transcript: T[]): T[] {
  if (!Array.isArray(transcript) || transcript.length <= 20) {
    return transcript;
  }

  // Find the last significant clinical utterance
  let lastClinicalIndex = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (CLINICAL_TRIGGER_REGEX.test(transcript[i].text)) {
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
