import { describe, it, expect } from 'vitest';
import { normalizeSpokenDentalText, DENTAL_PHONETIC_RULES } from '../src/lib/dentalPhoneticLexicon';

describe('Dental Phonetic Lexicon & Speech Normalizer', () => {
  it('corrects diverse accent tooth numbering ("dirty tree" -> tooth 33, "one six" -> tooth 16)', () => {
    expect(normalizeSpokenDentalText('Patient has pain in tooth dirty tree')).toBe('Patient has pain in tooth 33');
    expect(normalizeSpokenDentalText('We need a crown on one six')).toBe('We need a crown on tooth 16');
    expect(normalizeSpokenDentalText('Check pocket depth on four seven')).toBe('Check pocket depth on tooth 47');
    expect(normalizeSpokenDentalText('Incisal chip on two one')).toBe('Incisal chip on tooth 21');
  });

  it('corrects all 4 quadrants of FDI tooth numbers across digit pairs, cardinals, and spaced digits', () => {
    // Quadrant 1 (UR)
    expect(normalizeSpokenDentalText('Tooth one one central')).toBe('Tooth 11 central');
    expect(normalizeSpokenDentalText('Tooth 1 6 mesial')).toBe('Tooth 16 mesial');
    expect(normalizeSpokenDentalText('Tooth sixteen has a fracture')).toBe('Tooth 16 has a fracture');
    expect(normalizeSpokenDentalText('Upper right first molar')).toBe('tooth 16');

    // Quadrant 2 (UL)
    expect(normalizeSpokenDentalText('Restoration on two four')).toBe('Restoration on tooth 24');
    expect(normalizeSpokenDentalText('Tooth twenty-six MOD')).toBe('Tooth 26 MOD');
    expect(normalizeSpokenDentalText('Upper left central incisor')).toBe('tooth 21');

    // Quadrant 3 (LL)
    expect(normalizeSpokenDentalText('Pain in tooth thirty-six')).toBe('Pain in tooth 36');
    expect(normalizeSpokenDentalText('Lower left first molar')).toBe('tooth 36');

    // Quadrant 4 (LR)
    expect(normalizeSpokenDentalText('Caries on four six')).toBe('Caries on tooth 46');
    expect(normalizeSpokenDentalText('Tooth forty-seven')).toBe('Tooth 47');
    expect(normalizeSpokenDentalText('Lower right second molar')).toBe('tooth 47');
  });

  it('corrects anatomical surfaces ("distal buckle" -> distobuccal, "me zeal occlusal" -> mesio-occlusal)', () => {
    expect(normalizeSpokenDentalText('Fracture on the distal buckle cusp')).toBe('Fracture on the distobuccal cusp');
    expect(normalizeSpokenDentalText('Caries on me zeal occlusal margin')).toBe('Caries on mesio-occlusal margin');
    expect(normalizeSpokenDentalText('Defect on buckle surface')).toBe('Defect on buccal surface');
    expect(normalizeSpokenDentalText('Wear on the in size all edge')).toBe('Wear on the incisal edge');
    expect(normalizeSpokenDentalText('Cusp on palette all aspect')).toBe('Cusp on palatal aspect');
    expect(normalizeSpokenDentalText('Composite on M O D margin')).toBe('Composite on MOD margin');
  });

  it('corrects clinical pathology homophones ("pulp it is", "route canal", "tree two tree", "carries")', () => {
    expect(normalizeSpokenDentalText('Diagnosis of pulp it is')).toBe('Diagnosis of pulpitis');
    expect(normalizeSpokenDentalText('Started root can all today')).toBe('Started root canal today');
    expect(normalizeSpokenDentalText('Pocket depths are tree two tree')).toBe('Pocket depths are 3-2-3 mm');
    expect(normalizeSpokenDentalText('Recurrent carries on tooth 16')).toBe('Recurrent caries on tooth 16');
    expect(normalizeSpokenDentalText('Dental carries noted')).toBe('Dental caries noted');
    expect(normalizeSpokenDentalText('Active carries on occlusal surface')).toBe('Active caries on occlusal surface');
    expect(normalizeSpokenDentalText('Grade 2 vacation on tooth 46')).toBe('Grade 2 furcation on tooth 46');
    expect(normalizeSpokenDentalText('Severe sub gingival calculas')).toBe('Severe subgingival calculus');
  });

  it('corrects dental materials and anaesthetics ("light no cane", "rubber damn", "artie cane")', () => {
    expect(normalizeSpokenDentalText('LA given: 2.2mL light no cane')).toBe('LA given: 2.2mL lignocaine');
    expect(normalizeSpokenDentalText('Given 1 cartridge artie cane with one in one hundred thousand adrenaline')).toBe('Given 1 cartridge articaine with 1:100,000 adrenaline');
    expect(normalizeSpokenDentalText('Placed rubber damn on tooth 16')).toBe('Placed rubber dam on tooth 16');
    expect(normalizeSpokenDentalText('Placed damn clamp and leader mix')).toBe('Placed dam clamp and Ledermix');
    expect(normalizeSpokenDentalText('Restored with glass I honor and gutta perka')).toBe('Restored with GIC (glass ionomer) and gutta-percha');
    expect(normalizeSpokenDentalText('Liner die cal and cave it')).toBe('Liner Dycal and Cavit');
  });

  it('corrects acoustic mis-transcriptions of extraction phrases ("2000 out" / "to 2000" -> take the tooth out)', () => {
    expect(normalizeSpokenDentalText('The other option is to 2000 out')).toBe('The other option is to take the tooth out');
    expect(normalizeSpokenDentalText('Taking the 2000 will leave a gap')).toBe('Taking the tooth out will leave a gap');
    expect(normalizeSpokenDentalText('Even if you want to 2000 later')).toBe('Even if you want to take the tooth out later');
    expect(normalizeSpokenDentalText('If you like to 2000')).toBe('If you like to take the tooth out');
    expect(normalizeSpokenDentalText('Or we can 2000 out')).toBe('Or we can take the tooth out');
    expect(normalizeSpokenDentalText('Refer you to a specialist to 2000')).toBe('Refer you to a specialist to take the tooth out');
    // Financial / year values remain untouched
    expect(normalizeSpokenDentalText('The implant costs 2000 dollars')).toBe('The implant costs 2000 dollars');
    expect(normalizeSpokenDentalText('Patient was born in 2000')).toBe('Patient was born in 2000');
  });

  it('gracefully handles empty, non-string, or clean clinical inputs', () => {
    expect(normalizeSpokenDentalText('')).toBe('');
    expect(normalizeSpokenDentalText('Sound enamel on tooth 16')).toBe('Sound enamel on tooth 16');
  });
});
