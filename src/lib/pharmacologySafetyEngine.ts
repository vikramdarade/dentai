/**
 * High-Risk Pharmacology Interceptor & Dental Anaesthetic Safety Calculator
 *
 * Implements AHPRA / Therapeutic Guidelines: Oral and Dental safety controls:
 * 1. Medication-Related Osteonecrosis of the Jaw (MRONJ) antiresorptive interceptor
 * 2. Anticoagulant / Antiplatelet surgical bleeding risk interceptor
 * 3. Weight-based Local Anaesthetic Maximum Recommended Dose (MRD) & cardiac adrenaline calculator
 */

export interface PharmacologyAlert {
  category: 'MRONJ' | 'Bleeding' | 'LA_Overdose' | 'Cardiac_Adrenaline';
  severity: 'critical' | 'high' | 'warning';
  title: string;
  description: string;
  clinicalRecommendation: string;
  triggerDrugs: string[];
}

export interface LocalAnaestheticDoseResult {
  drug: string;
  concentrationPercent: number;
  vasoconstrictor?: string;
  cartridgeVolumeMl: number;
  mgPerCartridge: number;
  patientWeightKg: number;
  maxRecommendedDoseMgPerKg: number;
  maxSafeTotalMg: number;
  maxSafeCartridges: number;
  administeredCartridges: number;
  administeredTotalMg: number;
  isOverdose: boolean;
  cardiacAdrenalineWarning: boolean;
  alert?: PharmacologyAlert;
}

// ─── 1. ANTIRESORPTIVE / MRONJ RISK DRUGS ───
export const ANTIRESORPTIVE_DRUGS: Record<string, { generic: string; brand: string; drugClass: 'Bisphosphonate' | 'RANKL_Inhibitor' | 'Sclerostin_Inhibitor' }> = {
  prolia: { generic: 'Denosumab', brand: 'Prolia', drugClass: 'RANKL_Inhibitor' },
  xgeva: { generic: 'Denosumab', brand: 'Xgeva', drugClass: 'RANKL_Inhibitor' },
  denosumab: { generic: 'Denosumab', brand: 'Prolia/Xgeva', drugClass: 'RANKL_Inhibitor' },
  fosamax: { generic: 'Alendronate', brand: 'Fosamax', drugClass: 'Bisphosphonate' },
  alendronate: { generic: 'Alendronate', brand: 'Fosamax', drugClass: 'Bisphosphonate' },
  aclasta: { generic: 'Zoledronic acid', brand: 'Aclasta', drugClass: 'Bisphosphonate' },
  zometa: { generic: 'Zoledronic acid', brand: 'Zometa', drugClass: 'Bisphosphonate' },
  'zoledronic acid': { generic: 'Zoledronic acid', brand: 'Aclasta/Zometa', drugClass: 'Bisphosphonate' },
  actonel: { generic: 'Risedronate', brand: 'Actonel', drugClass: 'Bisphosphonate' },
  risedronate: { generic: 'Risedronate', brand: 'Actonel', drugClass: 'Bisphosphonate' },
  pamidronate: { generic: 'Pamidronate', brand: 'Aredia', drugClass: 'Bisphosphonate' },
  evenity: { generic: 'Romosozumab', brand: 'Evenity', drugClass: 'Sclerostin_Inhibitor' },
  romosozumab: { generic: 'Romosozumab', brand: 'Evenity', drugClass: 'Sclerostin_Inhibitor' }
};

// ─── 2. ANTICOAGULANTS & ANTIPLATELETS ───
export const ANTICOAGULANT_DRUGS: Record<string, { generic: string; brand: string; type: 'DOAC' | 'VKA' | 'Antiplatelet' }> = {
  warfarin: { generic: 'Warfarin', brand: 'Coumadin/Marevan', type: 'VKA' },
  coumadin: { generic: 'Warfarin', brand: 'Coumadin', type: 'VKA' },
  marevan: { generic: 'Warfarin', brand: 'Marevan', type: 'VKA' },
  eliquis: { generic: 'Apixaban', brand: 'Eliquis', type: 'DOAC' },
  apixaban: { generic: 'Apixaban', brand: 'Eliquis', type: 'DOAC' },
  xarelto: { generic: 'Rivaroxaban', brand: 'Xarelto', type: 'DOAC' },
  rivaroxaban: { generic: 'Rivaroxaban', brand: 'Xarelto', type: 'DOAC' },
  pradaxa: { generic: 'Dabigatran', brand: 'Pradaxa', type: 'DOAC' },
  dabigatran: { generic: 'Dabigatran', brand: 'Pradaxa', type: 'DOAC' },
  plavix: { generic: 'Clopidogrel', brand: 'Plavix', type: 'Antiplatelet' },
  clopidogrel: { generic: 'Clopidogrel', brand: 'Plavix', type: 'Antiplatelet' },
  brilinta: { generic: 'Ticagrelor', brand: 'Brilinta', type: 'Antiplatelet' },
  ticagrelor: { generic: 'Ticagrelor', brand: 'Brilinta', type: 'Antiplatelet' },
  aspirin: { generic: 'Aspirin', brand: 'Cartia/Astrix', type: 'Antiplatelet' },
  cartia: { generic: 'Aspirin', brand: 'Cartia', type: 'Antiplatelet' }
};

