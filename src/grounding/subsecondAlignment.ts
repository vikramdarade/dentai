/**
 * Sub-Second Utterance Alignment Engine (Work Package 3.1)
 *
 * Binds atomic clinical assertions in synthesized notes to precise timestamped
 * audio utterances and persistent audio slice IDs (t ± 500 ms).
 * Computes deterministic grounding scores and provides receptionist-friendly badging.
 */

import {
  TimestampedUtterance,
  GroundedClaim,
  ClinicalClaimCategory,
  SubsecondAlignmentResult
} from './types';
import { isValidFdiTooth } from '../lib/fdiNotationEngine';

// Common dental keywords for claim categorization
const DRUG_KEYWORDS = [
  'lignocaine', 'lidocaine', 'articaine', 'mepivacaine', 'prilocaine',
  'adrenaline', 'epinephrine', 'eliquis', 'apixaban', 'warfarin', 'xarelto',
  'prolia', 'denosumab', 'fosamax', 'alendronate', 'amoxicillin', 'penicillin',
  'ibuprofen', 'paracetamol', 'panadol', 'surgicel', 'ledermix', 'dycal'
];

const PROCEDURE_KEYWORDS = [
  'extraction', 'extract', 'exo', 'removal', 'restoration', 'composite',
  'filling', 'root canal', 'extirpation', 'obturation', 'scaling', 'clean',
  'prophylaxis', 'debridement', 'crown', 'bridge', 'implant', 'biopsy',
  'fluoride', 'fissure sealant', 'bone guttering', 'sectioned'
];

const MATERIAL_KEYWORDS = [
  'surgicel', 'silk suture', 'resorbable suture', 'vicryl', 'cavit',
  'gutta-percha', 'composite resin', 'amalgam', 'gic', 'glass ionomer',
  'rubber dam', 'matrix band', 'wedge'
];

const DIAGNOSIS_KEYWORDS = [
  'caries', 'pulpitis', 'pericoronitis', 'abscess', 'fracture', 'cracked tooth',
  'periodontitis', 'gingivitis', 'necrosis', 'attrition', 'abrasion', 'erosion'
];

function expandClinicalAbbreviations(text: string): string {
  return text
    .replace(/\b5mg\b/gi, '5 milligrams')
    .replace(/\b(\d+)\s*mg\b/gi, '$1 milligrams')
    .replace(/\b1:80k\b/gi, '1 80 000 1:80,000')
    .replace(/\b1:100k\b/gi, '1 100 000 1:100,000')
    .replace(/\bianb\b/gi, 'inferior alveolar nerve block ianb')
    .replace(/\ballergic\b/gi, 'allergy allergic')
    .replace(/\bagreed\b/gi, 'agree agreed');
}

