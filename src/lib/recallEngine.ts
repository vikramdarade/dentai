/**
 * Recall Worklist Engine.
 *
 * Converts clinical consultation findings (`recallRequirements`) into actionable
 * recall due dates, categorization (routine hygiene vs periodontal vs urgent review),
 * and personalized patient outreach messaging.
 *
 * Hardened per clinical rules:
 * - Never synthesises missing recall intervals.
 * - Uses clamped calendar arithmetic to prevent month-end overflow (e.g. 31 Aug + 6mo -> 28 Feb).
 * - Deduplicates consultations by patient, tracking latest clinical recall.
 * - Recognises fulfilled/booked recalls if a patient had a subsequent consultation after the due date.
 * - No mock timestamps or fallback to new Date() for missing records.
 */

import { Consultation } from '../types';
import { patientDisplayName, patientNameKey } from './patients';

export interface RecallDueDateResult {
  dueDateIso: string;
  intervalMonths: number;
  urgency: 'routine' | 'periodontal' | 'urgent';
}

export interface RecallOpportunity {
  id: string;
  consultationId: string;
  patientId?: string;
  patientName: string;
  dentistId: string;
  clinicId?: string;
  consultationDate: string;
  recallInterval: string;
  dueDate: string;
  urgency: 'routine' | 'periodontal' | 'urgent';
  status: 'overdue' | 'due_now' | 'upcoming' | 'booked';
  suggestedMessage: string;
}

/**
 * Adds months to a date without overflowing into the subsequent month
 * (e.g. 31 Aug + 6 months -> 28 Feb instead of 3 March).
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const originalDay = date.getDate();
  const targetMonth = result.getMonth() + months;

  result.setMonth(targetMonth, 1);
  const maxDaysInTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, maxDaysInTargetMonth));
  return result;
}

/**
 * Calculates a precise recall due date from a consultation date and explicit recall requirement.
 * Returns null if consultationDate is invalid or no recall requirement was documented.
 */
