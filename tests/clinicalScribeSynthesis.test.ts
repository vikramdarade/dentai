import { describe, it, expect } from 'vitest';
import { getTemplateById } from '../src/lib/dentalLibrary';
import {
  generateOfflineDraft,
  isCompletedTreatmentSentence,
  isPreventativeCounselingSentence,
  cleanSentenceForNote,
  NON_CLINICAL_COMMERCIAL_RE
} from '../src/lib/draftEngine';
import { TranscriptItem } from '../src/types';

describe('Clinical Scribe Synthesis Engine (Spec Phase 1 - 5)', () => {
  describe('Unit Primitives: Commercial Squelch & Intent Classifiers', () => {
    it('T1-Primitive: NON_CLINICAL_COMMERCIAL_RE squelches ambient commercial and broadcast audio', () => {
      const radioAd = "Chloe loves the sound of earning and saving money on Vintage. Don't wear it, sell it.";
      expect(NON_CLINICAL_COMMERCIAL_RE.test(radioAd)).toBe(true);

      const podcastAd = "This episode is brought to you by our special sponsor. Don't wear it sell it.";
      expect(NON_CLINICAL_COMMERCIAL_RE.test(podcastAd)).toBe(true);

      const footyAd = "Footy finals are here on radio. Save money on vintage clothes.";
      expect(NON_CLINICAL_COMMERCIAL_RE.test(footyAd)).toBe(true);

      // Must NOT match legitimate clinical statements containing 'wear' or 'save'
      const clinicalWear = 'Severe occlusal wear facets observed on teeth 16 and 46.';
      expect(NON_CLINICAL_COMMERCIAL_RE.test(clinicalWear)).toBe(false);

      const clinicalSave = 'We will try to save the tooth with root canal treatment.';
      expect(NON_CLINICAL_COMMERCIAL_RE.test(clinicalSave)).toBe(false);
    });

    it('T2-Primitive: isCompletedTreatmentSentence strictly rejects inquiries and requires completed action verbs', () => {
      // Inquiries & prospective questions MUST be rejected (false)
      expect(isCompletedTreatmentSentence("I was going to ask you about whitening my teeth")).toBe(false);
      expect(isCompletedTreatmentSentence("Can we do whitening today?")).toBe(false);
      expect(isCompletedTreatmentSentence("Could you look into extracting my wisdom tooth?")).toBe(false);
      expect(isCompletedTreatmentSentence("I was thinking about getting braces or aligners")).toBe(false);
      expect(isCompletedTreatmentSentence("What about a crown on that molar?")).toBe(false);
      expect(isCompletedTreatmentSentence("I wanted to ask if this needs a filling")).toBe(false);

      // Declarative executed procedures MUST be accepted (true)
      expect(isCompletedTreatmentSentence("Composite resin restoration placed on tooth 36 MO today")).toBe(true);
      expect(isCompletedTreatmentSentence("Access opening completed today under rubber dam")).toBe(true);
      expect(isCompletedTreatmentSentence("Tooth 48 extracted with forceps and elevator")).toBe(true);
      expect(isCompletedTreatmentSentence("Full mouth supragingival and subgingival scale and clean performed")).toBe(true);
      expect(isCompletedTreatmentSentence("Pulpotomy performed and MTA dressing applied")).toBe(true);
    });

    it('T3-Primitive: cleanSentenceForNote strips conversational filler openers cleanly', () => {
      expect(cleanSentenceForNote("I mean, I don't even think of them as cigars")).toBe("I don't even think of them as cigars");
      expect(cleanSentenceForNote("Look, I've had some bleeding when brushing")).toBe("I've had some bleeding when brushing");
      expect(cleanSentenceForNote("To be honest, it really hurts when I drink cold water")).toBe("It really hurts when I drink cold water");
      expect(cleanSentenceForNote("You know, I've noticed my gums bleeding")).toBe("I've noticed my gums bleeding");
      expect(cleanSentenceForNote("Like I said, the pain started two days ago")).toBe("The pain started two days ago");
    });

    it('T5-Primitive: isPreventativeCounselingSentence identifies dietary and lifestyle counseling', () => {
      expect(isPreventativeCounselingSentence("Try to limit that soft drink to lunchtime rather than sipping it all afternoon")).toBe(true);
      expect(isPreventativeCounselingSentence("Smoking cigarillos increases the risk of oral mucosal changes")).toBe(true);
      expect(isPreventativeCounselingSentence("Use an interdental brush once daily before brushing")).toBe(true);
      expect(isPreventativeCounselingSentence("Composite restoration placed on 16")).toBe(false);
    });
  });

  describe('End-to-End Draft Generation: Audio Audit Validation', () => {
    it('T1: Commercial radio ads are omitted completely from all note sections', () => {
      const template = getTemplateById('standard');
      const transcript: TranscriptItem[] = [
        { sender: 'Dialogue', text: "Chloe loves the sound of earning and saving money on Vintage. Don't wear it, sell it." },
        { sender: 'Patient', text: "I have noticed a dull ache in my lower jaw when eating." },
        { sender: 'Dentist', text: "Caries identified on tooth 36 requiring composite restoration." }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Comprehensive Examination');

      // The commercial ad must NEVER appear in any section
      for (const [key, value] of Object.entries(draft.canonical)) {
        expect(value).not.toMatch(/vintage/i);
        expect(value).not.toMatch(/don'?t wear it/i);
        expect(value).not.toMatch(/earning and saving/i);
        expect(value).not.toMatch(/chloe/i);
      }
      for (const [key, value] of Object.entries(draft.customSections)) {
        expect(value).not.toMatch(/vintage/i);
        expect(value).not.toMatch(/don'?t wear it/i);
      }

      // Legitimate clinical findings are preserved
      expect(draft.canonical.chiefComplaint).toContain('ache');
      expect(draft.canonical.toothFindings).toContain('36');
    });

    it('T2: Casual whitening inquiries are routed to subjective complaint and excluded from treatmentPerformed', () => {
      const template = getTemplateById('standard');
      const transcript: TranscriptItem[] = [
        { sender: 'Patient', text: "I was going to ask you about whitening my teeth because I've noticed that they have more stains on them." },
        { sender: 'Dentist', text: "We found generalised plaque along the gingival margin." }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Comprehensive Examination');

      // Must NOT be logged as treatment performed today (Whitening was not performed!)
      const treatment = draft.canonical.treatmentPerformed ?? '';
      expect(treatment.toLowerCase()).not.toContain('whitening');
      expect(treatment.toLowerCase()).not.toContain('stains');

      // Must NOT be logged under periodontal/gingival pathology (stains are not gingival disease)
      const gingival = draft.canonical.findingsGingival ?? '';
      expect(gingival.toLowerCase()).not.toContain('whitening');

      // Must be captured under patient's subjective complaint
      const complaint = draft.canonical.chiefComplaint ?? '';
      expect(complaint.toLowerCase()).toContain('whitening');
    });

    it('T3: Clinician diagnosis of nicotinic stomatitis is captured; patient banter is excluded', () => {
      const template = getTemplateById('standard');
      const transcript: TranscriptItem[] = [
        { sender: 'Dentist', text: "Because I'm seeing some irritation in your mouth, in the palate. That's called nicotinic stomatitis." },
        { sender: 'Patient', text: "I mean, I don't even think of them as cigars, they're just little cigarillos." },
        { sender: 'Dentist', text: "Try to cut down on the smoking because it causes those changes on the roof of the mouth." }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Comprehensive Examination');

      // Clinician diagnosis of nicotinic stomatitis must be captured
      const diagnosis = draft.canonical.diagnosis ?? '';
      expect(diagnosis.toLowerCase()).toContain('nicotinic stomatitis');

      // Patient casual disclaimer must NOT masquerade as the diagnosis
      expect(diagnosis.toLowerCase()).not.toContain("don't even think");
      expect(diagnosis.toLowerCase()).not.toContain("certainly not");

      // Palatal mucosal findings captured in soft tissue / gingival section
      const gingival = draft.canonical.findingsGingival ?? '';
      expect(gingival.toLowerCase()).toContain('palate');

      // Smoking counseling captured in recommendations
      const recs = draft.canonical.recommendations ?? '';
      expect(recs.toLowerCase()).toMatch(/smoking|cigarillo/);
    });

    it('T4: Single-Ownership: Patient inquiry is isolated to subjective and not duplicated across 3 sections', () => {
      const template = getTemplateById('standard');
      const transcript: TranscriptItem[] = [
        { sender: 'Patient', text: "I was going to ask you about whitening my teeth because I've noticed that they have more stains on them." },
        { sender: 'Dentist', text: "Examination completed today, teeth are sound." }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Comprehensive Examination');

      // Count sections containing the inquiry
      let occurrences = 0;
      const allSections = { ...draft.canonical, ...draft.customSections };
      for (const [key, text] of Object.entries(allSections)) {
        if (text && text.toLowerCase().includes('whitening')) {
          occurrences++;
        }
      }

      // In the audio bug it appeared in 3 sections (treatmentPerformed, toothFindings, findingsGingival).
      // Now it must appear in AT MOST 1 section (chiefComplaint).
      expect(occurrences).toBe(1);
      expect(draft.canonical.chiefComplaint?.toLowerCase()).toContain('whitening');
      expect(draft.canonical.treatmentPerformed ?? '').not.toContain('whitening');
      expect(draft.canonical.toothFindings ?? '').not.toContain('whitening');
      expect(draft.canonical.findingsGingival ?? '').not.toContain('whitening');
    });

    it('T5: Preventative dietary counseling routes to recommendations and is barred from tooth findings', () => {
      const template = getTemplateById('standard');
      const transcript: TranscriptItem[] = [
        { sender: 'Patient', text: "I drink quite a lot of Coke during the day." },
        { sender: 'Dentist', text: "Try to limit that soft drink to lunchtime rather than sipping it all afternoon." },
        { sender: 'Dentist', text: "No cavitated carious lesions detected on the molar teeth." }
      ];

      const draft = generateOfflineDraft(template, transcript, 'Comprehensive Examination');

      // Soft drink counseling MUST be captured under recommendations
      const recs = draft.canonical.recommendations ?? '';
      expect(recs.toLowerCase()).toContain('soft drink');

      // Soft drink counseling MUST NOT pollute tooth findings (hard tissue)
      const toothFindings = draft.canonical.toothFindings ?? '';
      expect(toothFindings.toLowerCase()).not.toContain('soft drink');
      expect(toothFindings.toLowerCase()).not.toContain('lunchtime');
    });
  });
});
