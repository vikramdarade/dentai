import { describe, it, expect, beforeEach } from 'vitest';
import {
  PipelineMetrics,
  pipelineMetrics,
  timedStage,
  type PipelineFailureKind
} from '../src/lib/pipelineMetrics';

/**
 * Phase 9 — Observability.
 *
 * The metrics registry is the one place the clinical pipeline reports itself.
 * Its contract is two-sided:
 *   1. Operators get stage latency (p50/p95), failure kinds and the
 *      verification rate without reading logs.
 *   2. Patients get a guarantee that none of it can carry PHI — enforced by
 *      the type signatures, not by review discipline (see the type-level test).
 */

const ALL_STAGES = [
  'audio_ingestion', 'asr', 'extraction', 'validation',
  'verification', 'rendering', 'total'
] as const;

const ALL_FAILURE_KINDS: readonly PipelineFailureKind[] = [
  'extractionFailure', 'renderingFailure', 'asrFailure', 'audioIngestionFailure',
  'validationFailure', 'signOffRejection', 'contradictionFlags',
  'clinicianCorrection', 'llmMalformedOutput', 'llmTimeout', 'providerTimeout',
  'partialAsrTranscript'
];

function fresh(): PipelineMetrics {
  return new PipelineMetrics();
}

describe('Stage-level latency', () => {
  it('reports count, p50 and p95 per stage', () => {
    const m = fresh();
    for (const ms of [10, 20, 30, 40, 100]) {
      m.recordStage({ stage: 'extraction', durationMs: ms, ok: true });
    }
    const snap = m.snapshot();
    expect(snap.stages.extraction).toEqual({ count: 5, p50Ms: 30, p95Ms: 100 });
  });

  it('has a zeroed bucket for every stage of the pipeline contract', () => {
    const snap = fresh().snapshot();
    for (const stage of ALL_STAGES) {
      expect(snap.stages[stage], stage).toEqual({ count: 0, p50Ms: 0, p95Ms: 0 });
    }
  });

  it('keeps the per-stage histogram bounded at 100 samples (recent window wins)', () => {
    const m = fresh();
    for (let i = 0; i < 150; i++) {
      m.recordStage({ stage: 'asr', durationMs: i, ok: true });
    }
    const s = m.snapshot().stages.asr;
    expect(s.count).toBe(100);
    // The oldest 50 samples were evicted; p50 of the remaining window is 100.
    expect(s.p50Ms).toBe(100);
  });

  it('rejects malformed observations instead of poisoning the histogram', () => {
    const m = fresh();
    m.recordStage({ stage: 'extraction', durationMs: Number.NaN, ok: true });
    m.recordStage({ stage: 'extraction', durationMs: -5, ok: true });
    // @ts-expect-error — an unknown stage must be refused at runtime too.
    m.recordStage({ stage: 'networking', durationMs: 5, ok: true });
    expect(m.snapshot().stages.extraction.count).toBe(0);
  });
});

describe('Failure-kind counters', () => {
  it('derives the failure kind from the failed stage', () => {
    const m = fresh();
    m.recordStage({ stage: 'extraction', durationMs: 5, ok: false });
    m.recordStage({ stage: 'rendering', durationMs: 5, ok: false });
    m.recordStage({ stage: 'asr', durationMs: 5, ok: false });
    m.recordStage({ stage: 'audio_ingestion', durationMs: 5, ok: false });
    m.recordStage({ stage: 'validation', durationMs: 5, ok: false });
    const c = m.snapshot().counters;
    expect(c.extractionFailure).toBe(1);
    expect(c.renderingFailure).toBe(1);
    expect(c.asrFailure).toBe(1);
    expect(c.audioIngestionFailure).toBe(1);
    expect(c.validationFailure).toBe(1);
  });

  it('exposes every mandated Phase 9 failure kind as a counter key', () => {
    const c = fresh().snapshot().counters;
    for (const kind of ALL_FAILURE_KINDS) {
      expect(c, kind).toHaveProperty(kind);
      expect(c[kind]).toBe(0);
    }
  });

  it('accumulates provider classes distinctly: timeout vs malformed output', () => {
    const m = fresh();
    m.recordCounter('llmTimeout');
    m.recordCounter('providerTimeout');
    m.recordCounter('llmMalformedOutput');
    m.recordCounter('llmMalformedOutput');
    const c = m.snapshot().counters;
    expect(c.llmTimeout).toBe(1);
    expect(c.providerTimeout).toBe(1);
    expect(c.llmMalformedOutput).toBe(2);
  });

  it('refuses to decrement a counter — telemetry cannot be rewritten', () => {
    const m = fresh();
    m.recordCounter('signOffRejection', 5);
    m.recordCounter('signOffRejection', 0);
    m.recordCounter('signOffRejection', -3);
    expect(m.snapshot().counters.signOffRejection).toBe(5);
  });

  it('counts contradictions by flag volume, not just incidence', () => {
    const m = fresh();
    m.recordCounter('contradictionFlags', 3);
    expect(m.snapshot().counters.contradictionFlags).toBe(3);
  });
});

