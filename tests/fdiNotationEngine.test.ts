import { describe, it, expect } from 'vitest';
import {
  isValidFdiTooth,
  getToothMetadata,
  parseAndValidateSurfaces,
  disambiguateSpokenTooth,
  PERMANENT_FDI_TEETH,
  DECIDUOUS_FDI_TEETH
} from '../src/lib/fdiNotationEngine';

describe('ISO 3950 / FDI Dental Notation Engine', () => {
  describe('Tooth Number Validation & Boundaries', () => {
    it('validates permanent dentition (ISO 3950: 11-48)', () => {
      expect(PERMANENT_FDI_TEETH.size).toBe(32);
      expect(isValidFdiTooth(11)).toBe(true);
      expect(isValidFdiTooth(18)).toBe(true);
      expect(isValidFdiTooth(24)).toBe(true);
      expect(isValidFdiTooth(36)).toBe(true);
      expect(isValidFdiTooth(47)).toBe(true);

      // Invalid permanent teeth
      expect(isValidFdiTooth(19)).toBe(false);
      expect(isValidFdiTooth(29)).toBe(false);
      expect(isValidFdiTooth(39)).toBe(false);
      expect(isValidFdiTooth(49)).toBe(false);
      expect(isValidFdiTooth(10)).toBe(false);
      expect(isValidFdiTooth(99)).toBe(false);
    });

    it('validates deciduous dentition (ISO 3950: 51-85)', () => {
      expect(DECIDUOUS_FDI_TEETH.size).toBe(20);
      expect(isValidFdiTooth(51)).toBe(true);
      expect(isValidFdiTooth(55)).toBe(true);
      expect(isValidFdiTooth(64)).toBe(true);
      expect(isValidFdiTooth(73)).toBe(true);
      expect(isValidFdiTooth(85)).toBe(true);

      // Deciduous quadrants only have positions 1-5 (no premolars or 3rd molars)
      expect(isValidFdiTooth(56)).toBe(false);
      expect(isValidFdiTooth(67)).toBe(false);
      expect(isValidFdiTooth(78)).toBe(false);
      expect(isValidFdiTooth(86)).toBe(false);
    });

    it('returns rich clinical metadata for valid FDI teeth', () => {
      const t16 = getToothMetadata(16);
      expect(t16.fdi).toBe(16);
      expect(t16.dentition).toBe('permanent');
      expect(t16.jaw).toBe('maxillary');
      expect(t16.side).toBe('right');
      expect(t16.isPosterior).toBe(true);
      expect(t16.isAnterior).toBe(false);
      expect(t16.name).toContain('Upper Right');
      expect(t16.name).toContain('First Molar');

      const t21 = getToothMetadata(21);
      expect(t21.fdi).toBe(21);
      expect(t21.dentition).toBe('permanent');
      expect(t21.jaw).toBe('maxillary');
      expect(t21.side).toBe('left');
      expect(t21.isAnterior).toBe(true);
      expect(t21.isPosterior).toBe(false);
      expect(t21.name).toContain('Upper Left');
      expect(t21.name).toContain('Central Incisor');

      const t74 = getToothMetadata(74);
      expect(t74.fdi).toBe(74);
      expect(t74.dentition).toBe('deciduous');
      expect(t74.jaw).toBe('mandibular');
      expect(t74.side).toBe('left');
      expect(t74.name).toContain('Lower Left Primary Primary First Molar');
    });

    it('throws descriptive error on invalid tooth input in getToothMetadata', () => {
      expect(() => getToothMetadata(99)).toThrow(/Invalid FDI tooth number/);
    });
  });

  describe('Anatomical Surface Matrix & Conflict Detection', () => {
    it('validates posterior multi-surface combinations (MOD, DO, MO, B, O)', () => {
      const res = parseAndValidateSurfaces(16, 'MOD');
      expect(res.isValid).toBe(true);
      expect(res.tooth).toBe(16);
      expect(res.surfaceCount).toBe(3);
      expect(res.canonicalSurfaceString).toBe('MOD');
      expect(res.errors).toHaveLength(0);

      const resArray = parseAndValidateSurfaces(46, ['mesial', 'occlusal']);
      expect(resArray.isValid).toBe(true);
      expect(resArray.surfaceCount).toBe(2);
      expect(resArray.canonicalSurfaceString).toBe('MO');
    });

    it('rejects Incisal (I) on posterior teeth', () => {
      const res = parseAndValidateSurfaces(16, 'MID');
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors[0]).toContain('posterior tooth');
      expect(res.errors[0]).toContain('does not have an incisal edge');
    });

    it('validates anterior restorations with incisal edge (MID, MI, DI, I)', () => {
      const res = parseAndValidateSurfaces(11, 'MID');
      expect(res.isValid).toBe(true);
      expect(res.tooth).toBe(11);
      expect(res.surfaceCount).toBe(3);
      expect(res.canonicalSurfaceString).toBe('MID');
      expect(res.errors).toHaveLength(0);
    });

    it('rejects Occlusal (O) on anterior teeth', () => {
      const res = parseAndValidateSurfaces(11, 'MOD');
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors[0]).toContain('anterior tooth');
      expect(res.errors[0]).toContain('does not have an occlusal surface');
    });
  });

  describe('Spoken Phonetics & Natural Language Disambiguation', () => {
    it('disambiguates "tooth one six" to FDI 16', () => {
      const res = disambiguateSpokenTooth('tooth one six');
      expect(res.teeth).toEqual([16]);
      expect(res.confidence).toBeGreaterThan(0.9);
      expect(res.ambiguous).toBe(false);
    });

    it('disambiguates multiple teeth in sentence ("one six and one seven")', () => {
      const res = disambiguateSpokenTooth('teeth 16 and 17');
      expect(res.teeth).toEqual([16, 17]);
    });

    it('disambiguates cardinal "tooth sixteen" to FDI 16', () => {
      const res = disambiguateSpokenTooth('tooth sixteen');
      expect(res.teeth).toEqual([16]);
      expect(res.confidence).toBeGreaterThan(0.8);
    });

    it('disambiguates accent "dirty tree" to FDI 33', () => {
      const res = disambiguateSpokenTooth('pain in dirty tree');
      expect(res.teeth).toEqual([33]);
    });

    it('flags ambiguous comma-separated single digits ("teeth one, six")', () => {
      const res = disambiguateSpokenTooth('teeth one, six');
      expect(res.ambiguous).toBe(true);
      expect(res.ambiguityReason).toBeDefined();
      expect(res.clarificationPrompt).toBeDefined();
    });
  });
});
