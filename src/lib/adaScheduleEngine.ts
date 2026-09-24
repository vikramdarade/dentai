/**
 * Australian Dental Association (ADA) Item Code Mapping & Multi-Surface Restorative Engine
 *
 * Implements deterministic mapping of dental procedures to ADA 3-digit item codes,
 * featuring mathematical multi-surface restorative calculation conforming to ADA Schedule standards.
 */

import {
  isValidFdiTooth,
  getToothMetadata,
  parseAndValidateSurfaces,
  SurfaceValidationResult
} from './fdiNotationEngine';
import { lookupAdaFee } from './adaFees';

export interface AdaProcedureMapping {
  itemCode: string;
  itemName: string;
  category: 'Diagnostic' | 'Preventive' | 'Periodontics' | 'Oral Surgery' | 'Endodontics' | 'Restorative' | 'Crown & Bridge' | 'Prosthodontics' | 'General';
  toothNumber?: number;
  surfaces?: string[];
  surfaceCount?: number;
  standardFee: number;
  validationErrors?: string[];
}

export type RestorativeMaterial = 'composite' | 'amalgam' | 'gic' | 'compomer';

/**
 * Calculates the exact ADA item code for a direct restoration based on tooth location,
 * material, and validated surface count.
 */
export function calculateRestorativeItemCode(
  tooth: number | string,
  surfaces: string | string[],
  material: RestorativeMaterial = 'composite'
): AdaProcedureMapping {
  const num = typeof tooth === 'string' ? parseInt(tooth.trim(), 10) : tooth;
  const validation: SurfaceValidationResult = parseAndValidateSurfaces(num, surfaces);

  if (!validation.isValid) {
    return {
      itemCode: '599',
      itemName: 'Unspecified Restorative Procedure (Invalid Surface)',
      category: 'Restorative',
      toothNumber: num || undefined,
      surfaces: validation.surfaces,
      surfaceCount: validation.surfaceCount,
      standardFee: 0,
      validationErrors: validation.errors
    };
  }

  const meta = getToothMetadata(num);
  const count = Math.min(5, Math.max(1, validation.surfaceCount));

  let itemCode: string;
  let itemName: string;

  if (material === 'amalgam') {
    // Posterior amalgam: 511-515
    const codeNum = 510 + count;
    itemCode = String(codeNum);
    itemName = `Posterior Metallic Restoration - ${count} Surface${count > 1 ? 's' : ''}`;
  } else {
    // Resin composite / GIC / adhesive restorative
    if (meta.isAnterior) {
      // Anterior composite: 521 (1 surf), 522 (2 surf), 523 (3 surf), 524 (4 surf), 525 (5 surf / incisal edge)
      const codeNum = 520 + count;
      itemCode = String(codeNum);
      itemName = `Anterior Resin Composite - ${count} Surface${count > 1 ? 's' : ''} (${validation.canonicalSurfaceString})`;
    } else {
      // Posterior composite: 531 (1 surf), 532 (2 surf), 533 (3 surf), 534 (4 surf), 535 (5 surf)
      const codeNum = 530 + count;
      itemCode = String(codeNum);
      itemName = `Posterior Resin Composite - ${count} Surface${count > 1 ? 's' : ''} (${validation.canonicalSurfaceString})`;
    }
  }

  const feeData = lookupAdaFee(itemCode, itemName);

  return {
    itemCode,
    itemName,
    category: 'Restorative',
    toothNumber: num,
    surfaces: validation.surfaces,
    surfaceCount: count,
    standardFee: feeData.standardFee,
    validationErrors: []
  };
}

/**
 * Standard ADA Procedure Catalog Reference
 */
