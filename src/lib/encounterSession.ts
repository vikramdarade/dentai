/**
 * Phase 13A — Encounter Session Safety Core
 * =========================================
 *
 * The chairside workspace previously inlined every safety-critical transition
 * as component-local state mutations. This module extracts the deterministic
 * core so each invariant is unit-testable and every caller shares one
 * implementation:
 *
 *   1. Encounter lifecycle state machine (§11, §24) — explicit states and
 *      transitions; invalid transitions are rejected, never coerced.
 *      `Signed` is a persisted terminal attestation state, distinct from any
 *      "Completed"-style workflow flag (§11: Completed !== Signed).
 *
 *   2. The ONE canonical patient-switch transition (§6) with the focus
 *      invariant (§5, §8): while a clinical session is active — mic live,
 *      finalization in flight, or an immediate manual navigation — external
 *      roster events may suggest a patient but must never silently switch
 *      the active encounter.
 *
 *   3. Substantive-content resolution (§12): the decision "is there anything
 *      to finalize" must consider the server's canonical transcript, not
 *      only local browser buffers. Nothing is fabricated here; the module
 *      only reads what already exists.
 *
 *   4. Walk-in intake (§16–§18): collision-safe ids, no fabricated speech,
 *      explicit appointment type with a safe generic fallback.
 *
 *   5. Encounter ordering (§20): deterministic, tolerant of "9 AM",
 *      "09:00", "9:00 AM", with stable tie-breakers — never a sentinel that
 *      silently reorders the clinical day.
 *
 * Nothing in this module performs I/O. Network persistence, audio control
 * and React state ownership stay in the components/server; this module only
 * decides what a safe transition IS.
 */

import type { AppointmentType } from './dentalLibrary';
import type { TranscriptItem } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Lifecycle state machine (§11, §24)
// ─────────────────────────────────────────────────────────────────────────────

export type EncounterLifecycleState =
  | 'SCHEDULED'
  | 'IN_CHAIR'
  | 'FINALIZING'
  | 'READY'
  | 'FAILED'
  | 'SIGNED';

/**
 * Valid transitions. Absence of an edge means the transition is INVALID and
 * must be rejected (not silently coerced) — §24: `SIGNED → FINALIZING` and
 * `SIGNED → READY`-style regressions must not occur through normal client
 * operations.
 */
const VALID_TRANSITIONS: Record<EncounterLifecycleState, readonly EncounterLifecycleState[]> = {
  SCHEDULED: ['IN_CHAIR', 'FINALIZING'],
  IN_CHAIR: ['FINALIZING'],
  FINALIZING: ['READY', 'FAILED'],
  READY: ['SIGNED'],
  FAILED: ['FINALIZING'], // the retry edge — re-runs finalization after a visible failure
  // SIGNED is terminal. There is deliberately NO edge out of SIGNED: a signed
  // record cannot be re-finalized, re-generated or reverted through the
  // client. (§23: signed content is not silently editable.)
  SIGNED: [],
};

export type EncounterTransitionResult =
  | { ok: true; state: EncounterLifecycleState; from: EncounterLifecycleState }
  | { ok: false; from: EncounterLifecycleState; to: EncounterLifecycleState; reason: string };

export function encounterTransition(
  from: EncounterLifecycleState,
  to: EncounterLifecycleState
): EncounterTransitionResult {
  if (!(from in VALID_TRANSITIONS)) {
    return { ok: false, from, to, reason: `Unknown lifecycle state: ${from}` };
  }
  if (VALID_TRANSITIONS[from].includes(to)) {
    return { ok: true, state: to, from };
  }
  return {
    ok: false,
    from,
    to,
    reason: `Invalid encounter transition ${from} → ${to}. Allowed: ${VALID_TRANSITIONS[from].join(', ') || '(none — terminal state)'}`,
  };
}

/**
 * Projects the distributed signals the workspace holds (server record, local
 * buffers, client tracking sets) onto the lifecycle state machine. This is a
 * PROJECTION, not new authority: the server's persisted seal — when present —
 * is the only thing that can assert SIGNED (§22: the server stays the only
 * sign-off authority).
 */
