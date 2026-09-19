import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  decidePatientResolution,
  duplicateNameGroups,
  hasSecondDetail,
  normalizePhone,
  patientDisplayName,
  patientNameKey,
  type PatientRecord
} from '../src/lib/patients';
import { createPatientStore } from '../src/server/patientStore';

/**
 * Patient identity.
 *
 * The failure this guards against is clinical, not administrative: two patients
 * called John Smith sharing one chart means the second patient's mouth is treated
 * using the first patient's history. So the tests below are mostly about what the
 * system *refuses* to decide.
 */

function patient(overrides: Partial<PatientRecord> = {}): PatientRecord {
  return {
    id: overrides.id ?? 'p1',
    clinicId: overrides.clinicId ?? 'clinic-1',
    firstName: overrides.firstName ?? 'John',
    lastName: overrides.lastName ?? 'Smith',
    dob: overrides.dob ?? '1980-05-04',
    phone: overrides.phone,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z'
  };
}

describe('name normalisation decides nothing on its own', () => {
  it('treats punctuation, spacing and case as the same name for *candidate* lookup', () => {
    expect(patientNameKey('  John ', "O'Brien-Smith")).toBe(patientNameKey('john', 'obriensmith'));
  });

  it('compares phone numbers by their digits, not their formatting', () => {
    expect(normalizePhone('(04) 1234-5678')).toBe('0412345678');
    expect(normalizePhone('+61 412 345 678')).toBe('61412345678');
    expect(normalizePhone(undefined)).toBe('');
  });

  it('knows when it has nothing but a name to go on', () => {
    expect(hasSecondDetail({})).toBe(false);
    expect(hasSecondDetail({ dob: '  ' })).toBe(false);
    expect(hasSecondDetail({ phone: '0400' })).toBe(false);
    expect(hasSecondDetail({ dob: '1980-05-04' })).toBe(true);
    expect(hasSecondDetail({ phone: '0412345678' })).toBe(true);
  });

  it('never presents a blank name as a patient', () => {
    expect(patientDisplayName({ firstName: '', lastName: '' })).toBe('Patient');
    expect(patientDisplayName(null)).toBe('Patient');
    expect(patientDisplayName({ firstName: 'Sarah', lastName: 'Nguyen' })).toBe('Sarah Nguyen');
  });
});