export const ADA_STANDARD_PROCEDURES: Record<string, { code: string; name: string; category: AdaProcedureMapping['category'] }> = {
  // Diagnostic
  '011': { code: '011', name: 'Comprehensive Oral Examination', category: 'Diagnostic' },
  '012': { code: '012', name: 'Periodic Oral Examination', category: 'Diagnostic' },
  '013': { code: '013', name: 'Oral Examination - Limited', category: 'Diagnostic' },
  '022': { code: '022', name: 'Intraoral Periapical Radiograph', category: 'Diagnostic' },
  '026': { code: '026', name: 'Bitewing Radiographs (Pair)', category: 'Diagnostic' },
  '071': { code: '071', name: 'Diagnostic Model (Per Arch)', category: 'Diagnostic' },

  // Periodontics
  '221': { code: '221', name: 'Periodontal Scaling & Plaque Removal', category: 'Periodontics' },
  '222': { code: '222', name: 'Root Planing & Subgingival Debridement (Per Quadrant)', category: 'Periodontics' },

  // Oral Surgery
  '311': { code: '311', name: 'Removal of Tooth (Simple)', category: 'Oral Surgery' },
  '314': { code: '314', name: 'Sectional Removal of Tooth', category: 'Oral Surgery' },
  '322': { code: '322', name: 'Surgical Removal of Tooth (Not Requiring Bone)', category: 'Oral Surgery' },
  '324': { code: '324', name: 'Surgical Removal of Tooth Requiring Bone Removal / Tooth Division', category: 'Oral Surgery' },

  // Endodontics
  '414': { code: '414', name: 'Pulp Extirpation / Emergency Endodontic Debridement', category: 'Endodontics' },
  '415': { code: '415', name: 'Chemo-Mechanical Root Canal Preparation (One Canal)', category: 'Endodontics' },
  '416': { code: '416', name: 'Root Canal Preparation (Each Additional Canal)', category: 'Endodontics' },
  '417': { code: '417', name: 'Obturation / Root Canal Filling (One Canal)', category: 'Endodontics' },
  '418': { code: '418', name: 'Obturation / Root Canal Filling (Each Additional Canal)', category: 'Endodontics' },

  // Preventive
  '114': { code: '114', name: 'Calculus Removal & Polish', category: 'Preventive' },
  '115': { code: '115', name: 'Periodontal Debridement (Subgingival)', category: 'Preventive' },
  '121': { code: '121', name: 'Topical Fluoride Application', category: 'Preventive' },
  '161': { code: '161', name: 'Fissure Sealant (Per Tooth)', category: 'Preventive' },

  // Crown & Bridge
  '611': { code: '611', name: 'Full Crown - Ceramic / Porcelain', category: 'Crown & Bridge' },
  '613': { code: '613', name: 'Full Crown - Cast Metallic / Gold', category: 'Crown & Bridge' },
  '615': { code: '615', name: 'Full Crown - Porcelain Fused to Metal', category: 'Crown & Bridge' },
  '627': { code: '627', name: 'Direct Core Buildup (Including Pins)', category: 'Crown & Bridge' }
};

/**
 * Parses free-text procedure sentences into deterministic ADA item codes.
 */