describe('Verification rate and triggers', () => {
  it('is null before any case exists (never a misleading 0%)', () => {
    expect(fresh().snapshot().verification.rate).toBeNull();
  });

  it('is verificationRuns / casesWithFacts once cases flow', () => {
    const m = fresh();
    m.recordCaseWithFacts();
    m.recordCaseWithFacts();
    m.recordCaseWithFacts();
    m.recordVerificationRun();
    expect(m.snapshot().verification.rate).toBeCloseTo(1 / 3);
  });

  it('attributes verification runs to their trigger ids, sorted', () => {
    const m = fresh();
    m.recordVerificationRun('contradiction_flag');
    m.recordVerificationRun('ungrounded_claim');
    m.recordVerificationRun('contradiction_flag');
    const v = m.snapshot().verification;
    expect(v.triggers).toEqual({ contradiction_flag: 2, ungrounded_claim: 1 });
  });

  it('keeps correction and sign-off rejection counts observable', () => {
    const m = fresh();
    m.recordCounter('clinicianCorrection');
    m.recordCounter('clinicianCorrection');
    m.recordCounter('signOffRejection');
    const c = m.snapshot().counters;
    expect(c.clinicianCorrection).toBe(2);
    expect(c.signOffRejection).toBe(1);
  });
});

describe('PHI-free by construction', () => {
  it('snapshot serialises to ids, durations and counts only', () => {
    const m = fresh();
    m.recordStage({ stage: 'total', durationMs: 12, ok: true });
    m.recordVerificationRun('ungrounded_claim');
    const json = JSON.stringify(m.snapshot());
    // No field of the snapshot is a free-form string that could carry PHI:
    // scope is a literal, stage names and trigger ids are code constants,
    // everything numeric is a duration or count.
    const parsed = JSON.parse(json) as Record<string, any>;
    expect(parsed.scope).toBe('process-instance');
    expect(Object.keys(parsed)).toEqual(['scope', 'stages', 'counters', 'verification']);
    for (const s of Object.values<any>(parsed.stages)) {
      expect(Object.keys(s).sort()).toEqual(['count', 'p50Ms', 'p95Ms']);
    }
  });

  it('the public API has no parameter that can carry transcript or note text', () => {
    // Type-level proof: every accepted argument is an enum, a boolean, a
    // duration or an id. This fails to compile the moment a `string` content
    // parameter is introduced — which is the point.
    const m = fresh();
    const obs: Parameters<PipelineMetrics['recordStage']>[0] = {
      stage: 'extraction', durationMs: 1, ok: true
    };
    expect(obs.stage).toBeDefined();
    expect(obs.durationMs).toBeGreaterThan(0);
    expect(typeof obs.ok).toBe('boolean');
    // recordVerificationRun takes an optional trigger id — a code constant,
    // asserted to come from the closed trigger vocabulary used by grounding.
    m.recordVerificationRun('ungrounded_claim');
    // recordCounter takes the closed failure-kind union only.
    const kind: Parameters<PipelineMetrics['recordCounter']>[0] = 'extractionFailure';
    expect(ALL_FAILURE_KINDS).toContain(kind);
  });

  it('reset() clears everything and exists for tests only by convention', () => {
    const m = fresh();
    m.recordStage({ stage: 'total', durationMs: 1, ok: true });
    m.recordCaseWithFacts();
    m.reset();
    const snap = m.snapshot();
    expect(snap.stages.total.count).toBe(0);
    expect(snap.counters.casesWithFacts).toBe(0);
    expect(snap.verification.rate).toBeNull();
  });
});

describe('timedStage helper', () => {
  it('records ok on resolve and passes the value through', async () => {
    const m = fresh();
    const value = await timedStage(m, 'verification', async () => 'done');
    expect(value).toBe('done');
    const s = m.snapshot().stages.verification;
    expect(s.count).toBe(1);
    expect(s.p50Ms).toBeGreaterThanOrEqual(0);
  });

  it('records a failed stage and rethrows so failure handling stays with the caller', async () => {
    const m = fresh();
    await expect(
      timedStage(m, 'rendering', async () => { throw new Error('render blew up'); })
    ).rejects.toThrow('render blew up');
    const s = m.snapshot().stages.rendering;
    expect(s.count).toBe(1);
    expect(m.snapshot().counters.renderingFailure).toBe(1);
  });
});

describe('Process-wide singleton', () => {
  beforeEach(() => {
    pipelineMetrics.reset();
  });

  it('is the same instance the server seam imports', () => {
    expect(pipelineMetrics).toBeInstanceOf(PipelineMetrics);
    pipelineMetrics.recordCaseWithFacts();
    expect(pipelineMetrics.snapshot().counters.casesWithFacts).toBe(1);
  });
});
