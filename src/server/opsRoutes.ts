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

import crypto from 'crypto';

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
  /**
   * Builds a durable per-address limiter for the operator routes.
   *
   * Passed in rather than created here because the shared counter lives in the
   * same store as the rest of the app's limits. A limiter is applied to every
   * operator route, in addition to the app-wide `/api/` limiter: these endpoints
   * accept a shared secret and a brute-force attempt should be throttled at the
   * route, not only by a global ceiling.
   */
  createRateLimit: (options: {
    name: string;
    windowMs?: number;
    max?: number;
    message?: string;
  }) => (req: any, res: any, next: (err?: any) => void) => any;
  /** Migration/schema version reported in health output. */
  schemaVersion: string;
  /**
   * Configuration readiness, as counts only. `/api/health` is public, so it
   * must never name a missing secret — the full report is at /api/ops/config.
   */
  configuration?: () => { readiness: string; blocking: number; advisories: number };
  /** Migration label read from the ledger, e.g. "v2". */
  migrationLabel?: () => string;
  /**
   * Effective note-generation model settings (model id, thinking level,
   * latency budgets). Operator-only, and the first thing to check when a
   * practice reports that notes are slow: thinking left on at a higher level
   * than intended is invisible in the model name but costs seconds per note.
   */
  generation?: () => Record<string, any>;
}

const STARTED_AT = Date.now();

/**
 * The operator session cookie.
 *
 * A browser cannot send a custom header on navigation, so the console cannot be
 * authenticated with `x-dentai-ops-secret` alone. Rather than accept the secret
 * as a query parameter — which puts it in browser history, `Referer` headers and
 * the platform's access logs — the console exchanges the secret once, in a POST
 * body, for a short-lived signed cookie.
 */
export const OPS_SESSION_COOKIE = 'dentai_ops_session';

/** An operator session is deliberately short: re-authentication is one paste. */
export const OPS_SESSION_TTL_MS = 60 * 60 * 1000;

/** Reads the operational secret from either accepted header. */
export function readOpsSecret(headers: Record<string, any>): string {
  return (
    (headers['x-dentai-ops-secret'] as string | undefined) ||
    (headers['x-cron-secret'] as string | undefined) ||
    ((headers['authorization'] as string | undefined) || '').replace(/^Bearer\s+/i, '') ||
    ''
  );
}

/** Constant-time compare that tolerates different lengths. */
function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Reads one cookie value. Hand-rolled so no dependency is added for this. */
export function readCookie(headers: Record<string, any>, name: string): string {
  const raw = headers?.cookie;
  if (typeof raw !== 'string' || !raw) return '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Issues a session token: `<payload>.<hmac>`, signed with the operator secret.
 *
 * The signature is what makes the cookie safe to hold in a browser — it cannot
 * be minted or edited without the secret, and it expires on its own. The secret
 * itself is never placed in the cookie, so a leaked cookie does not reveal it
 * and can be revoked by rotating DENTAI_OPS_SECRET.
 */
export function createOpsSession(
  secret: string,
  now: number = Date.now()
): { token: string; expiresAt: number } {
  const expiresAt = now + OPS_SESSION_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ exp: expiresAt, nonce: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

/** Verifies a session token's signature and expiry. Never throws. */
export function verifyOpsSession(
  token: string,
  secret: string,
  now: number = Date.now()
): boolean {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!timingSafeEquals(signature, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims?.exp === 'number' && claims.exp > now;
  } catch {
    return false;
  }
}

/**
 * Builds the operator guard so other route modules (opsActions) enforce exactly
 * the same rule as this file, rather than re-implementing it and drifting.
 *
 * Two credentials are accepted, and only two:
 *   1. the operator secret in a header — for `curl`, cron and the test suite;
 *   2. a valid, unexpired session cookie — for the console in a browser.
 * The secret is never accepted from a query parameter.
 */
export function createOpsGuard(
  deps: Pick<OpsRouteDeps, 'constantTimeEquals'> & {
    // Only `warn` is used here, and saying so keeps a caller from having to
    // construct a whole logger to reuse the guard in a test.
    logger: { warn: (message: string, context?: Record<string, any>) => void };
  }
) {
  return (req: any, res: any, next: (err?: any) => void) => {
    const expected = process.env.DENTAI_OPS_SECRET || '';
    if (!expected) {
      return res.status(503).json({
        error: 'Operational endpoints are disabled. Set DENTAI_OPS_SECRET to enable them.',
        code: 'OPS_DISABLED',
      });
    }
    const provided = readOpsSecret(req.headers || {});
    if (provided && deps.constantTimeEquals(provided, expected)) {
      return next();
    }
    const session = readCookie(req.headers || {}, OPS_SESSION_COOKIE);
    if (session && verifyOpsSession(session, expected)) {
      return next();
    }
    deps.logger.warn('Rejected operator request with an invalid secret', { url: req.originalUrl });
    return res.status(401).json({
      error: 'Operational secret required.',
      code: 'OPS_SECRET_REQUIRED',
      hint: 'Sign in at GET /api/ops/console, or send x-dentai-ops-secret.',
    });
  };
}

export function registerOpsRoutes(app: any, deps: OpsRouteDeps): void {
  // Delegated rather than re-implemented, so the session-cookie rule and the
  // header rule cannot drift apart between the two operator modules.
  const requireOps = createOpsGuard(deps);

  /**
   * Operator routes are throttled per address, before authentication.
   *
   * Deliberately generous: the console polls the funnel and telemetry, and a
   * founder refreshing a dashboard must never be locked out. It exists to stop a
   * secret-guessing loop, not to meter normal use, so the test suite skips it.
   */
  const opsRateLimit = deps.createRateLimit({
    name: 'ops-routes',
    windowMs: 60_000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 60,
    message: 'Too many operator requests from this address. Wait a moment and try again.',
  });

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
  app.get('/api/ops/telemetry', opsRateLimit, requireOps, async (_req: any, res: any) => {
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
      generation: deps.generation ? deps.generation() : undefined,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    });
  });

  /**
   * Drain the note queue now, authenticated with the operator secret.
   * For a human or an external pinger (see docs/runbooks/queue-scheduling.md).
   */
  app.post('/api/ops/drain', opsRateLimit, requireOps, async (_req: any, res: any) => {
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
