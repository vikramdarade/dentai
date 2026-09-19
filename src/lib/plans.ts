/**
 * Plans and entitlements.
 *
 * Before this file, the only ceiling on a clinic was a global environment
 * variable: every clinic got the same allowance whether it was paying nothing
 * or paying for four chairs. That is fine for a pilot and wrong for a business —
 * so the commercial allowance now comes from the clinic's subscription, and the
 * environment variable stays as the last-resort cost cap (the thing that stops
 * a runaway client turning into a runaway invoice regardless of plan).
 *
 * The rules here are pure and shared, so the metering middleware, the signup
 * path, the ops console and the tests cannot disagree about what a plan means.
 *
 * Statuses are deliberately conservative: anything that is not clearly paid-for
 * and in-period resolves to the trial allowance. Being wrong in that direction
 * costs a courtesy note; being wrong the other way gives the product away.
 */

export type PlanId = 'trial' | 'solo' | 'practice' | 'enterprise';

/** Stripe subscription statuses that still entitle the clinic to service. */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);
/** Statuses that get a grace period (card failed, retrying) rather than a stop. */
const GRACE_STATUSES = new Set(['past_due', 'incomplete']);

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** AI notes per clinic per day. */
  dailyNotes: number;
  /** Transcript tokens per clinic per day — the real cost ceiling. */
  dailyTokens: number;
  /** Clinicians who can be active members of the clinic. */
  seats: number;
  /** AUD per month, excluding GST, charged per clinic. 0 = not self-serve. */
  monthlyAudExGst: number;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  trial: {
    id: 'trial',
    name: 'Trial',
    dailyNotes: 15,
    dailyTokens: 60_000,
    seats: 6,
    monthlyAudExGst: 0,
    features: [
      'Full note generation and template library',
      'Offline draft engine when quota is exhausted',
      '14-day evaluation, up to 6 clinicians',
    ],
  },
  solo: {
    id: 'solo',
    name: 'Solo',
    dailyNotes: 15,
    dailyTokens: 60_000,
    seats: 1,
    monthlyAudExGst: 0,
    features: [
      'Free forever for solo clinicians, associates and locums',
      '15 AI notes per day with all 8 ADA procedure templates',
      'Offline draft engine with zero lost charts',
      'Personal consultation history and record export',
    ],
  },
  practice: {
    id: 'practice',
    name: 'Practice',
    dailyNotes: 200,
    dailyTokens: 750_000,
    seats: 6,
    monthlyAudExGst: 149,
    features: [
      'Up to 6 clinician seats with centralized multi-chair compliance',
      'Team template standards and full practice audit trails',
      'Priority AI generation queue for emergency notes',
      'Treatment recall worklist and revenue recovery engine',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Group',
    dailyNotes: 1_000,
    dailyTokens: 4_000_000,
    seats: 100,
    monthlyAudExGst: 0,
    features: [
      'Multi-site groups and custom retention',
      'Signed data-processing terms and security review',
      'Named support contact and onboarding',
    ],
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLANS, value);
}

/** Determines whether a clinic with currentMembersCount active clinicians has capacity for another seat. */
export function isSeatAvailable(currentMembersCount: number, planId: PlanId): boolean {
  const plan = PLANS[planId] || PLANS.trial;
  return currentMembersCount < plan.seats;
}

/** Maps a legacy/`tier` value onto a plan id. */
export function planFromTier(tier: unknown): PlanId {
  if (tier === 'solo' || tier === 'practice' || tier === 'enterprise') return tier;
  return 'trial';
}

export interface EntitlementInput {
  plan?: string | null;
  status?: string | null;
  currentPeriodEnd?: string | null;
}

export interface Entitlements {
  plan: PlanId;
  planName: string;
  dailyNotes: number;
  dailyTokens: number;
  seats: number;
  /** True when the clinic is paying, in period, and not cancelled. */
  active: boolean;
  /** True when the clinic is in a payment grace period. */
  inGrace: boolean;
  /** True when service should be limited to the trial allowance. */
  limited: boolean;
  /** What the account state means, for the UI and for support. */
  reason:
    | 'active'
    | 'grace_period'
    | 'period_ended'
    | 'payment_failed'
    | 'cancelled'
    | 'no_subscription';
}

