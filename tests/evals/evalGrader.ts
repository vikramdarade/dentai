import { GoldenTestCase } from './goldenDataset';
import {
  verifyTranscriptGrounding,
  extractToothNumbers,
  GroundingReport
} from '../../src/lib/transcriptGrounding';
import { getTemplateById } from '../../src/lib/dentalLibrary';

export interface EvalCaseResult {
  caseId: string;
  title: string;
  category: string;
  passed: boolean;
  groundingScore: number;
  isFullyGrounded: boolean;
  unverifiedClaims: string[];
  adaPrecision: number;
  adaRecall: number;
  adaF1: number;
  expectedAdaCodes: string[];
  actualAdaCodes: string[];
  toothRecall: number;
  expectedTeeth: string[];
  actualTeeth: string[];
  hallucinationsDetected: string[];
  missingKeywords: Record<string, string[]>;
  schemaValid: boolean;
  latencyMs: number;
  failureReasons: string[];
}

export interface EvalSuiteReport {
  timestamp: string;
  target: 'offline' | 'cloud';
  totalCases: number;
  passedCases: number;
  passRatePercent: number;
  averageGroundingScore: number;
  averageAdaF1: number;
  averageToothRecall: number;
  totalHallucinations: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  results: EvalCaseResult[];
}

/**
 * Normalizes any note output into a uniform flat text representation
 * and extracts all populated sections.
 */
export function extractNoteTextAndSections(output: any): {
  fullText: string;
  allSections: Record<string, string>;
  adaCodes: string[];
} {
  const allSections: Record<string, string> = {};
  const adaCodes: string[] = [];

  // 1. If wrapped in canonical / customSections (DraftResult)
  if (output?.canonical && typeof output.canonical === 'object') {
    for (const [k, v] of Object.entries(output.canonical)) {
      if (typeof v === 'string') allSections[k] = v;
    }
  }
  if (output?.customSections && typeof output.customSections === 'object') {
    for (const [k, v] of Object.entries(output.customSections)) {
      if (typeof v === 'string') allSections[k] = v;
    }
  }

  // 2. If top-level keys (NormalizedNoteOutput)
  for (const [k, v] of Object.entries(output || {})) {
    if (k === 'canonical' || k === 'customSections' || k === 'adaCodes' || k === 'proposedTreatments' || k === 'groundingReport') {
      continue;
    }
    if (typeof v === 'string' && v.trim().length > 0) {
      allSections[k] = v;
    }
  }

  // 3. Extract ADA codes
  const rawCodes = output?.adaCodes || [];
  if (Array.isArray(rawCodes)) {
    for (const item of rawCodes) {
      if (typeof item === 'string') {
        const match = item.match(/\b\d{3}\b/);
        if (match) adaCodes.push(match[0]);
      } else if (item && typeof item === 'object' && item.code) {
        const match = String(item.code).match(/\b\d{3}\b/);
        if (match) adaCodes.push(match[0]);
      }
    }
  }

  const fullText = Object.entries(allSections)
    .map(([key, val]) => `${key}: ${val}`)
    .join('\n');

  return { fullText, allSections, adaCodes };
}

/**
 * Grades a single generated clinical note against its Golden test case.
 */