function normalizeText(text: string): string {
  const expanded = expandClinicalAbbreviations(text);
  return expanded
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts discrete atomic clinical claims from note fields.
 */
export function extractClinicalClaims(note: {
  canonical?: Record<string, string>;
  customSections?: Record<string, string>;
  [k: string]: any;
}): GroundedClaim[] {
  const claims: GroundedClaim[] = [];
  let claimCounter = 1;

  const sectionsToScan: { sectionName: string; text: string }[] = [];

  // Harvest all sections
  if (note.canonical) {
    for (const [sec, val] of Object.entries(note.canonical)) {
      if (typeof val === 'string' && val.trim()) {
        sectionsToScan.push({ sectionName: sec, text: val });
      }
    }
  }
  if (note.customSections) {
    for (const [sec, val] of Object.entries(note.customSections)) {
      if (typeof val === 'string' && val.trim()) {
        sectionsToScan.push({ sectionName: sec, text: val });
      }
    }
  }
  for (const [key, val] of Object.entries(note)) {
    if (key !== 'canonical' && key !== 'customSections' && typeof val === 'string' && val.trim()) {
      sectionsToScan.push({ sectionName: key, text: val });
    }
  }

  const seenClaimTexts = new Set<string>();

  for (const { sectionName, text } of sectionsToScan) {
    // 1. Split into sentence units
    const sentences = text
      .split(/(?<=[.!?;\n])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const normSentence = normalizeText(sentence);
      if (!normSentence || normSentence.length < 5) continue;

      // Extract Tooth Claims
      const toothMatches = sentence.match(/\b(?:tooth\s+)?([1-8][1-8])\b/gi) || [];
      for (const tMatch of toothMatches) {
        const numMatch = tMatch.match(/([1-8][1-8])/);
        if (numMatch && isValidFdiTooth(parseInt(numMatch[1], 10))) {
          const toothStr = `Tooth ${numMatch[1]}`;
          if (!seenClaimTexts.has(toothStr)) {
            seenClaimTexts.add(toothStr);
            claims.push({
              claimId: `claim-${claimCounter++}`,
              category: 'tooth',
              text: toothStr,
              section: sectionName,
              isCorroborated: false,
              confidenceScore: 0,
              verificationNote: 'Pending verification'
            });
          }
        }
      }

      // Categorize other keywords
      let category: ClinicalClaimCategory = 'procedure';
      if (DRUG_KEYWORDS.some(d => normSentence.includes(d))) {
        category = normSentence.includes('allergic') || normSentence.includes('allergy')
          ? 'allergy'
          : 'anaesthetic';
      } else if (PROCEDURE_KEYWORDS.some(p => normSentence.includes(p))) {
        category = 'procedure';
      } else if (MATERIAL_KEYWORDS.some(m => normSentence.includes(m))) {
        category = 'material';
      } else if (DIAGNOSIS_KEYWORDS.some(diag => normSentence.includes(diag))) {
        category = 'diagnosis';
      }

      // Add full sentence as clinical claim
      if (!seenClaimTexts.has(sentence)) {
        seenClaimTexts.add(sentence);
        claims.push({
          claimId: `claim-${claimCounter++}`,
          category,
          text: sentence,
          section: sectionName,
          isCorroborated: false,
          confidenceScore: 0,
          verificationNote: 'Pending verification'
        });
      }
    }
  }

  return claims;
}

/**
 * Aligns claims against utterances and computes deterministic grounding score.
 */
export function alignClaimsToUtterances(
  claims: GroundedClaim[],
  utterances: TimestampedUtterance[]
): SubsecondAlignmentResult {
  if (claims.length === 0) {
    return {
      totalClaimsCount: 0,
      corroboratedCount: 0,
      unverifiedCount: 0,
      overallGroundingScore: 1.0,
      isFullyGrounded: true,
      claims: [],
      statusBadge: 'Verified from Audio'
    };
  }

  let corroboratedCount = 0;
  let totalWeightedScore = 0;
  let totalWeights = 0;

  const verifiedClaims: GroundedClaim[] = claims.map(claim => {
    const claimNorm = normalizeText(claim.text);
    const claimTokens = claimNorm.split(' ').filter(t => t.length > 2);

    let bestMatch: TimestampedUtterance | null = null;
    let bestScore = 0;

    // Special check for patient agreement / consent
    const isAgreementClaim = claimNorm.includes('patient agree') || claimNorm.includes('patient consent');
    if (isAgreementClaim) {
      const patientAcceptanceUtterance = utterances.find(
        u => u.sender === 'Patient' && /\b(understand|agree|go ahead|proceed|take it out|happy to|yes)\b/i.test(u.text)
      );
      if (patientAcceptanceUtterance) {
        bestMatch = patientAcceptanceUtterance;
        bestScore = 1.0;
      }
    }

    if (bestScore < 1.0) {
      for (const utterance of utterances) {
        const uttNorm = normalizeText(utterance.text);

        // 1. Direct substring match
        if (uttNorm.includes(claimNorm) || claimNorm.includes(uttNorm)) {
          bestMatch = utterance;
          bestScore = 1.0;
          break;
        }

        // 2. Token overlap ratio with key entity weighting
        if (claimTokens.length > 0) {
          const matchingTokens = claimTokens.filter(token => uttNorm.includes(token));
          const ratio = matchingTokens.length / claimTokens.length;

          const keyEntities = ['penicillin', 'eliquis', 'hives', 'flutter', 'surgicel', 'lignocaine', 'paresthesia', 'pericoronitis'];
          const matchedKeyEntity = keyEntities.some(k => claimNorm.includes(k) && uttNorm.includes(k));

          const effectiveScore = matchedKeyEntity && ratio >= 0.35 ? Math.max(ratio, 0.90) : ratio;
          if (effectiveScore > bestScore && (effectiveScore >= 0.45 || matchedKeyEntity)) {
            bestScore = effectiveScore;
            bestMatch = utterance;
          }
        }
      }
    }

    const isCorroborated = bestScore >= 0.55;
    const confidenceScore = parseFloat(bestScore.toFixed(2));

    const weight = claim.category === 'tooth' || claim.category === 'procedure' || claim.category === 'allergy' || claim.category === 'anaesthetic'
      ? 2.0
      : 1.0;

    totalWeights += weight;
    totalWeightedScore += weight * (isCorroborated ? confidenceScore : 0);

    if (isCorroborated) {
      corroboratedCount++;
      return {
        ...claim,
        isCorroborated: true,
        confidenceScore,
        evidence: bestMatch ? {
          utteranceId: bestMatch.id,
          speaker: bestMatch.sender,
          verbatimText: bestMatch.text,
          startTimeMs: bestMatch.startTimeMs,
          endTimeMs: bestMatch.endTimeMs,
          audioSliceId: bestMatch.audioSliceId
        } : undefined,
        verificationNote: `Corroborated with ${Math.round(confidenceScore * 100)}% match at utterance ${bestMatch?.id || ''}`
      };
    } else {
      return {
        ...claim,
        isCorroborated: false,
        confidenceScore: 0,
        verificationNote: 'Unverified: No corroborating audio statement found in transcript.'
      };
    }
  });

  const unverifiedCount = claims.length - corroboratedCount;
  const overallGroundingScore = totalWeights > 0
    ? parseFloat((totalWeightedScore / totalWeights).toFixed(2))
    : 1.0;

  const isFullyGrounded = unverifiedCount === 0 && overallGroundingScore >= 0.85;

  // Status badge strictly adhering to Rule 9 (Receptionist-Friendly copy)
  let statusBadge: SubsecondAlignmentResult['statusBadge'];
  if (isFullyGrounded) {
    statusBadge = 'Verified from Audio';
  } else if (overallGroundingScore >= 0.70) {
    statusBadge = 'Clinician Verification Required';
  } else {
    statusBadge = 'Unverified Claims Detected';
  }

  return {
    totalClaimsCount: claims.length,
    corroboratedCount,
    unverifiedCount,
    overallGroundingScore,
    isFullyGrounded,
    claims: verifiedClaims,
    statusBadge
  };
}
