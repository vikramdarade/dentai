/**
 * Billing and entitlements.
 *
 * Three problems this closes:
 *   1. A `subscriptions` table existed with a `stripe_subscription_id` column
 *      and nothing read or wrote it — no card was ever charged and nothing ever
 *      suspended a clinic.
 *   2. `POST /api/billing/webhook` read the request body and trusted it. Anyone
 *      who could reach the endpoint could POST a hand-written
 *      `checkout.session.completed` and grant themselves any plan.
 *   3. `stripe` was not a dependency, so the live code path could not have
 *      worked anyway — the mock path silently returned a fake success URL.
 *
 * Approach:
 *   - **No SDK.** Stripe's API is form-encoded POSTs and its webhook signature
 *     is `HMAC-SHA256(timestamp + "." + payload)`, so `fetch` and `crypto` are
 *     enough. Nothing to keep updated, and the signature check is visible rather
 *     than hidden behind a library.
 *   - **Fail closed.** Without `STRIPE_WEBHOOK_SECRET`, the webhook returns 503
 *     and does nothing. It never processes an unverified event.
 *   - **Replay protection.** The signed timestamp must be inside a tolerance
 *     window, and each event id is processed exactly once.
 *   - **Manual activation stays possible.** A solo founder will invoice the
 *     first practices by hand (bank transfer, or an annual invoice). The
 *     `activateManually` path gives a clinic real entitlements without Stripe,
 *     so the commercial model does not depend on the integration shipping.
 *
 * Entitlements are resolved from the stored subscription (see src/lib/plans.ts)
 * and cached briefly per clinic, because the metering middleware runs on every
 * generation request and must not add a database round-trip to each one.
 */

import crypto from 'crypto';
import {
  PLANS,
  effectiveDailyLimits,
  isPlanId,
  resolveEntitlements,
  type Entitlements,
  type PlanId,
} from '../lib/plans';
import type { BillingEventStore, SubscriptionRecord, SubscriptionStore } from './stores';

export interface BillingLogger {
  info: (message: string, context?: Record<string, any>) => void;
  warn: (message: string, context?: Record<string, any>) => void;
  error: (message: string, error?: any, context?: Record<string, any>) => void;
}

/* ---------------------------------------------------------------------------
 * Entitlement resolution
 * ------------------------------------------------------------------------- */

export interface EntitlementResolver {
  resolve(scopeId: string): Promise<Entitlements>;
  /** Called after a webhook or manual activation changes a clinic's plan. */
  invalidate(scopeId: string): void;
}

export interface EntitlementResolverDeps {
  store: SubscriptionStore;
  logger: BillingLogger;
  /** Cache lifetime in milliseconds. */
  ttlMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  env?: Record<string, string | undefined>;
}

export function createEntitlementResolver(deps: EntitlementResolverDeps): EntitlementResolver {
  const ttlMs = deps.ttlMs ?? 60_000;
  const now = deps.now || (() => Date.now());
  const env = deps.env || process.env;
  const cache = new Map<string, { expiresAt: number; value: Entitlements }>();

  /**
   * The operator's global cost cap, read per call rather than captured at
   * module load: it is the lever an operator pulls to stop runaway spend, and
   * it must take effect without a redeploy (and be settable in tests).
   */
  const envCaps = () => ({
    notes: Number(env.DENTAI_DAILY_NOTE_LIMIT) > 0 ? Number(env.DENTAI_DAILY_NOTE_LIMIT) : Infinity,
    tokens: Number(env.DENTAI_DAILY_TOKEN_LIMIT) > 0 ? Number(env.DENTAI_DAILY_TOKEN_LIMIT) : Infinity,
  });

  return {
    async resolve(scopeId) {
      const cached = cache.get(scopeId);
      if (cached && cached.expiresAt > now()) return cached.value;

      let entitlements: Entitlements;
      try {
        const subscription = await deps.store.forClinic(scopeId);
        entitlements = resolveEntitlements(
          subscription
            ? {
                plan: subscription.plan || subscription.tier,
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd,
              }
            : null
        );
      } catch (err: any) {
        // A billing lookup failure must not silently grant unlimited use, and
        // must not block a clinician either: fall back to the trial allowance.
        deps.logger.warn('Could not read subscription; using the trial allowance.', {
          scopeId,
          error: err?.message || String(err),
        });
        entitlements = resolveEntitlements(null);
      }

      const envCap = envCaps();
      const limits = effectiveDailyLimits(entitlements, {
        notes: envCap.notes === Infinity ? entitlements.dailyNotes : envCap.notes,
        tokens: envCap.tokens === Infinity ? entitlements.dailyTokens : envCap.tokens,
      });

      const value: Entitlements = {
        ...entitlements,
        dailyNotes: limits.notes,
        dailyTokens: limits.tokens,
      };
      cache.set(scopeId, { expiresAt: now() + ttlMs, value });
      return value;
    },

    invalidate(scopeId) {
      cache.delete(scopeId);
    },
  };
}

