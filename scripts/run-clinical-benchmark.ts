#!/usr/bin/env tsx
/**
 * Standalone Clinical Benchmark Audit CLI (Work Package 6.4)
 *
 * Usage:
 *   npx tsx scripts/run-clinical-benchmark.ts
 */

import { runAllClinicalBenchmarks } from '../src/benchmark/runner';

console.log('================================================================================');
console.log(' DENTAI CLINICAL ACCURACY ENGINE — AUSTRALIAN OPERATORY GOLDEN-SET BENCHMARK');
console.log(' AHPRA, Dental Board of Australia (DBA) & Rogers v Whitaker Evidentiary Audit');
console.log('================================================================================\n');

const summary = runAllClinicalBenchmarks();

console.log(`Evaluated ${summary.totalCases} Golden-Set Operatory Encounters:\n`);

console.log(
  '| ID      | Discipline            | Accent             | Noise Condition         | WER (%) | FDI Prec | FDI Rec | Latency | Status |'
);
console.log(
  '|---------|-----------------------|--------------------|-------------------------|---------|----------|---------|---------|--------|'
);

for (const res of summary.caseResults) {
  const idCol = res.caseId.padEnd(7);
  const discCol = res.discipline.padEnd(21);
  const accentCol = res.accentCondition.replace(/_/g, ' ').slice(0, 18).padEnd(18);
  const noiseCol = res.acousticCondition.replace(/_/g, ' ').slice(0, 23).padEnd(23);
  const werCol = `${(res.wer.wordErrorRate * 100).toFixed(1)}%`.padEnd(7);
  const fdiPCol = `${(res.fdi.precision * 100).toFixed(1)}%`.padEnd(8);
  const fdiRCol = `${(res.fdi.recall * 100).toFixed(1)}%`.padEnd(7);
  const latCol = `${res.latencyMs}ms`.padEnd(7);
  const statusCol = res.passed ? 'PASS' : 'FAIL';

  console.log(
    `| ${idCol} | ${discCol} | ${accentCol} | ${noiseCol} | ${werCol} | ${fdiPCol} | ${fdiRCol} | ${latCol} | ${statusCol}   |`
  );
}

console.log('\n--------------------------------------------------------------------------------');
console.log(' QUANTITATIVE AUDIT SUMMARY & REGULATORY COMPLIANCE VERDICT:');
console.log('--------------------------------------------------------------------------------');
console.log(`Cases Passing Criteria           : ${summary.passedCases} / ${summary.totalCases} (${((summary.passedCases / summary.totalCases) * 100).toFixed(1)}%)`);
console.log(`Clinical Concept Word Error Rate : ${(summary.averageWER * 100).toFixed(2)}% (Target: <= 3.5%) -> ${summary.averageWER <= 0.035 ? 'PASS' : 'FAIL'}`);
console.log(`FDI Tooth Notation Precision     : ${(summary.overallFdiPrecision * 100).toFixed(2)}% (Target: >= 99.0%) -> ${summary.overallFdiPrecision >= 0.99 ? 'PASS' : 'FAIL'}`);
console.log(`FDI Tooth Notation Recall        : ${(summary.overallFdiRecall * 100).toFixed(2)}% (Target: >= 99.0%) -> ${summary.overallFdiRecall >= 0.99 ? 'PASS' : 'FAIL'}`);
console.log(`Critical Pharmacology Sensitivity: ${(summary.pharmacologySensitivity * 100).toFixed(1)}% (Target: 100.0%) -> ${summary.pharmacologySensitivity === 1.0 ? 'PASS' : 'FAIL'}`);
console.log(`Average Synthesis Latency        : ${summary.averageLatencyMs.toFixed(1)}ms (Target: < 4000ms) -> ${summary.averageLatencyMs < 4000 ? 'PASS' : 'FAIL'}`);
console.log('--------------------------------------------------------------------------------');

if (summary.isCompliant) {
  console.log('VERDICT: AHPRA & DBA CLINICAL ACCURACY STANDARDS FULLY SATISFIED.');
  process.exit(0);
} else {
  console.error('VERDICT: BENCHMARK FAILED TO MEET MANDATED CLINICAL ACCURACY CRITERIA.');
  process.exit(1);
}
