/**
 * Stores for the operational domains added on top of the clinical core.
 *
 * Every store has two implementations:
 *   - **Postgres** (production): a handful of plain statements.
 *   - **JSON/KV fallback** (local dev and the test suite): the same behaviour
 *     over the file store the app already uses.
 *
 * Keeping both is deliberate. The unit suite runs with `DATABASE_URL=''`, so a
 * feature implemented only against Postgres is a feature with no tests at all.
 * The Postgres statements are additionally covered by the CI job that runs
 * against a throwaway database (see .github/workflows/ci.yml).
 *
 * Statements here are intentionally plain (`SELECT` / `INSERT ... ON CONFLICT`
 * / `UPDATE ... WHERE`): nothing exotic that cannot be reasoned about by
 * reading it, because a mistake in this file is a production incident.
 */

import { dbEnabled, sql } from '../lib/db';

export interface JsonKv {
  read: (key: string, file: string, fallback: any) => Promise<any>;
  write: (key: string, file: string, value: any) => Promise<void>;
  dir: string;
}

export interface StoreLogger {
  info: (message: string, context?: Record<string, any>) => void;
  warn: (message: string, context?: Record<string, any>) => void;
  error: (message: string, error?: any, context?: Record<string, any>) => void;
}

export interface StoreDeps {
  kv: JsonKv;
  logger: StoreLogger;
}

const jsonPath = (deps: StoreDeps, name: string) => `${deps.kv.dir}/${name}`;

/** Small helper so a null driver is never dereferenced by accident. */
function db() {
  if (!sql) throw new Error('Postgres driver is not configured.');
  return sql;
}

/* ===========================================================================
 * Practice acceptances — evidence that the practice accepted a document version
 * ======================================================================== */

export interface PracticeAcceptance {
  id: string;
  clinicId: string;
  termsVersion: string;
  privacyVersion: string;
  dpaVersion: string;
  acceptedByName: string;
  acceptedByEmail: string | null;
  acceptedByDentistId: string | null;
  acceptedAt: string;
}

export interface PracticeAcceptanceStore {
  record(acceptance: PracticeAcceptance): Promise<void>;
  latestForClinic(clinicId: string): Promise<PracticeAcceptance | null>;
  listForClinic(clinicId: string, limit?: number): Promise<PracticeAcceptance[]>;
}

function rowToAcceptance(r: any): PracticeAcceptance {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    termsVersion: r.terms_version,
    privacyVersion: r.privacy_version,
    dpaVersion: r.dpa_version,
    acceptedByName: r.accepted_by_name,
    acceptedByEmail: r.accepted_by_email ?? null,
    acceptedByDentistId: r.accepted_by_dentist_id ?? null,
    acceptedAt: new Date(r.accepted_at).toISOString(),
  };
}

export function createPracticeAcceptanceStore(deps: StoreDeps): PracticeAcceptanceStore {
  const FILE = 'practice_acceptances.json';
  const KEY = 'dentai:practice_acceptances';

  return {
    async record(acceptance) {
      if (dbEnabled) {
        await db()`
          INSERT INTO practice_acceptances
            (id, clinic_id, terms_version, privacy_version, dpa_version,
             accepted_by_name, accepted_by_email, accepted_by_dentist_id, accepted_at)
          VALUES
            (${acceptance.id}, ${acceptance.clinicId}, ${acceptance.termsVersion},
             ${acceptance.privacyVersion}, ${acceptance.dpaVersion}, ${acceptance.acceptedByName},
             ${acceptance.acceptedByEmail}, ${acceptance.acceptedByDentistId},
             ${acceptance.acceptedAt}::timestamptz)
          ON CONFLICT (id) DO NOTHING
        `;
        return;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { acceptances: [] });
      data.acceptances.push(acceptance);
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async latestForClinic(clinicId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM practice_acceptances
          WHERE clinic_id = ${clinicId}
          ORDER BY accepted_at DESC
          LIMIT 1
        `) as any[];
        return rows.length ? rowToAcceptance(rows[0]) : null;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { acceptances: [] });
      const mine = (data.acceptances as PracticeAcceptance[])
        .filter((a) => a.clinicId === clinicId)
        .sort((a, b) => Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt));
      return mine[0] ?? null;
    },

    async listForClinic(clinicId, limit = 20) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM practice_acceptances
          WHERE clinic_id = ${clinicId}
          ORDER BY accepted_at DESC
          LIMIT ${limit}
        `) as any[];
        return rows.map(rowToAcceptance);
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { acceptances: [] });
      return (data.acceptances as PracticeAcceptance[])
        .filter((a) => a.clinicId === clinicId)
        .sort((a, b) => Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt))
        .slice(0, limit);
    },
  };
}

