/**
 * Browser client for the recorded-audio transcription endpoints.
 *
 * Shared by both capture surfaces — the desktop cockpit (records locally and
 * uploads its own slices) and the legacy record screen (pairs with a phone
 * beacon whose slices the phone already uploaded) — so the failure handling is
 * written once. Every function here is written to *fail soft*: the caller always
 * has the live transcript as a fallback, and a transcription problem must never
 * cost the dentist the appointment they just recorded.
 */

import type { TranscriptItem } from '../types';

export interface TranscriptionResponse {
  ok: true;
  transcript: TranscriptItem[];
  source: string;
  warnings: string[];
  reused?: boolean;
  persisted?: boolean;
  model?: string;
  speakerCounts?: Record<string, number>;
  durationSeconds?: number;
  chunks?: number;
  missingChunks?: number;
  contiguous?: boolean;
}

export interface TranscriptionFailure {
  ok: false;
  /** Server code when it answered, or 'NETWORK' when it could not be reached. */
  code: string;
  error: string;
  /** True when trying again could plausibly succeed. */
  retryable: boolean;
}

export type TranscriptionResult = TranscriptionResponse | TranscriptionFailure;

/**
 * Explicit type guard.
 *
 * This project compiles without `strict`, and under those settings a truthiness
 * check on a discriminant property (`if (result.ok)`) does not narrow the union —
 * so `result.code` would be a type error even inside the failure branch. A
 * user-defined guard narrows regardless of the strictness flags.
 */
export function isTranscriptionFailure(result: TranscriptionResult): result is TranscriptionFailure {
  return result.ok === false;
}

function authHeaders(authToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

/**
 * Uploads one slice of a locally recorded appointment.
 *
 * Returns false rather than throwing: a slice that fails to upload must not stop
 * the recording. A missing slice is reported later as `contiguous: false`, which
 * the note carries as a warning, instead of corrupting the transcript silently.
 */
export async function uploadAudioSegment(input: {
  authToken?: string | null;
  consultationId: string;
  chunkIndex: number;
  base64: string;
  sizeBytes?: number;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/transcribe/audio', {
      method: 'POST',
      headers: authHeaders(input.authToken),
      body: JSON.stringify({
        consultationId: input.consultationId,
        chunkIndex: input.chunkIndex,
        dataBase64: input.base64,
        sizeBytes: input.sizeBytes
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Asks the server to transcribe a recording it already holds. */
export async function requestTranscription(input: {
  authToken?: string | null;
  chairId?: string | null;
  consultationId?: string | null;
  mimeType?: string | null;
  force?: boolean;
}): Promise<TranscriptionResult> {
  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: authHeaders(input.authToken),
      body: JSON.stringify({
        chairId: input.chairId || undefined,
        consultationId: input.consultationId || undefined,
        mimeType: input.mimeType || undefined,
        force: input.force || undefined
      })
    });

    const body: any = await res.json().catch(() => null);

    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        code: body?.code || `HTTP_${res.status}`,
        error: body?.error || 'The recording could not be transcribed.',
        // 4xx answers are about this request (no audio, not authorised, too
        // long) and will not change by retrying; 5xx and a dead network might.
        retryable: res.status >= 500 || res.status === 429
      };
    }

    return {
      ok: true,
      transcript: Array.isArray(body.transcript) ? body.transcript : [],
      source: body.source || 'server-diarized',
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
      reused: !!body.reused,
      persisted: !!body.persisted,
      model: body.model,
      speakerCounts: body.speakerCounts,
      durationSeconds: body.durationSeconds,
      chunks: body.chunks,
      missingChunks: body.missingChunks,
      contiguous: body.contiguous
    };
  } catch {
    return { ok: false, code: 'NETWORK', error: 'The server could not be reached.', retryable: true };
  }
}

/** Blob → base64 (without the data-URL prefix), for slice upload. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
