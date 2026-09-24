import { describe, it, expect } from 'vitest';
import {
  calculateRestorativeItemCode,
  matchProcedureToAdaCode,
  ADA_STANDARD_PROCEDURES
} from '../src/lib/adaScheduleEngine';

describe('ADA Item Code Mapping & Multi-Surface Restorative Engine', () => {
  describe('Posterior Multi-Surface Restorative Calculator (Items 531-535)', () => {
    it('calculates Item 531 for 1-surface posterior composite (tooth 16 O)', () => {
      const res = calculateRestorativeItemCode(16, 'O');
      expect(res.itemCode).toBe('531');
      expect(res.surfaceCount).toBe(1);
      expect(res.category).toBe('Restorative');
      expect(res.validationErrors).toHaveLength(0);
    });

    it('calculates Item 532 for 2-surface posterior composite (tooth 16 MO)', () => {
      const res = calculateRestorativeItemCode(16, 'MO');
      expect(res.itemCode).toBe('532');
      expect(res.surfaceCount).toBe(2);
    });

    it('calculates Item 533 for 3-surface posterior composite (tooth 16 MOD)', () => {
      const res = calculateRestorativeItemCode(16, 'MOD');
      expect(res.itemCode).toBe('533');
      expect(res.surfaceCount).toBe(3);
      expect(res.surfaces).toEqual(['M', 'O', 'D']);
    });

    it('calculates Item 534 for 4-surface posterior composite (tooth 46 MODB)', () => {
      const res = calculateRestorativeItemCode(46, 'MODB');
      expect(res.itemCode).toBe('534');
      expect(res.surfaceCount).toBe(4);
    });

    it('calculates Item 535 for 5-surface posterior composite (tooth 46 MODBL)', () => {
      const res = calculateRestorativeItemCode(46, 'MODBL');
      expect(res.itemCode).toBe('535');
      expect(res.surfaceCount).toBe(5);
    });

    it('calculates Item 513 for 3-surface posterior amalgam (tooth 46 MOD)', () => {
      const res = calculateRestorativeItemCode(46, 'MOD', 'amalgam');
      expect(res.itemCode).toBe('513');
      expect(res.surfaceCount).toBe(3);
      expect(res.itemName).toContain('Posterior Metallic Restoration');
    });
  });

  describe('Anterior Multi-Surface Restorative Calculator (Items 521-525)', () => {
    it('calculates Item 521 for 1-surface anterior composite (tooth 11 M)', () => {
      const res = calculateRestorativeItemCode(11, 'M');
      expect(res.itemCode).toBe('521');
      expect(res.surfaceCount).toBe(1);
    });

    it('calculates Item 522 for 2-surface anterior composite (tooth 11 MI)', () => {
      const res = calculateRestorativeItemCode(11, 'MI');
      expect(res.itemCode).toBe('522');
      expect(res.surfaceCount).toBe(2);
    });

    it('calculates Item 523 for 3-surface anterior composite (tooth 21 MID)', () => {
      const res = calculateRestorativeItemCode(21, 'MID');
      expect(res.itemCode).toBe('523');
      expect(res.surfaceCount).toBe(3);
    });

    it('calculates Item 524 for 4-surface anterior composite (tooth 21 MIDB)', () => {
      const res = calculateRestorativeItemCode(21, 'MIDB');
      expect(res.itemCode).toBe('524');
      expect(res.surfaceCount).toBe(4);
    });
  });

  describe('Clinical Surface Conflict & Boundary Rejection', () => {
    it('rejects occlusal surface on anterior tooth 11 (e.g. 11 MOD)', () => {
      const res = calculateRestorativeItemCode(11, 'MOD');
      expect(res.itemCode).toBe('599');
      expect(res.validationErrors?.length).toBeGreaterThan(0);
      expect(res.validationErrors?.[0]).toContain('anterior tooth');
    });

    it('rejects incisal surface on posterior tooth 16 (e.g. 16 MID)', () => {
      const res = calculateRestorativeItemCode(16, 'MID');
      expect(res.itemCode).toBe('599');
      expect(res.validationErrors?.length).toBeGreaterThan(0);
      expect(res.validationErrors?.[0]).toContain('posterior tooth');
    });
  });

  describe('Free-Text Procedure Matching to ADA Codes', () => {
    it('matches "tooth 16 MOD composite" to ADA Item 533', () => {
      const res = matchProcedureToAdaCode('tooth 16 MOD composite');
      expect(res).not.toBeNull();
      expect(res?.itemCode).toBe('533');
      expect(res?.toothNumber).toBe(16);
    });

    it('matches "surgical extraction of wisdom tooth" to ADA Item 324', () => {
      const res = matchProcedureToAdaCode('surgical extraction of wisdom tooth with bone removal', 48);
      expect(res?.itemCode).toBe('324');
      expect(res?.category).toBe('Oral Surgery');
    });

    it('matches diagnostic exams and radiographs', () => {
      const exam = matchProcedureToAdaCode('comprehensive exam and clean');
      expect(exam?.itemCode).toBe('011');

      const bw = matchProcedureToAdaCode('took bitewing x-rays');
      expect(bw?.itemCode).toBe('026');

      const pa = matchProcedureToAdaCode('periapical x-ray of tooth 21', 21);
      expect(pa?.itemCode).toBe('022');
      expect(pa?.toothNumber).toBe(21);
    });
  });
});