/* ===========================================================================
 * Durable rate limiting
 * ======================================================================== */

export interface RateLimitHit {
  hits: number;
  expiresAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  reset(key: string): Promise<void>;
}

export function createRateLimitStore(deps: StoreDeps): RateLimitStore {
  const FILE = 'rate_limits.json';
  const KEY = 'dentai:rate_limits';

  return {
    async hit(key, windowMs) {
      if (dbEnabled) {
        const rows = (await db()`
          INSERT INTO rate_limit_counters (key, hits, expires_at, updated_at)
          VALUES (${key}, 1, now() + (${windowMs}::bigint * INTERVAL '1 millisecond'), now())
          ON CONFLICT (key) DO UPDATE
            SET hits = CASE
                  WHEN rate_limit_counters.expires_at <= now() THEN 1
                  ELSE rate_limit_counters.hits + 1
                END,
                expires_at = CASE
                  WHEN rate_limit_counters.expires_at <= now()
                    THEN now() + (${windowMs}::bigint * INTERVAL '1 millisecond')
                  ELSE rate_limit_counters.expires_at
                END,
                updated_at = now()
          RETURNING hits, expires_at
        `) as any[];
        const r = rows[0] || {};
        return {
          hits: Number(r.hits ?? 1),
          expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : Date.now() + windowMs,
        };
      }

      const now = Date.now();
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { counters: {} });
      const counters = data.counters as Record<string, { hits: number; expiresAt: number }>;
      const entry = counters[key];
      if (!entry || entry.expiresAt <= now) {
        counters[key] = { hits: 1, expiresAt: now + windowMs };
      } else {
        entry.hits += 1;
      }
      // Opportunistic pruning: the fallback store is a single JSON document and
      // must not grow with every distinct visitor.
      for (const [k, v] of Object.entries(counters)) {
        if (v.expiresAt <= now) delete counters[k];
      }
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
      return { ...counters[key] };
    },

    async reset(key) {
      if (dbEnabled) {
        await db()`DELETE FROM rate_limit_counters WHERE key = ${key}`;
        return;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { counters: {} });
      delete data.counters[key];
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },
  };
}

/* ===========================================================================
 * Multi-factor authentication
 * ======================================================================== */

export interface MfaCredential {
  dentistId: string;
  secret: string;
  confirmedAt: string | null;
  lastUsedAt: string | null;
}

export interface MfaStore {
  get(dentistId: string): Promise<MfaCredential | null>;
  saveSecret(dentistId: string, secret: string): Promise<void>;
  confirm(dentistId: string): Promise<void>;
  touch(dentistId: string): Promise<void>;
  remove(dentistId: string): Promise<void>;
  replaceRecoveryCodes(dentistId: string, codeHashes: string[]): Promise<void>;
  consumeRecoveryCode(dentistId: string, codeHash: string): Promise<boolean>;
  countUnusedRecoveryCodes(dentistId: string): Promise<number>;
}