/* ---------------------------------------------------------------------------
 * Stripe webhook signature
 * ------------------------------------------------------------------------- */

export interface SignatureCheckInput {
  payload: string;
  header: string | undefined;
  secret: string;
  toleranceSeconds?: number;
  now?: () => number;
}

export interface SignatureCheckResult {
  ok: boolean;
  reason?: 'no_secret' | 'missing_header' | 'malformed_header' | 'timestamp_out_of_tolerance' | 'no_matching_signature';
  /** The signed timestamp, when it parsed. */
  timestamp?: number;
}

/**
 * Verifies a Stripe-Signature header against the raw request body.
 *
 * Exported and pure so it can be tested with Stripe's own documented example
 * and with tampered payloads — this is the control that stops anyone granting
 * themselves a plan.
 */
export function verifyStripeSignature(input: SignatureCheckInput): SignatureCheckResult {
  if (!input.secret) return { ok: false, reason: 'no_secret' };
  if (!input.header) return { ok: false, reason: 'missing_header' };

  const parts = input.header.split(',').reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split('=');
    if (!key || !value) return acc;
    acc[key.trim()] = acc[key.trim()] || [];
    acc[key.trim()].push(value.trim());
    return acc;
  }, {});

  const timestamp = Number(parts.t?.[0]);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'malformed_header' };

  const tolerance = (input.toleranceSeconds ?? 300) * 1000;
  const nowMs = input.now ? input.now() : Date.now();
  if (Math.abs(nowMs - timestamp * 1000) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance', timestamp };
  }

  const expected = crypto
    .createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest('hex');

  const candidates = parts.v1 || [];
  let matched = false;
  for (const candidate of candidates) {
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;
  }
  if (!matched) return { ok: false, reason: 'no_matching_signature', timestamp };
  return { ok: true, timestamp };
}

/* ---------------------------------------------------------------------------
 * Event handling
 * ------------------------------------------------------------------------- */

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

export function parseStripeEvent(payload: string): StripeEvent | null {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') return null;
    if (!parsed.data || typeof parsed.data.object !== 'object') return null;
    return { id: parsed.id, type: parsed.type, data: { object: parsed.data.object } };
  } catch {
    return null;
  }
}

export interface ApplyEventDeps {
  store: SubscriptionStore;
  events: BillingEventStore;
  logger: BillingLogger;
  /** Called when a clinic's plan changed, so caches can be dropped. */
  onChanged?: (clinicId: string) => void;
}

export interface ApplyEventResult {
  handled: boolean;
  duplicate?: boolean;
  clinicId?: string;
  plan?: PlanId;
  message: string;
}

