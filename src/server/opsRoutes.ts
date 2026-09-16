/**
 * Operator surface: health, telemetry and queue visibility.
 *
 * A solo operator needs three questions answered without reading logs:
 *   1. Is the service up, and is it actually talking to the database?
 *   2. Is the note queue draining?
 *   3. Is anything erroring right now?
 *
 * `/api/health` is intentionally public (uptime monitors are unauthenticated)
 * and intentionally boring: no identifiers, no counts a competitor would care
 * about, just status. Everything richer lives behind DENTAI_OPS_SECRET.
 *
 * The legacy `/api/telemetry` route is replaced here with a 401 by design: it
 * used to publish process metrics to anyone who asked, and those metrics were
 * per-instance on a serverless runtime (so they were also misleading). The
 * protected replacement is `/api/ops/telemetry`.
 */

export interface OpsRouteDeps {
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
    getTelemetry: () => Record<string, any>;
    alertingEnabled: () => boolean;
  };
  dbEnabled: boolean;
  dbPing: () => Promise<boolean>;
  countOpenNoteJobs: () => Promise<number>;
  drainQueue: () => Promise<number>;
  /** Constant-time comparison, reusing the session-signature helper. */
  constantTimeEquals: (a: string, b: string) => boolean;
  /** Migration/schema version reported in health output. */
  schemaVersion: string;
  /**
   * Configuration readiness, as counts only. `/api/health` is public, so it
   * must never name a missing secret — the full report is at /api/ops/config.
   */
  configuration?: () => { readiness: string; blocking: number; advisories: number };
  /** Migration label read from the ledger, e.g. "v2". */
  migrationLabel?: () => string;
}

const STARTED_AT = Date.now();

/** Reads the operational secret from either accepted header. */
export function readOpsSecret(headers: Record<string, any>): string {
  return (
    (headers['x-dentai-ops-secret'] as string | undefined) ||
    (headers['x-cron-secret'] as string | undefined) ||
    ((headers['authorization'] as string | undefined) || '').replace(/^Bearer\s+/i, '') ||
    ''
  );
}

/**
 * Builds the operator guard so other route modules (opsActions) enforce exactly
 * the same rule as this file, rather than re-implementing it and drifting.
 */
export function createOpsGuard(deps: Pick<OpsRouteDeps, 'constantTimeEquals' | 'logger'>) {
  return (req: any, res: any, next: (err?: any) => void) => {
    const expected = process.env.DENTAI_OPS_SECRET || '';
    if (!expected) {
      return res.status(503).json({
        error: 'Operational endpoints are disabled. Set DENTAI_OPS_SECRET to enable them.',
        code: 'OPS_DISABLED',
      });
    }
    const provided = readOpsSecret(req.headers || {});
    if (!provided || !deps.constantTimeEquals(provided, expected)) {
      deps.logger.warn('Rejected operator request with an invalid secret', { url: req.originalUrl });
      return res.status(401).json({ error: 'Operational secret required.' });
    }
    return next();
  };
}

