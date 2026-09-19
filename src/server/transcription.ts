/**
 * Server-side audio transcription: recorded audio in, diarized transcript out.
 *
 * This is the piece the pilot was missing. Everything the dentist said was being
 * captured by the phone beacon and stored — and then ignored, because notes were
 * generated from the browser's Web Speech transcript, which has no dental
 * vocabulary, cannot separate speakers, and silently drops audio. See
 * `src/lib/transcription.ts` for the policy half of this (limits, parsing,
 * source selection) and the reasoning for what is deliberately not attempted.
 *
 * TRANSPORT, AND WHY THERE ARE TWO
 *
 *  - Up to ~10 MB of audio the whole recording is sent inline. One request, no
 *    cleanup, lowest latency.
 *  - Above that it is uploaded with the Files API and referenced by URI. The
 *    alternative — splitting the recording into several transcription calls —
 *    is rejected on purpose: MediaRecorder slices after the first are not
 *    independently decodable, and speaker labels are only consistent within a
 *    single call.
 *  - On Vertex AI the Files API does not exist, so an oversized recording is
 *    refused with a code the client can act on, and the note falls back to the
 *    live transcript with a visible warning. A refusal the dentist can see beats
 *    a silently truncated clinical record.
 *
 * SERVER-ONLY: imports the Gemini SDK. Never import from client code.
 */

import { Type } from '@google/genai';
import type { TranscriptItem } from '../types';
import { applyNoteThinking } from '../lib/noteModelConfig';
import {
  TRANSCRIPTION_LIMITS,
  assembleAudioChunks,
  base64Bytes,
  estimateTranscriptionTokens,
  parseDiarizedResponse,
  type AudioChunkLike,
  type DiarizedParseResult
} from '../lib/transcription';

export interface TranscriptionLogger {
  info: (message: string, context?: Record<string, any>) => void;
  warn: (message: string, context?: Record<string, any>) => void;
  error: (message: string, context?: Record<string, any>) => void;
}

export interface AssembledAudio {
  base64: string;
  bytes: number;
  chunks: number;
  missing: number[];
  contiguous: boolean;
  durationSecondsEstimate: number;
  empty: boolean;
}

/**
 * Joins the stored chunks into one continuous recording.
 *
 * Each chunk is decoded and the *bytes* are concatenated, never the base64 text:
 * a chunk whose byte length is not a multiple of three carries its own `=`
 * padding, so joining the strings would corrupt everything after the first gap.
 * (The client's own reassembly uses `new Blob(chunks)` for the same reason.)
 */
export function assembleAudio(chunks: AudioChunkLike[] | undefined | null): AssembledAudio {
  const summary = assembleAudioChunks(chunks);
  const usable = (chunks || [])
    .filter((c) => c && typeof c.dataBase64 === 'string' && c.dataBase64.length > 0)
    .map((c) => ({ index: Number(c.chunkIndex) || 0, data: String(c.dataBase64) }))
    .sort((a, b) => a.index - b.index);

  if (usable.length === 0) {
    return {
      base64: '',
      bytes: 0,
      chunks: 0,
      missing: [],
      contiguous: true,
      durationSecondsEstimate: 0,
      empty: true
    };
  }

  const buffers = usable.map((c) => Buffer.from(c.data, 'base64'));
  const joined = Buffer.concat(buffers);

  return {
    base64: joined.toString('base64'),
    bytes: joined.length,
    chunks: usable.length,
    missing: summary.missing,
    contiguous: summary.contiguous,
    durationSecondsEstimate: summary.durationSecondsEstimate,
    empty: joined.length === 0
  };
}