export function createMfaStore(deps: StoreDeps): MfaStore {
  const FILE = 'mfa.json';
  const KEY = 'dentai:mfa';

  const readAll = () =>
    deps.kv.read(KEY, jsonPath(deps, FILE), { credentials: [], recoveryCodes: [] });

  return {
    async get(dentistId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT dentist_id, secret, confirmed_at, last_used_at
          FROM mfa_credentials WHERE dentist_id = ${dentistId}
        `) as any[];
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
          dentistId: r.dentist_id,
          secret: r.secret,
          confirmedAt: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null,
          lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
        };
      }
      const data = await readAll();
      const found = (data.credentials as MfaCredential[]).find((c) => c.dentistId === dentistId);
      return found ?? null;
    },

    async saveSecret(dentistId, secret) {
      if (dbEnabled) {
        await db()`
          INSERT INTO mfa_credentials (dentist_id, secret, confirmed_at)
          VALUES (${dentistId}, ${secret}, NULL)
          ON CONFLICT (dentist_id) DO UPDATE
            SET secret = EXCLUDED.secret, confirmed_at = NULL
        `;
        return;
      }
      const data = await readAll();
      const credentials = data.credentials as MfaCredential[];
      const existing = credentials.find((c) => c.dentistId === dentistId);
      if (existing) {
        existing.secret = secret;
        existing.confirmedAt = null;
      } else {
        credentials.push({ dentistId, secret, confirmedAt: null, lastUsedAt: null });
      }
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async confirm(dentistId) {
      if (dbEnabled) {
        await db()`
          UPDATE mfa_credentials SET confirmed_at = now() WHERE dentist_id = ${dentistId}
        `;
        return;
      }
      const data = await readAll();
      const found = (data.credentials as MfaCredential[]).find((c) => c.dentistId === dentistId);
      if (found) found.confirmedAt = new Date().toISOString();
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async touch(dentistId) {
      if (dbEnabled) {
        await db()`UPDATE mfa_credentials SET last_used_at = now() WHERE dentist_id = ${dentistId}`;
        return;
      }
      const data = await readAll();
      const found = (data.credentials as MfaCredential[]).find((c) => c.dentistId === dentistId);
      if (found) found.lastUsedAt = new Date().toISOString();
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async remove(dentistId) {
      if (dbEnabled) {
        await db()`DELETE FROM mfa_credentials WHERE dentist_id = ${dentistId}`;
        await db()`DELETE FROM mfa_recovery_codes WHERE dentist_id = ${dentistId}`;
        return;
      }
      const data = await readAll();
      data.credentials = (data.credentials as MfaCredential[]).filter(
        (c) => c.dentistId !== dentistId
      );
      data.recoveryCodes = (data.recoveryCodes as any[]).filter((c) => c.dentistId !== dentistId);
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async replaceRecoveryCodes(dentistId, codeHashes) {
      if (dbEnabled) {
        await db()`DELETE FROM mfa_recovery_codes WHERE dentist_id = ${dentistId}`;
        for (const hash of codeHashes) {
          await db()`
            INSERT INTO mfa_recovery_codes (code_hash, dentist_id)
            VALUES (${hash}, ${dentistId})
            ON CONFLICT (code_hash) DO NOTHING
          `;
        }
        return;
      }
      const data = await readAll();
      data.recoveryCodes = (data.recoveryCodes as any[]).filter((c) => c.dentistId !== dentistId);
      for (const hash of codeHashes) {
        (data.recoveryCodes as any[]).push({ codeHash: hash, dentistId, usedAt: null });
      }
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async consumeRecoveryCode(dentistId, codeHash) {
      if (dbEnabled) {
        const rows = (await db()`
          UPDATE mfa_recovery_codes
          SET used_at = now()
          WHERE code_hash = ${codeHash} AND dentist_id = ${dentistId} AND used_at IS NULL
          RETURNING code_hash
        `) as any[];
        return rows.length > 0;
      }
      const data = await readAll();
      const found = (data.recoveryCodes as any[]).find(
        (c) => c.codeHash === codeHash && c.dentistId === dentistId && !c.usedAt
      );
      if (!found) return false;
      found.usedAt = new Date().toISOString();
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
      return true;
    },

    async countUnusedRecoveryCodes(dentistId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT COUNT(*)::int AS count FROM mfa_recovery_codes
          WHERE dentist_id = ${dentistId} AND used_at IS NULL
        `) as any[];
        return Number(rows[0]?.count ?? 0);
      }
      const data = await readAll();
      return (data.recoveryCodes as any[]).filter((c) => c.dentistId === dentistId && !c.usedAt)
        .length;
    },
  };
}

/* ===========================================================================
 * Emailed clinic invitations
 * ======================================================================== */

export interface ClinicInvite {
  id: string;
  clinicId: string;
  email: string;
  invitedBy: string;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
}