export function registerOpsRoutes(app: any, deps: OpsRouteDeps): void {
  const requireOps = (req: any, res: any, next: (err?: any) => void) => {
    const expected = process.env.DENTAI_OPS_SECRET || '';
    if (!expected) {
      return res.status(503).json({
        error: 'Operational endpoints are disabled. Set DENTAI_OPS_SECRET to enable them.',
        code: 'OPS_DISABLED',
      });
    }
    const provided = readOpsSecret(req.headers || {});
    if (!provided || !deps.constantTimeEquals(provided, expected)) {
      deps.logger.warn('Rejected operator request with an invalid secret', { url: req.originalUrl });
      return res.status(401).json({ error: 'Operational secret required.' });
    }
    return next();
  };

  /**
   * Public liveness/readiness probe.
   * 200 = serving; 503 = serving but degraded (database unreachable).
   */
  app.get('/api/health', async (_req: any, res: any) => {
    const storage = deps.dbEnabled ? 'postgres' : 'file-fallback';
    let database: 'ok' | 'unavailable' | 'not-configured' = 'not-configured';
    if (deps.dbEnabled) {
      try {
        database = (await deps.dbPing()) ? 'ok' : 'unavailable';
      } catch {
        database = 'unavailable';
      }
    }
    const degraded = deps.dbEnabled && database !== 'ok';
    res.status(degraded ? 503 : 200).json({
      status: degraded ? 'degraded' : 'ok',
      storage,
      database,
      schemaVersion: deps.schemaVersion,
      migrations: deps.migrationLabel ? deps.migrationLabel() : undefined,
      configuration: deps.configuration ? deps.configuration() : undefined,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      alerting: deps.logger.alertingEnabled(),
      timestamp: new Date().toISOString(),
    });
  });

  /** Process-instance metrics plus queue depth, for the operator only. */
  app.get('/api/ops/telemetry', requireOps, async (_req: any, res: any) => {
    let openNoteJobs: number | null = null;
    try {
      openNoteJobs = deps.dbEnabled ? await deps.countOpenNoteJobs() : null;
    } catch (err: any) {
      deps.logger.warn('Could not read queue depth for telemetry:', err?.message || err);
    }
    res.json({
      ...deps.logger.getTelemetry(),
      storage: deps.dbEnabled ? 'postgres' : 'file-fallback',
      openNoteJobs,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    });
  });

  /**
   * Drain the note queue now, authenticated with the operator secret.
   * For a human or an external pinger (see docs/runbooks/queue-scheduling.md).
   */
  app.post('/api/ops/drain', requireOps, async (_req: any, res: any) => {
    const openNoteJobs = await deps.drainQueue();
    res.json({ ok: true, openNoteJobs });
  });

  /**
   * Scheduler entry point.
   *
   * A platform scheduler (Vercel Cron, GitHub Actions, cron-job.org) cannot
   * send an operator secret it was not given, so this route authenticates
   * against CRON_SECRET instead of DENTAI_OPS_SECRET. Vercel sends
   * `Authorization: Bearer $CRON_SECRET`; other schedulers should send
   * `x-cron-secret`. GET and POST are both accepted because platforms differ.
   *
   * This is the route that makes note completion genuinely durable: without a
   * tick from something other than a browser, a queued note on a closed tab has
   * nobody to advance it.
   */
  const requireCron = (req: any, res: any, next: (err?: any) => void) => {
    const expected = process.env.CRON_SECRET || '';
    if (!expected) {
      return res.status(503).json({
        error: 'Scheduled draining is disabled. Set CRON_SECRET and point a scheduler at /api/cron/drain.',
        code: 'CRON_DISABLED',
      });
    }
    const provided = readOpsSecret(req.headers || {});
    if (!provided || !deps.constantTimeEquals(provided, expected)) {
      deps.logger.warn('Rejected scheduled drain with an invalid secret', { url: req.originalUrl });
      return res.status(401).json({ error: 'Invalid scheduler secret.' });
    }
    return next();
  };

  const runScheduledDrain = async (_req: any, res: any) => {
    try {
      const openNoteJobs = await deps.drainQueue();
      deps.logger.info('[Queue] Scheduled drain complete', { openNoteJobs });
      res.json({ ok: true, openNoteJobs });
    } catch (err: any) {
      deps.logger.error('Scheduled queue drain failed:', err?.message || err);
      res.status(500).json({ ok: false, error: 'Queue drain failed.' });
    }
  };

  app.get('/api/cron/drain', requireCron, runScheduledDrain);
  app.post('/api/cron/drain', requireCron, runScheduledDrain);

  /**
   * The unauthenticated telemetry endpoint is retired. Registered before the
   * legacy handler so this refusal wins; the legacy route should be deleted
   * when server.ts is next restructured.
   */
  app.get('/api/telemetry', (_req: any, res: any) => {
    res.status(401).json({
      error: 'Telemetry is operator-only. Use GET /api/ops/telemetry with the operational secret.',
      code: 'OPS_SECRET_REQUIRED',
    });
  });

  /**
   * In-process queue drain for long-running hosts.
   *
   * Serverless deployments cannot rely on this (functions are frozen between
   * requests), so they need the external scheduler described in
   * docs/runbooks/queue-scheduling.md. A persistent host (`node server.js` on a
   * VM or container) should set DENTAI_QUEUE_INTERVAL_MS and never needs the
   * external pinger. Off unless configured, and never in tests.
   */
  const intervalMs = Number(process.env.DENTAI_QUEUE_INTERVAL_MS);
  if (Number.isFinite(intervalMs) && intervalMs >= 10_000 && process.env.NODE_ENV !== 'test') {
    const timer = setInterval(() => {
      void deps
        .drainQueue()
        .catch((err: any) => deps.logger.error('Scheduled queue drain failed:', err?.message || err));
    }, intervalMs);
    // Never hold the process open just for a drain tick.
    if (typeof timer.unref === 'function') timer.unref();
    deps.logger.info(`[Queue] In-process drain scheduled every ${Math.round(intervalMs / 1000)}s.`);
  }
}
