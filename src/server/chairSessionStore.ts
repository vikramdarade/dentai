/**
 * Durable chair-side beacon sessions.
 *
 * The beacon state used to live in a module-level `Map`. On a serverless host
 * that is per-instance state, so pairing succeeded on one instance and the
 * status poll landed on another that had never heard of the chair — the phone
 * appeared disconnected, commands went missing, and the recorded audio was
 * dropped. It also grew without bound: every uploaded audio chunk was pushed
 * into the same Map for the life of the process.
 *
 * Two tables, deliberately separate:
 *   - `chair_sessions` holds the small, frequently-updated state (status,
 *     telemetry, commands).
 *   - `chair_audio_chunks` holds the audio. It is written once per chunk and read
 *     once when the consultation is transcribed, so keeping it out of the hot
 *     session row avoids re-serialising megabytes on every heartbeat.
 *
 * Audio is capped. A cap is not optional: without one a phone left recording
 * overnight fills a database. When a session hits the cap the upload is refused
 * with a code the client can act on, and the phone's own IndexedDB copy remains
 * the fallback (see src/lib/beaconAudioStorage.ts).
 */

import { dbEnabled, sql } from '../lib/db';
import type { JsonKv } from './stores';

export interface ChairDeviceInfo {
  model: string;
  platform?: string;
  batteryLevel?: number;
  isCharging?: boolean;
  userAgent?: string;
}

export interface ChairCommand {
  id: string;
  chairId: string;
  action: string;
  timestamp: number;
  payload?: any;
}

export interface ChairTelemetry {
  chairId: string;
  status: 'idle' | 'recording' | 'paused' | 'uploading' | 'completed';
  batteryLevel?: number;
  isCharging?: boolean;
  audioLevel?: number;
  bufferedChunksCount: number;
  recordingSeconds: number;
  dismissalDetected?: { phrase: string; confidence?: number; detectedAt: number };
  /**
   * Container type the phone recorded in (`MediaRecorder.mimeType`).
   *
   * Needed because the recorded audio is now transcribed server-side, and the
   * provider needs the real container to decode it — guessing `audio/webm` for a
   * Safari recording (`audio/mp4`) fails the whole transcription. It rides in the
   * telemetry JSON rather than its own column: it is capture metadata, and a
   * migration for one optional string would be the expensive way to store it.
   */
  audioMimeType?: string;
  inactivitySeconds?: number;
  lastHeartbeat: number;
}

export interface ChairSession {
  chairId: string;
  pinCode: string;
  roomName: string;
  clinicId?: string;
  dentistId?: string;
  dentistName?: string;
  createdAt: number;
  expiresAt: number;
  token: string;
  status: 'waiting' | 'paired' | 'active' | 'generating' | 'completed';
  deviceInfo?: ChairDeviceInfo;
  commands: ChairCommand[];
  telemetry: ChairTelemetry;
}

export interface ChairAudioChunk {
  chairId: string;
  chunkIndex: number;
  dataBase64?: string;
  sizeBytes: number;
  timestamp: number;
}

/**
 * Bounds that stop a forgotten phone from filling the database.
 *
 * Injectable so the caps can be tested at their boundary with small numbers
 * rather than by allocating sixty megabytes, which is the difference between a
 * verified limit and a comment claiming one.
 */
export interface ChairAudioLimits {
  maxChunks: number;
  maxTotalBytes: number;
  maxCommands: number;
  sessionTtlMs: number;
}

export const CHAIR_AUDIO_LIMITS: ChairAudioLimits = {
  /** ~45 minutes of 2.5-second chunks. */
  maxChunks: 1200,
  /** Total base64 payload accepted per session (~60 MB of base64 ≈ 45 MB audio). */
  maxTotalBytes: 60 * 1024 * 1024,
  /** Commands retained per session (only the newest are read). */
  maxCommands: 50,
  /** How long an unpurged session may live before it is swept. */
  sessionTtlMs: 12 * 60 * 60 * 1000
};

