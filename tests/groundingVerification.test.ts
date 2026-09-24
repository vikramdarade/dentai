import { describe, it, expect } from 'vitest';
import type {
  TimestampedUtterance
} from '../src/grounding/types';
import {
  extractClinicalClaims,
  alignClaimsToUtterances,
  reconcileEntitiesBackward,
  verifyRogersConsent,
  verifyNoteGrounding
} from '../src/grounding';

/**
 * Test Specification & Verification: Work Package 3.0 - Deterministic Source Grounding & Evidentiary Verification
 *
 * Validates:
 * 1. Sub-second Utterance Alignment (Forward Verification)
 * 2. Backward Entity Reconciliation (Zero-Omission Verification)
 * 3. Rogers v Whitaker (1992) 175 CLR 479 Medico-Legal Informed Consent Grounding
 * 4. Unified Grounding Audit Gate (Sign-Off Blocker)
 */

describe('Work Package 3.0: Deterministic Source Grounding & Evidentiary Verification', () => {
  // ─── FIXTURES ───
  const mockTranscriptExtraction: TimestampedUtterance[] = [
    {
      id: 'utt-01',
      sender: 'Patient',
      text: 'Good morning doctor. I have been having severe throbbing pain in the lower right back tooth for three days.',
      startTimeMs: 1200,
      endTimeMs: 6400,
      audioSliceId: 'chunk-001'
    },
    {
      id: 'utt-02',
      sender: 'Dentist',
      text: 'Let us take a look. Please sit back. Any medical changes or allergies since your last visit?',
      startTimeMs: 7000,
      endTimeMs: 11500,
      audioSliceId: 'chunk-002'
    },
    {
      id: 'utt-03',
      sender: 'Patient',
      text: 'Yes, my GP started me on Eliquis 5 milligrams daily for a heart flutter, and I get hives with penicillin.',
      startTimeMs: 12000,
      endTimeMs: 18200,
      audioSliceId: 'chunk-003'
    },
    {
      id: 'utt-04',
      sender: 'Dentist',
      text: 'Noted: Eliquis blood thinner and penicillin allergy. We will update your chart right now.',
      startTimeMs: 18500,
      endTimeMs: 23100,
      audioSliceId: 'chunk-004'
    },
    {
      id: 'utt-05',
      sender: 'Dentist',
      text: 'Examining the lower right. Tooth 48 is partially erupted and severely impacted with pericoronitis. Tooth 47 is sound.',
      startTimeMs: 24000,
      endTimeMs: 31000,
      audioSliceId: 'chunk-005'
    },
    {
      id: 'utt-06',
      sender: 'Dentist',
      text: 'I recommend surgical removal of tooth 48. Because of where the roots lie near your nerve canal, there is a material risk of temporary or permanent numbness to your lower lip and chin, known as inferior alveolar nerve paresthesia. There is also a risk of dry socket, infection, and prolonged bleeding because of the Eliquis.',
      startTimeMs: 32000,
      endTimeMs: 48500,
      audioSliceId: 'chunk-007'
    },
    {
      id: 'utt-07',
      sender: 'Dentist',
      text: 'The alternative is leaving it, but that risks recurrent severe infections and damage to tooth 47. The fee will be approximately 420 dollars.',
      startTimeMs: 49000,
      endTimeMs: 56000,
      audioSliceId: 'chunk-009'
    },
    {
      id: 'utt-08',
      sender: 'Patient',
      text: 'I understand the nerve numbness risk and bleeding risk. I want to go ahead with the extraction today.',
      startTimeMs: 57000,
      endTimeMs: 63200,
      audioSliceId: 'chunk-011'
    },
    {
      id: 'utt-09',
      sender: 'Dentist',
      text: 'Administered 2 cartridges of 2.2 mL Lignocaine 2% with 1:80,000 adrenaline via right IANB and long buccal block.',
      startTimeMs: 65000,
      endTimeMs: 72000,
      audioSliceId: 'chunk-013'
    },
    {
      id: 'utt-10',
      sender: 'Dentist',
      text: 'Surgical extraction of tooth 48 completed. Sectioned tooth, bone guttering, hemostasis achieved with Surgicel and 3-0 silk suture. Placed pressure pack.',
      startTimeMs: 75000,
      endTimeMs: 88000,
      audioSliceId: 'chunk-016'
    }
  ];

  describe('3.1 Sub-Second Utterance Alignment (Forward Grounding Verification)', () => {
    it('corroborates asserted clinical claims against exact timestamped audio utterances (t ± 500 ms)', () => {
      const noteClaims = [
        { claimId: 'c1', category: 'tooth' as const, text: 'Tooth 48', section: 'objective', isCorroborated: false, confidenceScore: 0, verificationNote: '' },
        { claimId: 'c2', category: 'procedure' as const, text: 'Surgical extraction of tooth 48', section: 'plan', isCorroborated: false, confidenceScore: 0, verificationNote: '' },
        { claimId: 'c3', category: 'anaesthetic' as const, text: 'Lignocaine 2% with 1:80,000 adrenaline via right IANB', section: 'plan', isCorroborated: false, confidenceScore: 0, verificationNote: '' },
        { claimId: 'c4', category: 'material' as const, text: 'Surgicel and 3-0 silk suture', section: 'plan', isCorroborated: false, confidenceScore: 0, verificationNote: '' }
      ];

      const result = alignClaimsToUtterances(noteClaims, mockTranscriptExtraction);

      expect(result.corroboratedCount).toBe(4);
      expect(result.unverifiedCount).toBe(0);
      expect(result.overallGroundingScore).toBeGreaterThanOrEqual(0.85);
      expect(result.isFullyGrounded).toBe(true);
      expect(result.statusBadge).toBe('Verified from Audio');

      // Verify evidence binding with timestamps
      const toothClaim = result.claims.find(c => c.text === 'Tooth 48');
      expect(toothClaim?.evidence).toBeDefined();
      expect(toothClaim?.evidence?.startTimeMs).toBe(24000);
      expect(toothClaim?.evidence?.audioSliceId).toBe('chunk-005');
    });

    it('flags uncorroborated / hallucinated claims with score < 0.85 and blocks unverified badge', () => {
      const noteWithHallucination = [
        { claimId: 'c-fake', category: 'procedure' as const, text: 'Composite restoration tooth 16 MOD', section: 'plan', isCorroborated: false, confidenceScore: 0, verificationNote: '' }
      ];

      const result = alignClaimsToUtterances(noteWithHallucination, mockTranscriptExtraction);
      expect(result.corroboratedCount).toBe(0);
      expect(result.unverifiedCount).toBe(1);
      expect(result.isFullyGrounded).toBe(false);
      expect(result.statusBadge).not.toBe('Verified from Audio');
    });

    it('extracts discrete clinical claims from a raw note payload', () => {
      const note = {
        canonical: {
          objective: 'Tooth 48 is impacted with pericoronitis.',
          plan: 'Surgical extraction of tooth 48 completed under Lignocaine 2%.'
        }
      };

      const extracted = extractClinicalClaims(note);
      expect(extracted.length).toBeGreaterThan(0);
      expect(extracted.some(c => c.text.includes('Tooth 48'))).toBe(true);
    });

    it('enforces Receptionist-Friendly UI Language for trust badging (Rule 9)', () => {
      // Rule 9 strictly bans engineering jargon: "100% grounded / 0 hallucination vectors"
      const result = alignClaimsToUtterances([], mockTranscriptExtraction);
      expect(result.statusBadge).toBe('Verified from Audio');
      expect(result.statusBadge).not.toContain('hallucination');
      expect(result.statusBadge).not.toContain('DSP');
      expect(result.statusBadge).not.toContain('vector');
    });
  });

  describe('3.2 Backward Entity Reconciliation (Zero-Omission Verification)', () => {
    it('detects spoken allergies in transcript and triggers CRITICAL omission alert if missing from note', () => {
      // Patient explicitly stated: "I get hives with penicillin" (utt-03)
      const defectiveNoteMedicalHistory = 'Medical History: Heart flutter. No known allergies.';

      const reconciliation = reconcileEntitiesBackward(mockTranscriptExtraction, defectiveNoteMedicalHistory);

      expect(reconciliation.hasCriticalOmissions).toBe(true);
      const allergyOmission = reconciliation.omissions.find(o => o.entityType === 'allergy' && o.entityName === 'Penicillin');
      expect(allergyOmission).toBeDefined();
      expect(allergyOmission?.severity).toBe('critical');
      expect(allergyOmission?.title).toContain('Penicillin');
      expect(allergyOmission?.spokenInUtterance.timestampMs).toBe(12000);
    });

    it('detects spoken high-risk medications (blood thinners) and triggers omission alert if missing', () => {
      // Patient stated: "started me on Eliquis 5 milligrams daily" (utt-03)
      const defectiveNotePlan = 'Plan: Surgical extraction of tooth 48 under local anaesthesia.';

      const reconciliation = reconcileEntitiesBackward(mockTranscriptExtraction, defectiveNotePlan);

      expect(reconciliation.hasCriticalOmissions).toBe(true);
      const eliquisOmission = reconciliation.omissions.find(o => o.entityType === 'medication' && o.entityName.includes('Eliquis'));
      expect(eliquisOmission).toBeDefined();
      expect(eliquisOmission?.severity).toBe('critical');
    });

    it('passes backward reconciliation with zero omissions when all spoken medical entities are documented', () => {
      const comprehensiveNote = `
        Medical History: Patient has heart flutter, currently taking Eliquis (Apixaban) 5mg daily. Known allergy to Penicillin (causes hives).
        Subjective: Severe throbbing pain in lower right for 3 days.
        Objective: Tooth 48 partially erupted, impacted with pericoronitis. Tooth 47 sound.
        Plan: Surgical extraction 48 under 4.4mL Lignocaine 2% with 1:80k adrenaline. Hemostasis achieved with Surgicel and 3-0 silk sutures.
      `;

      const reconciliation = reconcileEntitiesBackward(mockTranscriptExtraction, comprehensiveNote);

      expect(reconciliation.hasCriticalOmissions).toBe(false);
      expect(reconciliation.omissions.filter(o => o.severity === 'critical')).toHaveLength(0);
      expect(reconciliation.detectedSpokenEntities.allergies).toContain('Penicillin');
      expect(reconciliation.detectedSpokenEntities.medications).toContain('Eliquis (Apixaban)');
      expect(reconciliation.detectedSpokenEntities.teeth).toContain(48);
    });
  });

  describe('3.3 Rogers v Whitaker (1992) 175 CLR 479 Informed Consent Grounding Gate', () => {
    it('verifies that patient-specific material risks were genuinely explained by the clinician in audio', () => {
      const comprehensiveNote = 'Surgical extraction of tooth 48 with discussion of paresthesia and bleeding.';
      const consent = verifyRogersConsent(mockTranscriptExtraction, comprehensiveNote, 'Surgical extraction tooth 48');

      expect(consent.isInvasiveProcedure).toBe(true);
      expect(consent.requiresWrittenConsent).toBe(true);
      expect(consent.materialRisksDiscussed.length).toBeGreaterThanOrEqual(2);

      const nerveRisk = consent.materialRisksDiscussed.find(r => r.riskType === 'nerve_damage_paresthesia');
      expect(nerveRisk?.explainedByClinician).toBe(true);
      expect(nerveRisk?.acknowledgedByPatient).toBe(true);

      const bleedingRisk = consent.materialRisksDiscussed.find(r => r.riskType === 'excessive_bleeding');
      expect(bleedingRisk?.explainedByClinician).toBe(true);

      expect(consent.legalDefensibilityGrade).toBe('A_Defensible');
      expect(consent.isLegallyCorroborated).toBe(true);
    });

    it('verifies bidirectional patient consent (patient acknowledged and accepted material risks)', () => {
      const consent = verifyRogersConsent(mockTranscriptExtraction, 'Extraction 48');
      expect(consent.patientAgreementGrounded).toBe(true);
    });

    it('detects and flags Boilerplate Fabrication (Rule 12): rejects template consent when audio contains no risk discussion', () => {
      const briefNoConsentTranscript: TimestampedUtterance[] = [
        { id: 'u1', sender: 'Dentist', text: 'Tooth 48 is broken. Let us take it out.', startTimeMs: 1000, endTimeMs: 4000 },
        { id: 'u2', sender: 'Patient', text: 'Okay sure.', startTimeMs: 4500, endTimeMs: 5500 }
      ];

      const fabricatedConsentClause =
        'Detailed informed consent discussed adhering to Rogers v Whitaker. Patient warned of inferior alveolar nerve paresthesia, root fracture, and sinus perforation.';

      const consent = verifyRogersConsent(briefNoConsentTranscript, fabricatedConsentClause, 'Surgical extraction');

      expect(consent.isBoilerplateFabrication).toBe(true);
      expect(consent.legalDefensibilityGrade).toBe('D_NonCompliant');
      expect(consent.evidentiarySummary).toContain('Critical Medico-Legal Defect');
    });

    it('verifies discussion of treatment alternatives and financial estimate under DBA Code of Conduct', () => {
      const consent = verifyRogersConsent(mockTranscriptExtraction, 'Extraction 48');
      expect(consent.alternativesDiscussed.length).toBeGreaterThan(0);
      expect(consent.costDiscussed).toBe(true);
    });
  });

  describe('3.4 Unified Grounding Audit Gate (Sign-Off Blocker)', () => {
    it('blocks clinical note sign-off if critical omissions exist', () => {
      const defectiveNote = {
        canonical: {
          medicalHistory: 'No medical conditions noted.',
          plan: 'Extraction tooth 48'
        }
      };

      const audit = verifyNoteGrounding('cons-101', mockTranscriptExtraction, defectiveNote);

      expect(audit.isApprovedForSigning).toBe(false);
      expect(audit.blockingReasons.length).toBeGreaterThan(0);
      expect(audit.blockingReasons.some(r => r.includes('Penicillin'))).toBe(true);
    });

    it('approves note sign-off when all claims are grounded, zero omissions exist, and Rogers v Whitaker consent is verified', () => {
      const comprehensiveNote = {
        canonical: {
          medicalHistory: 'Patient has heart flutter, takes Eliquis 5mg daily. Allergic to Penicillin (causes hives).',
          subjective: 'Severe throbbing pain in lower right back tooth for three days.',
          objective: 'Tooth 48 is partially erupted and impacted with pericoronitis. Tooth 47 is sound.',
          plan: 'Surgical extraction of tooth 48. Administered 2 cartridges Lignocaine 2% 1:80k. Hemostasis with Surgicel and 3-0 silk suture. Discussed nerve paresthesia numbness risk and bleeding. Patient agreed.'
        }
      };

      const audit = verifyNoteGrounding('cons-102', mockTranscriptExtraction, comprehensiveNote);

      expect(audit.reconciliation.hasCriticalOmissions).toBe(false);
      expect(audit.rogersConsent?.isBoilerplateFabrication).toBe(false);
      expect(audit.isApprovedForSigning).toBe(true);
      expect(audit.blockingReasons).toHaveLength(0);
      expect(audit.alignment.statusBadge).toBe('Verified from Audio');
      expect(audit.rogersConsent?.legalDefensibilityGrade).toBe('A_Defensible');
    });
  });
});