// ─── 3. LOCAL ANAESTHETIC FORMULATIONS ───
export type LaFormulationKey = 'lignocaine_2_100k' | 'lignocaine_2_80k' | 'articaine_4_100k' | 'articaine_4_200k' | 'mepivacaine_3_plain' | 'prilocaine_3_felypressin';

export interface LaFormulation {
  key: LaFormulationKey;
  drug: string;
  concentrationPercent: number; // 2% = 20 mg/mL
  mgPerMl: number;
  vasoconstrictor?: string;
  adrenalineMcgPerMl?: number;
  cartridgeVolumeMl: number; // Australian standard: 2.2 mL
  mgPerCartridge: number;
  maxDoseMgPerKg: number; // Therapeutic Guidelines: Oral and Dental
  absoluteMaxDoseMg: number;
}

export const LA_FORMULATIONS: Record<LaFormulationKey, LaFormulation> = {
  lignocaine_2_80k: {
    key: 'lignocaine_2_80k',
    drug: 'Lignocaine',
    concentrationPercent: 2,
    mgPerMl: 20,
    vasoconstrictor: 'Adrenaline 1:80,000',
    adrenalineMcgPerMl: 12.5,
    cartridgeVolumeMl: 2.2,
    mgPerCartridge: 44,
    maxDoseMgPerKg: 4.4,
    absoluteMaxDoseMg: 300
  },
  lignocaine_2_100k: {
    key: 'lignocaine_2_100k',
    drug: 'Lignocaine',
    concentrationPercent: 2,
    mgPerMl: 20,
    vasoconstrictor: 'Adrenaline 1:100,000',
    adrenalineMcgPerMl: 10,
    cartridgeVolumeMl: 2.2,
    mgPerCartridge: 44,
    maxDoseMgPerKg: 4.4,
    absoluteMaxDoseMg: 300
  },
  articaine_4_100k: {
    key: 'articaine_4_100k',
    drug: 'Articaine',
    concentrationPercent: 4,
    mgPerMl: 40,
    vasoconstrictor: 'Adrenaline 1:100,000',
    adrenalineMcgPerMl: 10,
    cartridgeVolumeMl: 2.2,
    mgPerCartridge: 88,
    maxDoseMgPerKg: 7.0,
    absoluteMaxDoseMg: 500
  },
  articaine_4_200k: {
    key: 'articaine_4_200k',
    drug: 'Articaine',
    concentrationPercent: 4,
    mgPerMl: 40,
    vasoconstrictor: 'Adrenaline 1:200,000',
    adrenalineMcgPerMl: 5,
    cartridgeVolumeMl: 2.2,
    mgPerCartridge: 88,
    maxDoseMgPerKg: 7.0,
    absoluteMaxDoseMg: 500
  },
  mepivacaine_3_plain: {
    key: 'mepivacaine_3_plain',
    drug: 'Mepivacaine',
    concentrationPercent: 3,
    mgPerMl: 30,
    vasoconstrictor: 'None (Plain)',
    cartridgeVolumeMl: 2.2,
    mgPerCartridge: 66,
    maxDoseMgPerKg: 4.4,
    absoluteMaxDoseMg: 300
  },
  prilocaine_3_felypressin: {
    key: 'prilocaine_3_felypressin',
    drug: 'Prilocaine',
    concentrationPercent: 3,
    mgPerMl: 30,
    vasoconstrictor: 'Felypressin 0.03 IU/mL',
    cartridgeVolumeMl: 2.2,
    mgPerCartridge: 66,
    maxDoseMgPerKg: 6.0,
    absoluteMaxDoseMg: 400
  }
};

