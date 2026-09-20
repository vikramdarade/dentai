import { describe, it, expect } from 'vitest';
import { ThinkingLevel } from '@google/genai';
import {
  applyNoteThinking,
  resolveNoteThinkingLevel,
  DEFAULT_NOTE_THINKING_LEVEL,
  NOTE_TIMEOUTS,
  THINKING_LEVELS
} from '../src/lib/noteModelConfig';

/**
 * These are latency regression guards, not style checks.
 *
 * The Gemini 3 Flash family runs with thinking ON by default — Google's model
 * table lists `gemini-3.6-flash` as "On (medium)". Note generation is a
 * structured extraction job (read a transcript we already have, fill a schema we
 * already define), so the reasoning effort bought latency and nothing else.
 * The thinking level was pinned to `minimal` for latency (2026-09-17). The same
 * pilot then reported fabricated terminology and dropped findings — a worse
 * failure than waiting — so the default was restored to `medium` on
 * 2026-09-20, by explicit founder direction: accuracy first, no compromises.
 * Latency is bounded by NOTE_TIMEOUTS and the offline draft path.
 *
 * If someone lowers this default for latency again, they are deliberately
 * spending accuracy — the thing this product is legally required to keep — and
 * they should have to say so here, with eval evidence that accuracy held.
 */
describe('note generation thinking level', () => {
  it('defaults to medium: accuracy-first by founder direction (2026-09-20)', () => {
    expect(DEFAULT_NOTE_THINKING_LEVEL).toBe('medium');
    expect(resolveNoteThinkingLevel({})).toBe('medium');
  });

  it('honours an explicit operator override', () => {
    expect(resolveNoteThinkingLevel({ DENTAI_THINKING_LEVEL: 'high' })).toBe('high');
    expect(resolveNoteThinkingLevel({ DENTAI_THINKING_LEVEL: 'LOW' })).toBe('low');
  });

  it('falls back to the default instead of throwing on a junk value', () => {
    // A typo in an environment variable must not take note generation down.
    expect(resolveNoteThinkingLevel({ DENTAI_THINKING_LEVEL: 'ultra' })).toBe('medium');
    expect(resolveNoteThinkingLevel({ DENTAI_THINKING_LEVEL: '' })).toBe('medium');
    expect(resolveNoteThinkingLevel({ DENTAI_THINKING_LEVEL: '  ' })).toBe('medium');
  });

  it('only ever produces a level the API accepts', () => {
    for (const value of ['minimal', 'low', 'medium', 'high', '', 'nonsense']) {
      expect(THINKING_LEVELS).toContain(resolveNoteThinkingLevel({ DENTAI_THINKING_LEVEL: value }));
    }
  });
});

describe('applyNoteThinking', () => {
  it('attaches the thinking level without disturbing the rest of the config', () => {
    const schema = { type: 'OBJECT', properties: { chiefComplaint: { type: 'STRING' } } };
    const base = {
      responseMimeType: 'application/json',
      responseSchema: schema,
      systemInstruction: 'You are a dental scribe.'
    };

    const configured = applyNoteThinking(base, 'minimal');

    // The SDK forwards thinkingConfig to the API unchanged and types the level
    // as its own enum, so the enum value — not the lowercase documentation
    // spelling an operator types — is what must reach the wire.
    expect(configured.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(configured.thinkingConfig.thinkingLevel).toBe('MINIMAL');
    // The note contract is what makes the output parseable — it must survive.
    expect(configured.responseMimeType).toBe('application/json');
    expect(configured.responseSchema).toBe(schema);
    expect(configured.systemInstruction).toBe('You are a dental scribe.');
    // ...and the caller's object must not be mutated.
    expect((base as any).thinkingConfig).toBeUndefined();
  });

  it('preserves any other thinking settings already present', () => {
    const configured = applyNoteThinking(
      { responseMimeType: 'application/json', thinkingConfig: { includeThoughts: false } },
      'low'
    );
    expect(configured.thinkingConfig).toEqual({ includeThoughts: false, thinkingLevel: ThinkingLevel.LOW });
  });

  it('maps every operator-facing level to the matching SDK enum value', () => {
    // If this mapping drifts, an operator raising the level silently gets the
    // default instead — the kind of failure that looks like "no effect".
    const expected = {
      minimal: ThinkingLevel.MINIMAL,
      low: ThinkingLevel.LOW,
      medium: ThinkingLevel.MEDIUM,
      high: ThinkingLevel.HIGH
    };
    for (const level of THINKING_LEVELS) {
      expect(applyNoteThinking({}, level).thinkingConfig.thinkingLevel).toBe(expected[level]);
    }
  });
});

describe('note generation latency budgets', () => {
  it('keeps every budget short enough to stand at the chair for', () => {
    // A dentist cannot wait a minute: past these budgets the product must hand
    // the clinician the offline draft instead of a spinner.
    for (const [name, ms] of Object.entries(NOTE_TIMEOUTS)) {
      expect(ms, `${name} should be a positive budget`).toBeGreaterThan(0);
      expect(ms, `${name} should stay under 30s`).toBeLessThanOrEqual(30_000);
    }
  });

  it('gives the fallback route a shorter budget than the primary', () => {
    // The fallback only runs after the primary has already spent its budget, so
    // total worst-case latency is what a clinician actually experiences.
    expect(NOTE_TIMEOUTS.secondaryMs).toBeLessThan(NOTE_TIMEOUTS.primaryMs);
    expect(NOTE_TIMEOUTS.primaryMs + NOTE_TIMEOUTS.secondaryMs).toBeLessThanOrEqual(45_000);
  });
});
