import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  TRANSCRIPTION_LIMITS,
  assembleAudioChunks,
  base64Bytes,
  chooseNoteTranscript,
  describeTranscriptSource,
  estimateTranscriptionTokens,
  normalizeSpeaker,
  parseDiarizedResponse
} from '../src/lib/transcription';
import { assembleAudio, createAudioTranscriber } from '../src/server/transcription';
import { consultationAudioKey, registerTranscriptionRoutes } from '../src/server/transcriptionRoutes';
import type { ChairSession } from '../src/server/chairSessionStore';

/**
 * Recorded-audio transcription.
 *
 * This is the pilot's accuracy complaint, so the tests are written around the
 * failure modes that produced it rather than around the happy path:
 *  - unlabelled speech being reported as speaker-separated,
 *  - a hole in an upload passing itself off as a complete recording,
 *  - a diarized transcript that is quietly shorter than what was said,
 *  - the browser transcript silently winning over the recorded one,
 *  - and a fabricated transcript standing in for a recording that failed.
 */

const SECOND = 6000; // bytes of Opus per second, per the limits module

/** A base64 blob of `bytes` bytes (valid base64, distinct per seed). */
function audioChunk(bytes: number, seed = 1): string {
  const buffer = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) buffer[i] = (i * seed + seed) % 256;
  return buffer.toString('base64');
}

describe('audio assembly', () => {
  it('orders chunks by index, not by arrival order', () => {
    const summary = assembleAudioChunks([
      { chunkIndex: 2, dataBase64: audioChunk(30, 3) },
      { chunkIndex: 0, dataBase64: audioChunk(30, 1) },
      { chunkIndex: 1, dataBase64: audioChunk(30, 2) }
    ]);
    expect(summary.indexes).toEqual([0, 1, 2]);
    expect(summary.contiguous).toBe(true);
    expect(summary.missing).toEqual([]);
  });

  it('reports a hole in the upload instead of hiding it', () => {
    const summary = assembleAudioChunks([
      { chunkIndex: 0, dataBase64: audioChunk(30, 1) },
      { chunkIndex: 3, dataBase64: audioChunk(30, 4) }
    ]);
    // Missing indexes are inside the present range: chunks 1 and 2 never arrived.
    expect(summary.missing).toEqual([1, 2]);
    expect(summary.contiguous).toBe(false);
  });

  it('flags missing initial chunk 0 when recording begins late (header loss)', () => {
    const summary = assembleAudioChunks([
      { chunkIndex: 2, dataBase64: audioChunk(30, 3) },
      { chunkIndex: 3, dataBase64: audioChunk(30, 4) }
    ]);
    // Chunks 0 and 1 were lost before connection; without chunk 0 container header is missing
    expect(summary.missing).toEqual([0, 1]);
    expect(summary.contiguous).toBe(false);
  });


  it('concatenates decoded bytes, so padding inside a chunk cannot corrupt the stream', () => {
    // Two 1-byte chunks: each base64-encodes to 4 characters *with* its own
    // padding. Joining the base64 text would yield a corrupt stream; joining the
    // bytes must not.
    const a = audioChunk(1, 1);
    const b = audioChunk(1, 2);
    expect(a.endsWith('=')).toBe(true);

    const assembled = assembleAudio([
      { chunkIndex: 0, dataBase64: a },
      { chunkIndex: 1, dataBase64: b }
    ]);

    const expected = Buffer.concat([Buffer.from(a, 'base64'), Buffer.from(b, 'base64')]);
    expect(assembled.bytes).toBe(2);
    expect(assembled.base64).toBe(expected.toString('base64'));
  });

  it('treats an empty upload as empty rather than failing', () => {
    const assembled = assembleAudio([]);
    expect(assembled.empty).toBe(true);
    expect(assembled.bytes).toBe(0);
    expect(assembled.chunks).toBe(0);
  });

  it('counts base64 bytes without touching the payload', () => {
    expect(base64Bytes('')).toBe(0);
    expect(base64Bytes(undefined)).toBe(0);
    expect(base64Bytes(Buffer.from('hello').toString('base64'))).toBe(5);
    // Whitespace/newlines from a transport must not change the count.
    expect(base64Bytes(`${Buffer.from('hello').toString('base64')}\n`)).toBe(5);
    expect(estimateTranscriptionTokens(SECOND * 10)).toBe(320);
  });
});

