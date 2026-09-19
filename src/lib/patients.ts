/**
 * Patient identity.
 *
 * Why this module exists: a clinical record has to answer "is this the same
 * person as last time?" with evidence, and the product previously answered it
 * from the name. First name + last name is not an identity. Two patients called
 * John Smith in one practice shared a chart, and the chairside view would show
 * one patient's previous treatment as the other's prior history — which is a
 * clinical safety problem, not a data-quality nit, because that history informs
 * what the clinician does next.
 *
 * The rules encoded here are deliberately pessimistic:
 *
 *  - A name match alone is NEVER treated as the same patient. It produces
 *    *candidates* that a human must confirm.
 *  - An automatic match requires the name plus a second identifying detail that
 *    actually agrees — date of birth or phone number.
 *  - A missing second detail produces a new record rather than a merge. A
 *    duplicate record is an annoyance that can be reconciled later; a wrong
 *    chart is not.
 *
 * Everything here is pure so the policy is unit-testable without a server.
 */

/** A patient as stored. `dob` is YYYY-MM-DD, or '' when genuinely unknown. */
export interface PatientRecord {
  id: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD, or '' when unknown. Never invented. */
  dob: string;
  /** Digits only, or ''/undefined. A second identifying detail for matching. */
  phone?: string;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
}

/** Normalises one name part: lower case, letters and digits only. */
export function normalizeNamePart(value: string | undefined | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** Digits only, so "(04) 1234-5678" and "0412345678" are the same detail. */
export function normalizePhone(value: string | undefined | null): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** "Sarah Nguyen" — the only thing ever shown as a patient's identity in UI. */
export function patientDisplayName(p: { firstName?: string; lastName?: string } | null | undefined): string {
  if (!p) return 'Patient';
  const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
  return name || 'Patient';
}

/**
 * Name-only key. Used to *find candidates*, never to decide identity — that is
 * the whole point of the rules below.
 */
export function patientNameKey(firstName: string, lastName: string): string {
  return `${normalizeNamePart(firstName)}|${normalizeNamePart(lastName)}`;
}

export interface ResolveInput {
  firstName: string;
  lastName: string;
  dob?: string;
  phone?: string;
  clinicId: string;
}

/**
 * The outcome of resolving an intake against the patient registry.
 *
 *  - `matched`   — exactly one record agrees on name *and* a second detail. Safe
 *                  to reuse without asking.
 *  - `ambiguous` — records share the name but identity cannot be settled
 *                  automatically. A human must confirm which one (or that this
 *                  is a new patient). Never auto-merged.
 *  - `create`    — no record agrees. A new patient is registered instead.
 */
export type ResolveDecision =
  | { decision: 'matched'; patient: PatientRecord }
  | { decision: 'ambiguous'; candidates: PatientRecord[]; reason: string }
  | { decision: 'create'; identityConfidence: 'confirmed' | 'weak'; reason: string };

/** True when the record carries a second identifying detail we can compare. */
function agreeingDetail(patient: PatientRecord, input: ResolveInput): boolean {
  const inputDob = (input.dob ?? '').trim();
  const inputPhone = normalizePhone(input.phone);
  const patientPhone = normalizePhone(patient.phone);

  // A non-empty DOB that matches is the strongest signal available.
  if (inputDob && patient.dob && inputDob === patient.dob.trim()) return true;
  // A conflicting DOB is a decisive "not the same person", even if the phone
  // happens to match (shared family phone numbers are normal).
  if (inputDob && patient.dob && inputDob !== patient.dob.trim()) return false;
  if (inputPhone && patientPhone && inputPhone === patientPhone) return true;
  return false;
}

/**
 * Decides what to do with an intake, given the registry's candidates.
 *
 * Pass every record in the clinic whose name key matches; the second identifying
 * detail is compared here.
 */
export function decidePatientResolution(
  sameNameCandidates: PatientRecord[],
  input: ResolveInput
): ResolveDecision {
  const candidates = sameNameCandidates.filter(
    (p) => patientNameKey(p.firstName, p.lastName) === patientNameKey(input.firstName, input.lastName)
  );

  if (candidates.length === 0) {
    return {
      decision: 'create',
      identityConfidence: hasSecondDetail(input) ? 'confirmed' : 'weak',
      reason: 'No existing patient at this clinic has that name.',
    };
  }

  const agreeing = candidates.filter((p) => agreeingDetail(p, input));

  if (agreeing.length === 1) {
    return { decision: 'matched', patient: agreeing[0] };
  }

  if (agreeing.length > 1) {
    // Two records agree on name and a second detail: the registry itself needs
    // reconciling before either can be trusted. Never pick one silently.
    return {
      decision: 'ambiguous',
      candidates: agreeing,
      reason: 'More than one patient record matches that name and date of birth.',
    };
  }

  // A name match with no agreeing second detail. This is the John Smith case:
  // returning these as candidates forces a human decision instead of quietly
  // showing one patient's history on another patient's chart.
  return {
    decision: 'ambiguous',
    candidates,
    reason: hasSecondDetail(input)
      ? 'Records share that name but none matches the date of birth or phone number given.'
      : 'Records share that name and no date of birth or phone number was given to tell them apart.',
  };
}

/** True when the intake carries something beyond the name to compare against. */
export function hasSecondDetail(input: { dob?: string; phone?: string }): boolean {
  return Boolean((input.dob ?? '').trim()) || normalizePhone(input.phone).length >= 6;
}

/**
 * Records that must never be silently merged, for the operator-facing check.
 * A practice with duplicates needs to be told, not have them hidden.
 */
export function duplicateNameGroups(patients: PatientRecord[]): Array<{ nameKey: string; patients: PatientRecord[] }> {
  const byKey = new Map<string, PatientRecord[]>();
  for (const p of patients) {
    const key = patientNameKey(p.firstName, p.lastName);
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  return [...byKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([nameKey, group]) => ({ nameKey, patients: group }));
}
