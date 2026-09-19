/**
 * Audio transcription policy — pure, shared, no SDK and no Buffer.
 *
 * WHY THIS MODULE EXISTS
 *
 * Until now the transcript came only from the browser's Web Speech API. That is
 * not a clinical transcription system: it has no dental vocabulary biasing, it
 * cannot tell the dentist from the patient, and it silently drops audio whenever
 * the OS recogniser loses its place. The pilot complaint ("notes were not
 * accurate") starts here — no amount of prompt engineering recovers a tooth
 * number that was never transcribed.
 *
 * The chair-side phone beacon already uploads the real audio
 * (`/api/beacon/chair/:chairId/upload-chunk`). It was being stored and never
 * read: notes were generated from the browser transcript while the actual
 * recording sat in the database. This module is the policy half of turning that
 * stored audio into a diarized transcript.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 *
 * Audio windows. It is tempting to split a long recording into several
 * transcription calls and concatenate the results, but MediaRecorder slices are
 * not independently decodable (only the first slice carries the container
 * header), and speaker labels are only consistent *within* a call — batch two's
 * "Patient" can be batch one's "Dentist". Both failure modes are silent and both
 * corrupt a clinical record, so long audio is handled by uploading the whole
 * buffer (see `src/server/transcription.ts`) or by an explicit, visible refusal.
 */

import type { TranscriptItem } from '../types';

/** The speaker roles the clinical pipeline understands. */
export type TranscriptSpeaker = 'Dentist' | 'Patient' | 'Dialogue';

export interface DiarizedLine {
  speaker: TranscriptSpeaker;
  text: string;
}

/** Structural subset of a stored chair audio chunk. */
export interface AudioChunkLike {
  chunkIndex: number;
  dataBase64?: string;
  sizeBytes?: number;
}

export interface AssembledAudio {
  /** Ordered chunk indexes actually used. */
  indexes: number[];
  /** Missing indexes inside the present range — a hole means missing speech. */
  missing: number[];
  /** Approximate decoded byte length (base64 math, no decoding here). */
  bytes: number;
  durationSecondsEstimate: number;
  /** True when the chunk sequence has no holes and nothing was dropped. */
  contiguous: boolean;
}

/**
 * Bounds. Chosen against the Gemini request limits rather than by taste:
 * the inline (whole-request) limit is 20 MB, and base64 inflates payloads by
 * 4/3, so ~10 MB of audio is the largest inline payload that leaves room for
 * the instruction and the response. Above that the audio must go through the
 * Files API — and on Vertex (the Australian sovereign path) the Files API is not
 * available at all, so that case is refused in the open rather than truncated.
 */
export const TRANSCRIPTION_LIMITS = {
  /** Largest audio payload sent inline. */
  maxInlineAudioBytes: 10 * 1024 * 1024,
  /** Largest audio upload accepted at all (Files API path). */
  maxUploadAudioBytes: 200 * 1024 * 1024,
  /** Refuse payloads too small to contain speech rather than burn a call. */
  minAudioBytes: 4 * 1024,
  /** Line budget — a runaway generation must not become a giant record. */
  maxLines: 4000,
  /** A single "line" longer than this is a runaway, not an utterance. */
  maxLineChars: 2000,
  /** Shorter than this after trimming is noise, not speech. */
  minTextChars: 2,
  /** Bytes per second of Opus at ~48 kbps; used for telemetry and metering only. */
  estimatedBytesPerSecond: 6000,
  /** Gemini bills audio input at roughly 32 tokens per second. */
  tokensPerAudioSecond: 32
} as const;

