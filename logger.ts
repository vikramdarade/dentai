/**
 * Structured Logging and Telemetry Utility
 * Designed for DentAI production runtime logs (Vercel, CloudWatch, Datadog compatible)
 */

interface TelemetryMetrics {
  totalRequests: number;
  totalErrors: number;
  latencies: number[]; // Store recent request durations (last 100) to compute P50/P95
}

const metrics: TelemetryMetrics = {
  totalRequests: 0,
  totalErrors: 0,
  latencies: [],
};

const MAX_LATENCY_HISTORY = 100;

/* ---------------------------------------------------------------------------
 * Outbound alerting (optional, zero-dependency).
 *
 * A solo operator has no on-call rotation: if something breaks in production
 * the founder has to be told, not have to go looking. Setting ERROR_WEBHOOK_URL
 * (Slack/Discord/Teams incoming webhook, or any endpoint accepting JSON POST)
 * forwards ERROR-level events. It is throttled and fully detached from the
 * request path — alerting must never be able to break a clinical request.
 * ------------------------------------------------------------------------- */

const ALERT_WEBHOOK_URL = process.env.ERROR_WEBHOOK_URL || '';
const ALERT_THROTTLE_MS = 60_000 / 10; // at most ~10 alerts/minute
let lastAlertAt = 0;
let alertsSent = 0;

function sendAlert(payload: Record<string, any>): void {
  if (!ALERT_WEBHOOK_URL) return;
  const now = Date.now();
  if (now - lastAlertAt < ALERT_THROTTLE_MS) return;
  lastAlertAt = now;
  alertsSent++;
  // Fire-and-forget: never awaited, never throws into the caller.
  void (async () => {
    try {
      const body = JSON.stringify({ text: `DentAI alert: ${payload.message}`, ...payload });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      // Alert delivery is best-effort by definition.
    }
  })();
}

export const logger = {
  info: (message: string, context?: Record<string, any>) => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message,
        ...context,
      })
    );
  },

  warn: (message: string, context?: Record<string, any>) => {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'WARN',
        message,
        ...context,
      })
    );
  },

  error: (message: string, error?: any, context?: Record<string, any>) => {
    metrics.totalErrors++;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        message,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      })
    );
    // Alert payloads deliberately carry no patient data and no request context
    // beyond the route — see docs/legal/data-flow-and-subprocessors.md.
    sendAlert({
      level: 'ERROR',
      message,
      error: errorMessage,
      route: context?.url,
      timestamp: new Date().toISOString(),
    });
  },

  /**
   * Records a request duration and updates P50/P95 telemetry.
   */
  recordLatency: (durationMs: number) => {
    metrics.totalRequests++;
    metrics.latencies.push(durationMs);
    if (metrics.latencies.length > MAX_LATENCY_HISTORY) {
      metrics.latencies.shift(); // Keep moving window
    }
  },

  /** True when outbound alerting is configured. */
  alertingEnabled: () => !!ALERT_WEBHOOK_URL,

  /**
   * Retrieves summary telemetry statistics for THIS process instance.
   * On a serverless runtime each instance keeps its own counters, so the
   * numbers describe the instance that answered — not the fleet. Real
   * fleet-level metrics belong in the hosting provider's dashboard.
   */
  getTelemetry: () => {
    const count = metrics.latencies.length;
    if (count === 0) {
      return {
        scope: 'process-instance',
        alertsSent,
        alertingEnabled: !!ALERT_WEBHOOK_URL,
        totalRequests: metrics.totalRequests,
        totalErrors: metrics.totalErrors,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        averageLatencyMs: 0,
      };
    }

    const sorted = [...metrics.latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const avg = sum / count;

    // Calculate percentiles
    const p50Index = Math.min(Math.floor(count * 0.5), count - 1);
    const p95Index = Math.min(Math.floor(count * 0.95), count - 1);

    return {
      scope: 'process-instance',
      alertsSent,
      alertingEnabled: !!ALERT_WEBHOOK_URL,
      totalRequests: metrics.totalRequests,
      totalErrors: metrics.totalErrors,
      p50LatencyMs: Math.round(sorted[p50Index]),
      p95LatencyMs: Math.round(sorted[p95Index]),
      averageLatencyMs: Math.round(avg),
    };
  },
};