export function gradeNoteOutput(
  testCase: GoldenTestCase,
  output: any,
  latencyMs: number = 0
): EvalCaseResult {
  const failureReasons: string[] = [];
  const { fullText, allSections, adaCodes } = extractNoteTextAndSections(output);
  const normalizedText = fullText.toLowerCase();

  // 1. Grounding & Zero-Hallucination Evaluation
  const groundingReport: GroundingReport = verifyTranscriptGrounding(
    fullText,
    testCase.transcript,
    adaCodes
  );

  // 2. Banned Hallucinations & Adversarial Injections Check
  const hallucinationsDetected: string[] = [];
  for (const banned of testCase.expected.unacceptableHallucinations) {
    if (normalizedText.includes(banned.toLowerCase())) {
      hallucinationsDetected.push(banned);
    }
  }

  if (hallucinationsDetected.length > 0) {
    failureReasons.push(`Hallucinations/leaks detected: ${hallucinationsDetected.join(', ')}`);
  }

  // 3. FDI Tooth Number Recall
  const actualTeeth = extractToothNumbers(fullText);
  const expectedTeeth = testCase.expected.teeth || [];
  let toothHits = 0;
  for (const tooth of expectedTeeth) {
    if (actualTeeth.includes(tooth)) {
      toothHits++;
    }
  }
  const toothRecall = expectedTeeth.length > 0 ? toothHits / expectedTeeth.length : 1.0;
  if (toothRecall < 0.7) {
    failureReasons.push(`Tooth recall low: ${(toothRecall * 100).toFixed(0)}% (expected: ${expectedTeeth.join(', ')}, found: ${actualTeeth.join(', ')})`);
  }

  // 4. ADA Billing Code Precision, Recall & F1
  const expectedAda = Array.from(new Set(testCase.expected.adaCodes || []));
  const actualAda = Array.from(new Set(adaCodes));

  let matchedAdaCount = 0;
  for (const code of actualAda) {
    if (expectedAda.includes(code)) {
      matchedAdaCount++;
    }
  }

  const adaPrecision = actualAda.length > 0 ? matchedAdaCount / actualAda.length : (expectedAda.length === 0 ? 1.0 : 0.0);
  const adaRecall = expectedAda.length > 0 ? matchedAdaCount / expectedAda.length : 1.0;
  const adaF1 = (adaPrecision + adaRecall > 0)
    ? (2 * (adaPrecision * adaRecall)) / (adaPrecision + adaRecall)
    : (expectedAda.length === 0 && actualAda.length === 0 ? 1.0 : 0.0);

  // 5. Template Schema Conformance
  const template = getTemplateById(testCase.templateId);
  let schemaValid = true;
  if (template) {
    // Check for JSON fence artifacts or unparsed markdown
    if (fullText.includes('```json') || fullText.includes('```')) {
      schemaValid = false;
      failureReasons.push('Leaked raw markdown code fences in output');
    }
  }

  // 6. Section Keyword Checks
  const missingKeywords: Record<string, string[]> = {};
  if (testCase.expected.requiredSectionKeywords) {
    for (const [sectionKey, keywords] of Object.entries(testCase.expected.requiredSectionKeywords)) {
      const sectionContent = (allSections[sectionKey] || '').toLowerCase();
      // Also check full text in case section was placed in customSections or alternate key
      const contentPool = sectionContent || normalizedText;
      const missing = keywords.filter(kw => !contentPool.includes(kw.toLowerCase()));
      if (missing.length === keywords.length && keywords.length > 0) {
        missingKeywords[sectionKey] = missing;
      }
    }
  }

  // Pass conditions:
  // - Zero prohibited hallucinations
  // - Grounding score >= 90%
  // - No critical schema corruption
  const passed = hallucinationsDetected.length === 0 &&
    groundingReport.groundingScore >= 90 &&
    schemaValid &&
    toothRecall >= 0.5;

  return {
    caseId: testCase.id,
    title: testCase.title,
    category: testCase.category,
    passed,
    groundingScore: groundingReport.groundingScore,
    isFullyGrounded: groundingReport.isFullyGrounded,
    unverifiedClaims: groundingReport.unverifiedClaims,
    adaPrecision: Math.round(adaPrecision * 100) / 100,
    adaRecall: Math.round(adaRecall * 100) / 100,
    adaF1: Math.round(adaF1 * 100) / 100,
    expectedAdaCodes: expectedAda,
    actualAdaCodes: actualAda,
    toothRecall: Math.round(toothRecall * 100) / 100,
    expectedTeeth,
    actualTeeth,
    hallucinationsDetected,
    missingKeywords,
    schemaValid,
    latencyMs: Math.round(latencyMs),
    failureReasons
  };
}

/**
 * Calculates aggregate stats across an entire evaluation run.
 */
export function compileSuiteReport(
  results: EvalCaseResult[],
  target: 'offline' | 'cloud'
): EvalSuiteReport {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const passRatePercent = total > 0 ? Math.round((passed / total) * 100) : 0;

  const avgGrounding = total > 0
    ? Math.round(results.reduce((acc, r) => acc + r.groundingScore, 0) / total)
    : 0;

  const avgAdaF1 = total > 0
    ? Math.round((results.reduce((acc, r) => acc + r.adaF1, 0) / total) * 100) / 100
    : 0;

  const avgToothRecall = total > 0
    ? Math.round((results.reduce((acc, r) => acc + r.toothRecall, 0) / total) * 100) / 100
    : 0;

  const totalHallucinations = results.reduce(
    (acc, r) => acc + r.hallucinationsDetected.length,
    0
  );

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const avgLatency = total > 0
    ? Math.round(latencies.reduce((acc, l) => acc + l, 0) / total)
    : 0;

  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Latency = latencies[p95Index] || latencies[latencies.length - 1] || 0;

  return {
    timestamp: new Date().toISOString(),
    target,
    totalCases: total,
    passedCases: passed,
    passRatePercent,
    averageGroundingScore: avgGrounding,
    averageAdaF1: avgAdaF1,
    averageToothRecall: avgToothRecall,
    totalHallucinations,
    averageLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    results
  };
}
