import { describe, it, expect } from 'vitest';
import {
  createAttestationSeal,
  verifyAttestationSeal,
  buildCanonicalTextDigest
} from '../src/lib/attestation';
import { toPmsEncounter, renderD4W, renderExact, renderGeneric } from '../src/lib/pms';
import type { Consultation } from '../src/types';

describe('Work Package 5.0: Chairside Review UI & Practice Management Integration', () => {
  const mockConsultation: Consultation = {
    id: 'consult-test-wp5-001',
    firstName: 'Sarah',
    lastName: 'O\'Connor',
    dob: '1988-04-12',
    appointmentType: 'emergency',
    date: '2026-09-24',
    time: '10:30 AM',
    status: 'In Review',
    dentistId: 'dentist-vic-01',
    dentistName: 'Dr. Vikram Darade',
    dentistAHPRA: 'DEN0001928374',
    transcript: [
      { sender: 'Dentist', text: 'Good morning Sarah, what brings you in today?' },
      { sender: 'Patient', text: 'I broke my lower left molar chewing on a nut yesterday.' },
      { sender: 'Dentist', text: 'Examining tooth 36. There is an extensive fractured disto-occlusal cusp with dentine exposure. No pulp involvement on cold test.' },
      { sender: 'Dentist', text: 'We will place an emergency composite resin restoration today, ADA 532. Followed by a ceramic crown ADA 611 in 3 weeks.' }
    ],
    findings: {
      chiefComplaint: 'Broken lower left molar tooth 36 yesterday while eating.',
      history: 'No medical alerts. Nil allergies.',
      toothFindings: 'Tooth 36 extensive fractured disto-occlusal cusp with dentine exposure.',
      findingsGingival: 'Gingiva healthy, probing depths 2-3mm.',
      diagnosis: 'Fractured tooth structure 36 without pulpal exposure.',
      treatmentPerformed: 'Direct composite resin restoration placed tooth 36 DO under rubber dam.',
      recommendations: 'Avoid hard chewing on left side. Return for full crown 36 in 3 weeks.',
      recallRequirements: '6 Months (Standard)',
      adaCodes: [
        { code: '532', description: 'Restoration - 2 surfaces, posterior', tooth: '36' },
        { code: '022', description: 'Intraoral periapical radiograph', tooth: '36' }
      ]
    },
    patientSummary: 'Tooth 36 repaired with temporary composite restoration.',
    groundingAudit: {
      consultationId: 'consult-test-wp5-001',
      alignment: {
        totalClaimsCount: 4,
        corroboratedCount: 4,
        unverifiedCount: 0,
        overallGroundingScore: 1.0,
        statusBadge: 'Verified from Audio',
        isFullyGrounded: true,
        claims: []
      },
      reconciliation: {
        hasCriticalOmissions: false,
        omissionsCount: 0,
        detectedSpokenEntities: {
          allergies: [],
          medications: [],
          conditions: [],
          teeth: [36]
        },
        omissions: []
      },
      rogersConsent: {
        procedureName: 'emergency composite resin restoration',
        isInvasiveProcedure: false,
        requiresWrittenConsent: false,
        isLegallyCorroborated: true,
        isBoilerplateFabrication: false,
        materialRisksDiscussed: [],
        alternativesDiscussed: [],
        costDiscussed: true,
        patientAgreementGrounded: true,
        evidentiarySummary: 'Informed consent verified.',
        legalDefensibilityGrade: 'A_Defensible'
      },
      isApprovedForSigning: true,
      blockingReasons: []
    }
  };

  describe('5.1 Cryptographic Attestation Engine (Evidence Act 1995)', () => {
    it('creates an immutable SHA-256 seal with 64-character hex signature', () => {
      const seal = createAttestationSeal(
        mockConsultation,
        mockConsultation.dentistId!,
        mockConsultation.dentistName!,
        mockConsultation.dentistAHPRA!,
        '2026-09-24T10:35:00.000Z'
      );

      expect(seal).toBeDefined();
      expect(seal.signatureHash).toMatch(/^[a-f0-9]{64}$/);
      expect(seal.contentDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(seal.signedBy).toBe('Dr. Vikram Darade');
      expect(seal.practitionerId).toBe('dentist-vic-01');
      expect(seal.ahpraRegistration).toBe('DEN0001928374');
      expect(seal.auditStatus).toBe('Verified from Audio');
      expect(seal.signedAt).toBe('2026-09-24T10:35:00.000Z');
    });

    it('verifies untouched consultations with valid: true', () => {
      const seal = createAttestationSeal(
        mockConsultation,
        mockConsultation.dentistId!,
        mockConsultation.dentistName!,
        mockConsultation.dentistAHPRA!,
        '2026-09-24T10:35:00.000Z'
      );

      const verification = verifyAttestationSeal(mockConsultation, seal);
      expect(verification.isValid).toBe(true);
      expect(verification.reason).toBeUndefined();
    });

    it('detects tampering when clinical text is modified post-signing', () => {
      const seal = createAttestationSeal(
        mockConsultation,
        mockConsultation.dentistId!,
        mockConsultation.dentistName!,
        mockConsultation.dentistAHPRA!,
        '2026-09-24T10:35:00.000Z'
      );

      // Malicious or accidental modification of clinical diagnosis
      const tamperedConsultation: Consultation = {
        ...mockConsultation,
        findings: {
          ...mockConsultation.findings,
          diagnosis: 'Severe irreversible pulpitis requiring immediate root canal therapy.'
        }
      };

      const verification = verifyAttestationSeal(tamperedConsultation, seal);
      expect(verification.isValid).toBe(false);
      expect(verification.reason).toContain('Clinical content has been modified');
    });

    it('detects tampering when tooth findings are altered', () => {
      const seal = createAttestationSeal(
        mockConsultation,
        mockConsultation.dentistId!,
        mockConsultation.dentistName!,
        mockConsultation.dentistAHPRA!,
        '2026-09-24T10:35:00.000Z'
      );

      const tamperedToothConsultation: Consultation = {
        ...mockConsultation,
        findings: {
          ...mockConsultation.findings,
          toothFindings: 'Tooth 46 broken' // Altered tooth notation
        }
      };

      const verification = verifyAttestationSeal(tamperedToothConsultation, seal);
      expect(verification.isValid).toBe(false);
      expect(verification.reason).toContain('Clinical content has been modified');
    });

    it('detects tampering when practitioner registration is modified', () => {
      const seal = createAttestationSeal(
        mockConsultation,
        mockConsultation.dentistId!,
        mockConsultation.dentistName!,
        mockConsultation.dentistAHPRA!,
        '2026-09-24T10:35:00.000Z'
      );

      const forgedSeal = {
        ...seal,
        ahpraRegistration: 'DEN9999999999' // Forged registration
      };

      const verification = verifyAttestationSeal(mockConsultation, forgedSeal);
      expect(verification.isValid).toBe(false);
      expect(verification.reason).toContain('Signature seal integrity check failed');
    });

    it('produces deterministic digests regardless of whitespace', () => {
      const c1 = { ...mockConsultation };
      const c2 = {
        ...mockConsultation,
        firstName: '  Sarah  ',
        lastName: '  O\'Connor  '
      };

      const d1 = buildCanonicalTextDigest(c1);
      const d2 = buildCanonicalTextDigest(c2);
      expect(d1).toBe(d2);
    });
  });

  describe('5.2 Practice Management System (PMS) Adapters', () => {
    it('renders Dental4Windows (D4W) clinical format with SHA-256 seal', () => {
      const signedConsultation: Consultation = {
        ...mockConsultation,
        attestation: createAttestationSeal(
          mockConsultation,
          mockConsultation.dentistId!,
          mockConsultation.dentistName!,
          mockConsultation.dentistAHPRA!,
          '2026-09-24T10:35:00.000Z'
        )
      };

      const encounter = toPmsEncounter(signedConsultation);
      const d4wOutput = renderD4W(encounter);

      expect(d4wOutput).toContain('DENTAL4WINDOWS CLINICAL PROGRESS NOTE');
      expect(d4wOutput).toContain('PATIENT: Sarah O\'Connor');
      expect(d4wOutput).toContain('DIAGNOSIS:');
      expect(d4wOutput).toContain('Fractured tooth structure 36');
      expect(d4wOutput).toContain('ADA ITEM NUMBERS:');
      expect(d4wOutput).toContain('Item 532: Restoration - 2 surfaces, posterior (Tooth 36)');
      expect(d4wOutput).toContain('CLINICAL ATTESTATION & EVIDENCE:');
      expect(d4wOutput).toContain('Attested By: Dr. Vikram Darade (DEN0001928374)');
      expect(d4wOutput).toContain('Digital Seal (SHA-256):');
      expect(d4wOutput).toContain('Audio Grounding: Verified from Audio');
    });

    it('renders Software of Excellence (EXACT) format with itemized codes and seal', () => {
      const signedConsultation: Consultation = {
        ...mockConsultation,
        attestation: createAttestationSeal(
          mockConsultation,
          mockConsultation.dentistId!,
          mockConsultation.dentistName!,
          mockConsultation.dentistAHPRA!,
          '2026-09-24T10:35:00.000Z'
        )
      };

      const encounter = toPmsEncounter(signedConsultation);
      const exactOutput = renderExact(encounter);

      expect(exactOutput).toContain('SOE EXACT CLINICAL RECORD');
      expect(exactOutput).toContain('Patient: Sarah O\'Connor');
      expect(exactOutput).toContain('[Tooth findings] Tooth 36 extensive fractured disto-occlusal cusp');
      expect(exactOutput).toContain('[Diagnosis] Fractured tooth structure 36');
      expect(exactOutput).toContain('[Treatment performed] Direct composite resin restoration placed');
      expect(exactOutput).toContain('Items Completed: 532 (T36), 022 (T36)');
      expect(exactOutput).toContain('Attested: Dr. Vikram Darade (DEN0001928374)');
      expect(exactOutput).toContain('SHA-256 Seal:');
      expect(exactOutput).toContain('Verified from Audio');
    });

    it('renders generic standard PMS note cleanly', () => {
      const encounter = toPmsEncounter(mockConsultation);
      const genericOutput = renderGeneric(encounter);

      expect(genericOutput).toContain('DentAI note');
      expect(genericOutput).toContain('Provider: Dr. Vikram Darade');
      expect(genericOutput).toContain('Tooth findings: Tooth 36');
      expect(genericOutput).toContain('Treatment performed: Direct composite resin restoration');
    });

    it('keeps billing item codes distinct from clinical progress note sections', () => {
      const encounter = toPmsEncounter(mockConsultation);
      expect(encounter.itemCodes).toHaveLength(2);
      expect(encounter.itemCodes[0].code).toBe('532');
      expect(encounter.itemCodes[1].code).toBe('022');
      // In Australian dental practices, item numbers are pasted into ledger tabs, not mixed into note text
      const toothFindingsSection = encounter.sections.find(s => s.key === 'toothFindings');
      expect(toothFindingsSection?.value).not.toContain('ADA 532');
    });
  });

  describe('5.3 Rule 9 Receptionist-Friendly UI Language Compliance', () => {
    it('enforces verified human-readable terminology across PMS adapters and seals', () => {
      const signedConsultation: Consultation = {
        ...mockConsultation,
        attestation: createAttestationSeal(
          mockConsultation,
          mockConsultation.dentistId!,
          mockConsultation.dentistName!,
          mockConsultation.dentistAHPRA!
        )
      };

      const encounter = toPmsEncounter(signedConsultation);
      const d4wOutput = renderD4W(encounter);
      const exactOutput = renderExact(encounter);

      // Banned jargon check per Rule 9:
      const bannedJargon = [
        'dsp squelch',
        '0 hallucination vectors',
        'ambient transcription feed',
        'batch tray',
        'master export',
        'aseptic operatory hotkeys'
      ];

      for (const jargon of bannedJargon) {
        expect(d4wOutput.toLowerCase()).not.toContain(jargon);
        expect(exactOutput.toLowerCase()).not.toContain(jargon);
      }

      // Approved terms per Rule 9:
      expect(d4wOutput).toContain('Verified from Audio');
      expect(exactOutput).toContain('Verified from Audio');
    });
  });
});
