/**
 * `POST /api/transcribe` — turn a chair recording into a diarized transcript.
 *
 * Registered as its own module so it can be unit-tested against a fake AI client
 * and a fake chair store, without booting the whole server (server.ts is over
 * 4,500 lines; nothing that needs a regression test should require it).
 *
 * SECURITY AND COST POSTURE
 *
 *  - Session-authenticated. The phone's chair token is deliberately NOT accepted:
 *    transcribing a recording is reading a patient's clinical encounter, and that
 *    is a clinician action, not a microphone action.
 *  - The chair session must belong to the caller — by dentist id, or by clinic
 *    membership. A chair id is guessable (six hex characters); it is not a
 *    capability, and this route does not treat it as one.
 *  - Audio is read from the stored chunks rather than accepted in the request.
 *    One audio ingress (`/api/beacon/chair/:chairId/upload-chunk`) with its own
 *    size caps, one place where audio is validated, and no third path for a
 *    large body to bypass the server's 1 MB JSON limit.
 *  - Every successful transcription is metered against the clinic's AI allowance,
 *    and a repeat call for the same consultation returns the stored transcript
 *    unless `force` is set — a dentist clicking twice must not pay twice.
 */

import type { TranscriptItem } from '../types';
import { TRANSCRIPTION_USAGE_KINDS } from './aiMetering';
import { CHAIR_AUDIO_LIMITS } from './chairSessionStore';
import type { ChairSessionStore } from './chairSessionStore';
import {
  TRANSCRIPTION_LIMITS,
  assembleAudioChunks,
  base64Bytes,
  type TranscriptSpeaker
} from '../lib/transcription';
import {
  assembleAudio,
  createAudioTranscriber,
  isTranscriptionError,
  type TranscriptionLogger
} from './transcription';

export interface TranscriptionRouteDeps {
  logger: TranscriptionLogger;
  /** Auth middleware; sets `req.dentist`. */
  authenticate: any;
  /** Builds the AI client, or returns null when no provider is configured. */
  getClient: () => Promise<{ client: any; vertexai: boolean } | null>;
  model: string;
  chairStore: ChairSessionStore;
  resolveClinicScope: (dentistId: string, requestedClinicId?: unknown) => Promise<string | undefined>;
  recordUsageEvent: (scopeId: string, dentistId: string, kind: string, tokens: number) => Promise<void>;
  resolveDailyLimits?: (scopeId: string) => Promise<{
    notes: number;
    tokens: number;
    /** Absent in older callers/tests; the gate then falls back to `notes`. */
    transcriptions?: number;
  }>;
  getUsageCountToday?: (scopeId: string, kinds?: readonly string[]) => Promise<number>;
  getTokensUsedToday?: (scopeId: string) => Promise<number>;
  loadConsultation: (id: string, dentistId: string) => Promise<any | null>;
  updateConsultation?: (id: string, dentistId: string, consultation: any) => Promise<boolean>;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
  /** Overridable for tests and for an operator who wants a different timeout. */
  timeoutMs?: number;
}

/** MediaRecorder's default in Chrome/Android, and what the beacon sends. */
const DEFAULT_AUDIO_MIME = 'audio/webm';

/**
 * Only container types the model actually accepts. A client-supplied mime type
 * is metadata, not a hint: forwarding an arbitrary string would turn a bad
 * request into an opaque 400 from the provider.
 */
const ALLOWED_AUDIO_MIME = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/aac'
]);

function normalizeMime(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ALLOWED_AUDIO_MIME.has(value) ? value : fallback;
}

/**
 * Chunk namespace for a clinician's own recording.
 *
 * The cockpit records through the desktop's microphone and has no chair pairing,
 * so its audio is stored against the consultation instead. Same table and same
 * caps as the beacon path — one audio store, one set of limits — but keyed by
 * something the caller's identity can be checked against.
 */
export function consultationAudioKey(consultationId: string): string {
  return `consult:${String(consultationId).slice(0, 80)}`;
}

function speakerCountsOf(transcript: TranscriptItem[]): Record<TranscriptSpeaker, number> {
  const counts: Record<TranscriptSpeaker, number> = { Dentist: 0, Patient: 0, Dialogue: 0 };
  for (const item of transcript) {
    if (item.sender === 'Dentist' || item.sender === 'Patient' || item.sender === 'Dialogue') {
      counts[item.sender] += 1;
    }
  }
  return counts;
}