function timestampToIso(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function planFromMetadata(object: Record<string, any>, fallback: PlanId = 'trial'): PlanId {
  const fromMetadata = object?.metadata?.plan;
  if (isPlanId(fromMetadata)) return fromMetadata;
  return fallback;
}

/** Applies a verified event. Idempotent: a replayed event id is ignored. */
export async function applyStripeEvent(
  event: StripeEvent,
  deps: ApplyEventDeps
): Promise<ApplyEventResult> {
  if (await deps.events.has(event.id)) {
    return { handled: false, duplicate: true, message: 'Event already processed.' };
  }

  const object = event.data.object;
  const nowIso = new Date().toISOString();

  const writeSubscription = async (
    clinicId: string,
    patch: Partial<SubscriptionRecord> & { plan: PlanId; status: string }
  ): Promise<void> => {
    const existing =
      (await deps.store.byStripeSubscriptionId(String(object.id || ''))) ||
      (await deps.store.forClinic(clinicId));

    const record: SubscriptionRecord = {
      id: existing?.id || crypto.randomUUID(),
      clinicId,
      plan: patch.plan,
      tier: patch.plan,
      status: patch.status,
      seats: patch.seats ?? existing?.seats ?? PLANS[patch.plan].seats,
      stripeCustomerId: patch.stripeCustomerId ?? existing?.stripeCustomerId ?? null,
      stripeSubscriptionId: patch.stripeSubscriptionId ?? existing?.stripeSubscriptionId ?? null,
      currentPeriodEnd: patch.currentPeriodEnd ?? existing?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: patch.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
      activatedBy: patch.activatedBy ?? existing?.activatedBy ?? 'stripe',
      updatedAt: nowIso,
    };
    await deps.store.upsert(record);
    await deps.events.record({
      id: event.id,
      clinicId,
      kind: event.type,
      detail: { plan: record.plan, status: record.status },
    });
    deps.onChanged?.(clinicId);
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const clinicId = String(object.metadata?.clinicId || '');
      if (!clinicId) {
        deps.logger.warn('Stripe checkout completed without a clinicId in metadata; ignoring.', {
          eventId: event.id,
        });
        await deps.events.record({ id: event.id, clinicId: null, kind: event.type, detail: {} });
        break;
      }
      await writeSubscription(clinicId, {
        plan: planFromMetadata(object, 'solo'),
        status: 'active',
        stripeCustomerId: object.customer ? String(object.customer) : null,
        stripeSubscriptionId: object.subscription ? String(object.subscription) : null,
      });
      return { handled: true, clinicId, plan: planFromMetadata(object, 'solo'), message: 'Checkout completed.' };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const plan = planFromMetadata(object, 'solo');
      const status =
        event.type === 'customer.subscription.deleted'
          ? 'canceled'
          : String(object.status || 'active');
      let clinicId = String(object.metadata?.clinicId || '');
      if (!clinicId && object.customer) {
        const existing = await deps.store.byStripeCustomerId(String(object.customer));
        clinicId = existing?.clinicId || '';
      }
      if (!clinicId) {
        deps.logger.warn('Subscription event has no resolvable clinic; ignoring.', {
          eventId: event.id,
        });
        await deps.events.record({ id: event.id, clinicId: null, kind: event.type, detail: {} });
        break;
      }
      await writeSubscription(clinicId, {
        plan,
        status,
        stripeCustomerId: object.customer ? String(object.customer) : null,
        stripeSubscriptionId: String(object.id || ''),
        currentPeriodEnd: timestampToIso(object.current_period_end),
        cancelAtPeriodEnd: !!object.cancel_at_period_end,
      });
      return { handled: true, clinicId, plan, message: `Subscription ${status}.` };
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const customerId = object.customer ? String(object.customer) : '';
      const existing = customerId ? await deps.store.byStripeCustomerId(customerId) : null;
      if (!existing) {
        deps.logger.warn('Invoice event for an unknown customer; ignoring.', { eventId: event.id });
        await deps.events.record({ id: event.id, clinicId: null, kind: event.type, detail: {} });
        break;
      }
      const status = event.type === 'invoice.paid' ? 'active' : 'past_due';
      await writeSubscription(existing.clinicId, {
        plan: isPlanId(existing.plan) ? existing.plan : 'solo',
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: existing.stripeSubscriptionId,
      });
      return { handled: true, clinicId: existing.clinicId, message: `Invoice ${status}.` };
    }

    default:
      await deps.events.record({ id: event.id, clinicId: null, kind: event.type, detail: {} });
      return { handled: false, message: `Event type ${event.type} is not handled.` };
  }

  // Event recorded but no subscription change was possible (missing clinic id).
  return { handled: true, message: 'Event recorded; no subscription change applied.' };
}

