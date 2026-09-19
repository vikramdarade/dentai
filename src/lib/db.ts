/**
 * Postgres data-access layer (Neon serverless driver).
 *
 * When `DATABASE_URL` is set, all dentist/consultation/audit persistence goes through
 * Postgres — durable and safe on serverless (Vercel) runtimes. When it is not set
 * (local dev without a DB, or the test suite), the server falls back to its original
 * JSON-file / Vercel-KV path, so nothing breaks in environments without a database.
 *
 * IMPORTANT: `.env.local` is loaded here, at the top of this module, BEFORE
 * `dbEnabled` is evaluated. The server entrypoint also calls `dotenv.config()`, but
 * ES module imports are evaluated before the entrypoint body runs, so this module
 * must load the env itself or `DATABASE_URL` would never be seen.
 *
 * Design notes:
 * - `dentists` and `audit_logs` are fully relational.
 * - `consultations` stores each record as a JSONB document (`data`). The app already
 *   treats consultations as heterogeneous documents (findings, transcript, patient
 *   letter, template id...), so JSONB avoids an unstable 20-column table while still
 *   giving us real Postgres durability, indexing on `dentist_id`, and transactions.
 * - `app_meta` holds a one-time migration flag so pre-Postgres JSON data is seeded
 *   exactly once (see `seedFromJsonFallback`).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../logger';
import { LATEST_VERSION, listAppliedMigrations, runMigrations } from './migrations';
import { GENESIS_HASH, auditEntryHash } from './auditChain';

type Sql = ReturnType<typeof neon>;

const connectionString = process.env.DATABASE_URL || '';
export const dbEnabled = !!connectionString;

export let sql: Sql | null = null;
if (dbEnabled) {
  sql = neon(connectionString);
}

/**
 * Test-only seam.
 *
 * The Neon driver speaks Neon's HTTP endpoint, so it cannot talk to a plain
 * Postgres — which is why the Postgres-backed CI suite injects a TCP-backed tag
 * function here instead of re-implementing the queries against a second client
 * (that would test a copy, not the code that runs in production).
 *
 * Production never calls this.
 */
export function setSqlExecutorForTests(executor: Sql | null): void {
  sql = executor;
}

/**
 * Brings the schema up to date on boot.
 *
 * The DDL itself now lives in `src/lib/migrations.ts`, which records what ran in
 * `schema_migrations` and defines a reverse operation for each step. This
 * wrapper exists because every deployment already calls it on cold start, and a
 * forward-only migration is safe to apply there. Deliberate operations
 * (including any rollback) go through `bun run db:migrate`.
 */
export async function initDbSchema(): Promise<void> {
  if (!sql) return;
  const result = await runMigrations(sql, {
    force: process.env.DENTAI_MIGRATION_FORCE === 'true',
    log: (message) => logger.info(`[Migrations] ${message}`),
  });
  logger.info(
    `[Migrations] Schema at version ${LATEST_VERSION} ` +
      `(applied now: ${result.applied.length ? result.applied.join(', ') : 'none'}).`
  );
}

/**
 * One-time migration: copies dentists/consultations that existed in the pre-Postgres
 * JSON store into Postgres so switching to a real database does not lose data.
 * Guarded by an `app_meta` flag so it runs exactly once and never resurrects
 * profiles deleted afterwards.
 */