export interface AppendChunkResult {
  ok: boolean;
  chunkCount: number;
  totalBytes: number;
  /** Set when the cap was hit, so the client can stop uploading and keep its local copy. */
  code?: 'CHAIR_AUDIO_LIMIT';
}

export interface ChairSessionStore {
  create(session: ChairSession): Promise<void>;
  get(chairId: string): Promise<ChairSession | null>;
  /** Shallow-merges `patch` into the stored session. */
  update(chairId: string, patch: Partial<ChairSession>): Promise<void>;
  /** Appends a command, keeping only the newest `maxCommands`. */
  pushCommand(chairId: string, command: ChairCommand): Promise<void>;
  appendAudioChunk(chunk: ChairAudioChunk): Promise<AppendChunkResult>;
  listAudioChunks(chairId: string): Promise<ChairAudioChunk[]>;
  /** Cheap count — never loads the audio just to report a number. */
  countAudioChunks(chairId: string): Promise<number>;
  delete(chairId: string): Promise<void>;
  /**
   * Removes only the audio, keeping the session row.
   *
   * Used once a recording has been transcribed and the transcript stored: the
   * transcript is then the record, and holding raw voice (a third party's, and
   * a patient's) after it is no longer needed is a liability, not a backup.
   * Kept separate from `delete` so a beacon session is not unpaired by it.
   */
  deleteAudio(chairId: string): Promise<void>;
  /** Removes sessions past their expiry. Returns how many went. */
  purgeExpired(now?: number): Promise<number>;
}

export interface ChairSessionStoreDeps {
  kv: JsonKv;
  logger: {
    warn: (message: string, context?: Record<string, any>) => void;
  };
}

const FILE = 'chair_sessions.json';
const KEY = 'dentai:chair_sessions';

interface JsonShape {
  sessions: Record<string, ChairSession>;
  chunks: Record<string, ChairAudioChunk[]>;
}

function db() {
  if (!sql) throw new Error('Postgres driver is not configured.');
  return sql;
}