/**
 * Scans clinical notes, transcripts, or medical histories to detect antiresorptive (MRONJ)
 * and anticoagulant medications, evaluating procedure risk.
 */
export function scanPharmacologySafety(
  text: string,
  procedureType: 'surgical' | 'general' | 'restorative' | 'hygiene' = 'general'
): PharmacologyAlert[] {
  if (!text || !text.trim()) return [];
  const normalized = text.toLowerCase();
  const alerts: PharmacologyAlert[] = [];

  // 1. Antiresorptive / MRONJ Detection
  const detectedAntiresorptives: string[] = [];
  for (const [key, drug] of Object.entries(ANTIRESORPTIVE_DRUGS)) {
    const pattern = new RegExp(`\\b${key}\\b`, 'i');
    if (pattern.test(normalized)) {
      const label = `${drug.generic} (${drug.brand})`;
      if (!detectedAntiresorptives.includes(label)) {
        detectedAntiresorptives.push(label);
      }
    }
  }

  const isSurgicalProcedure = procedureType === 'surgical' ||
    normalized.includes('extract') ||
    normalized.includes('implant') ||
    normalized.includes('surgical') ||
    normalized.includes('bone removal') ||
    normalized.includes('flap') ||
    normalized.includes('biopsy');

  if (detectedAntiresorptives.length > 0) {
    if (isSurgicalProcedure) {
      alerts.push({
        category: 'MRONJ',
        severity: 'critical',
        title: 'Critical Alert: High MRONJ Risk in Surgical Candidate',
        description: `Patient is taking antiresorptive medication (${detectedAntiresorptives.join(', ')}). Invasive bone manipulation or extraction carries significant risk of Medication-Related Osteonecrosis of the Jaw (MRONJ).`,
        clinicalRecommendation: 'AHPRA & DBA Informed Consent Mandate: Document detailed discussion of osteonecrosis risk, obtain written consent, ensure chlorhexidine 0.2% pre/post-operative protocol, consider conservative non-surgical management or OMFS specialist referral.',
        triggerDrugs: detectedAntiresorptives
      });
    } else {
      alerts.push({
        category: 'MRONJ',
        severity: 'warning',
        title: 'Clinical Notice: Patient on Antiresorptive Therapy',
        description: `Patient is on ${detectedAntiresorptives.join(', ')}. Avoid elective dentoalveolar surgery where possible.`,
        clinicalRecommendation: 'Emphasize aggressive preventive care, endodontic retention over extraction, and maintain regular periodontal reviews.',
        triggerDrugs: detectedAntiresorptives
      });
    }
  }

  // 2. Anticoagulant / Antiplatelet Bleeding Risk Detection
  const detectedAnticoagulants: string[] = [];
  for (const [key, drug] of Object.entries(ANTICOAGULANT_DRUGS)) {
    const pattern = new RegExp(`\\b${key}\\b`, 'i');
    if (pattern.test(normalized)) {
      const label = `${drug.generic} (${drug.brand})`;
      if (!detectedAnticoagulants.includes(label)) {
        detectedAnticoagulants.push(label);
      }
    }
  }

  if (detectedAnticoagulants.length > 0) {
    if (isSurgicalProcedure) {
      alerts.push({
        category: 'Bleeding',
        severity: 'high',
        title: 'Bleeding Risk: Anticoagulant / Antiplatelet Therapy Active',
        description: `Patient is taking ${detectedAnticoagulants.join(', ')}. Increased risk of intraoperative and delayed postoperative hemorrhage.`,
        clinicalRecommendation: 'Do NOT discontinue anticoagulant therapy without medical specialist consultation. Plan local hemostatic measures: atraumatic extraction, resorbable gelatin sponge (Surgicel), primary closure with non-resorbable sutures, and 5% tranexamic acid mouthwash.',
        triggerDrugs: detectedAnticoagulants
      });
    } else {
      alerts.push({
        category: 'Bleeding',
        severity: 'warning',
        title: 'Clinical Notice: Anticoagulant / Antiplatelet Therapy Active',
        description: `Patient is taking ${detectedAnticoagulants.join(', ')}. Note potential for prolonged bleeding during deep scaling or restorative gingival retraction.`,
        clinicalRecommendation: 'Check INR (if on Warfarin, ideally < 3.0 within 24-72 hours) and ensure local pressure packs are ready.',
        triggerDrugs: detectedAnticoagulants
      });
    }
  }

  return alerts;
}