/**
 * Resolves what a clinic is entitled to right now.
 *
 * `now` is injectable so the expiry behaviour can be tested without waiting.
 */
export function resolveEntitlements(
  input: EntitlementInput | null | undefined,
  now: Date = new Date()
): Entitlements {
  const trial = PLANS.trial;

  if (!input || !input.plan) {
    return {
      plan: 'trial',
      planName: trial.name,
      dailyNotes: trial.dailyNotes,
      dailyTokens: trial.dailyTokens,
      seats: trial.seats,
      active: false,
      inGrace: false,
      limited: true,
      reason: 'no_subscription',
    };
  }

  const plan = planFromTier(input.plan);
  const definition = PLANS[plan];
  const status = String(input.status || '').toLowerCase();
  const periodEnd = input.currentPeriodEnd ? Date.parse(input.currentPeriodEnd) : NaN;
  const periodValid = Number.isNaN(periodEnd) ? true : periodEnd > now.getTime();

  const grantFull = (reason: Entitlements['reason'], inGrace = false): Entitlements => ({
    plan,
    planName: definition.name,
    dailyNotes: definition.dailyNotes,
    dailyTokens: definition.dailyTokens,
    seats: definition.seats,
    active: true,
    inGrace,
    limited: false,
    reason,
  });

  if (ACTIVE_STATUSES.has(status)) {
    // A cancelled subscription keeps working until the period it has paid for
    // ends — that is what the customer bought.
    return periodValid ? grantFull('active') : grantFull('period_ended');
  }

  const lapsed = (reason: Entitlements['reason']): Entitlements => ({
    plan: 'trial',
    planName: trial.name,
    dailyNotes: trial.dailyNotes,
    dailyTokens: trial.dailyTokens,
    seats: trial.seats,
    active: false,
    inGrace: false,
    limited: true,
    reason,
  });

  if (status === 'canceled' || status === 'cancelled') {
    // Still inside the period they paid for: they keep the plan, it just will
    // not renew. Past that, they are on the trial allowance like anyone else.
    return periodValid ? grantFull('period_ended') : lapsed('cancelled');
  }

  if (GRACE_STATUSES.has(status)) {
    // A failed payment gets a grace period while Stripe retries. Once the paid
    // period has also lapsed, though, the practice is not paying — chargebacks
    // and abandoned cards land here, and "still full access" is not defensible.
    return periodValid ? grantFull('grace_period', true) : lapsed('payment_failed');
  }

  if (status === 'unpaid') return lapsed('payment_failed');

  // Unknown status: treat as unpaid rather than give the product away.
  return lapsed('no_subscription');
}

/**
 * The daily allowance actually applied to a clinic.
 *
 * `envCap` is the operator's global cost cap and is applied with `min`, so a
 * plan can never raise the ceiling beyond what the founder is willing to spend
 * on the shared model key, and an operator can throttle everything instantly
 * without touching subscriptions.
 */
export function effectiveDailyLimits(
  entitlements: Entitlements,
  envCap: { notes: number; tokens: number }
): { notes: number; tokens: number } {
  return {
    notes: Math.max(1, Math.min(entitlements.dailyNotes, envCap.notes)),
    tokens: Math.max(1, Math.min(entitlements.dailyTokens, envCap.tokens)),
  };
}

/** Human-readable plan summary for receipts, emails and the ops console. */
export function describePlan(plan: PlanId): string {
  const p = PLANS[plan];
  const price = p.monthlyAudExGst > 0 ? `A$${p.monthlyAudExGst}/mo ex GST` : (p.id === 'solo' ? 'Free Forever' : 'quoted');
  return `${p.name} — ${p.seats} clinician${p.seats === 1 ? '' : 's'}, ${p.dailyNotes} AI notes/day, ${price}`;
}