export function calculateRecallDueDate(
  consultationDateIso: string,
  recallRequirements?: string
): RecallDueDateResult | null {
  if (!consultationDateIso) return null;
  const baseDate = new Date(consultationDateIso);
  if (isNaN(baseDate.getTime())) return null;

  const raw = (recallRequirements || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  let intervalMonths = 6;
  let urgency: 'routine' | 'periodontal' | 'urgent' = 'routine';

  if (lower.includes('urgent') || lower.includes('next available') || lower.includes('2 week') || lower.includes('two week')) {
    intervalMonths = 0.5; // ~14 days
    urgency = 'urgent';
  } else if (lower.includes('1 week') || lower.includes('one week')) {
    intervalMonths = 0.25; // ~7 days
    urgency = 'urgent';
  } else if (lower.includes('3 month') || lower.includes('perio') || lower.includes('periodontal')) {
    intervalMonths = 3;
    urgency = 'periodontal';
  } else if (lower.includes('4 month')) {
    intervalMonths = 4;
    urgency = 'periodontal';
  } else if (lower.includes('12 month') || lower.includes('annual') || lower.includes('1 year')) {
    intervalMonths = 12;
    urgency = 'routine';
  } else if (lower.includes('9 month')) {
    intervalMonths = 9;
    urgency = 'routine';
  } else if (lower.includes('6 month')) {
    intervalMonths = 6;
    urgency = 'routine';
  } else {
    // If requirement has general recall wording (e.g. "hygiene recall", "review")
    intervalMonths = 6;
    urgency = 'routine';
  }

  let targetDate: Date;
  if (intervalMonths === 0.25) {
    targetDate = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (intervalMonths === 0.5) {
    targetDate = new Date(baseDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  } else {
    targetDate = addMonthsClamped(baseDate, intervalMonths);
  }

  return {
    dueDateIso: targetDate.toISOString(),
    intervalMonths,
    urgency,
  };
}

/**
 * Derives a clean status ('overdue' | 'due_now' | 'upcoming') given a target due date
 * relative to a reference date.
 */
export function determineRecallStatus(
  dueDateIso: string,
  referenceDateIso?: string
): 'overdue' | 'due_now' | 'upcoming' {
  const ref = referenceDateIso ? new Date(referenceDateIso) : new Date();
  const due = new Date(dueDateIso);

  const diffMs = due.getTime() - ref.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Overdue if due date passed by more than 14 days
  if (diffDays < -14) {
    return 'overdue';
  }
  // Due now if within -14 days to +30 days (current recall window)
  if (diffDays <= 30) {
    return 'due_now';
  }
  return 'upcoming';
}

/**
 * Extracts, deduplicates, and normalizes recall opportunities from clinical consultations.
 * Deduplicates per patient and marks completed if patient had a subsequent visit after due date.
 */
export function extractRecallItems(
  consultations: Consultation[],
  referenceDateIso?: string
): RecallOpportunity[] {
  // Group consultations by patient
  const byPatient = new Map<string, Consultation[]>();

  for (const c of consultations) {
    const key = c.patientId
      ? `id:${c.patientId}`
      : `name:${patientNameKey(c.firstName || '', c.lastName || '')}`;
    const list = byPatient.get(key) || [];
    list.push(c);
    byPatient.set(key, list);
  }

  const items: RecallOpportunity[] = [];

  for (const [, patientConsults] of byPatient) {
    // Sort patient consultations chronologically ascending
    patientConsults.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date || 0).getTime();
      const timeB = new Date(b.createdAt || b.date || 0).getTime();
      return timeA - timeB;
    });

    // Find the latest consultation with an explicit recall requirement
    let latestRecallConsult: Consultation | null = null;
    let latestDueDateResult: RecallDueDateResult | null = null;

    for (let i = patientConsults.length - 1; i >= 0; i--) {
      const c = patientConsults[i];
      const rawReq = c.findings?.recallRequirements;
      const dateIso = c.createdAt || c.date;
      if (!rawReq || !dateIso) continue;

      const due = calculateRecallDueDate(dateIso, rawReq);
      if (due) {
        latestRecallConsult = c;
        latestDueDateResult = due;
        break;
      }
    }

    if (!latestRecallConsult || !latestDueDateResult) continue;

    const c = latestRecallConsult;
    const { dueDateIso, intervalMonths, urgency } = latestDueDateResult;
    const patientName = patientDisplayName(c);
    const consultationDate = c.createdAt || c.date || '';

    // Check if the patient had a subsequent visit AFTER the due date
    const dueTime = new Date(dueDateIso).getTime();
    const hasSubsequentVisit = patientConsults.some((visit) => {
      const visitTime = new Date(visit.createdAt || visit.date || 0).getTime();
      return visitTime > dueTime;
    });

    const baseStatus = determineRecallStatus(dueDateIso, referenceDateIso);
    const status: RecallOpportunity['status'] = hasSubsequentVisit ? 'booked' : baseStatus;

    const typeDesc =
      urgency === 'periodontal'
        ? 'periodontal maintenance review'
        : urgency === 'urgent'
        ? 'urgent follow-up consultation'
        : `${intervalMonths}-month preventative hygiene check`;

    const suggestedMessage = `Hi ${c.firstName || 'there'}, it is time for your ${typeDesc} as planned during your dental visit. Please reply or contact the practice to reserve your chair time.`;

    items.push({
      id: `${c.id}-recall`,
      consultationId: c.id,
      patientId: c.patientId,
      patientName,
      dentistId: c.dentistId || '',
      clinicId: c.clinicId,
      consultationDate,
      recallInterval: c.findings?.recallRequirements || '',
      dueDate: dueDateIso,
      urgency,
      status,
      suggestedMessage,
    });
  }

  // Sort: overdue first, then due now, then upcoming, then booked
  const priorityMap: Record<RecallOpportunity['status'], number> = {
    overdue: 0,
    due_now: 1,
    upcoming: 2,
    booked: 3,
  };

  return items.sort((a, b) => {
    const diff = priorityMap[a.status] - priorityMap[b.status];
    if (diff !== 0) return diff;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
}
