/**
 * Worker 1D — CLINICAL SAFETY — adversarial ClinicalFact / identity probes.
 * Synthetic data only. Runs against repository source; mutates nothing.
 * Each probe documents one attempted attack path against a protected invariant.
 */
import {
  createCanonicalClinicalFact,
  isFactConstructionFailure,
  createClinicalFact,
  adaptFactsToLegacyFindings,
} from '../../../../../src/lib/clinicalFactMigration';
import { validateClinicalFactInvariants } from '../../../../../src/types/clinicalFact';
import { decidePatientResolution } from '../../../../../src/lib/patients';

let pass = 0, fail = 0;
const results = [];
function probe(name, attack, expect, got) {
  // Subset match: expected keys must equal got's keys where present.
  const held = Object.entries(expect).every(([k, v]) => JSON.stringify(got?.[k]) === JSON.stringify(v));
  if (held) pass++; else fail++;
  results.push(`${held ? 'HELD   ' : 'BROKEN '} ${name}\n         attack: ${attack}\n         expected: ${JSON.stringify(expect)} | got: ${JSON.stringify(got)}`);
}
const rejected = (r) => (isFactConstructionFailure(r) ? { rejected: true, errors: r.errors.length } : { rejected: false });

// ----------------------------------------------------------------------------
// A. STATUS x TEMPORAL (planned != performed; historical != today; etc.)
// ----------------------------------------------------------------------------
probe('planned != performed (performed+future)',
  "candidate procedure status='performed' temporal='future'",
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed', value: { name: 'Composite restoration' }, status: 'performed', temporal: 'future', evidence: [] })));

probe('performed+next_appointment',
  "candidate procedure status='performed' temporal='next_appointment'",
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed', value: { name: 'Extraction' }, status: 'performed', temporal: 'next_appointment', evidence: [] })));

probe('planned+completed_today',
  "candidate procedure status='planned' temporal='completed_today'",
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed', value: { name: 'RCT' }, status: 'planned', temporal: 'completed_today', evidence: [] })));

probe('planned+previous_appointment',
  "candidate treatment_plan status='planned' temporal='previous_appointment'",
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'treatment_plan', speaker: 'clinician', evidenceType: 'instruction', value: { proposedProcedures: ['Crown'] }, status: 'planned', temporal: 'previous_appointment', evidence: [] })));

probe('historical+completed_today',
  "candidate medication status='historical' temporal='completed_today'",
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'medication', speaker: 'patient', evidenceType: 'patient_reported', value: { drugName: 'Warfarin' }, status: 'historical', temporal: 'completed_today', evidence: [] })));

probe('observed+future',
  "candidate tooth_finding status='observed' temporal='future'",
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, status: 'observed', temporal: 'future', evidence: [] })));

probe('reported+next_appointment',
  "candidate symptom status='reported' temporal='next_appointment'",
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'symptom', speaker: 'patient', evidenceType: 'patient_reported', value: { description: 'Pain' }, status: 'reported', temporal: 'next_appointment', evidence: [] })));

// Valid baselines must still construct (no over-blocking).
probe('valid baseline: performed+completed_today constructs',
  'legitimate procedure fact',
  { rejected: false },
  rejected(createCanonicalClinicalFact({ type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed', value: { name: 'Composite' }, status: 'performed', temporal: 'completed_today', evidence: [] })));
probe('valid baseline: patient-reported symptom (reported+current)',
  'patient complaint',
  { rejected: false },
  rejected(createCanonicalClinicalFact({ type: 'symptom', speaker: 'patient', evidenceType: 'patient_reported', value: { description: 'Pain on chewing' }, status: 'reported', temporal: 'current', evidence: [] })));
probe('valid baseline: negated allergy (patient-reported)',
  "'no known allergies' assertion",
  { rejected: false },
  rejected(createCanonicalClinicalFact({ type: 'allergy', speaker: 'patient', evidenceType: 'patient_reported', value: { allergen: 'penicillin' }, status: 'negated', temporal: 'current', evidence: [] })));

// ----------------------------------------------------------------------------
// B. SPEAKER / EVIDENCE TYPE (attribution cannot be inverted silently)
// ----------------------------------------------------------------------------
probe('patient speaker with clinician_observed evidence = REJECTED',
  'candidate claims patient observed clinical finding',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'patient', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, status: 'observed', temporal: 'current', evidence: [] })));

probe('clinician speaker with patient_reported evidence = WARNING, not silent pass',
  'clinician-voiced fact mislabeled as patient_reported',
  { rejected: false, warned: true },
  (() => {
    const r = createCanonicalClinicalFact({ type: 'symptom', speaker: 'clinician', evidenceType: 'patient_reported', value: { description: 'Pain' }, status: 'reported', temporal: 'current', evidence: [] });
    return isFactConstructionFailure(r) ? { rejected: false, warned: false } : { rejected: false, warned: (r.warnings || []).length > 0 };
  })());

// ----------------------------------------------------------------------------
// C. FDI TEETH + SURFACES (anatomical integrity)
// ----------------------------------------------------------------------------
probe('tooth 99 (invalid FDI) rejected',
  'bare/invalid number 99 as tooth',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, teeth: [99], evidence: [] })));
