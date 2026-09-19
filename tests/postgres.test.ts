/**
 * Postgres-backed suite.
 *
 * Why this file exists: every other test runs with `DATABASE_URL=''` against the
 * JSON fallback store, so queries, indexes, `FOR UPDATE SKIP LOCKED` claims,
 * migrations and cross-clinic isolation were asserted only in the mode
 * production does not use. This runs the real statements against a disposable
 * Postgres.
 *
 * It skips cleanly when no test database is configured, so a developer without
 * Docker is not blocked — and CI runs it for real (see .github/workflows/ci.yml,
 * which starts a postgres:16 service and sets DENTAI_TEST_DATABASE_URL).
 *
 *   DENTAI_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/dentai_test \
 *   bun run test:postgres
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const TEST_URL = process.env.DENTAI_TEST_DATABASE_URL || '';

// Set before importing the data layer: dotenv never overrides an existing key,
// so this also guarantees a developer's .env.local cannot point the suite at a
// real database.
process.env.DATABASE_URL = TEST_URL;

const describePostgres = TEST_URL ? describe : describe.skip;

/** A tag function matching the shape src/lib/db.ts expects: it returns rows. */
function createPgTag(pool: Pool) {
  return async (strings: TemplateStringsArray, ...values: any[]) => {
    const text = strings.reduce(
      (acc, part, index) => acc + part + (index < values.length ? `$${index + 1}` : ''),
      ''
    );
    const result = await pool.query(text, values);
    return result.rows;
  };
}