export function createChairSessionStore(
  deps: ChairSessionStoreDeps,
  limits: ChairAudioLimits = CHAIR_AUDIO_LIMITS
): ChairSessionStore {
  const path = `${deps.kv.dir}/${FILE}`;

  const empty = (): JsonShape => ({ sessions: {}, chunks: {} });
  const readJson = async (): Promise<JsonShape> => {
    const data = await deps.kv.read(KEY, path, empty());
    return {
      sessions: data?.sessions && typeof data.sessions === 'object' ? data.sessions : {},
      chunks: data?.chunks && typeof data.chunks === 'object' ? data.chunks : {}
    };
  };
  const writeJson = async (value: JsonShape): Promise<void> => {
    await deps.kv.write(KEY, path, value);
  };

  function toSession(row: any): ChairSession {
    return {
      chairId: row.chair_id,
      pinCode: row.pin_code,
      roomName: row.room_name,
      clinicId: row.clinic_id ?? undefined,
      dentistId: row.dentist_id ?? undefined,
      dentistName: row.dentist_name ?? undefined,
      createdAt: new Date(row.created_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
      token: row.token,
      status: row.status,
      deviceInfo: row.device_info ?? undefined,
      commands: Array.isArray(row.commands) ? row.commands : [],
      telemetry: row.telemetry
    };
  }

  const store: ChairSessionStore = {
    async create(session) {
      if (dbEnabled) {
        await db()`
          INSERT INTO chair_sessions
            (chair_id, pin_code, room_name, clinic_id, dentist_id, dentist_name,
             token, status, device_info, commands, telemetry, created_at, expires_at, updated_at)
          VALUES (
            ${session.chairId}, ${session.pinCode}, ${session.roomName},
            ${session.clinicId ?? null}, ${session.dentistId ?? null}, ${session.dentistName ?? null},
            ${session.token}, ${session.status},
            ${session.deviceInfo ? JSON.stringify(session.deviceInfo) : null}::jsonb,
            ${JSON.stringify(session.commands)}::jsonb,
            ${JSON.stringify(session.telemetry)}::jsonb,
            ${new Date(session.createdAt).toISOString()}::timestamptz,
            ${new Date(session.expiresAt).toISOString()}::timestamptz,
            now()
          )
          ON CONFLICT (chair_id) DO UPDATE
            SET pin_code = EXCLUDED.pin_code,
                room_name = EXCLUDED.room_name,
                clinic_id = EXCLUDED.clinic_id,
                dentist_id = EXCLUDED.dentist_id,
                dentist_name = EXCLUDED.dentist_name,
                token = EXCLUDED.token,
                status = EXCLUDED.status,
                commands = EXCLUDED.commands,
                telemetry = EXCLUDED.telemetry,
                expires_at = EXCLUDED.expires_at,
                updated_at = now()
        `;
        return;
      }
      const data = await readJson();
      data.sessions[session.chairId] = session;
      await writeJson(data);
    },

    async get(chairId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM chair_sessions WHERE chair_id = ${chairId} LIMIT 1
        `) as any[];
        return rows.length ? toSession(rows[0]) : null;
      }
      const data = await readJson();
      return data.sessions[chairId] ?? null;
    },

    async update(chairId, patch) {
      if (dbEnabled) {
        // Read-modify-write on the JSON columns keeps this simple and correct.
        // Only heartbeats and small state land here, never audio.
        const rows = (await db()`
          UPDATE chair_sessions SET
            status = COALESCE(${patch.status ?? null}, status),
            clinic_id = COALESCE(${patch.clinicId ?? null}, clinic_id),
            dentist_id = COALESCE(${patch.dentistId ?? null}, dentist_id),
            dentist_name = COALESCE(${patch.dentistName ?? null}, dentist_name),
            pin_code = COALESCE(${patch.pinCode ?? null}, pin_code),
            room_name = COALESCE(${patch.roomName ?? null}, room_name),
            device_info = COALESCE(${patch.deviceInfo ? JSON.stringify(patch.deviceInfo) : null}::jsonb, device_info),
            telemetry = COALESCE(${patch.telemetry ? JSON.stringify(patch.telemetry) : null}::jsonb, telemetry),
            updated_at = now()
          WHERE chair_id = ${chairId}
          RETURNING chair_id
        `) as any[];
        if (rows.length === 0) deps.logger.warn('Chair session update found no row', { chairId });
        return;
      }
      const data = await readJson();
      const existing = data.sessions[chairId];
      if (!existing) {
        deps.logger.warn('Chair session update found no session', { chairId });
        return;
      }
      data.sessions[chairId] = { ...existing, ...patch };
      await writeJson(data);
    },

    async pushCommand(chairId, command) {
      if (dbEnabled) {
        await db()`
          UPDATE chair_sessions
          SET commands = (
                COALESCE(commands, '[]'::jsonb) ||
                ${JSON.stringify([command])}::jsonb
              ) -> -1,
              status = ${command.action === 'start_recording' ? 'active'
                        : command.action === 'stop_recording' ? 'generating'
                        : command.action === 'cancel' ? 'paired'
                        : null}::text,
              updated_at = now()
          WHERE chair_id = ${chairId}
        `;
        return;
      }
      const data = await readJson();
      const existing = data.sessions[chairId];
      if (!existing) return;
      existing.commands = [...existing.commands, command].slice(-limits.maxCommands);
      if (command.action === 'start_recording') existing.status = 'active';
      if (command.action === 'stop_recording') existing.status = 'generating';
      if (command.action === 'cancel') existing.status = 'paired';
      await writeJson(data);
    },

    async appendAudioChunk(chunk) {
      const incoming = typeof chunk.dataBase64 === 'string' ? chunk.dataBase64.length : 0;

      if (dbEnabled) {
        // The caps are enforced against what is already stored, so a client that
        // ignores the refusal code cannot grow the table without bound.
        const totals = (await db()`
          SELECT COUNT(*)::int AS chunks, COALESCE(SUM(LENGTH(data_base64)), 0)::bigint AS bytes
          FROM chair_audio_chunks WHERE chair_id = ${chunk.chairId}
        `) as any[];
        const chunkCount = Number(totals[0]?.chunks ?? 0);
        const totalBytes = Number(totals[0]?.bytes ?? 0);

        if (chunkCount >= limits.maxChunks || totalBytes + incoming > limits.maxTotalBytes) {
          return { ok: false, chunkCount, totalBytes, code: 'CHAIR_AUDIO_LIMIT' };
        }

        await db()`
          INSERT INTO chair_audio_chunks (chair_id, chunk_index, data_base64, size_bytes, created_at)
          VALUES (${chunk.chairId}, ${chunk.chunkIndex}, ${chunk.dataBase64 ?? null}, ${chunk.sizeBytes}, now())
          ON CONFLICT (chair_id, chunk_index) DO UPDATE
            SET data_base64 = EXCLUDED.data_base64,
                size_bytes = EXCLUDED.size_bytes
        `;
        return { ok: true, chunkCount: chunkCount + 1, totalBytes: totalBytes + incoming };
      }

      const data = await readJson();
      const list = data.chunks[chunk.chairId] ?? [];
      const totalBytes = list.reduce((sum, c) => sum + (c.dataBase64?.length ?? 0), 0);
      if (list.length >= limits.maxChunks || totalBytes + incoming > limits.maxTotalBytes) {
        return { ok: false, chunkCount: list.length, totalBytes, code: 'CHAIR_AUDIO_LIMIT' };
      }
      const withoutSame = list.filter((c) => c.chunkIndex !== chunk.chunkIndex);
      data.chunks[chunk.chairId] = [...withoutSame, chunk].sort((a, b) => a.chunkIndex - b.chunkIndex);
      await writeJson(data);
      return { ok: true, chunkCount: data.chunks[chunk.chairId].length, totalBytes: totalBytes + incoming };
    },

    async listAudioChunks(chairId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT chair_id, chunk_index, data_base64, size_bytes
          FROM chair_audio_chunks
          WHERE chair_id = ${chairId}
          ORDER BY chunk_index ASC
        `) as any[];
        return rows.map((r: any) => ({
          chairId: r.chair_id,
          chunkIndex: Number(r.chunk_index),
          dataBase64: r.data_base64 ?? undefined,
          sizeBytes: Number(r.size_bytes ?? 0),
          timestamp: 0
        }));
      }
      const data = await readJson();
      return [...(data.chunks[chairId] ?? [])].sort((a, b) => a.chunkIndex - b.chunkIndex);
    },

    async countAudioChunks(chairId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT COUNT(*)::int AS chunks FROM chair_audio_chunks WHERE chair_id = ${chairId}
        `) as any[];
        return Number(rows[0]?.chunks ?? 0);
      }
      const data = await readJson();
      return (data.chunks[chairId] ?? []).length;
    },

    async delete(chairId) {
      if (dbEnabled) {
        await db()`DELETE FROM chair_audio_chunks WHERE chair_id = ${chairId}`;
        await db()`DELETE FROM chair_sessions WHERE chair_id = ${chairId}`;
        return;
      }
      const data = await readJson();
      delete data.sessions[chairId];
      delete data.chunks[chairId];
      await writeJson(data);
    },

    async deleteAudio(chairId) {
      if (dbEnabled) {
        await db()`DELETE FROM chair_audio_chunks WHERE chair_id = ${chairId}`;
        return;
      }
      const data = await readJson();
      if (data.chunks[chairId]) {
        delete data.chunks[chairId];
        await writeJson(data);
      }
    },

    async purgeExpired(now = Date.now()) {
      if (dbEnabled) {
        await db()`
          DELETE FROM chair_audio_chunks
          WHERE chair_id IN (SELECT chair_id FROM chair_sessions WHERE expires_at < now())
        `;
        const rows = (await db()`
          DELETE FROM chair_sessions WHERE expires_at < now() RETURNING chair_id
        `) as any[];
        return rows.length;
      }
      const data = await readJson();
      let removed = 0;
      for (const [chairId, session] of Object.entries(data.sessions)) {
        if (session.expiresAt < now) {
          delete data.sessions[chairId];
          delete data.chunks[chairId];
          removed += 1;
        }
      }
      if (removed > 0) await writeJson(data);
      return removed;
    }
  };

  return store;
}
