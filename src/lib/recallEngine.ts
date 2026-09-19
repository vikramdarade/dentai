/**
 * Recall Worklist Engine.
 *
 * Converts clinical consultation findings (`recallRequirements`) into actionable
 * recall due dates, categorization (routine hygiene vs periodontal vs urgent review),
 * and personalized patient outreach messaging.
 */

import { Consultation } from '../types';

export interface RecallDueDateResult {
  dueDateIso: string;
  intervalMonths: number;
  urgency: 'routine' | 'periodontal' | 'urgent';
}

export interface RecallOpportunity {
  id: string;
  consultationId: string;
  patientName: string;
  dentistId: string;
  clinicId?: string;
  consultationDate: string;
  recallInterval: string;
  dueDate: string;
  urgency: 'routine' | 'periodontal' | 'urgent';
  status: 'overdue' | 'due_now' | 'upcoming';
  suggestedMessage: string;
}

/**
 * Calculates a precise recall due date from a consultation date and recall requirement string.
 */
export function calculateRecallDueDate(
  consultationDateIso: string,
  recallRequirements?: string
): RecallDueDateResult {
  const baseDate = new Date(consultationDateIso);
  const validDate = isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const lower = (recallRequirements || '').toLowerCase().trim();

  let intervalMonths = 6;
  let urgency: 'routine' | 'periodontal' | 'urgent' = 'routine';

  if (lower.includes('urgent') || lower.includes('next available') || lower.includes('week')) {
    intervalMonths = 0.5; // ~14 days
    urgency = 'urgent';
  } else if (lower.includes('3 month') || lower.includes('perio') || lower.includes('periodontal')) {
    intervalMonths = 3;
    urgency = 'periodontal';
  } else if (lower.includes('12 month') || lower.includes('annual')) {
    intervalMonths = 12;
    urgency = 'routine';
  } else {
    intervalMonths = 6;
    urgency = 'routine';
  }

  const targetDate = new Date(validDate.getTime());
  if (intervalMonths === 0.5) {
    targetDate.setDate(targetDate.getDate() + 14);
  } else {
    targetDate.setMonth(targetDate.getMonth() + intervalMonths);
  }

  return {
    dueDateIso: targetDate.toISOString(),
    intervalMonths,
    urgency,
  };
}

/**
 * Derives a clean status ('overdue' | 'due_now' | 'upcoming') given a target due date
 * relative to a reference date (defaults to now).
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
 * Extracts and normalizes recall opportunities from a list of clinical consultations.
 */
export function extractRecallItems(
  consultations: Consultation[],
  referenceDateIso?: string
): RecallOpportunity[] {
  const items: RecallOpportunity[] = [];

  for (const c of consultations) {
    const rawReq = c.findings?.recallRequirements || '6 Months (Standard)';
    const patientName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Patient';
    const consultationDate = c.createdAt || c.date || new Date().toISOString();

    const { dueDateIso, intervalMonths, urgency } = calculateRecallDueDate(
      consultationDate,
      rawReq
    );
    const status = determineRecallStatus(dueDateIso, referenceDateIso);

    const typeDesc =
      urgency === 'periodontal'
        ? 'periodontal maintenance review'
        : urgency === 'urgent'
        ? 'urgent follow-up consultation'
        : `${intervalMonths}-month preventative hygiene check`;

    const suggestedMessage = `Hi ${c.firstName || 'there'}, it is time for your ${typeDesc} as planned during your recent dental visit. Please reply or contact the practice to reserve your chair time.`;

    items.push({
      id: `${c.id}-recall`,
      consultationId: c.id,
      patientName,
      dentistId: c.dentistId || '',
      clinicId: c.clinicId,
      consultationDate,
      recallInterval: rawReq,
      dueDate: dueDateIso,
      urgency,
      status,
      suggestedMessage,
    });
  }

  // Sort: overdue first, then due now, then upcoming
  const priorityMap = { overdue: 0, due_now: 1, upcoming: 2 };
  return items.sort((a, b) => {
    const diff = priorityMap[a.status] - priorityMap[b.status];
    if (diff !== 0) return diff;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
}