export function projectLifecycleState(input: {
  /** True only when the SERVER record carries an attestation seal. */
  serverSealed: boolean;
  /** A durable finalization job is in flight for this consultation. */
  finalizing: boolean;
  /** The last finalization attempt for this consultation failed and is un-retried. */
  failed: boolean;
  /** A generated note exists on the server record. */
  hasGeneratedNote: boolean;
  /** The encounter is currently the active in-chair session. */
  isActiveEncounter: boolean;
  /** The encounter has a scheduled appointment time. */
  hasAppointment: boolean;
}): EncounterLifecycleState {
  if (input.serverSealed) return 'SIGNED';
  if (input.finalizing) return 'FINALIZING';
  if (input.failed) return 'FAILED';
  if (input.hasGeneratedNote) return 'READY';
  if (input.isActiveEncounter) return 'IN_CHAIR';
  return input.hasAppointment ? 'SCHEDULED' : 'IN_CHAIR';
}

/**
 * Strict Encounter Lifecycle: pure advancement guard predicate.
 * Determines whether the operatory workspace is permitted to navigate
 * away from the current patient (via Next, Prev, or Schedule).
 */
export function canAdvanceEncounter(opts: {
  encounterState: 'empty' | 'active' | 'finished';
  isEncounterSealedOrDone: boolean;
  recordingSeconds: number;
  isMicStandby: boolean;
  hasEditedNotes: boolean;
  hasTranscript: boolean;
}): boolean {
  return Boolean(
    opts.encounterState === 'finished' ||
    opts.isEncounterSealedOrDone ||
    (
      opts.recordingSeconds === 0 &&
      opts.isMicStandby &&
      !opts.hasEditedNotes &&
      !opts.hasTranscript
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Canonical patient-switch transition (§5, §6, §7, §8, §21)
// ─────────────────────────────────────────────────────────────────────────────

export type PatientSwitchSource =
  | 'card-click'
  | 'keyboard-next'
  | 'keyboard-previous'
  | 'walk-in-creation'
  | 'initial-selection'
  | 'completion-advance';

/**
 * The exact failure mode Phase 13A §4 exists to kill. When a switch is
 * requested by anything OTHER than an explicit clinician action, and a
 * clinical session is live, the request must be refused as a suggestion.
 */
export type PatientSwitchRefusal =
  | 'external-focus-lock' // session active + non-manual source
  | 'already-active';

export type PatientSwitchDecision =
  | {
      ok: true;
      targetPatientId: string;
      /** Side effects the single caller must perform, in order. */
      effects: {
        /** §7: keyboard navigation establishes the manual-selection lock. */
        markManuallySelected: boolean;
        /** A recording session must be torn down at the boundary. */
        teardownActiveSession: boolean;
      };
    }
  | { ok: false; refusal: PatientSwitchRefusal; targetPatientId: string };

export function decidePatientSwitch(input: {
  source: PatientSwitchSource | 'external-poll' | 'auto-focus';
  targetPatientId: string;
  activePatientId: string;
  /** A clinical session is live: mic recording, or finalization in flight. */
  sessionActive: boolean;
}): PatientSwitchDecision {
  const { source, targetPatientId, activePatientId, sessionActive } = input;

  if (targetPatientId === activePatientId) {
    return { ok: false, refusal: 'already-active', targetPatientId };
  }

  // Manual sources always win — the clinician is the authority over which
  // patient is on screen, including mid-session (the switch itself tears the
  // session down; see handleSelectPatient).
  const manualSources: readonly (PatientSwitchSource)[] = [
    'card-click',
    'keyboard-next',
    'keyboard-previous',
    'walk-in-creation',
    'initial-selection',
    'completion-advance',
  ];
  if (manualSources.includes(source as PatientSwitchSource)) {
    return {
      ok: true,
      targetPatientId,
      effects: {
        // §7: keyboard navigation counts as manual selection — same lock a
        // card click establishes.
        markManuallySelected: true,
        teardownActiveSession: true,
      },
    };
  }

  // External poll / auto-focus: only ever a SUGGESTION while a session is
  // live (§5, §8). The caller surfaces a badge/notification instead.
  if (sessionActive) {
    return { ok: false, refusal: 'external-focus-lock', targetPatientId };
  }

  return {
    ok: true,
    targetPatientId,
    effects: { markManuallySelected: false, teardownActiveSession: false },
  };
}

/** True when the given source is an external (non-clinician) suggestion. */
export function isExternalSwitchSource(
  source: PatientSwitchSource | 'external-poll' | 'auto-focus'
): boolean {
  return source === 'external-poll' || source === 'auto-focus';
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Substantive content (§12) — server transcript must count
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes any transcript item shape actually present in the codebase
 * ({sender,text} | {role,text} | {speaker,text} | diarizedTranscript rows)
 * into a canonical {sender, text} pair. Never invents a line.
 */
export function normalizeTranscriptItem(raw: unknown): TranscriptItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;
  const senderRaw = String(r.sender ?? r.role ?? r.speaker ?? 'Dialogue').toLowerCase();
  const sender: TranscriptItem['sender'] = senderRaw.includes('patient')
    ? 'Patient'
    : senderRaw.includes('dentist') || senderRaw.includes('clinician')
      ? 'Dentist'
      : 'Dialogue';
  return { sender, text };
}

export function normalizeTranscript(items: readonly unknown[] | undefined): TranscriptItem[] {
  if (!Array.isArray(items)) return [];
  const out: TranscriptItem[] = [];
  for (const raw of items) {
    const normalized = normalizeTranscriptItem(raw);
    if (normalized) out.push(normalized);
  }
  return out;
}

export interface SubstantiveContentInput {
  /** Local browser live-transcript buffers (per consultation id). */
  localTranscript: readonly unknown[] | undefined;
  /** The SERVER's canonical transcript for this consultation. */
  serverTranscript: readonly unknown[] | undefined;
  /** Server-persisted diarized transcript from recorded audio. */
  serverDiarizedTranscript: readonly unknown[] | undefined;
  /** Generated/edited note text already held for this consultation. */
  noteText: string | undefined;
  /** Clinical findings already on the server record. */
  hasExistingFindings: boolean;
  /** A durable finalization job exists/ran for this consultation. */
  finalizationPending: boolean;
}

export type SubstantiveContentReason =
  | 'local-transcript'
  | 'server-transcript'
  | 'server-diarized-transcript'
  | 'note-text'
  | 'existing-findings'
  | 'finalization-pending';

export type SubstantiveContentDecision = {
  substantive: boolean;
  reasons: SubstantiveContentReason[];
  /** Canonicalized local transcript, for the immutable snapshot. */
  localSnapshot: TranscriptItem[];
};

/**
 * Decides whether an encounter holds clinical content worth finalizing.
 * §12: the SERVER transcript counts — a record whose dialogue lives only
 * server-side (recording uploaded, transcription persisted) must never be
 * dismissed as "nothing captured" by a client that cannot see it.
 */
export function resolveSubstantiveContent(input: SubstantiveContentInput): SubstantiveContentDecision {
  const reasons: SubstantiveContentReason[] = [];
  const localSnapshot = normalizeTranscript(input.localTranscript);

  if (localSnapshot.length > 0) reasons.push('local-transcript');
  if (normalizeTranscript(input.serverTranscript).length > 0) reasons.push('server-transcript');
  if (normalizeTranscript(input.serverDiarizedTranscript).length > 0) reasons.push('server-diarized-transcript');
  if (typeof input.noteText === 'string' && input.noteText.trim().length > 0) reasons.push('note-text');
  if (input.hasExistingFindings) reasons.push('existing-findings');
  if (input.finalizationPending) reasons.push('finalization-pending');

  return { substantive: reasons.length > 0, reasons, localSnapshot };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Walk-in intake (§16–§18)
// ─────────────────────────────────────────────────────────────────────────────

export type SafeWalkInAppointmentType = 'examination' | 'scale_clean' | 'emergency';

/** The safest generic intake configuration when no type is selected (§18). */
export const WALK_IN_FALLBACK_TYPE: SafeWalkInAppointmentType = 'examination';
/** Template for the safe generic fallback — the standard AHPRA intake schema. */
export const WALK_IN_FALLBACK_TEMPLATE = 'standard';
/** Template actually shaped for emergency triage, used only when emergency is explicit. */
export const WALK_IN_EMERGENCY_TEMPLATE = 'soap';

export interface WalkInIntakeInput {
  patientName: string;
  dob?: string;
  /** 'examination' unless the clinician explicitly selected otherwise. */
  appointmentType?: AppointmentType;
  /** Normalized display time ("Now (3:45 pm)" / "3:45 pm" / "15:45"). */
  time: string;
  operatory?: string;
  /** Chief complaint as actually stated by the patient. Optional. */
  chiefComplaint?: string;
  /** Collision-safe id generator (crypto.randomUUID in secure contexts). */
  newId: () => string;
}

export interface WalkInIntake {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  appointmentType: AppointmentType;
  templateId: string;
  time: string;
  operatory: string;
  chiefComplaint: string;
  /** Encounter metadata — provenance, NOT transcript content (§17). */
  intakeNote: string;
  /** Empty by construction: speech belongs in the transcript only when captured (§17). */
  transcript: [];
}

/**
 * Builds the walk-in encounter configuration.
 *
 * §16: id comes from the collision-safe generator (crypto.randomUUID), never
 * `Date.now()` — two browsers in the same millisecond must not collide, and a
 * UUID consultation id also enables the durable job queue's
 * job-id = consultation-id convergence.
 *
 * §17: NO fabricated transcript line. What used to be seeded as Dentist
 * dialogue ("Emergency walk-in encounter started for X…") is carried as
 * `intakeNote` metadata instead.
 *
 * §18: emergency is used ONLY when explicitly selected; otherwise the safest
 * generic intake (examination/standard) applies. The type drives metadata and
 * template selection — it never fabricates clinical findings.
 */
/**
 * Collision-safe walk-in encounter id (§16).
 *
 * `walkin-${Date.now()}` collides when two browsers add a walk-in in the same
 * millisecond (or when a double-click races), and a non-UUID id additionally
 * breaks the durable job queue's job-id = consultation-id convergence. A
 * randomUUID keeps both properties; the insecure-context fallback adds a
 * strong random component rather than relying on the clock alone.
 */
export function generateWalkInId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return `walkin-${crypto.randomUUID()}`;
    } catch {
      // Insecure context — fall through to the entropy-carrying fallback.
    }
  }
  return `walkin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function buildWalkInIntake(input: WalkInIntakeInput): WalkInIntake {
  const name = input.patientName.trim();
  if (!name) throw new Error('Walk-in requires a patient name.');
  const parts = name.split(/\s+/);
  const firstName = parts[0] || 'Patient';
  const lastName = parts.slice(1).join(' ') || '';

  // Only an explicitly-chosen emergency keeps emergency triage semantics.
  // Everything else — including an absent selection — is the safe generic
  // intake. Never guess "emergency" from the mere existence of a complaint.
  const isExplicitEmergency = input.appointmentType === 'emergency';
  const appointmentType: AppointmentType = isExplicitEmergency
    ? 'emergency'
    : input.appointmentType ?? WALK_IN_FALLBACK_TYPE;
  const templateId = isExplicitEmergency
    ? WALK_IN_EMERGENCY_TEMPLATE
    : WALK_IN_FALLBACK_TEMPLATE;

  return {
    id: input.newId(),
    firstName,
    lastName,
    dob: input.dob?.trim() ?? '',
    appointmentType,
    templateId,
    time: input.time,
    operatory: input.operatory ?? 'Room 1',
    chiefComplaint: input.chiefComplaint?.trim() ?? '',
    intakeNote: `Walk-in encounter created at intake for ${firstName} ${lastName}`.trim(),
    transcript: [],
  };
}

/**
 * True when an appointment type should drive an emergency-shaped clinical
 * extraction. Only an explicit emergency qualifies — the guard §18 asks for.
 */
export function isEmergencyIntake(appointmentType: AppointmentType | undefined): boolean {
  return appointmentType === 'emergency';
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Ordering (§20)
// ─────────────────────────────────────────────────────────────────────────────

export interface EncounterTimeFields {
  time?: string;
  createdAt?: string;
  id?: string;
  patientName?: string;
}

/**
 * Tolerant time parser: "9 AM", "9 AM (Expected)", "09:00", "9:00 AM",
 * "9:00am", "14:00", "1:15 PM" all resolve to minutes-from-midnight.
 *
 * §20: an unparsable time is UNKNOWN, not "end of day". Unknowns sort after
 * all KNOWN times (preserving the legacy behaviour for well-formed inputs)
 * but among themselves by the same stable tie-breakers, and a known-vs-unknown
 * comparison is stable rather than degenerate. The legacy 9999 sentinel is
 * retained only as the unknown marker so existing persisted schedules keep
 * their relative order.
 */
export function parseEncounterTimeMinutes(timeStr: string | undefined): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  // NOTE: no paren-stripping. Walk-in times wrap the REAL time in decoration
  // — "Now (3:45 pm)" — so the parentheses must be searched, not removed.
  // The patterns below are specific enough (digits + colon/meridian) that
  // decoration text like "(Expected)" cannot false-positive.
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?|(\d{1,2})\s*(am|pm)/i);
  if (!match) return null;
  if (match[1] !== undefined) {
    let hour = parseInt(match[1], 10);
    const min = parseInt(match[2], 10);
    if (hour > 23 || min > 59) return null;
    const meridian = match[3]?.toLowerCase();
    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    return hour * 60 + min;
  }
  // Hour-only with meridian: "9 AM"
  let hour = parseInt(match[4], 10);
  const meridian = match[5]?.toLowerCase();
  if (Number.isNaN(hour) || hour < 1 || hour > 12) return null;
  if (meridian === 'pm' && hour < 12) hour += 12;
  if (meridian === 'am' && hour === 12) hour = 0;
  return hour * 60;
}

/** Unknown-time marker: sorts after every known time. */
export const ENCOUNTER_TIME_UNKNOWN = 9999;

export function encounterSortKey(item: EncounterTimeFields): number {
  const parsed = parseEncounterTimeMinutes(item.time);
  return parsed === null ? ENCOUNTER_TIME_UNKNOWN : parsed;
}

/**
 * Deterministic encounter ordering:
 *   normalized appointment time → createdAt → stable id/name.
 *
 * Ties (double-bookings, identical times) resolve by createdAt (earlier record
 * first — the day's original book order), then by id, then by patient name, so
 * next/prev navigation order is identical across browsers and reloads.
 */
export function compareEncounters<T extends EncounterTimeFields>(a: T, b: T): number {
  const ta = encounterSortKey(a);
  const tb = encounterSortKey(b);
  if (ta !== tb) return ta - tb;

  const ca = a.createdAt ? Date.parse(a.createdAt) : NaN;
  const cb = b.createdAt ? Date.parse(b.createdAt) : NaN;
  if (Number.isFinite(ca) && Number.isFinite(cb) && ca !== cb) return ca - cb;
  // One-sided or invalid createdAt must not flip order between renders.
  if (Number.isFinite(ca) !== Number.isFinite(cb)) return 0;

  const na = (a.patientName ?? '').toLowerCase();
  const nb = (b.patientName ?? '').toLowerCase();
  if (na !== nb) return na.localeCompare(nb);

  return (a.id ?? '').localeCompare(b.id ?? '');
}

export function sortEncounters<T extends EncounterTimeFields>(items: readonly T[]): T[] {
  return [...items].sort(compareEncounters);
}