export async function seedFromJsonFallback(): Promise<void> {
  if (!sql) return;
  const existing = (await sql`SELECT value FROM app_meta WHERE key = 'json_seed_done'`) as any[];
  if (existing.length > 0) return;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Honour the same data-dir override the server uses so tests and operator
  // tooling never seed from (or read) a directory they should not touch.
  const dataDir = process.env.DENTAI_DATA_DIR
    ? path.resolve(process.env.DENTAI_DATA_DIR)
    : path.resolve(__dirname, '../../data');

  let seededDentists = 0;
  let seededConsultations = 0;

  try {
    const usersPath = path.join(dataDir, 'users.json');
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
      for (const d of users.dentists || []) {
        await sql`
          INSERT INTO dentists (id, name, specialty, pin_hash, salt)
          VALUES (${d.id}, ${d.name}, ${d.specialty}, ${d.pinHash}, ${d.salt})
          ON CONFLICT (id) DO NOTHING
        `;
        seededDentists++;
      }
    }

    const consultationsPath = path.join(dataDir, 'consultations.json');
    if (fs.existsSync(consultationsPath)) {
      const data = JSON.parse(fs.readFileSync(consultationsPath, 'utf-8'));
      for (const c of data.consultations || []) {
        await sql`
          INSERT INTO consultations (id, dentist_id, data)
          VALUES (${c.id}, ${c.dentistId}, ${JSON.stringify(c)}::jsonb)
          ON CONFLICT (id) DO NOTHING
        `;
        seededConsultations++;
      }
    }
  } catch (err: any) {
    logger.warn('[Postgres] JSON fallback seed failed (continuing without it):', err.message);
  }

  await sql`
    INSERT INTO app_meta (key, value)
    VALUES ('json_seed_done', 'true')
    ON CONFLICT (key) DO NOTHING
  `;
  if (seededDentists > 0 || seededConsultations > 0) {
    logger.info(`[Postgres] Seeded ${seededDentists} dentist(s) and ${seededConsultations} consultation(s) from JSON fallback store.`);
  }
}

// --- Dentists -------------------------------------------------------------------

export async function dbGetDentists(): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT id, name, specialty, pin_hash, salt, session_epoch
    FROM dentists
    ORDER BY created_at ASC
  `) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    pinHash: r.pin_hash,
    salt: r.salt,
    sessionEpoch: Number(r.session_epoch ?? 0)
  }));
}

/**
 * Creates a dentist, or — when the id already exists — updates the credential
 * fields.
 *
 * This is an upsert on purpose. It is the single write path used by
 * registration, PIN change and credential recovery, and those three callers
 * need different behaviour on conflict: registration must not clobber an
 * existing account (ids are fresh UUIDs, so a conflict cannot happen), while a
 * credential change MUST replace the stored hash. A previous `DO NOTHING`
 * version silently discarded PIN changes in Postgres.
 *
 * Bumping session_epoch on update is deliberate: any credential change retires
 * every session token minted before it.
 */
export async function dbInsertDentist(d: {
  id: string;
  name: string;
  specialty: string;
  pinHash: string;
  salt: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO dentists (id, name, specialty, pin_hash, salt)
    VALUES (${d.id}, ${d.name}, ${d.specialty}, ${d.pinHash}, ${d.salt})
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          specialty = EXCLUDED.specialty,
          pin_hash = EXCLUDED.pin_hash,
          salt = EXCLUDED.salt,
          session_epoch = dentists.session_epoch + 1
  `;
}

export async function dbDeleteDentist(id: string): Promise<void> {
  if (!sql) return;
  await sql`DELETE FROM dentists WHERE id = ${id}`;
}

/** O(1) point lookup — the auth middleware runs this on EVERY request. */
export async function dbGetDentistById(id: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, name, specialty, pin_hash, salt, session_epoch
    FROM dentists WHERE id = ${id}
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    pinHash: r.pin_hash,
    salt: r.salt,
    sessionEpoch: Number(r.session_epoch ?? 0)
  };
}

/**
 * Case-insensitive lookup. Restricted to an EXACT name match on purpose: a
 * partial match can resolve to the wrong clinician, which would sign one
 * practitioner into another's records (and misattribute their charting).
 */
export async function dbGetDentistByName(name: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, name, specialty, pin_hash, salt, session_epoch
    FROM dentists WHERE lower(name) = lower(${name})
    LIMIT 1
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    pinHash: r.pin_hash,
    salt: r.salt,
    sessionEpoch: Number(r.session_epoch ?? 0)
  };
}

/**
 * Replaces a clinician's PIN hash. dbInsertDentist is an `ON CONFLICT DO
 * NOTHING` insert (registration must not overwrite an existing account), so
 * credential changes need this explicit update.
 */
export async function dbUpdateDentistPin(id: string, pinHash: string, salt: string): Promise<boolean> {
  if (!sql) return false;
  const rows = (await sql`
    UPDATE dentists SET pin_hash = ${pinHash}, salt = ${salt}
    WHERE id = ${id}
    RETURNING id
  `) as any[];
  return rows.length > 0;
}

/**
 * Invalidates every existing session for an account by advancing its epoch.
 * Used after a credential change or an operator lockout.
 */
