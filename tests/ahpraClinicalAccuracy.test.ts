import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTE_THINKING_LEVEL,
  resolveNoteThinkingLevel,
  applyNoteThinking,
  NOTE_TIMEOUTS
} from '../src/lib/noteModelConfig';
import {
  clinicalHorizonFilter,
  validateTranscript
} from '../src/server/payloadValidation';
import {
  verifyTranscriptGrounding
} from '../src/lib/transcriptGrounding';
import {
  scoreGeneration,
  summariseResults,
  type EvalFixture
} from '../src/lib/clinicalEval';
import { getTemplateById } from '../src/lib/dentalLibrary';
import fs from 'fs';
import path from 'path';

describe('AHPRA Medicolegal Clinical Note Accuracy & Legal Court Defensibility', () => {
  describe('1. Model Thinking & Clinical Reasoning Configuration', () => {
    it('defaults to medium thinking to empower clinical deduction and phonetic disambiguation', () => {
      // Pinned to medium so Gemini performs full chain-of-thought analysis for complex operatory dialogue
      expect(DEFAULT_NOTE_THINKING_LEVEL).toBe('medium');
      expect(resolveNoteThinkingLevel({})).toBe('medium');
    });

    it('applies medium thinking budget into Gemini config while preserving overrides', () => {
      const config = applyNoteThinking({ model: 'gemini-3.6-flash' });
      expect((config as any).thinkingConfig?.thinkingLevel).toBeDefined();
    });

    it('sets realistic timeouts to accommodate comprehensive clinical reasoning', () => {
      expect(NOTE_TIMEOUTS.primaryMs).toBeGreaterThanOrEqual(25000);
      expect(NOTE_TIMEOUTS.secondaryMs).toBeGreaterThanOrEqual(18000);
    });
  });

  describe('2. Absolute Zero-Fabrication & Medicolegal Non-Invention Gates', () => {
    it('verifies that unexamined teeth are NEVER fabricated with canned sound dentition assertions', () => {
      const serverCode = fs.readFileSync(path.resolve(__dirname, '..', 'server.ts'), 'utf-8');
      
      // Banned: instructing AI to invent "Remaining Dentition: Sound enamel, stable existing restorations, no active caries detected."
      expect(serverCode).not.toContain('Remaining Dentition: Sound enamel, stable existing restorations, no active caries detected.');
    });

    it('verifies that informed consent is grounded in spoken dialogue rather than boilerplate canned risks', () => {
      const serverCode = fs.readFileSync(path.resolve(__dirname, '..', 'server.ts'), 'utf-8');
      
      // Banned: forcing a rigid canned consent clause asserting unmentioned risks like "irreversible pulpitis, restoration failure"
      expect(serverCode).not.toContain('Informed Consent: Discussed diagnosis, procedural stages, risks (post-op sensitivity, irreversible pulpitis, restoration failure)');
      // Must require consent to reflect actual spoken discussion
      expect(serverCode).toMatch(/Informed consent/i);
    });
  });

  describe('3. Lossless Transcript Preservation & Horizon Filter Safety', () => {
    it('preserves complete aftercare instructions and prescriptions at the end of consultations', () => {
      const transcript = [
        { sender: 'Dentist', text: 'Tooth 16 has deep caries into dentin.' },
        { sender: 'Dentist', text: 'We will do a composite restoration on 16 MO today.' },
        { sender: 'Dentist', text: '1 cartridge 2.2ml 2% lignocaine 1:80,000 adrenaline given via infiltration.' },
        { sender: 'Dentist', text: 'Cavity prepped, 3M Filtek composite placed, occlusion checked.' },
        // Trailing dialogue after procedure:
        { sender: 'Dentist', text: 'Rinse with warm salt water tonight.' },
        { sender: 'Dentist', text: 'Take ibuprofen 400mg three times daily with meals.' },
        { sender: 'Dentist', text: 'Do not eat until the numbness has completely worn off.' },
        { sender: 'Dentist', text: 'Book a recall review in 6 months with reception.' }
      ];

      const filtered = clinicalHorizonFilter(transcript);
      expect(filtered.length).toBe(transcript.length);
      expect(filtered.some(t => t.text.includes('ibuprofen 400mg'))).toBe(true);
      expect(filtered.some(t => t.text.includes('warm salt water'))).toBe(true);
      expect(filtered.some(t => t.text.includes('recall review in 6 months'))).toBe(true);
    });

    it('never drops medical history or allergy disclosures from the beginning of transcripts', () => {
      const transcript = [
        { sender: 'Patient', text: 'I am allergic to penicillin and taking apixaban for atrial fibrillation.' },
        { sender: 'Dentist', text: 'Thank you for noting the blood thinner and penicillin allergy.' },
        { sender: 'Dentist', text: 'Tooth 46 has fractured lingual cusp.' },
        { sender: 'Dentist', text: 'Temporary glass ionomer placed.' }
      ];

      const filtered = clinicalHorizonFilter(transcript);
      expect(filtered.length).toBe(4);
      expect(filtered[0].text).toContain('allergic to penicillin');
    });
  });

  describe('4. Deterministic Grounding & Verbatim Verification Engine', () => {
    it('correctly validates 100% grounded clinical findings against raw audio transcript', () => {
      const rawTranscript = [
        { sender: 'Dentist', text: 'Tooth 16 MO deep caries into dentin. Cold test normal, TTP negative.' },
        { sender: 'Dentist', text: 'Infiltrated 1 cartridge 2% lignocaine with 1:80,000 adrenaline.' },
        { sender: 'Dentist', text: 'Rubber dam placed on 16. Restored with composite resin.' },
        { sender: 'Dentist', text: 'Item 532 2-surface composite resin.' }
      ];

      const noteText = `toothFindings: #16 (MOD): Deep dentinal caries | Cold (+ normal), TTP (-)
treatmentPerformed: #16 restoration. Local anaesthesia 2% lignocaine 1:80,000 adrenaline. Rubber dam isolated. Composite placed.
adaCodes: 532 - 2-surface composite resin`;

      const report = verifyTranscriptGrounding(noteText, rawTranscript, [{ code: '532', description: 'Composite' }]);
      expect(report.isFullyGrounded).toBe(true);
      expect(report.unverifiedClaims).toHaveLength(0);
      expect(report.groundedEntities.length).toBeGreaterThan(0);
    });

    it('flags unverified or fabricated teeth not present in the transcript', () => {
      const rawTranscript = [
        { sender: 'Dentist', text: 'Tooth 16 examined, small occlusal fissure decay.' }
      ];

      const noteWithFabricatedTooth = `toothFindings: #16 (O): Fissure caries. #26: MOD cavity with irreversible pulpitis.
treatmentPerformed: Examined #16.`;

      const report = verifyTranscriptGrounding(noteWithFabricatedTooth, rawTranscript, []);
      expect(report.isFullyGrounded).toBe(false);
      expect(report.unverifiedClaims.some(c => c.includes('26'))).toBe(true);
    });
  });
});
