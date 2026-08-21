/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Consultation } from '../types';

const STORAGE_KEYS = {
  TOKEN: 'dentai_token',
  USER: 'dentai_user',
  CONSULTATIONS: 'dentai_consultations_cache',
  ACTIVE_INTAKE: 'dentai_active_intake',
  PENDING_SYNC: 'dentai_pending_sync',
};

export interface AuthUser {
  id: string;
  name: string;
  specialty: string;
}

export function saveAuth(token: string, user: AuthUser): void {
  try {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    // Also mirror to sessionStorage for multi-tab fallback compatibility
    sessionStorage.setItem(STORAGE_KEYS.TOKEN, token);
    sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  } catch (err) {
    console.error('[Storage] Failed to save auth credentials:', err);
  }
}

export function getAuth(): { token: string | null; user: AuthUser | null } {
  try {
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN) || sessionStorage.getItem(STORAGE_KEYS.TOKEN);
    const userStr = localStorage.getItem(STORAGE_KEYS.USER) || sessionStorage.getItem(STORAGE_KEYS.USER);
    const user = userStr ? JSON.parse(userStr) : null;
    return { token, user };
  } catch (err) {
    console.error('[Storage] Failed to read auth credentials:', err);
    return { token: null, user: null };
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_INTAKE);
    sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
    sessionStorage.removeItem(STORAGE_KEYS.USER);
    sessionStorage.removeItem(STORAGE_KEYS.ACTIVE_INTAKE);
  } catch (err) {
    console.error('[Storage] Failed to clear auth:', err);
  }
}

export function saveLocalConsultations(consultations: Consultation[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CONSULTATIONS, JSON.stringify(consultations));
  } catch (err) {
    console.error('[Storage] Failed to save consultations to local cache:', err);
  }
}

export function getLocalConsultations(): Consultation[] | null {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CONSULTATIONS);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.error('[Storage] Failed to load consultations from local cache:', err);
    return null;
  }
}

export function saveActiveIntake(intake: any): void {
  try {
    const val = JSON.stringify(intake);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_INTAKE, val);
    sessionStorage.setItem(STORAGE_KEYS.ACTIVE_INTAKE, val);
  } catch (err) {
    console.error('[Storage] Failed to save active intake:', err);
  }
}

export function getActiveIntake(): any {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.ACTIVE_INTAKE) || sessionStorage.getItem(STORAGE_KEYS.ACTIVE_INTAKE);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('[Storage] Failed to get active intake:', err);
    return null;
  }
}

export function clearActiveIntake(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_INTAKE);
    sessionStorage.removeItem(STORAGE_KEYS.ACTIVE_INTAKE);
  } catch (err) {
    console.error('[Storage] Failed to clear active intake:', err);
  }
}