describe('diarized output parsing', () => {
  it('keeps only the roles the clinical pipeline understands', () => {
    const result = parseDiarizedResponse({
      lines: [
        { speaker: 'Dentist', text: 'Percussion negative on 16.' },
        { speaker: 'Patient', text: 'It aches when I drink cold water.' }
      ]
    });
    expect(result.transcript).toEqual([
      { sender: 'Dentist', text: 'Percussion negative on 16.' },
      { sender: 'Patient', text: 'It aches when I drink cold water.' }
    ]);
    expect(result.speakerCounts).toEqual({ Dentist: 1, Patient: 1, Dialogue: 0 });
  });

  it('records an unreadable speaker as unattributed rather than guessing a clinical role', () => {
    const result = parseDiarizedResponse({
      lines: [{ speaker: 'Speaker 3', text: 'Sixteen has a distal cavity.' }]
    });
    expect(result.transcript[0].sender).toBe('Dialogue');
    expect(result.unlabelled).toBe(1);
  });

  it('maps clinician synonyms to the clinician role, and never the reverse', () => {
    expect(normalizeSpeaker('clinician')).toBe('Dentist');
    expect(normalizeSpeaker('Doctor')).toBe('Dentist');
    expect(normalizeSpeaker('pt')).toBe('Patient');
    expect(normalizeSpeaker('the patient')).toBe('Patient');
    // Someone else in the room is not the clinician. Attributing a dental
    // assistant's words to the dentist asserts an observation the dentist never
    // made, so they are recorded as unattributed instead.
    expect(normalizeSpeaker('dental assistant')).toBe('Dialogue');
    expect(normalizeSpeaker('receptionist')).toBe('Dialogue');
    // An unrecognised label must NOT default to a clinical role.
    expect(normalizeSpeaker('speaker 4')).toBe(null);
    expect(normalizeSpeaker('')).toBe(null);
    expect(normalizeSpeaker(null)).toBe(null);
  });

  it('drops noise, collapses repeated lines, and accepts a bare array or a JSON string', () => {
    const result = parseDiarizedResponse([
      { speaker: 'Dentist', text: 'Open wide.' },
      { speaker: 'Dentist', text: 'Open wide.' },
      { speaker: 'Patient', text: '...' },
      { speaker: 'Patient', text: '   ' }
    ]);
    expect(result.accepted).toBe(1);
    expect(result.collapsedRepeats).toBe(1);
    expect(result.rejected).toBe(2);

    const fromString = parseDiarizedResponse(
      JSON.stringify({ lines: [{ speaker: 'Patient', text: 'It hurts here.' }] })
    );
    expect(fromString.transcript).toHaveLength(1);
  });

  it('returns nothing at all for unparseable output, rather than inventing a transcript', () => {
    expect(parseDiarizedResponse('not json').transcript).toEqual([]);
    expect(parseDiarizedResponse(null).transcript).toEqual([]);
    expect(parseDiarizedResponse({ lines: 'nope' }).transcript).toEqual([]);
  });
});

