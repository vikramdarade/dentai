/**
 * Versioned schema migrations.
 *
 * Why this exists: the schema used to be created as a side effect of the first
 * request (`CREATE TABLE IF NOT EXISTS ...` on cold start). That has no
 * ordering guarantee, no record of what ran, and — the part that actually
 * hurts — no rollback. A bad change meant restoring a backup and losing
 * whatever was written since.
 *
 * The rules here:
 *  1. Migrations are numbered, ordered and applied deliberately (by
 *     `bun run db:migrate` or on boot for forward-only additions).
 *  2. Every migration states its reverse operation. `bun run db:migrate:down`
 *     rolls the last one back. If a table cannot be dropped safely in your
 *     judgement, the down path must still exist and must say why it is a
 *     no-op — silence is the thing that is not allowed.
 *  3. Applied migrations are recorded in `schema_migrations`, and editing a
 *     migration that has already run is refused unless deliberately forced
 *     (`DENTAI_MIGRATION_FORCE=true`). Changing shipped history is how two
 *     environments end up with different schemas.
 *
 * Forward-only statements are written to be re-runnable
 * (`IF NOT EXISTS` / `IF EXISTS`) so a retry after a partial failure is safe.
 * Statements run one at a time rather than in one big transaction: this works
 * against both the Neon HTTP driver and plain Postgres, and because each
 * statement is idempotent, a mid-migration failure is recoverable by running it
 * again rather than by restoring a database.
 */

import crypto from 'crypto';

/**
 * A SQL tag function. Typed loosely on purpose: the Neon driver's query promise
 * is not a plain `Promise<any[]>`, and this module must work with both the
 * driver and a test double.
 */
export type SqlExecutor = (strings: TemplateStringsArray, ...values: any[]) => any;

export interface Migration {
  version: number;
  name: string;
  /** Bump this by hand whenever you edit an already-shipped migration. */
  checksum: string;
  up: (sql: SqlExecutor) => Promise<void>;
  down: (sql: SqlExecutor) => Promise<void>;
}

const nameOf = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ').trim();

/**
 * 001 — baseline.
 *
 * The complete schema as it stood before migrations were introduced, expressed
 * as migration 001 so an existing database is adopted without a rewrite: every
 * statement is `IF NOT EXISTS`, so applying it to a live database is a no-op
 * that simply records the baseline.
 */
