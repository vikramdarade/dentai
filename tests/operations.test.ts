import { describe, it, expect, vi } from 'vitest';
import {
  PLANS,
  describePlan,
  effectiveDailyLimits,
  planFromTier,
  resolveEntitlements,
} from '../src/lib/plans';
import { checkConfiguration, describeConfiguration } from '../src/server/configCheck';
import { createAlerter, evaluateAlerts, DEFAULT_THRESHOLDS } from '../src/server/alerting';
import {
  applyRetentionAction,
  buildTombstone,
  isPastRetention,
  retentionPolicyFromEnv,
} from '../src/lib/retentionPolicy';
import { runRetentionSweep } from '../src/server/retention';
import {
  consultationsToCsv,
  consultationToPlainText,
  consultationToPmsText,
  csvField,
  csvToString,
  exportFilename,
  sectionsFor,
} from '../src/lib/noteExport';
import { scoreGeneration, summariseResults, type EvalFixture } from '../src/lib/clinicalEval';
import type { Consultation } from '../src/types';

describe('Plans and entitlements', () => {
  const now = new Date('2026-09-16T00:00:00.000Z');

  it('grants the trial allowance when there is no subscription', () => {
    const entitlements = resolveEntitlements(null, now);
    expect(entitlements.plan).toBe('trial');
    expect(entitlements.limited).toBe(true);
    expect(entitlements.reason).toBe('no_subscription');
    expect(entitlements.dailyNotes).toBe(PLANS.trial.dailyNotes);
  });

  it('grants the paid plan while the period is valid', () => {
    const entitlements = resolveEntitlements(
      { plan: 'practice', status: 'active', currentPeriodEnd: '2026-10-16T00:00:00.000Z' },
      now
    );
    expect(entitlements.active).toBe(true);
    expect(entitlements.limited).toBe(false);
    expect(entitlements.seats).toBe(PLANS.practice.seats);
  });

  it('keeps a cancelled plan working until the period it paid for ends', () => {
    const stillPaid = resolveEntitlements(
      { plan: 'solo', status: 'canceled', currentPeriodEnd: '2026-10-16T00:00:00.000Z' },
      now
    );
    expect(stillPaid.active).toBe(true);

    const lapsed = resolveEntitlements(
      { plan: 'solo', status: 'canceled', currentPeriodEnd: '2026-09-01T00:00:00.000Z' },
      now
    );
    expect(lapsed.active).toBe(false);
    expect(lapsed.reason).toBe('cancelled');
    expect(lapsed.dailyNotes).toBe(PLANS.trial.dailyNotes);
  });

  it('gives a grace period for a failed payment but not an unlimited one', () => {
    const grace = resolveEntitlements(
      { plan: 'solo', status: 'past_due', currentPeriodEnd: '2026-10-01T00:00:00.000Z' },
      now
    );
    expect(grace.inGrace).toBe(true);
    expect(grace.active).toBe(true);

    const lapsed = resolveEntitlements(
      { plan: 'solo', status: 'past_due', currentPeriodEnd: '2026-09-01T00:00:00.000Z' },
      now
    );
    expect(lapsed.active).toBe(false);
  });

  it('treats an unknown status as unpaid rather than paid', () => {
    const result = resolveEntitlements({ plan: 'practice', status: 'weird', currentPeriodEnd: null }, now);
    expect(result.limited).toBe(true);
  });

  it('never lets a plan raise the operator cost cap', () => {
    const entitlements = resolveEntitlements(
      { plan: 'enterprise', status: 'active', currentPeriodEnd: '2027-01-01T00:00:00.000Z' },
      now
    );
    const capped = effectiveDailyLimits(entitlements, { notes: 25, tokens: 50_000 });
    expect(capped.notes).toBe(25);
    expect(capped.tokens).toBe(50_000);
  });

  it('maps legacy tier values onto plans', () => {
    expect(planFromTier('practice')).toBe('practice');
    expect(planFromTier('legacy-pro')).toBe('trial');
    expect(describePlan('solo')).toContain('A$149');
  });
});