describe('choosing the note transcript', () => {
  const live = [
    { sender: 'Dialogue' as const, text: 'I get a sharp pain on the lower left when I chew' },
    { sender: 'Dialogue' as const, text: 'Sixteen has a distal cavity and percussion is negative' }
  ];
  const diarized = [
    { sender: 'Patient' as const, text: 'I get a sharp pain on the lower left when I chew' },
    { sender: 'Dentist' as const, text: 'Sixteen has a distal cavity and percussion is negative' }
  ];

  it('prefers the recorded audio, because only it separates dentist from patient', () => {
    const choice = chooseNoteTranscript({ live, diarized });
    expect(choice.source).toBe('server-diarized');
    expect(choice.transcript).toEqual(diarized);
    expect(choice.needsReview).toBe(false);
    expect(choice.warnings).toEqual([]);
  });

  it('flags a diarized transcript that is much shorter than what was heard', () => {
    const choice = chooseNoteTranscript({
      live,
      diarized: [{ sender: 'Patient', text: 'It hurts' }]
    });
    expect(choice.source).toBe('server-diarized');
    expect(choice.needsReview).toBe(true);
    expect(choice.warnings.join(' ')).toMatch(/less text than the live transcript/i);
  });

  it('flags an incomplete upload', () => {
    const choice = chooseNoteTranscript({ live, diarized, audioIncomplete: true });
    expect(choice.needsReview).toBe(true);
    expect(choice.warnings.join(' ')).toMatch(/not uploaded in full/i);
  });

  it('falls back to the live transcript, labelled as not speaker-separated', () => {
    const choice = chooseNoteTranscript({ live });
    expect(choice.source).toBe('browser-live');
    expect(choice.needsReview).toBe(true);
    expect(choice.warnings.join(' ')).toMatch(/does not separate the dentist from the patient/i);
  });

  it('says so plainly when nothing was captured, instead of supplying a default', () => {
    const choice = chooseNoteTranscript({ live: [], diarized: [] });
    expect(choice.source).toBe('none');
    expect(choice.transcript).toEqual([]);
    expect(choice.needsReview).toBe(true);
    expect(describeTranscriptSource('none')).toBe('No transcript');
  });
});