export function matchProcedureToAdaCode(description: string, tooth?: number): AdaProcedureMapping | null {
  const text = description.toLowerCase().trim();

  // 1. Check for restorative combinations with surfaces: e.g. "16 MOD composite", "composite filling on tooth 21 MID"
  const toothMatch = text.match(/\b(?:tooth\s+)?([1-8][1-8])\b/);
  const detectedTooth = tooth || (toothMatch ? parseInt(toothMatch[1], 10) : undefined);

  // 1. Surgical extractions
  if (text.includes('wisdom') && (text.includes('bone') || text.includes('surgical') || text.includes('section'))) {
    return {
      itemCode: '324',
      itemName: ADA_STANDARD_PROCEDURES['324'].name,
      category: 'Oral Surgery',
      toothNumber: detectedTooth,
      standardFee: lookupAdaFee('324').standardFee
    };
  }
  if (text.includes('surgical extract') || text.includes('surgical removal')) {
    return {
      itemCode: '322',
      itemName: ADA_STANDARD_PROCEDURES['322'].name,
      category: 'Oral Surgery',
      toothNumber: detectedTooth,
      standardFee: lookupAdaFee('322').standardFee
    };
  }
  if (text.includes('extract') || text.includes('exo') || text.includes('removal of tooth')) {
    return {
      itemCode: '311',
      itemName: ADA_STANDARD_PROCEDURES['311'].name,
      category: 'Oral Surgery',
      toothNumber: detectedTooth,
      standardFee: lookupAdaFee('311').standardFee
    };
  }

  // 2. Diagnostic & Radiographs
  if (text.includes('periapical') || text.includes('pa x-ray') || text.includes('pa radiograph')) {
    return {
      itemCode: '022',
      itemName: ADA_STANDARD_PROCEDURES['022'].name,
      category: 'Diagnostic',
      toothNumber: detectedTooth,
      standardFee: lookupAdaFee('022').standardFee
    };
  }
  if (text.includes('bitewing') || text.includes('bw')) {
    return {
      itemCode: '026',
      itemName: ADA_STANDARD_PROCEDURES['026'].name,
      category: 'Diagnostic',
      standardFee: lookupAdaFee('026').standardFee
    };
  }
  if (text.includes('comprehensive exam') || text.includes('full exam') || text.includes('new patient exam')) {
    return {
      itemCode: '011',
      itemName: ADA_STANDARD_PROCEDURES['011'].name,
      category: 'Diagnostic',
      standardFee: lookupAdaFee('011').standardFee
    };
  }
  if (text.includes('periodic exam') || text.includes('checkup') || text.includes('recall exam')) {
    return {
      itemCode: '012',
      itemName: ADA_STANDARD_PROCEDURES['012'].name,
      category: 'Diagnostic',
      standardFee: lookupAdaFee('012').standardFee
    };
  }
  if (text.includes('limited exam') || text.includes('emergency exam') || text.includes('specific exam')) {
    return {
      itemCode: '013',
      itemName: ADA_STANDARD_PROCEDURES['013'].name,
      category: 'Diagnostic',
      standardFee: lookupAdaFee('013').standardFee
    };
  }

  // 3. Endodontics
  if (text.includes('extirpat') || text.includes('emergency endo') || text.includes('pulpectomy')) {
    return {
      itemCode: '414',
      itemName: ADA_STANDARD_PROCEDURES['414'].name,
      category: 'Endodontics',
      toothNumber: detectedTooth,
      standardFee: lookupAdaFee('414').standardFee
    };
  }
  if (text.includes('chemo-mechanical') || text.includes('rct prep') || text.includes('instrumentation')) {
    return {
      itemCode: '415',
      itemName: ADA_STANDARD_PROCEDURES['415'].name,
      category: 'Endodontics',
      toothNumber: detectedTooth,
      standardFee: lookupAdaFee('415').standardFee
    };
  }
  if (text.includes('obturation') || text.includes('gutta-percha') || text.includes('root filling')) {
    return {
      itemCode: '417',
      itemName: ADA_STANDARD_PROCEDURES['417'].name,
      category: 'Endodontics',
      toothNumber: detectedTooth,
      standardFee: lookupAdaFee('417').standardFee
    };
  }

  // 4. Periodontics & Preventive
  if (text.includes('root plan') || text.includes('deep debridement') || text.includes('subgingival debridement per quad')) {
    return {
      itemCode: '222',
      itemName: ADA_STANDARD_PROCEDURES['222'].name,
      category: 'Periodontics',
      standardFee: lookupAdaFee('222').standardFee
    };
  }
  if (text.includes('scale and clean') || text.includes('scaling') || text.includes('dental clean') || text.includes('prophylaxis')) {
    return {
      itemCode: '114',
      itemName: ADA_STANDARD_PROCEDURES['114'].name,
      category: 'Preventive',
      standardFee: lookupAdaFee('114').standardFee
    };
  }

  // 5. Restorative procedures with surfaces
  const isRestorative = text.includes('composite') || text.includes('filling') || text.includes('restoration') || text.includes('amalgam') || text.includes('resin');
  const uppercaseMatch = description.match(/\b(MODBL|MODB|MODL|MOD|MOB|DOB|MO|DO|OB|OL|MID|MI|DI|MB|DB)\b/);
  const spelledSurfaceMatch = text.match(/\b(mesio-occlusal|disto-occlusal|mesio-occluso-distal|occlusal|incisal|buccal|palatal|lingual)\b/);

  if (detectedTooth && isValidFdiTooth(detectedTooth) && (isRestorative || uppercaseMatch || spelledSurfaceMatch)) {
    const rawSurfaces = uppercaseMatch ? uppercaseMatch[1] : (spelledSurfaceMatch ? spelledSurfaceMatch[1] : 'O');
    const material: RestorativeMaterial = text.includes('amalgam') ? 'amalgam' : 'composite';
    return calculateRestorativeItemCode(detectedTooth, rawSurfaces, material);
  }

  return null;
}