/**
 * Calculates patient-specific maximum safe local anaesthetic dose (cartridge limit)
 * and flags overdose or cardiac adrenaline risks.
 */
export function calculateLocalAnaestheticSafety(
  formulationKey: LaFormulationKey,
  patientWeightKg: number,
  administeredCartridges: number,
  isCardiacPatient = false
): LocalAnaestheticDoseResult {
  const formulation = LA_FORMULATIONS[formulationKey];
  if (!formulation) {
    throw new Error(`Unknown local anaesthetic formulation key: '${formulationKey}'`);
  }

  const weight = Math.max(1, patientWeightKg);
  // Weight-based ceiling vs absolute ceiling (e.g. 70kg * 4.4 mg/kg = 308 mg -> capped at 300 mg)
  const weightBasedMaxMg = weight * formulation.maxDoseMgPerKg;
  const maxSafeTotalMg = Math.min(weightBasedMaxMg, formulation.absoluteMaxDoseMg);

  // Safe cartridge limit rounded down to 1 decimal place
  const maxSafeCartridges = parseFloat((maxSafeTotalMg / formulation.mgPerCartridge).toFixed(1));

  const administeredTotalMg = administeredCartridges * formulation.mgPerCartridge;
  const isOverdose = administeredTotalMg > maxSafeTotalMg;

  // Cardiac adrenaline safety check:
  // For patients with cardiovascular disease, maximum adrenaline per appointment is 0.04 mg (40 mcg).
  // 1:80,000 = 12.5 mcg/mL * 2.2 mL = 27.5 mcg per cartridge -> max ~1.4 cartridges.
  // 1:100,000 = 10 mcg/mL * 2.2 mL = 22 mcg per cartridge -> max ~1.8 cartridges.
  let cardiacAdrenalineWarning = false;
  if (isCardiacPatient && formulation.adrenalineMcgPerMl) {
    const adrenalinePerCartridgeMcg = formulation.adrenalineMcgPerMl * formulation.cartridgeVolumeMl;
    const totalAdrenalineMcg = administeredCartridges * adrenalinePerCartridgeMcg;
    if (totalAdrenalineMcg > 40) {
      cardiacAdrenalineWarning = true;
    }
  }

  let alert: PharmacologyAlert | undefined;
  if (isOverdose) {
    alert = {
      category: 'LA_Overdose',
      severity: 'critical',
      title: 'Critical Warning: Local Anaesthetic Maximum Safe Dose Exceeded',
      description: `Administered ${administeredCartridges} cartridges (${administeredTotalMg} mg) of ${formulation.drug} for a ${weight} kg patient. Maximum safe dose is ${maxSafeTotalMg} mg (${maxSafeCartridges} cartridges).`,
      clinicalRecommendation: 'Cease further local anaesthetic administration immediately. Monitor patient for signs of Local Anaesthetic Systemic Toxicity (LAST): circumoral numbness, tinnitus, metallic taste, visual disturbances, dizziness, or arrhythmias. Have 20% lipid emulsion resuscitation protocol accessible.',
      triggerDrugs: [formulation.drug]
    };
  } else if (cardiacAdrenalineWarning) {
    alert = {
      category: 'Cardiac_Adrenaline',
      severity: 'high',
      title: 'Cardiac Warning: Adrenaline Dose Exceeds Cardiac Safety Threshold',
      description: `Administered ${administeredCartridges} cartridges containing vasoconstrictor to a patient with cardiac risk factors. Total adrenaline exceeds 0.04 mg limit for cardiovascular compromise.`,
      clinicalRecommendation: 'Monitor blood pressure and pulse. For further anaesthesia, switch to adrenaline-free formulation (e.g. Mepivacaine 3% plain or Prilocaine with felypressin).',
      triggerDrugs: [formulation.vasoconstrictor || 'Adrenaline']
    };
  }

  return {
    drug: formulation.drug,
    concentrationPercent: formulation.concentrationPercent,
    vasoconstrictor: formulation.vasoconstrictor,
    cartridgeVolumeMl: formulation.cartridgeVolumeMl,
    mgPerCartridge: formulation.mgPerCartridge,
    patientWeightKg: weight,
    maxRecommendedDoseMgPerKg: formulation.maxDoseMgPerKg,
    maxSafeTotalMg,
    maxSafeCartridges,
    administeredCartridges,
    administeredTotalMg,
    isOverdose,
    cardiacAdrenalineWarning,
    alert
  };
}
