/**
 * Clinical-accuracy gate.
 *
 * Nothing measured whether a change to a prompt, a model or the template schema
 * made notes better or worse. The existing controls — the "never fabricate a
 * diagnosis or an item number" instruction, mandatory clinician review, and a
 * fixed output schema — are good instincts, but none of them is a regression
 * test: a prompt tweak can quietly drop the medical history from every note and
 * nobody finds out until a clinic does.
 *
 * This module scores generated notes against a fixed set of synthetic
 * consultations with known findings, and provides a small number of **hard
 * safety gates** that fail regardless of score:
 *
 *   1. An item number (ADA code) that does not appear in the transcript is a
 *      fail. Billing on a fabricated item is the worst thing this product
 *      could do.
 *   2. A rendered field that is empty when the transcript supports it is a
 *      quality failure.
 *   3. Content that claims a diagnosis when the transcript records none is a
 *      fail (it is the failure mode a clinician would not catch in a hurry).
 *
 * The fixtures live in tests/fixtures/clinical-eval and carry a **recorded
 * generation**, so the suite runs offline in CI with no API key and no cost.
 * `bun run eval:notes` (without `--offline`) regenerates through the live model
 * and reports drift against the recorded output — that is the run to do after
 * changing a prompt.
 */

export interface EvalExpectation {
  /**
   * Required content per field: each entry is a group of alternatives, and at
   * least one alternative must appear (case-insensitive). This tolerates
   * wording differences while still proving the clinical fact survived.
   */
  required: Record<string, string[][]>;
  /**
   * Text that must NOT appear anywhere in the note. Used for the safety gate:
   * fabrications, invented item numbers, and claims the transcript does not
   * support.
   */
  forbidden?: string[];
  /** Field keys that must be non-empty even with no keyword expectation. */
  mustBePresent?: string[];
  /**
   * The complete set of item numbers this consultation can legitimately
   * support. Any code outside this set is treated as fabricated — the safety
   * gate, because billing on an invented item is the worst thing this product
   * could do.
   */
  expectedCodes?: string[];
  /**
   * Item numbers that must actually appear in the note. Separate from the
   * allowed set on purpose: a clinician adds codes the model should not infer
   * ("this was a consultation"), so requiring every allowed code would fail
   * good notes. Missing a required code is a completeness failure, not a safety
   * one, and it does fail the run.
   */
  requiredCodes?: string[];
}

export interface EvalFixture {
  id: string;
  description: string;
  transcript: Array<{ sender: string; text: string }>;
  intake: Record<string, any>;
  expected: EvalExpectation;
  /** Committed generation used for offline scoring in CI. */
  recorded: {
    fields: Record<string, string>;
    patientSummary?: string;
    adaCodes?: Array<{ code: string; description: string }>;
    engine?: string;
    needsReview?: boolean;
  };
}

export interface FieldScore {
  key: string;
  present: boolean;
  matchedGroups: number;
  totalGroups: number;
}

export interface EvalViolation {
  kind: 'forbidden_text' | 'missing_field' | 'unsupported_code' | 'fabricated_code' | 'empty_note';
  detail: string;
}

export interface EvalResult {
  fixtureId: string;
  score: number;
  passed: boolean;
  fields: FieldScore[];
  violations: EvalViolation[];
}

export interface GenerationLike {
  fields: Record<string, string>;
  patientSummary?: string;
  adaCodes?: Array<{ code: string; description?: string }>;
  needsReview?: boolean;
}

const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

function noteText(generation: GenerationLike): string {
  return normalise(
    [...Object.values(generation.fields || {}), generation.patientSummary || ''].join(' \n ')
  );
}

/** True when at least one alternative from every group appears in the text. */
function groupsSatisfied(groups: string[][], text: string): number {
  let matched = 0;
  for (const group of groups) {
    if (group.some((alternative) => text.includes(normalise(alternative)))) matched += 1;
  }
  return matched;
}

/**
 * Scores one generation. Weighting: required content carries the score; each
 * safety violation caps the result at zero for that fixture, because a
 * fabricated item number is not "mostly right".
 */
