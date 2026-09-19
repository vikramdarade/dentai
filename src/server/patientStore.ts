/**
 * Patient registry store.
 *
 * Two implementations, as with every store in this codebase: Postgres for
 * production, and a JSON/KV fallback so the feature is covered by the unit suite
 * (which runs with `DATABASE_URL=''`). A clinical feature implemented only
 * against Postgres is a feature with no tests.
 *
 * The registry exists so that a patient's *name* stops being used as their
 * identity — see `src/lib/patients.ts` for the matching policy and why it is
 * deliberately pessimistic. This file is only persistence plus the one call that
 * applies that policy.
 */

import crypto from 'crypto';
import { dbEnabled, sql } from '../lib/db';
import type { JsonKv } from './stores';
import {
  decidePatientResolution,
  patientNameKey,
  normalizeNamePart,
  normalizePhone,
  type PatientRecord,
  type ResolveDecision,
  type ResolveInput
} from '../lib/patients';

export interface PatientStoreDeps {
  kv: JsonKv;
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
}

export interface CreatePatientInput {
  clinicId: string;
  firstName: string;
  lastName: string;
  dob?: string;
  phone?: string;
  createdBy?: string;
  /** Optional well-known id (used by tests and by record back-fill). */
  id?: string;
}

export interface PatientStore {
  create(input: CreatePatientInput): Promise<PatientRecord>;
  getById(clinicId: string, id: string): Promise<PatientRecord | null>;
  listForClinic(clinicId: string, limit?: number): Promise<PatientRecord[]>;
  /**
   * Name search for the chairside UI. Returns candidates only — callers must
   * never treat a search hit as a confirmed identity.
   */
  searchByName(clinicId: string, query: string, limit?: number): Promise<PatientRecord[]>;
  /** Applies the identity policy: match, ambiguity, or create. */
  resolve(
    input: ResolveInput
  ): Promise<{ decision: ResolveDecision; patient: PatientRecord | null }>;
}

const FILE = 'patients.json';
const KEY = 'dentai:patients';

function rowToPatient(r: any): PatientRecord {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    firstName: r.first_name,
    lastName: r.last_name,
    dob: r.dob ?? '',
    phone: r.phone ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by ?? undefined,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined
  };
}

/** Postgres driver is typed as possibly-null; never dereference it blind. */
function db() {
  if (!sql) throw new Error('Postgres driver is not configured.');
  return sql;
}

export function createPatientStore(deps: PatientStoreDeps): PatientStore {
  const path = `${deps.kv.dir}/${FILE}`;

  async function readJson(): Promise<PatientRecord[]> {
    const data = await deps.kv.read(KEY, path, { patients: [] });
    return Array.isArray(data.patients) ? (data.patients as PatientRecord[]) : [];
  }

  async function writeJson(patients: PatientRecord[]): Promise<void> {
    await deps.kv.write(KEY, path, { patients });
  }

  async function findByExactName(
    clinicId: string,
    firstName: string,
    lastName: string
  ): Promise<PatientRecord[]> {
    const key = patientNameKey(firstName, lastName);
    if (dbEnabled) {
      const rows = (await db()`
        SELECT * FROM patients
        WHERE clinic_id = ${clinicId}
          AND name_key = ${key}
          AND archived_at IS NULL
        ORDER BY created_at ASC
      `) as any[];
      return rows.map(rowToPatient);
    }
    const all = await readJson();
    return all
      .filter((p) => p.clinicId === clinicId && patientNameKey(p.firstName, p.lastName) === key)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  const store: PatientStore = {
    async create(input) {
      const record: PatientRecord = {
        id: input.id || crypto.randomUUID(),
        clinicId: input.clinicId,
        firstName: String(input.firstName || '').trim(),
        lastName: String(input.lastName || '').trim(),
        dob: String(input.dob || '').trim(),
        phone: normalizePhone(input.phone) || undefined,
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy,
        updatedAt: new Date().toISOString()
      };

      if (dbEnabled) {
        // The partial unique index on (clinic_id, name_key, dob) makes this
        // idempotent for a patient who genuinely has a recorded date of birth:
        // a concurrent double-registration collides instead of creating two
        // charts. Patients with no DOB are allowed to duplicate, because we
        // cannot tell them apart and a duplicate is the safe failure.
        const inserted = (await db()`
          INSERT INTO patients (id, clinic_id, first_name, last_name, dob, phone, name_key, created_by, created_at, updated_at)
          VALUES (
            ${record.id}, ${record.clinicId}, ${record.firstName}, ${record.lastName},
            ${record.dob}, ${record.phone ?? null},
            ${patientNameKey(record.firstName, record.lastName)},
            ${record.createdBy ?? null}, ${record.createdAt}::timestamptz, ${record.updatedAt}::timestamptz
          )
          ON CONFLICT DO NOTHING
          RETURNING *
        `) as any[];

        if (inserted.length > 0) return rowToPatient(inserted[0]);

        // Lost a race: return the record that won instead of a phantom.
        const existing = await findByExactName(record.clinicId, record.firstName, record.lastName);
        const winner = existing.find((p) => p.dob === record.dob) ?? existing[0];
        if (winner) return winner;
        throw new Error('Patient insert conflicted but no existing record could be found.');
      }

      const all = await readJson();
      all.push(record);
      await writeJson(all);
      return record;
    },

    async getById(clinicId, id) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM patients
          WHERE id = ${id} AND clinic_id = ${clinicId} AND archived_at IS NULL
          LIMIT 1
        `) as any[];
        return rows.length ? rowToPatient(rows[0]) : null;
      }
      const all = await readJson();
      return all.find((p) => p.id === id && p.clinicId === clinicId) ?? null;
    },

    async listForClinic(clinicId, limit = 200) {
      if (dbEnabled) {
        const rows = (await db()`
          SELECT * FROM patients
          WHERE clinic_id = ${clinicId} AND archived_at IS NULL
          ORDER BY last_name ASC, first_name ASC
          LIMIT ${limit}
        `) as any[];
        return rows.map(rowToPatient);
      }
      const all = await readJson();
      return all
        .filter((p) => p.clinicId === clinicId)
        .sort((a, b) =>
          `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
        )
        .slice(0, limit);
    },

    async searchByName(clinicId, query, limit = 20) {
      const needle = normalizeNamePart(query);
      if (!needle) return [];
      const pool = dbEnabled ? await store.listForClinic(clinicId, 1000) : await readJson();
      return pool
        .filter((p) => p.clinicId === clinicId)
        .filter((p) => {
          const haystack = normalizeNamePart(`${p.firstName}${p.lastName}`);
          return haystack.includes(needle);
        })
        .slice(0, limit);
    },

    async resolve(input) {
      const candidates = await findByExactName(input.clinicId, input.firstName, input.lastName);
      const decision = decidePatientResolution(candidates, input);

      if (decision.decision === 'matched') {
        return { decision, patient: decision.patient };
      }

      if (decision.decision === 'ambiguous') {
        // Deliberately does NOT create or pick anything. The caller must ask a
        // human, or create a new record explicitly.
        deps.logger.info('Patient identity needs confirmation at intake', {
          clinicId: input.clinicId,
          candidates: decision.candidates.length
        });
        return { decision, patient: null };
      }

      const patient = await store.create({
        clinicId: input.clinicId,
        firstName: input.firstName,
        lastName: input.lastName,
        dob: input.dob,
        phone: input.phone
      });
      return { decision, patient };
    }
  };

  return store;
}