export const TRANSCRIPTION_SYSTEM_INSTRUCTION = `You are a verbatim clinical transcription engine for an Australian dental practice. You receive the audio of one appointment and return the dialogue, line by line.

NON-NEGOTIABLE RULES:

1. VERBATIM ONLY. Write what was actually said, in the words that were said. Never summarise, never paraphrase, never complete a sentence the speaker abandoned, never add a line to make the conversation read better.

2. NO INVENTED CONTENT. If a passage is unintelligible, leave it out. Never guess a word, a tooth number, a material, a drug or a measurement. An omission the dentist can see is recoverable; an invented tooth number in a clinical record is not.

3. SPEAKER ATTRIBUTION BY ROLE, FROM CONTENT. Label each line "Dentist" or "Patient" using what is being said, not the order of voices:
   - "Dentist": clinical findings and observations, tooth numbers, tests (percussion, cold, EPT), materials and instruments, diagnoses, treatment being performed, clinical instructions to the assistant.
   - "Patient": symptoms and where they are, how long they have been there, history, past treatment, medications, feelings, questions, consent and preferences.
   This distinction matters because the clinical note separates patient-reported information (chief complaint, history) from clinician-observed findings (tooth findings, diagnosis). Getting it wrong moves a patient's own words into the clinician's findings.

4. USE "Dialogue" WHEN IT IS GENUINELY UNCLEAR who spoke, or when several people speak over each other. Do not guess a role to avoid using "Dialogue" — an honest "Dialogue" is reviewed, a wrong "Patient" is not.

5. PRESERVE CLINICAL SPECIFICS EXACTLY as spoken: FDI two-digit tooth notation (11-48, 51-85), quadrants, surfaces (mesial, distal, buccal, lingual, occlusal, palatal), measurements in millimetres, drug names and doses, and Australian dental item terminology. Do not convert, round or "correct" them. Do not convert FDI numbers to another notation.

6. ONE UTTERANCE PER LINE, in the order spoken. Split where the speaker changes or a new thought begins. Keep each line short enough to read.

7. Output JSON only, matching the requested schema. No commentary, no preamble, no translation.`;

export const TRANSCRIPTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING },
          text: { type: Type.STRING }
        },
        required: ['speaker', 'text']
      }
    }
  },
  required: ['lines']
};

export interface TranscriptionError {
  ok: false;
  code:
    | 'NO_AUDIO'
    | 'AUDIO_TOO_SMALL'
    | 'AUDIO_TOO_LARGE_INLINE'
    | 'NOT_CONFIGURED'
    | 'TRANSCRIBE_FAILED';
  message: string;
}

export interface TranscriptionSuccess {
  ok: true;
  transcript: TranscriptItem[];
  stats: DiarizedParseResult;
  transport: 'inline' | 'file';
  modelId: string;
  durationSecondsEstimate: number;
  /** Billed-token estimate, for the clinic's AI allowance. */
  approxTokens: number;
  warnings: string[];
}

export type TranscriptionOutcome = TranscriptionSuccess | TranscriptionError;

/**
 * Explicit type guard rather than `if (!outcome.ok)`.
 *
 * Both forms compile in principle, but the explicit guard makes the narrowing
 * impossible to lose to a future refactor (and is readable at the call site,
 * where "ok" is a booleans-are-confusing word).
 */
export function isTranscriptionError(outcome: TranscriptionOutcome): outcome is TranscriptionError {
  return outcome.ok === false;
}

export interface AudioTranscriberDeps {
  logger: TranscriptionLogger;
  /**
   * Builds the AI client. Supplied by the server so key resolution (Vertex vs
   * Developer API, service-account JSON) stays in exactly one place.
   */
  getClient: () => Promise<{ client: any; vertexai: boolean } | null>;
  model: string;
  timeoutMs?: number;
  /** Poll budget for a Files API upload to become ACTIVE. */
  uploadReadyTimeoutMs?: number;
}

export interface AudioTranscriberInput {
  audioBase64: string;
  mimeType: string;
  bytes: number;
  /** Reported back so the caller can warn that part of the recording is missing. */
  contiguous?: boolean;
}