export interface ClinicInviteStore {
  create(invite: ClinicInvite): Promise<void>;
  listForClinic(clinicId: string, limit?: number): Promise<ClinicInvite[]>;
  markAccepted(clinicId: string, email: string): Promise<void>;
  countSince(clinicId: string, sinceIso: string): Promise<number>;
}

export function createClinicInviteStore(deps: StoreDeps): ClinicInviteStore {
  const FILE = 'clinic_invites.json';
  const KEY = 'dentai:clinic_invites';

  return {
    async create(invite) {
      if (dbEnabled) {
        await db()`
          INSERT INTO clinic_invites (id, clinic_id, email, invited_by, status, created_at)
          VALUES (${invite.id}, ${invite.clinicId}, ${invite.email}, ${invite.invitedBy},
                  ${invite.status}, ${invite.createdAt}::timestamptz)
          ON CONFLICT (id) DO NOTHING
        `;
        return;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { invites: [] });
      (data.invites as ClinicInvite[]).push(invite);
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async listForClinic(clinicId, limit = 50) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT id, clinic_id, email, invited_by, status, created_at, accepted_at
          FROM clinic_invites
          WHERE clinic_id = ${clinicId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `) as any[];
        return rows.map((r: any) => ({
          id: r.id,
          clinicId: r.clinic_id,
          email: r.email,
          invitedBy: r.invited_by,
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
          acceptedAt: r.accepted_at ? new Date(r.accepted_at).toISOString() : null,
        }));
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { invites: [] });
      return (data.invites as ClinicInvite[])
        .filter((i) => i.clinicId === clinicId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);
    },

    async markAccepted(clinicId, email) {
      if (dbEnabled) {
        await db()`
          UPDATE clinic_invites SET status = 'accepted', accepted_at = now()
          WHERE clinic_id = ${clinicId} AND lower(email) = lower(${email}) AND accepted_at IS NULL
        `;
        return;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { invites: [] });
      for (const invite of data.invites as ClinicInvite[]) {
        if (invite.clinicId === clinicId && invite.email.toLowerCase() === email.toLowerCase() && !invite.acceptedAt) {
          invite.status = 'accepted';
          invite.acceptedAt = new Date().toISOString();
        }
      }
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },

    async countSince(clinicId, sinceIso) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT COUNT(*)::int AS count FROM clinic_invites
          WHERE clinic_id = ${clinicId} AND created_at >= ${sinceIso}::timestamptz
        `) as any[];
        return Number(rows[0]?.count ?? 0);
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { invites: [] });
      return (data.invites as ClinicInvite[]).filter(
        (i) => i.clinicId === clinicId && Date.parse(i.createdAt) >= Date.parse(sinceIso)
      ).length;
    },
  };
}

/* ===========================================================================
 * Retention: finding and de-identifying records past their horizon
 * ======================================================================== */

export interface DueRecord {
  id: string;
  dentistId: string;
  clinicId: string | null;
  data: any;
  retentionUntil: string;
}