export async function dbBumpSessionEpoch(id: string): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    UPDATE dentists SET session_epoch = session_epoch + 1
    WHERE id = ${id}
    RETURNING session_epoch
  `) as any[];
  return rows.length > 0 ? Number(rows[0].session_epoch) : 0;
}

// --- Consultations ---------------------------------------------------------------

export async function dbListConsultations(dentistId: string): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT data FROM consultations
    WHERE dentist_id = ${dentistId}
    ORDER BY created_at DESC
  `) as any[];
  return rows.map((r: any) => r.data);
}

export async function dbInsertConsultation(consultation: any): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO consultations (id, dentist_id, consultation_clinic_id, patient_id, data)
    VALUES (
      ${consultation.id}, ${consultation.dentistId}, ${consultation.clinicId ?? null},
      ${consultation.patientId ?? null}, ${JSON.stringify(consultation)}::jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function dbUpdateConsultation(
  id: string,
  dentistId: string,
  consultation: any
): Promise<boolean> {
  if (!sql) return false;
  const rows = (await sql`
    UPDATE consultations
    SET data = ${JSON.stringify(consultation)}::jsonb,
        consultation_clinic_id = ${consultation.clinicId ?? null},
        patient_id = ${consultation.patientId ?? null},
        updated_at = now()
    WHERE id = ${id} AND dentist_id = ${dentistId}
    RETURNING id
  `) as any[];
  return rows.length > 0;
}

/**
 * Every record for one patient at one clinic, newest first.
 *
 * Scoped to the patient registry id, not to a name. Previous history was looked
 * up by matching first + last name, so two patients called John Smith shared a
 * chart. A record written before patient identity existed has no `patient_id`
 * and is therefore not returned here — the caller must show "no prior history"
 * rather than fall back to matching on the name.
 */
export async function dbListConsultationsByPatient(
  clinicId: string,
  patientId: string,
  limit = 100
): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT data FROM consultations
    WHERE consultation_clinic_id = ${clinicId}
      AND patient_id = ${patientId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r: any) => r.data);
}

// --- Clinics & memberships ----------------------------------------------------

export async function dbInsertClinic(c: {
  id: string;
  name: string;
  inviteCode: string;
  ownerDentistId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO clinics (id, name, invite_code, owner_dentist_id)
    VALUES (${c.id}, ${c.name}, ${c.inviteCode}, ${c.ownerDentistId})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO clinic_members (clinic_id, dentist_id, role, status)
    VALUES (${c.id}, ${c.ownerDentistId}, 'owner', 'active')
    ON CONFLICT (clinic_id, dentist_id) DO NOTHING
  `;
}

export async function dbGetClinicById(id: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, name, invite_code, owner_dentist_id
    FROM clinics WHERE id = ${id}
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, inviteCode: r.invite_code, ownerDentistId: r.owner_dentist_id };
}

export async function dbGetClinicByInviteCode(inviteCode: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, name, invite_code, owner_dentist_id
    FROM clinics WHERE invite_code = ${inviteCode}
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, inviteCode: r.invite_code, ownerDentistId: r.owner_dentist_id };
}

export async function dbGetClinicByOwner(ownerDentistId: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, name, invite_code, owner_dentist_id
    FROM clinics WHERE owner_dentist_id = ${ownerDentistId}
    ORDER BY created_at ASC
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, inviteCode: r.invite_code, ownerDentistId: r.owner_dentist_id };
}

export async function dbUpdateClinicInviteCode(clinicId: string, inviteCode: string): Promise<boolean> {
  if (!sql) return false;
  const rows = (await sql`
    UPDATE clinics SET invite_code = ${inviteCode}
    WHERE id = ${clinicId}
    RETURNING id
  `) as any[];
  return rows.length > 0;
}

export async function dbUpdateClinicName(clinicId: string, name: string): Promise<boolean> {
  if (!sql) return false;
  const rows = (await sql`
    UPDATE clinics SET name = ${name}
    WHERE id = ${clinicId}
    RETURNING id
  `) as any[];
  return rows.length > 0;
}

export async function dbListClinicMembers(clinicId: string): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT cm.dentist_id, cm.role, cm.status, d.name
    FROM clinic_members cm
    JOIN dentists d ON d.id = cm.dentist_id
    WHERE cm.clinic_id = ${clinicId}
    ORDER BY cm.created_at ASC
  `) as any[];
  return rows.map((r: any) => ({
    dentistId: r.dentist_id,
    name: r.name,
    role: r.role,
    status: r.status
  }));
}

