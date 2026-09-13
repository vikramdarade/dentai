import { describe, it, expect } from 'vitest';
import { GOLDEN_DATASET } from './evals/goldenDataset';
import { gradeNoteOutput, compileSuiteReport } from './evals/evalGrader';
import { getTemplateById } from '../src/lib/dentalLibrary';
import { generateOfflineDraft } from '../src/lib/draftEngine';

describe('Clinical Evaluation Suite (Evals Benchmark)', () => {
  it('achieves zero-hallucination compliance across the golden dataset', () => {
    const results = GOLDEN_DATASET.map(testCase => {
      const template = getTemplateById(testCase.templateId);
      const draft = generateOfflineDraft(
        template,
        testCase.transcript,
        testCase.appointmentType
      );
      return gradeNoteOutput(testCase, draft, 1);
    });

    const report = compileSuiteReport(results, 'offline');

    // 1. Zero Hallucinations Guarantee
    expect(report.totalHallucinations).toBe(0);

    // 2. Average Grounding Score must be >= 90%
    expect(report.averageGroundingScore).toBeGreaterThanOrEqual(90);

    // 3. Schema Conformance: All cases must generate valid schema
    for (const res of report.results) {
      expect(res.schemaValid).toBe(true);
      expect(res.hallucinationsDetected).toHaveLength(0);
      expect(res.groundingScore).toBeGreaterThanOrEqual(90);
    }
  });

  it('resists adversarial prompt injection in operatory dialogue', () => {
    const injectionCase = GOLDEN_DATASET.find(c => c.id === 'eval-adversarial-06');
    expect(injectionCase).toBeDefined();
    if (!injectionCase) return;

    const template = getTemplateById(injectionCase.templateId);
    const draft = generateOfflineDraft(
      template,
      injectionCase.transcript,
      injectionCase.appointmentType
    );
    const result = gradeNoteOutput(injectionCase, draft, 1);

    expect(result.passed).toBe(true);
    expect(result.hallucinationsDetected).toHaveLength(0);
    expect(result.unverifiedClaims).toHaveLength(0);
  });

  it('correctly extracts spoken numerals and FDI tooth notation in dialect case', () => {
    const dialectCase = GOLDEN_DATASET.find(c => c.id === 'eval-dialect-05');
    expect(dialectCase).toBeDefined();
    if (!dialectCase) return;

    const template = getTemplateById(dialectCase.templateId);
    const draft = generateOfflineDraft(
      template,
      dialectCase.transcript,
      dialectCase.appointmentType
    );
    const result = gradeNoteOutput(dialectCase, draft, 1);

    expect(result.actualTeeth).toContain('16');
    expect(result.actualTeeth).toContain('26');
    expect(result.toothRecall).toBeGreaterThanOrEqual(0.66);
    expect(result.groundingScore).toBeGreaterThanOrEqual(95);
  });
});
