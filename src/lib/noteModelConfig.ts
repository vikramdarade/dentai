/**
 * Note-generation model configuration — the latency controls for hosted AI.
 *
 * Why this is a module and not four inline object literals in server.ts:
 *
 * The Gemini 3 Flash family runs with **thinking on by default** (Google's own
 * model table lists `gemini-3.6-flash` as "On (medium)"). Thinking is valuable
 * for reasoning tasks and actively harmful for ours: note generation is a
 * structured extraction job — read a transcript we already have, fill a schema
 * we already define. The dentist is standing at the chair waiting for it, and
 * every note paid the medium-reasoning latency tax with nothing to show for it.
 *
 * Pilot feedback was "the note generation was slow". The thinking level was
 * pinned to `minimal` for latency (2026-09-17) — and the same pilot then
 * reported fabricated terminology and dropped findings, which is a worse
 * failure than waiting. The default is now `medium` (accuracy-first); latency
 * is bounded by NOTE_TIMEOUTS and the offline draft path.
 *
 * Kept as a pure function so the regression guard is a unit test rather than a
 * comment nobody reads (tests/noteModelConfig.test.ts).
 *
 * SERVER-ONLY: imports the Gemini SDK for its ThinkingLevel enum. Do not import
 * this module from client code or the SDK lands in the browser bundle.
 */
import { ThinkingLevel } from '@google/genai';

/** Thinking levels the Gemini 3 models accept (lower = faster, less reasoning). */
export type ThinkingLevelName = 'minimal' | 'low' | 'medium' | 'high';

/**
 * The operator-facing name mapped to the value the SDK puts on the wire.
 *
 * The SDK forwards `thinkingConfig` to the API unchanged, and types the level as
 * this enum — so the enum value, not the lowercase documentation spelling, is
 * what is serialised. Operators still configure the lowercase name, because that
 * is what Google's documentation and dashboard use, and a typo must not break a
 * consult (see resolveNoteThinkingLevel).
 */
const THINKING_LEVEL_ENUM: Record<ThinkingLevelName, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH
};

export const THINKING_LEVELS: readonly ThinkingLevelName[] = ['minimal', 'low', 'medium', 'high'];

/**
 * Default thinking level for clinical note generation.
 *
 * Accuracy-first, by explicit founder direction (2026-09-20): the note must be
 * faithful to what was said — AHPRA-grade, defensible under legal review — and
 * a lower reasoning level measurably lost fidelity in the pilot (fabricated
 * terminology and dropped findings). `medium` is the level the model ran at
 * before the latency fix, which is the era the pilot called accurate.
 *
 * The latency cost is real and bounded: generation runs under NOTE_TIMEOUTS and
 * the client offers the offline draft when a generation exceeds its budget. An
 * operator who needs the seconds back can still set DENTAI_THINKING_LEVEL.
 */
export const DEFAULT_NOTE_THINKING_LEVEL: ThinkingLevelName = 'medium';

/** Resolves the configured thinking level, ignoring junk values rather than crashing a consult. */
export function resolveNoteThinkingLevel(env: Record<string, string | undefined> = process.env): ThinkingLevelName {
  const raw = (env.DENTAI_THINKING_LEVEL || '').trim().toLowerCase();
  return (THINKING_LEVELS as readonly string[]).includes(raw)
    ? (raw as ThinkingLevelName)
    : DEFAULT_NOTE_THINKING_LEVEL;
}

/**
 * Generation ceilings, in milliseconds.
 *
 * These are user-facing latency budgets, not infrastructure limits: a dentist
 * cannot stand at the chair for 35 seconds. When a route exceeds its budget the
 * client offers the offline draft immediately, which is a better outcome than
 * making the clinician watch a spinner (and better than a silent Vercel function
 * timeout with no note at all).
 */
export const NOTE_TIMEOUTS = {
  /** Primary hosted route (job worker and synchronous endpoint). */
  primaryMs: 25_000,
  /** Secondary key on a separate quota pool. */
  secondaryMs: 18_000
} as const;

/** The thinking settings this module adds to a generation config. */
export interface NoteThinkingSettings {
  thinkingConfig: { thinkingLevel: ThinkingLevel };
}

/**
 * Applies the note-generation thinking level to a Gemini generation config.
 *
 * The level is translated from the operator-facing name to the SDK enum, which
 * is what the SDK serialises. The result is typed as the intersection so callers
 * (and the tests) can read the applied level off a typed config.
 */
export function applyNoteThinking<T extends Record<string, any>>(
  config: T,
  level: ThinkingLevelName = resolveNoteThinkingLevel()
): T & NoteThinkingSettings {
  return {
    ...config,
    thinkingConfig: {
      ...(config as any).thinkingConfig,
      thinkingLevel: THINKING_LEVEL_ENUM[level]
    }
  } as T & NoteThinkingSettings;
}
