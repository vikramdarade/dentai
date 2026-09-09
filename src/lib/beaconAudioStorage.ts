/**
 * Resilient IndexedDB audio slice store for Operatory Phone Beacon.
 * Guarantees zero lost audio if clinic Wi-Fi drops or exhibits latency spikes.
 */

const DB_NAME = 'dentai_beacon_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_chunks';

export interface StoredAudioChunk {
  id: string; // ${chairId}_chunk_${index}
  chairId: string;
  chunkIndex: number;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  timestamp: number;
  synced: boolean;
}

function getIndexedDb(): IDBFactory | null {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  return null;
}

export async function openBeaconDb(): Promise<IDBDatabase | null> {
  const idb = getIndexedDb();
  if (!idb) return null;

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('chairId', 'chairId', { unique: false });
        store.createIndex('chunkIndex', 'chunkIndex', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAudioChunk(
  chairId: string,
  chunkIndex: number,
  blob: Blob
): Promise<StoredAudioChunk> {
  const chunk: StoredAudioChunk = {
    id: `${chairId}_chunk_${String(chunkIndex).padStart(6, '0')}`,
    chairId,
    chunkIndex,
    blob,
    mimeType: blob.type || 'audio/webm',
    sizeBytes: blob.size,
    timestamp: Date.now(),
    synced: false
  };

  const db = await openBeaconDb();
  if (!db) return chunk;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(chunk);
    req.onsuccess = () => resolve(chunk);
    req.onerror = () => reject(req.error);
  });
}

export async function getUnsyncedChunks(chairId: string): Promise<StoredAudioChunk[]> {
  const db = await openBeaconDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const chairIndex = store.index('chairId');
    const req = chairIndex.getAll(IDBKeyRange.only(chairId));

    req.onsuccess = () => {
      const allForChair: StoredAudioChunk[] = req.result || [];
      const unsynced = allForChair
        .filter((c) => !c.synced)
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
      resolve(unsynced);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function markChunkSynced(chunkId: string): Promise<void> {
  const db = await openBeaconDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(chunkId);

    req.onsuccess = () => {
      const item: StoredAudioChunk = req.result;
      if (item) {
        item.synced = true;
        store.put(item);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function reassembleAudioBlob(chairId: string): Promise<Blob | null> {
  const db = await openBeaconDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const chairIndex = store.index('chairId');
    const req = chairIndex.getAll(IDBKeyRange.only(chairId));

    req.onsuccess = () => {
      const chunks: StoredAudioChunk[] = (req.result || []).sort(
        (a, b) => a.chunkIndex - b.chunkIndex
      );
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      const mimeType = chunks[0].mimeType || 'audio/webm';
      const blobs = chunks.map((c) => c.blob);
      resolve(new Blob(blobs, { type: mimeType }));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSessionChunks(chairId: string): Promise<void> {
  const db = await openBeaconDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const chairIndex = store.index('chairId');
    const req = chairIndex.getAllKeys(IDBKeyRange.only(chairId));

    req.onsuccess = () => {
      const keys = req.result || [];
      keys.forEach((k) => store.delete(k));
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}
