/**
 * AI usage metering middleware.
 *
 * Why this exists as middleware rather than inline in each route: the product
 * has two generation paths (the async job fabric and the legacy synchronous
 * endpoint), and a previous version metered only one of them. The synchronous
 * path was therefore the cheapest way to bypass a clinic's daily allowance, the
 * priority queue and the durable server-side completion. A single middleware
 * applied to every generation route makes "all generation spends the same
 * budget" a structural property instead of something each handler must
 * remember.
 *
 * Design rules:
 *  - Unauthenticated callers are refused before any work happens.
 *  - Fail closed. If the usage store cannot be read we refuse to generate: we
 *    must never spend money on a clinic's behalf without being able to count it.
 *  - Two ceilings, not one. A note count does not bound cost (one long
 *    transcript can cost more than a day of short consults), so tokens/day is
 *    enforced as well.
 *  - Fair share. The clinic (or the solo dentist, when they have no clinic yet)
 *    is the accountable unit, so one heavy user cannot starve another.
 *  - Usage is recorded only when a generation actually succeeded, and the
 *    response is never blocked on the recording write.
 */

export interface AiMeteringDeps {
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  /** Session authentication, composed here so the middleware can read req.dentist. */
  authenticate: (req: any, res: any, next: (err?: any) => void) => any;
  resolveClinicScope: (dentistId: string, requestedClinicId: unknown) => Promise<string | undefined>;
  getUsageCountToday: (scopeId: string) => Promise<number>;
  getTokensUsedToday: (scopeId: string) => Promise<number>;
  recordUsageEvent: (scopeId: string, dentistId: string, kind: string, tokens: number) => Promise<void>;
  /**
   * The allowance that actually applies to this clinic: its plan, capped by the
   * operator's global cost ceiling. Resolved per request because it depends on
   * the clinic's subscription state, which can change mid-day.
   */
  resolveDailyLimits: (scopeId: string) => Promise<{ notes: number; tokens: number }>;
  usageSnapshotFor: (scopeId: string, used: number, limit: number) => Record<string, any>;
  approxTokens: (transcript: any[]) => number;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
}

export interface AiMeteringOptions {
  /** Route label used in audit events, e.g. 'generate-notes' or 'notes-jobs'. */
  route: string;
  /** Record a successful generation against the clinic's allowance. */
  recordUsage: boolean;
  /** Usage kind written to the ledger. */
  usageKind?: string;
  /** Only enforce on this HTTP method (e.g. POST); other methods pass straight through. */
  onlyMethod?: string;
}

type Middleware = (req: any, res: any, next: (err?: any) => void) => any;

export function createAiMetering(deps: AiMeteringDeps, options: AiMeteringOptions): Middleware {
  const { route, recordUsage, usageKind = 'ai_note', onlyMethod } = options;

  return function aiMetering(req: any, res: any, next: (err?: any) => void) {
    if (onlyMethod && String(req.method || '').toUpperCase() !== onlyMethod.toUpperCase()) {
      return next();
    }

    return deps.authenticate(req, res, async (err?: any) => {
      if (err) return next(err);

      const dentistId: string | undefined = req?.dentist?.id;
      if (!dentistId) {
        return res.status(401).json({ error: 'Access token required.' });
      }

      let scopeId: string;
      try {
        scopeId = (await deps.resolveClinicScope(dentistId, req.body?.clinicId)) || dentistId;
      } catch (scopeErr: any) {
        deps.logger.error(`Metering scope resolution failed on ${route}:`, scopeErr?.message || scopeErr, {
          url: req.originalUrl,
        });
        return res.status(503).json({
          error:
            'Usage metering is unavailable, so AI generation is paused. Your transcript is preserved — draft offline or retry shortly.',
          code: 'METERING_UNAVAILABLE',
        });
      }

      try {
        const limits = await deps.resolveDailyLimits(scopeId);
        const used = await deps.getUsageCountToday(scopeId);
        const noteLimit = limits.notes;
        const usage = deps.usageSnapshotFor(scopeId, used, noteLimit);
        if (usage.exceeded) {
          await deps.logAudit('note_generation_metered', dentistId, { scopeId, used, noteLimit, route });
          return res.status(429).json({
            error: `This clinic has used all ${noteLimit} AI notes for today. You can draft the note offline from the transcript — it will be available again tomorrow.`,
            code: 'QUOTA_DAILY',
            usage,
          });
        }

        const tokenCap = limits.tokens;
        const tokensUsed = await deps.getTokensUsedToday(scopeId);
        if (tokensUsed >= tokenCap) {
          await deps.logAudit('note_generation_token_cap', dentistId, { scopeId, tokensUsed, tokenCap, route });
          return res.status(429).json({
            error:
              'This clinic has reached its AI processing budget for today. Draft the note offline, or continue tomorrow.',
            code: 'QUOTA_TOKENS',
            tokensUsed,
            tokenCap,
          });
        }
      } catch (meterErr: any) {
        deps.logger.error(`Metering check failed on ${route}:`, meterErr?.message || meterErr, {
          url: req.originalUrl,
        });
        return res.status(503).json({
          error:
            'Usage metering is unavailable, so AI generation is paused. Your transcript is preserved — draft offline or retry shortly.',
          code: 'METERING_UNAVAILABLE',
        });
      }

      if (!recordUsage) return next();

      // Record against the clinic only when the generation actually succeeded.
      // Never awaited: a slow ledger write must not delay a clinician, and a
      // failure to record must not lose a note that was already generated.
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (res.statusCode < 400) {
          const transcript = Array.isArray(req.body?.transcript) ? req.body.transcript : [];
          const tokens = deps.approxTokens(transcript);
          void deps
            .recordUsageEvent(scopeId, dentistId, usageKind, tokens)
            .catch((recordErr: any) =>
              deps.logger.error(`Failed to record AI usage for ${route}:`, recordErr?.message || recordErr, {
                scopeId,
              })
            );
        }
        return originalJson(body);
      };

      return next();
    });
  };
}
