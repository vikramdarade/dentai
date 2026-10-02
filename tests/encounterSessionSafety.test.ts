/**
 * Phase 13A — Encounter Session Safety (deterministic core).
 *
 * Covers the extracted invariants in src/lib/encounterSession.ts:
 *   - lifecycle state machine: valid transitions succeed, invalid are rejected
 *     (SIGNED is terminal; Completed !== Signed)
 *   - patient switching: one canonical gate; keyboard = manual selection;
 *     external events can NEVER hijack an active session (P0 §4/§5/§7/§8)
 *   - substantive content: the SERVER transcript counts (§12); nothing is
 *     fabricated
 *   - walk-in provenance: collision-safe ids, no fabricated speech, explicit
 *     appointment type with a safe generic fallback (§16–§18)
 *   - ordering: tolerant time parsing, deterministic tie-breakers (§20)
 *
 * The wrong-patient invariant of §21 (active == transcription target ==
 * finalization target == sign-off target) is enforced by ALL callers routing
 * through `decidePatientSwitch`; the gate tests pin the switch semantics that
 * make the invariant hold.
 */
import { describe, it, expect } from 'vitest';
import {
  encounterTransition,
  projectLifecycleState,
  decidePatientSwitch,
  resolveSubstantiveContent,
  buildWalkInIntake,
  generateWalkInId,
  compareEncounters,
  parseEncounterTimeMinutes,
  sortEncounters,
  canAdvanceEncounter,
} from '../src/lib/encounterSession';

describe('Phase 13A — encounter lifecycle state machine (§11, §24)', () => {
  it('accepts the canonical forward path SCHEDULED → IN_CHAIR → FINALIZING → READY → SIGNED', () => {
    expect(encounterTransition('SCHEDULED', 'IN_CHAIR').ok).toBe(true);
    expect(encounterTransition('IN_CHAIR', 'FINALIZING').ok).toBe(true);
    expect(encounterTransition('FINALIZING', 'READY').ok).toBe(true);
    expect(encounterTransition('READY', 'SIGNED').ok).toBe(true);
  });

  it('allows FINALIZING → FAILED and FAILED → FINALIZING (the retry edge)', () => {
    expect(encounterTransition('FINALIZING', 'FAILED').ok).toBe(true);
    expect(encounterTransition('FAILED', 'FINALIZING').ok).toBe(true);
  });

  it('rejects SIGNED → FINALIZING: a signed record cannot be re-finalized', () => {
    const result = encounterTransition('SIGNED', 'FINALIZING');
    expect(result.ok).toBe(false);
    // This project compiles without strictNullChecks — no union narrowing;
    // explicit member checks (codebase pattern).
    expect((result as { reason?: string }).reason).toContain('SIGNED');
  });

  it('rejects SIGNED → READY and SCHEDULED → SIGNED (sign-off requires the review chain)', () => {
    expect(encounterTransition('SIGNED', 'READY').ok).toBe(false);
    expect(encounterTransition('SCHEDULED', 'SIGNED').ok).toBe(false);
  });

  it('treats SIGNED as terminal — no transition out of it', () => {
    for (const to of ['SCHEDULED', 'IN_CHAIR', 'FINALIZING', 'READY', 'FAILED', 'SIGNED'] as const) {
      if (to === 'SIGNED') continue;
      expect(encounterTransition('SIGNED', to).ok).toBe(false);
    }
  });

  it('projects SIGNED only from the SERVER-persisted seal', () => {
    expect(projectLifecycleState({
      serverSealed: true, finalizing: false, failed: false,
      hasGeneratedNote: true, isActiveEncounter: true, hasAppointment: true,
    })).toBe('SIGNED');
    // A generated note WITHOUT the server seal is READY, never Signed —
    // workflow completion must not masquerade as attestation (§11).
    expect(projectLifecycleState({
      serverSealed: false, finalizing: false, failed: false,
      hasGeneratedNote: true, isActiveEncounter: false, hasAppointment: true,
    })).toBe('READY');
    expect(projectLifecycleState({
      serverSealed: false, finalizing: true, failed: false,
      hasGeneratedNote: false, isActiveEncounter: true, hasAppointment: true,
    })).toBe('FINALIZING');
    expect(projectLifecycleState({
      serverSealed: false, finalizing: false, failed: true,
      hasGeneratedNote: false, isActiveEncounter: false, hasAppointment: true,
    })).toBe('FAILED');
  });
});