export async function dbListMembershipsForDentist(dentistId: string): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT cm.clinic_id, cm.role, cm.status, c.name, c.invite_code, c.owner_dentist_id
    FROM clinic_members cm
    JOIN clinics c ON c.id = cm.clinic_id
    WHERE cm.dentist_id = ${dentistId}
    ORDER BY cm.created_at ASC
  `) as any[];
  return rows.map((r: any) => ({
    clinicId: r.clinic_id,
    clinicName: r.name,
    role: r.role,
    status: r.status,
    inviteCode: r.invite_code,
    ownerDentistId: r.owner_dentist_id
  }));
}

export async function dbUpsertMembership(
  clinicId: string,
  dentistId: string,
  status: 'active' | 'pending'
): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO clinic_members (clinic_id, dentist_id, role, status)
    VALUES (${clinicId}, ${dentistId}, 'dentist', ${status})
    ON CONFLICT (clinic_id, dentist_id)
    DO UPDATE SET status = ${status}
  `;
}

export async function dbDeleteMembership(clinicId: string, dentistId: string): Promise<boolean> {
  if (!sql) return false;
  const rows = (await sql`
    DELETE FROM clinic_members
    WHERE clinic_id = ${clinicId} AND dentist_id = ${dentistId} AND role <> 'owner'
    RETURNING dentist_id
  `) as any[];
  return rows.length > 0;
}

export async function dbCountActiveMembers(clinicId: string): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    SELECT COUNT(*)::int AS count
    FROM clinic_members
    WHERE clinic_id = ${clinicId} AND status = 'active'
  `) as any[];
  return Number(rows[0]?.count ?? 0);
}

export async function dbListConsultationsForClinic(clinicId: string): Promise<any[]> {
  if (!sql) return [];
  // The indexed column is authoritative for new rows; the JSONB match keeps
  // pre-migration rows visible without a backfill.
  const rows = (await sql`
    SELECT data FROM consultations
    WHERE consultation_clinic_id = ${clinicId}
       OR (consultation_clinic_id IS NULL AND data->>'clinicId' = ${clinicId})
    ORDER BY created_at DESC
  `) as any[];
  return rows.map((r: any) => r.data);
}

// --- Note-generation job fabric -------------------------------------------------

export async function dbInsertNoteJob(job: {
  id: string;
  dentistId: string;
  clinicId?: string;
  priority: string;
  status: string;
  attempts: number;
  payload: any;
  nextAttemptAt: Date | null;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO note_jobs (id, dentist_id, clinic_id, priority, status, attempts, payload, next_attempt_at)
    VALUES (${job.id}, ${job.dentistId}, ${job.clinicId ?? null}, ${job.priority}, ${job.status},
            ${job.attempts}, ${JSON.stringify(job.payload)}::jsonb, ${job.nextAttemptAt?.toISOString() ?? null})
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function dbGetNoteJob(id: string, dentistId: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, dentist_id, clinic_id, priority, status, attempts, result, error, next_attempt_at, created_at
    FROM note_jobs WHERE id = ${id} AND dentist_id = ${dentistId}
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    dentistId: r.dentist_id,
    clinicId: r.clinic_id,
    priority: r.priority,
    status: r.status,
    attempts: r.attempts,
    result: r.result,
    error: r.error,
    nextAttemptAt: r.next_attempt_at ? new Date(r.next_attempt_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString()
  };
}

/**
 * Atomically claims the next ready job: flips it to 'processing' and bumps
 * attempts inside a single statement using FOR UPDATE SKIP LOCKED, so multiple
 * server instances draining the same queue can never grab (or double-generate)
 * the same job. Called per tick (low volume, covered by idx_note_jobs_status).
 */
export async function dbClaimNextReadyNoteJob(nowIso: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    UPDATE note_jobs
    SET status = 'processing',
        attempts = attempts + 1,
        error = NULL,
        next_attempt_at = NULL,
        updated_at = now()
    WHERE id = (
      SELECT id FROM note_jobs
      WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ${nowIso}::timestamptz)
      ORDER BY CASE priority WHEN 'emergency' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END DESC,
               created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, dentist_id, clinic_id, priority, status, attempts, payload, created_at
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    dentistId: r.dentist_id,
    clinicId: r.clinic_id,
    priority: r.priority,
    status: r.status,
    attempts: r.attempts,
    payload: r.payload,
    createdAt: new Date(r.created_at).toISOString()
  };
}

/** Oldest ready job for the worker, priority first (read-only peek, JSON path). */
export async function dbNextReadyNoteJob(nowIso: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, dentist_id, clinic_id, priority, status, attempts, payload, next_attempt_at, created_at
    FROM note_jobs
    WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ${nowIso}::timestamptz)
    ORDER BY CASE priority WHEN 'emergency' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END DESC,
             created_at ASC
    LIMIT 1
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    dentistId: r.dentist_id,
    clinicId: r.clinic_id,
    priority: r.priority,
    status: r.status,
    attempts: r.attempts,
    payload: r.payload,
    createdAt: new Date(r.created_at).toISOString()
  };
}

/** Stale jobs whose owning instance died mid-'processing' are requeued here. */
export async function dbRequeueStuckProcessingJobs(olderThanMs: number): Promise<number> {
  if (!sql) return 0;
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = (await sql`
    UPDATE note_jobs
    SET status = 'queued', next_attempt_at = now(), updated_at = now()
    WHERE status = 'processing'
      AND updated_at <= ${cutoff}::timestamptz
    RETURNING id
  `) as any[];
  return rows.length;
}

/** Full patch — the worker always knows every field, so we SET them all. */
export async function dbUpdateNoteJob(
  id: string,
  patch: { status: string; attempts: number; result: any; error: string | null; nextAttemptAt: Date | null }
): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE note_jobs
    SET status = ${patch.status},
        attempts = ${patch.attempts},
        result = ${patch.result == null ? null : JSON.stringify(patch.result)}::jsonb,
        error = ${patch.error},
        next_attempt_at = ${patch.nextAttemptAt ? patch.nextAttemptAt.toISOString() : null}::timestamptz,
        updated_at = now()
    WHERE id = ${id}
  `;
}

