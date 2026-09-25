import { describe, it, expect } from 'vitest';
import {
  canStartChairsideRecording,
  canCommitToChart
} from '../src/lib/draftEngine';

describe('Chairside Ergonomics: Zero-Touch & Deferred Intake Policy', () => {
  it('allows audio capture to initiate immediately without pre-selecting patient or type', () => {
    // When clinician steps into operatory and steps on foot pedal (Spacebar)
    const state = { isRecording: false, patientId: null };
    expect(canStartChairsideRecording(state)).toBe(true);

    const recordingState = { isRecording: true, patientId: null };
    expect(canStartChairsideRecording(recordingState)).toBe(false);
  });

  it('prohibits committing note to permanent chart when patientId is missing', () => {
    const unassignedState = {
      noteText: 'Restoration completed on tooth 46 MOD.',
      patientId: null
    };
    expect(canCommitToChart(unassignedState)).toBe(false);

    const emptyIdState = {
      noteText: 'Restoration completed on tooth 46 MOD.',
      patientId: '   '
    };
    expect(canCommitToChart(emptyIdState)).toBe(false);
  });

  it('permits committing note to permanent chart when valid patient is assigned', () => {
    const assignedState = {
      noteText: 'Restoration completed on tooth 46 MOD.',
      patientId: 'patient-4091'
    };
    expect(canCommitToChart(assignedState)).toBe(true);
  });
});