describe('resolving an intake against the registry', () => {
  const input = { firstName: 'John', lastName: 'Smith', dob: '1980-05-04', clinicId: 'clinic-1' };

  it('registers a new patient when nothing shares the name', () => {
    const decision = decidePatientResolution([], input);
    expect(decision.decision).toBe('create');
    if (decision.decision === 'create') expect(decision.identityConfidence).toBe('confirmed');
  });

  it('marks a registration without a second detail as weak, not as identified', () => {
    const decision = decidePatientResolution([], { firstName: 'John', lastName: 'Smith', clinicId: 'clinic-1' });
    expect(decision.decision).toBe('create');
    if (decision.decision === 'create') expect(decision.identityConfidence).toBe('weak');
  });

  it('matches automatically only when the name AND the date of birth agree', () => {
    const decision = decidePatientResolution([patient()], input);
    expect(decision.decision).toBe('matched');
    if (decision.decision === 'matched') expect(decision.patient.id).toBe('p1');
  });

  it('matches on a phone number when the date of birth is missing', () => {
    const decision = decidePatientResolution(
      [patient({ dob: '', phone: '0412345678' })],
      { firstName: 'John', lastName: 'Smith', phone: '0412 345 678', clinicId: 'clinic-1' }
    );
    expect(decision.decision).toBe('matched');
  });

  it('refuses to merge same-named patients when no second detail was given', () => {
    // The John Smith case. Both records exist; the intake says nothing else.
    const decision = decidePatientResolution(
      [patient({ id: 'p1' }), patient({ id: 'p2', dob: '1975-02-02' })],
      { firstName: 'John', lastName: 'Smith', clinicId: 'clinic-1' }
    );
    expect(decision.decision).toBe('ambiguous');
    if (decision.decision === 'ambiguous') {
      expect(decision.candidates.map((c) => c.id)).toEqual(['p1', 'p2']);
    }
  });

  it('treats a conflicting date of birth as decisive, even when the phone matches', () => {
    // Shared family phone numbers are normal; a different DOB is not.
    const decision = decidePatientResolution(
      [patient({ id: 'p1', dob: '1980-05-04', phone: '0412345678' })],
      { firstName: 'John', lastName: 'Smith', dob: '1981-01-01', phone: '0412345678', clinicId: 'clinic-1' }
    );
    expect(decision.decision).toBe('ambiguous');
    if (decision.decision === 'ambiguous') expect(decision.candidates[0].id).toBe('p1');
  });

  it('flags two records that agree on name and DOB rather than picking one', () => {
    const decision = decidePatientResolution(
      [patient({ id: 'p1' }), patient({ id: 'p2' })],
      input
    );
    expect(decision.decision).toBe('ambiguous');
    if (decision.decision === 'ambiguous') {
      expect(decision.reason).toMatch(/more than one patient record/i);
    }
  });

  it('ignores records for a different name', () => {
    const decision = decidePatientResolution(
      [patient({ id: 'p9', firstName: 'Jane', lastName: 'Smith' })],
      input
    );
    expect(decision.decision).toBe('create');
  });

  it('reports duplicate name groups for the operator, instead of hiding them', () => {
    const groups = duplicateNameGroups([
      patient({ id: 'p1' }),
      patient({ id: 'p2', dob: '1975-02-02' }),
      patient({ id: 'p3', firstName: 'Sarah', lastName: 'Nguyen' })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].patients.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('the durable patient registry', () => {
  let dir: string;
  let store: ReturnType<typeof createPatientStore>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-patients-'));
    const kv = {
      read: async (_key: string, file: string, fallback: any) => {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
          return fallback;
        }
      },
      write: async (_key: string, file: string, value: any) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value));
      },
      dir
    };
    store = createPatientStore({
      kv: kv as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as any
    });
  });

  it('stores and retrieves a patient, scoped to the clinic', async () => {
    const created = await store.create({
      clinicId: 'clinic-1',
      firstName: 'Sarah',
      lastName: 'Nguyen',
      dob: '1990-03-03',
      createdBy: 'dentist-1'
    });

    expect(created.id).toBeTruthy();
    const found = await store.getById('clinic-1', created.id);
    expect(found?.firstName).toBe('Sarah');
    // Clinic scoping is what stops one practice reading another's registry — and
    // an id is not a capability: the same id in the wrong clinic returns nothing.
    expect(await store.getById('clinic-2', created.id)).toBeNull();
    expect(await store.listForClinic('clinic-2')).toHaveLength(0);
    expect(await store.listForClinic('clinic-1')).toHaveLength(1);
  });

  it('returns name candidates without claiming they are the same person', async () => {
    await store.create({ clinicId: 'clinic-1', firstName: 'John', lastName: 'Smith', dob: '1980-05-04' });
    await store.create({ clinicId: 'clinic-1', firstName: 'John', lastName: 'Smith', dob: '1975-02-02' });

    const candidates = await store.searchByName('clinic-1', 'John');
    expect(candidates).toHaveLength(2);
    // Deliberately not a single "the patient" answer: deciding is the caller's job.
    expect(await store.searchByName('clinic-1', 'Nobody')).toHaveLength(0);
  });

  it('resolves an intake through the identity policy and says which way it went', async () => {
    const created = await store.create({
      clinicId: 'clinic-1',
      firstName: 'John',
      lastName: 'Smith',
      dob: '1980-05-04'
    });

    const matched = await store.resolve({
      clinicId: 'clinic-1',
      firstName: 'John',
      lastName: 'Smith',
      dob: '1980-05-04'
    });
    expect(matched.decision.decision).toBe('matched');
    expect(matched.patient?.id).toBe(created.id);

    // A second John Smith with a different DOB must not be handed the first
    // patient's chart.
    const second = await store.resolve({
      clinicId: 'clinic-1',
      firstName: 'John',
      lastName: 'Smith',
      dob: '1975-02-02'
    });
    expect(second.decision.decision).toBe('ambiguous');
    expect(second.patient).toBeNull();

    const fresh = await store.resolve({
      clinicId: 'clinic-1',
      firstName: 'Sarah',
      lastName: 'Nguyen',
      dob: '1990-03-03'
    });
    expect(fresh.decision.decision).toBe('create');
  });
});
