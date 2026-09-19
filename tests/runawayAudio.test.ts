import { describe, it, expect } from 'vitest';
import { validateTranscript, clinicalHorizonFilter } from '../src/server/payloadValidation';
import { TranscriptItem } from '../src/types';

describe('Runaway Audio & Extended Capacity Protections', () => {
  it('permits encounters with >200 utterances up to 5,000 without TRANSCRIPT_TOO_LONG rejection', () => {
    // 350 utterances simulates a 45-minute runaway audio appointment
    const transcript350: TranscriptItem[] = Array.from({ length: 350 }, (_, i) => ({
      sender: i % 2 === 0 ? 'Dentist' : 'Patient',
      text: `Utterance ${i}: patient discussion regarding oral health.`
    }));

    const problem = validateTranscript(transcript350);
    expect(problem).toBeNull();
  });

  it('rejects payload if transcript exceeds the 5,000-utterance boundary', () => {
    const transcript5001: TranscriptItem[] = Array.from({ length: 5001 }, (_, i) => ({
      sender: 'Dentist',
      text: `Utterance ${i}`
    }));

    const problem = validateTranscript(transcript5001);
    expect(problem).not.toBeNull();
    expect(problem?.code).toBe('TRANSCRIPT_TOO_LONG');
    expect(problem?.error).toContain('maximum 5000');
  });

  it('preserves short clinical conversations intact with zero clipping', () => {
    const shortTranscript: TranscriptItem[] = [
      { sender: 'Dentist', text: 'Good morning Sarah, how is tooth 14 feeling today?' },
      { sender: 'Patient', text: 'It has been sensitive to cold water.' },
      { sender: 'Dentist', text: 'We will place local anesthesia: 1.8mL 2% Lidocaine with 1:100k epi.' },
      { sender: 'Dentist', text: 'Excavated recurrent caries on tooth 14 occlusal.' },
      { sender: 'Dentist', text: 'Restored with Filtek Supreme A2 composite. Occlusion checked and stable.' }
    ];

    const filtered = clinicalHorizonFilter(shortTranscript);
    expect(filtered).toHaveLength(5);
    expect(filtered).toEqual(shortTranscript);
  });

  it('filters out trailing room turnover noise after an appointment has completed', () => {
    const clinicalItems: TranscriptItem[] = [
      { sender: 'Dentist', text: 'Good morning, examine tooth 46 today.' },
      { sender: 'Dentist', text: 'Administering 1.8mL Articaine 4% with 1:100k epinephrine.' },
      { sender: 'Dentist', text: 'Tooth 46 MOD preparation completed.' },
      { sender: 'Dentist', text: 'Etched, bonded, restored with composite and cured.' },
      { sender: 'Dentist', text: 'Occlusion equilibrated in excursions. Rinse and we are all finished.' },
      { sender: 'Patient', text: 'Thank you doctor, have a great afternoon.' }
    ];

    // Followed by 35 trailing entries of room cleaning, assistant chatting, or phone calls
    const roomTurnoverNoise: TranscriptItem[] = Array.from({ length: 35 }, (_, i) => ({
      sender: 'Dentist',
      text: i === 34 
        ? 'Last cleanup of the day, shutting off the operatory lights.' 
        : `Room turnover step ${i}: cleaning surfaces and restyling instruments.`
    }));

    const runawayTranscript = [...clinicalItems, ...roomTurnoverNoise];
    expect(runawayTranscript.length).toBe(41);

    const filtered = clinicalHorizonFilter(runawayTranscript);
    // The filter should detect the clinical horizon anchor and drop trailing turnover noise
    expect(filtered.length).toBeLessThan(runawayTranscript.length);
    // All original clinical statements are preserved
    expect(filtered.some(t => t.text.includes('Tooth 46 MOD preparation'))).toBe(true);
    expect(filtered.some(t => t.text.includes('Articaine'))).toBe(true);
    // Late trailing non-clinical turnover chat is eliminated
    expect(filtered.some(t => t.text.includes('shutting off the operatory lights'))).toBe(false);
  });
});
