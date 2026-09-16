import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreGeneration, summariseResults, type EvalFixture } from '../src/lib/clinicalEval';

/**
 * The clinical eval gate, running inside the normal suite rather than only in
 * the dedicated CI job — so a prompt, template or schema change that degrades
 * notes fails `bun run test` on the developer's machine, before it is pushed.
 */
const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'clinical-eval'
);

function loadFixtures(): EvalFixture[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf-8')) as EvalFixture);
}

describe('Clinical evaluation fixtures', () => {
  const fixtures = loadFixtures();

  it('ships a meaningful set of synthetic consultations', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    const ids = fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of fixtures) {
      expect(fixture.transcript.length).toBeGreaterThan(3);
      expect(fixture.recorded).toBeTruthy();
    }
  });

  it('covers the appointment types a clinic actually books', () => {
    const types = fixtures.map((f) => f.intake.appointmentType);
    expect(types).toContain('examination');
    expect(types).toContain('emergency');
    expect(types).toContain('scale_clean');
  });

  it('scores every recorded generation at or above the release threshold', () => {
    const results = fixtures.map((fixture) =>
      scoreGeneration(fixture, fixture.recorded as any)
    );
    const summary = summariseResults(results, 0.9);
    const failures = results.filter((r) => !r.passed);
    expect(
      failures.map((f) => `${f.fixtureId}: ${f.violations.map((v) => v.detail).join(' ')}`)
    ).toEqual([]);
    expect(summary.safetyFailures).toBe(0);
    expect(summary.passed).toBe(fixtures.length);
    expect(summary.averageScore).toBeGreaterThanOrEqual(0.9);
  });

  it('every fixture declares the item numbers it considers legitimate', () => {
    // Without an allowed set the fabrication gate has nothing to compare
    // against, so a fixture that omits it silently weakens the check.
    for (const fixture of fixtures) {
      expect(Array.isArray(fixture.expected.expectedCodes)).toBe(true);
    }
  });
});
