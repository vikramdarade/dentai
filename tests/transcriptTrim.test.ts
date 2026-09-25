import { describe, it, expect } from 'vitest';
import { TRIM_THRESHOLDS, compactTranscriptForGeneration } from '../src/lib/transcriptTrim';

describe('Transcript Capacity & Trimming Thresholds', () => {
  it('serverMaxTokens is above 100,000 to support multi-hour surgical/sedation consultations', () => {
    expect(TRIM_THRESHOLDS.serverMaxTokens).toBeGreaterThan(100_000);
  });

  it('compactTranscriptForGeneration preserves full clinical transcript under ceiling', () => {
    // 3,000 utterances of clinical content (~90,000 chars, ~22,500 tokens)
    const transcript = Array.from({ length: 3000 }, (_, i) => ({
      text: `Item 414 pulp extirpation on tooth 36 canal ${i} completed under rubber dam`
    }));
    const result = compactTranscriptForGeneration(transcript);
    expect(result.compacted).toBe(false);
    expect(result.transcript.length).toBe(3000);
    expect(result.summary).toBe('Full transcript used.');
  });
});
