import { describe, it, expect } from 'vitest';
import { normalizeTemplateOutput, normalizedToPayload } from '../src/lib/normalizeNoteOutput';
import { getTemplateById } from '../src/lib/dentalLibrary';
import { buildTreatmentQuoteData, lookupAdaFee } from '../src/lib/adaFees';
import {
  detectVisualCaseCategory,
  getVisualCasePresentation,
  VISUAL_CASE_PREVIEWS
} from '../src/lib/visualCaseLibrary';

describe('Chairside Deliverables Suite ("Eliminating CoTreat")', () => {
  const standardTemplate = getTemplateById('standard');

  it('normalizes specialist referral, patient consent, and treatment quote from raw model output', () => {
    const rawAiOutput = {
      chiefComplaint: 'Severe throbbing pain in tooth 16 for 3 days',
      history: 'Pain radiates to temple, worse with hot foods, no swelling',
      toothFindings: 'Tooth 16 has deep MOD restoration with lingual cusp fracture and caries',
      findingsGingival: 'Normal gingival architecture, probing depths 2-3mm',
      diagnosis: 'Tooth 16 symptomatic irreversible pulpitis with symptomatic apical periodontitis',
      treatmentPerformed: 'Pulp extirpation under rubber dam on tooth 16, Ledermix placed, Cavit seal',
      recommendations: 'Complete root canal therapy and full ceramic crown on tooth 16',
      recallRequirements: 'Next Available (Urgent)',
      patientSummary: 'Today we treated tooth 16 to relieve severe pain by starting a root canal procedure.',
      adaCodes: '414 - Pulp extirpation (Tooth 16), 022 - Intraoral periapical radiograph (Tooth 16)',
      specialistReferral: {
        required: true,
        specialty: 'Endodontics',
        specialistName: 'Dr. John Smith',
        recipientClinic: 'Sydney Endodontic Specialists',
        teethInvolved: ['16'],
        urgency: 'Urgent',
        clinicalQuestion: 'Endodontic evaluation and completion of root canal therapy on tooth 16',
        backgroundAndFindings: 'Severe pain to heat, lingered response >20s, TTP positive, pulp extirpated',
        provisionalDiagnosis: 'Symptomatic irreversible pulpitis 16',
        interimTreatmentProvided: 'Extirpation, Ledermix dressing, Cavit seal',
        letterText: 'Dear Dr. Smith,\n\nRe: Tooth 16 referral for endodontic therapy...'
      },
      patientConsent: {
        plainSummary: 'Today we treated tooth 16 to relieve severe pain by starting a root canal procedure.',
        optionsDiscussed: [
          { optionName: 'Root Canal Therapy & Crown', benefits: 'Saves natural tooth, relieves infection', risks: 'Re-infection risk <5%, requires crown' },
          { optionName: 'Extraction', benefits: 'Low cost', risks: 'Permanent tooth loss, requires implant or bridge' }
        ],
        risksOfNoTreatment: 'Severe abscess formation and facial swelling.',
        postOpCareInstructions: 'Do not chew on right side until numbness resolves.',
        redFlagsWarning: 'Call practice if severe swelling or fever occurs.'
      }
    };

    const normalized = normalizeTemplateOutput(standardTemplate, rawAiOutput);

    // Verify canonical fields
    expect(normalized.chiefComplaint).toBe('Severe throbbing pain in tooth 16 for 3 days');
    expect(normalized.diagnosis).toContain('Tooth 16 symptomatic irreversible pulpitis');

    // Verify specialist referral
    expect(normalized.specialistReferral).toBeDefined();
    expect(normalized.specialistReferral?.required).toBe(true);
    expect(normalized.specialistReferral?.specialty).toBe('Endodontics');
    expect(normalized.specialistReferral?.teethInvolved).toEqual(['16']);
    expect(normalized.specialistReferral?.letterText).toContain('Dear Dr. Smith');

    // Verify patient consent
    expect(normalized.patientConsent).toBeDefined();
    expect(normalized.patientConsent?.optionsDiscussed).toHaveLength(2);
    expect(normalized.patientConsent?.risksOfNoTreatment).toContain('Severe abscess formation');

    // Verify treatment quote auto-derivation
    expect(normalized.treatmentQuote).toBeDefined();
    expect(normalized.treatmentQuote?.items.length).toBeGreaterThanOrEqual(1);
    expect(normalized.treatmentQuote?.totalFee).toBeGreaterThan(0);
    expect(normalized.treatmentQuote?.netGap).toBeGreaterThanOrEqual(0);
  });

  it('correctly maps normalized output into GeneratedNotePayload for persistence', () => {
    const rawAiOutput = {
      chiefComplaint: 'Broken tooth 46',
      patientSummary: 'Evaluated cracked molar tooth 46.',
      adaCodes: '611 - Full Crown (Tooth 46)'
    };

    const normalized = normalizeTemplateOutput(standardTemplate, rawAiOutput);
    const payload = normalizedToPayload(standardTemplate, normalized);

    expect(payload.patientSummary).toBe('Evaluated cracked molar tooth 46.');
    expect(payload.adaCodes).toHaveLength(1);
    expect(payload.treatmentQuote).toBeDefined();
    expect(payload.treatmentQuote?.totalFee).toBe(1650); // ADA 611 standard fee
    expect(payload.treatmentQuote?.visualCaseCategory).toBe('crown');
  });

  it('detects visual case categories accurately across all high-value dental procedures', () => {
    expect(detectVisualCaseCategory([{ code: '611' }], 'Crown on tooth 16')).toBe('crown');
    expect(detectVisualCaseCategory([{ code: '688' }], 'Single dental implant fixture site 36')).toBe('implant');
    expect(detectVisualCaseCategory([{ code: '415' }], 'Root canal chemo-mechanical prep')).toBe('endo');
    expect(detectVisualCaseCategory([{ code: '582' }], 'Porcelain veneers anterior smile design')).toBe('veneer');
    expect(detectVisualCaseCategory([{ code: '825' }], 'Clear aligner sequential trays')).toBe('aligner');
    expect(detectVisualCaseCategory([{ code: '222' }], 'Deep periodontal debridement 6mm pockets')).toBe('perio');
    expect(detectVisualCaseCategory([{ code: '011' }], 'Routine clean and fluoride')).toBe('general');
  });

  it('provides rich 3-stage visual progression with valid SVG illustrations for patient decks', () => {
    const categories = ['crown', 'implant', 'endo', 'veneer', 'aligner', 'perio', 'general'] as const;

    for (const cat of categories) {
      const visualPack = getVisualCasePresentation(cat);
      expect(visualPack.treatmentName).toBeTruthy();
      expect(visualPack.tagline).toBeTruthy();
      expect(visualPack.stages).toHaveLength(3);

      for (const stage of visualPack.stages) {
        expect(stage.title).toBeTruthy();
        expect(stage.description).toBeTruthy();
        expect(stage.illustrationSvg).toContain('<svg');
        expect(stage.illustrationSvg).toContain('</svg>');
      }
    }
  });

  it('calculates private health fund rebates and phased milestones in buildTreatmentQuoteData', () => {
    const quote = buildTreatmentQuoteData(
      [
        { code: '414', description: 'Pulp Extirpation', tooth: '16' },
        { code: '611', description: 'Full Ceramic Crown', tooth: '16' },
        { code: '011', description: 'Comprehensive Exam' }
      ],
      [],
      'Root canal and crown needed on tooth 16'
    );

    expect(quote.items.length).toBe(3);
    expect(quote.totalFee).toBe(320 + 1650 + 75);
    expect(quote.estimatedRebate).toBeGreaterThan(0);
    expect(quote.netGap).toBe(quote.totalFee - quote.estimatedRebate);
    expect(quote.phasedMilestones).toBeDefined();
    expect(quote.phasedMilestones?.length).toBeGreaterThanOrEqual(2);
    expect(quote.phasedMilestones?.[0].phaseTitle).toContain('Phase 1: Urgent Relief');
  });

  it('verifies telegraphic tooth-by-tooth ledger and AHPRA informed consent formatting', () => {
    const rawAiOutput = {
      toothFindings: [
        '#16 (MOD): DB cusp fracture & recurrent secondary caries | Cold (+ lingered >15s), TTP (+), EPT 62/80 | Rec: Full ceramic crown (ADA 611)',
        '#24 (MO): Primary carious lesion into mid-dentin | Cold (+ normal), TTP (-) | Rec: 2-surface composite resin (ADA 532)',
        '#36: Defective occlusal margin on existing amalgam | Asymptomatic | Rec: Monitor at recall',
        'Remaining Dentition: Sound enamel, stable existing restorations, no active caries detected.'
      ].join('\n'),
      recommendations: [
        '1. Tooth 16: Complete RCT step 2 and full ceramic crown.',
        '2. Tooth 24: 2-surface composite resin restoration.',
        'Informed Consent: Discussed diagnosis, procedural stages, risks (post-op sensitivity, restoration failure), alternative options (extraction), and itemized ADA schedule fees. Patient understood and provided informed consent to proceed.'
      ].join('\n')
    };

    const normalized = normalizeTemplateOutput(standardTemplate, rawAiOutput);
    expect(normalized.toothFindings).toContain('#16 (MOD): DB cusp fracture');
    expect(normalized.toothFindings).toContain('#24 (MO): Primary carious lesion');
    expect(normalized.toothFindings).toContain('#36: Defective occlusal margin');
    expect(normalized.recommendations).toContain('Informed Consent: Discussed diagnosis');
  });

  it('supports practice_fees_only rebateMode for quote presentation to prevent misleading health fund limit estimates', () => {
    const quote = buildTreatmentQuoteData(
      [{ code: '611', description: 'Full ceramic crown', tooth: '16' }],
      [],
      'tooth 16 crown required'
    );
    quote.rebateMode = 'practice_fees_only';

    expect(quote.rebateMode).toBe('practice_fees_only');
    expect(quote.items[0].adaCode).toBe('611');
    expect(quote.items[0].fee).toBeGreaterThan(0);
    // When practice_fees_only is chosen, the practice fee is emphasized without false gap promises
    expect(quote.totalFee).toBe(quote.items[0].fee);
  });
});