const baseline: Migration = {
  version: 1,
  name: 'baseline_schema',
  checksum: 'baseline-1',
  up: async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS dentists (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        specialty  TEXT NOT NULL,
        pin_hash   TEXT NOT NULL,
        salt       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`ALTER TABLE dentists ADD COLUMN IF NOT EXISTS session_epoch BIGINT NOT NULL DEFAULT 0`;
    await sql`
      CREATE TABLE IF NOT EXISTS consultations (
        id         TEXT PRIMARY KEY,
        dentist_id TEXT NOT NULL,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_consultations_dentist ON consultations (dentist_id)`;
    await sql`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS consultation_clinic_id TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_consultations_clinic ON consultations (consultation_clinic_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id         BIGSERIAL PRIMARY KEY,
        event      TEXT NOT NULL,
        dentist_id TEXT,
        detail     JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS app_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS clinics (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        invite_code      TEXT NOT NULL UNIQUE,
        owner_dentist_id TEXT NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_clinics_owner ON clinics (owner_dentist_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS clinic_members (
        clinic_id  TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        dentist_id TEXT NOT NULL,
        role       TEXT NOT NULL CHECK (role IN ('owner', 'dentist')),
        status     TEXT NOT NULL CHECK (status IN ('active', 'pending')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (clinic_id, dentist_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_clinic_members_dentist ON clinic_members (dentist_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS note_jobs (
        id              TEXT PRIMARY KEY,
        dentist_id      TEXT NOT NULL,
        clinic_id       TEXT,
        priority        TEXT NOT NULL CHECK (priority IN ('emergency', 'urgent', 'routine')),
        status          TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed', 'metered')),
        attempts        INTEGER NOT NULL DEFAULT 0,
        payload         JSONB NOT NULL,
        result          JSONB,
        error           TEXT,
        next_attempt_at TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_note_jobs_status ON note_jobs (status, next_attempt_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_note_jobs_dentist ON note_jobs (dentist_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS usage_events (
        id         BIGSERIAL PRIMARY KEY,
        scope_id   TEXT NOT NULL,
        dentist_id TEXT NOT NULL,
        day        TEXT NOT NULL,
        kind       TEXT NOT NULL,
        tokens     INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_events_scope_day ON usage_events (scope_id, day)`;
    await sql`
      CREATE TABLE IF NOT EXISTS login_attempts (
        key          TEXT PRIMARY KEY,
        failures     INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS revoked_sessions (
        jti        TEXT PRIMARY KEY,
        dentist_id TEXT,
        reason     TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions (expires_at)`;
    await sql`
      CREATE TABLE IF NOT EXISTS recovery_tokens (
        token_hash TEXT PRIMARY KEY,
        dentist_id TEXT NOT NULL,
        issued_by  TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_recovery_tokens_dentist ON recovery_tokens (dentist_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                     TEXT PRIMARY KEY,
        clinic_id              TEXT NOT NULL,
        stripe_customer_id     TEXT,
        stripe_subscription_id TEXT,
        tier                   TEXT NOT NULL DEFAULT 'trial',
        status                 TEXT NOT NULL DEFAULT 'active',
        seats                  INTEGER NOT NULL DEFAULT 1,
        current_period_end     TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_clinic ON subscriptions (clinic_id)`;
  },
  down: async (sql) => {
    // Reverses the baseline by dropping everything it created, children first.
    // Destructive by definition — this is why `down` is a deliberate command
    // and never runs automatically.
    await sql`DROP TABLE IF EXISTS subscriptions`;
    await sql`DROP TABLE IF EXISTS recovery_tokens`;
    await sql`DROP TABLE IF EXISTS revoked_sessions`;
    await sql`DROP TABLE IF EXISTS login_attempts`;
    await sql`DROP TABLE IF EXISTS usage_events`;
    await sql`DROP TABLE IF EXISTS note_jobs`;
    await sql`DROP TABLE IF EXISTS clinic_members`;
    await sql`DROP TABLE IF EXISTS clinics`;
    await sql`DROP TABLE IF EXISTS audit_logs`;
    await sql`DROP TABLE IF EXISTS app_meta`;
    await sql`DROP TABLE IF EXISTS consultations`;
    await sql`DROP TABLE IF EXISTS dentists`;
  },
};

/**
 * 002 — custody and operability.
 *
 * Everything this round needs to exist in Postgres:
 *  - `practice_acceptances`: evidence that a *practice* accepted a specific
 *    version of the terms and the data-processing terms. Per-patient consent
 *    was already stored; the practice-level agreement was not.
 *  - `rate_limit_counters`: durable rate limiting (in-process counters are
 *    per-instance on serverless, so they bound nothing).
 *  - `mfa_credentials` / `mfa_recovery_codes`: real TOTP factors.
 *  - audit chain columns: `prev_hash` / `hash` so the access log can be shown
 *    to be unaltered.
 *  - `clinic_invites`: emailed invitations (the growth loop needs a real email).
 *  - consultation `record_version` / `retention_until` / `deidentified_at`:
 *    optimistic-concurrency control and enforced retention.
 *  - subscription billing columns: plan, enforcement state, period.
 */
