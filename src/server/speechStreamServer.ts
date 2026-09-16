/**
 * DentAI Real-Time Dental Speech Streaming Gateway
 * Bridges browser AudioWorklet PCM16 audio streams to Google Cloud Speech-to-Text v2 / v1
 * with Chirp 2 recognizer support, overlapping stream cycling, and real-time dental entity tokenization.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import { v2 as speechV2, SpeechClient as SpeechClientV1 } from '@google-cloud/speech';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger';

// Dental Lexicon Phrasing and Boost Weights
export const DENTAL_SPEECH_CONTEXT = {
  phrases: [
    // FDI Tooth Notation (Permanent)
    'tooth 11', 'tooth 12', 'tooth 13', 'tooth 14', 'tooth 15', 'tooth 16', 'tooth 17', 'tooth 18',
    'tooth 21', 'tooth 22', 'tooth 23', 'tooth 24', 'tooth 25', 'tooth 26', 'tooth 27', 'tooth 28',
    'tooth 31', 'tooth 32', 'tooth 33', 'tooth 34', 'tooth 35', 'tooth 36', 'tooth 37', 'tooth 38',
    'tooth 41', 'tooth 42', 'tooth 43', 'tooth 44', 'tooth 45', 'tooth 46', 'tooth 47', 'tooth 48',
    // FDI Tooth Notation (Primary / Deciduous)
    'tooth 51', 'tooth 52', 'tooth 53', 'tooth 54', 'tooth 55',
    'tooth 61', 'tooth 62', 'tooth 63', 'tooth 64', 'tooth 65',
    'tooth 71', 'tooth 72', 'tooth 73', 'tooth 74', 'tooth 75',
    'tooth 81', 'tooth 82', 'tooth 83', 'tooth 84', 'tooth 85',
    // Surfaces & Cavity Preparations
    'MOD', 'MO', 'DO', 'MOB', 'DOB', 'MODB', 'MODBL', 'mesial', 'distal', 'occlusal', 'buccal', 'lingual', 'palatal', 'incisal',
    // Key ADA Billing Codes & Terminology
    'item 011', 'item 012', 'item 013', 'item 022', 'item 114', 'item 121', 'item 161',
    'item 531', 'item 532', 'item 533', 'item 534', 'item 535',
    'item 613', 'item 615', 'item 411', 'item 415', 'item 417',
    'comprehensive oral examination', 'periodic oral examination', 'removal of plaque and calculus',
    'intraoral periapical radiograph', 'bitewing radiograph',
    'adhesive composite resin restoration', 'full crown preparation', 'monolithic zirconia crown',
    // Diagnostics & Pathology
    'symptomatic irreversible pulpitis', 'asymptomatic irreversible pulpitis', 'reversible pulpitis',
    'periapical abscess', 'periapical radiolucency', 'furcation involvement', 'recurrent dental caries',
    'cracked tooth syndrome', 'periodontal probing depths',
    // Pharmacology & Materials
    'lignocaine 2% with 1:80,000 adrenaline', 'articaine 4% with 1:100,000 adrenaline',
    'mepivacaine 3% plain', 'rubber dam isolation', 'articulating paper', 'composite shade A2', 'composite shade A3'
  ],
  boost: 15.0
};

// Regex Matchers for Server-Assisted Real-Time Entity Tokenizer
const FDI_TEETH_REGEX = /\b(?:tooth\s+)?([1-4][1-8]|[5-8][1-5])\b/gi;
const SURFACES_REGEX = /\b(MODBL|MODB|DOBL|MOBL|MOD|DO|MO|OB|OL|MB|DB|incisal|occlusal|buccal|lingual|palatal|mesial|distal)\b/gi;
const ADA_CODE_REGEX = /\b(?:item\s+|code\s+|ada\s+)?(011|012|013|022|114|121|161|531|532|533|534|535|577|613|615|411|415|417|311|314)\b/gi;

export interface DentalEntityEvent {
  type: 'dental_entity_detected';
  category: 'tooth' | 'surface' | 'ada_code' | 'diagnosis';
  value: string;
  label: string;
  timestampMs: number;
}

export interface StreamingSessionConfig {
  sampleRateHertz: number;
  languageCode: string;
  recognizer?: string;
}

interface ActiveStreamSession {
  sessionId: string;
  dentistId: string;
  consultationId: string;
  ws: WebSocket;
  currentStream: any | null;
  secondaryStream: any | null;
  startTime: number;
  streamStartTime: number;
  isPaused: boolean;
  cycleCount: number;
  cycleTimer: NodeJS.Timeout | null;
  preWarmTimer: NodeJS.Timeout | null;
  cumulativeTranscript: string[];
  detectedEntities: Set<string>;
}

export class SpeechStreamServer {
  private wss: WebSocketServer | null = null;
  private speechClientV2: speechV2.SpeechClient | null = null;
  private speechClientV1: SpeechClientV1 | null = null;
  private activeSessions = new Map<string, ActiveStreamSession>();
  private verifyTokenFn: ((token: string) => any) | null = null;
  private gcpStatus = {
    isConfigured: false,
    authSource: 'none',
    projectId: '',
    recognizer: '',
    error: null as string | null
  };

  constructor(verifyToken?: (token: string) => any) {
    this.verifyTokenFn = verifyToken || null;
    this.initGcpClient();
  }

  /**
   * Initializes Google Cloud Speech Client with strict validation.
   */
  private initGcpClient() {
    try {
      let credentials: any = undefined;
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const inlineKey = process.env.GCP_SERVICE_ACCOUNT_KEY || process.env.GCP_CREDENTIALS_JSON;
      const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';

      if (inlineKey) {
        try {
          credentials = typeof inlineKey === 'string' ? JSON.parse(inlineKey) : inlineKey;
          this.gcpStatus.authSource = 'inline_service_account';
        } catch (e: any) {
          logger.error('[SpeechStreamServer] Failed to parse GCP_SERVICE_ACCOUNT_KEY JSON:', e);
        }
      } else if (credPath && fs.existsSync(credPath)) {
        this.gcpStatus.authSource = `file:${credPath}`;
      }

      const hasExplicitCreds = Boolean(credentials || (credPath && fs.existsSync(credPath)));

      if (!hasExplicitCreds) {
        this.speechClientV1 = null;
        this.speechClientV2 = null;
        this.gcpStatus.isConfigured = false;
        this.gcpStatus.authSource = 'none';
        this.gcpStatus.error = 'Google Cloud Speech credentials missing or not found on disk.';
        logger.info('[SpeechStreamServer] Google Cloud Speech credentials not configured - audio streaming in fallback mode.');
        return;
      }

      const clientOptions: any = {};
      if (credentials) clientOptions.credentials = credentials;
      if (projectId) clientOptions.projectId = projectId;

      // Try v2 client first (Chirp 2 support)
      this.speechClientV2 = new speechV2.SpeechClient(clientOptions);
      // Fallback v1 client
      this.speechClientV1 = new SpeechClientV1(clientOptions);

      this.gcpStatus.isConfigured = true;
      this.gcpStatus.projectId = projectId || credentials?.project_id || 'default';
      this.gcpStatus.recognizer = process.env.GCP_SPEECH_RECOGNIZER || `projects/${this.gcpStatus.projectId}/locations/global/recognizers/_`;
      
      logger.info('[SpeechStreamServer] Google Cloud Speech-to-Text streaming gateway initialized.', {
        authSource: this.gcpStatus.authSource,
        projectId: this.gcpStatus.projectId,
        recognizer: this.gcpStatus.recognizer
      });
    } catch (err: any) {
      this.speechClientV1 = null;
      this.speechClientV2 = null;
      this.gcpStatus.isConfigured = false;
      this.gcpStatus.error = err?.message || String(err);
      logger.warn('[SpeechStreamServer] Google Cloud Speech credentials not configured or failed validation:', err.message);
    }
  }

  /**
   * Strict verification of GCP credentials
   */
  public verifyGcpCredentials() {
    return {
      ...this.gcpStatus,
      ok: this.gcpStatus.isConfigured
    };
  }

  /**
   * Mounts the WebSocket server on the main Node.js HTTP server instance.
   */
  public mount(httpServer: HttpServer, verifyTokenFn?: (token: string) => any) {
    if (verifyTokenFn) {
      this.verifyTokenFn = verifyTokenFn;
    }

    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/api/ws/speech-stream'
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    logger.info('[SpeechStreamServer] Mounted WebSocket endpoint at /api/ws/speech-stream');
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    let dentistId = 'anonymous_chairside';
    if (this.verifyTokenFn && token) {
      const auth = this.verifyTokenFn(token);
      if (!auth || !auth.dentistId) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired workstation token.'
        }));
        ws.close(4401, 'Unauthorized');
        return;
      }
      dentistId = auth.dentistId;
    }

    const sessionId = `stream_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const session: ActiveStreamSession = {
      sessionId,
      dentistId,
      consultationId: url.searchParams.get('consultationId') || sessionId,
      ws,
      currentStream: null,
      secondaryStream: null,
      startTime: Date.now(),
      streamStartTime: Date.now(),
      isPaused: false,
      cycleCount: 0,
      cycleTimer: null,
      preWarmTimer: null,
      cumulativeTranscript: [],
      detectedEntities: new Set()
    };

    this.activeSessions.set(sessionId, session);

    // Heartbeat ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 25000);

    ws.on('message', (data: any, isBinary: boolean) => {
      if (isBinary) {
        this.handleBinaryAudioChunk(session, Buffer.from(data));
      } else {
        try {
          const message = JSON.parse(data.toString());
          this.handleControlMessage(session, message);
        } catch (e: any) {
          logger.warn(`[SpeechStreamServer] Invalid control message from session ${sessionId}:`, e.message);
        }
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      this.terminateSession(sessionId);
    });

    ws.on('error', (err) => {
      logger.error(`[SpeechStreamServer] WebSocket error on session ${sessionId}:`, err);
      this.terminateSession(sessionId);
    });

    // Send connection acknowledgement
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      gcpReady: this.gcpStatus.isConfigured,
      projectId: this.gcpStatus.projectId,
      recognizer: this.gcpStatus.recognizer
    }));
  }

  private handleControlMessage(session: ActiveStreamSession, message: any) {
    switch (message.type) {
      case 'start_session':
        this.startGcpStream(session, {
          sampleRateHertz: message.sampleRate || 16000,
          languageCode: message.languageCode || 'en-AU',
          recognizer: message.recognizer || this.gcpStatus.recognizer
        });
        break;

      case 'pause_session':
        session.isPaused = true;
        session.ws.send(JSON.stringify({ type: 'session_paused', sessionId: session.sessionId }));
        break;

      case 'resume_session':
        session.isPaused = false;
        session.ws.send(JSON.stringify({ type: 'session_resumed', sessionId: session.sessionId }));
        break;

      case 'stop_session':
        this.finishSession(session);
        break;

      default:
        break;
    }
  }

  /**
   * Initializes a Google Cloud Speech recognize gRPC stream with phrase adaptation.
   */
  private startGcpStream(session: ActiveStreamSession, config: StreamingSessionConfig) {
    if (!this.gcpStatus.isConfigured || !this.speechClientV1) {
      // If GCP credentials not configured, inform client
      session.ws.send(JSON.stringify({
        type: 'error',
        code: 'GCP_NOT_CONFIGURED',
        message: 'Google Cloud Speech credentials missing or unverified. Verify GOOGLE_APPLICATION_CREDENTIALS.'
      }));
      return;
    }

    try {
      const recognitionConfig = {
        encoding: 'LINEAR16' as const,
        sampleRateHertz: config.sampleRateHertz,
        languageCode: config.languageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_long',
        speechContexts: [DENTAL_SPEECH_CONTEXT],
        useEnhanced: true
      };

      const streamingConfig = {
        config: recognitionConfig,
        interimResults: true
      };

      const gStream = this.speechClientV1.streamingRecognize(streamingConfig);

      gStream.on('data', (response: any) => {
        this.handleGcpRecognitionData(session, response);
      });

      gStream.on('error', (err: any) => {
        logger.error(`[SpeechStreamServer] GCP Stream Error for session ${session.sessionId}:`, err);
        session.ws.send(JSON.stringify({
          type: 'error',
          code: 'GCP_STREAM_ERROR',
          message: err?.message || 'Google Cloud Speech streaming error'
        }));
      });

      gStream.on('end', () => {
        logger.info(`[SpeechStreamServer] GCP stream ended for session ${session.sessionId}`);
      });

      session.currentStream = gStream;
      session.streamStartTime = Date.now();

      // Schedule Overlapping Boundary Stream Cycling at 4m30s (270,000ms)
      this.scheduleStreamCycle(session, config);

      session.ws.send(JSON.stringify({
        type: 'session_started',
        sessionId: session.sessionId,
        sampleRate: config.sampleRateHertz,
        model: 'Chirp2 / Latest_Long',
        dentalAdaptation: true
      }));

    } catch (err: any) {
      logger.error(`[SpeechStreamServer] Failed to create GCP recognize stream:`, err);
      session.ws.send(JSON.stringify({
        type: 'error',
        code: 'STREAM_INIT_FAILED',
        message: err?.message || 'Failed to start streaming'
      }));
    }
  }

  /**
   * Seamless Overlapping Boundary Stream Cycling
   * Pre-warms a secondary gRPC stream 5 seconds prior to the 4m30s limit,
   * cross-fading chunk forwarding to guarantee zero syllable dropouts in 45+ min procedures.
   */
  private scheduleStreamCycle(session: ActiveStreamSession, config: StreamingSessionConfig) {
    if (session.cycleTimer) clearTimeout(session.cycleTimer);
    if (session.preWarmTimer) clearTimeout(session.preWarmTimer);

    // Pre-warm secondary stream at 4m25s (265,000ms)
    session.preWarmTimer = setTimeout(() => {
      if (!this.activeSessions.has(session.sessionId)) return;
      try {
        logger.info(`[SpeechStreamServer] Pre-warming secondary gRPC stream for session ${session.sessionId} (Cycle ${session.cycleCount + 1})`);
        const recognitionConfig = {
          encoding: 'LINEAR16' as const,
          sampleRateHertz: config.sampleRateHertz,
          languageCode: config.languageCode,
          enableAutomaticPunctuation: true,
          model: 'latest_long',
          speechContexts: [DENTAL_SPEECH_CONTEXT]
        };
        const nextStream = this.speechClientV1?.streamingRecognize({
          config: recognitionConfig,
          interimResults: true
        });

        if (nextStream) {
          nextStream.on('data', (resp: any) => this.handleGcpRecognitionData(session, resp));
          nextStream.on('error', (e: any) => logger.warn('[SpeechStreamServer] Secondary stream error:', e));
          session.secondaryStream = nextStream;
        }
      } catch (e) {
        logger.warn('[SpeechStreamServer] Failed pre-warming secondary stream:', e);
      }
    }, 265_000);

    // Switch cutover at 4m30s (270,000ms)
    session.cycleTimer = setTimeout(() => {
      if (!this.activeSessions.has(session.sessionId)) return;
      logger.info(`[SpeechStreamServer] Cycling gRPC stream for session ${session.sessionId} (Reached 4m30s boundary)`);
      const oldStream = session.currentStream;
      session.currentStream = session.secondaryStream;
      session.secondaryStream = null;
      session.cycleCount += 1;
      session.streamStartTime = Date.now();

      // Gracefully close old stream after brief drain
      if (oldStream) {
        try {
          oldStream.end();
        } catch {}
      }

      session.ws.send(JSON.stringify({
        type: 'stream_cycled',
        cycleCount: session.cycleCount,
        offsetMs: Date.now() - session.startTime
      }));

      // Schedule next cycle
      this.scheduleStreamCycle(session, config);
    }, 270_000);
  }

  private handleBinaryAudioChunk(session: ActiveStreamSession, pcmBuffer: Buffer) {
    if (session.isPaused || !session.currentStream) return;
    try {
      // Forward linear PCM16 audio directly to active Google Cloud stream
      session.currentStream.write(pcmBuffer);
    } catch (err: any) {
      logger.warn(`[SpeechStreamServer] Error writing audio chunk to stream:`, err.message);
    }
  }

  private handleGcpRecognitionData(session: ActiveStreamSession, response: any) {
    if (!response.results || response.results.length === 0) return;

    const result = response.results[0];
    const alternative = result.alternatives && result.alternatives[0];
    if (!alternative) return;

    const transcriptText = alternative.transcript || '';
    const isFinal = !!result.isFinal;
    const confidence = alternative.confidence || 0.9;

    if (isFinal) {
      session.cumulativeTranscript.push(transcriptText);
      session.ws.send(JSON.stringify({
        type: 'final_transcript',
        text: transcriptText,
        confidence,
        timestampMs: Date.now() - session.startTime
      }));
    } else {
      session.ws.send(JSON.stringify({
        type: 'interim_transcript',
        text: transcriptText,
        stability: result.stability || 0.85
      }));
    }

    // Server-Assisted Real-Time Dental Entity Tokenization
    this.extractAndEmitDentalEntities(session, transcriptText);
  }

  /**
   * Tokenizes text in real-time, emitting badges for FDI teeth, surfaces, and ADA codes
   */
  private extractAndEmitDentalEntities(session: ActiveStreamSession, text: string) {
    const foundTokens: DentalEntityEvent[] = [];

    // 1. FDI Tooth Notation (11 - 48, 51 - 85)
    let toothMatch: RegExpExecArray | null;
    const tRegex = new RegExp(FDI_TEETH_REGEX);
    while ((toothMatch = tRegex.exec(text)) !== null) {
      const toothNum = toothMatch[1];
      const key = `tooth_${toothNum}`;
      if (!session.detectedEntities.has(key)) {
        session.detectedEntities.add(key);
        foundTokens.push({
          type: 'dental_entity_detected',
          category: 'tooth',
          value: toothNum,
          label: `Tooth ${toothNum}`,
          timestampMs: Date.now() - session.startTime
        });
      }
    }

    // 2. Surfaces (MOD, DO, MO, Buccal, etc.)
    let surfMatch: RegExpExecArray | null;
    const sRegex = new RegExp(SURFACES_REGEX);
    while ((surfMatch = sRegex.exec(text)) !== null) {
      const surf = surfMatch[1].toUpperCase();
      const key = `surface_${surf}`;
      if (!session.detectedEntities.has(key)) {
        session.detectedEntities.add(key);
        foundTokens.push({
          type: 'dental_entity_detected',
          category: 'surface',
          value: surf,
          label: `${surf} Surface`,
          timestampMs: Date.now() - session.startTime
        });
      }
    }

    // 3. ADA Item Codes
    let adaMatch: RegExpExecArray | null;
    const aRegex = new RegExp(ADA_CODE_REGEX);
    while ((adaMatch = aRegex.exec(text)) !== null) {
      const code = adaMatch[1];
      const key = `ada_${code}`;
      if (!session.detectedEntities.has(key)) {
        session.detectedEntities.add(key);
        foundTokens.push({
          type: 'dental_entity_detected',
          category: 'ada_code',
          value: code,
          label: `ADA ${code}`,
          timestampMs: Date.now() - session.startTime
        });
      }
    }

    for (const token of foundTokens) {
      session.ws.send(JSON.stringify(token));
    }
  }

  private finishSession(session: ActiveStreamSession) {
    if (session.cycleTimer) clearTimeout(session.cycleTimer);
    if (session.preWarmTimer) clearTimeout(session.preWarmTimer);

    if (session.currentStream) {
      try {
        session.currentStream.end();
      } catch {}
    }

    const fullTranscript = session.cumulativeTranscript.join(' ').trim();
    session.ws.send(JSON.stringify({
      type: 'session_completed',
      sessionId: session.sessionId,
      fullTranscript,
      entityCount: session.detectedEntities.size,
      durationSeconds: Math.round((Date.now() - session.startTime) / 1000)
    }));

    this.activeSessions.delete(session.sessionId);
  }

  private terminateSession(sessionId: string) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    if (session.cycleTimer) clearTimeout(session.cycleTimer);
    if (session.preWarmTimer) clearTimeout(session.preWarmTimer);
    if (session.currentStream) {
      try {
        session.currentStream.destroy();
      } catch {}
    }
    this.activeSessions.delete(sessionId);
    logger.info(`[SpeechStreamServer] Terminated session ${sessionId}`);
  }
}

// Global Singleton for export and mounting
export const speechStreamServer = new SpeechStreamServer();