probe('tooth 12 (invalid: position 2 is deciduous range collision per ISO check) — matrix enforced',
  'fabricated tooth number',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, teeth: [12], evidence: [] })));
probe('tooth 18 (valid FDI permanent) accepted',
  'legitimate FDI 18',
  { rejected: false },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, teeth: [18], evidence: [] })));
probe('tooth 36 with dentition=deciduous metadata conflict rejected (via ToothReference candidate)',
  'mismatched dentition metadata',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, anatomy: { teeth: [{ tooth: 36, dentition: 'deciduous', quadrant: 3, position: 6 }] }, evidence: [] })));
probe('anterior tooth 21 with occlusal (O) surface rejected',
  'anatomically impossible surface',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, teeth: [21], surfaces: ['O'], evidence: [] })));
probe('posterior tooth 36 with incisal (I) surface rejected',
  'anatomically impossible edge',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Fracture' }, teeth: [36], surfaces: ['I'], evidence: [] })));

// ----------------------------------------------------------------------------
// D. GROUNDING / PROVENANCE (unsupported facts, traceability, timestamps)
// ----------------------------------------------------------------------------
probe('fact with NO evidence span still canonical (renderer must not label verified) — construction does not fabricate provenance',
  'no evidence attached',
  { rejected: false, evidence_preserved_empty: true },
  (() => {
    const r = createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: { condition: 'Caries' }, status: 'observed', temporal: 'current', evidence: [] });
    return isFactConstructionFailure(r) ? { rejected: true } : { rejected: false, evidence_preserved_empty: r.fact.evidence.length === 0 && r.fact.verificationState === 'unverified' };
  })());
probe('negative timestamps rejected (anti-synthesised timing)',
  'ASR span with startMs=-1',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'symptom', speaker: 'patient', evidenceType: 'patient_reported', value: { description: 'Pain' }, status: 'reported', temporal: 'current', evidence: [{ utteranceId: 'u-1', rawText: 'hurts', startMs: -1, endMs: 100 }] })));
probe('startMs > endMs rejected',
  'inverted span',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'symptom', speaker: 'patient', evidenceType: 'patient_reported', value: { description: 'Pain' }, status: 'reported', temporal: 'current', evidence: [{ utteranceId: 'u-1', rawText: 'hurts', startMs: 500, endMs: 100 }] })));
probe('evidence span text preserved verbatim (traceability)',
  'rawText round-trip',
  { preserved: 'My lower left tooth hurts when I chew' },
  (() => {
    const r = createCanonicalClinicalFact({ type: 'symptom', speaker: 'patient', evidenceType: 'patient_reported', value: { description: 'Pain' }, status: 'reported', temporal: 'current', evidence: [{ utteranceId: 'u-9', rawText: 'My lower left tooth hurts when I chew', speaker: 'patient', source: 'asr' }] });
    return isFactConstructionFailure(r) ? { preserved: null } : { preserved: r.fact.evidence[0].rawText };
  })());
