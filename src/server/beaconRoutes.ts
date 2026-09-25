import crypto from 'crypto';
import express from 'express';
import type { ChairSessionStore, ChairSession } from './chairSessionStore';
import { evaluateChunkIngestion } from '../lib/standbyPolicy';

export interface BeaconRouteDeps {
  chairSessionStore: ChairSessionStore;
  logger: {
    info: (message: string, context?: any) => void;
    warn: (message: string, context?: any) => void;
    error: (message: string, error?: any, context?: any) => void;
  };
  sessionSecret: string;
  signaturesMatch: (a: string, b: string) => boolean;
}

export function generateChairToken(
  payload: { chairId: string; pinCode: string; roomName: string; clinicId?: string; exp?: number },
  sessionSecret: string
): string {
  const finalPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: payload.exp || Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12 hours
  };
  const payloadStr = JSON.stringify(finalPayload);
  const base64Payload = Buffer.from(payloadStr).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(base64Payload)
    .digest('base64url');
  return `${base64Payload}.${signature}`;
}

export function verifyChairToken(
  token: string,
  sessionSecret: string,
  signaturesMatch: (a: string, b: string) => boolean
): { chairId: string; pinCode: string; roomName: string; clinicId?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [base64Payload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', sessionSecret)
    .update(base64Payload)
    .digest('base64url');
  if (!signaturesMatch(signature, expectedSignature)) return null;
  try {
    const payloadStr = Buffer.from(base64Payload, 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadStr);
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function registerBeaconRoutes(app: express.Express, deps: BeaconRouteDeps): void {
  const { chairSessionStore, logger, sessionSecret, signaturesMatch } = deps;

  // 1. Create a chair pairing session (called by Desktop Operatory PC)
  app.post('/api/beacon/chair/create', async (req, res) => {
    try {
      const { roomName = 'Chair 1', clinicId, dentistId, dentistName } = req.body || {};
      const chairId = `chair-${crypto.randomBytes(3).toString('hex')}`;
      const pinCode = String(Math.floor(1000 + Math.random() * 9000));
      const token = generateChairToken({ chairId, pinCode, roomName, clinicId }, sessionSecret);
      const expiresAt = Date.now() + 12 * 3600 * 1000;

      const session: ChairSession = {
        chairId,
        pinCode,
        roomName,
        clinicId,
        dentistId,
        dentistName,
        createdAt: Date.now(),
        expiresAt,
        token,
        status: 'waiting',
        commands: [],
        telemetry: {
          chairId,
          status: 'idle',
          bufferedChunksCount: 0,
          recordingSeconds: 0,
          lastHeartbeat: Date.now()
        }
      };

      await chairSessionStore.create(session);

      try {
        const purged = await chairSessionStore.purgeExpired();
        if (purged > 0) logger.info(`[Beacon] Swept ${purged} expired chair session(s).`);
      } catch (purgeErr: any) {
        logger.warn('Could not sweep expired chair sessions:', purgeErr?.message || purgeErr);
      }

      res.status(201).json({
        chairId,
        pinCode,
        roomName,
        token,
        expiresAt,
        qrPayload: `#/beacon?chair=${chairId}&pin=${pinCode}`,
        qrUrl: `/#/beacon?chair=${chairId}&pin=${pinCode}&token=${token}`
      });
    } catch (err) {
      logger.error('Failed to create chair beacon session:', err);
      res.status(500).json({ error: 'Failed to create chair beacon session.' });
    }
  });

  // 2. Mobile Phone pairs with Chair using PIN
  app.post('/api/beacon/chair/pair', async (req, res) => {
    try {
      const { chairId, pinCode, deviceInfo, deviceModel, batteryLevel, isCharging } = req.body || {};
      if (!chairId || !pinCode) {
        return res.status(400).json({ error: 'Chair ID and PIN code are required.' });
      }

      const session = await chairSessionStore.get(chairId);
      if (!session || session.pinCode !== String(pinCode).trim()) {
        return res.status(401).json({ error: 'Invalid or expired PIN code.' });
      }

      const telemetry = { ...session.telemetry, lastHeartbeat: Date.now() };
      if (typeof batteryLevel === 'number') telemetry.batteryLevel = batteryLevel;
      if (typeof isCharging === 'boolean') telemetry.isCharging = isCharging;

      const pairPatch = {
        status: 'paired' as const,
        deviceInfo: deviceInfo || { model: deviceModel || 'Smartphone', platform: 'mobile' },
        telemetry
      };
      await chairSessionStore.update(chairId, pairPatch);

      res.json({
        success: true,
        paired: true,
        chairId,
        roomName: session.roomName,
        token: session.token,
        status: pairPatch.status
      });
    } catch (err) {
      logger.error('Failed to pair phone beacon:', err);
      res.status(500).json({ error: 'Failed to pair phone beacon.' });
    }
  });

  // 3. Status inspection & polling (used by both Desktop and Phone)
  app.get('/api/beacon/chair/:chairId/status', async (req, res) => {
    const { chairId } = req.params;
    const session = await chairSessionStore.get(chairId);
    if (!session) {
      return res.status(404).json({ error: 'Chair session not found or expired.' });
    }

    const phoneConnected = Date.now() - session.telemetry.lastHeartbeat < 15_000;

    res.json({
      chairId: session.chairId,
      status: session.status,
      roomName: session.roomName,
      pinCode: session.pinCode,
      phoneConnected: session.status !== 'waiting' && phoneConnected,
      isRecordingActive: session.status === 'active',
      deviceModel: session.deviceInfo?.model || 'Smartphone',
      deviceInfo: session.deviceInfo || null,
      latestCommand: session.commands[session.commands.length - 1] || null,
      pendingCommand: session.commands[session.commands.length - 1]?.action || null,
      telemetry: session.telemetry,
      batteryLevel: session.telemetry.batteryLevel,
      audioLevel: session.telemetry.audioLevel,
      dismissalDetected: session.telemetry.dismissalDetected,
      chunkCount: await chairSessionStore.countAudioChunks(chairId),
      expiresAt: session.expiresAt
    });
  });

  // 4. Desktop dispatches remote command to Phone Beacon
  app.post('/api/beacon/chair/:chairId/command', async (req, res) => {
    try {
      const { chairId } = req.params;
      const { action: reqAction, command: reqCommand, payload } = req.body || {};
      const action = reqAction || reqCommand;
      const session = await chairSessionStore.get(chairId);
      if (!session) {
        return res.status(404).json({ error: 'Chair session not found.' });
      }

      const validActions = [
        'start_recording',
        'stop_recording',
        'pause_recording',
        'resume_recording',
        'cancel',
        'dismissal_cue_detected',
        'inactivity_warning',
        'ping'
      ];

      if (!action || !validActions.includes(action)) {
        return res.status(400).json({ error: `Action must be one of: ${validActions.join(', ')}` });
      }

      const command = {
        id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        chairId,
        action,
        timestamp: Date.now(),
        payload
      };

      await chairSessionStore.pushCommand(chairId, command);

      res.json({ success: true, command });
    } catch (err) {
      logger.error('Failed to post beacon command:', err);
      res.status(500).json({ error: 'Failed to dispatch command.' });
    }
  });

  // 5. Phone Beacon posts heartbeat telemetry and audio levels
  app.post('/api/beacon/chair/:chairId/telemetry', async (req, res) => {
    try {
      const { chairId } = req.params;
      const session = await chairSessionStore.get(chairId);
      if (!session) {
        return res.status(404).json({ error: 'Chair session not found.' });
      }

      const {
        status,
        batteryLevel,
        isCharging,
        audioLevel,
        bufferedChunksCount,
        recordingSeconds,
        dismissalDetected,
        dismissalPhrase,
        dismissalTime,
        inactivitySeconds,
        audioMimeType
      } = req.body || {};

      const dismissal = dismissalDetected || (dismissalPhrase ? { phrase: dismissalPhrase, time: dismissalTime || Date.now() } : session.telemetry.dismissalDetected);

      const nextTelemetry = {
        ...session.telemetry,
        status: status || session.telemetry.status,
        batteryLevel: typeof batteryLevel === 'number' ? batteryLevel : session.telemetry.batteryLevel,
        isCharging: typeof isCharging === 'boolean' ? isCharging : session.telemetry.isCharging,
        audioLevel: typeof audioLevel === 'number' ? audioLevel : session.telemetry.audioLevel,
        bufferedChunksCount:
          typeof bufferedChunksCount === 'number' ? bufferedChunksCount : session.telemetry.bufferedChunksCount,
        recordingSeconds:
          typeof recordingSeconds === 'number' ? recordingSeconds : session.telemetry.recordingSeconds,
        dismissalDetected: dismissal,
        inactivitySeconds:
          typeof inactivitySeconds === 'number' ? inactivitySeconds : session.telemetry.inactivitySeconds,
        audioMimeType:
          typeof audioMimeType === 'string' && audioMimeType.trim()
            ? session.telemetry.audioMimeType || audioMimeType.trim().slice(0, 60)
            : session.telemetry.audioMimeType,
        lastHeartbeat: Date.now()
      };

      await chairSessionStore.update(chairId, {
        telemetry: nextTelemetry,
        ...(status === 'recording' ? { status: 'active' as const } : {})
      });

      res.json({ success: true, acknowledged: true, latestCommand: session.commands[session.commands.length - 1] || null });
    } catch (err) {
      logger.error('Failed to update beacon telemetry:', err);
      res.status(500).json({ error: 'Failed to record telemetry.' });
    }
  });

  // 6. Phone Beacon uploads audio chunk
  app.post('/api/beacon/chair/:chairId/upload-chunk', async (req, res) => {
    try {
      const { chairId } = req.params;
      const session = await chairSessionStore.get(chairId);
      if (!session) {
        return res.status(404).json({ error: 'Chair session not found.' });
      }

      const token =
        (req.headers['x-chair-token'] as string) ||
        (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : undefined) ||
        req.body?.token;

      if (!token || !verifyChairToken(token, sessionSecret, signaturesMatch)) {
        return res.status(401).json({ error: 'Valid chair token required.', code: 'INVALID_CHAIR_TOKEN' });
      }

      const { chunkIndex = 0, dataBase64, audioData, sizeBytes = 0, consultationId } = req.body || {};

      const verdict = evaluateChunkIngestion(session, consultationId);
      if (verdict.action === 'refuse') {
        return res.status(409).json({
          success: false,
          saved: false,
          code: verdict.code,
          error: verdict.reason
        });
      }

      const encoded =
        typeof dataBase64 === 'string' ? dataBase64 : typeof audioData === 'string' ? audioData : undefined;

      const appended = await chairSessionStore.appendAudioChunk({
        chairId,
        chunkIndex: Number(chunkIndex),
        dataBase64: encoded,
        sizeBytes: Number(sizeBytes) || 0,
        timestamp: Date.now()
      });

      if (!appended.ok) {
        return res.status(413).json({
          success: false,
          saved: false,
          code: appended.code,
          chunkCount: appended.chunkCount,
          error:
            'This recording has reached the storage limit for one appointment. It is still saved on the phone.'
        });
      }

      await chairSessionStore.update(chairId, {
        telemetry: {
          ...session.telemetry,
          bufferedChunksCount: appended.chunkCount,
          lastHeartbeat: Date.now()
        }
      });

      res.json({ success: true, saved: true, chunkCount: appended.chunkCount });
    } catch (err) {
      logger.error('Failed to ingest audio chunk:', err);
      res.status(500).json({ error: 'Failed to upload audio chunk.' });
    }
  });
}
