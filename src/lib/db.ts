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
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      specialty   TEXT NOT NULL,
      pin_hash    TEXT NOT NULL,
      salt        TEXT NOT NULL,
      mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE dentists ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
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

  await sql`ALTER TABLE dentists ADD COLUMN IF NOT EXISTS is_founder BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE dentists ADD COLUMN IF NOT EXISTS founder_access_status TEXT NOT NULL DEFAULT 'none'`;

  // Always guarantee that founder dentists exist in Postgres with PIN 1234
  await sql`
    INSERT INTO dentists (id, name, specialty, pin_hash, salt, is_founder, founder_access_status)
    VALUES
      (
        '5a002da7-d8e6-4d5c-8566-000d534e2a32',
        'Dr. Vikram Darade',
        'General & Implant Dentistry',
        '7a96d4fcd143098082eac02f684418cf33c2d8075fc1062961c9ce774808422aef2b66b52ecae906da54a6da5669292ff602ddf922449ca6ed86f87418e0a338',
        '50d557a766f03038edf170a579e0b30ef0a787649763ee06e7c5d3c29b6f8c69',
        TRUE,
        'approved'
      ),
      (
        'ea8e5a3a-d788-45d9-b44b-63faa8db43b3',
        'Vik',
        'Dentist',
        '7a96d4fcd143098082eac02f684418cf33c2d8075fc1062961c9ce774808422aef2b66b52ecae906da54a6da5669292ff602ddf922449ca6ed86f87418e0a338',
        '50d557a766f03038edf170a579e0b30ef0a787649763ee06e7c5d3c29b6f8c69',
        TRUE,
        'approved'
      )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      specialty = EXCLUDED.specialty,
      pin_hash = EXCLUDED.pin_hash,
      salt = EXCLUDED.salt,
      is_founder = TRUE,
      founder_access_status = 'approved'
  `;

  // Self-heal any existing founder records that may have been created earlier with a different UUID
  await sql`
    UPDATE dentists
    SET
      is_founder = TRUE,
      founder_access_status = 'approved',
      pin_hash = '7a96d4fcd143098082eac02f684418cf33c2d8075fc1062961c9ce774808422aef2b66b52ecae906da54a6da5669292ff602ddf922449ca6ed86f87418e0a338',
      salt = '50d557a766f03038edf170a579e0b30ef0a787649763ee06e7c5d3c29b6f8c69'
    WHERE lower(name) = 'dr. vikram darade'
       OR lower(name) = 'vik'
       OR lower(name) LIKE '%darade%'
       OR lower(name) LIKE '%vikram%'
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id               TEXT PRIMARY KEY,
      clinic_id        TEXT,
      dentist_id       TEXT,
      dentist_name     TEXT,
      category         TEXT NOT NULL,
      title            TEXT NOT NULL,
      description      TEXT NOT NULL,
      diagnostics      JSONB,
      status           TEXT NOT NULL DEFAULT 'open',
      priority         TEXT NOT NULL DEFAULT 'P2',
      resolution_notes TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status)`;

  await sql`
    CREATE TABLE IF NOT EXISTS clinic_feedback (
      id           TEXT PRIMARY KEY,
      clinic_id    TEXT,
      dentist_id   TEXT,
      dentist_name TEXT,
      rating       INTEGER,
      category     TEXT NOT NULL,
      pms_type     TEXT,
      comments     TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS company_briefings (
      id                      TEXT PRIMARY KEY,
      date                    TEXT NOT NULL UNIQUE,
      summary                 TEXT,
      department_deliverables JSONB NOT NULL,
      metrics                 JSONB,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_company_briefings_date ON company_briefings (date)`;

  await sql`
    CREATE TABLE IF NOT EXISTS founder_access_requests (
      id           TEXT PRIMARY KEY,
      dentist_id   TEXT NOT NULL,
      dentist_name TEXT NOT NULL,
      reason       TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at  TIMESTAMPTZ
    )
  `;
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
    let dentistsList: any[] = [];
    if (fs.existsSync(usersPath)) {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
      dentistsList = users.dentists || [];
    }
    if (dentistsList.length === 0) {
      dentistsList = [
        {
          id: '5a002da7-d8e6-4d5c-8566-000d534e2a32',
          name: 'Dr. Vikram Darade',
          specialty: 'General & Implant Dentistry',
          pinHash: '7a96d4fcd143098082eac02f684418cf33c2d8075fc1062961c9ce774808422aef2b66b52ecae906da54a6da5669292ff602ddf922449ca6ed86f87418e0a338',
          salt: '50d557a766f03038edf170a579e0b30ef0a787649763ee06e7c5d3c29b6f8c69',
          isFounder: true,
          founderAccessStatus: 'approved'
        },
        {
          id: 'ea8e5a3a-d788-45d9-b44b-63faa8db43b3',
          name: 'Vik',
          specialty: 'Dentist',
          pinHash: '7a96d4fcd143098082eac02f684418cf33c2d8075fc1062961c9ce774808422aef2b66b52ecae906da54a6da5669292ff602ddf922449ca6ed86f87418e0a338',
          salt: '50d557a766f03038edf170a579e0b30ef0a787649763ee06e7c5d3c29b6f8c69',
          isFounder: true,
          founderAccessStatus: 'approved'
        }
      ];
    }
    for (const d of dentistsList) {
      await sql`
        INSERT INTO dentists (id, name, specialty, pin_hash, salt, is_founder, founder_access_status)
        VALUES (${d.id}, ${d.name}, ${d.specialty}, ${d.pinHash}, ${d.salt}, ${d.isFounder ?? false}, ${d.founderAccessStatus ?? 'none'})
        ON CONFLICT (id) DO NOTHING
      `;
      seededDentists++;
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
    SELECT id, name, specialty, pin_hash, salt, is_founder, founder_access_status
    FROM dentists
    ORDER BY created_at ASC
  `) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    pinHash: r.pin_hash,
    salt: r.salt,
    isFounder: !!r.is_founder,
    founderAccessStatus: r.founder_access_status || 'none'
  }));
}

export async function dbInsertDentist(d: {
  id: string;
  name: string;
  specialty: string;
  pinHash: string;
  salt: string;
  mfaEnabled?: boolean;
  isFounder?: boolean;
  founderAccessStatus?: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO dentists (id, name, specialty, pin_hash, salt, mfa_enabled, is_founder, founder_access_status)
    VALUES (${d.id}, ${d.name}, ${d.specialty}, ${d.pinHash}, ${d.salt}, ${d.mfaEnabled ?? false}, ${d.isFounder ?? false}, ${d.founderAccessStatus ?? 'none'})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      specialty = EXCLUDED.specialty,
      pin_hash = EXCLUDED.pin_hash,
      salt = EXCLUDED.salt,
      mfa_enabled = EXCLUDED.mfa_enabled,
      is_founder = EXCLUDED.is_founder,
      founder_access_status = EXCLUDED.founder_access_status
  `;
}

