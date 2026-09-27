/**
 * Phase 8 Clinical Gold-Set Evaluation CLI
 *
 * Usage:
 *   npm run eval:gold-set             # run and print the summary
 *   npm run eval:gold-set -- --json   # also write docs/reports/phase8-gold-set-report.json
 */
import { runGoldSetEvaluation } from '../src/lib/clinicalEvaluation/phase8Runner';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const writeJson = process.argv.includes('--json');

const report = runGoldSetEvaluation(200);

console.log(report.formattedSummary);

if (writeJson) {
  const dir = path.resolve(__dirname, '..', 'docs', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'phase8-gold-set-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nJSON report written to ${out}`);
}

// Operational response policy: regression fixtures are a hard gate.
if (report.regressionFailures.length > 0) {
  console.error('\nREGRESSION FIXTURE FAILURES:', report.regressionFailures.map(f => `${f.caseId} (${f.regressionFor})`).join(', '));
  process.exit(1);
}
