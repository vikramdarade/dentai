import { describe, it, expect, afterEach } from 'vitest';
import { createAttestationSeal } from '../src/lib/attestation';
import { encryptPayload, decryptPayload } from '../src/sovereignty/cryptoStorage';
import { verifyRogersConsent } from '../src/grounding/rogersConsentGate';
import { reconcileEntitiesBackward } from '../src/grounding/backwardReconciliation';
import { extractClinicalClaims } from '../src/grounding/subsecondAlignment';
import { clinicalHorizonFilter } from '../src/server/payloadValidation';
import type { Consultation } from '../src/types';

describe('Adversarial Code Review Remediations Verification Suite', () => {
  const baseConsult: Consultation = {
    id: 'consult-adv-test-01',
    firstName: 'Chloe',
    lastName: 'Mitchell',
    dob: '1992-07-15',
    appointmentType: 'emergency',
    date: '2026-09-25',
    time: '11:00 AM',
    status: 'In Review',
    patientSummary: 'Tooth 16 restored.',
    dentistId: 'dentist-vic-01',
    dentistName: 'Dr. Vikram Darade',
    dentistAHPRA: '',
    transcript: [],
    findings: {
      chiefComplaint: 'Broken tooth 16.',
      history: 'Nil medical alerts.',
      toothFindings: 'Tooth 16 fracture.',
      findingsGingival: 'Healthy gingiva.',
      diagnosis: 'Enamel-dentine fracture tooth 16.',
      treatmentPerformed: 'Composite resin 16 MO.',
      recommendations: 'Care with hard food.',
      recallRequirements: '6 Months',
      adaCodes: [{ code: '532', tooth: '16', description: 'Restoration - 2 surfaces, posterior' }]
    }
  };

  describe('ADV-01: Attestation Seal Zero-Synthesis Verification (Rule 12)', () => {
    it('does not synthesize a fake AHPRA registration number when omitted', () => {
      const seal = createAttestationSeal(
        baseConsult,
        baseConsult.dentistId!,
        baseConsult.dentistName!,
        baseConsult.dentistAHPRA!
      );

      expect(seal.ahpraRegistration).toBe('');
      expect(seal.ahpraRegistration).not.toBe('DEN0000123456');
      expect(seal.practitionerId).toBe('dentist-vic-01');
      expect(seal.signatureHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('ADV-02: Cryptographic Fail-Closed Secret Enforcement (APP 8)', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('throws in production if SESSION_SECRET and ENCRYPTION_SECRET are absent', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SESSION_SECRET;
      delete process.env.ENCRYPTION_SECRET;

      expect(() => {
        encryptPayload('sensitive patient record');
      }).toThrow(/FATAL: Encryption secret/);
    });

    it('encrypts and decrypts cleanly when secret is provided in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'prod-secret-must-be-high-entropy-au-southeast1';

      const payload = { diagnosis: 'Irreversible pulpitis 26' };
      const envelope = encryptPayload(payload);
      expect(envelope.algorithm).toBe('aes-256-gcm');
      expect(envelope.authTag).toBeDefined();

      const decrypted = decryptPayload(envelope);
      expect(JSON.parse(decrypted)).toEqual(payload);
    });
  });

  describe('ADV-03: Rogers Consent Gating Diarization Resilience (Rule 15)', () => {
    it('verifies consent when live audio is un-diarized Dialogue per Rule 15', () => {
      const undiarizedTranscript = [
        { id: 'u-1', sender: 'Dialogue' as const, text: 'We need to perform a surgical extraction on tooth 48.', startTimeMs: 1000, endTimeMs: 4000 },
        { id: 'u-2', sender: 'Dialogue' as const, text: 'There is a material risk of inferior alveolar nerve paresthesia with temporary or permanent lower lip numbness.', startTimeMs: 5000, endTimeMs: 9000 },
        { id: 'u-2b', sender: 'Dialogue' as const, text: 'Also a risk of dry socket and localized infection.', startTimeMs: 9100, endTimeMs: 9800 },
        { id: 'u-3', sender: 'Dialogue' as const, text: 'I understand the nerve risk and dry socket, and I agree to proceed with the extraction.', startTimeMs: 10000, endTimeMs: 13000 },
        { id: 'u-4', sender: 'Dialogue' as const, text: 'The alternative is monitoring or coronectomy.', startTimeMs: 14000, endTimeMs: 16000 }
      ];

      const note = 'Surgical extraction of tooth 48. Patient warned of paresthesia and dry socket. Patient consented and alternatives discussed.';
      const verification = verifyRogersConsent(undiarizedTranscript, note, 'Surgical Extraction 48');

      expect(verification.isInvasiveProcedure).toBe(true);
      expect(verification.isLegallyCorroborated).toBe(true);
      expect(verification.materialRisksDiscussed.length).toBeGreaterThanOrEqual(1);
      expect(verification.materialRisksDiscussed[0].riskType).toBe('nerve_damage_paresthesia');
      expect(verification.materialRisksDiscussed[0].acknowledgedByPatient).toBe(true);
      expect(verification.alternativesDiscussed.length).toBeGreaterThan(0);
      expect(verification.legalDefensibilityGrade).toBe('A_Defensible');
    });
  });

  describe('ADV-04: FDI Tooth Extraction False Positive Measurement Shielding', () => {
    it('does not misidentify dosage or time measurements as teeth in backward reconciliation', () => {
      const transcript = [
        { id: 'u-1', sender: 'Dentist' as const, text: 'Administering 25 mg of antibiotic and 35 min waiting period for patient age 46 years.', startTimeMs: 0, endTimeMs: 5000 },
        { id: 'u-2', sender: 'Patient' as const, text: 'My diastolic blood pressure is usually 75 mmHg.', startTimeMs: 6000, endTimeMs: 9000 },
        { id: 'u-3', sender: 'Dentist' as const, text: 'Examining tooth 16, finding distal caries.', startTimeMs: 10000, endTimeMs: 13000 }
      ];

      const noteText = 'Examined tooth 16. Distal decay noted.';
      const result = reconcileEntitiesBackward(transcript, noteText);

      // Teeth 25, 35, 46, 75 must NOT be identified as spoken teeth
      expect(result.detectedSpokenEntities.teeth).toContain(16);
      expect(result.detectedSpokenEntities.teeth).not.toContain(25);
      expect(result.detectedSpokenEntities.teeth).not.toContain(35);
      expect(result.detectedSpokenEntities.teeth).not.toContain(46);
      expect(result.detectedSpokenEntities.teeth).not.toContain(75);

      // Consequently, no false omission alerts for 25, 35, 46, 75
      const spuriousToothOmissions = result.omissions.filter(o =>
        ['Tooth 25', 'Tooth 35', 'Tooth 46', 'Tooth 75'].includes(o.entityName)
      );
      expect(spuriousToothOmissions.length).toBe(0);
    });

    it('does not extract false tooth claims from dosage/time in subsecondAlignment', () => {
      const claims = extractClinicalClaims({
        diagnosis: 'Patient is 46 years old with blood pressure 120/75 mmHg. Waited 35 mins after 25 mg premedication.'
      });

      const toothClaims = claims.filter(c => c.category === 'tooth');
      expect(toothClaims.map(c => c.text)).not.toContain('Tooth 46');
      expect(toothClaims.map(c => c.text)).not.toContain('Tooth 75');
      expect(toothClaims.map(c => c.text)).not.toContain('Tooth 35');
      expect(toothClaims.map(c => c.text)).not.toContain('Tooth 25');
    });
  });

  describe('ADV-10: Aftercare Trigger Vocabulary in Horizon Filter (Rule 7)', () => {
    it('preserves post-op aftercare handover mentioning dry socket and chlorhexidine', () => {
      const baseUtterances = [
        { sender: 'Dentist', text: 'Examining tooth 38. Impacted third molar.' },
        { sender: 'Dentist', text: 'Surgical extraction completed, 3-0 silk suture placed.' }
      ];

      // Add 16 non-clinical room chatter utterances
      const roomChatter = Array.from({ length: 16 }, (_, i) => ({
        sender: 'Assistant',
        text: `Room cleaning step ${i + 1}, wiping tray.`
      }));

      // Post-op handover advice using dental terms
      const handover = [
        { sender: 'Dentist', text: 'Rinse with chlorhexidine mouthwash and watch for dry socket symptoms over the next 48 hours.' }
      ];

      // Trailing vacuum noise
      const trailingNoise = Array.from({ length: 20 }, (_, i) => ({
        sender: 'Noise',
        text: `Vacuum hiss ${i + 1}`
      }));

      const fullTranscript = [...baseUtterances, ...roomChatter, ...handover, ...trailingNoise];
      const filtered = clinicalHorizonFilter(fullTranscript);

      // The handover utterance must be preserved because dry socket and chlorhexidine are recognized aftercare triggers
      const hasHandover = filtered.some(u => u.text.includes('dry socket'));
      expect(hasHandover).toBe(true);
    });
  });
});
