import { AppointmentType } from './dentalLibrary';

export type ScheduleItemStatus =
  | 'scheduled'
  | 'recording'
  | 'processing'
  | 'ready'
  | 'failed';

export interface DayScheduleItem {
  id: string;
  time: string;
  patientName: string;
  procedureText: string;
  appointmentType: AppointmentType;
  templateId: string;
  status: ScheduleItemStatus;
  jobId?: string;
  consultationId?: string;
  error?: string;
  clinicalNote?: string;
  adaCodes?: string[];
  completedAt?: string;
  source?: 'snip' | 'manual';
}

const STORAGE_KEY_PREFIX = 'dentai_day_schedule_';

const memStorage = new Map<string, string>();

function getStorageItem(key: string): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memStorage.get(key) || null;
    }
  }
  return memStorage.get(key) || null;
}

function setStorageItem(key: string, val: string): void {
  memStorage.set(key, val);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, val);
    } catch {
      // ignore
    }
  }
}

function removeStorageItem(key: string): void {
  memStorage.delete(key);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export function getTodayDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function loadTodaySchedule(dateStr = getTodayDateStr()): DayScheduleItem[] {
  try {
    const raw = getStorageItem(`${STORAGE_KEY_PREFIX}${dateStr}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load today schedule from storage:', err);
    return [];
  }
}

export function saveTodaySchedule(items: DayScheduleItem[], dateStr = getTodayDateStr()): void {
  try {
    setStorageItem(`${STORAGE_KEY_PREFIX}${dateStr}`, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to save today schedule to storage:', err);
  }
}

export function updateScheduleItem(
  id: string,
  updates: Partial<DayScheduleItem>,
  dateStr = getTodayDateStr()
): DayScheduleItem[] {
  const current = loadTodaySchedule(dateStr);
  const updated = current.map((item) => {
    if (item.id === id) {
      return { ...item, ...updates };
    }
    return item;
  });
  saveTodaySchedule(updated, dateStr);
  return updated;
}

export function addScheduleItem(
  item: Omit<DayScheduleItem, 'id' | 'status'>,
  dateStr = getTodayDateStr()
): DayScheduleItem {
  const current = loadTodaySchedule(dateStr);
  const newItem: DayScheduleItem = {
    ...item,
    id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    status: 'scheduled'
  };
  const updated = [...current, newItem].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  saveTodaySchedule(updated, dateStr);
  return newItem;
}

export function deleteScheduleItem(id: string, dateStr = getTodayDateStr()): DayScheduleItem[] {
  const current = loadTodaySchedule(dateStr);
  const updated = current.filter(i => i.id !== id);
  saveTodaySchedule(updated, dateStr);
  return updated;
}

export function clearTodaySchedule(dateStr = getTodayDateStr()): void {
  try {
    removeStorageItem(`${STORAGE_KEY_PREFIX}${dateStr}`);
  } catch {
    // ignore
  }
}

/**
 * Format a completed consultation note specifically for Australian PMS (D4W & Praktika)
 * clinical progress notes tab.
 */
export function formatNoteForPmsClipboard(item: DayScheduleItem, consultation?: any): string {
  if (item.clinicalNote) {
    return item.clinicalNote;
  }

  if (!consultation) {
    return `Patient: ${item.patientName}\nAppointment: ${item.procedureText}\nStatus: Completed`;
  }

  const f = consultation.findings || {};
  const lines: string[] = [
    `=== DENTAI AMBIENT CLINICAL NOTE ===`,
    `Patient: ${consultation.firstName || ''} ${consultation.lastName || ''}`.trim(),
    `Date: ${consultation.date || getTodayDateStr()} | Time: ${item.time || ''}`,
    `Procedure: ${item.procedureText || consultation.appointmentType}`,
    ``
  ];

  if (f.chiefComplaint) {
    lines.push(`CHIEF COMPLAINT:`, f.chiefComplaint, ``);
  }
  if (f.clinicalFindings) {
    lines.push(`EXAMINATION & FINDINGS:`, f.clinicalFindings, ``);
  }
  if (f.treatmentRendered) {
    lines.push(`TREATMENT PERFORMED:`, f.treatmentRendered, ``);
  }
  if (f.localAnaesthetic) {
    lines.push(`LOCAL ANAESTHETIC:`, f.localAnaesthetic, ``);
  }
  if (f.prescriptions) {
    lines.push(`PRESCRIPTIONS / MATERIALS:`, f.prescriptions, ``);
  }
  if (f.postOpAdvice) {
    lines.push(`POST-OPERATIVE INSTRUCTIONS:`, f.postOpAdvice, ``);
  }
  if (f.nextVisit) {
    lines.push(`NEXT VISIT / RECALL:`, f.nextVisit, ``);
  }

  const adaList = Array.isArray(consultation.adaCodes) ? consultation.adaCodes : item.adaCodes;
  if (adaList && adaList.length > 0) {
    lines.push(`ADA ITEM CODES:`, adaList.join(', '), ``);
  }

  return lines.join('\n').trim();
}