// --- Usage metering -------------------------------------------------------------

export async function dbRecordUsage(
  scopeId: string,
  dentistId: string,
  kind: string,
  tokens: number,
  day: string
): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO usage_events (scope_id, dentist_id, kind, tokens, day)
    VALUES (${scopeId}, ${dentistId}, ${kind}, ${tokens}, ${day})
  `;
}

export async function dbGetUsageCount(scopeId: string, day: string): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    SELECT COUNT(*)::int AS count FROM usage_events WHERE scope_id = ${scopeId} AND day = ${day}
  `) as any[];
  return rows[0]?.count ?? 0;
}

/** Tokens consumed today for a scope — the cost ceiling, not just a note count. */
export async function dbGetUsageTokens(scopeId: string, day: string): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    SELECT COALESCE(SUM(tokens), 0)::bigint AS tokens
    FROM usage_events WHERE scope_id = ${scopeId} AND day = ${day}
  `) as any[];
  return Number(rows[0]?.tokens ?? 0);
}

// --- Security: throttling, revocation, recovery --------------------------------

/** Records a failed login and returns the resulting lock state. */
export async function dbRecordLoginFailure(
  key: string,
  maxAttempts: number,
  lockoutMs: number
): Promise<{ failures: number; lockedUntil: number }> {
  if (!sql) return { failures: 0, lockedUntil: 0 };
  const rows = (await sql`
    INSERT INTO login_attempts (key, failures, locked_until, updated_at)
    VALUES (${key}, 1, NULL, now())
    ON CONFLICT (key) DO UPDATE
      SET failures = CASE
            WHEN login_attempts.failures + 1 >= ${maxAttempts} THEN 0
            ELSE login_attempts.failures + 1
          END,
          locked_until = CASE
            WHEN login_attempts.failures + 1 >= ${maxAttempts}
              THEN now() + (${lockoutMs}::bigint * INTERVAL '1 millisecond')
            ELSE login_attempts.locked_until
          END,
          updated_at = now()
    RETURNING failures, locked_until
  `) as any[];
  const r = rows[0] || {};
  return {
    failures: Number(r.failures ?? 0),
    lockedUntil: r.locked_until ? new Date(r.locked_until).getTime() : 0
  };
}

/** Current lock state for a key, or null when clear. */
export async function dbGetLoginLock(key: string): Promise<{ lockedUntil: number } | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT locked_until FROM login_attempts WHERE key = ${key}
  `) as any[];
  if (rows.length === 0) return null;
  const lockedUntil = rows[0].locked_until ? new Date(rows[0].locked_until).getTime() : 0;
  return lockedUntil > Date.now() ? { lockedUntil } : null;
}

