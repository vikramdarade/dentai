import { describe, it, expect } from 'vitest';
import {
  ClinicalFact,
  CandidateClinicalFact,
  validateClinicalFactInvariants,
  validateToothReferenceMetadata,
  checkStatusTemporalCompatibility,
  ToothReference,
  DentalSurface,
  FactCertainty,
  FactExtractionMethod
} from '../src/types/clinicalFact';
import {
  createClinicalFact,
  createCanonicalClinicalFact,
  createToothReference,
  adaptFactsToLegacyFindings,
  adaptLegacyFindingsToFacts
} from '../src/lib/clinicalFactMigration';
import type { ClinicalFindings } from '../src/types';

describe('Phase 3 Contract: ClinicalFact Trust Boundary, Discriminated Types & Deterministic Validation', () => {

  // =========================================================================
  // A. CANDIDATE → CANONICAL TRUST BOUNDARY
  // =========================================================================
  describe('Candidate → Canonical Fact Trust Boundary', () => {
    it('accepts a valid candidate and constructs an immutable canonical ClinicalFact', () => {
      const candidate: CandidateClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'caries into dentine' },
        status: 'observed',
        temporal: 'current',
        certainty: 'certain',
        extractionMethod: 'model_extracted',
        anatomy: {
          teeth: [36],
          surfaces: ['M', 'O']
        },
        evidence: [{
          utteranceId: 'utt-05',
          rawText: 'Tooth 36 has caries into dentine on the MO.',
          speaker: 'clinician'
        }]
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(true);
      if (result.success && result.fact.type === 'tooth_finding') {
        expect(result.fact.id).toMatch(/^fact-/);
        expect(result.fact.type).toBe('tooth_finding');
        expect(result.fact.value.condition).toBe('caries into dentine');
        expect(result.fact.validationState).toBe('valid');
        expect(result.fact.verificationState).toBe('unverified');
        expect(result.fact.anatomy?.teeth[0].tooth).toBe(36);
        expect(result.fact.anatomy?.teeth[0].dentition).toBe('permanent');
        expect(result.fact.anatomy?.canonicalSurfaces).toBe('MO');
      }
    });

    it('rejects an invalid candidate and returns structured domain errors', () => {
      const invalidCandidate: CandidateClinicalFact = {
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { name: 'filling' },
        status: 'performed',
        temporal: 'next_appointment' // Temporal contradiction!
      };

      const result = createCanonicalClinicalFact(invalidCandidate);
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('Temporal Conflict'))).toBe(true);
      }
    });
  });

  // =========================================================================
  // B. DISCRIMINATED TYPE / VALUE TYPE SAFETY
  // =========================================================================
  describe('Discriminated Type / Value Integrity', () => {
    it('normalizes string values into strictly typed specialized payloads', () => {
      const candidate: CandidateClinicalFact = {
        type: 'allergy',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'Penicillin',
        status: 'reported',
        temporal: 'current'
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(true);
      if (result.success && result.fact.type === 'allergy') {
        expect(result.fact.type).toBe('allergy');
        expect(result.fact.value.allergen).toBe('Penicillin');
      }
    });

    it('normalizes symptom strings into SymptomValue payload', () => {
      const candidate: CandidateClinicalFact = {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'Throbbing pain keeping me awake',
        status: 'reported',
        temporal: 'current',
        certainty: 'certain'
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(true);
      if (result.success && result.fact.type === 'symptom') {
        expect(result.fact.type).toBe('symptom');
        expect(result.fact.value.description).toBe('Throbbing pain keeping me awake');
      }
    });

    it('rejects incompatible value payloads that do not match the fact type', () => {
      const candidate: CandidateClinicalFact = {
        type: 'anaesthetic',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: 12345 as any // Incompatible primitive
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.errors.some(e => e.includes('Invalid value for anaesthetic'))).toBe(true);
      }
    });
  });

  // =========================================================================
  // C. EXTRACTION METHOD VS CERTAINTY SEPARATION
  // =========================================================================
  describe('Extraction Method vs Epistemic Certainty Separation', () => {
    it('proves extractionMethod and certainty are distinct independent dimensions', () => {
      // An assertion can be model-extracted but clinically certain
      const fact1 = createCanonicalClinicalFact({
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'caries' },
        extractionMethod: 'model_extracted',
        certainty: 'certain',
        anatomy: { teeth: [36] }
      });
      expect(fact1.success).toBe(true);
      if (fact1.success) {
        expect(fact1.fact.extractionMethod).toBe('model_extracted');
        expect(fact1.fact.certainty).toBe('certain');
      }

      // An assertion can be verbatim from patient but clinically uncertain
      const fact2 = createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: { description: 'tooth feels cracked' },
        extractionMethod: 'verbatim',
        certainty: 'uncertain',
        anatomy: { teeth: [36] }
      });
      expect(fact2.success).toBe(true);
      if (fact2.success) {
        expect(fact2.fact.extractionMethod).toBe('verbatim');
        expect(fact2.fact.certainty).toBe('uncertain');
      }
    });
  });

  // =========================================================================
  // D. VALIDATION VS VERIFICATION SEPARATION
  // =========================================================================
  describe('Structural Validation vs Clinical Verification Separation', () => {
    it('distinguishes structural validity from evidentiary clinical verification', () => {
      const result = createCanonicalClinicalFact({
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { name: 'composite restoration', adaCode: '532' },
        status: 'performed',
        temporal: 'completed_today',
        anatomy: { teeth: [16], surfaces: ['M', 'O'] }
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Structurally valid...
        expect(result.fact.validationState).toBe('valid');
        // ...but clinical verification is NOT automatically asserted!
        expect(result.fact.verificationState).toBe('unverified');
        expect(result.fact.verificationMethod).toBe('none');
      }
    });
  });

  // =========================================================================
  // E. EVIDENCE PROVENANCE & TIMESTAMP INTEGRITY
  // =========================================================================
  describe('Evidence Provenance & Timestamp Integrity', () => {
    it('allows evidence spans with authentic missing timestamps (undefined ms)', () => {
      const candidate: CandidateClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'caries' },
        evidence: [{
          utteranceId: 'u-1',
          rawText: 'Tooth 36 has caries',
          startMs: undefined,
          endMs: undefined,
          source: 'transcript'
        }],
        anatomy: { teeth: [36] }
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.fact.evidence[0].startMs).toBeUndefined();
        expect(result.fact.evidence[0].endMs).toBeUndefined();
      }
    });

    it('preserves valid authentic source timestamps', () => {
      const candidate: CandidateClinicalFact = {
        type: 'procedure',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { name: 'extraction' },
        evidence: [{
          utteranceId: 'u-4',
          rawText: 'Extracted tooth 48',
          startMs: 12000,
          endMs: 14500,
          source: 'asr',
          timestampSource: 'asr'
        }],
        anatomy: { teeth: [48] },
        status: 'performed',
        temporal: 'completed_today'
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.fact.evidence[0].startMs).toBe(12000);
        expect(result.fact.evidence[0].endMs).toBe(14500);
        expect(result.fact.evidence[0].timestampSource).toBe('asr');
      }
    });

    it('rejects negative timestamps', () => {
      const candidate: CandidateClinicalFact = {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        evidence: [{
          utteranceId: 'u-1',
          rawText: 'pain',
          startMs: -500,
          endMs: 2000
        }]
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.errors.some(e => e.includes('negative milliseconds'))).toBe(true);
      }
    });

    it('rejects inverted timestamps (startMs > endMs)', () => {
      const candidate: CandidateClinicalFact = {
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        evidence: [{
          utteranceId: 'u-1',
          rawText: 'pain',
          startMs: 5000,
          endMs: 2000
        }]
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.errors.some(e => e.includes('cannot exceed endMs'))).toBe(true);
      }
    });
  });

  // =========================================================================
  // F. SPEAKER & EVIDENCE CONSISTENCY
  // =========================================================================
  describe('Speaker & Evidence Consistency', () => {
    it('rejects patient assertions claiming clinician_observed evidence', () => {
      const candidate: CandidateClinicalFact = {
        type: 'tooth_finding',
        speaker: 'patient',
        evidenceType: 'clinician_observed',
        value: { condition: 'caries' }
      };

      const result = createCanonicalClinicalFact(candidate);
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.errors.some(e => e.includes('Epistemic Conflict'))).toBe(true);
      }
    });

    it('detects speaker mismatch between fact and evidence span', () => {
      const candidate: CandidateClinicalFact = {
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'caries' },
        evidence: [{
          utteranceId: 'u-1',
          rawText: 'My tooth hurts',
          speaker: 'patient' // Mismatch!
        }],
        anatomy: { teeth: [36] }
      };

      const result = createCanonicalClinicalFact(candidate);
      // Passes with warning rather than fatal error to allow discussion context
      expect(result.warnings.some(w => w.includes('Speaker Mismatch'))).toBe(true);
    });
  });

  // =========================================================================
  // G. FDI ANATOMICAL METADATA HARDENING
  // =========================================================================
  describe('FDI Anatomical Metadata Consistency', () => {
    it('validates permanent dentition tooth metadata consistency', () => {
      const tooth36 = createToothReference(36);
      expect(tooth36.tooth).toBe(36);
      expect(tooth36.dentition).toBe('permanent');
      expect(tooth36.quadrant).toBe(3);
      expect(tooth36.position).toBe(6);

      const check = validateToothReferenceMetadata(tooth36);
      expect(check.isValid).toBe(true);
    });

    it('validates deciduous dentition tooth metadata consistency', () => {
      const tooth54 = createToothReference(54);
      expect(tooth54.tooth).toBe(54);
      expect(tooth54.dentition).toBe('deciduous');
      expect(tooth54.quadrant).toBe(5);
      expect(tooth54.position).toBe(4);

      const check = validateToothReferenceMetadata(tooth54);
      expect(check.isValid).toBe(true);
    });

    it('rejects contradictory tooth reference metadata', () => {
      const contradictoryRef: ToothReference = {
        tooth: 36,
        dentition: 'deciduous', // Contradiction! 36 is permanent
        quadrant: 1, // Contradiction! 36 is quadrant 3
        position: 6
      };

      const check = validateToothReferenceMetadata(contradictoryRef);
      expect(check.isValid).toBe(false);
      expect(check.error).toContain('Metadata Conflict');
    });

    it('rejects impossible FDI tooth numbers (39, 49, 00, 86)', () => {
      expect(() => createToothReference(39)).toThrow(/Invalid FDI tooth number/);
      expect(() => createToothReference(49)).toThrow(/Invalid FDI tooth number/);
      expect(() => createToothReference(0)).toThrow(/Invalid FDI tooth number/);
      expect(() => createToothReference(86)).toThrow(/Invalid FDI tooth number/);
    });

    it('rejects Occlusal surface on anterior teeth', () => {
      const result = createCanonicalClinicalFact({
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'incisal wear' },
        anatomy: {
          teeth: [11],
          surfaces: ['O'] // Anterior tooth 11 cannot have Occlusal surface
        }
      });

      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.errors.some(e => e.includes('Anatomical Conflict'))).toBe(true);
      }
    });

    it('rejects Incisal edge on posterior teeth', () => {
      const result = createCanonicalClinicalFact({
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'occlusal wear' },
        anatomy: {
          teeth: [46],
          surfaces: ['I'] // Posterior molar 46 cannot have Incisal surface
        }
      });

      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.errors.some(e => e.includes('Anatomical Conflict'))).toBe(true);
      }
    });
  });

  // =========================================================================
  // H. STATUS × TEMPORAL COMPATIBILITY MATRIX
  // =========================================================================
  describe('Status × Temporal Compatibility Matrix', () => {
    it('rejects planned + completed_today', () => {
      const check = checkStatusTemporalCompatibility('planned', 'completed_today');
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Temporal Conflict');
    });

    it('rejects performed + next_appointment', () => {
      const check = checkStatusTemporalCompatibility('performed', 'next_appointment');
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Temporal Conflict');
    });

    it('rejects performed + future', () => {
      const check = checkStatusTemporalCompatibility('performed', 'future');
      expect(check.allowed).toBe(false);
    });

    it('rejects historical + completed_today', () => {
      const check = checkStatusTemporalCompatibility('historical', 'completed_today');
      expect(check.allowed).toBe(false);
    });

    it('rejects observed + next_appointment', () => {
      const check = checkStatusTemporalCompatibility('observed', 'next_appointment');
      expect(check.allowed).toBe(false);
    });

    it('permits planned + next_appointment', () => {
      const check = checkStatusTemporalCompatibility('planned', 'next_appointment');
      expect(check.allowed).toBe(true);
    });

    it('permits performed + completed_today', () => {
      const check = checkStatusTemporalCompatibility('performed', 'completed_today');
      expect(check.allowed).toBe(true);
    });

    it('permits discussed across various temporal references', () => {
      expect(checkStatusTemporalCompatibility('discussed', 'current').allowed).toBe(true);
      expect(checkStatusTemporalCompatibility('discussed', 'planned').allowed).toBe(true);
      expect(checkStatusTemporalCompatibility('discussed', 'next_appointment').allowed).toBe(true);
      expect(checkStatusTemporalCompatibility('discussed', 'historical').allowed).toBe(true);
    });
  });

  // =========================================================================
  // I. NEGATION SEMANTICS
  // =========================================================================
  describe('Explicit Negation Semantics', () => {
    it('distinguishes direct clinical negation from uncertainty', () => {
      // "No caries on 36"
      const negatedFact = createCanonicalClinicalFact({
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'caries' },
        status: 'negated',
        certainty: 'certain',
        negationScope: 'caries on tooth 36',
        anatomy: { teeth: [36] }
      });

      expect(negatedFact.success).toBe(true);
      if (negatedFact.success) {
        expect(negatedFact.fact.status).toBe('negated');
        expect(negatedFact.fact.certainty).toBe('certain');
        expect(negatedFact.fact.negationScope).toBe('caries on tooth 36');
      }

      // "I am not sure if 36 has caries"
      const uncertainFact = createCanonicalClinicalFact({
        type: 'tooth_finding',
        speaker: 'clinician',
        evidenceType: 'clinician_observed',
        value: { condition: 'caries' },
        status: 'observed',
        certainty: 'uncertain',
        anatomy: { teeth: [36] }
      });

      expect(uncertainFact.success).toBe(true);
      if (uncertainFact.success) {
        expect(uncertainFact.fact.status).toBe('observed');
        expect(uncertainFact.fact.certainty).toBe('uncertain');
      }
    });
  });

  // =========================================================================
  // J. CONFIDENCE RANGE VALIDATION
  // =========================================================================
  describe('Confidence Range Validation', () => {
    it('accepts valid numeric confidence between 0.0 and 1.0', () => {
      const res0 = createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        confidence: 0
      });
      expect(res0.success).toBe(true);

      const res1 = createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        confidence: 1
      });
      expect(res1.success).toBe(true);

      const resHalf = createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        confidence: 0.85
      });
      expect(resHalf.success).toBe(true);
    });

    it('rejects negative, excessive, NaN and Infinity confidence values', () => {
      expect(createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        confidence: -0.1
      }).success).toBe(false);

      expect(createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        confidence: 1.5
      }).success).toBe(false);

      expect(createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        confidence: NaN
      }).success).toBe(false);

      expect(createCanonicalClinicalFact({
        type: 'symptom',
        speaker: 'patient',
        evidenceType: 'patient_reported',
        value: 'pain',
        confidence: Infinity
      }).success).toBe(false);
    });
  });

  // =========================================================================
  // K. MIGRATION COMPATIBILITY
  // =========================================================================
  describe('Legacy Migration Fidelity', () => {
    it('renders canonical ClinicalFact[] into legacy ClinicalFindings correctly', () => {
      const facts: ClinicalFact[] = [
        createClinicalFact({
          type: 'chief_complaint',
          speaker: 'patient',
          evidenceType: 'patient_reported',
          value: { complaint: 'Cold sensitivity upper right' },
          status: 'reported',
          teeth: [16]
        }),
        createClinicalFact({
          type: 'procedure',
          speaker: 'clinician',
          evidenceType: 'clinician_observed',
          value: { name: 'Composite restoration', adaCode: '532' },
          status: 'performed',
          temporal: 'completed_today',
          teeth: [16],
          surfaces: ['M', 'O']
        }),
        createClinicalFact({
          type: 'procedure',
          speaker: 'clinician',
          evidenceType: 'instruction',
          value: { name: 'Full ceramic crown', adaCode: '611' },
          status: 'planned',
          temporal: 'next_appointment',
          teeth: [16]
        })
      ];

      const findings = adaptFactsToLegacyFindings(facts);

      expect(findings.chiefComplaint).toContain('Cold sensitivity upper right');
      expect(findings.treatmentPerformed).toContain('Completed Composite restoration on #16 (MO)');
      expect(findings.recommendations).toContain('Planned: Full ceramic crown on #16');
      expect(findings.adaCodes?.some(c => c.code === '532')).toBe(true);
      expect(findings.adaCodes?.some(c => c.code === '611')).toBe(false);
    });

    it('upgrades legacy ClinicalFindings into baseline ClinicalFact[]', () => {
      const legacy: ClinicalFindings = {
        chiefComplaint: 'Throbbing molar pain',
        history: 'Penicillin allergy',
        toothFindings: 'Tooth 46 deep caries',
        findingsGingival: 'Normal gingiva',
        diagnosis: 'Pulpitis 46',
        treatmentPerformed: 'Pulp extirpation 46',
        recommendations: 'Warm salt water rinses',
        recallRequirements: 'Review in 2 weeks'
      };

      const facts = adaptLegacyFindingsToFacts(legacy);
      expect(facts.length).toBeGreaterThanOrEqual(6);

      const complaint = facts.find(f => f.type === 'chief_complaint');
      expect(complaint?.value).toEqual({ complaint: 'Throbbing molar pain' });

      const proc = facts.find(f => f.type === 'procedure');
      expect(proc?.status).toBe('performed');
      expect(proc?.temporal).toBe('completed_today');
    });
  });
});

