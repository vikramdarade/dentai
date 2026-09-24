import { describe, it, expect } from 'vitest';
import {
  scanPharmacologySafety,
  calculateLocalAnaestheticSafety,
  LA_FORMULATIONS
} from '../src/lib/pharmacologySafetyEngine';

describe('High-Risk Pharmacology & Local Anaesthetic Safety Engine', () => {
  describe('Antiresorptive & MRONJ Risk Interceptor', () => {
    it('triggers critical MRONJ alert when surgical extraction planned for patient on Prolia / Denosumab', () => {
      const notes = 'Patient reports taking Prolia injections for osteoporosis. Plan for surgical extraction of tooth 48.';
      const alerts = scanPharmacologySafety(notes, 'surgical');

      expect(alerts.length).toBeGreaterThan(0);
      const mronjAlert = alerts.find(a => a.category === 'MRONJ');
      expect(mronjAlert).toBeDefined();
      expect(mronjAlert?.severity).toBe('critical');
      expect(mronjAlert?.title).toContain('Critical Alert: High MRONJ Risk');
      expect(mronjAlert?.clinicalRecommendation).toContain('Informed Consent Mandate');
      expect(mronjAlert?.clinicalRecommendation).toContain('chlorhexidine');
    });

    it('triggers warning alert for patient on Fosamax attending routine examination', () => {
      const notes = 'Medical history: Patient takes Fosamax weekly. Here for 6-monthly periodic examination.';
      const alerts = scanPharmacologySafety(notes, 'general');

      const mronjAlert = alerts.find(a => a.category === 'MRONJ');
      expect(mronjAlert).toBeDefined();
      expect(mronjAlert?.severity).toBe('warning');
    });
  });

  describe('Anticoagulant & Hemostasis Bleeding Risk Interceptor', () => {
    it('triggers bleeding alert when extraction planned for patient on Warfarin', () => {
      const notes = 'Patient takes Warfarin for atrial fibrillation. Tooth 36 non-restorable, requiring simple extraction.';
      const alerts = scanPharmacologySafety(notes, 'surgical');

      const bleedAlert = alerts.find(a => a.category === 'Bleeding');
      expect(bleedAlert).toBeDefined();
      expect(bleedAlert?.severity).toBe('high');
      expect(bleedAlert?.clinicalRecommendation).toContain('Do NOT discontinue');
      expect(bleedAlert?.clinicalRecommendation).toContain('tranexamic acid');
    });

    it('triggers bleeding alert for patient on Eliquis (Apixaban)', () => {
      const notes = 'Medications include Eliquis 5mg BD. Planning tooth removal.';
      const alerts = scanPharmacologySafety(notes, 'surgical');

      const bleedAlert = alerts.find(a => a.category === 'Bleeding');
      expect(bleedAlert).toBeDefined();
      expect(bleedAlert?.triggerDrugs[0]).toContain('Apixaban');
    });
  });

  describe('Weight-Based Local Anaesthetic Maximum Dose (MRD) Calculator', () => {
    it('calculates safe dose for pediatric patient (20 kg) on Lignocaine 2% (4.4 mg/kg)', () => {
      // 20 kg * 4.4 mg/kg = 88 mg max safe dose.
      // Lignocaine 2.2 mL cartridge = 44 mg.
      // Max safe cartridges = 2.0.
      const safeDose = calculateLocalAnaestheticSafety('lignocaine_2_80k', 20, 1.5);
      expect(safeDose.maxSafeTotalMg).toBe(88);
      expect(safeDose.maxSafeCartridges).toBe(2.0);
      expect(safeDose.isOverdose).toBe(false);
      expect(safeDose.alert).toBeUndefined();

      // Administering 3 cartridges = 132 mg > 88 mg max -> Overdose!
      const overdose = calculateLocalAnaestheticSafety('lignocaine_2_80k', 20, 3);
      expect(overdose.isOverdose).toBe(true);
      expect(overdose.alert?.category).toBe('LA_Overdose');
      expect(overdose.alert?.severity).toBe('critical');
      expect(overdose.alert?.clinicalRecommendation).toContain('Local Anaesthetic Systemic Toxicity');
    });

    it('calculates Articaine 4% limits for adult (70 kg) capped by absolute maximum (500 mg)', () => {
      // 70 kg * 7.0 mg/kg = 490 mg max.
      // Cartridge = 88 mg. Max cartridges = 490 / 88 = ~5.6.
      const adult = calculateLocalAnaestheticSafety('articaine_4_100k', 70, 4);
      expect(adult.maxSafeTotalMg).toBe(490);
      expect(adult.maxSafeCartridges).toBe(5.6);
      expect(adult.isOverdose).toBe(false);

      // Administering 7 cartridges = 616 mg -> Overdose!
      const adultOverdose = calculateLocalAnaestheticSafety('articaine_4_100k', 70, 7);
      expect(adultOverdose.isOverdose).toBe(true);
    });

    it('triggers cardiac adrenaline alert when cardiac patient receives > 2 cartridges with adrenaline', () => {
      // 3 cartridges of Lignocaine 1:80,000 contains ~82.5 mcg adrenaline (> 40 mcg cardiac limit)
      const cardiacResult = calculateLocalAnaestheticSafety('lignocaine_2_80k', 75, 3, true);
      expect(cardiacResult.isOverdose).toBe(false); // under mg limit for 75kg
      expect(cardiacResult.cardiacAdrenalineWarning).toBe(true);
      expect(cardiacResult.alert?.category).toBe('Cardiac_Adrenaline');
      expect(cardiacResult.alert?.severity).toBe('high');
      expect(cardiacResult.alert?.clinicalRecommendation).toContain('adrenaline-free');
    });
  });
});
