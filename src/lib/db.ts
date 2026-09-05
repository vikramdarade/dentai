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

type Sql = ReturnType<typeof neon>;

const connectionString = process.env.DATABASE_URL || '';
export const dbEnabled = !!connectionString;

export let sql: Sql | null = null;
if (dbEnabled) {
  sql = neon(connectionString);
}

/** Creates the schema if it does not yet exist. Safe to run on every cold start. */
export async function initDbSchema(): Promise<void> {
  if (!sql) return;
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
  // Clinic-scoped listing used to filter on the JSONB document
  // (data->>'clinicId'); a dedicated column + index keeps that O(log n) as the
  // platform grows past thousands of records per clinic.
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
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      invite_code     TEXT NOT NULL UNIQUE,
      owner_dentist_id TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
      id             TEXT PRIMARY KEY,
      dentist_id     TEXT NOT NULL,
      clinic_id      TEXT,
      priority       TEXT NOT NULL CHECK (priority IN ('emergency', 'urgent', 'routine')),
      status         TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed', 'metered')),
      attempts       INTEGER NOT NULL DEFAULT 0,
      payload        JSONB NOT NULL,
      result         JSONB,
      error          TEXT,
      next_attempt_at TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
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
  const dataDir = path.resolve(__dirname, '../../data');

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
    SELECT id, name, specialty, pin_hash, salt
    FROM dentists
    ORDER BY created_at ASC
  `) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    pinHash: r.pin_hash,
    salt: r.salt
  }));
}

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
    ON CONFLICT (id) DO NOTHING
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
    SELECT id, name, specialty, pin_hash, salt
    FROM dentists WHERE id = ${id}
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, specialty: r.specialty, pinHash: r.pin_hash, salt: r.salt };
}

/** Case-insensitive name lookup for the registration uniqueness check. */
export async function dbGetDentistByName(name: string): Promise<any | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, name, specialty, pin_hash, salt
    FROM dentists WHERE lower(name) = lower(${name})
    LIMIT 1
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, specialty: r.specialty, pinHash: r.pin_hash, salt: r.salt };
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
    INSERT INTO consultations (id, dentist_id, consultation_clinic_id, data)
    VALUES (${consultation.id}, ${consultation.dentistId}, ${consultation.clinicId ?? null}, ${JSON.stringify(consultation)}::jsonb)
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
        updated_at = now()
    WHERE id = ${id} AND dentist_id = ${dentistId}
    RETURNING id
  `) as any[];
  return rows.length > 0;
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

// --- Audit ----------------------------------------------------------------------

export async function dbAppendAudit(
  event: string,
  dentistId: string | null,
  detail: Record<string, any>
): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO audit_logs (event, dentist_id, detail)
    VALUES (${event}, ${dentistId}, ${JSON.stringify(detail)}::jsonb)
  `;
}