/** Decoded byte length of a base64 string, without decoding it. */
export function base64Bytes(base64: string | undefined | null): number {
  if (typeof base64 !== 'string') return 0;
  const clean = base64.replace(/\s+/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function estimateAudioSeconds(bytes: number): number {
  return Math.round(Math.max(0, bytes) / TRANSCRIPTION_LIMITS.estimatedBytesPerSecond);
}

export function estimateTranscriptionTokens(bytes: number): number {
  return Math.round(estimateAudioSeconds(bytes) * TRANSCRIPTION_LIMITS.tokensPerAudioSecond);
}

/**
 * Summarises the stored audio for one chair session.
 *
 * Ordering is by `chunkIndex`, never by insertion order: chunks can arrive out
 * of order when a phone reconnects after a Wi-Fi drop, and a transcript assembled
 * in arrival order is a scrambled record.
 */
export function assembleAudioChunks(chunks: AudioChunkLike[] | undefined | null): AssembledAudio {
  const usable = (chunks || [])
    .filter((c) => c && typeof c.dataBase64 === 'string' && c.dataBase64.length > 0)
    .map((c) => ({ index: Number(c.chunkIndex) || 0, data: String(c.dataBase64) }))
    .sort((a, b) => a.index - b.index);

  if (usable.length === 0) {
    return { indexes: [], missing: [], bytes: 0, durationSecondsEstimate: 0, contiguous: true };
  }

  const first = usable[0].index;
  const last = usable[usable.length - 1].index;
  const present = new Set(usable.map((u) => u.index));
  const missing: number[] = [];
  for (let i = first; i <= last; i += 1) {
    if (!present.has(i)) missing.push(i);
  }

  const bytes = usable.reduce((sum, u) => sum + base64Bytes(u.data), 0);

  return {
    indexes: usable.map((u) => u.index),
    missing,
    bytes,
    durationSecondsEstimate: estimateAudioSeconds(bytes),
    contiguous: missing.length === 0
  };
}

const SPEAKER_ALIASES: Record<string, TranscriptSpeaker> = {
  dentist: 'Dentist',
  doctor: 'Dentist',
  dr: 'Dentist',
  clinician: 'Dentist',
  operator: 'Dentist',
  // A hygienist records findings in the chart, so their speech belongs with the
  // clinical observations rather than with the patient's own report.
  hygienist: 'Dentist',
  patient: 'Patient',
  pt: 'Patient',
  client: 'Patient',
  speaker2: 'Patient',
  dialogue: 'Dialogue',
  conversation: 'Dialogue',
  both: 'Dialogue',
  unknown: 'Dialogue',
  speaker1: 'Dialogue',
  other: 'Dialogue',
  multiple: 'Dialogue',
  // Deliberately NOT the clinician. A dental assistant or nurse may be in the
  // room and speaking, but attributing their words to the dentist asserts a
  // clinical observation by a person who did not make it — the same class of
  // error as putting a patient's words in the findings section. Unknown is the
  // honest label; the note flags unattributed lines for review.
  assistant: 'Dialogue',
  dentalassistant: 'Dialogue',
  da: 'Dialogue',
  nurse: 'Dialogue',
  receptionist: 'Dialogue',
  staff: 'Dialogue'
};

/**
 * Maps a model-reported or hand-written speaker label onto a known role.
 *
 * Returns `null` for anything unrecognised — never a default role. A caller that
 * turns `null` into 'Dialogue' records "we do not know who said this"; a caller
 * that defaults to 'Dentist' would silently promote unknown speech into clinical
 * findings.
 */
export function normalizeSpeaker(raw: unknown): TranscriptSpeaker | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return null;
  // "the patient", "the patient's mother" → try the label without its article.
  const withoutArticle = key.startsWith('the') && key.length > 3 ? key.slice(3) : key;
  return SPEAKER_ALIASES[key] ?? SPEAKER_ALIASES[withoutArticle] ?? null;
}

export interface DiarizedParseResult {
  transcript: TranscriptItem[];
  accepted: number;
  /** Entries dropped as empty, punctuation-only or malformed. */
  rejected: number;
  /** Entries whose speaker could not be read and were recorded as unattributed. */
  unlabelled: number;
  /** Entries shortened to the line cap. */
  truncated: number;
  /** Repeated consecutive lines collapsed (a known ASR failure mode). */
  collapsedRepeats: number;
  speakerCounts: Record<TranscriptSpeaker, number>;
}

const EMPTY_RESULT = (): DiarizedParseResult => ({
  transcript: [],
  accepted: 0,
  rejected: 0,
  unlabelled: 0,
  truncated: 0,
  collapsedRepeats: 0,
  speakerCounts: { Dentist: 0, Patient: 0, Dialogue: 0 }
});

/**
 * Turns the model's structured output into transcript items.
 *
 * Accepts `{ lines: [...] }`, a bare array, or a JSON string, because a model
 * that is merely *asked* for JSON occasionally returns bare JSON that is still
 * exactly what we wanted. What it will not do is invent: an entry with no usable
 * text is dropped and counted, and an entry with an unreadable speaker becomes
 * 'Dialogue' — the honest label — instead of being guessed into a clinical role.
 */
export function parseDiarizedResponse(raw: unknown): DiarizedParseResult {
  const result = EMPTY_RESULT();

  let candidate: unknown = raw;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return result;
    }
  }

  const list = Array.isArray(candidate)
    ? candidate
    : candidate && typeof candidate === 'object' && Array.isArray((candidate as any).lines)
      ? (candidate as any).lines
      : null;

  if (!list) return result;

  let previousText = '';
  for (const entry of list.slice(0, TRANSCRIPTION_LIMITS.maxLines)) {
    if (!entry || typeof entry !== 'object') {
      result.rejected += 1;
      continue;
    }

    let text = typeof (entry as any).text === 'string' ? (entry as any).text : '';
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length < TRANSCRIPTION_LIMITS.minTextChars || !/[a-z0-9]/i.test(text)) {
      result.rejected += 1;
      continue;
    }

    if (text.length > TRANSCRIPTION_LIMITS.maxLineChars) {
      text = text.slice(0, TRANSCRIPTION_LIMITS.maxLineChars).trim();
      result.truncated += 1;
    }

    if (text === previousText) {
      result.collapsedRepeats += 1;
      continue;
    }

    const speaker = normalizeSpeaker((entry as any).speaker);
    if (!speaker) result.unlabelled += 1;

    const role: TranscriptSpeaker = speaker ?? 'Dialogue';
    result.speakerCounts[role] += 1;
    result.transcript.push({ sender: role, text });
    result.accepted += 1;
    previousText = text;
  }

  return result;
}