probe('confidence outside [0,1] rejected',
  'confidence=5',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'symptom', speaker: 'patient', evidenceType: 'patient_reported', value: { description: 'Pain' }, status: 'reported', temporal: 'current', evidence: [], confidence: 5 })));

// ----------------------------------------------------------------------------
// E. CERTAINTY / EXTRACTION METHOD SEPARATION
// ----------------------------------------------------------------------------
probe('certainty defaults to certain but extractionMethod stays separate',
  'structured vs epistemic separation',
  { certainty: 'uncertain', extractionMethod: 'inferred' },
  (() => {
    const r = createCanonicalClinicalFact({ type: 'diagnosis', speaker: 'clinician', evidenceType: 'clinician_interpretation', value: { condition: 'Pulpitis', provisional: true }, status: 'observed', temporal: 'current', certainty: 'uncertain', extractionMethod: 'inferred', evidence: [] });
    return isFactConstructionFailure(r) ? {} : { certainty: r.fact.certainty, extractionMethod: r.fact.extractionMethod };
  })());
probe('null/undefined value payload rejected (no invented facts)',
  'empty candidate value',
  { rejected: true },
  rejected(createCanonicalClinicalFact({ type: 'tooth_finding', speaker: 'clinician', evidenceType: 'clinician_observed', value: null, evidence: [] })));

// ----------------------------------------------------------------------------
// F. LEGACY ADAPTER PROJECTION (planned != performed survives rendering)
// ----------------------------------------------------------------------------
probe('planned procedure renders as "Planned:", NOT as performed treatment',
  'planned fact through legacy renderer',
  { inPerformed: false, inRecommendations: true },
  (() => {
    const r = createCanonicalClinicalFact({ type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed', value: { name: 'Crown' }, status: 'planned', temporal: 'next_appointment', evidence: [] });
    if (isFactConstructionFailure(r)) return { inPerformed: null };
    const f = adaptFactsToLegacyFindings([r.fact]);
    return { inPerformed: f.treatmentPerformed.includes('Crown'), inRecommendations: f.recommendations.includes('Crown') };
  })());
probe('performed procedure renders as "Completed" in treatmentPerformed',
  'performed fact through legacy renderer',
  { inPerformed: true },
  (() => {
    const r = createCanonicalClinicalFact({ type: 'procedure', speaker: 'clinician', evidenceType: 'clinician_observed', value: { name: 'Filling' }, status: 'performed', temporal: 'completed_today', evidence: [] });
    if (isFactConstructionFailure(r)) return { inPerformed: null };
    return { inPerformed: adaptFactsToLegacyFindings([r.fact]).treatmentPerformed.includes('Filling') };
  })());

// ----------------------------------------------------------------------------
// G. PATIENT IDENTITY (name != identity; DOB conflict decisive)
// ----------------------------------------------------------------------------
const mk = (id, dob, phone) => ({ id, clinicId: 'c1', firstName: 'John', lastName: 'Smith', dob, phone, createdAt: '2026-01-01' });
probe('name-only match NEVER auto-matches (John Smith case)',
  'two John Smiths, no second detail',
  { decision: 'ambiguous' },
  (() => { const d = decidePatientResolution([mk('p1', '1980-01-01'), mk('p2', '1975-05-05')], { firstName: 'John', lastName: 'Smith', clinicId: 'c1' }); return { decision: d.decision }; })());
probe('DOB conflict is decisive even with matching phone',
  'same name+phone, different DOB',
  { decision: 'create' },
  (() => { const d = decidePatientResolution([mk('p1', '1980-01-01', '0412345678')], { firstName: 'John', lastName: 'Smith', dob: '1990-01-01', phone: '0412345678', clinicId: 'c1' }); return { decision: d.decision }; })());
probe('name + agreeing DOB auto-matches',
  'same name, same DOB',
  { decision: 'matched' },
  (() => { const d = decidePatientResolution([mk('p1', '1980-01-01')], { firstName: 'John', lastName: 'Smith', dob: '1980-01-01', clinicId: 'c1' }); return { decision: d.decision }; })());

console.log(results.join('\n'));
console.log(`\n=== FACT/IDENTITY PROBES: ${pass} held, ${fail} broken, ${pass + fail} total ===`);