describe('Configuration readiness', () => {
  it('is not ready in production when the operational secrets are missing', () => {
    const result = checkConfiguration({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', SESSION_SECRET: 's' }, 'production');
    expect(result.readiness).toBe('not_ready');
    expect(result.blocking.map((f) => f.key)).toEqual(
      expect.arrayContaining(['DENTAI_OPS_SECRET', 'CRON_SECRET'])
    );
  });

  it('does not treat a missing database as fatal outside production', () => {
    const result = checkConfiguration({ NODE_ENV: 'development' }, 'development');
    expect(result.blocking).toEqual([]);
    expect(result.readiness).toBe('limited');
  });

  it('is ready when everything required and recommended is set', () => {
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      SESSION_SECRET: 's',
      DENTAI_OPS_SECRET: 'o',
      CRON_SECRET: 'c',
      GEMINI_API_KEY: 'g',
      GCP_PROJECT_ID: 'p',
      ERROR_WEBHOOK_URL: 'https://hooks.example/x',
      DENTAI_DISABLE_PROFILE_DIRECTORY: 'true',
      DENTAI_REQUIRE_CONSENT: 'true',
      DENTAI_DAILY_NOTE_LIMIT: '60',
      DENTAI_DAILY_TOKEN_LIMIT: '200000',
    };
    const result = checkConfiguration(env, 'production');
    expect(result.readiness).toBe('ready');
    expect(result.blocking).toEqual([]);
    expect(result.advisories).toEqual([]);
  });

  it('never echoes a value, only whether it is set, and explains the cost', () => {
    const result = checkConfiguration({ NODE_ENV: 'production', SESSION_SECRET: 'super-secret' }, 'production');
    expect(JSON.stringify(result)).not.toContain('super-secret');
    const cron = result.blocking.find((f) => f.key === 'CRON_SECRET');
    expect(cron?.impact).toMatch(/queue/i);
    expect(describeConfiguration(result)).toContain('not_ready');
    expect(describeConfiguration(result)).toContain('CRON_SECRET');
  });
});

describe('Alert thresholds', () => {
  const healthy = {
    requests: 1000,
    errors: 1,
    openNoteJobs: 0,
    oldestQueuedMs: 0,
    dbEnabled: true,
    dbOk: true,
  };

  it('stays quiet when everything is healthy', () => {
    expect(evaluateAlerts(healthy)).toEqual([]);
  });

  it('alerts on an error rate above the threshold, but not below the sample floor', () => {
    expect(evaluateAlerts({ ...healthy, errors: 50 }).map((a) => a.kind)).toContain('error_rate');
    // Five errors out of ten requests is 50%, but ten requests is not enough
    // evidence to wake anyone up at 7am.
    expect(
      evaluateAlerts({ ...healthy, requests: 10, errors: 5 }, DEFAULT_THRESHOLDS).map((a) => a.kind)
    ).not.toContain('error_rate');
  });

  it('treats a stale queue as critical and a deep queue as a warning', () => {
    const backlog = evaluateAlerts({ ...healthy, openNoteJobs: 25 });
    expect(backlog.find((a) => a.kind === 'queue_backlog')?.severity).toBe('warning');

    const stalled = evaluateAlerts({ ...healthy, openNoteJobs: 2, oldestQueuedMs: 30 * 60 * 1000 });
    expect(stalled.find((a) => a.kind === 'queue_stalled')?.severity).toBe('critical');
  });

  it('alerts immediately when the database is unreachable', () => {
    const alerts = evaluateAlerts({ ...healthy, dbOk: false });
    expect(alerts.map((a) => a.kind)).toContain('database_unavailable');
  });

  it('suppresses repeats so a sustained problem does not mute the channel', () => {
    let clock = 1_000_000;
    const emit = vi.fn();
    const alerter = createAlerter({
      thresholds: { ...DEFAULT_THRESHOLDS, repeatAfterMs: 60_000 },
      logger: { info: vi.fn(), error: vi.fn() },
      now: () => clock,
      emit,
    });
    const broken = { ...healthy, dbOk: false };

    alerter.report(broken);
    alerter.report(broken);
    expect(emit).toHaveBeenCalledTimes(1);

    clock += 61_000;
    alerter.report(broken);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe('Retention policy', () => {
  const consultation = {
    id: 'c1',
    dentistId: 'd1',
    clinicId: 'clinic-1',
    firstName: 'Sarah',
    lastName: 'Nguyen',
    dob: '1980-04-02',
    date: 'Sep 16',
    time: '09:45 AM',
    appointmentType: 'examination',
    status: 'Completed',
    transcript: [{ sender: 'Patient', text: 'My name is Sarah Nguyen and I live at 12 Smith St.' }],
    findings: {
      chiefComplaint: 'Sensitivity on the upper right.',
      history: 'Seen by Dr Chen in 2024.',
      diagnosis: 'Reversible pulpitis 16.',
    },
    patientSummary: 'Sarah Nguyen attended for an examination.',
    retentionUntil: '2026-01-01T00:00:00.000Z',
    revisions: [{ id: 'r1' }, { id: 'r2' }],
  };

  it('only treats a record as due after its horizon, and only once', () => {
    const now = new Date('2026-09-16T00:00:00.000Z');
    expect(isPastRetention(consultation, now)).toBe(true);
    expect(isPastRetention({ ...consultation, retentionUntil: '2030-01-01T00:00:00.000Z' }, now)).toBe(false);
    expect(isPastRetention({ ...consultation, deidentifiedAt: '2026-02-01T00:00:00.000Z' }, now)).toBe(false);
    expect(isPastRetention({ retentionUntil: null }, now)).toBe(false);
  });

  it('leaves a tombstone with no patient information behind', () => {
    const tombstone = buildTombstone(consultation, 'delete', '2026-09-16T00:00:00.000Z');
    const serialised = JSON.stringify(tombstone);
    expect(tombstone.id).toBe('c1');
    expect(tombstone.clinicId).toBe('clinic-1');
    expect(tombstone.firstName).toBe('');
    expect(tombstone.lastName).toBe('');
    expect(tombstone.dob).toBe('');
    expect(tombstone.transcript).toEqual([]);
    expect(serialised).not.toContain('Nguyen');
    expect(serialised).not.toContain('Smith St');
    expect(serialised).not.toContain('pulpitis');
  });

  it('scrubs identifiers when a practice deliberately keeps a de-identified record', () => {
    const deidentified = applyRetentionAction(consultation, { action: 'deidentify' }, '2026-09-16T00:00:00.000Z');
    expect(deidentified.findings.history).toContain('[name]');
    expect(deidentified.deidentificationMethod).toMatch(/rule-based/);
    expect(JSON.stringify(deidentified)).not.toContain('Smith St');
  });

  it('is a dry run unless the operator opts in', () => {
    expect(retentionPolicyFromEnv({})).toMatchObject({ dryRun: true, action: 'delete' });
    expect(retentionPolicyFromEnv({ DENTAI_RETENTION_ENABLED: 'true' })).toMatchObject({ dryRun: false });
    expect(
      retentionPolicyFromEnv({ DENTAI_RETENTION_ENABLED: 'true', DENTAI_RETENTION_ACTION: 'deidentify' })
    ).toMatchObject({ action: 'deidentify', dryRun: false });
    expect(retentionPolicyFromEnv({ DENTAI_RETENTION_BATCH: '9999' }).batchSize).toBe(200);
  });

  it('reports what it would do in a dry run and changes nothing', async () => {
    const store = {
      listDue: vi.fn(async () => [
        { id: 'c1', dentistId: 'd1', clinicId: 'clinic-1', data: consultation, retentionUntil: consultation.retentionUntil },
      ]),
      deidentify: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const logAudit = vi.fn();
    const result = await runRetentionSweep({
      store: store as any,
      policy: { action: 'delete', dryRun: true, batchSize: 25 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      logAudit,
    });
    expect(result.examined).toBe(1);
    expect(result.actioned).toBe(1);
    expect(store.deidentify).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith('retention_record_due', 'd1', expect.any(Object));
  });

  it('actions and audits each record when armed, and survives one failure', async () => {
    const store = {
      listDue: vi.fn(async () => [
        { id: 'c1', dentistId: 'd1', clinicId: 'clinic-1', data: consultation, retentionUntil: consultation.retentionUntil },
        { id: 'c2', dentistId: 'd2', clinicId: 'clinic-1', data: consultation, retentionUntil: consultation.retentionUntil },
      ]),
      deidentify: vi.fn(async (id: string) => {
        if (id === 'c2') throw new Error('write failed');
      }),
      remove: vi.fn(async () => {}),
    };
    const logAudit = vi.fn();
    const result = await runRetentionSweep({
      store: store as any,
      policy: { action: 'delete', dryRun: false, batchSize: 25 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      logAudit,
    });
    expect(result.actioned).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledWith('retention_record_deleted', 'd1', expect.any(Object));
  });
});

describe('Note handoff formats', () => {
  const consultation = {
    id: 'c1',
    firstName: 'Sarah',
    lastName: 'Nguyen',
    dob: '1980-04-02',
    appointmentType: 'examination',
    date: 'Sep 16',
    time: '09:45 AM',
    status: 'Completed',
    templateId: 'standard',
    transcript: [],
    findings: {
      chiefComplaint: 'Sensitivity on the upper right.',
      history: 'Nil relevant.',
      toothFindings: '16 O composite intact, no caries.',
      findingsGingival: 'BPE 1 1 1.',
      diagnosis: 'Reversible pulpitis 16.',
      treatmentPerformed: 'Cold test performed, patient reviewed.',
      recommendations: 'Soft diet, review if pain persists.',
      recallRequirements: 'Review in 2 weeks.',
      adaCodes: [{ code: '013', description: 'Consultation' }],
    },
    patientSummary: 'You attended for an examination.',
    noteOrigin: { engine: 'gemini', needsReview: false },
  } as unknown as Consultation;

  it('uses the template sections when a template is identified', () => {
    expect(sectionsFor(consultation).map((s) => s.key)).toContain('chiefComplaint');
    expect(sectionsFor({ ...consultation, templateId: 'soap' } as Consultation).map((s) => s.key)).toEqual([
      'subjective',
      'objective',
      'assessment',
      'plan',
    ]);
  });

  it('renders readable plain text including item numbers', () => {
    const text = consultationToPlainText(consultation);
    expect(text).toContain('Patient: Sarah Nguyen');
    expect(text).toContain('CHIEF COMPLAINT');
    expect(text).toContain('013 — Consultation');
  });

  it('renders a compact layout for pasting into a practice-management system', () => {
    const text = consultationToPmsText(consultation);
    expect(text).toContain('Chief Complaint: Sensitivity on the upper right.');
    expect(text).toContain('Items: 013');
    expect(text).not.toMatch(/^#/m);
  });

  it('protects a spreadsheet from a note that starts with a formula character', () => {
    expect(csvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvField('Pain, "sharp"')).toBe('"Pain, ""sharp"""');
    expect(csvField(undefined)).toBe('');
  });

  it('produces a spreadsheet-ready export with a stable header', () => {
    const exported = consultationsToCsv([consultation]);
    expect(exported.header).toContain('Chief complaint');
    expect(exported.rows[0][0]).toBe('c1');
    const text = csvToString(exported);
    expect(text.split('\r\n')).toHaveLength(2);
    expect(exportFilename('dentai-export', new Date('2026-09-16T00:00:00.000Z'))).toBe(
      'dentai-export-2026-09-16'
    );
  });
});

describe('Clinical accuracy gate', () => {
  const fixture: EvalFixture = {
    id: 'exam-01',
    description: 'Routine examination, no pathology',
    transcript: [
      { sender: 'Patient', text: 'I have no pain, just here for a check-up.' },
      { sender: 'Dentist', text: 'BPE is 1 1 1, no caries visible on 16.' },
    ],
    intake: { appointmentType: 'examination', firstName: 'Test', lastName: 'Patient' },
    expected: {
      required: {
        chiefComplaint: [['no pain', 'check-up', 'check up']],
        findingsGingival: [['bpe 1']],
        toothFindings: [['no caries', '16']],
      },
      mustBePresent: ['recommendations', 'recallRequirements'],
      forbidden: ['irreversible pulpitis', 'extraction required'],
      // The complete set of item numbers this consultation legitimately
      // supports. Anything outside it is treated as fabricated — which is why
      // fixtures must declare them explicitly.
      expectedCodes: ['011'],
    },
    recorded: {
      fields: {
        chiefComplaint: 'Patient attends for a routine check-up, no pain reported.',
        findingsGingival: 'BPE 1 1 1, no bleeding on probing.',
        toothFindings: '16 sound, no caries visible.',
        recommendations: 'Continue brushing twice daily.',
        recallRequirements: 'Routine recall in 6 months.',
      },
      adaCodes: [{ code: '011', description: 'Examination' }],
      engine: 'gemini',
    },
  };

  it('passes a faithful generation', () => {
    const result = scoreGeneration(fixture, {
      fields: fixture.recorded.fields,
      patientSummary: 'Routine check-up, no problems found.',
      adaCodes: fixture.recorded.adaCodes,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.violations).toEqual([]);
  });

  it('fails hard when content the transcript does not support appears', () => {
    const result = scoreGeneration(fixture, {
      fields: { ...fixture.recorded.fields, diagnosis: 'Irreversible pulpitis on 16.' },
      adaCodes: fixture.recorded.adaCodes,
    });
    // A fabricated diagnosis must cap the score at zero, however well the rest
    // of the note reads.
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.kind === 'forbidden_text')).toBe(true);
  });

  it('flags a dropped clinical fact', () => {
    const result = scoreGeneration(fixture, {
      fields: { ...fixture.recorded.fields, chiefComplaint: 'Patient attended.' },
      adaCodes: fixture.recorded.adaCodes,
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.kind === 'missing_field')).toBe(true);
  });

  it('flags a fabricated item number but accepts one spoken in the transcript', () => {
    const fabricated = scoreGeneration(fixture, {
      fields: fixture.recorded.fields,
      adaCodes: [{ code: '324', description: 'Surgical extraction' }],
    });
    expect(fabricated.score).toBe(0);
    expect(fabricated.violations.some((v) => v.kind === 'fabricated_code')).toBe(true);

    const withSpokenCode = scoreGeneration(
      { ...fixture, transcript: [...fixture.transcript, { sender: 'Dentist', text: 'Item 114 today.' }] },
      { fields: fixture.recorded.fields, adaCodes: [{ code: '114', description: 'Scale and clean' }] }
    );
    expect(withSpokenCode.violations.some((v) => v.kind === 'fabricated_code')).toBe(false);
  });

  it('treats an empty generation as a failure, not a pass', () => {
    const result = scoreGeneration(fixture, { fields: {} });
    expect(result.score).toBe(0);
    expect(result.violations.some((v) => v.kind === 'empty_note')).toBe(true);
  });

  it('summarises the run with safety failures called out', () => {
    const good = scoreGeneration(fixture, { fields: fixture.recorded.fields, adaCodes: fixture.recorded.adaCodes });
    const bad = scoreGeneration(fixture, { fields: { diagnosis: 'Irreversible pulpitis' } });
    const summary = summariseResults([good, bad]);
    expect(summary.fixtures).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.safetyFailures).toBe(1);
  });
});
