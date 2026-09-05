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

let sql: Sql | null = null;
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
    INSERT INTO consultations (id, dentist_id, data)
    VALUES (${consultation.id}, ${consultation.dentistId}, ${JSON.stringify(consultation)}::jsonb)
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
    SET data = ${JSON.stringify(consultation)}::jsonb, updated_at = now()
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
  const rows = (await sql`
    SELECT data FROM consultations
    WHERE data->>'clinicId' = ${clinicId}
    ORDER BY created_at DESC
  `) as any[];
  return rows.map((r: any) => r.data);
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