export async function dbDeleteDentist(id: string): Promise<void> {
  if (!sql) return;
  await sql`DELETE FROM dentists WHERE id = ${id}`;
}

/** O(1) point lookup — the auth middleware runs this on EVERY request. */
export async function dbGetDentistById(id: string): Promise<any | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, name, specialty, pin_hash, salt, mfa_enabled, is_founder, founder_access_status
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
      mfaEnabled: !!r.mfa_enabled,
      isFounder: !!r.is_founder,
      founderAccessStatus: r.founder_access_status || 'none'
    };
  } catch (err: any) {
    logger.warn(`[Postgres] dbGetDentistById initial query fallback: ${err?.message}`);
    try {
      const rows = (await sql`
        SELECT id, name, specialty, pin_hash, salt
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
        mfaEnabled: false,
        isFounder: false,
        founderAccessStatus: 'none'
      };
    } catch {
      return null;
    }
  }
}

/** Case-insensitive and partial name lookup for dentist profile. */
export async function dbGetDentistByName(name: string): Promise<any | null> {
  if (!sql) return null;
  const cleanName = (name || '').replace(/^dr\.?\s*/i, '').trim();
  const searchPattern = `%${cleanName}%`;
  try {
    const rows = (await sql`
      SELECT id, name, specialty, pin_hash, salt, mfa_enabled, is_founder, founder_access_status
      FROM dentists
      WHERE lower(name) = lower(${name})
         OR (length(${cleanName}) >= 3 AND lower(name) LIKE lower(${searchPattern}))
      ORDER BY CASE WHEN lower(name) = lower(${name}) THEN 0 ELSE 1 END
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
      mfaEnabled: !!r.mfa_enabled,
      isFounder: !!r.is_founder,
      founderAccessStatus: r.founder_access_status || 'none'
    };
  } catch (err: any) {
    logger.warn(`[Postgres] dbGetDentistByName initial query fallback: ${err?.message}`);
    try {
      const rows = (await sql`
        SELECT id, name, specialty, pin_hash, salt
        FROM dentists
        WHERE lower(name) = lower(${name})
           OR (length(${cleanName}) >= 3 AND lower(name) LIKE lower(${searchPattern}))
        ORDER BY CASE WHEN lower(name) = lower(${name}) THEN 0 ELSE 1 END
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
        mfaEnabled: false,
        isFounder: false,
        founderAccessStatus: 'none'
      };
    } catch {
      return null;
    }
  }
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

// --- Support Tickets -------------------------------------------------------------

export interface DbSupportTicket {
  id: string;
  clinicId?: string;
  dentistId?: string;
  dentistName?: string;
  category: string;
  title: string;
  description: string;
  diagnostics?: any;
  status: 'open' | 'investigating' | 'resolved';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export async function dbGetSupportTickets(clinicId?: string): Promise<DbSupportTicket[]> {
  if (!sql) return [];
  const rows = clinicId
    ? (await sql`
        SELECT id, clinic_id, dentist_id, dentist_name, category, title, description, diagnostics, status, priority, resolution_notes, created_at, updated_at
        FROM support_tickets
        WHERE clinic_id = ${clinicId}
        ORDER BY created_at DESC
      `) as any[]
    : (await sql`
        SELECT id, clinic_id, dentist_id, dentist_name, category, title, description, diagnostics, status, priority, resolution_notes, created_at, updated_at
        FROM support_tickets
        ORDER BY created_at DESC
      `) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    clinicId: r.clinic_id,
    dentistId: r.dentist_id,
    dentistName: r.dentist_name,
    category: r.category,
    title: r.title,
    description: r.description,
    diagnostics: r.diagnostics,
    status: r.status,
    priority: r.priority,
    resolutionNotes: r.resolution_notes,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString()
  }));
}

export async function dbInsertSupportTicket(ticket: DbSupportTicket): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO support_tickets (
      id, clinic_id, dentist_id, dentist_name, category, title, description, diagnostics, status, priority, resolution_notes, created_at, updated_at
    ) VALUES (
      ${ticket.id},
      ${ticket.clinicId ?? null},
      ${ticket.dentistId ?? null},
      ${ticket.dentistName ?? null},
      ${ticket.category},
      ${ticket.title},
      ${ticket.description},
      ${ticket.diagnostics ? JSON.stringify(ticket.diagnostics) : null}::jsonb,
      ${ticket.status || 'open'},
      ${ticket.priority || 'P2'},
      ${ticket.resolutionNotes ?? null},
      ${ticket.createdAt ? new Date(ticket.createdAt).toISOString() : new Date().toISOString()}::timestamptz,
      ${ticket.updatedAt ? new Date(ticket.updatedAt).toISOString() : new Date().toISOString()}::timestamptz
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      resolution_notes = EXCLUDED.resolution_notes,
      updated_at = now()
  `;
}

export async function dbUpdateSupportTicket(
  id: string,
  patch: { status?: string; resolutionNotes?: string; priority?: string }
): Promise<void> {
  if (!sql) return;
  await sql`
    UPDATE support_tickets
    SET status = COALESCE(${patch.status ?? null}, status),
        resolution_notes = COALESCE(${patch.resolutionNotes ?? null}, resolution_notes),
        priority = COALESCE(${patch.priority ?? null}, priority),
        updated_at = now()
    WHERE id = ${id}
  `;
}

// --- Feedback -------------------------------------------------------------------

export interface DbClinicFeedback {
  id: string;
  clinicId?: string;
  dentistId?: string;
  dentistName?: string;
  rating?: number;
  category: string;
  pmsType?: string;
  comments?: string;
  createdAt: string;
}

export async function dbGetFeedback(clinicId?: string): Promise<DbClinicFeedback[]> {
  if (!sql) return [];
  const rows = clinicId
    ? (await sql`
        SELECT id, clinic_id, dentist_id, dentist_name, rating, category, pms_type, comments, created_at
        FROM clinic_feedback
        WHERE clinic_id = ${clinicId}
        ORDER BY created_at DESC
      `) as any[]
    : (await sql`
        SELECT id, clinic_id, dentist_id, dentist_name, rating, category, pms_type, comments, created_at
        FROM clinic_feedback
        ORDER BY created_at DESC
      `) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    clinicId: r.clinic_id,
    dentistId: r.dentist_id,
    dentistName: r.dentist_name,
    rating: r.rating,
    category: r.category,
    pmsType: r.pms_type,
    comments: r.comments,
    createdAt: new Date(r.created_at).toISOString()
  }));
}

