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
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        message,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      })
    );
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

  /**
   * Retrieves summary telemetry statistics.
   */
  getTelemetry: () => {
    const count = metrics.latencies.length;
    if (count === 0) {
      return {
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
      totalRequests: metrics.totalRequests,
      totalErrors: metrics.totalErrors,
      p50LatencyMs: Math.round(sorted[p50Index]),
      p95LatencyMs: Math.round(sorted[p95Index]),
      averageLatencyMs: Math.round(avg),
    };
  },
};
