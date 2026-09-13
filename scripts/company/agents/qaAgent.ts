/**
 * Grokbot Autonomous QA & Clinical Safety Auditor Agent
 * 
 * Executes clinical evals benchmark, enforces zero-hallucination policies,
 * tooth number grounding (FDI standard), and generates clinical safety certificates.
 */

import { GOLDEN_DATASET, type GoldenTestCase } from '../../../tests/evals/goldenDataset.js';
import { gradeNoteOutput, compileSuiteReport, type EvalSuiteReport } from '../../../tests/evals/evalGrader.js';
import { getTemplateById } from '../../../src/lib/dentalLibrary.js';
import { generateOfflineDraft } from '../../../src/lib/draftEngine.js';

export interface ClinicalSafetyCertificate {
  certificateId: string;
  issuedAt: string;
  status: 'CERTIFIED_FOR_PRODUCTION' | 'BLOCKED_HALLUCINATION_DETECTED' | 'BLOCKED_ACCURACY_BELOW_THRESHOLD';
  totalCases: number;
  passedCases: number;
  hallucinationCount: number;
  avgGroundingScore: number;
  avgToothRecall: number;
  avgAdaCodeF1: number;
  summary: string;
}

export interface QaCycleResult {
  agentName: string;
  timestamp: string;
  evalSummary: EvalSuiteReport;
  safetyCertificate: ClinicalSafetyCertificate;
  productionReady: boolean;
}

export async function runQaAgent(target: 'offline' | 'cloud' = 'offline'): Promise<QaCycleResult> {
  const results = GOLDEN_DATASET.map((testCase: GoldenTestCase) => {
    const template = getTemplateById(testCase.templateId);
    const draft = generateOfflineDraft(
      template,
      testCase.transcript,
      testCase.appointmentType
    );
    return gradeNoteOutput(testCase, draft, 1);
  });

  const evalSummary = compileSuiteReport(results, target);

  const passedCases = evalSummary.passedCases;
  const totalCases = evalSummary.totalCases;
  const hallucinationCount = evalSummary.totalHallucinations;
  const avgGrounding = evalSummary.averageGroundingScore;

  let status: ClinicalSafetyCertificate['status'] = 'CERTIFIED_FOR_PRODUCTION';
  let summary = 'All clinical benchmark scenarios passed with 0 hallucinations and >= 90% grounding.';

  if (hallucinationCount > 0) {
    status = 'BLOCKED_HALLUCINATION_DETECTED';
    summary = `Release BLOCKED: ${hallucinationCount} unacceptable clinical hallucination(s) detected.`;
  } else if (passedCases < totalCases || avgGrounding < 90) {
    status = 'BLOCKED_ACCURACY_BELOW_THRESHOLD';
    summary = `Release BLOCKED: Only ${passedCases}/${totalCases} passed or grounding (${avgGrounding}%) is below 90% threshold.`;
  }

  const certificateId = `CERT-DENTAI-${Date.now().toString(36).toUpperCase()}-${target.toUpperCase()}`;

  const safetyCertificate: ClinicalSafetyCertificate = {
    certificateId,
    issuedAt: new Date().toISOString(),
    status,
    totalCases,
    passedCases,
    hallucinationCount,
    avgGroundingScore: evalSummary.averageGroundingScore,
    avgToothRecall: evalSummary.averageToothRecall,
    avgAdaCodeF1: evalSummary.averageAdaF1,
    summary
  };

  return {
    agentName: 'Grokbot QA & Clinical Safety Auditor',
    timestamp: new Date().toISOString(),
    evalSummary,
    safetyCertificate,
    productionReady: status === 'CERTIFIED_FOR_PRODUCTION'
  };
}
