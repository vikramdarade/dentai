/**
 * Australian Dental Association (ADA) 3-Digit Item Coding & Fee Valuation Catalog.
 *
 * Provides national benchmark fee averages, procedure categorization,
 * and entity extraction to identify unscheduled dental treatments from clinical findings.
 */

import { TreatmentOpportunity, TreatmentStatus } from '../types';

export interface AdaFeeItem {
  code: string;
  name: string;
  category: 'Diagnostic' | 'Preventive' | 'Periodontics' | 'Oral Surgery' | 'Endodontics' | 'Restorative' | 'Crown & Bridge' | 'Prosthodontics' | 'General';
  standardFee: number;
}

/**
 * Standard Australian national fee benchmarks based on dental fee surveys.
 */
export const ADA_FEE_CATALOG: Record<string, AdaFeeItem> = {
  // Diagnostic
  '011': { code: '011', name: 'Comprehensive Oral Examination', category: 'Diagnostic', standardFee: 75 },
  '012': { code: '012', name: 'Periodic Oral Examination', category: 'Diagnostic', standardFee: 65 },
  '013': { code: '013', name: 'Oral Examination - Limited', category: 'Diagnostic', standardFee: 55 },
  '022': { code: '022', name: 'Intraoral Periapical Radiograph', category: 'Diagnostic', standardFee: 48 },
  '026': { code: '026', name: 'Bitewing Radiographs (Pair)', category: 'Diagnostic', standardFee: 92 },
  '037': { code: '037', name: 'OPG Panoramic Radiograph', category: 'Diagnostic', standardFee: 135 },

  // Preventive
  '114': { code: '114', name: 'Calculus Removal & Clean', category: 'Preventive', standardFee: 145 },
  '115': { code: '115', name: 'Periodontal Debridement (Subgingival)', category: 'Preventive', standardFee: 165 },
  '121': { code: '121', name: 'Topical Fluoride Application', category: 'Preventive', standardFee: 42 },
  '161': { code: '161', name: 'Fissure Sealant (Per Tooth)', category: 'Preventive', standardFee: 68 },

  // Periodontics
  '221': { code: '221', name: 'Periodontal Scaling (Subgingival)', category: 'Periodontics', standardFee: 280 },
  '222': { code: '222', name: 'Root Planing & Deep Debridement (Per Quad)', category: 'Periodontics', standardFee: 340 },

  // Oral Surgery
  '311': { code: '311', name: 'Removal of Tooth (Simple Extraction)', category: 'Oral Surgery', standardFee: 225 },
  '322': { code: '322', name: 'Surgical Tooth Extraction', category: 'Oral Surgery', standardFee: 420 },
  '324': { code: '324', name: 'Surgical Wisdom Tooth Removal (Bone Removal)', category: 'Oral Surgery', standardFee: 520 },

  // Endodontics
  '414': { code: '414', name: 'Pulp Extirpation / Emergency Endo', category: 'Endodontics', standardFee: 320 },
  '415': { code: '415', name: 'Chemo-Mechanical Root Canal Preparation', category: 'Endodontics', standardFee: 860 },
  '417': { code: '417', name: 'Obturation / Root Canal Filling', category: 'Endodontics', standardFee: 440 },

  // Restorative
  '521': { code: '521', name: 'Anterior Resin Composite - 1 Surface', category: 'Restorative', standardFee: 195 },
  '522': { code: '522', name: 'Anterior Resin Composite - 2 Surfaces', category: 'Restorative', standardFee: 255 },
  '523': { code: '523', name: 'Anterior Resin Composite - 3 Surfaces', category: 'Restorative', standardFee: 310 },
  '531': { code: '531', name: 'Posterior Resin Composite - 1 Surface', category: 'Restorative', standardFee: 220 },
  '532': { code: '532', name: 'Posterior Resin Composite - 2 Surfaces', category: 'Restorative', standardFee: 295 },
  '533': { code: '533', name: 'Posterior Resin Composite - 3 Surfaces', category: 'Restorative', standardFee: 365 },
  '534': { code: '534', name: 'Posterior Resin Composite - 4+ Surfaces', category: 'Restorative', standardFee: 430 },

  // Crown & Bridge
  '611': { code: '611', name: 'Full Crown - Ceramic / Porcelain', category: 'Crown & Bridge', standardFee: 1650 },
  '613': { code: '613', name: 'Full Crown - Cast Gold / Metallic', category: 'Crown & Bridge', standardFee: 1850 },
  '615': { code: '615', name: 'Full Crown - Porcelain Fused to Metal', category: 'Crown & Bridge', standardFee: 1550 },
  '627': { code: '627', name: 'Direct Core Buildup / Composite Crown', category: 'Crown & Bridge', standardFee: 460 },
  '643': { code: '643', name: 'Bridge Pontic (Per Unit)', category: 'Crown & Bridge', standardFee: 1450 },
  '661': { code: '661', name: 'Implant-Retained Crown', category: 'Crown & Bridge', standardFee: 2200 },
  '688': { code: '688', name: 'Occlusal Splint / Protective Guard', category: 'Crown & Bridge', standardFee: 750 },

  // Prosthodontics
  '711': { code: '711', name: 'Complete Denture (Upper or Lower)', category: 'Prosthodontics', standardFee: 1350 },
  '719': { code: '719', name: 'Full Upper and Lower Dentures', category: 'Prosthodontics', standardFee: 2500 },

  // General & Occlusal
  '821': { code: '821', name: 'Clear Aligner Consultation / Step', category: 'General', standardFee: 1500 },
  '965': { code: '965', name: 'Occlusal Splint / Night Guard', category: 'General', standardFee: 850 },
};