export function scoreGeneration(fixture: EvalFixture, generation: GenerationLike): EvalResult {
  const violations: EvalViolation[] = [];
  const fields: FieldScore[] = [];
  const expectations = fixture.expected || { required: {} };

  const hasAnyContent =
    Object.values(generation.fields || {}).some((v) => String(v || '').trim().length > 0) ||
    String(generation.patientSummary || '').trim().length > 0;
  if (!hasAnyContent) {
    violations.push({ kind: 'empty_note', detail: 'Generation contained no clinical content.' });
  }

  for (const [key, groups] of Object.entries(expectations.required || {})) {
    const raw = String((generation.fields || {})[key] || '');
    const text = normalise(raw);
    const matched = text.length === 0 ? 0 : groupsSatisfied(groups, text);
    fields.push({
      key,
      present: text.length > 0,
      matchedGroups: matched,
      totalGroups: groups.length,
    });
    if (matched < groups.length) {
      const missing = groups
        .filter((group) => !group.some((alternative) => text.includes(normalise(alternative))))
        .map((group) => group[0]);
      violations.push({
        kind: 'missing_field',
        detail: `${key}: expected content not found (${missing.join('; ') || 'field empty'})`,
      });
    }
  }

  for (const key of expectations.mustBePresent || []) {
    if (!String((generation.fields || {})[key] || '').trim()) {
      violations.push({ kind: 'missing_field', detail: `${key}: field is empty.` });
    }
  }

  const text = noteText(generation);
  for (const forbidden of expectations.forbidden || []) {
    if (text.includes(normalise(forbidden))) {
      violations.push({
        kind: 'forbidden_text',
        detail: `Unsupported content present: "${forbidden}".`,
      });
    }
  }

  const transcriptText = normalise(fixture.transcript.map((t) => t.text).join(' '));
  const supported = new Set((expectations.expectedCodes || []).map((c) => normalise(c)));
  for (const code of generation.adaCodes || []) {
    const value = normalise(String(code.code || ''));
    if (!value) continue;
    if (supported.has(value)) continue;
    // The number itself may be spoken in the transcript ("item 114"), so accept
    // it when the digits appear there — the gate is about fabrication, not
    // about the code list being complete.
    const digits = value.replace(/\D/g, '');
    if (digits && transcriptText.includes(digits)) continue;
    violations.push({
      kind: 'fabricated_code',
      detail: `Item number ${code.code} is not supported by the transcript.`,
    });
  }

  for (const code of expectations.requiredCodes || []) {
    const present = (generation.adaCodes || []).some(
      (c) => normalise(String(c.code)) === normalise(code)
    );
    if (!present) {
      violations.push({
        kind: 'unsupported_code',
        detail: `Required item number ${code} was not surfaced.`,
      });
    }
  }

  const totalGroups = fields.reduce((sum, f) => sum + f.totalGroups, 0);
  const matchedGroups = fields.reduce((sum, f) => sum + f.matchedGroups, 0);
  const rawScore = totalGroups === 0 ? (hasAnyContent ? 1 : 0) : matchedGroups / totalGroups;
  const safetyFailures = violations.filter(
    (v) => v.kind === 'forbidden_text' || v.kind === 'fabricated_code' || v.kind === 'empty_note'
  );
  const score = safetyFailures.length > 0 ? 0 : Number(rawScore.toFixed(4));
  // A missing *required* item number is a completeness failure: the practice
  // does not get paid for the work it did. It fails the run without zeroing the
  // score, so the report distinguishes "incomplete" from "unsafe".
  const missingRequiredCode = violations.some((v) => v.kind === 'unsupported_code');

  return {
    fixtureId: fixture.id,
    score,
    passed: score >= 0.9 && safetyFailures.length === 0 && !missingRequiredCode,
    fields,
    violations,
  };
}

export interface EvalSummary {
  fixtures: number;
  passed: number;
  averageScore: number;
  safetyFailures: number;
  worst: Array<{ fixtureId: string; score: number; detail: string }>;
}

export function summariseResults(results: EvalResult[], minScore = 0.9): EvalSummary {
  const safetyFailures = results.filter((r) =>
    r.violations.some(
      (v) => v.kind === 'forbidden_text' || v.kind === 'fabricated_code' || v.kind === 'empty_note'
    )
  ).length;
  const average =
    results.length === 0 ? 0 : results.reduce((sum, r) => sum + r.score, 0) / results.length;
  return {
    fixtures: results.length,
    passed: results.filter((r) => r.passed && r.score >= minScore).length,
    averageScore: Number(average.toFixed(4)),
    safetyFailures,
    worst: [...results]
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map((r) => ({
        fixtureId: r.fixtureId,
        score: r.score,
        detail: r.violations.map((v) => v.detail).join(' ') || 'no violations',
      })),
  };
}