describe('enum membership at the ClinicalFact trust boundary (QLE-2026-0005)', () => {
  const base = {
    type: 'procedure' as const,
    speaker: 'clinician' as const,
    evidenceType: 'clinician_observed' as const,
    value: { name: 'Composite restoration' },
    evidence: [] as any[]
  };

  it('refuses an uppercase status/temporal pair the matrix would otherwise miss', () => {
    // Before the guard, status 'PERFORMED' matched no branch of the matrix (it
    // compares lowercase literals), so a procedure documented as performed at a
    // future appointment was admitted as a canonical, valid fact.
    const result = createCanonicalClinicalFact({
      ...base, status: 'PERFORMED' as any, temporal: 'FUTURE' as any
    });
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.errors.join(' ')).toContain('Temporal Conflict');
    }
  });

  it('refuses invented enum values instead of defaulting them', () => {
    const badSpeaker = createCanonicalClinicalFact({ ...base, speaker: 'robot' as any });
    expect(badSpeaker.success).toBe(false);
    if (badSpeaker.success === false) expect(badSpeaker.errors.join(' ')).toContain('speaker');

    const badEvidence = createCanonicalClinicalFact({ ...base, evidenceType: 'made_up' as any });
    expect(badEvidence.success).toBe(false);
    if (badEvidence.success === false) expect(badEvidence.errors.join(' ')).toContain('evidenceType');

    const badStatus = createCanonicalClinicalFact({ ...base, status: 'done' as any });
    expect(badStatus.success).toBe(false);
    if (badStatus.success === false) expect(badStatus.errors.join(' ')).toContain('status');
  });

  it('normalises a recognised case/whitespace variant to the canonical member', () => {
    const result = createCanonicalClinicalFact({
      ...base, status: '  Performed ' as any, temporal: 'Completed_Today' as any, certainty: 'CERTAIN' as any
    });
    expect(result.success).toBe(true);
    if (result.success === true) {
      expect(result.fact.status).toBe('performed');
      expect(result.fact.temporal).toBe('completed_today');
      expect(result.fact.certainty).toBe('certain');
    }
  });

  it('keeps a valid canonical candidate admissible (adjacent behaviour)', () => {
    const result = createCanonicalClinicalFact({
      ...base, status: 'performed', temporal: 'completed_today'
    });
    expect(result.success).toBe(true);
    if (result.success === true) {
      expect(result.fact.validationState).toBe('valid');
      expect(result.fact.status).toBe('performed');
    }
  });
});