export interface RetentionStore {
  listDue(limit: number, nowIso: string): Promise<DueRecord[]>;
  deidentify(id: string, redacted: any, atIso: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createRetentionStore(deps: StoreDeps): RetentionStore {
  const FILE = 'consultations.json';
  const KEY = 'dentai:consultations';

  return {
    async listDue(limit, nowIso) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT id, dentist_id, consultation_clinic_id, data, retention_until
          FROM consultations
          WHERE deidentified_at IS NULL
            AND retention_until IS NOT NULL
            AND retention_until <= ${nowIso}::timestamptz
          ORDER BY retention_until ASC
          LIMIT ${limit}
        `) as any[];
        return rows.map((r: any) => ({
          id: r.id,
          dentistId: r.dentist_id,
          clinicId: r.consultation_clinic_id ?? null,
          data: r.data,
          retentionUntil: new Date(r.retention_until).toISOString(),
        }));
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { consultations: [] });
      return (data.consultations as any[])
        .filter(
          (c) =>
            !c.deidentifiedAt &&
            c.retentionUntil &&
            Date.parse(c.retentionUntil) <= Date.parse(nowIso)
        )
        .sort((a, b) => Date.parse(a.retentionUntil) - Date.parse(b.retentionUntil))
        .slice(0, limit)
        .map((c) => ({
          id: c.id,
          dentistId: c.dentistId,
          clinicId: c.clinicId ?? null,
          data: c,
          retentionUntil: c.retentionUntil,
        }));
    },

    async deidentify(id, redacted, atIso) {
      if (dbEnabled) {
        await db()`
          UPDATE consultations
          SET data = ${JSON.stringify(redacted)}::jsonb,
              deidentified_at = ${atIso}::timestamptz,
              updated_at = now()
          WHERE id = ${id}
        `;
        return;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { consultations: [] });
      const idx = (data.consultations as any[]).findIndex((c) => c.id === id);
      if (idx >= 0) {
        data.consultations[idx] = redacted;
        await deps.kv.write(KEY, jsonPath(deps, FILE), data);
      }
    },

    async remove(id) {
      if (dbEnabled) {
        await db()`DELETE FROM consultations WHERE id = ${id}`;
        return;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { consultations: [] });
      data.consultations = (data.consultations as any[]).filter((c) => c.id !== id);
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },
  };
}

/* ===========================================================================
 * Optimistic concurrency for consultation saves
 * ======================================================================== */

export interface VersionedWriteResult {
  ok: boolean;
  /** Present when the write was refused: the version currently stored. */
  currentVersion?: number;
}

export interface ConsultationVersionStore {
  updateIfVersionMatches(
    id: string,
    dentistId: string,
    consultation: any,
    expectedVersion: number
  ): Promise<VersionedWriteResult>;
}

export function createConsultationVersionStore(deps: StoreDeps): ConsultationVersionStore {
  const FILE = 'consultations.json';
  const KEY = 'dentai:consultations';

  return {
    async updateIfVersionMatches(id, dentistId, consultation, expectedVersion) {
      const nextVersion = expectedVersion + 1;
      if (dbEnabled) {
        const rows = (await db()`
          UPDATE consultations
          SET data = ${JSON.stringify({ ...consultation, recordVersion: nextVersion })}::jsonb,
              consultation_clinic_id = ${consultation.clinicId ?? null},
              record_version = record_version + 1,
              updated_at = now()
          WHERE id = ${id} AND dentist_id = ${dentistId} AND record_version = ${expectedVersion}
          RETURNING record_version
        `) as any[];
        if (rows.length > 0) return { ok: true };
        const current = (await db()`
          SELECT record_version FROM consultations WHERE id = ${id} AND dentist_id = ${dentistId}
        `) as any[];
        return {
          ok: false,
          currentVersion: current.length ? Number(current[0].record_version) : undefined,
        };
      }

      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { consultations: [] });
      const idx = (data.consultations as any[]).findIndex(
        (c) => c.id === id && c.dentistId === dentistId
      );
      if (idx === -1) return { ok: false };
      const stored = data.consultations[idx];
      const storedVersion = Number(stored.recordVersion ?? 1);
      if (storedVersion !== expectedVersion) return { ok: false, currentVersion: storedVersion };
      data.consultations[idx] = { ...consultation, recordVersion: nextVersion };
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
      return { ok: true };
    },
  };
}

/* ===========================================================================
 * Billing: subscription state and processed webhook events
 * ======================================================================== */

export interface SubscriptionRecord {
  id: string;
  clinicId: string;
  plan: string;
  tier: string;
  status: string;
  seats: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  activatedBy: string | null;
  updatedAt: string;
}

export interface SubscriptionStore {
  forClinic(clinicId: string): Promise<SubscriptionRecord | null>;
  byStripeSubscriptionId(id: string): Promise<SubscriptionRecord | null>;
  byStripeCustomerId(id: string): Promise<SubscriptionRecord | null>;
  upsert(record: SubscriptionRecord): Promise<void>;
}

function rowToSubscription(r: any): SubscriptionRecord {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    plan: r.plan ?? r.tier ?? 'trial',
    tier: r.tier,
    status: r.status,
    seats: Number(r.seats ?? 1),
    stripeCustomerId: r.stripe_customer_id ?? null,
    stripeSubscriptionId: r.stripe_subscription_id ?? null,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end).toISOString() : null,
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
    activatedBy: r.activated_by ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
  };
}

export function createSubscriptionStore(deps: StoreDeps): SubscriptionStore {
  const FILE = 'subscriptions.json';
  const KEY = 'dentai:subscriptions';

  async function readAll() {
    return deps.kv.read(KEY, jsonPath(deps, FILE), { subscriptions: [] });
  }

  return {
    async forClinic(clinicId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM subscriptions
          WHERE clinic_id = ${clinicId}
          ORDER BY updated_at DESC
          LIMIT 1
        `) as any[];
        return rows.length ? rowToSubscription(rows[0]) : null;
      }
      const data = await readAll();
      const mine = (data.subscriptions as SubscriptionRecord[]).filter(
        (s) => s.clinicId === clinicId
      );
      return mine.length ? mine[mine.length - 1] : null;
    },