/**
 * Looks up the ADA item definition, category, and standard fee.
 */
export function lookupAdaFee(code: string, fallbackName?: string): AdaFeeItem {
  const cleanCode = String(code || '').trim().replace(/^ADA\s*/i, '');
  if (ADA_FEE_CATALOG[cleanCode]) {
    return ADA_FEE_CATALOG[cleanCode];
  }

  // Fallback heuristics based on common prefixes
  const fee = fallbackName?.toLowerCase().includes('crown')
    ? 1650
    : fallbackName?.toLowerCase().includes('root canal') || fallbackName?.toLowerCase().includes('endo')
    ? 860
    : fallbackName?.toLowerCase().includes('implant')
    ? 2200
    : fallbackName?.toLowerCase().includes('splint')
    ? 750
    : fallbackName?.toLowerCase().includes('filling') || fallbackName?.toLowerCase().includes('composite')
    ? 295
    : 250;

  return {
    code: cleanCode || '000',
    name: fallbackName || `Dental Procedure (${cleanCode})`,
    category: 'General',
    standardFee: fee
  };
}

/**
 * Extracts proposed/unscheduled treatment opportunities from clinical findings.
 * Analyzes recommendations, tooth findings, and custom sections for planned future care.
 */
export function extractProposedTreatmentsFromFindings(params: {
  findings: any;
  patientName: string;
  dentistId: string;
  clinicId?: string;
  consultationId: string;
}): TreatmentOpportunity[] {
  const { findings, patientName, dentistId, clinicId, consultationId } = params;
  if (!findings) return [];

  // If already structured and present, return them directly
  if (Array.isArray(findings.proposedTreatments) && findings.proposedTreatments.length > 0) {
    return findings.proposedTreatments.map((item: any, index: number) => ({
      id: item.id || `${consultationId}-tx-${index + 1}`,
      consultationId,
      dentistId,
      clinicId,
      patientName,
      patientPhone: item.patientPhone || '0412 345 678',
      patientEmail: item.patientEmail || `${patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
      tooth: item.tooth,
      surfaces: item.surfaces,
      adaCode: item.adaCode || '531',
      procedureName: item.procedureName || lookupAdaFee(item.adaCode || '531').name,
      estimatedFee: Number(item.estimatedFee) || lookupAdaFee(item.adaCode || '531').standardFee,
      clinicalReason: item.clinicalReason || 'Recommended clinical treatment',
      patientBarrier: item.patientBarrier || 'Unscheduled chairside follow-up',
      status: (item.status as TreatmentStatus) || 'unscheduled',
      lastContactedAt: item.lastContactedAt,
      bookedAt: item.bookedAt,
      createdAt: item.createdAt || new Date().toISOString()
    }));
  }

  const results: TreatmentOpportunity[] = [];
  const textCorpus = [
    findings.recommendations || '',
    findings.toothFindings || '',
    findings.diagnosis || '',
    findings.recallRequirements || '',
    JSON.stringify(findings.customSections || {})
  ].join('\n');

  const performedCorpus = (findings.treatmentPerformed || '').toLowerCase();

  // Pattern A: Crowns (e.g. Tooth 16 crown, cuspal protection)
  const crownRegex = /(?:crown|onlay|cuspal\s*protection|cuspal\s*coverage)[^.\n]{0,60}?(?:tooth\s*|fdi\s*)?([1-4][1-8])|(?:tooth\s*|fdi\s*)?([1-4][1-8])[^.\n]{0,60}?(?:crown|onlay|cuspal\s*protection|cuspal\s*coverage)/gi;
  let crownMatch: RegExpExecArray | null;
  while ((crownMatch = crownRegex.exec(textCorpus)) !== null) {
    const tooth = crownMatch[1] || crownMatch[2];
    if (tooth && performedCorpus.includes('crown') && performedCorpus.includes(tooth)) {
      continue;
    }
    if (!results.some(r => r.tooth === tooth)) {
      const feeItem = lookupAdaFee('611');
      results.push({
        id: `${consultationId}-tx-crown-${tooth || 'generic'}`,
        consultationId,
        dentistId,
        clinicId,
        patientName,
        patientPhone: '0412 889 123',
        patientEmail: `${patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
        tooth,
        adaCode: feeItem.code,
        procedureName: feeItem.name,
        estimatedFee: feeItem.standardFee,
        clinicalReason: tooth ? `Tooth ${tooth} cuspal coverage required to prevent fracture` : 'Full ceramic crown indicated',
        patientBarrier: 'Checking private health insurance rebate',
        status: 'unscheduled',
        createdAt: new Date().toISOString()
      });
      break;
    }
  }

  // Pattern B: Fillings / Restorations (e.g. Tooth 46 composite filling, incipient caries 46)
  const fillingRegex = /(?:filling|composite|restoration|caries|decay)[^.\n]{0,60}?(?:tooth\s*|fdi\s*)?([1-4][1-8])|(?:tooth\s*|fdi\s*)?([1-4][1-8])[^.\n]{0,60}?(?:filling|composite|restoration|caries|decay)/gi;
  let fillMatch: RegExpExecArray | null;
  while ((fillMatch = fillingRegex.exec(textCorpus)) !== null) {
    const tooth = fillMatch[1] || fillMatch[2];
    if (tooth) {
      const isAlreadyTreated = performedCorpus.includes(tooth) && (performedCorpus.includes('restoration') || performedCorpus.includes('filling'));
      if (!isAlreadyTreated && !results.some(r => r.tooth === tooth)) {
        const feeItem = lookupAdaFee('532');
        results.push({
          id: `${consultationId}-tx-filling-${tooth}`,
          consultationId,
          dentistId,
          clinicId,
          patientName,
          patientPhone: '0423 456 789',
          patientEmail: `${patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
          tooth,
          surfaces: 'MO',
          adaCode: feeItem.code,
          procedureName: feeItem.name,
          estimatedFee: feeItem.standardFee,
          clinicalReason: `Incipient/active caries on tooth ${tooth} requiring composite restoration`,
          patientBarrier: 'Patient preferred to schedule next week',
          status: 'unscheduled',
          createdAt: new Date().toISOString()
        });
        break;
      }
    }
  }

  // Pattern C: Deep Root Planing / Perio Therapy (e.g. BPE 3 or 4, subgingival calculus, quadrant scaling)
  if (textCorpus.match(/(?:bpe\s*[34]|root\s*planing|subgingival\s*(?:calculus|debridement)|quadrant\s*(?:clean|perio))/i)) {
    if (!performedCorpus.includes('root planing') && !performedCorpus.includes('subgingival')) {
      const feeItem = lookupAdaFee('222');
      results.push({
        id: `${consultationId}-tx-perio`,
        consultationId,
        dentistId,
        clinicId,
        patientName,
        patientPhone: '0434 567 890',
        patientEmail: `${patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
        adaCode: feeItem.code,
        procedureName: feeItem.name,
        estimatedFee: feeItem.standardFee * 2, // 2 quadrants typical
        clinicalReason: 'Active periodontal pockets >4mm requiring quadrant deep scaling under local anaesthesia',
        patientBarrier: 'Time constraint today; needs 60-minute appointment block',
        status: 'unscheduled',
        createdAt: new Date().toISOString()
      });
    }
  }

  // Pattern D: Nightguard / Occlusal Splint for Bruxism / Wear
  if (textCorpus.match(/(?:bruxism|wear\s*facets|grinding|occlusal\s*splint|night\s*guard)/i)) {
    if (!performedCorpus.includes('splint') && !performedCorpus.includes('night guard')) {
      const feeItem = lookupAdaFee('965');
      results.push({
        id: `${consultationId}-tx-splint`,
        consultationId,
        dentistId,
        clinicId,
        patientName,
        patientPhone: '0411 222 333',
        patientEmail: `${patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
        adaCode: feeItem.code,
        procedureName: feeItem.name,
        estimatedFee: feeItem.standardFee,
        clinicalReason: 'Severe nocturnal attrition and wear facets; upper Michigan occlusal splint indicated',
        patientBarrier: 'Discussing with partner before ordering laboratory appliance',
        status: 'unscheduled',
        createdAt: new Date().toISOString()
      });
    }
  }

  // Pattern E: Endodontics / Root Canal Therapy (e.g. pulpitis, RCT, endo, root canal)
  const endoRegex = /(?:root\s*canal|rct|endo|pulpectomy|pulpitis)[^.\n]{0,60}?(?:tooth\s*|fdi\s*)?([1-4][1-8])|(?:tooth\s*|fdi\s*)?([1-4][1-8])[^.\n]{0,60}?(?:root\s*canal|rct|endo|pulpectomy|pulpitis)/gi;
  let endoMatch: RegExpExecArray | null;
  while ((endoMatch = endoRegex.exec(textCorpus)) !== null) {
    const tooth = endoMatch[1] || endoMatch[2];
    if (tooth) {
      const isAlreadyCompleted = performedCorpus.includes(tooth) && (performedCorpus.includes('completed rct') || performedCorpus.includes('obturation'));
      if (!isAlreadyCompleted && !results.some(r => r.tooth === tooth && r.adaCode?.startsWith('4'))) {
        const feeItem = lookupAdaFee('417');
        results.push({
          id: `${consultationId}-tx-endo-${tooth}`,
          consultationId,
          dentistId,
          clinicId,
          patientName,
          patientPhone: '0412 555 789',
          patientEmail: `${patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
          tooth,
          adaCode: feeItem.code,
          procedureName: feeItem.name,
          estimatedFee: feeItem.standardFee,
          clinicalReason: `Endodontic therapy (root canal) required for symptomatic pulpitis on tooth ${tooth}`,
          patientBarrier: 'Requires multiple-stage appointment scheduling',
          status: 'unscheduled',
          createdAt: new Date().toISOString()
        });
        break;
      }
    }
  }

  // Pattern F: Implants / Edentulous Site
  const implantRegex = /(?:implant|fixture|crown\s*on\s*implant|missing\s*tooth)[^.\n]{0,60}?(?:tooth\s*|fdi\s*)?([1-4][1-8])|(?:tooth\s*|fdi\s*)?([1-4][1-8])[^.\n]{0,60}?(?:implant|fixture|crown\s*on\s*implant|missing\s*tooth)/gi;
  let implantMatch: RegExpExecArray | null;
  while ((implantMatch = implantRegex.exec(textCorpus)) !== null) {
    const tooth = implantMatch[1] || implantMatch[2];
    if (tooth && !results.some(r => r.tooth === tooth && r.adaCode === '688')) {
      results.push({
        id: `${consultationId}-tx-implant-${tooth}`,
        consultationId,
        dentistId,
        clinicId,
        patientName,
        patientPhone: '0433 111 222',
        patientEmail: `${patientName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.com`,
        tooth,
        adaCode: '688',
        procedureName: 'Dental Implant Fixture & Restoration',
        estimatedFee: 2200,
        clinicalReason: `Single tooth implant reconstruction indicated for site ${tooth}`,
        patientBarrier: 'Evaluating financial plan / superannuation release',
        status: 'unscheduled',
        createdAt: new Date().toISOString()
      });
      break;
    }
  }

  return results;
}
