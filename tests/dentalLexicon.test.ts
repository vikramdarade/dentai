import { describe, it, expect } from 'vitest';
import { normalizeSpokenDentalText, DENTAL_PHONETIC_RULES } from '../src/lib/dentalPhoneticLexicon';

describe('Dental Phonetic Lexicon & Speech Normalizer', () => {
  it('corrects diverse accent tooth numbering ("dirty tree" -> tooth 33, "one six" -> tooth 16)', () => {
    expect(normalizeSpokenDentalText('Patient has pain in tooth dirty tree')).toBe('Patient has pain in tooth 33');
    expect(normalizeSpokenDentalText('We need a crown on one six')).toBe('We need a crown on tooth 16');
    expect(normalizeSpokenDentalText('Check pocket depth on four seven')).toBe('Check pocket depth on tooth 47');
    expect(normalizeSpokenDentalText('Incisal chip on two one')).toBe('Incisal chip on tooth 21');
  });

  it('corrects anatomical surfaces ("distal buckle" -> distobuccal)', () => {
    expect(normalizeSpokenDentalText('Fracture on the distal buckle cusp')).toBe('Fracture on the distobuccal cusp');
    expect(normalizeSpokenDentalText('Caries on me zeal occlusal margin')).toBe('Caries on mesio-occlusal margin');
  });

  it('corrects clinical pathology homophones ("pulp it is", "route canal", "tree two tree")', () => {
    expect(normalizeSpokenDentalText('Diagnosis of pulp it is')).toBe('Diagnosis of pulpitis');
    expect(normalizeSpokenDentalText('Started root can all today')).toBe('Started root canal today');
    expect(normalizeSpokenDentalText('Pocket depths are tree two tree')).toBe('Pocket depths are 3-2-3 mm');
  });

  it('corrects dental materials and anaesthetics ("light no cane", "rubber damn")', () => {
    expect(normalizeSpokenDentalText('LA given: 2.2mL light no cane')).toBe('LA given: 2.2mL lignocaine');
    expect(normalizeSpokenDentalText('Placed rubber damn on tooth 16')).toBe('Placed rubber dam on tooth 16');
    expect(normalizeSpokenDentalText('Placed leader mix dressing')).toBe('Placed Ledermix dressing');
  });

  it('corrects bruxism, occlusal wear, and nightguard terms ("brooks ism", "wear face its", "mass setter")', () => {
    expect(normalizeSpokenDentalText('Patient shows signs of brooks ism and clenching')).toBe('Patient shows signs of bruxism and clenching');
    expect(normalizeSpokenDentalText('Severe wear face its on anterior incisal edges')).toBe('Severe wear facets on anterior incisal edges');
    expect(normalizeSpokenDentalText('Palpation reveals tender mass setter and t m j clicking')).toBe('Palpation reveals tender masseter muscle and TMJ clicking');
    expect(normalizeSpokenDentalText('Prescribing an occlusal split for night time')).toBe('Prescribing an occlusal splint for night time');
    expect(normalizeSpokenDentalText('Take digital scan for knight guard item nine six five')).toBe('Take digital scan for occlusal splint (nightguard) ADA item 965 (occlusal splint)');
  });

  it('gracefully handles empty, non-string, or clean clinical inputs', () => {
    expect(normalizeSpokenDentalText('')).toBe('');
    expect(normalizeSpokenDentalText('Sound enamel on tooth 16')).toBe('Sound enamel on tooth 16');
  });
});
