/**
 * Client Session Cache for DentAI.
 *
 * Provides resilient offline caching for active clinical sessions and drafts,
 * with dirty sync tracking and safety guards preventing ephemeral scratchpads
 * from polluting permanent storage (Rule 18).
 */

import { Consultation } from '../types';

const STORAGE_KEY_SESSIONS = 'dentai_cached_sessions_v2';
const STORAGE_KEY_DIRTY = 'dentai_dirty_session_ids_v2';

export interface CachedSessionMeta {
  id: string;
  patientName: string;
  updatedAt: string;
  isSynced: boolean;
  teethInvolved?: string[];
}

/**
 * Loads cached consultations from localStorage with safety fallback.
 */
export function getCachedConsultations(): Consultation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c: Consultation) => c && c.id && c.id !== 'chair-active');
  } catch (err) {
    console.warn('[SessionCache] Failed to read cached consultations:', err);
    return [];
  }
}

/**
 * Persists consultations to localStorage, filtering out transient scratchpads.
 */
export function saveCachedConsultations(consultations: Consultation[]): void {
  try {
    // Strictly filter out ephemeral in-chair scratchpad (Rule 18)
    const valid = consultations.filter(c => c && c.id && c.id !== 'chair-active');
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(valid));
  } catch (err) {
    console.warn('[SessionCache] Failed to write cached consultations:', err);
  }
}

/**
 * Marks a session ID as needing backend sync (dirty state).
 */
export function markSessionDirty(id: string): void {
  if (id === 'chair-active') return;
  try {
    const dirty = getDirtySessionIds();
    if (!dirty.includes(id)) {
      dirty.push(id);
      localStorage.setItem(STORAGE_KEY_DIRTY, JSON.stringify(dirty));
    }
  } catch (err) {
    console.warn('[SessionCache] Failed to mark session dirty:', err);
  }
}

/**
 * Clears dirty state once a session successfully syncs with the server.
 */
export function clearSessionDirty(id: string): void {
  try {
    const dirty = getDirtySessionIds().filter(d => d !== id);
    localStorage.setItem(STORAGE_KEY_DIRTY, JSON.stringify(dirty));
  } catch (err) {
    console.warn('[SessionCache] Failed to clear dirty session:', err);
  }
}

/**
 * Returns array of session IDs that have unsynced changes.
 */
export function getDirtySessionIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DIRTY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