describe('Phase 13A — patient switching focus invariant (§4–§8)', () => {
  const base = { targetPatientId: 'p2', activePatientId: 'p1', sessionActive: true };

  it('refuses an external poll switch while a session is active — the P0 hijack', () => {
    const decision = decidePatientSwitch({ ...base, source: 'external-poll' });
    expect(decision.ok).toBe(false);
    expect((decision as { refusal?: string }).refusal).toBe('external-focus-lock');
  });

  it('refuses an auto-focus switch while a session is active', () => {
    const decision = decidePatientSwitch({ ...base, source: 'auto-focus' });
    expect(decision.ok).toBe(false);
  });

  it('allows an external switch ONLY when no session is active (idle roster self-healing)', () => {
    const decision = decidePatientSwitch({ ...base, sessionActive: false, source: 'external-poll' });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.effects.markManuallySelected).toBe(false);
  });

  it('keyboard-next counts as MANUAL selection (§7)', () => {
    const decision = decidePatientSwitch({ ...base, source: 'keyboard-next' });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.effects.markManuallySelected).toBe(true);
      expect(decision.effects.teardownActiveSession).toBe(true);
    }
  });

  it('keyboard-previous also counts as manual selection', () => {
    const decision = decidePatientSwitch({ ...base, source: 'keyboard-previous' });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.effects.markManuallySelected).toBe(true);
  });

  it('card clicks remain manual and always win, even mid-session', () => {
    const decision = decidePatientSwitch({ ...base, source: 'card-click' });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.effects.markManuallySelected).toBe(true);
  });

  it('refuses a switch to the already-active patient', () => {
    const decision = decidePatientSwitch({
      source: 'card-click', targetPatientId: 'p1', activePatientId: 'p1', sessionActive: false,
    });
    expect(decision.ok).toBe(false);
    expect((decision as { refusal?: string }).refusal).toBe('already-active');
  });

  it('walk-in creation and initial selection are manual sources', () => {
    expect(decidePatientSwitch({ ...base, source: 'walk-in-creation' }).ok).toBe(true);
    expect(decidePatientSwitch({ ...base, source: 'initial-selection' }).ok).toBe(true);
  });
});

