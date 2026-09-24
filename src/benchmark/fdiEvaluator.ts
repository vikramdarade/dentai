/**
 * ISO 3950 FDI Tooth Notation Precision & Recall Evaluator (Work Package 6.3)
 *
 * Validates international ISO 3950 two-digit dental notation across:
 * - Permanent Dentition (11–18, 21–28, 31–38, 41–48)
 * - Deciduous (Primary) Dentition (51–55, 61–65, 71–75, 81–85)
 *
 * Measures:
 * - True Positives (TP): Correctly identified teeth matching clinical ground truth
 * - False Positives (FP): Hallucinated or incorrectly identified tooth numbers
 * - False Negatives (FN): Teeth discussed in audio that were omitted from documentation
 *
 * Target: Precision >= 99.0%, Recall >= 99.0%
 */

import { isValidFdiTooth } from '../lib/fdiNotationEngine';
import type { FdiMetrics } from './types';

/**
 * Extracts all unique FDI tooth numbers present in text or structured clinical fields.
 * Strictly excludes numbers that are percentages, durations, dosages, or measurement units.
 */
export function extractFdiTeethFromText(text: string): number[] {
  const validTeeth = new Set<number>();

  // 1. Explicit dental context matches:
  // e.g. "tooth 16", "teeth 11, 12, 13", "socket 48", "incisors 31, 32, 41, 42", "#16", "t16"
  const dentalContextRegex = /\b(?:tooth|teeth|socket|incisor|incisors|canine|canines|premolar|premolars|molar|molars|quadrant|#|t)\s*([1-8][1-8](?:\s*[,/&y-]\s*[1-8][1-8])*)/gi;
  let dMatch: RegExpExecArray | null;
  while ((dMatch = dentalContextRegex.exec(text)) !== null) {
    const numbersInMatch = dMatch[1].match(/[1-8][1-8]/g) || [];
    for (const numStr of numbersInMatch) {
      const num = parseInt(numStr, 10);
      if (isValidFdiTooth(num)) {
        validTeeth.add(num);
      }
    }
  }

  // 2. Scan all 2-digit candidate sequences and apply unit/clinical boundary filtering:
  // Reject:
  // - Percentages: 35%, 25%
  // - Durations: 15-minute, 45 minutes, 30 seconds, 5 days, 2 weeks, 3 months
  // - Dosages/Weights/Volumes: 300mg, 2.2ml, 4.5mm, 6 millimetres, 27 gauge
  // - Ratios: 1:80,000
  // - Hyphenated codes or sutures: 3-0 silk
  const candidateMatches = text.matchAll(/(?<![\d.:/–-])\b([1-8][1-8])\b(?![\d.:/–-])/g);
  for (const c of candidateMatches) {
    const num = parseInt(c[1], 10);
    if (!isValidFdiTooth(num)) continue;

    const afterContext = text.slice(c.index! + c[0].length, c.index! + c[0].length + 20).toLowerCase();
    const isUnitOrMetric = /^\s*(?:%|percent|min|minute|sec|second|hr|hour|day|week|month|year|mg|ml|mm|cm|gauge|millilit|millimet)/.test(afterContext);

    const beforeContext = text.slice(Math.max(0, c.index! - 20), c.index!).toLowerCase();
    const isPrefixedByNonDental = /(?:for|in|every|cycle|cycles|after|over|within|approx|gauge|about|topical|ratio)\s*$/.test(beforeContext);

    if (!isUnitOrMetric && !isPrefixedByNonDental) {
      // In clinical text, if a 2-digit number is not preceded by dental context,
      // only accept if it appears in structured listing or has dental context nearby
      const surroundingContext = (beforeContext + ' ' + afterContext).toLowerCase();
      const hasDentalContext = /(?:tooth|teeth|socket|incisor|canine|premolar|molar|quadrant|dentition|restoration|fdi|root|canal|cusp|amalgam|composite|extraction|caries|splint)/.test(surroundingContext);

      if (hasDentalContext || validTeeth.has(num)) {
        validTeeth.add(num);
      }
    }
  }

  return Array.from(validTeeth).sort((a, b) => a - b);
}

/**
 * Evaluates FDI precision, recall, and F1-score against the golden-set ground truth.
 */
export function evaluateFdiPrecisionRecall(
  expectedTeeth: number[],
  extractedTeeth: number[]
): FdiMetrics {
  const expectedSet = new Set(expectedTeeth);
  const extractedSet = new Set(extractedTeeth);

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const t of extractedSet) {
    if (expectedSet.has(t)) {
      truePositives++;
    } else {
      falsePositives++;
    }
  }

  for (const t of expectedSet) {
    if (!extractedSet.has(t)) {
      falseNegatives++;
    }
  }

  const precision = (truePositives + falsePositives) === 0
    ? (falseNegatives === 0 ? 1.0 : 0.0)
    : truePositives / (truePositives + falsePositives);

  const recall = (truePositives + falseNegatives) === 0
    ? 1.0
    : truePositives / (truePositives + falseNegatives);

  const f1Score = (precision + recall) === 0
    ? 0.0
    : (2 * precision * recall) / (precision + recall);

  return {
    expectedTeeth,
    extractedTeeth,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1Score: Number(f1Score.toFixed(4))
  };
}