export function registerTranscriptionRoutes(app: any, deps: TranscriptionRouteDeps): void {
  const transcriber = createAudioTranscriber({
    logger: deps.logger,
    getClient: deps.getClient,
    model: deps.model,
    timeoutMs: deps.timeoutMs
  });

  /**
   * Audio ingress for a clinician's own recording (the cockpit).
   *
   * Authenticated, unlike the beacon's chunk endpoint, and keyed by consultation
   * so the ownership check is a database lookup on the caller's own record rather
   * than a guessable six-character chair id. Sliced by the client; the caps are
   * the beacon path's caps.
   */
  app.post('/api/transcribe/audio', deps.authenticate, async (req: any, res: any) => {
    try {
      const dentistId = req.dentist?.id;
      if (!dentistId) return res.status(401).json({ ok: false, error: 'Authentication required.' });

      const { consultationId, chunkIndex, dataBase64, sizeBytes } = req.body || {};
      if (!consultationId || typeof consultationId !== 'string') {
        return res.status(400).json({ ok: false, error: 'A consultation id is required for a recorded segment.' });
      }
      if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
        return res.status(400).json({ ok: false, error: 'No audio data was supplied.' });
      }

      // Ownership: the caller must own the record the audio belongs to. This is
      // the whole reason this route exists instead of reusing the beacon's
      // unauthenticated chunk endpoint.
      const consultation = await deps.loadConsultation(consultationId, dentistId);
      if (!consultation) {
        return res.status(404).json({ ok: false, error: 'Consultation not found.' });
      }

      const appended = await deps.chairStore.appendAudioChunk({
        chairId: consultationAudioKey(consultationId),
        chunkIndex: Number(chunkIndex) || 0,
        dataBase64,
        sizeBytes: Number(sizeBytes) || Math.floor((dataBase64.length * 3) / 4),
        timestamp: Date.now()
      });

      if (!appended.ok) {
        return res.status(413).json({
          ok: false,
          code: appended.code,
          chunkCount: appended.chunkCount,
          error: 'This appointment has reached the recording limit. Finish the note to keep what has been captured.'
        });
      }

      res.json({ ok: true, saved: true, chunkCount: appended.chunkCount });
    } catch (error: any) {
      deps.logger.error('Audio segment upload failed', { message: error?.message });
      res.status(500).json({ ok: false, error: 'Could not store the recorded segment.' });
    }
  });

  app.post('/api/transcribe', deps.authenticate, async (req: any, res: any) => {
    try {
      const dentistId = req.dentist?.id;
      if (!dentistId) return res.status(401).json({ error: 'Authentication required.' });

      const { chairId, consultationId, force } = req.body || {};

      if (typeof chairId !== 'string' && typeof consultationId !== 'string') {
        return res.status(400).json({
          ok: false,
          code: 'NO_AUDIO',
          error:
            'A chair session id or consultation id is required, because the audio is read from the recording rather than uploaded here.'
        });
      }

      let audioKey: string | null = null;
      let sessionClinicId: string | undefined;
      let chairTelemetry: any;

      if (typeof chairId === 'string' && chairId) {
        const session = await deps.chairStore.get(chairId);
        if (!session) {
          return res.status(404).json({ ok: false, code: 'NO_AUDIO', error: 'Chair session not found.' });
        }

        // Ownership: the recording belongs to the clinician at that chair, or to
        // a clinician in the clinic the chair belongs to. Anyone else gets
        // nothing — the chair id is not a secret, the audio is.
        let authorized = session.dentistId === dentistId;
        if (!authorized && session.clinicId) {
          const scope = await deps.resolveClinicScope(dentistId, session.clinicId);
          authorized = scope === session.clinicId;
        }
        if (!authorized) {
          await Promise.resolve(
            deps.logAudit('transcription_denied', dentistId, { chairId, consultationId: consultationId ?? null })
          ).catch(() => {});
          return res
            .status(403)
            .json({ ok: false, code: 'FORBIDDEN', error: 'This recording belongs to another clinician.' });
        }

        audioKey = chairId;
        sessionClinicId = session.clinicId;
        chairTelemetry = session.telemetry;
      }

      const consultation = consultationId
        ? await deps.loadConsultation(String(consultationId), dentistId)
        : null;
      if (consultationId && !consultation) {
        return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Consultation not found.' });
      }

      if (!audioKey) {
        // Keyed by consultation, and only after the record was found above — so
        // a caller cannot reach another clinician's audio by naming a record.
        audioKey = consultationAudioKey(String(consultationId));
      }

      // Cost guard: a second call for a consultation already transcribed from
      // the same recording returns what was stored.
      if (consultation?.transcriptProvenance?.source === 'server-diarized' && !force) {
        return res.json({
          ok: true,
          transcript: consultation.transcript || [],
          source: 'server-diarized',
          speakerCounts: speakerCountsOf(consultation.transcript || []),
          warnings: consultation.transcriptProvenance.warnings || [],
          reused: true,
          persisted: false,
          model: consultation.transcriptProvenance.modelId || deps.model
        });
      }

      const chunks = await deps.chairStore.listAudioChunks(audioKey);
      const summary = assembleAudioChunks(chunks);
      if (summary.indexes.length === 0) {
        return res.status(400).json({
          ok: false,
          code: 'NO_AUDIO',
          error:
            'No audio was found for this appointment, so the recorded transcript is unavailable. The note will use live speech recognition.'
        });
      }
      if (summary.bytes < TRANSCRIPTION_LIMITS.minAudioBytes) {
        return res.status(400).json({
          ok: false,
          code: 'AUDIO_TOO_SMALL',
          error: 'The recording is too short to contain speech.'
        });
      }

      const audio = assembleAudio(chunks);
      if (audio.bytes > TRANSCRIPTION_LIMITS.maxUploadAudioBytes) {
        return res.status(413).json({
          ok: false,
          code: 'AUDIO_TOO_LARGE_INLINE',
          error: 'This recording is longer than can be transcribed in one pass.'
        });
      }

      /*
       * Pre-flight meter.
       *
       * Transcription is the most expensive call in the product — audio input is
       * billed — so it is measured BEFORE the model is called rather than recorded
       * afterwards. A ceiling that can only be read after the spend cannot bound
       * it.
       *
       * It counts this clinic's transcriptions only. Counting every usage event
       * meant a note generation consumed a transcription, so a clinic that both
       * transcribed and generated hit its ceiling at roughly half the volume it
       * was promised — and was told it had used "all 15 AI notes" when it had
       * used seven.
       *
       * Fails CLOSED, matching the note-generation meter: if the usage store cannot
       * be read, we refuse rather than spend money we cannot count.
       */
      let scopeId: string;
      try {
        scopeId = (await deps.resolveClinicScope(dentistId, sessionClinicId)) || dentistId;
      } catch (scopeErr: any) {
        deps.logger.error('Transcription scope resolution failed; refusing to transcribe:', {
          error: scopeErr?.message || String(scopeErr),
          url: req.originalUrl,
        });
        return res.status(503).json({
          ok: false,
          code: 'METERING_UNAVAILABLE',
          error:
            'Usage metering is unavailable, so audio transcription is paused. Your recording is preserved — live recognition and offline drafting remain available, or retry shortly.',
        });
      }
      if (deps.resolveDailyLimits && deps.getUsageCountToday && deps.getTokensUsedToday) {
        try {
          const limits = await deps.resolveDailyLimits(scopeId);
          const transcriptionLimit = limits.transcriptions ?? limits.notes;
          const usedTranscriptions = await deps.getUsageCountToday(scopeId, TRANSCRIPTION_USAGE_KINDS);
          if (usedTranscriptions >= transcriptionLimit) {
            await Promise.resolve(
              deps.logAudit('transcription_metered_daily_limit', dentistId, {
                scopeId,
                usedTranscriptions,
                transcriptionLimit,
              })
            ).catch(() => {});
            return res.status(429).json({
              ok: false,
              code: 'QUOTA_DAILY',
              error: `This clinic has reached its daily allowance of ${transcriptionLimit} audio transcriptions. Live recognition and offline drafting remain available; transcription resumes tomorrow.`,
            });
          }
          const tokensUsed = await deps.getTokensUsedToday(scopeId);
          if (tokensUsed >= limits.tokens) {
            await Promise.resolve(
              deps.logAudit('transcription_metered_token_cap', dentistId, { scopeId, tokensUsed, limit: limits.tokens })
            ).catch(() => {});
            return res.status(429).json({
              ok: false,
              code: 'QUOTA_TOKENS',
              error: `This clinic has reached its daily AI processing budget. Live recognition and offline drafting remain available; transcription resumes tomorrow.`,
            });
          }
        } catch (meterErr: any) {
          deps.logger.error('Transcription metering pre-flight failed; refusing to transcribe:', {
            error: meterErr?.message || String(meterErr),
            scopeId,
            dentistId,
          });
          await Promise.resolve(
            deps.logAudit('transcription_metering_unavailable', dentistId, { scopeId })
          ).catch(() => {});
          return res.status(503).json({
            ok: false,
            code: 'METERING_UNAVAILABLE',
            error:
              'Usage metering is unavailable, so audio transcription is paused. Your recording is preserved — live recognition and offline drafting remain available, or retry shortly.',
          });
        }
      }

      const mimeType = normalizeMime(
        req.body?.mimeType ?? (chairTelemetry?.audioMimeType as string | undefined),
        DEFAULT_AUDIO_MIME
      );

      const outcome = await transcriber.transcribe({
        audioBase64: audio.base64,
        mimeType,
        bytes: audio.bytes,
        contiguous: audio.contiguous
      });

      if (isTranscriptionError(outcome)) {
        await Promise.resolve(
          deps.logAudit('transcription_failed', dentistId, {
            chairId: chairId ?? null,
            consultationId: consultationId ?? null,
            code: outcome.code,
            audioBytes: audio.bytes,
            chunks: audio.chunks,
            missingChunks: audio.missing.length
          })
        ).catch(() => {});

        const status = outcome.code === 'NOT_CONFIGURED' ? 503 : outcome.code === 'AUDIO_TOO_LARGE_INLINE' ? 413 : 502;
        return res.status(status).json({ ok: false, code: outcome.code, error: outcome.message });
      }

      // Metering: audio input is billed, so it is spent from the clinic's
      // allowance like any other generation.
      try {
        if (scopeId) {
          await deps.recordUsageEvent(scopeId, dentistId, 'ai_transcription', outcome.approxTokens);
        }
      } catch (meterError: any) {
        deps.logger.error('Could not record transcription usage; spend under-counted:', {
          error: meterError?.message || String(meterError),
          scopeId,
          dentistId,
          approxTokens: outcome.approxTokens,
        });
        await Promise.resolve(
          deps.logAudit('usage_recording_failed', dentistId, { scopeId, kind: 'ai_transcription', tokens: outcome.approxTokens })
        ).catch(() => {});
      }

      let persisted = false;
      if (consultation && deps.updateConsultation) {
        const next = {
          ...consultation,
          transcript: outcome.transcript,
          transcriptProvenance: {
            source: 'server-diarized' as const,
            modelId: outcome.modelId,
            chairId: chairId ?? undefined,
            generatedAt: new Date().toISOString(),
            durationSeconds: outcome.durationSecondsEstimate,
            chunks: audio.chunks,
            missingChunks: audio.missing.length,
            contiguous: audio.contiguous,
            speakerCounts: outcome.stats.speakerCounts,
            warnings: outcome.warnings
          }
        };
        try {
          persisted = await deps.updateConsultation(consultation.id, dentistId, next);
        } catch (persistError: any) {
          // The transcript is still returned: refusing to hand back a good
          // transcript because the write failed would lose work the clinic paid for.
          deps.logger.error('Could not persist transcribed speech', { message: persistError?.message, audioKey });
        }
      }

      // Data minimisation: once the transcript is on the record, the raw voice is
      // no longer needed, and holding it is a liability rather than a backup.
      // Only ever after a *persisted* success — a transcript that lives only in
      // the response has nowhere to be recovered from, so its audio stays.
      if (persisted) {
        try {
          await deps.chairStore.deleteAudio(audioKey);
        } catch (cleanupError: any) {
          deps.logger.warn('Could not delete transcribed audio', { message: cleanupError?.message, audioKey });
        }
      }

      await Promise.resolve(
        deps.logAudit('transcription_completed', dentistId, {
          chairId: chairId ?? null,
          consultationId: consultationId ?? null,
          audioDeleted: persisted,
          model: outcome.modelId,
          transport: outcome.transport,
          lines: outcome.transcript.length,
          speakers: outcome.stats.speakerCounts,
          audioBytes: audio.bytes,
          durationSeconds: outcome.durationSecondsEstimate,
          persisted
        })
      ).catch(() => {});

      res.json({
        ok: true,
        transcript: outcome.transcript,
        source: 'server-diarized',
        speakerCounts: outcome.stats.speakerCounts,
        warnings: outcome.warnings,
        reused: false,
        persisted,
        model: outcome.modelId,
        transport: outcome.transport,
        durationSeconds: outcome.durationSecondsEstimate,
        chunks: audio.chunks,
        missingChunks: audio.missing.length,
        contiguous: audio.contiguous,
        // Reported so the UI can be explicit when the recording was capped: the
        // alternative is a dentist believing the whole appointment was analysed.
        storageLimit: {
          maxChunks: CHAIR_AUDIO_LIMITS.maxChunks,
          maxBytes: CHAIR_AUDIO_LIMITS.maxTotalBytes
        }
      });
    } catch (error: any) {
      deps.logger.error('Transcription route failed', { message: error?.message });
      res.status(500).json({ ok: false, code: 'TRANSCRIBE_FAILED', error: 'Transcription failed.' });
    }
  });
}

/** Exposed for tests: byte accounting must match what the store counts. */
export function audioByteLength(base64: string | undefined): number {
  return base64Bytes(base64);
}
