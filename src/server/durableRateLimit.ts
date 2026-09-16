/**
 * Durable rate limiting.
 *
 * The previous limiters were `express-rate-limit`'s default in-memory store.
 * That is per-process state, and on a serverless runtime each instance keeps its
 * own counters — so the effective limit was "N per instance per window", which
 * is not a limit at all when there are twenty instances. The per-*account*
 * lockout was made durable earlier (that is the control that protects a 4-digit
 * PIN); this closes the per-*address* gap.
 *
 * Two layers, on purpose:
 *   1. An in-process counter, checked first. It costs nothing and absorbs a
 *      burst locally.
 *   2. A shared counter in Postgres, which is what actually enforces the limit
 *      across instances.
 *
 * Failure behaviour: if the shared store cannot be reached, the limiter falls
 * back to the in-process decision **and logs a warning**. Availability wins
 * here: refusing all sign-ins because the limiter's table is unreachable would
 * turn a monitoring blip into a clinic outage. The per-account lockout, which
 * is what stops PIN guessing, is still enforced from the same database the
 * credentials come from — so if that is down, nothing authenticates anyway.
 */

import type { RateLimitStore } from './stores';

type Middleware = (req: any, res: any, next: (err?: any) => void) => any;

export interface DurableRateLimitDeps {
  store: RateLimitStore;
  logger: {
    warn: (message: string, context?: Record<string, any>) => void;
  };
}

export interface DurableRateLimitOptions {
  /** Stable prefix so different limits never share a counter. */
  name: string;
  windowMs: number;
  max: number;
  /** Which request attribute identifies the caller. Defaults to the client address. */
  keyOf?: (req: any) => string;
  /** Skip the limiter entirely (for example in the test suite). */
  skip?: (req: any) => boolean;
  message?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

export function createDurableRateLimit(
  deps: DurableRateLimitDeps,
  options: DurableRateLimitOptions
): Middleware {
  const now = options.now || (() => Date.now());
  const local = new Map<string, { hits: number; expiresAt: number }>();
  const keyOf = options.keyOf || ((req: any) => req.ip || req.socket?.remoteAddress || 'unknown');
  const message =
    options.message || 'Too many requests from this address. Please wait and try again.';

  /** Local counter, pruned opportunistically so the map cannot grow unboundedly. */
  function localHit(key: string): number {
    const current = now();
    for (const [k, entry] of local) {
      if (entry.expiresAt <= current) local.delete(k);
    }
    const entry = local.get(key);
    if (!entry || entry.expiresAt <= current) {
      local.set(key, { hits: 1, expiresAt: current + options.windowMs });
      return 1;
    }
    entry.hits += 1;
    return entry.hits;
  }

  return async function durableRateLimit(req: any, res: any, next: (err?: any) => void) {
    if (options.skip && options.skip(req)) return next();

    const identity = String(keyOf(req) || 'unknown');
    const key = `${options.name}:${identity}`;
    const localHits = localHit(key);

    // A locally-exhausted bucket is conclusive — no need to ask the store.
    if (localHits > options.max) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    }

    let hits = localHits;
    try {
      const shared = await deps.store.hit(key, options.windowMs);
      // The shared counter is authoritative; the local one is only a shield.
      hits = Math.max(shared.hits, localHits);
      const remaining = Math.max(0, options.max - hits);
      // Both the IETF draft name and the widely-supported X- form, so existing
      // clients (and the test suite) keep reading the budget they expect.
      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Limit', String(options.max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
    } catch (err: any) {
      deps.logger.warn(
        `Shared rate-limit store unavailable for "${options.name}"; using this instance's counter only.`,
        { error: err?.message || String(err) }
      );
    }

    if (hits > options.max) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    }
    return next();
  };
}
