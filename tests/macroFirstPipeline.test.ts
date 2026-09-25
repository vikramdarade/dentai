import { describe, it, expect } from 'vitest';
import {
  prefillMacroSlots,
  canSignDeterministicNote,
  type DeterministicClinicalNote
} from '../src/lib/draftEngine';
import { TranscriptItem } from '../src/types';

describe('Deterministic Macro Slot-Filling & Provenance Engine (Zero-AI)', () => {
  it('deterministically populates teeth, surfaces, anaesthetic, and materials from transcript', () => {
    const transcript: TranscriptItem[] = [
      { sender: 'Dentist', text: 'Today restoring tooth 46 MOD composite restoration using Filtek A2.' },
      { sender: 'Dentist', text: 'Administered 2.2ml Articaine 4% with 1:100,000 adrenaline via infiltration.' },
      { sender: 'Dentist', text: 'Verbal consent confirmed. Post-op instructions given.' }
    ];

    const result: DeterministicClinicalNote = prefillMacroSlots(transcript, 'restorative');

    expect(result.fields.toothNumber.value).toBe('46');
    expect(result.fields.toothNumber.confidence).toBe('verified');
    expect(result.fields.surfaces.value).toBe('MOD');
    expect(result.fields.surfaces.confidence).toBe('verified');
    expect(result.fields.anaesthetic.value).toContain('Articaine');
    expect(result.fields.anaesthetic.confidence).toBe('verified');
    expect(result.fields.treatmentPerformed.value).toContain('46');
    expect(result.fields.treatmentPerformed.confidence).toBe('verified');
    expect(result.adaCodes.length).toBeGreaterThan(0);
  });

  it('leaves unvoiced fields blank with confidence=missing', () => {
    const transcript: TranscriptItem[] = [
      { sender: 'Dentist', text: 'Routine exam, soft tissues healthy.' }
    ];

    const result = prefillMacroSlots(transcript, 'examination');

    expect(result.fields.toothNumber.value).toBe('');
    expect(result.fields.toothNumber.confidence).toBe('missing');
    expect(result.fields.anaesthetic.value).toBe('');
    expect(result.fields.anaesthetic.confidence).toBe('missing');
  });

  it('attaches exact transcript excerpt as provenance quote to verified fields', () => {
    const transcript: TranscriptItem[] = [
      { sender: 'Dentist', text: 'Administered 1 cartridge of 4% articaine with adrenaline.' }
    ];

    const result = prefillMacroSlots(transcript, 'restorative');

    expect(result.fields.anaesthetic.provenanceQuote).toBeDefined();
    expect(result.fields.anaesthetic.provenanceQuote?.toLowerCase()).toContain('articaine');
  });

  it('is 100% deterministic (character-for-character identical across repeated executions)', () => {
    const transcript: TranscriptItem[] = [
      { sender: 'Dentist', text: 'Extraction of tooth 38 due to recurrent pericoronitis, sutured with 3-0 vicryl.' },
      { sender: 'Dentist', text: 'Post-operative instructions given, soft diet and warm saline mouthwash.' }
    ];

    const run1 = prefillMacroSlots(transcript, 'surgical');
    const run2 = prefillMacroSlots(transcript, 'surgical');

    expect(run1).toEqual(run2);
  });

  it('guards sign-off when mandatory clinical fields are missing', () => {
    const emptyTranscript: TranscriptItem[] = [];
    const emptyResult = prefillMacroSlots(emptyTranscript, 'restorative');

    expect(canSignDeterministicNote(emptyResult)).toBe(false);

    const completeTranscript: TranscriptItem[] = [
      { sender: 'Dentist', text: 'Restoring tooth 26 occlusal composite, 2.2ml articaine given with verbal consent and post-op care advised.' }
    ];
    const completeResult = prefillMacroSlots(completeTranscript, 'restorative');

    expect(canSignDeterministicNote(completeResult)).toBe(true);
  });
});
