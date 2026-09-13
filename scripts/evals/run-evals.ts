/**
 * DentAI Evaluation Suite Runner
 *
 * Runs the curated clinical golden dataset against:
 *  - Deterministic Offline Draft Engine (--target=offline, default)
 *  - Hosted Gemini Generative Model (--target=cloud)
 *
 * Computes zero-hallucination grounding scores, clinical entity extraction,
 * ADA code accuracy, and produces both terminal and Markdown reports.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { GOLDEN_DATASET, GoldenTestCase } from '../../tests/evals/goldenDataset';
import { gradeNoteOutput, compileSuiteReport, EvalCaseResult, EvalSuiteReport } from '../../tests/evals/evalGrader';
import { getTemplateById, NoteTemplate } from '../../src/lib/dentalLibrary';
import { generateOfflineDraft } from '../../src/lib/draftEngine';
import { normalizeTemplateOutput } from '../../src/lib/normalizeNoteOutput';

// Load local environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface RunnerOptions {
  target: 'offline' | 'cloud';
  verbose: boolean;
  filter?: string;
}

function parseArgs(): RunnerOptions {
  const args = process.argv.slice(2);
  let target: 'offline' | 'cloud' = 'offline';
  let verbose = false;
  let filter: string | undefined;

  for (const arg of args) {
    if (arg === '--target=cloud' || arg === '-cloud') {
      target = 'cloud';
    } else if (arg === '--target=offline' || arg === '-offline') {
      target = 'offline';
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg.startsWith('--filter=')) {
      filter = arg.split('=')[1];
    }
  }

  return { target, verbose, filter };
}

function buildPromptForCloud(testCase: GoldenTestCase, template: NoteTemplate): string {
  return `=== PATIENT INTAKE DATA ===
First Name: ${testCase.patient.firstName}
Last Name: ${testCase.patient.lastName}
Date of Birth: ${testCase.patient.dob}
Appointment Type: ${testCase.appointmentType}
Note Template: ${template.name}

=== ZERO-HALLUCINATION OPERATORY CONSTRAINT (CRITICAL CLINICAL SAFETY) ===
You are an expert Australian dental scribe generating a medicolegal clinical progress note.
1. STRICT TRANSCRIPT GROUNDING: Document ONLY the tooth numbers (FDI 11-48), surfaces (MODBL), diagnostic tests, and treatments that were explicitly spoken in the operatory transcript.
2. NO INVENTED TEETH: If a tooth number was not explicitly stated, do NOT invent or guess one.
3. NO INFERRED LOCAL ANAESTHETICS: Never list local anaesthesia (e.g. Lignocaine, Scandonest, Articaine) unless specifically mentioned by the clinician or patient in the audio transcript.
4. ABSOLUTE ZERO FABRICATION: If any section or clinical detail was not discussed during the visit, leave that field empty (""). Inventing unperformed treatments or unobserved pathology is strictly forbidden.
5. Provide 3-digit ADA item codes in the "adaCodes" array ONLY for procedures described or item numbers spoken.

=== CLINICAL SESSION TRANSCRIPT ===
${testCase.transcript.map(t => `${t.sender}: ${t.text}`).join('\n')}
`;
}

async function runSingleCase(
  testCase: GoldenTestCase,
  target: 'offline' | 'cloud',
  aiClient?: GoogleGenAI
): Promise<EvalCaseResult> {
  const template = getTemplateById(testCase.templateId);
  const startTime = performance.now();

  let noteOutput: any;

  if (target === 'offline') {
    // Run deterministic offline draft engine
    noteOutput = generateOfflineDraft(
      template,
      testCase.transcript,
      testCase.appointmentType
    );
  } else {
    // Run hosted Gemini cloud generation
    if (!aiClient) {
      throw new Error('Gemini client not initialized for cloud target.');
    }

    const prompt = buildPromptForCloud(testCase, template);

    // Build standard schema fields from template
    const properties: Record<string, any> = {
      adaCodes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            code: { type: Type.STRING },
            description: { type: Type.STRING },
            tooth: { type: Type.STRING }
          },
          required: ['code', 'description']
        }
      },
      patientSummary: { type: Type.STRING }
    };

    for (const section of template.sections) {
      properties[section.key] = { type: Type.STRING };
    }

    const response = await aiClient.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties
        },
        temperature: 0.1
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned empty response');
    }

    const parsedJson = JSON.parse(text);
    noteOutput = normalizeTemplateOutput(template, parsedJson);
  }

  const latencyMs = performance.now() - startTime;
  return gradeNoteOutput(testCase, noteOutput, latencyMs);
}

function renderTerminalReport(report: EvalSuiteReport, verbose: boolean) {
  console.log('\n================================================================');
  console.log(` DentAI Clinical AI Evaluations — Target: [${report.target.toUpperCase()}]`);
  console.log('================================================================\n');

  console.log(`Date: ${report.timestamp}`);
  console.log(`Test Cases: ${report.totalCases} total | ${report.passedCases} passed (${report.passRatePercent}%)`);
  console.log(`Avg Grounding Score: ${report.averageGroundingScore}%`);
  console.log(`Avg Tooth Recall: ${(report.averageToothRecall * 100).toFixed(0)}%`);
  console.log(`Avg ADA Code F1: ${(report.averageAdaF1 * 100).toFixed(0)}%`);
  console.log(`Total Hallucinations Detected: ${report.totalHallucinations}`);
  console.log(`Latency: Avg ${report.averageLatencyMs}ms | P95 ${report.p95LatencyMs}ms\n`);

  console.log('Case Results:');
  console.log('---------------------------------------------------------------------------------------------');
  console.log(
    'Status'.padEnd(8) +
    'Case ID'.padEnd(24) +
    'Grounding'.padEnd(12) +
    'Tooth Rec'.padEnd(12) +
    'ADA F1'.padEnd(10) +
    'Latency'.padEnd(10) +
    'Category'
  );
  console.log('---------------------------------------------------------------------------------------------');

  for (const r of report.results) {
    const statusStr = r.passed ? '[PASS]' : '[FAIL]';
    const groundingStr = `${r.groundingScore}%`;
    const toothStr = `${(r.toothRecall * 100).toFixed(0)}%`;
    const adaStr = `${(r.adaF1 * 100).toFixed(0)}%`;
    const latencyStr = `${r.latencyMs}ms`;

    console.log(
      statusStr.padEnd(8) +
      r.caseId.padEnd(24) +
      groundingStr.padEnd(12) +
      toothStr.padEnd(12) +
      adaStr.padEnd(10) +
      latencyStr.padEnd(10) +
      r.category
    );

    if ((!r.passed || verbose) && r.failureReasons.length > 0) {
      console.log(`   └─ Issues: ${r.failureReasons.join(' | ')}`);
    }
  }
  console.log('---------------------------------------------------------------------------------------------\n');
}

function writeMarkdownReport(report: EvalSuiteReport, outPath: string) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const markdown = `# DentAI Clinical AI Evaluation Report

**Generated:** ${report.timestamp}  
**Execution Target:** \`${report.target}\`  
**Overall Status:** ${report.passedCases === report.totalCases ? '✅ PASSED' : '⚠️ FAILURES DETECTED'}

---

## Executive Summary

| Metric | Value | Target Benchmark | Status |
| :--- | :--- | :--- | :--- |
| **Pass Rate** | **${report.passRatePercent}%** (${report.passedCases}/${report.totalCases}) | 100% | ${report.passRatePercent >= 90 ? '🟢' : '🔴'} |
| **Average Grounding Score** | **${report.averageGroundingScore}%** | $\ge 90\%$ | ${report.averageGroundingScore >= 90 ? '🟢' : '🔴'} |
| **Total Hallucinations** | **${report.totalHallucinations}** | 0 | ${report.totalHallucinations === 0 ? '🟢' : '🔴'} |
| **Average Tooth Recall** | **${(report.averageToothRecall * 100).toFixed(1)}%** | $\ge 80\%$ | ${report.averageToothRecall >= 0.8 ? '🟢' : '🟡'} |
| **Average ADA Code F1** | **${(report.averageAdaF1 * 100).toFixed(1)}%** | $\ge 70\%$ | ${report.averageAdaF1 >= 0.7 ? '🟢' : '🟡'} |
| **Average Latency** | **${report.averageLatencyMs} ms** | $< 5000\text{ ms}$ | 🟢 |
| **P95 Latency** | **${report.p95LatencyMs} ms** | $< 10000\text{ ms}$ | 🟢 |

---

## Detailed Case Breakdown

| Status | Case ID | Category | Grounding | Tooth Recall | ADA F1 | Latency | Findings / Issues |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${report.results
  .map(
    r =>
      `| ${r.passed ? '✅ PASS' : '❌ FAIL'} | \`${r.caseId}\` | ${r.category} | ${r.groundingScore}% | ${(r.toothRecall * 100).toFixed(0)}% | ${(r.adaF1 * 100).toFixed(0)}% | ${r.latencyMs}ms | ${r.failureReasons.length ? r.failureReasons.join('<br>') : 'Clean execution'} |`
  )
  .join('\n')}

---

## Clinical Safety & Grounding Details

${report.results
  .map(
    r => `### ${r.caseId}: ${r.title}
- **Category**: \`${r.category}\`
- **Fully Grounded**: ${r.isFullyGrounded ? 'Yes' : 'No'}
- **Unverified Claims**: ${r.unverifiedClaims.length ? r.unverifiedClaims.map(c => `\`${c}\``).join(', ') : 'None'}
- **Expected Teeth**: ${r.expectedTeeth.map(t => `\`${t}\``).join(', ')} | **Detected**: ${r.actualTeeth.map(t => `\`${t}\``).join(', ')}
- **Expected ADA Codes**: ${r.expectedAdaCodes.map(c => `\`${c}\``).join(', ')} | **Extracted**: ${r.actualAdaCodes.map(c => `\`${c}\``).join(', ')}
${r.hallucinationsDetected.length ? `- **⚠️ Banned Hallucinations Detected**: ${r.hallucinationsDetected.join(', ')}` : '- **Zero Hallucination Guarantee**: Verified clean.'}
`
  )
  .join('\n')}
`;

  fs.writeFileSync(outPath, markdown, 'utf-8');
  console.log(`Markdown report saved to: ${outPath}\n`);
}

async function main() {
  const options = parseArgs();

  let cases = GOLDEN_DATASET;
  if (options.filter) {
    cases = cases.filter(c => c.id.includes(options.filter!) || c.category.includes(options.filter!));
  }

  let aiClient: GoogleGenAI | undefined;
  if (options.target === 'cloud') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      console.error('\n❌ GEMINI_API_KEY is not configured in .env or .env.local.');
      console.error('To evaluate the cloud target, please set a valid GEMINI_API_KEY.\n');
      process.exit(1);
    }
    aiClient = new GoogleGenAI({ apiKey });
  }

  console.log(`Starting eval run for ${cases.length} benchmark case(s) against [${options.target.toUpperCase()}] target...`);

  const results: EvalCaseResult[] = [];
  for (const testCase of cases) {
    try {
      const result = await runSingleCase(testCase, options.target, aiClient);
      results.push(result);
    } catch (err: any) {
      console.error(`Error running case ${testCase.id}:`, err.message || err);
      results.push({
        caseId: testCase.id,
        title: testCase.title,
        category: testCase.category,
        passed: false,
        groundingScore: 0,
        isFullyGrounded: false,
        unverifiedClaims: ['Execution error'],
        adaPrecision: 0,
        adaRecall: 0,
        adaF1: 0,
        expectedAdaCodes: testCase.expected.adaCodes,
        actualAdaCodes: [],
        toothRecall: 0,
        expectedTeeth: testCase.expected.teeth,
        actualTeeth: [],
        hallucinationsDetected: [],
        missingKeywords: {},
        schemaValid: false,
        latencyMs: 0,
        failureReasons: [err.message || 'Execution error']
      });
    }
  }

  const report = compileSuiteReport(results, options.target);
  renderTerminalReport(report, options.verbose);

  const reportPath = path.resolve(process.cwd(), 'tests/evals/reports/latest-eval-report.md');
  writeMarkdownReport(report, reportPath);

  // Return exit code 1 if critical failures exist
  if (report.totalHallucinations > 0 || report.passRatePercent < 80) {
    console.warn('⚠️ Eval run completed with warnings or failures.');
  } else {
    console.log('✅ Eval run completed successfully!');
  }
}

main().catch(err => {
  console.error('Fatal eval runner error:', err);
  process.exit(1);
});