/* ---------------------------------------------------------------------------
 * Manual activation
 * ------------------------------------------------------------------------- */

export interface ManualActivationInput {
  clinicId: string;
  plan: PlanId;
  status?: string;
  periodDays: number;
  activatedBy: string;
}

export interface ManualActivationDeps {
  store: SubscriptionStore;
  logger: BillingLogger;
  onChanged?: (clinicId: string) => void;
  now?: () => Date;
}

/**
 * Grants a plan without Stripe.
 *
 * This matters more than it sounds: the first few practices will be invoiced by
 * hand, and the product has to be able to enforce a paid plan the moment the
 * money lands. It is also the recovery path when a webhook is lost.
 */
export async function activateManually(
  input: ManualActivationInput,
  deps: ManualActivationDeps
): Promise<SubscriptionRecord> {
  const now = deps.now ? deps.now() : new Date();
  const existing = await deps.store.forClinic(input.clinicId);
  const record: SubscriptionRecord = {
    id: existing?.id || crypto.randomUUID(),
    clinicId: input.clinicId,
    plan: input.plan,
    tier: input.plan,
    status: input.status || 'active',
    seats: PLANS[input.plan].seats,
    stripeCustomerId: existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? null,
    currentPeriodEnd: new Date(now.getTime() + input.periodDays * 86400000).toISOString(),
    cancelAtPeriodEnd: false,
    activatedBy: input.activatedBy,
    updatedAt: now.toISOString(),
  };
  await deps.store.upsert(record);
  deps.onChanged?.(input.clinicId);
  deps.logger.info('Plan activated manually.', {
    clinicId: input.clinicId,
    plan: input.plan,
    periodDays: input.periodDays,
  });
  return record;
}

/* ---------------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------------- */

export interface BillingRoutesDeps {
  logger: BillingLogger;
  authenticate: (req: any, res: any, next: (err?: any) => void) => any;
  subscriptions: SubscriptionStore;
  events: BillingEventStore;
  entitlements: EntitlementResolver;
  membershipsFor: (
    dentistId: string
  ) => Promise<Array<{ clinicId: string; clinicName?: string; role: string; status: string }>>;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

/** Owner-only helper shared by the billing routes. */
async function ownedClinic(
  deps: BillingRoutesDeps,
  dentistId: string
): Promise<{ clinicId: string; clinicName?: string } | null> {
  const memberships = await deps.membershipsFor(dentistId);
  const owned = memberships.find((m) => m.role === 'owner' && m.status === 'active');
  return owned ? { clinicId: owned.clinicId, clinicName: owned.clinicName } : null;
}

export function registerBillingRoutes(app: any, deps: BillingRoutesDeps): void {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  const stripeKey = env.STRIPE_SECRET_KEY || '';
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET || '';

  app.get('/api/billing/status', deps.authenticate, async (req: any, res: any) => {
    try {
      const clinic = await ownedClinic(deps, req.dentist.id);
      if (!clinic) {
        return res.status(403).json({
          error: 'Only the practice owner can view billing.',
          code: 'OWNER_REQUIRED',
        });
      }
      const subscription = await deps.subscriptions.forClinic(clinic.clinicId);
      const entitlements = await deps.entitlements.resolve(clinic.clinicId);
      return res.json({
        clinicId: clinic.clinicId,
        // Never send the secret; a boolean is all the client needs.
        stripeConfigured: !!stripeKey && !!webhookSecret,
        subscription,
        entitlements,
        plans: Object.values(PLANS),
      });
    } catch (err: any) {
      deps.logger.error('Billing status failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not read billing status.' });
    }
  });