const custodyAndOperability: Migration = {
  version: 2,
  name: 'custody_and_operability',
  checksum: 'custody-1',
  up: async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS practice_acceptances (
        id               TEXT PRIMARY KEY,
        clinic_id        TEXT NOT NULL,
        terms_version    TEXT NOT NULL,
        privacy_version  TEXT NOT NULL,
        dpa_version      TEXT NOT NULL,
        accepted_by_name TEXT NOT NULL,
        accepted_by_email TEXT,
        accepted_by_dentist_id TEXT,
        accepted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_practice_acceptances_clinic ON practice_acceptances (clinic_id, accepted_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        key        TEXT PRIMARY KEY,
        hits       INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_counters (expires_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS mfa_credentials (
        dentist_id   TEXT PRIMARY KEY,
        secret       TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        confirmed_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
        code_hash  TEXT PRIMARY KEY,
        dentist_id TEXT NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mfa_recovery_dentist ON mfa_recovery_codes (dentist_id)`;

    await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT`;
    await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash TEXT`;
    await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_seq BIGINT`;

    await sql`
      CREATE TABLE IF NOT EXISTS clinic_invites (
        id         TEXT PRIMARY KEY,
        clinic_id  TEXT NOT NULL,
        email      TEXT NOT NULL,
        invited_by TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'sent',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_clinic_invites_clinic ON clinic_invites (clinic_id, created_at DESC)`;

    await sql`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS record_version INTEGER NOT NULL DEFAULT 1`;
    await sql`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ`;
    await sql`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS deidentified_at TIMESTAMPTZ`;
    await sql`CREATE INDEX IF NOT EXISTS idx_consultations_retention ON consultations (retention_until)`;

    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial'`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS limits JSONB`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS activated_by TEXT`;
    await sql`
      CREATE TABLE IF NOT EXISTS billing_events (
        id          TEXT PRIMARY KEY,
        clinic_id   TEXT,
        kind        TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        detail      JSONB
      )
    `;
  },
  down: async (sql) => {
    await sql`DROP TABLE IF EXISTS billing_events`;
    await sql`ALTER TABLE subscriptions DROP COLUMN IF EXISTS activated_by`;
    await sql`ALTER TABLE subscriptions DROP COLUMN IF EXISTS cancel_at_period_end`;
    await sql`ALTER TABLE subscriptions DROP COLUMN IF EXISTS limits`;
    await sql`ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan`;
    await sql`DROP INDEX IF EXISTS idx_consultations_retention`;
    await sql`ALTER TABLE consultations DROP COLUMN IF EXISTS deidentified_at`;
    await sql`ALTER TABLE consultations DROP COLUMN IF EXISTS retention_until`;
    await sql`ALTER TABLE consultations DROP COLUMN IF EXISTS record_version`;
    await sql`DROP TABLE IF EXISTS clinic_invites`;
    await sql`ALTER TABLE audit_logs DROP COLUMN IF EXISTS chain_seq`;
    await sql`ALTER TABLE audit_logs DROP COLUMN IF EXISTS hash`;
    await sql`ALTER TABLE audit_logs DROP COLUMN IF EXISTS prev_hash`;
    await sql`DROP TABLE IF EXISTS mfa_recovery_codes`;
    await sql`DROP TABLE IF EXISTS mfa_credentials`;
    await sql`DROP TABLE IF EXISTS rate_limit_counters`;
    await sql`DROP TABLE IF EXISTS practice_acceptances`;
  },
};

/**
 * 003 — patient identity.
 *
 * The registry that stops a patient's name being used as their identity (see
 * `src/lib/patients.ts`). Two additions:
 *
 *  - `patients`: one row per patient per clinic. `name_key` is the normalised
 *    name used to find *candidates*. The partial unique index on
 *    (clinic_id, name_key, dob) makes registering the same person twice
 *    idempotent when a date of birth is known, and deliberately allows duplicate
 *    names with no DOB — those cannot be told apart, and a duplicate record is
 *    the safe failure where a shared chart is not.
 *  - `consultations.patient_id`: links a record to the patient it belongs to.
 *    Nullable because records written before this migration have no link. The
 *    application must read a null `patient_id` as "patient unknown" and show no
 *    prior-visit history, rather than falling back to matching on the name —
 *    which is exactly the behaviour this migration exists to remove.
 */
const patientIdentity: Migration = {
  version: 3,
  name: 'patient_identity',
  checksum: 'patients-1',
  up: async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS patients (
        id          TEXT PRIMARY KEY,
        clinic_id   TEXT NOT NULL,
        first_name  TEXT NOT NULL,
        last_name   TEXT NOT NULL,
        dob         TEXT NOT NULL DEFAULT '',
        phone       TEXT,
        name_key    TEXT NOT NULL,
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        archived_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_patients_clinic_name ON patients (clinic_id, name_key)`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_identity
      ON patients (clinic_id, name_key, dob)
      WHERE archived_at IS NULL AND dob <> ''
    `;
    await sql`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS patient_id TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations (patient_id)`;
  },
  down: async (sql) => {
    await sql`DROP INDEX IF EXISTS idx_consultations_patient`;
    await sql`ALTER TABLE consultations DROP COLUMN IF EXISTS patient_id`;
    await sql`DROP TABLE IF EXISTS patients`;
  },
};

/**
 * 004 — durable chair-side beacon sessions.
 *
 * The beacon session state was a module-level `Map`, which on a serverless host
 * is per-instance: pairing succeeded on one instance and the next status poll
 * landed on another that had never heard of the chair. Audio chunks were pushed
 * into that same Map without bound.
 *
 * `chair_sessions` holds the small, hot state (status, telemetry, commands) and
 * `chair_audio_chunks` holds the audio separately, so a heartbeat never
 * re-serialises megabytes. Chunk rows are deleted with their session by the
 * sweeper, and the application caps the total accepted per session.
 */
const durableChairSessions: Migration = {
  version: 4,
  name: 'durable_chair_sessions',
  checksum: 'chair-sessions-1',
  up: async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS chair_sessions (
        chair_id     TEXT PRIMARY KEY,
        pin_code     TEXT NOT NULL,
        room_name    TEXT NOT NULL,
        clinic_id    TEXT,
        dentist_id   TEXT,
        dentist_name TEXT,
        token        TEXT NOT NULL,
        status       TEXT NOT NULL,
        device_info  JSONB,
        commands     JSONB NOT NULL DEFAULT '[]'::jsonb,
        telemetry    JSONB NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ NOT NULL,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_chair_sessions_expires ON chair_sessions (expires_at)`;
    await sql`
      CREATE TABLE IF NOT EXISTS chair_audio_chunks (
        chair_id    TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        data_base64 TEXT,
        size_bytes  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (chair_id, chunk_index)
      )
    `;
  },
  down: async (sql) => {
    await sql`DROP TABLE IF EXISTS chair_audio_chunks`;
    await sql`DROP TABLE IF EXISTS chair_sessions`;
  },
};

/** Ordered list. Append only — never reorder or renumber a released migration. */
export const MIGRATIONS: Migration[] = [
  baseline,
  custodyAndOperability,
  patientIdentity,
  durableChairSessions
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export interface MigrationRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
  rolled_back_at: string | null;
}

const MIGRATION_TABLE = 'schema_migrations';

async function ensureMigrationTable(sql: SqlExecutor): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version        INTEGER PRIMARY KEY,
      name           TEXT NOT NULL,
      checksum       TEXT NOT NULL,
      applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      rolled_back_at TIMESTAMPTZ
    )
  `;
}

export async function listAppliedMigrations(sql: SqlExecutor): Promise<MigrationRow[]> {
  await ensureMigrationTable(sql);
  const rows = (await sql`
    SELECT version, name, checksum, applied_at, rolled_back_at
    FROM schema_migrations
    ORDER BY version ASC
  `) as any[];
  return rows.map((r: any) => ({
    version: Number(r.version),
    name: r.name,
    checksum: r.checksum,
    applied_at: new Date(r.applied_at).toISOString(),
    rolled_back_at: r.rolled_back_at ? new Date(r.rolled_back_at).toISOString() : null,
  }));
}

export interface MigrateOptions {
  /** Apply only up to and including this version. */
  target?: number;
  /** Apply a migration whose recorded checksum no longer matches. */
  force?: boolean;
  log?: (message: string) => void;
}

export interface MigrateResult {
  applied: number[];
  skipped: number[];
}

/**
 * Applies every pending migration in order. Idempotent: a second call is a
 * no-op, and a partially applied migration is completed by re-running it.
 */
export async function runMigrations(
  sql: SqlExecutor,
  options: MigrateOptions = {}
): Promise<MigrateResult> {
  const log = options.log || (() => {});
  const target = options.target ?? LATEST_VERSION;
  await ensureMigrationTable(sql);

  const applied = await listAppliedMigrations(sql);
  const active = new Map(
    applied.filter((r) => !r.rolled_back_at).map((r) => [r.version, r])
  );

  // A recorded migration whose checksum changed means someone edited shipped
  // history. Two environments can then disagree while both claim to be current,
  // so refuse loudly rather than paper over it.
  for (const migration of MIGRATIONS) {
    const record = active.get(migration.version);
    if (record && record.checksum !== migration.checksum && !options.force) {
      throw new Error(
        `Migration ${migration.version} (${migration.name}) was edited after it was applied ` +
          `(recorded checksum ${record.checksum}, current ${migration.checksum}). ` +
          `Add a new migration instead, or set DENTAI_MIGRATION_FORCE=true if you know this database was never migrated.`
      );
    }
  }

  const result: MigrateResult = { applied: [], skipped: [] };
  for (const migration of MIGRATIONS) {
    if (migration.version > target) break;
    // Under `force`, only a migration whose recorded checksum has drifted is
    // re-run (all statements are idempotent by design) and its record
    // rewritten, so a tampered history is repaired instead of refusing
    // forever. Unchanged migrations stay skipped, and without force an applied
    // migration is always skipped.
    const drifted =
      options.force && active.get(migration.version)?.checksum !== migration.checksum;
    if (active.has(migration.version) && !drifted) {
      result.skipped.push(migration.version);
      continue;
    }
    log(`Applying migration ${migration.version} — ${migration.name}`);
    await migration.up(sql);
    await sql`
      INSERT INTO schema_migrations (version, name, checksum, applied_at, rolled_back_at)
      VALUES (${migration.version}, ${migration.name}, ${migration.checksum}, now(), NULL)
      ON CONFLICT (version) DO UPDATE
        SET name = EXCLUDED.name,
            checksum = EXCLUDED.checksum,
            applied_at = now(),
            rolled_back_at = NULL
    `;
    result.applied.push(migration.version);
    log(`Applied migration ${migration.version} — ${migration.name}`);
  }
  return result;
}

/**
 * Rolls back the most recently applied migration (or a specific version), and
 * records that it was rolled back, so `runMigrations` will re-apply it.
 */
export async function rollbackMigration(
  sql: SqlExecutor,
  version?: number,
  log: (message: string) => void = () => {}
): Promise<Migration | null> {
  await ensureMigrationTable(sql);
  const applied = await listAppliedMigrations(sql);
  const active = applied.filter((r) => !r.rolled_back_at);
  if (active.length === 0) return null;

  const targetVersion = version ?? active[active.length - 1].version;
  const migration = MIGRATIONS.find((m) => m.version === targetVersion);
  if (!migration) {
    throw new Error(`No migration is defined for version ${targetVersion}.`);
  }

  log(`Rolling back migration ${migration.version} — ${migration.name}`);
  await migration.down(sql);
  await sql`
    UPDATE schema_migrations SET rolled_back_at = now() WHERE version = ${migration.version}
  `;
  log(`Rolled back migration ${migration.version} — ${migration.name}`);
  return migration;
}

/** Stable, human-readable status for health output and the CLI. */
export function schemaVersionLabel(rows: MigrationRow[]): string {
  const active = rows.filter((r) => !r.rolled_back_at).map((r) => r.version);
  const highest = active.length ? Math.max(...active) : 0;
  return `migrations:${highest}/${LATEST_VERSION}`;
}

/**
 * Pending migrations, used by the boot check to decide whether the deployment
 * is serving a schema it understands.
 */
export function pendingVersions(rows: MigrationRow[]): number[] {
  const active = new Set(rows.filter((r) => !r.rolled_back_at).map((r) => r.version));
  return MIGRATIONS.filter((m) => !active.has(m.version)).map((m) => m.version);
}

/** Checksum helper for operator-facing verification (not used for ordering). */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
