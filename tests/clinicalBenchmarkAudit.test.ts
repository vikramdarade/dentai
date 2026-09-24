/**
 * Work Package 6.0: Clinical Benchmark & Golden-Set Audit Test Suite
 *
 * Verifies that the complete 20 multi-condition Australian operatory golden-set
 * satisfies all AHPRA, Dental Board of Australia (DBA), and Rogers v Whitaker
 * accuracy metrics:
 * 1. Clinical Concept Word Error Rate (WER) <= 3.5%
 * 2. ISO 3950 FDI Tooth Notation Precision >= 99.0%
 * 3. ISO 3950 FDI Tooth Notation Recall >= 99.0%
 * 4. Critical Pharmacology Alert Sensitivity == 100%
 * 5. Chairside Note Synthesis Latency < 4000ms
 */

import { describe, it, expect } from 'vitest';
import { runAllClinicalBenchmarks, runSingleBenchmarkCase } from '../src/benchmark/runner';
import { GOLDEN_SET_BENCHMARK_CASES } from '../src/benchmark/goldenSet';
import { calculateWER } from '../src/benchmark/wer';
import { extractFdiTeethFromText, evaluateFdiPrecisionRecall } from '../src/benchmark/fdiEvaluator';

describe('Work Package 6.0: Clinical Accuracy Golden-Set Benchmark Suite', () => {
  it('should have exactly 20 diverse Australian operatory golden-set test cases', () => {
    expect(GOLDEN_SET_BENCHMARK_CASES).toHaveLength(20);

    const disciplines = new Set(GOLDEN_SET_BENCHMARK_CASES.map(c => c.discipline));
    expect(disciplines.size).toBeGreaterThanOrEqual(8);

    const noiseConditions = new Set(GOLDEN_SET_BENCHMARK_CASES.map(c => c.acousticCondition));
    expect(noiseConditions.has('turbine_handpiece_noise')).toBe(true);
    expect(noiseConditions.has('high_volume_suction')).toBe(true);
    expect(noiseConditions.has('ultrasonic_scaler_noise')).toBe(true);
    expect(noiseConditions.has('muffled_ppe_surgical_mask')).toBe(true);
  });

  describe('WP 6.2: Dynamic Programming Levenshtein WER Engine', () => {
    it('should compute exact Levenshtein substitutions, deletions, and insertions', () => {
      const ref = ['composite', 'restoration', 'tooth', '36'];
      const hyp = ['composite', 'resin', 'tooth', '36']; // 1 substitution: restoration -> resin

      const res = calculateWER(ref, hyp);
      expect(res.referenceWordCount).toBe(4);
      expect(res.substitutions).toBe(1);
      expect(res.deletions).toBe(0);
      expect(res.insertions).toBe(0);
      expect(res.wordErrorRate).toBe(0.25);
    });

    it('should report zero error on identical sequences', () => {
      const ref = ['irreversible', 'pulpitis', 'articaine', 'ledermix'];
      const res = calculateWER(ref, ref);
      expect(res.wordErrorRate).toBe(0);
      expect(res.conceptAccuracy).toBe(1.0);
    });
  });

  describe('WP 6.3: ISO 3950 FDI Precision & Recall Evaluator', () => {
    it('should extract FDI teeth and exclude units, percentages, and durations', () => {
      const clinicalText = 'Treated tooth 16 and tooth 26. Administered 2.2ml lignocaine for 45 minutes with 35% peroxide.';
      const teeth = extractFdiTeethFromText(clinicalText);

      expect(teeth).toEqual([16, 26]);
      expect(teeth).not.toContain(45);
      expect(teeth).not.toContain(35);
      expect(teeth).not.toContain(22);
    });

    it('should calculate 100% precision and recall when extracted matches expected exactly', () => {
      const expected = [11, 12, 21];
      const extracted = [11, 12, 21];
      const evalResult = evaluateFdiPrecisionRecall(expected, extracted);

      expect(evalResult.precision).toBe(1.0);
      expect(evalResult.recall).toBe(1.0);
      expect(evalResult.f1Score).toBe(1.0);
      expect(evalResult.falsePositives).toBe(0);
      expect(evalResult.falseNegatives).toBe(0);
    });

    it('should penalize false positive hallucinations and false negative omissions', () => {
      const expected = [36];
      const extracted = [36, 46]; // 46 is hallucinated/unrelated
      const evalResult = evaluateFdiPrecisionRecall(expected, extracted);

      expect(evalResult.precision).toBe(0.5);
      expect(evalResult.recall).toBe(1.0);
      expect(evalResult.falsePositives).toBe(1);
    });
  });

  describe('WP 6.4: Full 20-Case Australian Operatory Compliance Audit', () => {
    const summary = runAllClinicalBenchmarks();

    it('should satisfy Clinical Concept Word Error Rate (WER <= 3.5%)', () => {
      expect(summary.averageWER).toBeLessThanOrEqual(0.035);
    });

    it('should satisfy ISO 3950 FDI Tooth Notation Precision (>= 99.0%)', () => {
      expect(summary.overallFdiPrecision).toBeGreaterThanOrEqual(0.99);
    });

    it('should satisfy ISO 3950 FDI Tooth Notation Recall (>= 99.0%)', () => {
      expect(summary.overallFdiRecall).toBeGreaterThanOrEqual(0.99);
    });

    it('should achieve 100% Critical Pharmacology Alert Sensitivity', () => {
      expect(summary.pharmacologySensitivity).toBe(1.0);
    });

    it('should maintain average chairside note delivery latency under 4000ms', () => {
      expect(summary.averageLatencyMs).toBeLessThan(4000);
    });

    it('should achieve 100% pass rate across all 20 golden-set clinical cases', () => {
      expect(summary.passedCases).toBe(20);
      expect(summary.failedCases).toBe(0);
      expect(summary.isCompliant).toBe(true);
    });

    it('should correctly trigger Warfarin bleeding alert in Case 14', () => {
      const case14 = GOLDEN_SET_BENCHMARK_CASES.find(c => c.id === 'case-14')!;
      const result = runSingleBenchmarkCase(case14);

      expect(result.pharmacology.expectedAlertCount).toBeGreaterThan(0);
      expect(result.pharmacology.detectedAlertCount).toBe(result.pharmacology.expectedAlertCount);
      expect(result.pharmacology.sensitivity).toBe(1.0);
    });

    it('should correctly trigger Prolia/Denosumab MRONJ alert in Case 15', () => {
      const case15 = GOLDEN_SET_BENCHMARK_CASES.find(c => c.id === 'case-15')!;
      const result = runSingleBenchmarkCase(case15);

      expect(result.pharmacology.expectedAlertCount).toBeGreaterThan(0);
      expect(result.pharmacology.detectedAlertCount).toBe(result.pharmacology.expectedAlertCount);
      expect(result.pharmacology.sensitivity).toBe(1.0);
    });

    it('should correctly trigger Penicillin allergy contraindication in Case 16', () => {
      const case16 = GOLDEN_SET_BENCHMARK_CASES.find(c => c.id === 'case-16')!;
      const result = runSingleBenchmarkCase(case16);

      expect(result.pharmacology.expectedAlertCount).toBeGreaterThan(0);
      expect(result.pharmacology.detectedAlertCount).toBe(result.pharmacology.expectedAlertCount);
      expect(result.pharmacology.sensitivity).toBe(1.0);
    });
  });
});