/** Clears failure counters after a successful authentication. */
export async function dbClearLoginFailures(keys: string[]): Promise<void> {
  if (!sql) return;
  for (const key of keys) {
    await sql`DELETE FROM login_attempts WHERE key = ${key}`;
  }
}

/** Revokes a session token id until its natural expiry. */
export async function dbRevokeSession(
  jti: string,
  dentistId: string | null,
  expiresAt: Date,
  reason: string
): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO revoked_sessions (jti, dentist_id, reason, expires_at)
    VALUES (${jti}, ${dentistId}, ${reason}, ${expiresAt.toISOString()}::timestamptz)
    ON CONFLICT (jti) DO NOTHING
  `;
}

/** True when the session id has been revoked and has not yet expired. */
export async function dbIsSessionRevoked(jti: string): Promise<boolean> {
  if (!sql) return false;
  const rows = (await sql`
    SELECT 1 FROM revoked_sessions WHERE jti = ${jti} AND expires_at > now() LIMIT 1
  `) as any[];
  return rows.length > 0;
}

/** Removes revocation rows that have aged past their own expiry. */
export async function dbPruneRevokedSessions(): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    DELETE FROM revoked_sessions WHERE expires_at <= now() RETURNING jti
  `) as any[];
  return rows.length;
}

/** Stores an operator-issued recovery token (hash only — never the raw token). */
export async function dbInsertRecoveryToken(token: {
  tokenHash: string;
  dentistId: string;
  issuedBy: string;
  expiresAt: Date;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO recovery_tokens (token_hash, dentist_id, issued_by, expires_at)
    VALUES (${token.tokenHash}, ${token.dentistId}, ${token.issuedBy}, ${token.expiresAt.toISOString()}::timestamptz)
    ON CONFLICT (token_hash) DO NOTHING
  `;
}

/**
 * Atomically consumes a recovery token: marks it used and returns the dentist
 * it belongs to, or null when the token is unknown, expired or already used.
 * Single-use is enforced in the UPDATE predicate, so two concurrent redemptions
 * can never both succeed.
 */
export async function dbConsumeRecoveryToken(tokenHash: string): Promise<string | null> {
  if (!sql) return null;
  const rows = (await sql`
    UPDATE recovery_tokens
    SET used_at = now()
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING dentist_id
  `) as any[];
  return rows.length > 0 ? rows[0].dentist_id : null;
}

/** Reports which migrations this database has recorded, for /api/health. */
export async function dbMigrationRows(): Promise<any[]> {
  if (!sql) return [];
  try {
    return await listAppliedMigrations(sql);
  } catch (err: any) {
    logger.warn('[Migrations] Could not read schema_migrations:', err?.message || err);
    return [];
  }
}

/** Connectivity probe for the health endpoint. */
export async function dbPing(): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Age of the oldest open job, in milliseconds. Drives the "queue stalled"
 * alert: a deep queue is a busy morning, but a *stale* queue is a broken worker.
 */
export async function dbOldestOpenJobAgeMs(): Promise<number | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT MIN(created_at) AS oldest FROM note_jobs WHERE status IN ('queued', 'processing')
  `) as any[];
  const oldest = rows[0]?.oldest;
  if (!oldest) return null;
  return Math.max(0, Date.now() - new Date(oldest).getTime());
}

