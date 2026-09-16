/**
 * Clinical accuracy gate — CLI.
 *
 * Usage:
 *   bun run eval:notes --offline --min-score 0.9     # CI: score recorded outputs
 *   bun run eval:notes --min-score 0.9              # same, explicit
 *   bun run eval:notes --list                       # show fixtures and scores
 *
 * Live mode (regenerate through a running deployment, then score — this is the
 * run to do after changing a prompt, model or template):
 *   DENTAI_EVAL_BASE_URL=https://app.example \
 *   DENTAI_EVAL_TOKEN=<a session token> \
 *   DENTAI_EVAL_CLINIC_ID=<clinic id> \
 *   bun run eval:notes --live --min-score 0.9
 *
 * Exit code 0 means every fixture passed at or above the threshold and no
 * safety gate fired. Anything else fails the build, which is the point: a
 * change that makes notes worse should not reach a clinic.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  scoreGeneration,
  summariseResults,
  type EvalFixture,
  type GenerationLike,
} from '../src/lib/clinicalEval';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '..', 'tests', 'fixtures', 'clinical-eval');

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(name);

function loadFixtures(): EvalFixture[] {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf-8')) as EvalFixture);
}

/** The generation to score: the committed recording, or a fresh one from a deployment. */
async function generationFor(fixture: EvalFixture, live: boolean): Promise<GenerationLike> {
  if (!live) return fixture.recorded as unknown as GenerationLike;

  const baseUrl = (process.env.DENTAI_EVAL_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.DENTAI_EVAL_TOKEN || '';
  const clinicId = process.env.DENTAI_EVAL_CLINIC_ID || '';
  if (!baseUrl || !token) {
    throw new Error(
      'Live mode needs DENTAI_EVAL_BASE_URL and DENTAI_EVAL_TOKEN (a signed-in session token). ' +
        'Use --offline to score the recorded generations instead.'
    );
  }

  const submit = await fetch(`${baseUrl}/api/notes/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      intakeData: fixture.intake,
      transcript: fixture.transcript,
      clinicId: clinicId || undefined,
    }),
  });
  if (!submit.ok) {
    throw new Error(`Job submission failed for ${fixture.id}: HTTP ${submit.status}`);
  }
  const { jobId } = (await submit.json()) as { jobId: string };

  // The worker is durable, so poll patiently rather than assuming it is instant.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const poll = await fetch(`${baseUrl}/api/notes/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!poll.ok) continue;
    const job: any = await poll.json();
    if (job.status === 'done' && job.result) {
      return {
        fields: job.result.findings || job.result.canonical || {},
        patientSummary: job.result.patientSummary,
        adaCodes: job.result.findings?.adaCodes || job.result.adaCodes || [],
        needsReview: !!job.result.noteOrigin?.needsReview,
      };
    }
    if (job.status === 'failed' || job.status === 'metered') {
      throw new Error(`Job for ${fixture.id} ended as ${job.status}: ${job.error || ''}`);
    }
  }
  throw new Error(`Timed out waiting for the note job for ${fixture.id}.`);
}

async function main(): Promise<void> {
  const live = has('--live') && !has('--offline');
  const minScore = Number(flag('--min-score') ?? 0.9);
  const fixtures = loadFixtures();

  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURE_DIR}.`);
    process.exit(1);
  }

  console.log(
    `DentAI clinical eval — ${fixtures.length} fixture(s), ` +
      `${live ? 'live regeneration' : 'recorded outputs'}, minimum score ${minScore}\n`
  );

  const results = [];
  for (const fixture of fixtures) {
    const generation = await generationFor(fixture, live);
    const result = scoreGeneration(fixture, generation);
    results.push(result);
    const status = result.passed && result.score >= minScore ? 'PASS' : 'FAIL';
    console.log(`${status}  ${fixture.id}  score ${result.score.toFixed(3)}  — ${fixture.description}`);
    for (const violation of result.violations) {
      console.log(`        [${violation.kind}] ${violation.detail}`);
    }
  }

  const summary = summariseResults(results, minScore);
  console.log(
    `\nPassed ${summary.passed}/${summary.fixtures} · average score ${summary.averageScore} · ` +
      `safety failures ${summary.safetyFailures}`
  );
  if (summary.worst.length > 0) {
    console.log('Weakest fixtures:');
    for (const worst of summary.worst) {
      console.log(`  ${worst.fixtureId} (${worst.score}): ${worst.detail}`);
    }
  }

  const failed = summary.passed !== summary.fixtures || summary.safetyFailures > 0;
  if (failed) {
    console.error(
      '\nClinical eval FAILED. A change that lowers note accuracy, drops a clinical fact or ' +
        'introduces unsupported content must not ship. See docs/runbooks/clinical-eval.md.'
    );
    process.exit(1);
  }
  console.log('\nClinical eval passed.');
}

main().catch((err) => {
  console.error('Clinical eval could not run:', err?.message || err);
  process.exit(1);
});