describePostgres('Postgres-backed data layer', () => {
  let pool: Pool;
  let db: typeof import('../src/lib/db');
  let migrations: typeof import('../src/lib/migrations');

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 5 });
    db = await import('../src/lib/db');
    migrations = await import('../src/lib/migrations');
    // Route every statement in the data layer at the test database.
    db.setSqlExecutorForTests(createPgTag(pool) as any);

    // Clean slate: drop everything this suite owns, in dependency order.
    await pool.query(`
      DROP TABLE IF EXISTS chair_audio_chunks, chair_sessions, patients,
        audit_logs, consultations, usage_events, note_jobs,
        clinic_members, clinics, dentists, recovery_tokens, revoked_sessions,
        login_attempts, subscriptions, app_meta, practice_acceptances,
        rate_limit_counters, mfa_credentials, mfa_recovery_codes, clinic_invites,
        billing_events, schema_migrations CASCADE
    `);
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  describe('Migrations', () => {
    it('applies every migration to an empty database and records it', async () => {
      const result = await migrations.runMigrations(createPgTag(pool) as any);
      expect(result.applied).toEqual(migrations.MIGRATIONS.map((m) => m.version));

      const rows = await migrations.listAppliedMigrations(createPgTag(pool) as any);
      expect(rows.map((r) => r.version)).toEqual(migrations.MIGRATIONS.map((m) => m.version));
      expect(rows.every((r) => r.rolled_back_at === null)).toBe(true);
    });

    it('is idempotent: a second run applies nothing', async () => {
      const again = await migrations.runMigrations(createPgTag(pool) as any);
      expect(again.applied).toEqual([]);
      expect(again.skipped.length).toBe(migrations.MIGRATIONS.length);
    });

    it('creates the schema the application expects', async () => {
      const expected = [
        'dentists',
        'consultations',
        'audit_logs',
        'clinics',
        'clinic_members',
        'note_jobs',
        'usage_events',
        'login_attempts',
        'revoked_sessions',
        'recovery_tokens',
        'subscriptions',
        'practice_acceptances',
        'rate_limit_counters',
        'mfa_credentials',
        'mfa_recovery_codes',
        'clinic_invites',
        'billing_events',
        'schema_migrations',
      ];
      const result = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const present = result.rows.map((r: any) => r.table_name);
      for (const table of expected) expect(present).toContain(table);
    });

    it('rolls the newest migration back and re-applies it', async () => {
      const latest = migrations.LATEST_VERSION;
      const rolled = await migrations.rollbackMigration(createPgTag(pool) as any);
      expect(rolled?.version).toBe(latest);

      const afterRollback = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'practice_acceptances'`
      );
      expect(afterRollback.rowCount).toBe(0);

      const reapplied = await migrations.runMigrations(createPgTag(pool) as any);
      expect(reapplied.applied).toEqual([latest]);
    });

    it('refuses to run when a shipped migration was edited', async () => {
      // Simulate an edited release by corrupting the recorded checksum.
      await pool.query(`UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 2`);
      await expect(migrations.runMigrations(createPgTag(pool) as any)).rejects.toThrow(
        /edited after it was applied/
      );
      // With an explicit override it proceeds, which is the documented escape hatch.
      const forced = await migrations.runMigrations(createPgTag(pool) as any, { force: true });
      expect(forced.applied).toContain(2);
    });
  });

  describe('Tenancy: one clinic cannot see another', () => {
    const dentists = [
      { id: 'dentist-a', name: 'Dr A', specialty: 'General' },
      { id: 'dentist-b', name: 'Dr B', specialty: 'General' },
      { id: 'dentist-c', name: 'Dr C', specialty: 'General' },
    ];

    beforeAll(async () => {
      for (const d of dentists) {
        await db.dbInsertDentist({ ...d, pinHash: `hash-${d.id}`, salt: `salt-${d.id}` });
      }
      await db.dbInsertClinic({ id: 'clinic-a', name: 'Alpha Dental', inviteCode: 'ALPHA1', ownerDentistId: 'dentist-a' });
      await db.dbInsertClinic({ id: 'clinic-b', name: 'Beta Dental', inviteCode: 'BETA11', ownerDentistId: 'dentist-b' });
      await db.dbUpsertMembership('clinic-a', 'dentist-c', 'active');

      await db.dbInsertConsultation({
        id: 'consult-a1', dentistId: 'dentist-a', clinicId: 'clinic-a',
        firstName: 'Alice', lastName: 'Alpha', findings: { chiefComplaint: 'a1' },
      });
      await db.dbInsertConsultation({
        id: 'consult-a2', dentistId: 'dentist-c', clinicId: 'clinic-a',
        firstName: 'Carol', lastName: 'Alpha', findings: { chiefComplaint: 'a2' },
      });
      await db.dbInsertConsultation({
        id: 'consult-b1', dentistId: 'dentist-b', clinicId: 'clinic-b',
        firstName: 'Bob', lastName: 'Beta', findings: { chiefComplaint: 'b1' },
      });
    });

    it('lists a clinic only its own consultations', async () => {
      const alpha = await db.dbListConsultationsForClinic('clinic-a');
      expect(alpha.map((c: any) => c.id).sort()).toEqual(['consult-a1', 'consult-a2']);

      const beta = await db.dbListConsultationsForClinic('clinic-b');
      expect(beta.map((c: any) => c.id)).toEqual(['consult-b1']);
    });

    it('lists a dentist only their own records', async () => {
      const own = await db.dbListConsultations('dentist-a');
      expect(own.map((c: any) => c.id)).toEqual(['consult-a1']);
    });

    it('will not hand one dentist another dentist’s job', async () => {
      await db.dbInsertNoteJob({
        id: 'job-a', dentistId: 'dentist-a', clinicId: 'clinic-a', priority: 'routine',
        status: 'queued', attempts: 0, payload: { a: 1 }, nextAttemptAt: null,
      });
      expect(await db.dbGetNoteJob('job-a', 'dentist-a')).toBeTruthy();
      expect(await db.dbGetNoteJob('job-a', 'dentist-b')).toBeNull();
    });

    it('lists members and memberships without crossing clinics', async () => {
      const alphaMembers = await db.dbListClinicMembers('clinic-a');
      expect(alphaMembers.map((m: any) => m.dentistId).sort()).toEqual(['dentist-a', 'dentist-c']);

      const bMemberships = await db.dbListMembershipsForDentist('dentist-b');
      expect(bMemberships.map((m: any) => m.clinicId)).toEqual(['clinic-b']);
    });

    it('counts usage per scope', async () => {
      await db.dbRecordUsage('clinic-a', 'dentist-a', 'ai_note', 100, '2026-09-16');
      await db.dbRecordUsage('clinic-b', 'dentist-b', 'ai_note', 500, '2026-09-16');
      expect(await db.dbGetUsageCount('clinic-a', '2026-09-16')).toBe(1);
      expect(await db.dbGetUsageTokens('clinic-a', '2026-09-16')).toBe(100);
      expect(await db.dbGetUsageTokens('clinic-b', '2026-09-16')).toBe(500);
    });
  });

  describe('Atomic job claims', () => {
    it('never lets two workers claim the same job', async () => {
      await pool.query(`DELETE FROM note_jobs`);
      for (let i = 0; i < 6; i += 1) {
        await db.dbInsertNoteJob({
          id: `claim-${i}`,
          dentistId: 'dentist-a',
          clinicId: 'clinic-a',
          priority: 'routine',
          status: 'queued',
          attempts: 0,
          payload: { i },
          nextAttemptAt: null,
        });
      }

      // Eight workers race for six jobs. SKIP LOCKED must make each claim
      // distinct: a duplicate would generate the same note twice.
      const nowIso = new Date().toISOString();
      const claims = await Promise.all(
        Array.from({ length: 8 }, () => db.dbClaimNextReadyNoteJob(nowIso))
      );
      const claimed = claims.filter(Boolean).map((job: any) => job.id);
      expect(claimed).toHaveLength(6);
      expect(new Set(claimed).size).toBe(6);
      expect(claims.filter((c) => c === null).length).toBe(2);
    });

    it('honours priority order and requeues stale processing jobs', async () => {
      await pool.query(`DELETE FROM note_jobs`);
      await db.dbInsertNoteJob({ id: 'routine-1', dentistId: 'dentist-a', clinicId: 'clinic-a', priority: 'routine', status: 'queued', attempts: 0, payload: {}, nextAttemptAt: null });
      await db.dbInsertNoteJob({ id: 'emergency-1', dentistId: 'dentist-a', clinicId: 'clinic-a', priority: 'emergency', status: 'queued', attempts: 0, payload: {}, nextAttemptAt: null });

      const first = await db.dbClaimNextReadyNoteJob(new Date().toISOString());
      expect(first?.id).toBe('emergency-1');

      // A job abandoned mid-'processing' by a dead instance must come back.
      await pool.query(`UPDATE note_jobs SET updated_at = now() - INTERVAL '30 minutes' WHERE id = 'emergency-1'`);
      const requeued = await db.dbRequeueStuckProcessingJobs(10 * 60 * 1000);
      expect(requeued).toBe(1);
    });
  });

  describe('Audit log integrity and durable limits', () => {
    it('chains audit entries so edits and deletions are detectable', async () => {
      await pool.query(`DELETE FROM audit_logs`);
      for (const event of ['login_success', 'consultation_created', 'consultation_records_viewed']) {
        await db.dbAppendAudit(event, 'dentist-a', { route: '/api/test' });
      }
      const rows = await db.dbListAuditChain(100);
      expect(rows).toHaveLength(3);
      expect(rows.every((row: any) => !!row.hash)).toBe(true);

      const { verifyAuditChain } = await import('../src/lib/auditChain');
      const ordered = rows.map((row: any) => ({
        event: row.event,
        dentistId: row.dentistId,
        detail: row.detail,
        createdAt: row.createdAt,
        prevHash: row.prevHash,
        hash: row.hash,
      }));
      expect(verifyAuditChain(ordered).intact).toBe(true);

      // Tamper with the middle row the way an attacker with database access would.
      await pool.query(`UPDATE audit_logs SET detail = '{"tampered":true}'::jsonb WHERE event = 'consultation_created'`);
      const tamperedRows = await db.dbListAuditChain(100);
      const verification = verifyAuditChain(
        tamperedRows.map((row: any) => ({
          event: row.event,
          dentistId: row.dentistId,
          detail: row.detail,
          createdAt: row.createdAt,
          prevHash: row.prevHash,
          hash: row.hash,
        }))
      );
      expect(verification.intact).toBe(false);
      expect(verification.tampered.length).toBeGreaterThan(0);
    });

    it('makes the login lock durable across instances', async () => {
      await db.dbSetLoginLock('dentist:dentist-a', new Date(Date.now() + 60_000));
      expect(await db.dbGetLoginLock('dentist:dentist-a')).toBeTruthy();

      await db.dbSetLoginLock('dentist:dentist-a', null);
      expect(await db.dbGetLoginLock('dentist:dentist-a')).toBeNull();
    });

    it('increments shared rate-limit counters atomically', async () => {
      const { createRateLimitStore } = await import('../src/server/stores');
      const store = createRateLimitStore({
        kv: { read: async () => ({}), write: async () => {}, dir: '/tmp' },
        logger: { info() {}, warn() {}, error() {} },
      });
      await pool.query(`DELETE FROM rate_limit_counters`);
      const first = await store.hit('test:key', 60_000);
      const second = await store.hit('test:key', 60_000);
      expect(first.hits).toBe(1);
      expect(second.hits).toBe(2);
    });

    it('reports queue depth and oldest open job age', async () => {
      await pool.query(`DELETE FROM note_jobs`);
      await db.dbInsertNoteJob({ id: 'depth-1', dentistId: 'dentist-a', clinicId: 'clinic-a', priority: 'routine', status: 'queued', attempts: 0, payload: {}, nextAttemptAt: null });
      expect(await db.dbCountOpenNoteJobs()).toBe(1);
      const age = await db.dbOldestOpenJobAgeMs();
      expect(age).not.toBeNull();
      expect(age!).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Clinic and subscription reads used by the operator console', () => {
    it('lists clinics, member counts and subscriptions', async () => {
      const clinics = await db.dbListClinics();
      expect(clinics.map((c: any) => c.id).sort()).toEqual(['clinic-a', 'clinic-b']);

      const counts = await db.dbClinicMemberCounts();
      const alpha = counts.find((c: any) => c.clinicId === 'clinic-a');
      expect(alpha?.active).toBe(2);

      const { createSubscriptionStore } = await import('../src/server/stores');
      const store = createSubscriptionStore({
        kv: { read: async () => ({}), write: async () => {}, dir: '/tmp' },
        logger: { info() {}, warn() {}, error() {} },
      });
      await store.upsert({
        id: 'sub-a', clinicId: 'clinic-a', plan: 'practice', tier: 'practice', status: 'active',
        seats: 6, stripeCustomerId: null, stripeSubscriptionId: null,
        currentPeriodEnd: null, cancelAtPeriodEnd: false, activatedBy: 'operator',
        updatedAt: new Date().toISOString(),
      });
      const saved = await store.forClinic('clinic-a');
      expect(saved?.plan).toBe('practice');
      expect((await db.dbListSubscriptions()).find((s: any) => s.clinicId === 'clinic-a')?.plan).toBe('practice');

      // A practice with no subscription must not inherit anyone else's.
      expect(await store.forClinic('clinic-b')).toBeNull();
    });

    it('records practice acceptance evidence', async () => {
      const { createPracticeAcceptanceStore } = await import('../src/server/stores');
      const store = createPracticeAcceptanceStore({
        kv: { read: async () => ({}), write: async () => {}, dir: '/tmp' },
        logger: { info() {}, warn() {}, error() {} },
      });
      await store.record({
        id: 'acc-1', clinicId: 'clinic-a', termsVersion: '2026-09-16',
        privacyVersion: '2026-09-16', dpaVersion: '2026-09-dpa-v1',
        acceptedByName: 'Dr A', acceptedByEmail: null, acceptedByDentistId: 'dentist-a',
        acceptedAt: new Date().toISOString(),
      });
      const latest = await store.latestForClinic('clinic-a');
      expect(latest?.termsVersion).toBe('2026-09-16');
      expect(await store.latestForClinic('clinic-b')).toBeNull();
    });

    it('stores MFA secrets and single-use recovery codes', async () => {
      const { createMfaStore } = await import('../src/server/stores');
      const { generateRecoveryCodes, hashRecoveryCode } = await import('../src/lib/totp');
      const store = createMfaStore({
        kv: { read: async () => ({}), write: async () => {}, dir: '/tmp' },
        logger: { info() {}, warn() {}, error() {} },
      });
      await store.saveSecret('dentist-a', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      expect((await store.get('dentist-a'))?.confirmedAt).toBeNull();
      await store.confirm('dentist-a');
      expect((await store.get('dentist-a'))?.confirmedAt).toBeTruthy();

      const { codes, hashes } = generateRecoveryCodes(3);
      await store.replaceRecoveryCodes('dentist-a', hashes);
      expect(await store.countUnusedRecoveryCodes('dentist-a')).toBe(3);

      expect(await store.consumeRecoveryCode('dentist-a', hashRecoveryCode(codes[0]))).toBe(true);
      // Single use: the same code cannot be replayed.
      expect(await store.consumeRecoveryCode('dentist-a', hashRecoveryCode(codes[0]))).toBe(false);
      expect(await store.countUnusedRecoveryCodes('dentist-a')).toBe(2);
    });
  });
});