export async function dbInsertFeedback(feedback: DbClinicFeedback): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO clinic_feedback (
      id, clinic_id, dentist_id, dentist_name, rating, category, pms_type, comments, created_at
    ) VALUES (
      ${feedback.id},
      ${feedback.clinicId ?? null},
      ${feedback.dentistId ?? null},
      ${feedback.dentistName ?? null},
      ${feedback.rating ?? null},
      ${feedback.category},
      ${feedback.pmsType ?? null},
      ${feedback.comments ?? null},
      ${feedback.createdAt ? new Date(feedback.createdAt).toISOString() : new Date().toISOString()}::timestamptz
    )
  `;
}

// --- Company Briefings -----------------------------------------------------------

export interface DbCompanyBriefing {
  id: string;
  date: string;
  summary?: string;
  departmentDeliverables: any;
  metrics?: any;
  createdAt: string;
}

export async function dbGetCompanyBriefingByDate(date: string): Promise<DbCompanyBriefing | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, date, summary, department_deliverables, metrics, created_at
    FROM company_briefings
    WHERE date = ${date}
    LIMIT 1
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    date: r.date,
    summary: r.summary,
    departmentDeliverables: r.department_deliverables,
    metrics: r.metrics,
    createdAt: new Date(r.created_at).toISOString()
  };
}

export async function dbGetLatestCompanyBriefing(): Promise<DbCompanyBriefing | null> {
  if (!sql) return null;
  const rows = (await sql`
    SELECT id, date, summary, department_deliverables, metrics, created_at
    FROM company_briefings
    ORDER BY date DESC
    LIMIT 1
  `) as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    date: r.date,
    summary: r.summary,
    departmentDeliverables: r.department_deliverables,
    metrics: r.metrics,
    createdAt: new Date(r.created_at).toISOString()
  };
}

export async function dbSaveCompanyBriefing(briefing: DbCompanyBriefing): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO company_briefings (
      id, date, summary, department_deliverables, metrics, created_at
    ) VALUES (
      ${briefing.id},
      ${briefing.date},
      ${briefing.summary ?? null},
      ${JSON.stringify(briefing.departmentDeliverables)}::jsonb,
      ${briefing.metrics ? JSON.stringify(briefing.metrics) : null}::jsonb,
      ${briefing.createdAt ? new Date(briefing.createdAt).toISOString() : new Date().toISOString()}::timestamptz
    )
    ON CONFLICT (date) DO UPDATE SET
      summary = EXCLUDED.summary,
      department_deliverables = EXCLUDED.department_deliverables,
      metrics = EXCLUDED.metrics,
      created_at = EXCLUDED.created_at
  `;
}