describe('transcriber transports', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  function fakeClient(responseText: string) {
    return {
      models: {
        generateContent: vi.fn(async (_params: any) => ({ text: responseText }))
      },
      files: {
        upload: vi.fn(async () => ({ name: 'files/abc', uri: 'https://x/abc', state: 'ACTIVE' })),
        get: vi.fn(async () => ({ name: 'files/abc', uri: 'https://x/abc', state: 'ACTIVE' })),
        delete: vi.fn(async () => ({}))
      }
    };
  }

  it('refuses to run with no audio rather than paying for a call', async () => {
    const client = fakeClient('{"lines":[]}');
    const transcriber = createAudioTranscriber({
      logger,
      getClient: async () => ({ client, vertexai: false }),
      model: 'gemini-3.6-flash'
    });
    const outcome = await transcriber.transcribe({ audioBase64: '', mimeType: 'audio/webm', bytes: 0 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.code).toBe('NO_AUDIO');
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('sends small recordings inline and reports the speaker split', async () => {
    const client = fakeClient(
      JSON.stringify({
        lines: [
          { speaker: 'Dentist', text: 'Cold test on 16 is lingering.' },
          { speaker: 'Patient', text: 'It woke me up last night.' }
        ]
      })
    );
    const transcriber = createAudioTranscriber({
      logger,
      getClient: async () => ({ client, vertexai: false }),
      model: 'gemini-3.6-flash'
    });

    const bytes = 60 * SECOND; // one minute
    const outcome = await transcriber.transcribe({
      audioBase64: audioChunk(bytes),
      mimeType: 'audio/webm',
      bytes
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok !== true) return;
    expect(outcome.transport).toBe('inline');
    expect(outcome.transcript).toHaveLength(2);
    expect(outcome.stats.speakerCounts).toEqual({ Dentist: 1, Patient: 1, Dialogue: 0 });

    const call: any = client.models.generateContent.mock.calls[0][0];
    // Thinking is pinned: this is extraction, and the thinking tax was the pilot's
    // latency complaint.
    expect(call.config.thinkingConfig).toBeDefined();
    expect(call.contents[0].parts[0].inlineData).toBeDefined();
    // Structured output, so a chatty model cannot smuggle prose into a transcript.
    expect(call.config.responseMimeType).toBe('application/json');
  });

  it('uploads long recordings, then deletes them from the provider', async () => {
    const client = fakeClient('{"lines":[{"speaker":"Dentist","text":"Marginal ridge is sound."}]}');
    const transcriber = createAudioTranscriber({
      logger,
      getClient: async () => ({ client, vertexai: false }),
      model: 'gemini-3.6-flash'
    });

    const bytes = TRANSCRIPTION_LIMITS.maxInlineAudioBytes + 1024;
    const outcome = await transcriber.transcribe({
      audioBase64: audioChunk(bytes),
      mimeType: 'audio/webm',
      bytes
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok !== true) return;
    expect(outcome.transport).toBe('file');
    const call: any = client.models.generateContent.mock.calls[0][0];
    expect(call.contents[0].parts[0].fileData).toBeDefined();
    // Clinical audio must not be left sitting with the provider.
    expect(client.files.delete).toHaveBeenCalledWith({ name: 'files/abc' });
  });

  it('cleans up the upload even when the transcription itself fails', async () => {
    const client = fakeClient('{"lines":[]}');
    client.models.generateContent.mockRejectedValueOnce(new Error('provider exploded'));
    const transcriber = createAudioTranscriber({
      logger,
      getClient: async () => ({ client, vertexai: false }),
      model: 'gemini-3.6-flash'
    });

    const bytes = TRANSCRIPTION_LIMITS.maxInlineAudioBytes + 1024;
    const outcome = await transcriber.transcribe({
      audioBase64: audioChunk(bytes),
      mimeType: 'audio/webm',
      bytes
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.code).toBe('TRANSCRIBE_FAILED');
    expect(client.files.delete).toHaveBeenCalled();
  });

  it('refuses to truncate a long recording on Vertex, where the upload API does not exist', async () => {
    const client = fakeClient('{"lines":[]}');
    const transcriber = createAudioTranscriber({
      logger,
      getClient: async () => ({ client, vertexai: true }),
      model: 'gemini-3.6-flash'
    });

    const bytes = TRANSCRIPTION_LIMITS.maxInlineAudioBytes + 1024;
    const outcome = await transcriber.transcribe({
      audioBase64: audioChunk(bytes),
      mimeType: 'audio/webm',
      bytes
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.code).toBe('AUDIO_TOO_LARGE_INLINE');
    // Refusing is the point: silently transcribing the first ten minutes of a
    // forty-minute appointment would produce a confident, incomplete record.
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('reports a missing provider as "not configured" rather than an AI failure', async () => {
    const transcriber = createAudioTranscriber({
      logger,
      getClient: async () => null,
      model: 'gemini-3.6-flash'
    });
    const outcome = await transcriber.transcribe({
      audioBase64: audioChunk(60 * SECOND),
      mimeType: 'audio/webm',
      bytes: 60 * SECOND
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.code).toBe('NOT_CONFIGURED');
  });
});

describe('/api/transcribe routes', () => {
  const dentistId = 'dentist-1';

  function buildApp(options: {
    session?: Partial<ChairSession> | null;
    chunks?: Array<{ chunkIndex: number; dataBase64: string }>;
    consultation?: any;
    transcriberOutcome?: any;
    model?: string;
    /** Optional quota deps, so the pre-flight meter can be driven directly. */
    metering?: Record<string, any>;
  } = {}) {
    const chunkList = options.chunks ?? [];
    const store = {
      get: vi.fn(async (chairId: string) =>
        options.session === null
          ? null
          : ({
              chairId,
              pinCode: '1234',
              roomName: 'Chair 1',
              dentistId,
              clinicId: 'clinic-1',
              createdAt: Date.now(),
              expiresAt: Date.now() + 1000,
              token: 't',
              status: 'completed',
              commands: [],
              telemetry: { chairId, status: 'completed', bufferedChunksCount: 0, recordingSeconds: 0, lastHeartbeat: Date.now() },
              ...(options.session || {})
            } as ChairSession)
      ),
      listAudioChunks: vi.fn(async () => chunkList),
      appendAudioChunk: vi.fn(async () => ({ ok: true, chunkCount: chunkList.length + 1, totalBytes: 100 })),
      deleteAudio: vi.fn(async () => {}),
      countAudioChunks: vi.fn(async () => chunkList.length),
      create: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      pushCommand: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      purgeExpired: vi.fn(async () => 0)
    } as any;

    const audit = vi.fn();
    const updated: any[] = [];

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use((req: any, _res: any, next: any) => {
      req.dentist = { id: dentistId, name: 'Dr Test' };
      next();
    });

    registerTranscriptionRoutes(app, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      authenticate: (req: any, _res: any, next: any) => next(),
      getClient: async () => ({
        client: {
          models: {
            generateContent: vi.fn(async (_params: any) =>
              options.transcriberOutcome === undefined
                ? {
                    text: JSON.stringify({
                      lines: [
                        { speaker: 'Dentist', text: 'Probing depths are all within normal limits.' },
                        { speaker: 'Patient', text: 'My gums bleed when I brush.' }
                      ]
                    })
                  }
                : options.transcriberOutcome
            )
          },
          files: { upload: vi.fn(), get: vi.fn(), delete: vi.fn() }
        },
        vertexai: false
      }),
      model: options.model ?? 'gemini-3.6-flash',
      chairStore: store,
      resolveClinicScope: async () => 'clinic-1',
      recordUsageEvent: vi.fn(async () => {}),
      ...(options.metering || {}),
      loadConsultation: async (id: string) =>
        options.consultation === null ? null : { id, dentistId, transcript: [], ...(options.consultation || {}) },
      updateConsultation: async (_id: string, _d: string, next: any) => {
        updated.push(next);
        return true;
      },
      logAudit: audit
    });

    return { app, store, audit, updated };
  }

  it('transcribes the stored recording and returns diarized speech', async () => {
    const { app, store } = buildApp({
      chunks: [
        { chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }
      ]
    });

    const res = await request(app)
      .post('/api/transcribe')
      .send({ chairId: 'chair-abc123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('server-diarized');
    expect(res.body.speakerCounts).toEqual({ Dentist: 1, Patient: 1, Dialogue: 0 });
    expect(store.listAudioChunks).toHaveBeenCalledWith('chair-abc123');
    // Not persisted without a consultation id, so nothing may be deleted either:
    // the transcript would have nowhere to be recovered from.
    expect(store.deleteAudio).not.toHaveBeenCalled();
  });

  it('persists the transcript, records its provenance, and then deletes the audio', async () => {
    const { app, store, updated } = buildApp({
      chunks: [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }],
      consultation: { id: 'consult-1' }
    });

    const res = await request(app)
      .post('/api/transcribe')
      .send({ chairId: 'chair-abc123', consultationId: 'consult-1' });

    expect(res.status).toBe(200);
    expect(res.body.persisted).toBe(true);
    expect(updated).toHaveLength(1);
    expect(updated[0].transcript).toHaveLength(2);
    expect(updated[0].transcriptProvenance.source).toBe('server-diarized');
    expect(updated[0].transcriptProvenance.speakerCounts).toEqual({ Dentist: 1, Patient: 1, Dialogue: 0 });
    // Data minimisation: raw voice is destroyed once the transcript is on the record.
    expect(store.deleteAudio).toHaveBeenCalledWith('chair-abc123');
  });

  it('does not pay twice for the same consultation unless forced', async () => {
    const { app } = buildApp({
      chunks: [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }],
      consultation: {
        id: 'consult-1',
        transcript: [{ sender: 'Patient', text: 'Already transcribed.' }],
        transcriptProvenance: { source: 'server-diarized', modelId: 'gemini-3.6-flash', warnings: [] }
      }
    });

    const res = await request(app)
      .post('/api/transcribe')
      .send({ chairId: 'chair-abc123', consultationId: 'consult-1' });

    expect(res.status).toBe(200);
    expect(res.body.reused).toBe(true);
    expect(res.body.transcript).toEqual([{ sender: 'Patient', text: 'Already transcribed.' }]);
  });

  it('refuses to transcribe another clinician\'s chair', async () => {
    const { app, store } = buildApp({
      session: { dentistId: 'someone-else', clinicId: 'other-clinic' },
      chunks: [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }]
    });

    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });

    expect(res.status).toBe(403);
    expect(store.listAudioChunks).not.toHaveBeenCalled();
  });

  it('answers with a code the client can act on when there is no usable audio', async () => {
    const { app } = buildApp({ chunks: [] });
    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_AUDIO');
  });

  it('reports an unconfigured provider as 503 so the client falls back to live speech', async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.dentist = { id: dentistId };
      next();
    });
    registerTranscriptionRoutes(app, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      authenticate: (_req: any, _res: any, next: any) => next(),
      getClient: async () => null,
      model: 'gemini-3.6-flash',
      chairStore: {
        get: async () => ({ dentistId, telemetry: {} }) as any,
        listAudioChunks: async () => [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }]
      } as any,
      resolveClinicScope: async () => 'clinic-1',
      recordUsageEvent: async () => {},
      loadConsultation: async () => null,
      logAudit: () => {}
    });

    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NOT_CONFIGURED');
  });

  it('accepts a clinician\'s own recording only for a consultation they own', async () => {
    const { app, store } = buildApp({ consultation: { id: 'consult-1' } });

    const saved = await request(app)
      .post('/api/transcribe/audio')
      .send({ consultationId: 'consult-1', chunkIndex: 0, dataBase64: audioChunk(10 * SECOND) });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe(true);
    // Keyed by consultation, so the ownership check is the record lookup itself.
    expect(store.appendAudioChunk).toHaveBeenCalledWith(
      expect.objectContaining({ chairId: consultationAudioKey('consult-1') })
    );

    const stranger = buildApp({ consultation: null });
    const denied = await request(stranger.app)
      .post('/api/transcribe/audio')
      .send({ consultationId: 'someone-elses', chunkIndex: 0, dataBase64: audioChunk(10 * SECOND) });
    expect(denied.status).toBe(404);
    expect(stranger.store.appendAudioChunk).not.toHaveBeenCalled();
  });

  it('transcribes a consultation-keyed recording when no chair is involved', async () => {
    const { app, store } = buildApp({
      consultation: { id: 'consult-1' },
      chunks: [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }]
    });

    const res = await request(app)
      .post('/api/transcribe')
      .send({ consultationId: 'consult-1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(store.listAudioChunks).toHaveBeenCalledWith(consultationAudioKey('consult-1'));
  });

  it('refuses transcription and avoids calling AI model when clinic is at quota limit (pre-flight metering check)', async () => {
    const getClient = vi.fn();
    const app = express();
    app.use(express.json());

    registerTranscriptionRoutes(app, {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticate: (_req: any, _res: any, next: any) => {
        _req.dentist = { id: 'dentist-capped-1' };
        next();
      },
      model: 'gemini-3.6-flash',
      getClient,
      chairStore: {
        get: async () => ({ dentistId: 'dentist-capped-1', clinicId: 'clinic-capped', telemetry: {} }) as any,
        listAudioChunks: async () => [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }],
      } as any,
      resolveClinicScope: async () => 'clinic-capped',
      resolveDailyLimits: async () => ({ notes: 15, tokens: 150_000 }),
      getUsageCountToday: async () => 15, // ALREADY AT LIMIT
      getTokensUsedToday: async () => 50_000,
      recordUsageEvent: async () => {},
      loadConsultation: async () => null,
      logAudit: vi.fn(),
    });

    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });
    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('QUOTA_DAILY');
    expect(res.body.error).toContain('daily allowance');
    expect(getClient).not.toHaveBeenCalled();
  });

  it('meters transcription against transcriptions only, so note generation cannot consume the capture allowance', async () => {
    // 15 notes generated today and no transcriptions: at the note ceiling, with
    // the transcription allowance untouched. Counting every usage event (the
    // previous behaviour) returned 429 here — "used all 15 AI notes" after about
    // seven appointments, because a transcript and its note were two events.
    const getUsageCountToday = vi.fn(async (_scopeId: string, kinds?: readonly string[]) =>
      kinds && kinds.includes('ai_transcription') ? 0 : 15
    );

    const { app } = buildApp({
      chunks: [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }],
      metering: {
        resolveDailyLimits: async () => ({ notes: 15, tokens: 150_000, transcriptions: 15 }),
        getUsageCountToday,
        getTokensUsedToday: async () => 10_000
      }
    });

    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });

    expect(getUsageCountToday).toHaveBeenCalledWith('clinic-1', ['ai_transcription']);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('refuses transcription when the clinic has spent its daily token budget', async () => {
    const getClient = vi.fn();
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.dentist = { id: dentistId };
      next();
    });
    registerTranscriptionRoutes(app, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      authenticate: (_req: any, _res: any, next: any) => next(),
      getClient,
      model: 'gemini-3.6-flash',
      chairStore: {
        get: async () => ({ dentistId, clinicId: 'clinic-1', telemetry: {} }) as any,
        listAudioChunks: async () => [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }]
      } as any,
      resolveClinicScope: async () => 'clinic-1',
      resolveDailyLimits: async () => ({ notes: 200, tokens: 2_000_000, transcriptions: 200 }),
      getUsageCountToday: async () => 0,
      getTokensUsedToday: async () => 2_000_000,
      recordUsageEvent: async () => {},
      loadConsultation: async () => null,
      logAudit: vi.fn()
    });

    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('QUOTA_TOKENS');
    expect(getClient).not.toHaveBeenCalled();
  });

  it('fails closed: refuses transcription with 503 when the usage meter cannot be read', async () => {
    // The opposite choice spends money on the clinic's behalf with no way to
    // count it, and the note-generation meter already refuses in this situation.
    const getClient = vi.fn();
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.dentist = { id: dentistId };
      next();
    });
    registerTranscriptionRoutes(app, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      authenticate: (_req: any, _res: any, next: any) => next(),
      getClient,
      model: 'gemini-3.6-flash',
      chairStore: {
        get: async () => ({ dentistId, clinicId: 'clinic-1', telemetry: {} }) as any,
        listAudioChunks: async () => [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }]
      } as any,
      resolveClinicScope: async () => 'clinic-1',
      resolveDailyLimits: async () => {
        throw new Error('usage store unavailable');
      },
      getUsageCountToday: async () => 0,
      getTokensUsedToday: async () => 0,
      recordUsageEvent: async () => {},
      loadConsultation: async () => null,
      logAudit: vi.fn()
    });

    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('METERING_UNAVAILABLE');
    expect(getClient).not.toHaveBeenCalled();
  });

  it('fails closed when the clinic scope cannot be resolved', async () => {
    const getClient = vi.fn();
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.dentist = { id: dentistId };
      next();
    });
    registerTranscriptionRoutes(app, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      authenticate: (_req: any, _res: any, next: any) => next(),
      getClient,
      model: 'gemini-3.6-flash',
      chairStore: {
        get: async () => ({ dentistId, clinicId: 'clinic-1', telemetry: {} }) as any,
        listAudioChunks: async () => [{ chunkIndex: 0, dataBase64: audioChunk(40 * SECOND) }]
      } as any,
      resolveClinicScope: async () => {
        throw new Error('membership store unavailable');
      },
      recordUsageEvent: async () => {},
      loadConsultation: async () => null,
      logAudit: vi.fn()
    });

    const res = await request(app).post('/api/transcribe').send({ chairId: 'chair-abc123' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('METERING_UNAVAILABLE');
    expect(getClient).not.toHaveBeenCalled();
  });
});