export type TranscriptSource = 'server-diarized' | 'browser-live' | 'none';

export interface TranscriptChoice {
  transcript: TranscriptItem[];
  source: TranscriptSource;
  /** Operator-facing warnings. Never silently empty: an empty list means "clean". */
  warnings: string[];
  /** True when the choice is weak enough that a human must confirm the note. */
  needsReview: boolean;
}

/** Anything with a sender/text shape, so this works for stored and live items alike. */
type TranscriptLike = TranscriptItem[] | undefined | null;

function contentWords(items: TranscriptLike): number {
  return (items || []).reduce(
    (sum, item) => sum + String(item?.text || '').split(/\s+/).filter(Boolean).length,
    0
  );
}

function attributedShare(items: TranscriptLike): number {
  const list = (items || []).filter((i) => i && String(i.text || '').trim().length > 0);
  if (list.length === 0) return 0;
  const attributed = list.filter((i) => i.sender === 'Dentist' || i.sender === 'Patient').length;
  return attributed / list.length;
}

/**
 * Chooses which transcript the note is generated from.
 *
 * Rule: audio-derived beats browser-derived. The diarized transcript came from
 * the recording itself and carries speaker roles, which the template needs — its
 * sections are split by *who reported* the information. The browser transcript is
 * the fallback, and it is labelled as unattributed rather than dressed up as
 * speaker-separated.
 *
 * There is one case where the richer source is also the more dangerous one: if
 * the upload lost chunks, the diarized transcript is quietly shorter than what
 * was actually said. So the two are compared by word count, and a large shortfall
 * is surfaced as a warning plus a review flag instead of being used silently.
 * Note the bias: this prefers to *use* the better transcript and raise a flag,
 * because discarding real audio-derived text in favour of a lossy live transcript
 * is not obviously safer — it just fails differently.
 */
export function chooseNoteTranscript(input: {
  live?: TranscriptLike;
  diarized?: TranscriptLike;
  /** Set when the audio could not be uploaded whole (chunk gaps or a size refusal). */
  audioIncomplete?: boolean;
}): TranscriptChoice {
  const live = (input.live || []).filter((i) => i && String(i.text || '').trim().length > 0);
  const diarized = (input.diarized || []).filter((i) => i && String(i.text || '').trim().length > 0);

  const warnings: string[] = [];

  if (diarized.length > 0) {
    const diarizedWords = contentWords(diarized);
    const liveWords = contentWords(live);

    if (input.audioIncomplete) {
      warnings.push(
        'The recorded audio was not uploaded in full, so some of what was said may be missing from this transcript.'
      );
    }
    if (liveWords > 0 && diarizedWords < liveWords * 0.6) {
      warnings.push(
        'Audio transcription produced noticeably less text than the live transcript (possibly missing speech). Check the recording before signing.'
      );
    }
    const share = attributedShare(diarized);
    if (share < 0.5) {
      warnings.push(
        'Who was speaking could not be determined for most of this recording, so patient-reported and clinician-observed statements may be mixed.'
      );
    }

    return {
      transcript: diarized.map((i) => ({ sender: i.sender, text: String(i.text).trim() })),
      source: 'server-diarized',
      warnings,
      needsReview: warnings.length > 0
    };
  }

  if (live.length > 0) {
    const share = attributedShare(live);
    warnings.push(
      share < 0.5
        ? 'This note was generated from live speech recognition, which does not separate the dentist from the patient. Treat patient-reported and clinician-observed sections with care.'
        : 'This note was generated from live speech recognition rather than the recorded audio.'
    );
    return {
      transcript: live.map((i) => ({ sender: i.sender, text: String(i.text).trim() })),
      source: 'browser-live',
      warnings,
      needsReview: true
    };
  }

  return {
    transcript: [],
    source: 'none',
    warnings: ['No speech was captured for this appointment. Anything written must be entered by hand.'],
    needsReview: true
  };
}

/** One-line provenance label for the operator UI and the audit trail. */
export function describeTranscriptSource(source: TranscriptSource): string {
  switch (source) {
    case 'server-diarized':
      return 'Recorded audio (dentist/patient identified)';
    case 'browser-live':
      return 'Live speech recognition (speakers not separated)';
    default:
      return 'No transcript';
  }
}
