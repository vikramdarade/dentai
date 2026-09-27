/**
 * Phase 12 Gate 10 — rollback verification (two-phase, real process boundary).
 *
 * Validates the testable parts of the Phase 11 rollback model:
 *
 *   Run 1: boot the app, write a synthetic record + audit events, print the
 *          state to a file, exit.
 *   Run 2 (a genuinely fresh process): verify the additive migration chain is
 *          intact and a no-op (schema stays in place), boot the app against
 *          the existing schema, check health + version, log back in, read the
 *          previous run's record, and verify the audit chain.
 *
 * The literal "redeploy the previous artifact" step (step 1 of the Phase 11
 * model) cannot be exercised here — no previous production artifact exists in
 * this repository — and is documented as technically validated, not tested,
 * in the Phase 12 report.
 *
 * Run:
 *   node scripts/phase12-rollback-check.ts            (runs both phases)
 *   DENTAI_E2E_DATABASE_URL=postgres://… node scripts/phase12-rollback-check.ts
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SERVER_URL = pathToFileURL(path.resolve(import.meta.dirname, '..', 'server.ts')).href;

const DB_URL = process.env.DENTAI_E2E_DATABASE_URL || '';
if (!DB_URL) {
  console.error('Set DENTAI_E2E_DATABASE_URL to a disposable database.');
  process.exit(1);
}

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

const stateFile = path.join(os.tmpdir(), `dentai-rollback-state-${Date.now()}.json`);

/** Phase 1 runs in a child process so Phase 2 is a genuine fresh boot. */
function runPhase1(): { id: string; name: string } {
  const script = `
    import crypto from 'node:crypto';
    import fs from 'node:fs';
    // test-mode + DENTAI_TEST_DATABASE_URL: the same pattern as the vitest
    // postgres suite — skips the Vite dev-mode boot and still uses a real DB.
    process.env.NODE_ENV = 'test';
    process.env.DENTAI_TEST_DATABASE_URL = ${JSON.stringify(DB_URL)};
    process.env.DENTAI_OPS_SECRET = 'phase12-ops-secret';
    (async () => {
      const { app } = await import(${JSON.stringify(SERVER_URL)});
      const request = (await import('supertest')).default;
      // Fixed account: register once, then reuse via login — repeated runs
      // would otherwise trip the registration rate limit.
      const name = 'Rollback Probe Operator';
      const profiles = await request(app).get('/api/auth/profiles');
      const existing = (profiles.body || []).find((p) => p.name === name);
      let token;
      if (!existing) {
        const reg = await request(app).post('/api/auth/register').send({ name, specialty: 'General', pin: '2718' });
        if (reg.status !== 201) throw new Error('register failed ' + reg.status + ' ' + JSON.stringify(reg.body).slice(0, 120));
        token = reg.body.token;
      } else {
        const login = await request(app).post('/api/auth/login').send({ dentistId: existing.id, pin: '2718' });
        if (login.status !== 200) throw new Error('login failed ' + login.status + ' ' + JSON.stringify(login.body).slice(0, 120));
        token = login.body.token;
      }
      const auth = { Authorization: 'Bearer ' + token };
      // Reuse the probe record on re-runs; create it (with a clinical payload)
      // on the first run.
      const existingList = await request(app).get('/api/consultations').set(auth);
      const prior = (existingList.body || []).find((c) => c.lastName === 'Probe');
      let id;
      if (prior) {
        id = prior.id;
        // Older runs of this probe predate the findings payload — bring the
        // record up to the full clinical shape so the boundary check is real.
        if (!prior.findings) {
          const upd = await request(app).put('/api/consultations/' + id).set(auth).send({
            expectedVersion: prior.recordVersion ?? 1,
            findings: { chiefComplaint: 'Routine review.', history: '', toothFindings: 'No caries.', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: 'Review routine.', recallRequirements: '', adaCodes: [] },
          });
          if (![200, 201].includes(upd.status)) throw new Error('probe update failed ' + upd.status);
        }
      } else {
        const created = await request(app).post('/api/consultations').set(auth).send({
          firstName: 'Rollback', lastName: 'Probe', dob: '1960-06-06', date: 'Sep 27', time: '10:00',
          appointmentType: 'examination', templateId: 'standard',
          transcript: [{ sender: 'Dentist', text: 'No caries. Review routine.' }],
          consentObtained: true,
          findings: { chiefComplaint: 'Routine review.', history: '', toothFindings: 'No caries.', findingsGingival: '', diagnosis: '', treatmentPerformed: '', recommendations: 'Review routine.', recallRequirements: '', adaCodes: [] },
        });
        if (![200, 201].includes(created.status)) throw new Error('seed failed ' + created.status + ' ' + JSON.stringify(created.body).slice(0, 160));
        id = created.body.id;
      }
      fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({ id, name }));
    })().catch(e => { console.error(e); process.exit(1); });
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: process.env,
    cwd: path.resolve(import.meta.dirname, '..'),
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`phase 1 failed: STDOUT=${r.stdout?.slice(-1500) || '(none)'} STDERR=${r.stderr?.slice(-1500) || '(none)'}`);
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function sh(cmd: string) {
  return execSync(cmd, { encoding: 'utf8', env: { ...process.env, DATABASE_URL: DB_URL } }).trim();
}

async function main() {
  console.log('phase 1: writing state in a first process…');
  const state = runPhase1();
  console.log(`  seeded ${state.id} as ${state.name}\n`);

  console.log('phase 2: fresh process — validating the rollback model…');
  // Step 2/3 of the model: additive migrations remain in place, nothing pending.
  const statusBefore = sh('npx tsx scripts/migrate.ts status');
  check(/3\/3/.test(statusBefore), 'migration status is 3/3 before restart (additive schema in place)');
  const reapply = sh('npx tsx scripts/migrate.ts');
  check(/Nothing to do/i.test(reapply), 'migration re-run is a no-op (no destructive rollback attempted)');

  // Step 4/5/6: boot the app fresh against the existing schema and data.
  const script = `
    // test-mode + DENTAI_TEST_DATABASE_URL: the same pattern as the vitest
    // postgres suite — skips the Vite dev-mode boot and still uses a real DB.
    process.env.NODE_ENV = 'test';
    process.env.DENTAI_TEST_DATABASE_URL = ${JSON.stringify(DB_URL)};
    process.env.DENTAI_OPS_SECRET = 'phase12-ops-secret';
    let failures = 0;
    const check = (c, m) => { console.log('  ' + (c ? 'PASS' : 'FAIL') + ': ' + m); if (!c) failures++; };
    (async () => {
      const { app } = await import(${JSON.stringify(SERVER_URL)});
      const request = (await import('supertest')).default;
      const health = await request(app).get('/api/health');
      check(health.status === 200 && health.body.database === 'ok', 'fresh process starts against the existing schema (health ' + health.status + ', db ' + health.body.database + ')');
      check(health.body.version === '0.1.0-rc.1', 'fresh process reports release version (got ' + health.body.version + ')');
      const profiles = await request(app).get('/api/auth/profiles');
      const prof = (profiles.body || []).find((p) => p.name === ${JSON.stringify(state.name)});
      check(!!prof, 'practitioner profile from the previous run is discoverable');
      const login = await request(app).post('/api/auth/login').send({ dentistId: prof.id, pin: '2718' });
      check(login.status === 200, 'login works against the preserved account store (' + login.status + ')');
      const list = await request(app).get('/api/consultations').set({ Authorization: 'Bearer ' + login.body.token });
      const found = (list.body || []).find((c) => c.id === ${JSON.stringify(state.id)});
      check(!!found, 'record written by the previous process remains readable');
      check(!!found?.findings && Array.isArray(found.transcript) && found.transcript.length > 0, 'clinical payload survived the process boundary');
      const ops = { 'x-dentai-ops-secret': 'phase12-ops-secret' };
      const verify = await request(app).get('/api/ops/audit/verify?limit=5000').set(ops);
      check(verify.body?.tampered?.length === 0 && verify.body?.unchained?.length === 0, 'audit chain tamper-evident across the process boundary (checked ' + verify.body?.checked + ')');
      console.log('PHASE2_FAILURES:' + failures);
    })().catch(e => { console.error(e); process.exit(1); });
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: process.env,
    cwd: path.resolve(import.meta.dirname, '..'),
    timeout: 120_000,
  });
  console.log(r.stdout);
  if (r.status !== 0) {
    console.error(r.stderr?.slice(0, 600));
    failures++;
  } else {
    const m = /PHASE2_FAILURES:(\d+)/.exec(r.stdout || '');
    failures += m ? Number(m[1]) : 1;
  }

  try { fs.rmSync(stateFile, { force: true }); } catch { /* tmp */ }
  console.log(`\n=== RESULT: ${failures === 0 ? 'ROLLBACK MODEL CHECKS PASSED (steps 2-6 tested; step 1 technically validated)' : failures + ' CHECK(S) FAILED'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('rollback check error:', e); process.exit(1); });