    async byStripeSubscriptionId(id) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM subscriptions WHERE stripe_subscription_id = ${id} LIMIT 1
        `) as any[];
        return rows.length ? rowToSubscription(rows[0]) : null;
      }
      const data = await readAll();
      return (
        (data.subscriptions as SubscriptionRecord[]).find((s) => s.stripeSubscriptionId === id) ??
        null
      );
    },

    async byStripeCustomerId(id) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM subscriptions
          WHERE stripe_customer_id = ${id}
          ORDER BY updated_at DESC
          LIMIT 1
        `) as any[];
        return rows.length ? rowToSubscription(rows[0]) : null;
      }
      const data = await readAll();
      return (
        (data.subscriptions as SubscriptionRecord[]).find((s) => s.stripeCustomerId === id) ?? null
      );
    },

    async upsert(record) {
      if (dbEnabled) {
        await db()`
          INSERT INTO subscriptions
            (id, clinic_id, stripe_customer_id, stripe_subscription_id, tier, plan, status,
             seats, current_period_end, cancel_at_period_end, activated_by, updated_at)
          VALUES
            (${record.id}, ${record.clinicId}, ${record.stripeCustomerId},
             ${record.stripeSubscriptionId}, ${record.tier}, ${record.plan}, ${record.status},
             ${record.seats}, ${record.currentPeriodEnd}::timestamptz, ${record.cancelAtPeriodEnd},
             ${record.activatedBy}, now())
          ON CONFLICT (id) DO UPDATE
            SET clinic_id = EXCLUDED.clinic_id,
                stripe_customer_id = EXCLUDED.stripe_customer_id,
                stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                tier = EXCLUDED.tier,
                plan = EXCLUDED.plan,
                status = EXCLUDED.status,
                seats = EXCLUDED.seats,
                current_period_end = EXCLUDED.current_period_end,
                cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                activated_by = EXCLUDED.activated_by,
                updated_at = now()
        `;
        return;
      }
      const data = await readAll();
      const list = data.subscriptions as SubscriptionRecord[];
      const idx = list.findIndex((s) => s.id === record.id);
      if (idx >= 0) list[idx] = record;
      else list.push(record);
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },
  };
}

export interface BillingEventStore {
  /** True when this provider event has already been processed. */
  has(eventId: string): Promise<boolean>;
  record(event: { id: string; clinicId: string | null; kind: string; detail: any }): Promise<void>;
}

export function createBillingEventStore(deps: StoreDeps): BillingEventStore {
  const FILE = 'billing_events.json';
  const KEY = 'dentai:billing_events';

  return {
    async has(eventId) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT 1 FROM billing_events WHERE id = ${eventId} LIMIT 1
        `) as any[];
        return rows.length > 0;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { events: [] });
      return (data.events as any[]).some((e) => e.id === eventId);
    },

    async record(event) {
      if (dbEnabled) {
        await db()`
          INSERT INTO billing_events (id, clinic_id, kind, detail)
          VALUES (${event.id}, ${event.clinicId}, ${event.kind}, ${JSON.stringify(event.detail)}::jsonb)
          ON CONFLICT (id) DO NOTHING
        `;
        return;
      }
      const data = await deps.kv.read(KEY, jsonPath(deps, FILE), { events: [] });
      (data.events as any[]).push({ ...event, receivedAt: new Date().toISOString() });
      await deps.kv.write(KEY, jsonPath(deps, FILE), data);
    },
  };
}
