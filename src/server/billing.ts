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
  /** Environment, so a subscription's plan can be resolved from its Price. */
  env?: Record<string, string | undefined>;
  sendReceiptEmail?: (params: {
    clinicId: string;
    practiceName: string;
    planName: string;
    amountAud: number;
    periodEnd: string;
    invoiceUrl?: string;
    customerEmail?: string;
    /** GST actually charged by Stripe, in dollars. Absent when unknown. */
    gstAud?: number;
    /** The buyer's ABN, when tax_id_collection captured one. */
    customerAbn?: string;
  }) => Promise<void>;
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

export function clinicIdFromObject(object: Record<string, any>): string {
  const meta = object?.metadata;
  const fromMeta = meta?.clinic_id || meta?.clinicId;
  if (fromMeta && typeof fromMeta === 'string' && fromMeta.trim()) {
    return fromMeta.trim();
  }
  const clientRef = object?.client_reference_id;
  if (clientRef && typeof clientRef === 'string' && clientRef.trim()) {
    return clientRef.trim();
  }
  return '';
}

export function planFromMetadata(object: Record<string, any>, fallback?: PlanId): PlanId | null {
  const meta = object?.metadata;
  const fromMeta = meta?.plan;
  if (isPlanId(fromMeta)) return fromMeta;
  if (fallback && isPlanId(fallback)) return fallback;
  return null;
}

/** The first Price id on a subscription object, when Stripe included its items. */
export function subscriptionPriceId(object: Record<string, any>): string | null {
  const price = object?.items?.data?.[0]?.price?.id;
  return typeof price === 'string' && price.trim() ? price.trim() : null;
}

/**
 * Maps a Stripe Price id back to a plan.
 *
 * Metadata is the fast path, but a subscription created before
 * `subscription_data` metadata was sent — or created by hand in the Stripe
 * dashboard — carries none. The Price is the durable source of truth, and it is
 * also the only thing that follows a customer who changes plan in the Stripe
 * portal, because Stripe does not rewrite subscription metadata when the Price
 * changes.
 */
export function planFromPriceId(
  priceId: unknown,
  env: Record<string, string | undefined> = process.env
): PlanId | null {
  if (typeof priceId !== 'string' || !priceId.trim()) return null;
  const wanted = priceId.trim();
  const configured: Array<[string | undefined, PlanId]> = [
    [env.STRIPE_PRICE_PRACTICE, 'practice'],
    [env.STRIPE_PRICE_SOLO, 'solo'],
    [env.STRIPE_PRICE_ENTERPRISE, 'enterprise'],
  ];
  for (const [id, plan] of configured) {
    if (id && id.trim() === wanted) return plan;
  }
  return null;
}

/**
 * Stripe's own tax total for an invoice, in cents.
 *
 * Null means Stripe did not report a tax figure at all. It does NOT mean zero:
 * zero is a real answer (nothing was charged) and is passed through as 0.
 */
