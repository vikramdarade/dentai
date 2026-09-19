import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CHAIR_AUDIO_LIMITS, createChairSessionStore, type ChairSession } from '../src/server/chairSessionStore';

/**
 * Chair-side beacon sessions.
 *
 * These used to live in a module-level `Map`. On a serverless host that is
 * per-instance state, so pairing appeared to succeed and the very next poll could
 * land on an instance that had never heard of the chair — the phone looked
 * disconnected and the audio went nowhere. The first test below is the one that
 * would have caught it: it reads the session back through a *second* store
 * instance, which is the closest a unit test gets to "different serverless
 * instance, same database".
 */

function memoryKv(dir: string) {
  const memory = new Map<string, any>();
  return {
    read: async (key: string, file: string, fallback: any) => {
      if (memory.has(key)) return memory.get(key);
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return fallback;
      }
    },
    write: async (key: string, file: string, value: any) => {
      memory.set(key, value);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value));
    },
    dir
  };
}

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function session(overrides: Partial<ChairSession> = {}): ChairSession {
  return {
    chairId: 'chair-abc123',
    pinCode: '4821',
    roomName: 'Chair 1',
    clinicId: 'clinic-1',
    dentistId: 'dentist-1',
    dentistName: 'Dr Test',
    createdAt: Date.now(),
    expiresAt: Date.now() + CHAIR_AUDIO_LIMITS.sessionTtlMs,
    token: 'token',
    status: 'waiting',
    commands: [],
    telemetry: {
      chairId: 'chair-abc123',
      status: 'idle',
      bufferedChunksCount: 0,
      recordingSeconds: 0,
      lastHeartbeat: Date.now()
    },
    ...overrides
  };
}

function audio(bytes: number, seed = 1): string {
  const buffer = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) buffer[i] = (i * seed) % 256;
  return buffer.toString('base64');
}