/** Queued + processing note jobs — the queue-depth signal on /api/health. */
export async function dbCountOpenNoteJobs(): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    SELECT COUNT(*)::int AS count FROM note_jobs WHERE status IN ('queued', 'processing')
  `) as any[];
  return rows[0]?.count ?? 0;
}

// --- Audit ----------------------------------------------------------------------

/**
 * Appends an audit entry, chained to its predecessor.
 *
 * The two statements below are not wrapped in a transaction (the Neon HTTP
 * driver makes multi-statement transactions awkward, and this runs on every
 * user action), so two simultaneous appends can share a predecessor. That shows
 * up as a *branch* in `verifyAuditChain`, which is reported separately from
 * tampering — see src/lib/auditChain.ts. Content edits and deletions are still
 * detected.
 */
export async function dbAppendAudit(
  event: string,
  dentistId: string | null,
  detail: Record<string, any>
): Promise<void> {
  if (!sql) return;
  const createdAt = new Date().toISOString();
  const previous = (await sql`
    SELECT hash FROM audit_logs WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1
  `) as any[];
  const prevHash = previous.length > 0 && previous[0].hash ? String(previous[0].hash) : GENESIS_HASH;
  const hash = auditEntryHash(prevHash, { event, dentistId, detail, createdAt });
  await sql`
    INSERT INTO audit_logs (event, dentist_id, detail, created_at, prev_hash, hash)
    VALUES (${event}, ${dentistId}, ${JSON.stringify(detail)}::jsonb,
            ${createdAt}::timestamptz, ${prevHash}, ${hash})
  `;
}

/**
 * Sets (or clears) the durable login lock for a key. Used by operator actions,
 * which lock for hours rather than the 15 minutes a failed PIN earns.
 */
export async function dbSetLoginLock(key: string, lockedUntil: Date | null): Promise<void> {
  if (!sql) return;
  if (!lockedUntil) {
    await sql`DELETE FROM login_attempts WHERE key = ${key}`;
    return;
  }
  await sql`
    INSERT INTO login_attempts (key, failures, locked_until, updated_at)
    VALUES (${key}, 0, ${lockedUntil.toISOString()}::timestamptz, now())
    ON CONFLICT (key) DO UPDATE
      SET failures = 0, locked_until = EXCLUDED.locked_until, updated_at = now()
  `;
}

/** Every clinic, oldest first — the operator console's overview. */
export async function dbListClinics(limit = 500): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT id, name, invite_code, owner_dentist_id, created_at
    FROM clinics
    ORDER BY created_at ASC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    inviteCode: r.invite_code,
    ownerDentistId: r.owner_dentist_id,
    createdAt: new Date(r.created_at).toISOString()
  }));
}

/** Active member counts per clinic, for the overview (one query, not N). */
export async function dbClinicMemberCounts(): Promise<Array<{ clinicId: string; active: number }>> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT clinic_id, COUNT(*) FILTER (WHERE status = 'active')::int AS active
    FROM clinic_members
    GROUP BY clinic_id
  `) as any[];
  return rows.map((r: any) => ({ clinicId: r.clinic_id, active: Number(r.active ?? 0) }));
}

/** Latest subscription row per clinic, for the overview. */
export async function dbListSubscriptions(limit = 500): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT DISTINCT ON (clinic_id) clinic_id, plan, status, current_period_end, updated_at
    FROM subscriptions
    ORDER BY clinic_id, updated_at DESC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r: any) => ({
    clinicId: r.clinic_id,
    plan: r.plan,
    status: r.status,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end).toISOString() : null
  }));
}

/** Recent audit entries, newest first — powers the operator console. */
export async function dbListRecentAudit(limit = 100): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT id, event, dentist_id, detail, created_at, prev_hash, hash
    FROM audit_logs
    ORDER BY id DESC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r: any) => ({
    id: Number(r.id),
    event: r.event,
    dentistId: r.dentist_id,
    detail: r.detail,
    createdAt: new Date(r.created_at).toISOString(),
    prevHash: r.prev_hash,
    hash: r.hash
  }));
}

/**
 * The whole chain, oldest first, for verification. Bounded on purpose: the
 * verifier is a scheduled/operator action, not a hot path.
 */
export async function dbListAuditChain(limit = 20000): Promise<any[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT id, event, dentist_id, detail, created_at, prev_hash, hash
    FROM audit_logs
    ORDER BY id ASC
    LIMIT ${limit}
  `) as any[];
  return rows.map((r: any) => ({
    id: Number(r.id),
    event: r.event,
    dentistId: r.dentist_id,
    detail: r.detail,
    createdAt: new Date(r.created_at).toISOString(),
    prevHash: r.prev_hash,
    hash: r.hash
  }));
}
