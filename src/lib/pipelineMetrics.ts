/**
 * Clinical Pipeline Stage Metrics (Phase 9 — Observability)
 *
 * PHI-FREE BY CONSTRUCTION: every function accepts ids, booleans, enums and
 * durations only. There is no parameter that could carry transcript text, note
 * text, patient names or any clinical content — the type signatures make PHI
 * impossible to pass through. Metrics are recorded as bounded histograms and
 * counters; payloads never include clinical content.
 *
 * Stage model (matches docs/NOTE_RENDERING_CONTRACT.md):
 *   audio_ingestion → asr → extraction → validation → verification → rendering
 * with `total` recorded by the caller when the pipeline completes or aborts.
 *
 * Counters (all keyed by outcome, never by content):
 *   verification rate      — verificationRuns / casesWithFacts
 *   verification trigger   — per trigger id
 *   correction rate        — clinicianCorrection (count only)
 *   contradiction rate     — contradictionFlags (count only)
 *   extraction failures    — extractionFailure
 *   rendering failures     — renderingFailure
 *   sign-off rejections    — signOffRejection
 */

export type PipelineStage =
  | 'audio_ingestion'
  | 'asr'
  | 'extraction'
  | 'validation'
  | 'verification'
  | 'rendering'
  | 'total';

/** A single stage observation. PHI-free by type: ids and durations only. */
export interface StageObservation {
  readonly stage: PipelineStage;
  readonly durationMs: number;
  readonly ok: boolean;
}

export type PipelineFailureKind =
  | 'extractionFailure'
  | 'renderingFailure'
  | 'asrFailure'
  | 'audioIngestionFailure'
  | 'validationFailure'
  | 'signOffRejection'
  | 'contradictionFlags'
  | 'clinicianCorrection'
  | 'llmMalformedOutput'
  | 'llmTimeout'
  | 'providerTimeout'
  /** Degraded ASR: segments rejected, speakers unlabelled, or gaps in the recording. */
  | 'partialAsrTranscript';

const STAGES: readonly PipelineStage[] = [
  'audio_ingestion', 'asr', 'extraction', 'validation', 'verification', 'rendering', 'total',
];

const MAX_LATENCY_SAMPLES_PER_STAGE = 100;

function emptyLatencies(): Record<PipelineStage, number[]> {
  return {
    audio_ingestion: [], asr: [], extraction: [], validation: [],
    verification: [], rendering: [], total: [],
  };
}

function emptyCounters(): Record<string, number> {
  return {
    casesWithFacts: 0,
    verificationRuns: 0,
    clinicianCorrection: 0,
    contradictionFlags: 0,
    extractionFailure: 0,
    renderingFailure: 0,
    asrFailure: 0,
    audioIngestionFailure: 0,
    validationFailure: 0,
    signOffRejection: 0,
    llmMalformedOutput: 0,
    llmTimeout: 0,
    providerTimeout: 0,
    partialAsrTranscript: 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor((sorted.length * p)), sorted.length - 1);
  return Math.round(sorted[idx]);
}

function summarise(samples: number[]): { count: number; p50Ms: number; p95Ms: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) };
}

/**
 * A pipeline-metrics registry. Per-process (serverless instances each keep
 * their own window — the same scoping honesty as logger.getTelemetry()).
 * `reset()` exists for tests only.
 */
export class PipelineMetrics {
  private readonly latencies = emptyLatencies();
  private readonly counters = emptyCounters();
  private readonly triggerCounts = new Map<string, number>();

  /** Records one completed (or failed) stage observation. */
  recordStage(obs: StageObservation): void {
    if (!STAGES.includes(obs.stage)) return;
    if (!Number.isFinite(obs.durationMs) || obs.durationMs < 0) return;
    const bucket = this.latencies[obs.stage];
    bucket.push(obs.durationMs);
    if (bucket.length > MAX_LATENCY_SAMPLES_PER_STAGE) bucket.shift();
    if (!obs.ok) {
      const kind =
        obs.stage === 'extraction' ? 'extractionFailure' :
        obs.stage === 'rendering' ? 'renderingFailure' :
        obs.stage === 'asr' ? 'asrFailure' :
        obs.stage === 'audio_ingestion' ? 'audioIngestionFailure' :
        obs.stage === 'validation' ? 'validationFailure' : null;
      if (kind) this.counters[kind] += 1;
    }
  }

  /** Records a case that produced at least one clinical fact. */
  recordCaseWithFacts(): void {
    this.counters.casesWithFacts += 1;
  }

  /** Records a selective-verification run for an optional trigger id. */
  recordVerificationRun(triggerId?: string): void {
    this.counters.verificationRuns += 1;
    if (triggerId) {
      this.triggerCounts.set(triggerId, (this.triggerCounts.get(triggerId) ?? 0) + 1);
    }
  }

  /**
   * Records a keyed occurrence of a failure/degradation kind. A non-positive
   * amount is ignored so a caller can never decrement a counter.
   */
  recordCounter(kind: PipelineFailureKind, amount = 1): void {
    if (amount <= 0) return;
    if (kind in this.counters) {
      this.counters[kind] += amount;
    }
  }

  /** Snapshot for /api/ops/telemetry. Contains only ids, counts, percentiles. */
  snapshot(): {
    scope: 'process-instance';
    stages: Record<PipelineStage, { count: number; p50Ms: number; p95Ms: number }>;
    counters: Record<string, number>;
    verification: { rate: number | null; triggers: Record<string, number> };
  } {
    const stages = {} as Record<PipelineStage, { count: number; p50Ms: number; p95Ms: number }>;
    for (const s of STAGES) stages[s] = summarise(this.latencies[s]);
    const triggers: Record<string, number> = {};
    for (const [k, v] of [...this.triggerCounts.entries()].sort()) triggers[k] = v;
    const cases = this.counters.casesWithFacts;
    return {
      scope: 'process-instance',
      stages,
      counters: { ...this.counters },
      verification: {
        rate: cases > 0 ? this.counters.verificationRuns / cases : null,
        triggers,
      },
    };
  }

  /** Test-only reset. */
  reset(): void {
    for (const s of STAGES) this.latencies[s].length = 0;
    for (const k of Object.keys(this.counters)) this.counters[k] = 0;
    this.triggerCounts.clear();
  }
}

/** Process-wide registry used by the server seam. */
export const pipelineMetrics = new PipelineMetrics();

/** Pure helper: wall-clock duration of a stage around an async operation. */
export async function timedStage<T>(
  metrics: PipelineMetrics,
  stage: PipelineStage,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    metrics.recordStage({ stage, durationMs: Date.now() - start, ok: true });
    return result;
  } catch (err) {
    metrics.recordStage({ stage, durationMs: Date.now() - start, ok: false });
    throw err;
  }
}