describe('Phase 13A — substantive content resolution (§12)', () => {
  it('counts the SERVER transcript as substantive content', () => {
    const decision = resolveSubstantiveContent({
      localTranscript: [],
      serverTranscript: [{ sender: 'Dentist', text: 'Scale and clean of quadrant 1 today.' }],
      serverDiarizedTranscript: undefined,
      noteText: '',
      hasExistingFindings: false,
      finalizationPending: false,
    });
    expect(decision.substantive).toBe(true);
    expect(decision.reasons).toContain('server-transcript');
  });

  it('counts a server-diarized transcript (recording transcribed server-side)', () => {
    const decision = resolveSubstantiveContent({
      localTranscript: [],
      serverTranscript: [],
      serverDiarizedTranscript: [{ role: 'patient', text: 'It aches when I chew.' }],
      noteText: '',
      hasExistingFindings: false,
      finalizationPending: false,
    });
    expect(decision.substantive).toBe(true);
    expect(decision.reasons).toContain('server-diarized-transcript');
  });

  it('reports NOT substantive when every source is genuinely empty', () => {
    const decision = resolveSubstantiveContent({
      localTranscript: [],
      serverTranscript: [],
      serverDiarizedTranscript: [],
      noteText: '   ',
      hasExistingFindings: false,
      finalizationPending: false,
    });
    expect(decision.substantive).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it('normalizes role/speaker shapes without inventing content', () => {
    const decision = resolveSubstantiveContent({
      localTranscript: [{ role: 'patient', text: '  ' }, { speaker: 'dentist', text: 'Open wide.' }],
      serverTranscript: undefined,
      serverDiarizedTranscript: undefined,
      noteText: undefined,
      hasExistingFindings: false,
      finalizationPending: false,
    });
    // The blank line is dropped, the spoken one is kept verbatim.
    expect(decision.localSnapshot).toEqual([{ sender: 'Dentist', text: 'Open wide.' }]);
  });

  it('treats an in-flight finalization as content (never re-decides from empty buffers)', () => {
    const decision = resolveSubstantiveContent({
      localTranscript: [],
      serverTranscript: [],
      serverDiarizedTranscript: [],
      noteText: '',
      hasExistingFindings: false,
      finalizationPending: true,
    });
    expect(decision.substantive).toBe(true);
    expect(decision.reasons).toContain('finalization-pending');
  });
});

describe('Phase 13A — walk-in provenance (§16–§18)', () => {
  it('generates collision-safe UUID walk-in ids (never Date.now())', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateWalkInId()));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^walkin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('seeds NO fabricated transcript line (§17)', () => {
    const intake = buildWalkInIntake({
      patientName: 'John Smith', time: '3:45 pm', chiefComplaint: 'Broken tooth',
      newId: () => 'walkin-test-1',
    });
    expect(intake.transcript).toEqual([]);
    // The provenance note is metadata, not dialogue.
    expect(intake.intakeNote).toContain('Walk-in encounter created at intake');
    expect(intake.intakeNote).not.toContain('started for');
  });

  it('does not fabricate a chief complaint when none was given', () => {
    const intake = buildWalkInIntake({ patientName: 'Jane Doe', time: '14:00', newId: () => 'walkin-test-2' });
    expect(intake.chiefComplaint).toBe('');
  });

  it('uses the SAFE GENERIC intake when no type is selected (§18)', () => {
    const intake = buildWalkInIntake({ patientName: 'Jane Doe', time: '14:00', newId: () => 'walkin-3' });
    expect(intake.appointmentType).toBe('examination');
    expect(intake.templateId).toBe('standard');
  });

  it('applies emergency triage ONLY when explicitly selected', () => {
    const intake = buildWalkInIntake({
      patientName: 'Jane Doe', time: '14:00', appointmentType: 'emergency', newId: () => 'walkin-4',
    });
    expect(intake.appointmentType).toBe('emergency');
    expect(intake.templateId).toBe('soap');
  });

  it('a non-emergency explicit type keeps its own template semantics', () => {
    const intake = buildWalkInIntake({
      patientName: 'Jane Doe', time: '14:00', appointmentType: 'scale_clean', newId: () => 'walkin-5',
    });
    expect(intake.appointmentType).toBe('scale_clean');
    expect(intake.templateId).toBe('standard');
  });

  it('splits names deterministically and never invents a surname', () => {
    const single = buildWalkInIntake({ patientName: 'Madonna', time: '14:00', newId: () => 'walkin-6' });
    expect(single.firstName).toBe('Madonna');
    expect(single.lastName).toBe('');
  });
});

describe('Phase 13A — encounter ordering (§20)', () => {
  it('parses "9 AM", "09:00" and "9:00 AM" to the same minute-of-day', () => {
    expect(parseEncounterTimeMinutes('9 AM')).toBe(540);
    expect(parseEncounterTimeMinutes('09:00')).toBe(540);
    expect(parseEncounterTimeMinutes('9:00 AM')).toBe(540);
    expect(parseEncounterTimeMinutes('9:00am')).toBe(540);
  });

  it('parses 12-hour and 24-hour afternoon forms, including decorated walk-in times', () => {
    expect(parseEncounterTimeMinutes('1:15 PM')).toBe(795);
    expect(parseEncounterTimeMinutes('14:00')).toBe(840);
    expect(parseEncounterTimeMinutes('Now (3:45 pm)')).toBe(945);
    expect(parseEncounterTimeMinutes('12:00 AM')).toBe(0);
    expect(parseEncounterTimeMinutes('12:30 PM')).toBe(750);
  });

  it('orders 9 AM before 10 AM and treats unknown times as unknown, not end-of-day', () => {
    const items = [
      { id: 'b', time: 'Unknown', patientName: 'Zed' },
      { id: 'a', time: '10 AM', patientName: 'Amy' },
      { id: 'c', time: '9 AM', patientName: 'Bob' },
    ];
    const sorted = sortEncounters(items);
    expect(sorted.map(i => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('unknown times order deterministically among themselves', () => {
    const items = [
      { id: 'x2', time: '????', patientName: 'Lee' },
      { id: 'x1', time: '????', patientName: 'Lee' },
    ];
    const sorted = sortEncounters(items);
    expect(sorted.map(i => i.id)).toEqual(['x1', 'x2']);
  });

  it('ties at the same time resolve deterministically by createdAt then name', () => {
    const tied = [
      { id: 'b', time: '09:00', patientName: 'Zed', createdAt: '2026-09-27T02:00:00Z' },
      { id: 'a', time: '09:00', patientName: 'Amy', createdAt: '2026-09-27T03:00:00Z' },
      { id: 'c', time: '09:00', patientName: 'Amy', createdAt: '2026-09-27T01:00:00Z' },
    ];
    const sorted = sortEncounters(tied);
    // createdAt wins first (day-book order): c (01:00) → b (02:00) → a (03:00).
    expect(sorted.map(i => i.id)).toEqual(['c', 'b', 'a']);
    expect(compareEncounters(sorted[0], sorted[0])).toBe(0);
  });

  it('is a pure function — the input array is never mutated', () => {
    const items = [{ id: 'b', time: '10 AM' }, { id: 'a', time: '9 AM' }];
    const snapshot = [...items];
    sortEncounters(items);
    expect(items).toEqual(snapshot);
  });
});

describe('Strict Encounter Lifecycle: Operatory Advance & Guard Policy', () => {
  it('allows advancement when encounter is explicitly finished', () => {
    expect(canAdvanceEncounter({
      encounterState: 'finished',
      isEncounterSealedOrDone: false,
      recordingSeconds: 45,
      isMicStandby: true,
      hasEditedNotes: true,
      hasTranscript: true,
    })).toBe(true);
  });

  it('allows advancement when record is sealed on server or done', () => {
    expect(canAdvanceEncounter({
      encounterState: 'active',
      isEncounterSealedOrDone: true,
      recordingSeconds: 120,
      isMicStandby: true,
      hasEditedNotes: true,
      hasTranscript: true,
    })).toBe(true);
  });

  it('strictly locks advancement when encounter is active and audio or notes exist', () => {
    // Actively recording
    expect(canAdvanceEncounter({
      encounterState: 'active',
      isEncounterSealedOrDone: false,
      recordingSeconds: 15,
      isMicStandby: false,
      hasEditedNotes: false,
      hasTranscript: true,
    })).toBe(false);

    // Audio recorded, stopped to standby, but encounter not finished
    expect(canAdvanceEncounter({
      encounterState: 'active',
      isEncounterSealedOrDone: false,
      recordingSeconds: 60,
      isMicStandby: true,
      hasEditedNotes: false,
      hasTranscript: true,
    })).toBe(false);

    // Manual edits made in editor
    expect(canAdvanceEncounter({
      encounterState: 'active',
      isEncounterSealedOrDone: false,
      recordingSeconds: 0,
      isMicStandby: true,
      hasEditedNotes: true,
      hasTranscript: false,
    })).toBe(false);
  });

  it('allows advancement when visit was opened but untouched (0s, clean slate)', () => {
    expect(canAdvanceEncounter({
      encounterState: 'active',
      isEncounterSealedOrDone: false,
      recordingSeconds: 0,
      isMicStandby: true,
      hasEditedNotes: false,
      hasTranscript: false,
    })).toBe(true);
  });
});