export async function dbListCompanyBriefingDates(): Promise<string[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT date FROM company_briefings ORDER BY date DESC
  `) as any[];
  return rows.map((r: any) => r.date);
}

// --- Founder Access Requests -----------------------------------------------------

export interface DbFounderRequest {
  id: string;
  dentistId: string;
  dentistName: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt?: string;
}

export async function dbRequestFounderAccess(dentistId: string, dentistName: string, reason?: string): Promise<DbFounderRequest> {
  const req: DbFounderRequest = {
    id: crypto.randomUUID(),
    dentistId,
    dentistName,
    reason,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  if (sql) {
    await sql`
      INSERT INTO founder_access_requests (id, dentist_id, dentist_name, reason, status, created_at)
      VALUES (${req.id}, ${req.dentistId}, ${req.dentistName}, ${req.reason ?? null}, ${req.status}, now())
    `;
    await sql`
      UPDATE dentists SET founder_access_status = 'pending' WHERE id = ${dentistId}
    `;
  }
  return req;
}

export async function dbListFounderRequests(): Promise<DbFounderRequest[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT id, dentist_id, dentist_name, reason, status, created_at, reviewed_at
    FROM founder_access_requests
    ORDER BY created_at DESC
  `) as any[];
  return rows.map((r: any) => ({
    id: r.id,
    dentistId: r.dentist_id,
    dentistName: r.dentist_name,
    reason: r.reason,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined
  }));
}

export async function dbApproveFounderRequest(requestId: string, approve: boolean): Promise<void> {
  if (!sql) return;
  const status = approve ? 'approved' : 'rejected';
  const rows = (await sql`
    UPDATE founder_access_requests
    SET status = ${status}, reviewed_at = now()
    WHERE id = ${requestId}
    RETURNING dentist_id
  `) as any[];
  if (rows.length > 0 && approve) {
    const dentistId = rows[0].dentist_id;
    await sql`
      UPDATE dentists
      SET is_founder = TRUE, founder_access_status = 'approved'
      WHERE id = ${dentistId}
    `;
  }
}