export interface AudioTranscriber {
  transcribe(input: AudioTranscriberInput): Promise<TranscriptionOutcome>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: any;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

export function createAudioTranscriber(deps: AudioTranscriberDeps): AudioTranscriber {
  const timeoutMs = deps.timeoutMs ?? 90_000;
  const uploadReadyTimeoutMs = deps.uploadReadyTimeoutMs ?? 60_000;

  return {
    async transcribe(input: AudioTranscriberInput): Promise<TranscriptionOutcome> {
      const bytes = input.bytes || base64Bytes(input.audioBase64);

      if (!input.audioBase64 || bytes === 0) {
        return { ok: false, code: 'NO_AUDIO', message: 'No audio was uploaded for this appointment.' };
      }
      if (bytes < TRANSCRIPTION_LIMITS.minAudioBytes) {
        return {
          ok: false,
          code: 'AUDIO_TOO_SMALL',
          message: 'The recording is too short to contain speech.'
        };
      }

      const resolved = await deps.getClient();
      if (!resolved) {
        return {
          ok: false,
          code: 'NOT_CONFIGURED',
          message: 'No AI provider is configured on the server, so the recording cannot be transcribed.'
        };
      }
      const { client, vertexai } = resolved;

      let uploadedFileName: string | undefined;
      try {
        let part: any;
        let transport: 'inline' | 'file';

        if (bytes <= TRANSCRIPTION_LIMITS.maxInlineAudioBytes) {
          transport = 'inline';
          part = { inlineData: { data: input.audioBase64, mimeType: input.mimeType } };
        } else if (vertexai || bytes > TRANSCRIPTION_LIMITS.maxUploadAudioBytes) {
          return {
            ok: false,
            code: 'AUDIO_TOO_LARGE_INLINE',
            message: vertexai
              ? 'This recording is longer than the sovereign processing path can transcribe in one pass. Use the live transcript, or split the appointment.'
              : 'This recording is too long to transcribe in one pass.'
          };
        } else {
          transport = 'file';
          const blob = new Blob([Buffer.from(input.audioBase64, 'base64')], { type: input.mimeType });
          const uploaded: any = await withTimeout(
            client.files.upload({ file: blob, config: { mimeType: input.mimeType } }),
            timeoutMs,
            'Audio upload timed out.'
          );
          uploadedFileName = uploaded?.name;

          const deadline = Date.now() + uploadReadyTimeoutMs;
          let current = uploaded;
          while (current && current.state && String(current.state) !== 'ACTIVE') {
            if (String(current.state) === 'FAILED') throw new Error('The audio upload was rejected by the provider.');
            if (Date.now() > deadline) throw new Error('The audio upload did not become ready in time.');
            await new Promise((r) => setTimeout(r, 1500));
            current = await client.files.get({ name: uploadedFileName });
          }
          part = { fileData: { fileUri: current?.uri ?? uploaded?.uri, mimeType: input.mimeType } };
        }

        const response: any = await withTimeout(
          client.models.generateContent({
            model: deps.model,
            contents: [{ role: 'user', parts: [part, { text: 'Transcribe this appointment.' }] }],
            config: applyNoteThinking({
              responseMimeType: 'application/json',
              responseSchema: TRANSCRIPTION_SCHEMA,
              systemInstruction: TRANSCRIPTION_SYSTEM_INSTRUCTION
            })
          }),
          timeoutMs,
          `Audio transcription timed out after ${Math.round(timeoutMs / 1000)} seconds.`
        );

        const parsed = parseDiarizedResponse(response?.text ?? '');
        const warnings: string[] = [];
        if (parsed.rejected > 0) {
          warnings.push(`${parsed.rejected} audio segment(s) could not be transcribed and were left out.`);
        }
        if (parsed.unlabelled > 0) {
          warnings.push(
            `${parsed.unlabelled} line(s) could not be attributed to the dentist or the patient and are marked as dialogue.`
          );
        }
        if (input.contiguous === false) {
          warnings.push('Part of the recording did not upload, so some of what was said is missing.');
        }

        return {
          ok: true,
          transcript: parsed.transcript,
          stats: parsed,
          transport,
          modelId: deps.model,
          durationSecondsEstimate: Math.round(
            bytes / TRANSCRIPTION_LIMITS.estimatedBytesPerSecond
          ),
          approxTokens: estimateTranscriptionTokens(bytes),
          warnings
        };
      } catch (error: any) {
        deps.logger.error('Audio transcription failed', { message: error?.message });
        return {
          ok: false,
          code: 'TRANSCRIBE_FAILED',
          message: error?.message || 'Audio transcription failed.'
        };
      } finally {
        // Uploaded audio is a clinical record held by a third party: delete it
        // whether or not the transcription succeeded rather than leaving it to
        // the provider's own expiry.
        if (uploadedFileName) {
          try {
            await client.files.delete({ name: uploadedFileName });
          } catch (cleanupError: any) {
            deps.logger.warn('Could not delete uploaded audio from the provider', {
              message: cleanupError?.message
            });
          }
        }
      }
    }
  };
}