describe('durable chair sessions', () => {
  let dir: string;
  let kv: ReturnType<typeof memoryKv>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-chair-'));
    kv = memoryKv(dir);
  });

  it('survives being read by a different server instance', async () => {
    const first = createChairSessionStore({ kv: kv as any, logger });
    await first.create(session());

    // A second store instance stands in for a second serverless instance: no
    // shared memory, only the store.
    const second = createChairSessionStore({ kv: kv as any, logger });
    const found = await second.get('chair-abc123');

    expect(found).not.toBeNull();
    expect(found?.pinCode).toBe('4821');
    expect(found?.dentistId).toBe('dentist-1');
  });

  it('keeps one session per chair, so re-pairing does not fork state', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());
    await store.create(session({ pinCode: '9999', roomName: 'Chair 2' }));

    const found = await store.get('chair-abc123');
    expect(found?.pinCode).toBe('9999');
    expect(found?.roomName).toBe('Chair 2');
  });

  it('records the phone and the heartbeat without losing the pairing', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());

    await store.update('chair-abc123', {
      status: 'paired',
      deviceInfo: { model: 'Pixel 8', platform: 'Android' }
    });

    const found = await store.get('chair-abc123');
    expect(found?.status).toBe('paired');
    expect(found?.deviceInfo?.model).toBe('Pixel 8');
    // The values that were not patched are untouched: a heartbeat must not be
    // able to clear the pairing that makes the chair reachable.
    expect(found?.pinCode).toBe('4821');
  });

  it('moves the session through the recording lifecycle as commands arrive', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());

    await store.pushCommand('chair-abc123', {
      id: 'c1',
      chairId: 'chair-abc123',
      action: 'start_recording',
      timestamp: Date.now()
    });
    expect((await store.get('chair-abc123'))?.status).toBe('active');

    await store.pushCommand('chair-abc123', {
      id: 'c2',
      chairId: 'chair-abc123',
      action: 'stop_recording',
      timestamp: Date.now()
    });
    expect((await store.get('chair-abc123'))?.status).toBe('generating');
  });

  it('keeps only the newest commands, so a long appointment cannot grow the row', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());

    for (let i = 0; i < CHAIR_AUDIO_LIMITS.maxCommands + 5; i += 1) {
      await store.pushCommand('chair-abc123', {
        id: `c${i}`,
        chairId: 'chair-abc123',
        action: 'noop',
        timestamp: Date.now()
      });
    }

    expect((await store.get('chair-abc123'))?.commands).toHaveLength(CHAIR_AUDIO_LIMITS.maxCommands);
  });

  it('returns audio in index order regardless of upload order', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());

    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 2, dataBase64: audio(30, 3), sizeBytes: 30, timestamp: 0 });
    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 0, dataBase64: audio(30, 1), sizeBytes: 30, timestamp: 0 });
    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 1, dataBase64: audio(30, 2), sizeBytes: 30, timestamp: 0 });

    const chunks = await store.listAudioChunks('chair-abc123');
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it('replaces a retried chunk instead of storing the appointment twice', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());

    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 0, dataBase64: audio(30, 1), sizeBytes: 30, timestamp: 0 });
    const second = await store.appendAudioChunk({
      chairId: 'chair-abc123',
      chunkIndex: 0,
      dataBase64: audio(30, 9),
      sizeBytes: 30,
      timestamp: 0
    });

    expect(second.ok).toBe(true);
    expect(await store.countAudioChunks('chair-abc123')).toBe(1);
    expect((await store.listAudioChunks('chair-abc123'))[0].dataBase64).toBe(audio(30, 9));
  });

  it('refuses audio past the chunk cap, with a code the phone can act on', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger }, { ...CHAIR_AUDIO_LIMITS, maxChunks: 3 });
    await store.create(session());

    for (let i = 0; i < 3; i += 1) {
      const res = await store.appendAudioChunk({
        chairId: 'chair-abc123',
        chunkIndex: i,
        dataBase64: 'AAAA',
        sizeBytes: 3,
        timestamp: 0
      });
      expect(res.ok).toBe(true);
    }

    const overflow = await store.appendAudioChunk({
      chairId: 'chair-abc123',
      chunkIndex: 3,
      dataBase64: 'AAAA',
      sizeBytes: 3,
      timestamp: 0
    });

    // A phone left recording in a drawer must not fill the database; the phone
    // keeps its own IndexedDB copy, so refusing is safe and is reported.
    expect(overflow.ok).toBe(false);
    expect(overflow.code).toBe('CHAIR_AUDIO_LIMIT');
    expect(overflow.chunkCount).toBe(3);
    expect(await store.countAudioChunks('chair-abc123')).toBe(3);
  });

  it('refuses audio past the byte cap even when the chunk count is fine', async () => {
    // 120 bytes of budget, and the accounting is over base64 characters (which is
    // what is actually stored), so two 64-character chunks fill it.
    const store = createChairSessionStore({ kv: kv as any, logger }, { ...CHAIR_AUDIO_LIMITS, maxTotalBytes: 120 });
    await store.create(session());

    const first = await store.appendAudioChunk({
      chairId: 'chair-abc123',
      chunkIndex: 0,
      dataBase64: 'A'.repeat(60),
      sizeBytes: 45,
      timestamp: 0
    });
    expect(first.ok).toBe(true);

    const second = await store.appendAudioChunk({
      chairId: 'chair-abc123',
      chunkIndex: 1,
      dataBase64: 'A'.repeat(60),
      sizeBytes: 45,
      timestamp: 0
    });
    expect(second.ok).toBe(true);

    const overflow = await store.appendAudioChunk({
      chairId: 'chair-abc123',
      chunkIndex: 2,
      dataBase64: 'AAAA',
      sizeBytes: 3,
      timestamp: 0
    });

    expect(overflow.ok).toBe(false);
    expect(overflow.code).toBe('CHAIR_AUDIO_LIMIT');
    // The refused chunk is genuinely not stored: a cap that only reports itself
    // is not a cap.
    expect(await store.countAudioChunks('chair-abc123')).toBe(2);
  });

  it('reports a chunk count without loading the audio', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());
    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 0, dataBase64: audio(30), sizeBytes: 30, timestamp: 0 });
    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 1, dataBase64: audio(30), sizeBytes: 30, timestamp: 0 });
    expect(await store.countAudioChunks('chair-abc123')).toBe(2);
  });

  it('deletes the audio without unpairing the chair', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());
    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 0, dataBase64: audio(30), sizeBytes: 30, timestamp: 0 });

    await store.deleteAudio('chair-abc123');

    // The transcript has been produced; the raw voice is no longer needed, but
    // the chair must still be paired and reachable.
    expect(await store.listAudioChunks('chair-abc123')).toHaveLength(0);
    expect((await store.get('chair-abc123'))?.status).toBe('waiting');
  });

  it('removes an expired session and its audio together, and leaves live ones alone', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session({ chairId: 'chair-old', expiresAt: Date.now() - 1000 }));
    await store.create(session({ chairId: 'chair-live', expiresAt: Date.now() + 60_000 }));
    await store.appendAudioChunk({ chairId: 'chair-old', chunkIndex: 0, dataBase64: audio(30), sizeBytes: 30, timestamp: 0 });

    const purged = await store.purgeExpired();

    expect(purged).toBe(1);
    expect(await store.get('chair-old')).toBeNull();
    expect(await store.listAudioChunks('chair-old')).toHaveLength(0);
    expect(await store.get('chair-live')).not.toBeNull();
  });

  it('deletes a session and its recording on request', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    await store.create(session());
    await store.appendAudioChunk({ chairId: 'chair-abc123', chunkIndex: 0, dataBase64: audio(30), sizeBytes: 30, timestamp: 0 });

    await store.delete('chair-abc123');

    expect(await store.get('chair-abc123')).toBeNull();
    expect(await store.listAudioChunks('chair-abc123')).toHaveLength(0);
  });

  it('ignores a heartbeat for a chair that was never created', async () => {
    const store = createChairSessionStore({ kv: kv as any, logger });
    // Must not throw: an unpaired phone polling a stale id is normal, and it must
    // not take down the endpoint for everyone else.
    await expect(store.update('chair-ghost', { status: 'active' })).resolves.toBeUndefined();
    expect(await store.get('chair-ghost')).toBeNull();
  });
});