function invoiceTaxCents(object: Record<string, any>): number | null {
  for (const candidate of [object?.total_tax, object?.tax]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  const amounts = object?.total_tax_amounts;
  if (Array.isArray(amounts)) {
    return amounts.reduce((total, entry) => total + (Number(entry?.amount) || 0), 0);
  }
  return null;
}

/** What was actually paid, in cents. Null when Stripe reported no amount. */
function invoicePaidCents(object: Record<string, any>): number | null {
  for (const candidate of [object?.amount_paid, object?.total]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

/** The buyer's tax identifier on an invoice, as captured by tax_id_collection. */
function invoiceCustomerTaxId(object: Record<string, any>): string {
  const raw = object?.customer_tax_ids;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const australian = list.find((entry: any) => String(entry?.type || '').toLowerCase().startsWith('au'));
  const value = (australian || list[0])?.value;
  return typeof value === 'string' ? value.trim() : '';
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
      const clinicId = clinicIdFromObject(object);
      if (!clinicId) {
        deps.logger.warn('Stripe checkout completed without a clinicId in metadata or client_reference_id; ignoring.', {
          eventId: event.id,
        });
        await deps.events.record({ id: event.id, clinicId: null, kind: event.type, detail: {} });
        break;
      }
      const plan = planFromMetadata(object);
      if (!plan) {
        deps.logger.error('Stripe checkout completed with unresolvable plan; refusing to default to free plan.', {
          eventId: event.id,
          metadata: object.metadata,
        });
        throw new Error(`Stripe checkout completed without a valid plan for clinic ${clinicId}`);
      }
      const currentPeriodEnd = object.current_period_end
        ? timestampToIso(object.current_period_end)
        : object.expires_at
          ? timestampToIso(object.expires_at)
          : new Date(Date.now() + 30 * 86400000).toISOString();

      await writeSubscription(clinicId, {
        plan,
        status: 'active',
        stripeCustomerId: object.customer ? String(object.customer) : null,
        stripeSubscriptionId: object.subscription ? String(object.subscription) : null,
        currentPeriodEnd,
      });
      return { handled: true, clinicId, plan, message: 'Checkout completed.' };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      let clinicId = clinicIdFromObject(object);
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

      const known = await deps.store.forClinic(clinicId);
      const priceId = subscriptionPriceId(object);

      /*
       * Plan resolution, in order of authority:
       *   1. the metadata written at checkout;
       *   2. the Price on the subscription — the durable source of truth, and the
       *      only thing that works for subscriptions created before
       *      `subscription_data` metadata existed, or created by hand in Stripe;
       *   3. whatever plan this clinic already has.
       *
       * This deliberately does NOT throw. Stripe retries a 5xx for three days,
       * and an absent plan is a permanent condition, not a transient fault — so
       * throwing means a cancellation or a failed payment is never recorded and
       * the practice keeps paid access because its last status still said
       * "active". Losing a lifecycle event is worse than carrying a plan forward
       * that a later event, or the operator console, can still correct.
       */
      const plan =
        planFromMetadata(object) ||
        planFromPriceId(priceId, deps.env || process.env) ||
        (isPlanId(known?.plan) ? known.plan : null);

      if (!plan) {
        deps.logger.error(
          'Subscription event has no resolvable plan; recorded without changing entitlements.',
          { eventId: event.id, subscriptionId: object.id, priceId }
        );
        await deps.events.record({
          id: event.id,
          clinicId,
          kind: event.type,
          detail: { unresolvedPlan: true, priceId },
        });
        return {
          handled: false,
          clinicId,
          message: 'Subscription event carried no resolvable plan; recorded for follow-up.',
        };
      }
      const resolvedPlan = plan;
      const status =
        event.type === 'customer.subscription.deleted'
          ? 'canceled'
          : String(object.status || 'active');
      await writeSubscription(clinicId, {
        plan: resolvedPlan,
        status,
        stripeCustomerId: object.customer ? String(object.customer) : null,
        stripeSubscriptionId: String(object.id || ''),
        currentPeriodEnd: timestampToIso(object.current_period_end),
        cancelAtPeriodEnd: !!object.cancel_at_period_end,
      });
      return { handled: true, clinicId, plan: resolvedPlan, message: `Subscription ${status}.` };
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
      const plan = isPlanId(existing.plan) ? existing.plan : 'practice';
      const currentPeriodEnd = timestampToIso(object.lines?.data?.[0]?.period?.end || object.period_end);
      await writeSubscription(existing.clinicId, {
        plan,
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: existing.stripeSubscriptionId,
        currentPeriodEnd,
      });

      if (event.type === 'invoice.paid' && deps.sendReceiptEmail) {
        /*
         * Every figure on this document comes from Stripe. Previously the amount
         * fell back to a hardcoded 16390 and the GST was derived as total/11 —
         * so a practice could be sent a tax invoice for an amount nobody paid,
         * asserting tax that was never collected. If Stripe did not report what
         * was paid, no document is issued and an operator is told to re-send it.
         */
        const paidCents = invoicePaidCents(object);
        const taxCents = invoiceTaxCents(object);
        const customerAbn = invoiceCustomerTaxId(object);
        const periodEndStr = object.lines?.data?.[0]?.period?.end
          ? timestampToIso(object.lines.data[0].period.end) || ''
          : '';

        if (paidCents === null) {
          deps.logger.error(
            'Invoice paid event reported no amount; no tax invoice issued.',
            { eventId: event.id, invoiceId: object.id, clinicId: existing.clinicId }
          );
        } else {
          try {
            await deps.sendReceiptEmail({
              clinicId: existing.clinicId,
              practiceName: object.customer_name || existing.clinicId,
              planName: PLANS[plan]?.name || 'Practice',
              amountAud: paidCents / 100,
              periodEnd: periodEndStr || 'Next billing cycle',
              invoiceUrl: object.hosted_invoice_url || object.invoice_pdf || undefined,
              customerEmail: object.customer_email || undefined,
              // undefined when Stripe reported no tax, which makes the email
              // issue a receipt rather than claim a GST figure it cannot know.
              gstAud: taxCents === null ? undefined : taxCents / 100,
              customerAbn: customerAbn || undefined,
            });
          } catch (emailErr: any) {
            deps.logger.warn('Could not dispatch tax invoice email:', { message: emailErr?.message });
          }
        }
      }

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
  sendReceiptEmail?: (params: {
    clinicId: string;
    practiceName: string;
    planName: string;
    amountAud: number;
    periodEnd: string;
    invoiceUrl?: string;
    customerEmail?: string;
    /** GST actually charged by Stripe, in dollars. Absent when unknown. */
    gstAud?: number;
    /** The buyer's ABN, when tax_id_collection captured one. */
    customerAbn?: string;
  }) => Promise<void>;
}

/** Owner-only helper shared by the billing routes. */
async function ownedClinic(
  deps: BillingRoutesDeps,
  dentistId: string,
  preferredClinicId?: string
): Promise<{ clinicId: string; clinicName?: string } | null> {
  const memberships = await deps.membershipsFor(dentistId);
  if (preferredClinicId) {
    const matched = memberships.find(
      (m) => m.clinicId === preferredClinicId && m.role === 'owner' && m.status === 'active'
    );
    if (matched) return { clinicId: matched.clinicId, clinicName: matched.clinicName };
  }
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
      const preferredClinicId = (req.query?.clinicId as string) || undefined;
      const clinic = await ownedClinic(deps, req.dentist.id, preferredClinicId);
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
      const preferredClinicId = (req.body?.clinicId as string) || undefined;
      const clinic = await ownedClinic(deps, req.dentist.id, preferredClinicId);
      if (!clinic) {
        return res.status(403).json({
          error: 'Only the practice owner can start a subscription.',
          code: 'OWNER_REQUIRED',
        });
      }
      const plan = req.body?.plan;
      if (plan !== 'practice') {
        return res.status(400).json({
          error: 'Solo is free forever. To upgrade your clinic, select the Practice plan (Group plans are quoted).',
        });
      }
      if (!stripeKey) {
        return res.status(503).json({
          error: 'Online checkout is not configured on this deployment. Please contact support.',
          code: 'STRIPE_NOT_CONFIGURED',
        });
      }

      // Live Stripe Checkout Session creation via native fetch
      const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;
      const params = new URLSearchParams();
      params.append('mode', 'subscription');
      params.append('payment_method_types[0]', 'card');

      const stripePriceId = env.STRIPE_PRICE_PRACTICE || process.env.STRIPE_PRICE_PRACTICE;
      if (stripePriceId) {
        params.append('line_items[0][price]', stripePriceId);
      } else {
        params.append('line_items[0][price_data][currency]', 'aud');
        params.append('line_items[0][price_data][product_data][name]', 'DentAI Practice Plan');
        params.append(
          'line_items[0][price_data][product_data][description]',
          'Up to 6 clinician seats, priority queue, team recall worklist, 7-year retention'
        );
        params.append('line_items[0][price_data][unit_amount]', '16390'); // A$163.90 inc GST ($149 ex GST)
        params.append('line_items[0][price_data][tax_behavior]', 'inclusive');
        params.append('line_items[0][price_data][recurring][interval]', 'month');
      }
      params.append('line_items[0][quantity]', '1');
      params.append('automatic_tax[enabled]', 'true');
      params.append('tax_id_collection[enabled]', 'true');
      params.append('success_url', `${origin}/#/billing?status=success&session_id={CHECKOUT_SESSION_ID}`);
      params.append('cancel_url', `${origin}/#/billing?status=cancelled`);
      params.append('client_reference_id', clinic.clinicId);
      params.append('metadata[clinic_id]', clinic.clinicId);
      params.append('metadata[dentist_id]', req.dentist.id);
      params.append('metadata[plan]', plan);
      params.append('subscription_data[metadata][clinic_id]', clinic.clinicId);
      params.append('subscription_data[metadata][dentist_id]', req.dentist.id);
      params.append('subscription_data[metadata][plan]', plan);


      const resp = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        deps.logger.error('Stripe checkout session failed:', payload?.error?.message || payload, {
          clinicId: clinic.clinicId,
          status: resp.status,
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

  app.post('/api/billing/portal', deps.authenticate, async (req: any, res: any) => {
    try {
      const preferredClinicId = (req.body?.clinicId as string) || undefined;
      const clinic = await ownedClinic(deps, req.dentist.id, preferredClinicId);
      if (!clinic) {
        return res.status(403).json({
          error: 'Only the practice owner can manage billing and view receipts.',
          code: 'OWNER_REQUIRED',
        });
      }
      const subscription = await deps.subscriptions.forClinic(clinic.clinicId);
      if (!subscription?.stripeCustomerId) {
        return res.status(404).json({
          error: 'No active Stripe billing account found for this practice.',
          code: 'NO_CUSTOMER',
        });
      }
      if (!stripeKey) {
        return res.status(503).json({
          error: 'Billing portal is not configured on this deployment.',
          code: 'BILLING_NOT_CONFIGURED',
        });
      }

      const origin = `${req.protocol}://${req.get('host')}`;
      const body = new URLSearchParams();
      body.set('customer', subscription.stripeCustomerId);
      body.set('return_url', `${origin}/#/billing`);

      const response = await fetchImpl('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const payload: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        deps.logger.error('Stripe billing portal session creation failed.', undefined, {
          status: response.status,
          message: payload?.error?.message,
        });
        return res.status(502).json({ error: 'Could not open billing portal. Please try again shortly.' });
      }

      await deps.logAudit('billing_portal_opened', req.dentist.id, {
        clinicId: clinic.clinicId,
      });
      return res.json({ url: payload.url });
    } catch (err: any) {
      deps.logger.error('Billing portal failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Could not open billing portal.' });
    }
  });

  /**
   * Stripe webhook. Unauthenticated by design (Stripe cannot hold a session),
   * and therefore verified by signature against the raw body. Refuses rather
   * than guesses.
   */
  app.post('/api/billing/webhook', async (req: any, res: any) => {
    try {
      const activeWebhookSecret = (deps.env || process.env).STRIPE_WEBHOOK_SECRET || webhookSecret;
      if (!activeWebhookSecret) {
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
        secret: activeWebhookSecret,
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
        env: deps.env || process.env,
        sendReceiptEmail: deps.sendReceiptEmail,
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