  app.post('/api/billing/checkout', deps.authenticate, async (req: any, res: any) => {
    try {
      const clinic = await ownedClinic(deps, req.dentist.id);
      if (!clinic) {
        return res.status(403).json({
          error: 'Only the practice owner can start a subscription.',
          code: 'OWNER_REQUIRED',
        });
      }
      const plan = req.body?.plan;
      if (!isPlanId(plan) || plan === 'trial' || plan === 'enterprise') {
        return res.status(400).json({
          error: 'Choose the Solo or Practice plan. Group plans are quoted — contact support.',
        });
      }
      if (!stripeKey) {
        return res.status(503).json({
          error:
            'Card payments are not enabled on this deployment yet. Contact support and we will invoice the practice directly.',
          code: 'BILLING_NOT_CONFIGURED',
        });
      }

      const definition = PLANS[plan];
      const origin = `${req.protocol}://${req.get('host')}`;
      const body = new URLSearchParams();
      body.set('mode', 'subscription');
      body.set('success_url', `${origin}/#/dashboard?billing=success`);
      body.set('cancel_url', `${origin}/#/dashboard?billing=cancelled`);
      body.set('client_reference_id', clinic.clinicId);
      body.set('metadata[clinicId]', clinic.clinicId);
      body.set('subscription_data[metadata][clinicId]', clinic.clinicId);
      body.set('subscription_data[metadata][plan]', plan);
      body.set('line_items[0][quantity]', '1');
      body.set('line_items[0][price_data][currency]', 'aud');
      body.set('line_items[0][price_data][unit_amount]', String(definition.monthlyAudExGst * 100));
      body.set('line_items[0][price_data][recurring][interval]', 'month');
      body.set('line_items[0][price_data][product_data][name]', `DentAI ${definition.name}`);
      body.set(
        'line_items[0][price_data][product_data][description]',
        `${definition.seats} clinician seat(s), ${definition.dailyNotes} AI notes/day`
      );

      const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const payload: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        deps.logger.error('Stripe checkout session creation failed.', undefined, {
          status: response.status,
          message: payload?.error?.message,
        });
        return res.status(502).json({
          error: 'Could not start checkout with the payment provider. Please try again shortly.',
        });
      }

      await deps.logAudit('billing_checkout_started', req.dentist.id, {
        clinicId: clinic.clinicId,
        plan,
      });
      return res.json({ url: payload.url, id: payload.id });
    } catch (err: any) {
      deps.logger.error('Billing checkout failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not start checkout.' });
    }
  });

  /**
   * Stripe webhook. Unauthenticated by design (Stripe cannot hold a session),
   * and therefore verified by signature against the raw body. Refuses rather
   * than guesses.
   */
  app.post('/api/billing/webhook', async (req: any, res: any) => {
    try {
      if (!webhookSecret) {
        deps.logger.warn('Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set; refusing.');
        return res.status(503).json({
          error: 'Billing webhook is not configured on this deployment.',
          code: 'BILLING_NOT_CONFIGURED',
        });
      }

      const rawPayload: string =
        typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body ?? {});
      const signature = verifyStripeSignature({
        payload: rawPayload,
        header: req.headers['stripe-signature'],
        secret: webhookSecret,
      });

      if (!signature.ok) {
        deps.logger.warn('Rejected Stripe webhook with an invalid signature.', {
          reason: signature.reason,
        });
        return res.status(400).json({ error: 'Invalid signature.' });
      }

      const event = parseStripeEvent(rawPayload);
      if (!event) return res.status(400).json({ error: 'Malformed event payload.' });

      const result = await applyStripeEvent(event, {
        store: deps.subscriptions,
        events: deps.events,
        logger: deps.logger,
        onChanged: (clinicId) => deps.entitlements.invalidate(clinicId),
      });

      if (result.clinicId) {
        await Promise.resolve(
          deps.logAudit('billing_event_applied', 'stripe', {
            eventId: event.id,
            type: event.type,
            clinicId: result.clinicId,
          })
        ).catch(() => {});
      }

      return res.json({ received: true, ...result });
    } catch (err: any) {
      deps.logger.error('Stripe webhook handling failed:', err?.message || err);
      // 500 asks Stripe to retry, which is what we want for a transient fault.
      return res.status(500).json({ error: 'Webhook processing failed.' });
    }
  });
}
