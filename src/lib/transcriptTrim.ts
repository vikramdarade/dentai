/**
 * Transcript analysis, trimming and compaction — pure functions shared by the
 * client guard (LiveRecording) and the server-side enforcement in
 * /api/generate-notes. Keeping them pure makes both sides testable and keeps
 * a single definition of "what is clinically relevant" consistent across tiers.
 */

export interface TrimStats {
  /** Total number of transcript items. */
  items: number;
  /** Characters of text across all items. */
  characters: number;
  /** Approximate model tokens (chars / 4). */
  approxTokens: number;
  /** Items that carry clinical signal (kept by the trimmer). */
  clinicalItems: number;
  /** Items with no clinical signal (first candidates to drop). */
  ambientItems: number;
  /** The clinical-term regex matches per item, by index — used for transparency. */
  clinicalIndexes: number[];
}

const CLINICAL_TERM_RE =
  /(percussion|sensitivity|pulp|decay|caries|bleeding|mobility|root canal|filling|composite|amalgam|extraction|extraction|crown|bridge|implant|denture|extraction|scaling|prophy|fluoride|anesthetic|anaesthetic|radiograph|x-ray|xray|occlusion|occlusal| perio|periodontal|furcation|recession|calculus|plaque|abscess|necrosis|pulpitis|crown prep|rubber dam|tooth\s*\d{1,2}|\b\d{1,2}\s*(?:mm)?\s*pocket|fdi|item\s*\d{3,4})/i;

export function isClinicalText(text: string): boolean {
  return CLINICAL_TERM_RE.test(text);
}

export function getTranscriptStats(transcript: { text: string }[]): TrimStats {
  let characters = 0;
  let clinicalItems = 0;
  const clinicalIndexes: number[] = [];
  transcript.forEach((item, index) => {
    characters += item.text.length;
    if (isClinicalText(item.text)) {
      clinicalItems++;
      clinicalIndexes.push(index);
    }
  });
  return {
    items: transcript.length,
    characters,
    approxTokens: Math.ceil(characters / 4),
    clinicalItems,
    ambientItems: transcript.length - clinicalItems,
    clinicalIndexes
  };
}

/** Thresholds shared by client guard and server enforcement. */
export const TRIM_THRESHOLDS = {
  /** Above this token estimate the client warns before generating. */
  clientWarnTokens: 6000,
  /** Hard server-side token ceiling for a single generation request. */
  serverMaxTokens: 14000,
  /** Minimum speech that must remain after trim for generation to proceed. */
  minClinicalItems: 2
};

/**
 * Keeps clinically relevant items, drops obvious ambient chatter, and caps the
 * remaining character budget by keeping the most recent items (clinical content
 * clusters at the end of a consultation). Never rewrites or paraphrases text —
 * it only selects whole items, so nothing is invented or altered.
 */
export function trimTranscript(
  transcript: TranscriptLike[],
  opts?: { maxCharacters?: number; keepClinicalOnly?: boolean }
): TranscriptLike[] {
  const maxCharacters = opts?.maxCharacters ?? 18000;
  const stats = getTranscriptStats(transcript);
  const clinicalSet = new Set(stats.clinicalIndexes);

  let selected: TranscriptLike[] = transcript.filter((_, i) =>
    opts?.keepClinicalOnly ? clinicalSet.has(i) : clinicalSet.has(i) || i >= transcript.length - 12
  );

  // If trimming was too aggressive, fall back to keeping everything recent.
  if (selected.length === 0) {
    selected = transcript.slice(-12);
  }

  // Enforce the character budget from the end (most recent clinical content wins).
  while (selected.length > 1 && selected.reduce((acc, t) => acc + t.text.length, 0) > maxCharacters) {
    selected = selected.slice(1); // drop oldest first
  }

  return selected;
}

interface TranscriptLike {
  text: string;
}

/**
 * Compacts a transcript for AI generation: trims ambient items, enforces the
 * token budget, and returns a human-readable summary of what was done so the
 * UI and the server can disclose it transparently ("42 of 380 lines kept").
 */
export function compactTranscriptForGeneration(
  transcript: TranscriptLike[],
  maxCharacters = 18000
): { transcript: TranscriptLike[]; stats: TrimStats; compacted: boolean; summary: string } {
  const before = getTranscriptStats(transcript);
  if (before.approxTokens <= TRIM_THRESHOLDS.serverMaxTokens) {
    return { transcript, stats: before, compacted: false, summary: 'Full transcript used.' };
  }
  const trimmed = trimTranscript(transcript, { maxCharacters });
  const after = getTranscriptStats(trimmed);
  return {
    transcript: trimmed,
    stats: after,
    compacted: true,
    summary: `Transcript compacted for generation: kept ${after.items} of ${before.items} lines (${before.approxTokens.toLocaleString()} → ${after.approxTokens.toLocaleString()} tokens).`
  };
}
