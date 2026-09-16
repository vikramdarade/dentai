/**
 * Registration gate.
 *
 * Every new account receives its own daily AI allowance, so unlimited sign-ups
 * are effectively unlimited spend on the shared model key: the per-clinic
 * metering never sees it, because each attacker-created account is its own
 * "clinic". The general API budget (100 requests / 15 minutes per address) is
 * far too loose to bound that.
 *
 * Two levers, both env-driven so they need no redeploy to change behaviour:
 *
 *   DENTAI_ALLOW_SELF_SIGNUP=false  close registration entirely (default: open).
 *                                   Use while onboarding a practice by hand, or
 *                                   the moment accounts are created abusively.
 *   registration limiter            5 new accounts per hour per address, on top
 *                                   of the global API limit.
 *
 * Registered as a path-scoped middleware so it runs before the signup handler
 * regardless of where that handler lives in the server file.
 */

type Middleware = (req: any, res: any, next: (err?: any) => void) => any;

export interface SignupGuardDeps {
  rateLimit: (options: Record<string, any>) => Middleware;
  logger: {
    warn: (message: string, context?: Record<string, any>) => void;
  };
}

/** True when dentists may create their own profiles. Open unless explicitly closed. */
export function selfSignupAllowed(): boolean {
  return (process.env.DENTAI_ALLOW_SELF_SIGNUP || 'true') !== 'false';
}

export function createSignupGuard(deps: SignupGuardDeps): Middleware[] {
  const limiter = deps.rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    // The suite registers far more accounts than a practice ever would.
    skip: () => process.env.NODE_ENV === 'test',
    message: {
      error: 'Too many new accounts from this address. Please wait an hour or contact support.',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const gate: Middleware = (req, res, next) => {
    if (selfSignupAllowed()) return next();
    deps.logger.warn('Rejected signup because self-serve registration is closed', {
      url: req.originalUrl,
    });
    return res.status(403).json({
      error: 'Self-serve signup is closed on this deployment. Contact your practice administrator or support.',
      code: 'SIGNUP_CLOSED',
    });
  };

  return [limiter, gate];
}
