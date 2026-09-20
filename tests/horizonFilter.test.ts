import { describe, it, expect } from 'vitest';
import {
  clinicalHorizonFilterStats,
  transcriptFingerprint
} from '../src/server/payloadValidation';

/**
 * A trim of the generation input must never be silent: these tests pin the
 * statistics that the generation routes record in the audit trail, and the
 * fingerprint that ties a note back to the exact verbatim record.
 */
describe('clinicalHorizonFilterStats', () => {
  it('reports zero dropped when the transcript is within the no-filter range', () => {
    const transcript = Array.from({ length: 20 }, (_, i) => ({ sender: 'Dialogue', text: `line ${i}` }));
    expect(clinicalHorizonFilterStats(transcript)).toEqual({ total: 20, kept: 20, dropped: 0 });
  });

  it('counts what a trailing tail trim removes, without trimming anything itself', () => {
    const clinical = { sender: 'Dentist', text: 'Extirpation initiated on 16 under rubber dam.' };
    const filler = Array.from({ length: 30 }, () => ({ sender: 'Dialogue', text: 'rustle clang clank' }));
    const stats = clinicalHorizonFilterStats([clinical, ...filler]);
    expect(stats.total).toBe(31);
    expect(stats.dropped).toBeGreaterThan(0);
    expect(stats.kept).toBe(stats.total - stats.dropped);
  });

  it('handles a missing transcript defensively', () => {
    expect(clinicalHorizonFilterStats(undefined as any)).toEqual({ total: 0, kept: 0, dropped: 0 });
  });
});

describe('transcriptFingerprint', () => {
  const transcript = [{ sender: 'Dentist', text: 'Tooth 16 has a distal cavity.' }];

  it('is stable for identical transcripts', () => {
    expect(transcriptFingerprint(transcript)).toBe(
      transcriptFingerprint([{ sender: 'Dentist', text: 'Tooth 16 has a distal cavity.' }])
    );
  });

  it('changes when the spoken words change', () => {
    expect(transcriptFingerprint(transcript)).not.toBe(
      transcriptFingerprint([{ sender: 'Dentist', text: 'Tooth 17 has a distal cavity.' }])
    );
  });

  it('treats the same words attributed to a different speaker as a different record', () => {
    expect(transcriptFingerprint(transcript)).not.toBe(
      transcriptFingerprint([{ sender: 'Patient', text: 'Tooth 16 has a distal cavity.' }])
    );
  });

  it('is a short hex string safe for audit logs', () => {
    expect(transcriptFingerprint(transcript)).toMatch(/^[0-9a-f]{16}$/);
  });
});
