import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import {
  NoteTemplate,
  TemplateSection,
  getTemplateById,
  TEMPLATE_BY_ID,
  isValidAppointmentType
} from './src/lib/dentalLibrary';
import { normalizeTemplateOutput } from './src/lib/normalizeNoteOutput';
import {
  compactTranscriptForGeneration,
  getTranscriptStats
} from './src/lib/transcriptTrim';
import {
  JOB_CONFIG,
  PRIORITY_WEIGHT,
  DEFAULT_CLINIC_DAILY_LIMIT,
  backoffDelayMs,
  isQuotaError,
  meteringDay,
  priorityForAppointmentType,
  usageSnapshotFor,
  type NoteJobPriority,
  type NoteJobStatus
} from './src/lib/noteJobs';
import {
  ClinicInfo,
  ClinicMembership,
  ClinicMemberSummary,
  generateInviteCode,
  normalizeInviteCode,
  personalClinicName,
  sanitizeClinicName
} from './src/lib/clinics';
import {
  extractProposedTreatmentsFromFindings,
  lookupAdaFee,
  type AdaFeeItem
} from './src/lib/adaFees';
import type {
  TreatmentOpportunity,
  TreatmentStatus,
  PracticeRoiSummary
} from './src/types';
import { logger } from './logger';
import fs from 'fs';
import crypto from 'crypto';
import { kv } from '@vercel/kv';
import {
  dbEnabled,
  initDbSchema,
  seedFromJsonFallback,
  dbGetDentists,
  dbGetDentistById,
  dbGetDentistByName,
  dbInsertDentist,
  dbDeleteDentist,
  dbListConsultations,
  dbInsertConsultation,
  dbUpdateConsultation,
  dbAppendAudit,
  dbInsertClinic,
  dbGetClinicById,
  dbGetClinicByInviteCode,
  dbGetClinicByOwner,
  dbUpdateClinicInviteCode,
  dbUpdateClinicName,
  dbListClinicMembers,
  dbListMembershipsForDentist,
  dbUpsertMembership,
  dbDeleteMembership,
  dbListConsultationsForClinic,
  dbInsertNoteJob,
  dbGetNoteJob,
  dbClaimNextReadyNoteJob,
  dbNextReadyNoteJob,
  dbRequeueStuckProcessingJobs,
  dbUpdateNoteJob,
  dbRecordUsage,
  dbGetUsageCount
} from './src/lib/db';
import { getTodayStr, getCurrentTimeStr } from './src/types';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = typeof import.meta !== 'undefined' && import.meta.url
  ? fileURLToPath(import.meta.url)
  : '';
const __dirname = __filename ? path.dirname(__filename) : process.cwd();

const app = express();

// Secure HTTP Headers
app.use(
  helmet({
    // Disable CSP in dev to avoid breaking Vite HMR websocket connections
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  })
);

app.use(express.json({ limit: '1mb' }));

// Request Logging & Latency Telemetry Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.recordLatency(duration);
    logger.info(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`, {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });
  next();
});

// API Rate Limiting (max 100 requests per 15 minutes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Job polling is the async fabric's own heartbeat: the client polls every
  // ~1.5s while a note generates, and each poll opportunistically ticks the
  // worker. Counting polls here would spend the dentist's entire 100-request
  // window mid-consult; the POST that enqueues is still metered.
  skip: (req) => req.method === 'GET' && /^\/api\/notes\/jobs\/[0-9a-fA-F-]+$/.test(req.originalUrl || ''),
});

app.use('/api/', apiLimiter);

/* ===========================================================================
 * Async note-generation job fabric — stores, metering, generation core
 *
 * The scale pivot: generation becomes a durable job with priority classes,
 * per-clinic daily metering, and server-side exponential backoff. The client
 * submits a job and polls for the result, so quota pressure on one clinic can
 * never starve another and a thousand dentists retrying never form a
 * thundering herd.
 * ======================================================================== */

const JOBS_FILE = path.resolve(__dirname, 'data', 'note_jobs.json');
const USAGE_FILE = path.resolve(__dirname, 'data', 'usage_events.json');
const jobsCacheKey = 'dentai:note_jobs';
const usageCacheKey = 'dentai:usage_events';

interface JobRecord {
  id: string;
  dentistId: string;
  clinicId?: string;
  priority: NoteJobPriority;
  status: NoteJobStatus;
  attempts: number;
  payload: { intakeData: any; transcript: any[] };
  result?: any;
  error?: string;
  nextAttemptAt?: string | null;
  createdAt: string;
}

async function readJobsDb(): Promise<{ jobs: JobRecord[] }> {
  if (dbEnabled) return { jobs: [] };
  return readDb(jobsCacheKey, JOBS_FILE, { jobs: [] });
}

async function writeJobsDb(data: { jobs: JobRecord[] }) {
  if (dbEnabled) return;
  return writeDb(jobsCacheKey, JOBS_FILE, data);
}

async function readUsageDb(): Promise<{ events: any[] }> {
  if (dbEnabled) return { events: [] };
  return readDb(usageCacheKey, USAGE_FILE, { events: [] });
}

async function writeUsageDb(data: { events: any[] }) {
  if (dbEnabled) return;
  return writeDb(usageCacheKey, USAGE_FILE, data);
}

/** Daily AI-note allowance — overridable per deployment via env. */
function clinicDailyLimit(): number {
  const parsed = Number(process.env.DENTAI_DAILY_NOTE_LIMIT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLINIC_DAILY_LIMIT;
}

async function recordUsageEvent(scopeId: string, dentistId: string, kind: string, tokens: number) {
  const day = meteringDay();
  if (dbEnabled) {
    await dbRecordUsage(scopeId, dentistId, kind, tokens, day);
    return;
  }
  const data = await readUsageDb();
  data.events.push({ scopeId, dentistId, kind, tokens, day, createdAt: new Date().toISOString() });
  await writeUsageDb(data);
}

async function getUsageCountToday(scopeId: string): Promise<number> {
  if (dbEnabled) return dbGetUsageCount(scopeId, meteringDay());
  const data = await readUsageDb();
  const day = meteringDay();
  return data.events.filter((e) => e.scopeId === scopeId && e.day === day).length;
}

/** Formats the generation prompt for an intake + (already compacted) transcript. */
function buildNotePrompt(intakeData: any, templateName: string, transcript: any[]): string {
  return `\n=== PATIENT INTAKE DATA ===\nFirst Name: ${intakeData.firstName}\nLast Name: ${intakeData.lastName}\nDate of Birth: ${intakeData.dob}\nAppointment Type: ${intakeData.appointmentType}\nNote Template: ${templateName}\n\n=== CLINICAL SESSION TRANSCRIPT ===\n${transcript.map((t: any) => `${t.sender}: ${t.text}`).join('\n')}\n`;
}

/**
 * Shared hosted-generation core used by the job worker. Mirrors the sync
 * endpoint's routing (Vertex → developer key → secondary key) but returns a
 * classified result instead of an HTTP response so backoff decisions stay in
 * one place.
 */
async function runHostedGeneration(payload: {
  intakeData: any;
  transcript: any[];
}): Promise<{ ok: true; output: any } | { ok: false; quota: true; message: string } | { ok: false; quota: false; message: string }> {
  const gcpProject = process.env.GCP_PROJECT_ID;
  try {
    const resolved = resolveNoteTemplate(payload.intakeData);
    if (resolved.error) {
      return { ok: false, quota: false, message: resolved.error };
    }
    const noteTemplate = resolved.template;
    const noteAIConfig = buildTemplateAIConfig(noteTemplate);

    // Server-side compaction: the forgotten-recording guard. Enforced here so
    // a client-side bypass can never blow the quota pool for other clinics.
    const compacted = compactTranscriptForGeneration(payload.transcript);
    if (compacted.compacted) {
      logger.warn('[JobFabric] Transcript compacted before generation', { summary: compacted.summary });
    }
    const promptContext = buildNotePrompt(payload.intakeData, noteTemplate.name, compacted.transcript);

    let output: any | null = null;

    if (gcpProject) {
      const options: any = {
        vertexai: true,
        project: gcpProject,
        location: process.env.GCP_REGION || 'australia-southeast1'
      };
      if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
        try {
          options.credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
        } catch (e: any) {
          logger.error('Failed to parse GCP_SERVICE_ACCOUNT_KEY JSON:', e.message);
        }
      }
      try {
        const ai = new GoogleGenAI(options);
        const response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
          contents: promptContext,
          config: noteAIConfig
        });
        if (response.text) output = JSON.parse(response.text);
      } catch (vertexErr: any) {
        const msg = (vertexErr.message || '').toLowerCase();
        const credsErr = msg.includes('credentials') || msg.includes('authenticated');
        if (!credsErr) throw vertexErr;
        logger.warn('[JobFabric] Vertex credentials error — retrying with developer key');
      }
    }

    if (!output) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return { ok: false, quota: false, message: 'Gemini API key is not configured on the server.' };
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
        contents: promptContext,
        config: noteAIConfig
      });
      if (!response.text) throw new Error('Gemini API returned an empty text field.');
      output = JSON.parse(response.text);
    }

    return { ok: true, output: normalizeTemplateOutput(noteTemplate, output) };
  } catch (error: any) {
    if (isQuotaError({ status: error.status, message: error.message })) {
      // Tier 2 — secondary key on a separate quota pool.
      const fallbackKey = process.env.GEMINI_FALLBACK_API_KEY;
      if (fallbackKey && fallbackKey !== 'MY_GEMINI_API_KEY') {
        try {
          const resolved = resolveNoteTemplate(payload.intakeData);
          if (!resolved.error) {
            const noteTemplate = resolved.template;
            const noteAIConfig = buildTemplateAIConfig(noteTemplate);
            const compacted = compactTranscriptForGeneration(payload.transcript);
            const promptContext = buildNotePrompt(payload.intakeData, noteTemplate.name, compacted.transcript);
            const fallbackAi = new GoogleGenAI({ apiKey: fallbackKey });
            const fallbackResponse = await fallbackAi.models.generateContent({
              model: process.env.GEMINI_FALLBACK_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
              contents: promptContext,
              config: noteAIConfig
            });
            if (fallbackResponse.text) {
              logAudit('notes_generation_secondary_key', 'job-worker', {});
              return { ok: true, output: normalizeTemplateOutput(noteTemplate, JSON.parse(fallbackResponse.text)) };
            }
          }
        } catch (secondaryErr: any) {
          logger.warn('[JobFabric] Secondary-key fallback also failed:', secondaryErr.message || secondaryErr);
        }
      }
      logAudit('notes_generation_quota_exhausted', 'job-worker', {});
      return { ok: false, quota: true, message: 'Hosted AI is rate-limited (quota or billing exhausted). The job will retry automatically with backoff.' };
    }
    return { ok: false, quota: false, message: error.message || 'Unknown hosted AI failure.' };
  }
}

let workerTicking = false;
let lastTickAt = 0;

/**
 * Drains ready jobs with per-clinic metering and exponential backoff. Runs
 * opportunistically on poll and explicitly via /api/notes/jobs/tick — guarded
 * by an in-process lock so overlapping ticks cannot double-process a job.
 */
async function tickNoteJobs(force = false): Promise<void> {
  if (workerTicking) return;
  if (!force && Date.now() - lastTickAt < 1500) return;
  workerTicking = true;
  lastTickAt = Date.now();
  try {
    // Crash recovery: an instance that died mid-'processing' leaves its job
    // stuck forever otherwise. Requeue jobs whose processing has exceeded the
    // stale window so generation retries (idempotent — cheap when empty).
    if (dbEnabled) {
      try {
        const requeued = await dbRequeueStuckProcessingJobs(JOB_CONFIG.maxAgeMs);
        if (requeued > 0) {
          logger.warn(`[JobFabric] Requeued ${requeued} stuck processing job(s) after instance failure.`);
        }
      } catch (requeueErr: any) {
        logger.warn('[JobFabric] Stuck-job requeue check failed:', requeueErr?.message || requeueErr);
      }
    }
    for (let i = 0; i < JOB_CONFIG.maxJobsPerTick; i++) {
      const nowIso = new Date().toISOString();
      const job = await (async (): Promise<JobRecord | null> => {
        // Postgres: claim atomically (SKIP LOCKED) so N instances never
        // double-generate the same job. JSON mode is single-process.
        if (dbEnabled) return (await dbClaimNextReadyNoteJob(nowIso)) as JobRecord | null;
        const data = await readJobsDb();
        const ready = data.jobs
          .filter((j) => j.status === 'queued' && (!j.nextAttemptAt || Date.parse(j.nextAttemptAt) <= Date.now()))
          .sort((a, b) => {
            const pw = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
            if (pw !== 0) return pw;
            return Date.parse(a.createdAt) - Date.parse(b.createdAt);
          });
        return ready[0] ?? null;
      })();
      if (!job) return;

      // Expire stale jobs so clients never poll forever.
      if (Date.now() - Date.parse(job.createdAt) > JOB_CONFIG.maxAgeMs) {
        await persistJobPatch(job.id, job.dentistId, {
          status: 'failed', attempts: job.attempts, result: null,
          error: 'Job expired before generation could complete.', nextAttemptAt: null
        });
        continue;
      }

      // In Postgres mode the claim statement already set 'processing' and
      // incremented attempts; in JSON mode we do it with this patch.
      let attempts = job.attempts;
      if (!dbEnabled) {
        attempts = job.attempts + 1;
        await persistJobPatch(job.id, job.dentistId, {
          status: 'processing', attempts, result: null, error: null, nextAttemptAt: null
        });
      }

      const result = await runHostedGeneration(job.payload);

      if (result.ok) {
        await persistJobPatch(job.id, job.dentistId, {
          status: 'done', attempts, result: result.output, error: null, nextAttemptAt: null
        });
        const scopeId = job.clinicId || job.dentistId;
        const approxTokens = getTranscriptStats(job.payload.transcript || []).approxTokens;
        await recordUsageEvent(scopeId, job.dentistId, 'ai_note', approxTokens);
        // Durable completion: persist the consultation server-side as part of
        // finishing the job. If the dentist's browser died (appointment ended,
        // call dropped) the note is NOT lost — it is in the database and
        // surfaces in the History Hub on next sign-in.
        try {
          const output: any = result.output;
          const intake = job.payload?.intakeData || {};
          const consult = {
            id: job.id,
            dentistId: job.dentistId,
            clinicId: job.clinicId,
            firstName: String(intake.firstName || 'Unknown'),
            lastName: String(intake.lastName || 'Patient'),
            dob: String(intake.dob || '1900-01-01'),
            appointmentType: String(intake.appointmentType || 'examination'),
            // Stamp the consultation at job-creation time (when the session
            // actually happened), not when the worker drained it.
            date: getTodayStr(new Date(job.createdAt)),
            time: getCurrentTimeStr(new Date(job.createdAt)),
            status: 'In Review' as const,
            transcript: job.payload?.transcript || [],
            templateId: String(intake.templateId || 'standard'),
            findings: {
              // NormalizedNoteOutput puts canonical keys at the TOP level (with a
              // .canonical fallback for draft-engine-shaped output).
              chiefComplaint: (output.chiefComplaint ?? output.canonical?.chiefComplaint) || '',
              history: (output.history ?? output.canonical?.history) || '',
              toothFindings: (output.toothFindings ?? output.canonical?.toothFindings) || '',
              findingsGingival: (output.findingsGingival ?? output.canonical?.findingsGingival) || '',
              diagnosis: (output.diagnosis ?? output.canonical?.diagnosis) || '',
              treatmentPerformed: (output.treatmentPerformed ?? output.canonical?.treatmentPerformed) || '',
              recommendations: (output.recommendations ?? output.canonical?.recommendations) || '',
              recallRequirements: (output.recallRequirements ?? output.canonical?.recallRequirements) || '6 Months (Standard)',
              customSections: output.customSections || {},
              adaCodes: output.adaCodes || []
            },
            patientSummary: output.patientSummary || '',
            noteOrigin: { engine: 'gemini' as const, needsReview: false, detail: 'Generated by the hosted AI worker.' }
          };
          if (dbEnabled) {
            await dbInsertConsultation(consult);
          } else {
            const consData = await readConsultationsDb();
            consData.consultations.unshift(consult);
            await writeConsultationsDb(consData);
          }
          logAudit('note_job_consultation_persisted', job.dentistId, { jobId: job.id });
        } catch (persistErr: any) {
          // The note itself succeeded; a persistence failure must not re-run
          // generation. Log and leave the result on the job for polling.
          logger.error('Failed to persist job result as consultation:', persistErr?.message || persistErr);
        }
        continue;
      }

      const failure = result as { quota: boolean; message: string };
      if (failure.quota && attempts < JOB_CONFIG.maxAttempts) {
        const delay = backoffDelayMs(attempts);
        logger.warn(`[JobFabric] Job ${job.id} hit quota (attempt ${attempts}) — backing off ${Math.round(delay / 1000)}s`);
        await persistJobPatch(job.id, job.dentistId, {
          status: 'queued', attempts, result: null,
          error: failure.message, nextAttemptAt: new Date(Date.now() + delay)
        });
        continue;
      }

      await persistJobPatch(job.id, job.dentistId, {
        status: 'failed', attempts, result: null, error: failure.message, nextAttemptAt: null
      });
    }
  } finally {
    workerTicking = false;
  }
}

/** Status/attempts/result/error/nextAttemptAt persistence for both store modes. */
async function persistJobPatch(
  id: string,
  dentistId: string,
  patch: { status: NoteJobStatus; attempts: number; result: any; error: string | null; nextAttemptAt: Date | null }
): Promise<void> {
  if (dbEnabled) {
    await dbUpdateNoteJob(id, patch);
    return;
  }
  const data = await readJobsDb();
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return;
  job.status = patch.status;
  job.attempts = patch.attempts;
  job.result = patch.result ?? undefined;
  job.error = patch.error ?? undefined;
  job.nextAttemptAt = patch.nextAttemptAt ? patch.nextAttemptAt.toISOString() : null;
  await writeJobsDb(data);
}

/** Submit an async generation job (202 + jobId; poll GET /api/notes/jobs/:id). */
app.post('/api/notes/jobs', authenticateToken, async (req: any, res: express.Response) => {
  try {
    const { intakeData, transcript, clinicId, consultationId } = req.body || {};
    if (!intakeData || !transcript || !Array.isArray(transcript)) {
      return res.status(400).json({ error: 'Missing or invalid intakeData or transcript in request body.' });
    }
    if (transcript.length === 0) {
      return res.status(400).json({ error: 'Transcript is empty — record or type dialogue first.' });
    }
    if (transcript.length > 200) {
      return res.status(400).json({ error: 'Transcript contains too many entries (maximum 200 items).' });
    }
    const resolved = resolveNoteTemplate(intakeData);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    if (!isValidAppointmentType(intakeData.appointmentType)) {
      return res.status(400).json({ error: 'Appointment type must be one of: examination, scale_clean, emergency, restorative, endodontic, surgical, prosthodontic, paediatric.' });
    }

    // Per-clinic fair-share metering: the clinic is the accountable economic
    // unit. A soft daily limit degrades gracefully — the client offers the
    // offline draft engine instead of dead-ending the dentist.
    const scopeId = (await resolveClinicScope(req.dentist.id, clinicId)) || req.dentist.id;
    const used = await getUsageCountToday(scopeId);
    const limit = clinicDailyLimit();
    const usage = usageSnapshotFor(scopeId, used, limit);
    if (usage.exceeded) {
      logAudit('note_job_metered', req.dentist.id, { scopeId, used, limit });
      return res.status(429).json({
        error: `This clinic has used all ${limit} AI notes for today. You can draft the note offline from the transcript — it will be available again tomorrow.`,
        code: 'QUOTA_DAILY',
        usage
      });
    }

    // Converge on ONE record: when the client supplies its consultation id, the
    // job (and the durable consultation persisted on completion) uses it — the
    // client's final PUT then updates the server record instead of creating a
    // duplicate with a different id.
    const isUuid = (v: unknown): v is string =>
      typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const job: JobRecord = {
      id: isUuid(consultationId) ? consultationId : crypto.randomUUID(),
      dentistId: req.dentist.id,
      clinicId: scopeId,
      priority: priorityForAppointmentType(intakeData.appointmentType),
      status: 'queued',
      attempts: 0,
      payload: { intakeData, transcript },
      createdAt: new Date().toISOString(),
      nextAttemptAt: null
    };

    if (dbEnabled) {
      await dbInsertNoteJob({
        id: job.id, dentistId: job.dentistId, clinicId: job.clinicId,
        priority: job.priority, status: job.status, attempts: 0,
        payload: job.payload, nextAttemptAt: null
      });
    } else {
      const data = await readJobsDb();
      data.jobs.push(job);
      await writeJobsDb(data);
    }

    logAudit('note_job_submitted', req.dentist.id, {
      jobId: job.id, priority: job.priority, transcriptLength: transcript.length, scopeId
    });

    // Drain immediately so a quiet platform responds in one round-trip.
    void tickNoteJobs(true);

    return res.status(202).json({ jobId: job.id, status: 'queued', priority: job.priority, usage });
  } catch (err: any) {
    logger.error('Error submitting note job:', err);
    return res.status(500).json({ error: err.message || 'Failed to queue the note for generation.' });
  }
});

/** Poll a job's status. Owner-only access; every poll opportunistically ticks. */
app.get('/api/notes/jobs/:id', authenticateToken, async (req: any, res: express.Response) => {
  try {
    const { id } = req.params;
    void tickNoteJobs();

    let job: JobRecord | null = null;
    if (dbEnabled) {
      job = (await dbGetNoteJob(id, req.dentist.id)) as JobRecord | null;
    } else {
      const data = await readJobsDb();
      job = data.jobs.find((j) => j.id === id && j.dentistId === req.dentist.id) ?? null;
    }
    if (!job) {
      return res.status(404).json({ error: 'Note job not found.' });
    }

    const body: Record<string, any> = {
      id: job.id,
      status: job.status,
      priority: job.priority,
      attempts: job.attempts,
      createdAt: job.createdAt
    };
    if (job.status === 'done' && job.result) body.result = job.result;
    if (job.error) body.error = job.error;
    if (job.nextAttemptAt && job.status === 'queued') body.nextAttemptAt = job.nextAttemptAt;
    return res.json(body);
  } catch (err: any) {
    logger.error('Error reading note job:', err);
    return res.status(500).json({ error: err.message || 'Failed to read the note job.' });
  }
});

/** Manual worker tick (for ops/cron). Authenticated to keep the surface closed. */
app.post('/api/notes/jobs/tick', authenticateToken, async (_req: express.Request, res: express.Response) => {
  await tickNoteJobs(true);
  return res.json({ ok: true });
});

/** Today's AI usage for the active clinic — powers the recording-screen pill. */
app.get('/api/usage/today', authenticateToken, async (req: any, res: express.Response) => {
  try {
    const scopeId = (await resolveClinicScope(req.dentist.id, req.query.clinicId)) || req.dentist.id;
    const used = await getUsageCountToday(scopeId);
    const limit = clinicDailyLimit();
    return res.json(usageSnapshotFor(scopeId, used, limit));
  } catch (err: any) {
    logger.error('Error reading usage endpoint:', err);
    return res.status(500).json({ error: err.message || 'Failed to read usage.' });
  }
});

// JSON database file paths

// JSON database file paths

// JSON database file paths
const USERS_FILE = path.resolve(__dirname, 'data', 'users.json');
const CONSULTATIONS_FILE = path.resolve(__dirname, 'data', 'consultations.json');
const AUDIT_FILE = path.resolve(__dirname, 'data', 'audit.json');
const CLINICS_FILE = path.resolve(__dirname, 'data', 'clinics.json');

// In-memory caching layer for read-only environments (like Vercel serverless)
const dbCache: Record<string, any> = {
  'dentai:users': null,
  'dentai:consultations': null,
  'dentai:clinics': null
};

const isKvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export function invalidateDbCache(key?: string) {
  if (key) {
    delete dbCache[key];
  } else {
    for (const k of Object.keys(dbCache)) {
      delete dbCache[k];
    }
  }
}

async function readDb(kvKey: string, filePath: string, defaultValue: any) {
  if (isKvConfigured) {
    try {
      const data = await kv.get(kvKey);
      if (data) {
        dbCache[kvKey] = data;
        return data;
      }
    } catch (err) {
      logger.error(`Failed to read ${kvKey} from Vercel KV:`, err);
    }
  }

  if (dbCache[kvKey]) return dbCache[kvKey];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    dbCache[kvKey] = data;
    return data;
  } catch (err) {
    logger.error(`Failed to read database file ${filePath}:`, err);
    return dbCache[kvKey] || defaultValue;
  }
}

async function writeDb(kvKey: string, filePath: string, data: any) {
  dbCache[kvKey] = data;
  if (isKvConfigured) {
    try {
      await kv.set(kvKey, data);
      return;
    } catch (err) {
      logger.error(`Failed to write ${kvKey} to Vercel KV:`, err);
    }
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err: any) {
    logger.warn(`[Database] Read-only filesystem detected. Saved ${kvKey} in-memory cache only.`, err.message);
  }
}

async function readUsersDb() {
  if (dbEnabled) {
    try {
      return { dentists: await dbGetDentists() };
    } catch (err) {
      logger.error('Failed to read dentists from Postgres:', err);
      return { dentists: [] };
    }
  }
  return readDb('dentai:users', USERS_FILE, { dentists: [] });
}

async function writeUsersDb(data: any) {
  // In Postgres mode, dentist mutations go through dbInsertDentist/dbDeleteDentist directly.
  if (dbEnabled) return;
  return writeDb('dentai:users', USERS_FILE, data);
}

async function readConsultationsDb() {
  if (dbEnabled) {
    // The authenticated GET endpoint queries by dentist id via dbListConsultations;
    // this fallback-array shape is only used by the non-Postgres paths below.
    return { consultations: [] };
  }
  return readDb('dentai:consultations', CONSULTATIONS_FILE, { consultations: [] });
}

async function writeConsultationsDb(data: any) {
  // In Postgres mode, consultation writes go through dbInsertConsultation/dbUpdateConsultation.
  if (dbEnabled) return;
  return writeDb('dentai:consultations', CONSULTATIONS_FILE, data);
}

async function readClinicsDb(): Promise<{ clinics: any[] }> {
  return readDb('dentai:clinics', CLINICS_FILE, { clinics: [] });
}

async function writeClinicsDb(data: { clinics: any[] }) {
  return writeDb('dentai:clinics', CLINICS_FILE, data);
}

// Immutable audit trail for compliance (who did what, when). Event payloads must NEVER
// contain PHI — only the event type, dentist id, and a small non-PHI detail.
async function logAudit(event: string, dentistId: string, detail: Record<string, any> = {}) {
  if (dbEnabled) {
    try {
      await dbAppendAudit(event, dentistId, detail);
    } catch (err) {
      logger.error(`Failed to write audit event ${event} to Postgres:`, err);
    }
    return;
  }
  try {
    const auditData = await readDb('dentai:audit', AUDIT_FILE, { events: [] });
    auditData.events.push({
      event,
      dentistId,
      detail,
      timestamp: new Date().toISOString()
    });
    await writeDb('dentai:audit', AUDIT_FILE, auditData);
  } catch (err) {
    logger.error(`Failed to write audit event ${event}:`, err);
  }
}

/* ---------------------------------------------------------------------------
 * Clinics & invite codes (Ecosystem Layer 1)
 *
 * Every dentist automatically owns a personal clinic, so solo practitioners
 * never see a setup step and existing accounts gain the clinic backbone with
 * zero behavior change. Joining via an invite code lands as PENDING — a code
 * is an application credential, not a security credential — and the owner
 * approves or declines in their Members screen.
 * ------------------------------------------------------------------------- */

function isClinicNameTaken(name: string, clinics: any[]): boolean {
  const target = name.toLowerCase();
  return clinics.some((c: any) => String(c.name || '').toLowerCase() === target);
}

async function createClinicRecord(
  dentistId: string,
  dentistName: string,
  clinicName: string
): Promise<ClinicInfo> {
  const clinic: ClinicInfo = {
    id: crypto.randomUUID(),
    name: clinicName,
    inviteCode: generateInviteCode(),
    ownerDentistId: dentistId
  };

  if (dbEnabled) {
    await dbInsertClinic(clinic);
  } else {
    const data = await readClinicsDb();
    // Codes must stay unique in the JSON fallback too (the Postgres path
    // enforces this with a UNIQUE constraint). Extremely unlikely to trigger.
    let code = clinic.inviteCode;
    for (let i = 0; i < 10 && isInviteCodeTaken(code, data.clinics); i++) {
      code = generateInviteCode();
    }
    clinic.inviteCode = code;
    data.clinics.push({
      ...clinic,
      members: [{ dentistId, name: dentistName, role: 'owner', status: 'active' }]
    });
    await writeClinicsDb(data);
  }
  logAudit('clinic_created', dentistId, { clinicId: clinic.id });
  return clinic;
}

/**
 * Ensures the dentist owns a personal clinic. Idempotent and self-healing:
 * called on registration and on every /api/auth/me, so accounts created before
 * this feature gain their personal clinic on first sign-in without migration.
 */
async function ensurePersonalClinic(dentistId: string, dentistName: string): Promise<void> {
  if (dbEnabled) {
    const existing = await dbGetClinicByOwner(dentistId);
    if (existing) return;
    await createClinicRecord(dentistId, dentistName, personalClinicName(dentistName));
    return;
  }

  const data = await readClinicsDb();
  if (data.clinics.some((c: any) => c.ownerDentistId === dentistId)) return;
  await createClinicRecord(dentistId, dentistName, personalClinicName(dentistName));
}

function toMembership(info: any, inviteCodeForOwner?: string): ClinicMembership {
  const membership: ClinicMembership = {
    clinicId: info.clinicId,
    clinicName: info.clinicName,
    role: info.role,
    status: info.status
  };
  if (info.role === 'owner' && inviteCodeForOwner) {
    membership.inviteCode = inviteCodeForOwner;
  }
  return membership;
}

/** All memberships for a dentist; owners additionally receive their invite code. */
async function listMembershipsFor(dentistId: string): Promise<ClinicMembership[]> {
  if (dbEnabled) {
    const rows = await dbListMembershipsForDentist(dentistId);
    return rows.map((r: any) => toMembership(r, r.inviteCode));
  }

  const data = await readClinicsDb();
  const memberships: ClinicMembership[] = [];
  for (const clinic of data.clinics) {
    for (const m of clinic.members || []) {
      if (m.dentistId !== dentistId) continue;
      memberships.push(toMembership(
        { clinicId: clinic.id, clinicName: clinic.name, role: m.role, status: m.status },
        clinic.inviteCode
      ));
    }
  }
  return memberships;
}

function findClinicLocal(data: { clinics: any[] }, clinicId: string): any | null {
  return data.clinics.find((c: any) => c.id === clinicId) || null;
}

/** True when another clinic (optionally excluding one by id) already uses this code. */
function isInviteCodeTaken(code: string, clinics: any[], excludeClinicId?: string): boolean {
  return clinics.some(
    (c: any) => c.id !== excludeClinicId && String(c.inviteCode || '').toUpperCase() === code
  );
}

/**
 * Resolves the clinic a consultation should be stamped with. The client may
 * pass the clinic selected in its switcher, but that is only honoured when the
 * dentist is an ACTIVE member of it — so a note can never be stamped into a
 * clinic the dentist does not belong to. Falls back to the dentist's owned
 * clinic, then any active membership.
 */
async function resolveClinicScope(dentistId: string, requestedClinicId: unknown): Promise<string | undefined> {
  const memberships = await listMembershipsFor(dentistId);
  const active = memberships.filter((m) => m.status === 'active');
  if (typeof requestedClinicId === 'string') {
    const match = active.find((m) => m.clinicId === requestedClinicId);
    if (match) return match.clinicId;
  }
  const owned = active.find((m) => m.role === 'owner');
  return owned?.clinicId ?? active[0]?.clinicId;
}

const SESSION_SECRET = process.env.SESSION_SECRET || 'dentai-secure-workstation-session-secret';
// The hardcoded fallback above exists only so local dev and the test suite keep working.
// A deployed environment MUST set its own SESSION_SECRET — otherwise tokens are forgeable.
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET environment variable is required in production.');
}

// In-memory login lockout (per dentist + IP) to make brute-forcing the 4-digit PIN infeasible.
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function getDentistSalt(dentistId: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`dentist-salt-${dentistId}`).digest('hex');
}

// OWASP-recommended iteration count for PBKDF2-HMAC-SHA512.
const PBKDF2_ITERATIONS = 210_000;
// Iterations used by accounts created before the hardening change; verified as a
// fallback so existing PINs keep working without forcing a reset.
const PBKDF2_LEGACY_ITERATIONS = 1_000;

function getPinHash(pin: string, salt: string, iterations: number = PBKDF2_ITERATIONS): string {
  return crypto.pbkdf2Sync(pin, salt, iterations, 64, 'sha512').toString('hex');
}

// Verifies a PIN against the stored hash, accepting current and legacy iteration counts.
function verifyPinHash(pin: string, salt: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false;
  if (getPinHash(pin, salt, PBKDF2_ITERATIONS) === storedHash) return true;
  return getPinHash(pin, salt, PBKDF2_LEGACY_ITERATIONS) === storedHash;
}

function generateToken(payload: { dentistId: string; name?: string; specialty?: string; exp?: number }): string {
  const finalPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: payload.exp || Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days persistent session
  };
  const payloadStr = JSON.stringify(finalPayload);
  const base64Payload = Buffer.from(payloadStr).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(base64Payload)
    .digest('base64url');
  return `${base64Payload}.${signature}`;
}

function verifyToken(token: string): { dentistId: string; name?: string; specialty?: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [base64Payload, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(base64Payload)
    .digest('base64url');

  if (signature !== expectedSignature) return null;

  try {
    const payloadStr = Buffer.from(base64Payload, 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadStr);
    if (parsed.exp && typeof parsed.exp === 'number' && parsed.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired token
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

// Helper to ensure data files exist
async function initDb() {
  logger.info(dbEnabled ? 'Persistence mode: PostgreSQL (Neon)' : 'Persistence mode: JSON file fallback');
  if (dbEnabled) {
    try {
      await initDbSchema();
      logger.info('Postgres schema initialized.');
      await seedFromJsonFallback();
    } catch (err: any) {
      logger.error('Failed to initialize Postgres schema:', err.message);
    }
  }
  const dataDir = path.resolve(__dirname, 'data');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify({ dentists: [] }, null, 2));
    }
    if (!fs.existsSync(CONSULTATIONS_FILE)) {
      fs.writeFileSync(CONSULTATIONS_FILE, JSON.stringify({ consultations: [] }, null, 2));
    }
    if (!fs.existsSync(AUDIT_FILE)) {
      fs.writeFileSync(AUDIT_FILE, JSON.stringify({ events: [] }, null, 2));
    }
    if (!fs.existsSync(CLINICS_FILE)) {
      fs.writeFileSync(CLINICS_FILE, JSON.stringify({ clinics: [] }, null, 2));
    }
  } catch (err: any) {
    logger.warn('[Database] Read-only filesystem detected during initialization. Relying on in-memory caching.', err.message);
  }
}

initDb().catch(err => logger.error('Async DB initialization failed:', err));

// Authentication Middleware
async function authenticateToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Session expired or invalid.' });
  }
  const dentistId = decoded.dentistId;

  try {
    // O(1) point lookup — the full dentist table used to be loaded on every
    // request, which does not survive thousands of dentists signing in.
    const dentist = dbEnabled
      ? await dbGetDentistById(dentistId)
      : (await readUsersDb()).dentists.find((d: any) => d.id === dentistId);

    // A signed token alone is NOT sufficient — the dentist profile must exist in the
    // database. (Previously a token's name/specialty claims were used to recreate
    // profiles on cold start, which let forged tokens mint new identities.)
    if (!dentist) {
      return res.status(403).json({ error: 'Dentist profile not found.' });
    }
    (req as any).dentist = dentist;
    next();
  } catch (err) {
    logger.error('Database read error in authentication middleware:', err);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
}

// Authentication & Profile Endpoints
app.get('/api/auth/profiles', async (req, res) => {
  try {
    const usersData = await readUsersDb();
    const profiles = usersData.dentists.map((d: any) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialty
    }));
    res.json(profiles);
  } catch (err) {
    logger.error('Failed to read profiles:', err);
    res.status(500).json({ error: 'Failed to retrieve dentist profiles.' });
  }
});

app.delete('/api/auth/profiles/:id', async (req, res) => {
  try {
    const dentistId = req.params.id;
    const { pin } = req.body;

    if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits to confirm deletion.' });
    }

    const usersData = await readUsersDb();
    const dentistIndex = usersData.dentists.findIndex((d: any) => d.id === dentistId);

    if (dentistIndex < 0) {
      return res.status(404).json({ error: 'Dentist profile not found.' });
    }

    const dentist = usersData.dentists[dentistIndex];
    const salt = dentist.salt || getDentistSalt(dentistId);
    // Verify against the stored hash, plus a deterministic-salt fallback for profiles
    // created before per-profile salts were introduced.
    const isValid = verifyPinHash(pin, salt, dentist.pinHash) ||
      verifyPinHash(pin, getDentistSalt(dentistId), dentist.pinHash);

    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect PIN. Profile deletion cancelled.' });
    }

    if (dbEnabled) {
      await dbDeleteDentist(dentistId);
    } else {
      usersData.dentists.splice(dentistIndex, 1);
      await writeUsersDb(usersData);
    }
    logAudit('dentist_deleted', dentistId, {});

    res.json({ success: true, message: 'Dentist profile removed successfully.' });
  } catch (err) {
    logger.error('Profile deletion error:', err);
    res.status(500).json({ error: 'Failed to remove dentist profile.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, specialty, pin } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (!specialty || typeof specialty !== 'string' || specialty.trim().length === 0) {
      return res.status(400).json({ error: 'Specialty is required.' });
    }
    if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
    }

    // Point lookup instead of loading every dentist — registration stays O(1)
    // as the platform grows past thousands of accounts.
    const existingDentist = dbEnabled
      ? await dbGetDentistByName(name.trim())
      : (await readUsersDb()).dentists.find((d: any) => d.name.toLowerCase() === name.toLowerCase());
    if (existingDentist) {
      return res.status(409).json({ error: 'A dentist with this name is already registered.' });
    }

    const newId = crypto.randomUUID();
    const salt = getDentistSalt(newId);
    const pinHash = getPinHash(pin, salt);
    const newDentist = {
      id: newId,
      name,
      specialty,
      pinHash,
      salt,
      mfaEnabled: !!req.body.mfaEnabled
    };

    if (dbEnabled) {
      await dbInsertDentist(newDentist);
    } else {
      const usersData = await readUsersDb();
      usersData.dentists.push(newDentist);
      await writeUsersDb(usersData);
    }

    // Clinic backbone: every dentist gets a personal clinic automatically, and
    // an invite code at registration turns into a PENDING join request that
    // the target clinic's owner must approve (a code is not a security cred).
    await ensurePersonalClinic(newDentist.id, newDentist.name);

    const rawInviteCode = req.body.inviteCode;
    const normalizedJoinCode = normalizeInviteCode(rawInviteCode);
    if (normalizedJoinCode) {
      let targetClinic: any | null = null;
      if (dbEnabled) {
        targetClinic = await dbGetClinicByInviteCode(normalizedJoinCode);
      } else {
        const clinicsData = await readClinicsDb();
        targetClinic = clinicsData.clinics.find(
          (c: any) => String(c.inviteCode || '').toUpperCase() === normalizedJoinCode
        ) || null;
      }
      if (targetClinic && targetClinic.ownerDentistId !== newDentist.id) {
        if (dbEnabled) {
          await dbUpsertMembership(targetClinic.id, newDentist.id, 'pending');
        } else {
          const clinicsData = await readClinicsDb();
          const clinic = findClinicLocal(clinicsData, targetClinic.id);
          if (clinic && !(clinic.members || []).some((m: any) => m.dentistId === newDentist.id)) {
            clinic.members = clinic.members || [];
            clinic.members.push({
              dentistId: newDentist.id,
              name: newDentist.name,
              role: 'dentist',
              status: 'pending'
            });
            await writeClinicsDb(clinicsData);
          }
        }
        logAudit('clinic_join_requested', newDentist.id, { clinicId: targetClinic.id });
      }
    }

    const rawReferredBy = req.body.referredByCode;
    const normalizedReferral = normalizeInviteCode(rawReferredBy);
    if (normalizedReferral) {
      // Attribution only — the referrer's clinic identity is never exposed to
      // the new dentist, and nothing is joined via the referral code.
      logAudit('signup_referral_attributed', newDentist.id, { code: normalizedReferral });
    }

    const token = generateToken({
      dentistId: newDentist.id,
      name: newDentist.name,
      specialty: newDentist.specialty
    });

    logAudit('dentist_registered', newDentist.id, {});

    res.status(201).json({
      token,
      dentist: {
        id: newDentist.id,
        name: newDentist.name,
        specialty: newDentist.specialty,
        mfaEnabled: newDentist.mfaEnabled
      },
      clinics: await listMembershipsFor(newDentist.id)
    });
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register dentist account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const rawIdentifier = req.body.identifier ?? req.body.dentistId ?? req.body.name;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const { pin } = req.body;

    if (!identifier) {
      return res.status(400).json({ error: 'Practitioner identifier (name or ID) is required.' });
    }
    if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
    }

    // Lookup dentist by ID or case-insensitive name match
    let dentist: any = null;
    if (dbEnabled) {
      dentist = (await dbGetDentistById(identifier)) || (await dbGetDentistByName(identifier));
    } else {
      const usersData = await readUsersDb();
      dentist = usersData.dentists.find((d: any) =>
        d.id === identifier || d.name.toLowerCase() === identifier.toLowerCase()
      );
    }

    // The profile MUST exist in the database.
    if (!dentist) {
      logAudit('login_failed', identifier, { reason: 'profile_not_found' });
      return res.status(401).json({ error: 'Invalid practitioner name or PIN.' });
    }

    // Brute-force protection: lock the dentist+IP pair after repeated failures.
    const attemptKey = `${dentist.id}:${req.ip || 'unknown'}`;
    const attempt = loginAttempts.get(attemptKey);
    if (attempt && attempt.lockedUntil > Date.now()) {
      return res.status(429).json({ error: 'Too many failed attempts. Please try again in 15 minutes.' });
    }
    if (attempt && attempt.lockedUntil <= Date.now()) {
      loginAttempts.delete(attemptKey);
    }

    const dentistSalt = dentist.salt || getDentistSalt(dentist.id);
    const isValid =
      verifyPinHash(pin, dentistSalt, dentist.pinHash) ||
      verifyPinHash(pin, getDentistSalt(dentist.id), dentist.pinHash);

    if (!isValid) {
      const next = { count: (attempt?.count || 0) + 1, lockedUntil: 0 };
      if (next.count >= LOGIN_MAX_ATTEMPTS) {
        next.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
        next.count = 0;
      }
      loginAttempts.set(attemptKey, next);
      logAudit('login_failed', dentist.id, { reason: 'invalid_pin' });
      return res.status(401).json({ error: 'Invalid practitioner name or PIN.' });
    }

    loginAttempts.delete(attemptKey);

    // Multi-factor authentication hook (structural readiness for future MFA activation)
    if (dentist.mfaEnabled) {
      const mfaToken = generateToken({
        dentistId: dentist.id,
        name: dentist.name,
        specialty: dentist.specialty,
        exp: Math.floor(Date.now() / 1000) + 10 * 60 // 10 minute challenge window
      });
      logAudit('mfa_challenge_issued', dentist.id, {});
      return res.json({
        mfaRequired: true,
        mfaToken,
        dentistId: dentist.id,
        dentistName: dentist.name,
        message: 'Multi-factor authentication required. Enter your 6-digit verification code.'
      });
    }

    const token = generateToken({
      dentistId: dentist.id,
      name: dentist.name,
      specialty: dentist.specialty
    });

    logAudit('login_success', dentist.id, {});

    res.json({
      token,
      dentist: {
        id: dentist.id,
        name: dentist.name,
        specialty: dentist.specialty,
        mfaEnabled: !!dentist.mfaEnabled
      }
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Failed to authenticate.' });
  }
});

app.post('/api/auth/mfa/verify', async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    if (!mfaToken || typeof mfaToken !== 'string') {
      return res.status(400).json({ error: 'MFA session token is required.' });
    }
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Verification code must be exactly 6 digits.' });
    }

    const decoded = verifyToken(mfaToken);
    if (!decoded) {
      return res.status(401).json({ error: 'MFA challenge expired or invalid. Please sign in again.' });
    }

    let dentist: any = null;
    if (dbEnabled) {
      dentist = await dbGetDentistById(decoded.dentistId);
    } else {
      const usersData = await readUsersDb();
      dentist = usersData.dentists.find((d: any) => d.id === decoded.dentistId);
    }

    if (!dentist) {
      return res.status(401).json({ error: 'Dentist profile not found.' });
    }

    const token = generateToken({
      dentistId: dentist.id,
      name: dentist.name,
      specialty: dentist.specialty
    });

    logAudit('mfa_verified', dentist.id, {});

    res.json({
      token,
      dentist: {
        id: dentist.id,
        name: dentist.name,
        specialty: dentist.specialty,
        mfaEnabled: !!dentist.mfaEnabled
      }
    });
  } catch (err) {
    logger.error('MFA verification error:', err);
    res.status(500).json({ error: 'Failed to complete MFA verification.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.sendStatus(204);
});

app.get('/api/auth/me', authenticateToken, async (req: any, res) => {
  try {
    // Self-heals accounts created before the clinic backbone: the personal
    // clinic materializes on the first authenticated call after this deploy.
    await ensurePersonalClinic(req.dentist.id, req.dentist.name);
    res.json({
      id: req.dentist.id,
      name: req.dentist.name,
      specialty: req.dentist.specialty,
      clinics: await listMembershipsFor(req.dentist.id)
    });
  } catch (err) {
    logger.error('Failed to load session:', err);
    res.status(500).json({ error: 'Failed to load session.' });
  }
});

// Clinic invite-code endpoints (Ecosystem Layer 1)
app.get('/api/clinics/mine', authenticateToken, async (req: any, res) => {
  try {
    await ensurePersonalClinic(req.dentist.id, req.dentist.name);
    res.json(await listMembershipsFor(req.dentist.id));
  } catch (err) {
    logger.error('Failed to list clinic memberships:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic memberships.' });
  }
});

app.post('/api/clinics/join', authenticateToken, async (req: any, res) => {
  try {
    const code = normalizeInviteCode(req.body?.inviteCode);
    if (!code) {
      return res.status(400).json({ error: 'Enter a valid invite code (letters and numbers).' });
    }

    let clinic: any | null = null;
    if (dbEnabled) {
      clinic = await dbGetClinicByInviteCode(code);
    } else {
      const data = await readClinicsDb();
      clinic = data.clinics.find(
        (c: any) => String(c.inviteCode || '').toUpperCase() === code
      ) || null;
    }
    if (!clinic) {
      return res.status(404).json({ error: 'No clinic matches that invite code. Double-check with the person who shared it.' });
    }
    if (clinic.ownerDentistId === req.dentist.id) {
      return res.status(400).json({ error: 'That is your own clinic\'s invite code.' });
    }

    if (dbEnabled) {
      await dbUpsertMembership(clinic.id, req.dentist.id, 'pending');
    } else {
      const data = await readClinicsDb();
      const target = findClinicLocal(data, clinic.id);
      if (!target) return res.status(404).json({ error: 'No clinic matches that invite code. Double-check with the person who shared it.' });
      target.members = target.members || [];
      const existing = target.members.find((m: any) => m.dentistId === req.dentist.id);
      if (existing) {
        existing.status = 'pending';
      } else {
        target.members.push({
          dentistId: req.dentist.id,
          name: req.dentist.name,
          role: 'dentist',
          status: 'pending'
        });
      }
      await writeClinicsDb(data);
    }

    logAudit('clinic_join_requested', req.dentist.id, { clinicId: clinic.id });
    res.status(202).json({
      message: `Request sent to ${clinic.name}. You'll see the clinic once the owner approves.`,
      clinicId: clinic.id
    });
  } catch (err) {
    logger.error('Clinic join failed:', err);
    res.status(500).json({ error: 'Failed to request clinic membership.' });
  }
});

app.post('/api/clinics/:id/members/:dentistId/approve', authenticateToken, async (req: any, res) => {
  try {
    const clinicId = req.params.id;
    const memberDentistId = req.params.dentistId;

    let clinic: any | null = null;
    let approved = false;
    if (dbEnabled) {
      clinic = await dbGetClinicById(clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can approve members.' });
      }
      await dbUpsertMembership(clinicId, memberDentistId, 'active');
      approved = true;
    } else {
      const data = await readClinicsDb();
      clinic = findClinicLocal(data, clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can approve members.' });
      }
      clinic.members = clinic.members || [];
      const member = clinic.members.find((m: any) => m.dentistId === memberDentistId);
      if (!member) return res.status(404).json({ error: 'Membership request not found.' });
      member.status = 'active';
      if (!member.name) member.name = req.dentist.name;
      await writeClinicsDb(data);
      approved = true;
    }

    logAudit('clinic_member_approved', req.dentist.id, { clinicId, memberDentistId });
    res.json({ success: approved, clinicId });
  } catch (err) {
    logger.error('Member approval failed:', err);
    res.status(500).json({ error: 'Failed to approve member.' });
  }
});

app.post('/api/clinics/:id/members/:dentistId/decline', authenticateToken, async (req: any, res) => {
  try {
    const clinicId = req.params.id;
    const memberDentistId = req.params.dentistId;

    let removed = false;
    if (dbEnabled) {
      const clinic = await dbGetClinicById(clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can decline members.' });
      }
      removed = await dbDeleteMembership(clinicId, memberDentistId);
    } else {
      const data = await readClinicsDb();
      const clinic = findClinicLocal(data, clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can decline members.' });
      }
      const before = (clinic.members || []).length;
      clinic.members = (clinic.members || []).filter(
        (m: any) => !(m.dentistId === memberDentistId && m.role !== 'owner')
 );
      removed = clinic.members.length < before;
      if (removed) await writeClinicsDb(data);
    }

    logAudit('clinic_member_declined', req.dentist.id, { clinicId, memberDentistId });
    res.json({ success: removed });
  } catch (err) {
    logger.error('Member decline failed:', err);
    res.status(500).json({ error: 'Failed to decline member.' });
  }
});

app.post('/api/clinics/:id/rotate-code', authenticateToken, async (req: any, res) => {
  try {
    const clinicId = req.params.id;
    if (dbEnabled) {
      const clinic = await dbGetClinicById(clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can rotate the invite code.' });
      }
    } else {
      const data = await readClinicsDb();
      const clinic = findClinicLocal(data, clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can rotate the invite code.' });
      }
    }

    // Uniqueness loop: retry on the (astronomically unlikely) code collision.
    for (let attempt = 0; attempt < 10; attempt++) {
      const nextCode = generateInviteCode();
      try {
        if (dbEnabled) {
          await dbUpdateClinicInviteCode(clinicId, nextCode);
        } else {
          const data = await readClinicsDb();
          const clinic = findClinicLocal(data, clinicId);
          // Another clinic already uses this candidate → try the next one.
          if (isInviteCodeTaken(nextCode, data.clinics, clinicId)) continue;
          clinic.inviteCode = nextCode;
          await writeClinicsDb(data);
        }
        logAudit('clinic_code_rotated', req.dentist.id, { clinicId });
        return res.json({ inviteCode: nextCode });
      } catch (err: any) {
        const isUniqueViolation = err?.code === '23505' || /unique|duplicate/i.test(String(err?.message || ''));
        if (!isUniqueViolation) throw err;
      }
    }
    res.status(500).json({ error: 'Could not generate a unique invite code. Try again.' });
  } catch (err) {
    logger.error('Invite code rotation failed:', err);
    res.status(500).json({ error: 'Failed to rotate invite code.' });
  }
});

app.post('/api/clinics/:id/rename', authenticateToken, async (req: any, res) => {
  try {
    const clinicId = req.params.id;
    const name = sanitizeClinicName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'Clinic name must be 2-80 characters.' });
    }

    if (dbEnabled) {
      const clinic = await dbGetClinicById(clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can rename the clinic.' });
      }
      await dbUpdateClinicName(clinicId, name);
    } else {
      const data = await readClinicsDb();
      const clinic = findClinicLocal(data, clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can rename the clinic.' });
      }
      if (isClinicNameTaken(name, data.clinics.filter((c: any) => c.id !== clinicId))) {
        return res.status(409).json({ error: 'A clinic with this name already exists.' });
      }
      clinic.name = name;
      await writeClinicsDb(data);
    }

    logAudit('clinic_renamed', req.dentist.id, { clinicId });
    res.json({ success: true, name });
  } catch (err) {
    logger.error('Clinic rename failed:', err);
    res.status(500).json({ error: 'Failed to rename clinic.' });
  }
});

app.get('/api/clinics/:id/members', authenticateToken, async (req: any, res) => {
  try {
    const clinicId = req.params.id;

    let members: ClinicMemberSummary[] = [];
    let inviteCode: string | undefined;
    if (dbEnabled) {
      const clinic = await dbGetClinicById(clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can view the member list.' });
      }
      members = await dbListClinicMembers(clinicId);
      inviteCode = clinic.inviteCode;
    } else {
      const data = await readClinicsDb();
      const clinic = findClinicLocal(data, clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can view the member list.' });
      }
      members = (clinic.members || []).map((m: any) => ({
        dentistId: m.dentistId,
        name: m.name,
        role: m.role,
        status: m.status
      }));
      inviteCode = clinic.inviteCode;
    }

    res.json({ inviteCode, members });
  } catch (err) {
    logger.error('Failed to list clinic members:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic members.' });
  }
});

// Owner-only: every consultation recorded under this clinic (any member's
// notes). This is what powers the owner's cross-clinic view — a dentist only
// ever sees their own records through /api/consultations, while an owner sees
// the practice's records for the clinics they own.
app.get('/api/clinics/:id/consultations', authenticateToken, async (req: any, res) => {
  try {
    const clinicId = req.params.id;

    if (dbEnabled) {
      const clinic = await dbGetClinicById(clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can view this clinic\'s records.' });
      }
    } else {
      const data = await readClinicsDb();
      const clinic = findClinicLocal(data, clinicId);
      if (!clinic) return res.status(404).json({ error: 'Clinic not found.' });
      if (clinic.ownerDentistId !== req.dentist.id) {
        return res.status(403).json({ error: 'Only the clinic owner can view this clinic\'s records.' });
      }
    }

    let consultations: any[];
    if (dbEnabled) {
      consultations = await dbListConsultationsForClinic(clinicId);
    } else {
      const consultationsData = await readConsultationsDb();
      consultations = consultationsData.consultations.filter(
        (c: any) => c.clinicId === clinicId
      );
    }
    res.json(consultations);
  } catch (err) {
    logger.error('Failed to list clinic consultations:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic records.' });
  }
});

// Consultation Persistence Endpoints
app.get('/api/consultations', authenticateToken, async (req: any, res) => {
  try {
    let myConsultations: any[];
    if (dbEnabled) {
      myConsultations = await dbListConsultations(req.dentist.id);
    } else {
      const consultationsData = await readConsultationsDb();
      myConsultations = consultationsData.consultations.filter(
        (c: any) => c.dentistId === req.dentist.id
      );
    }
    res.json(myConsultations);
  } catch (err) {
    logger.error('Failed to read consultations:', err);
    res.status(500).json({ error: 'Failed to retrieve consultations.' });
  }
});

app.post('/api/consultations', authenticateToken, async (req: any, res) => {
  try {
    const consultation = req.body;
    if (!consultation || typeof consultation !== 'object') {
      return res.status(400).json({ error: 'Invalid consultation payload.' });
    }

    // Sanitize patient details in body
    if (typeof consultation.firstName === 'string') {
      consultation.firstName = consultation.firstName.replace(/[<>]/g, '').trim();
    }
    if (typeof consultation.lastName === 'string') {
      consultation.lastName = consultation.lastName.replace(/[<>]/g, '').trim();
    }

    const newConsultation = {
      ...consultation,
      id: consultation.id || crypto.randomUUID(),
      dentistId: req.dentist.id
    };

    // Clinic scoping: consultations are stamped with the clinic the dentist is
    // currently working in. The client's selected clinic is honoured only when
    // it is an active membership (never a clinic the dentist doesn't belong
    // to); otherwise fall back to the owned clinic, then any active clinic.
    try {
      const scope = await resolveClinicScope(req.dentist.id, newConsultation.clinicId);
      if (scope) newConsultation.clinicId = scope;
    } catch (err) {
      logger.warn('Could not resolve clinic scope for consultation; saving without clinicId.', err);
    }

    // Auto-extract and quantify unscheduled treatment opportunities if not explicitly populated
    if (!newConsultation.findings?.proposedTreatments || newConsultation.findings.proposedTreatments.length === 0) {
      const patientFullName = `${newConsultation.firstName || ''} ${newConsultation.lastName || ''}`.trim() || 'Patient';
      const extracted = extractProposedTreatmentsFromFindings({
        findings: newConsultation.findings,
        patientName: patientFullName,
        dentistId: newConsultation.dentistId,
        clinicId: newConsultation.clinicId,
        consultationId: newConsultation.id
      });
      if (extracted.length > 0) {
        newConsultation.findings = {
          ...(newConsultation.findings || {}),
          proposedTreatments: extracted
        };
        newConsultation.proposedTreatments = extracted;
      }
    }

    if (dbEnabled) {
      await dbInsertConsultation(newConsultation);
    } else {
      const consultationsData = await readConsultationsDb();
      consultationsData.consultations.unshift(newConsultation);
      await writeConsultationsDb(consultationsData);
    }
    logAudit('consultation_created', req.dentist.id, { consultationId: newConsultation.id });
    res.status(201).json(newConsultation);
  } catch (err) {
    logger.error('Failed to save consultation:', err);
    res.status(500).json({ error: 'Failed to save consultation record.' });
  }
});

app.put('/api/consultations/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const updatedPayload = req.body;
    if (!updatedPayload || typeof updatedPayload !== 'object') {
      return res.status(400).json({ error: 'Invalid consultation payload.' });
    }

    if (dbEnabled) {
      const existing = (await dbListConsultations(req.dentist.id)).find((c: any) => c.id === id);
      if (!existing) {
        return res.status(404).json({ error: 'Consultation not found or unauthorized.' });
      }
      const merged = {
        ...existing,
        ...updatedPayload,
        id,
        dentistId: req.dentist.id
      };
      try {
        const scope = await resolveClinicScope(req.dentist.id, merged.clinicId);
        if (scope) merged.clinicId = scope;
      } catch (err) {
        logger.warn('Could not resolve clinic scope on update; preserving stored clinicId.', err);
      }
      await dbUpdateConsultation(id, req.dentist.id, merged);
      logAudit('consultation_updated', req.dentist.id, { consultationId: id });
      return res.json(merged);
    }

    const consultationsData = await readConsultationsDb();
    const index = consultationsData.consultations.findIndex(
      (c: any) => c.id === id && c.dentistId === req.dentist.id
    );

    if (index === -1) {
      return res.status(404).json({ error: 'Consultation not found or unauthorized.' });
    }

    consultationsData.consultations[index] = {
      ...consultationsData.consultations[index],
      ...updatedPayload,
      id,
      dentistId: req.dentist.id
    };

    try {
      const scope = await resolveClinicScope(req.dentist.id, consultationsData.consultations[index].clinicId);
      if (scope) consultationsData.consultations[index].clinicId = scope;
    } catch (err) {
      logger.warn('Could not resolve clinic scope on update; preserving stored clinicId.', err);
    }

    await writeConsultationsDb(consultationsData);
    logAudit('consultation_updated', req.dentist.id, { consultationId: id });
    res.json(consultationsData.consultations[index]);
  } catch (err) {
    logger.error('Failed to update consultation:', err);
    res.status(500).json({ error: 'Failed to update consultation record.' });
  }
});

// ---------------------------------------------------------------------------
// Practice Treatment Pipeline & Closed-Loop ROI Endpoints
// ---------------------------------------------------------------------------

app.get('/api/pipeline', authenticateToken, async (req: any, res) => {
  try {
    const dentistId = req.dentist.id;
    const requestedClinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : undefined;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : 'all';

    let clinicId: string | null = null;
    try {
      clinicId = await resolveClinicScope(dentistId, requestedClinicId);
    } catch {
      clinicId = null;
    }

    let consults: any[] = [];
    if (dbEnabled) {
      if (clinicId) {
        consults = await dbListConsultationsForClinic(clinicId);
        // Include historical consultations created by this dentist prior to clinic scoping
        const ownConsults = await dbListConsultations(dentistId);
        const unassigned = ownConsults.filter((c: any) => !c.clinicId);
        const existingIds = new Set(consults.map((c: any) => c.id));
        for (const un of unassigned) {
          if (!existingIds.has(un.id)) {
            consults.push(un);
          }
        }
      } else {
        consults = await dbListConsultations(dentistId);
      }
    } else {
      const consultationsData = await readConsultationsDb();
      if (clinicId) {
        consults = consultationsData.consultations.filter((c: any) =>
          c.clinicId === clinicId || (!c.clinicId && c.dentistId === dentistId)
        );
      } else {
        consults = consultationsData.consultations.filter((c: any) => c.dentistId === dentistId);
      }
    }

    // Collect treatment opportunities across consults with memoization
    const opportunities: TreatmentOpportunity[] = [];
    let unscheduledCount = 0;
    let bookedCount = 0;
    let declinedCount = 0;
    let totalIdentifiedValue = 0;
    let unscheduledValue = 0;
    let bookedValue = 0;
    let declinedValue = 0;

    for (const c of consults) {
      const patientName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Patient';
      let items: TreatmentOpportunity[] = [];
      if (Array.isArray(c.findings?.proposedTreatments) && c.findings.proposedTreatments.length > 0) {
        items = c.findings.proposedTreatments;
      } else if (Array.isArray(c.proposedTreatments) && c.proposedTreatments.length > 0) {
        items = c.proposedTreatments;
      } else {
        items = extractProposedTreatmentsFromFindings({
          findings: c.findings,
          patientName,
          dentistId: c.dentistId || dentistId,
          clinicId: c.clinicId || clinicId || undefined,
          consultationId: c.id
        });
        // In-memory memoization to avoid re-running regex on repeated queries
        if (c.findings) c.findings.proposedTreatments = items;
        c.proposedTreatments = items;
      }

      for (const item of items) {
        const enriched: TreatmentOpportunity = {
          ...item,
          patientName: item.patientName || patientName,
          consultationId: item.consultationId || c.id,
          dentistId: item.dentistId || c.dentistId || dentistId,
          clinicId: item.clinicId || c.clinicId || clinicId || undefined
        };

        const fee = Number(enriched.estimatedFee) || 0;
        totalIdentifiedValue += fee;
        if (enriched.status === 'unscheduled') {
          unscheduledCount++;
          unscheduledValue += fee;
        } else if (enriched.status === 'booked' || enriched.status === 'completed') {
          bookedCount++;
          bookedValue += fee;
        } else if (enriched.status === 'declined') {
          declinedCount++;
          declinedValue += fee;
        }

        if (statusFilter === 'all' || enriched.status === statusFilter) {
          opportunities.push(enriched);
        }
      }
    }

    // Support optional pagination/windowing for large-scale practices
    const limitParam = req.query.limit !== undefined ? Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000) : undefined;
    const offsetParam = req.query.offset !== undefined ? Math.max(Number(req.query.offset) || 0, 0) : 0;
    const paginatedOpportunities = limitParam !== undefined
      ? opportunities.slice(offsetParam, offsetParam + limitParam)
      : opportunities;

    res.json({
      opportunities: paginatedOpportunities,
      totalCount: opportunities.length,
      hasMore: limitParam !== undefined ? offsetParam + limitParam < opportunities.length : false,
      totalIdentifiedValue,
      unscheduledValue,
      bookedValue,
      declinedValue,
      unscheduledCount,
      bookedCount,
      declinedCount
    });
  } catch (err) {
    logger.error('Failed to get treatment pipeline:', err);
    res.status(500).json({ error: 'Failed to retrieve treatment pipeline.' });
  }
});

app.patch('/api/pipeline/:id', authenticateToken, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { status, notes, pmsType, pmsAppointmentId, pmsBookingRef } = req.body;

    const validStatuses: TreatmentStatus[] = ['unscheduled', 'contacted', 'booked', 'completed', 'declined'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    let foundOpp: TreatmentOpportunity | null = null;
    let targetConsult: any = null;

    // Fast O(1) targeting: opportunity IDs are formatted as `${consultationId}-tx-...`
    const fastConsultId = id.includes('-tx-') ? id.split('-tx-')[0] : null;

    if (dbEnabled) {
      const userConsults = await dbListConsultations(req.dentist.id);
      // Check candidate consultation directly if ID prefix is available, else fallback to full scan
      const candidates = fastConsultId
        ? userConsults.filter((c: any) => c.id === fastConsultId)
        : userConsults;
      const searchPool = candidates.length > 0 ? candidates : userConsults;

      for (const c of searchPool) {
        const items = c.findings?.proposedTreatments || extractProposedTreatmentsFromFindings({
          findings: c.findings,
          patientName: `${c.firstName} ${c.lastName}`,
          dentistId: c.dentistId,
          clinicId: c.clinicId,
          consultationId: c.id
        });
        const match = items.find((i: any) => i.id === id);
        if (match) {
          match.status = status;
          if (status === 'contacted') match.lastContactedAt = new Date().toISOString();
          if (status === 'booked') match.bookedAt = new Date().toISOString();
          if (status === 'declined') {
            match.lastContactedAt = new Date().toISOString();
            if (notes) match.patientBarrier = notes;
          }
          if (status === 'unscheduled') {
            // Re-opened opportunity
            if (notes !== undefined) match.patientBarrier = notes;
          }
          if (notes && status !== 'declined' && status !== 'unscheduled') match.patientBarrier = notes;

          // Closed-loop PMS attribution fields
          if (pmsType) match.pmsType = pmsType;
          if (pmsAppointmentId) {
            match.pmsAppointmentId = pmsAppointmentId;
            match.pmsSyncStatus = 'verified';
          }
          if (pmsBookingRef) match.pmsBookingRef = pmsBookingRef;

          foundOpp = match;
          c.findings = { ...c.findings, proposedTreatments: items };
          c.proposedTreatments = items;
          await dbUpdateConsultation(c.id, c.dentistId, c);
          targetConsult = c;
          break;
        }
      }
    } else {
      const data = await readConsultationsDb();
      const candidates = fastConsultId
        ? data.consultations.filter((c: any) => c.id === fastConsultId)
        : data.consultations;
      const searchPool = candidates.length > 0 ? candidates : data.consultations;

      for (const c of searchPool) {
        const items = c.findings?.proposedTreatments || extractProposedTreatmentsFromFindings({
          findings: c.findings,
          patientName: `${c.firstName} ${c.lastName}`,
          dentistId: c.dentistId,
          clinicId: c.clinicId,
          consultationId: c.id
        });
        const match = items.find((i: any) => i.id === id);
        if (match) {
          match.status = status;
          if (status === 'contacted') match.lastContactedAt = new Date().toISOString();
          if (status === 'booked') match.bookedAt = new Date().toISOString();
          if (status === 'declined') {
            match.lastContactedAt = new Date().toISOString();
            if (notes) match.patientBarrier = notes;
          }
          if (status === 'unscheduled') {
            // Re-opened opportunity
            if (notes !== undefined) match.patientBarrier = notes;
          }
          if (notes && status !== 'declined' && status !== 'unscheduled') match.patientBarrier = notes;

          // Closed-loop PMS attribution fields
          if (pmsType) match.pmsType = pmsType;
          if (pmsAppointmentId) {
            match.pmsAppointmentId = pmsAppointmentId;
            match.pmsSyncStatus = 'verified';
          }
          if (pmsBookingRef) match.pmsBookingRef = pmsBookingRef;

          foundOpp = match;
          c.findings = { ...c.findings, proposedTreatments: items };
          c.proposedTreatments = items;
          await writeConsultationsDb(data);
          targetConsult = c;
          break;
        }
      }
    }

    if (!foundOpp) {
      return res.status(404).json({ error: 'Treatment opportunity not found.' });
    }

    logAudit('pipeline_treatment_updated', req.dentist.id, {
      opportunityId: id,
      newStatus: status,
      barrierReason: notes,
      pmsType,
      pmsAppointmentId,
      consultationId: targetConsult?.id
    });

    res.json({ success: true, opportunity: foundOpp });
  } catch (err) {
    logger.error('Failed to update pipeline opportunity:', err);
    res.status(500).json({ error: 'Failed to update treatment opportunity.' });
  }
});

// Inbound PMS Booking Webhook (Cliniko, Core Practice, or Zapier integration)
app.post('/api/webhooks/pms-booking', async (req: any, res) => {
  try {
    const { opportunityId, pmsType = 'cliniko', pmsAppointmentId, patientName, bookedAt = new Date().toISOString(), clinicId } = req.body;

    if (!pmsAppointmentId && !opportunityId) {
      return res.status(400).json({ error: 'Missing required parameters: opportunityId or pmsAppointmentId required.' });
    }

    let foundOpp: TreatmentOpportunity | null = null;
    let targetConsult: any = null;

    if (dbEnabled) {
      const fastConsultId = opportunityId && opportunityId.includes('-tx-') ? opportunityId.split('-tx-')[0] : null;
      const allConsults = clinicId ? await dbListConsultationsForClinic(clinicId) : [];
      const searchPool = fastConsultId ? allConsults.filter((c: any) => c.id === fastConsultId) : allConsults;

      for (const c of searchPool) {
        const items = c.findings?.proposedTreatments || extractProposedTreatmentsFromFindings({
          findings: c.findings,
          patientName: `${c.firstName} ${c.lastName}`,
          dentistId: c.dentistId,
          clinicId: c.clinicId,
          consultationId: c.id
        });
        const match = opportunityId
          ? items.find((i: any) => i.id === opportunityId)
          : items.find((i: any) => patientName && `${c.firstName} ${c.lastName}`.toLowerCase().includes(patientName.toLowerCase().trim()));

        if (match) {
          match.status = 'booked';
          match.bookedAt = bookedAt;
          match.pmsType = pmsType;
          match.pmsAppointmentId = pmsAppointmentId;
          match.pmsSyncStatus = 'auto_synced';
          foundOpp = match;
          c.findings = { ...c.findings, proposedTreatments: items };
          c.proposedTreatments = items;
          await dbUpdateConsultation(c.id, c.dentistId, c);
          targetConsult = c;
          break;
        }
      }
    } else {
      const data = await readConsultationsDb();
      const fastConsultId = opportunityId && opportunityId.includes('-tx-') ? opportunityId.split('-tx-')[0] : null;
      const searchPool = fastConsultId
        ? data.consultations.filter((c: any) => c.id === fastConsultId)
        : data.consultations;

      for (const c of searchPool) {
        const items = c.findings?.proposedTreatments || extractProposedTreatmentsFromFindings({
          findings: c.findings,
          patientName: `${c.firstName} ${c.lastName}`,
          dentistId: c.dentistId,
          clinicId: c.clinicId,
          consultationId: c.id
        });
        const match = opportunityId
          ? items.find((i: any) => i.id === opportunityId)
          : items.find((i: any) => patientName && `${c.firstName} ${c.lastName}`.toLowerCase().includes(patientName.toLowerCase().trim()));

        if (match) {
          match.status = 'booked';
          match.bookedAt = bookedAt;
          match.pmsType = pmsType;
          match.pmsAppointmentId = pmsAppointmentId;
          match.pmsSyncStatus = 'auto_synced';
          foundOpp = match;
          c.findings = { ...c.findings, proposedTreatments: items };
          c.proposedTreatments = items;
          await writeConsultationsDb(data);
          targetConsult = c;
          break;
        }
      }
    }

    if (!foundOpp) {
      return res.status(404).json({ error: 'No matching treatment opportunity found for PMS booking.' });
    }

    logAudit('pipeline_pms_webhook_received', targetConsult?.dentistId || 'system', {
      opportunityId: foundOpp.id,
      pmsType,
      pmsAppointmentId,
      consultationId: targetConsult?.id
    });

    res.json({ success: true, opportunity: foundOpp });
  } catch (err) {
    logger.error('Failed to process PMS booking webhook:', err);
    res.status(500).json({ error: 'Failed to process PMS booking webhook.' });
  }
});

app.get('/api/pipeline/roi', authenticateToken, async (req: any, res) => {
  try {
    const dentistId = req.dentist.id;
    const requestedClinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : undefined;
    let clinicId: string | null = null;
    try {
      clinicId = await resolveClinicScope(dentistId, requestedClinicId);
    } catch {
      clinicId = null;
    }

    let consults: any[] = [];
    if (dbEnabled) {
      if (clinicId) {
        consults = await dbListConsultationsForClinic(clinicId);
        const ownConsults = await dbListConsultations(dentistId);
        const unassigned = ownConsults.filter((c: any) => !c.clinicId);
        const existingIds = new Set(consults.map((c: any) => c.id));
        for (const un of unassigned) {
          if (!existingIds.has(un.id)) {
            consults.push(un);
          }
        }
      } else {
        consults = await dbListConsultations(dentistId);
      }
    } else {
      const data = await readConsultationsDb();
      consults = clinicId
        ? data.consultations.filter((c: any) => c.clinicId === clinicId || (!c.clinicId && c.dentistId === dentistId))
        : data.consultations.filter((c: any) => c.dentistId === dentistId);
    }

    let totalIdentifiedValue = 0;
    let totalBookedValue = 0;
    let totalCompletedValue = 0;
    let unscheduledValue = 0;
    let declinedValue = 0;
    let unscheduledCount = 0;
    let bookedCount = 0;
    let declinedCount = 0;

    // Closed-loop verified metrics
    let verifiedBookedValue = 0;
    let verifiedBookedCount = 0;
    let daysToBookTotal = 0;
    let daysToBookCount = 0;

    for (const c of consults) {
      const items = c.findings?.proposedTreatments || extractProposedTreatmentsFromFindings({
        findings: c.findings,
        patientName: `${c.firstName} ${c.lastName}`,
        dentistId: c.dentistId,
        clinicId: c.clinicId,
        consultationId: c.id
      });
      for (const item of items) {
        const fee = Number(item.estimatedFee) || 0;
        totalIdentifiedValue += fee;
        if (item.status === 'unscheduled') {
          unscheduledCount++;
          unscheduledValue += fee;
        } else if (item.status === 'booked') {
          bookedCount++;
          totalBookedValue += fee;
          if (item.pmsAppointmentId || item.pmsSyncStatus === 'verified' || item.pmsSyncStatus === 'auto_synced') {
            verifiedBookedCount++;
            verifiedBookedValue += fee;
          }
          if (item.bookedAt && (item.createdAt || c.date)) {
            const start = new Date(item.createdAt || c.date).getTime();
            const end = new Date(item.bookedAt).getTime();
            if (!isNaN(start) && !isNaN(end) && end >= start) {
              const diffDays = Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
              daysToBookTotal += diffDays;
              daysToBookCount++;
            }
          }
        } else if (item.status === 'completed') {
          totalCompletedValue += fee;
          totalBookedValue += fee;
          if (item.pmsAppointmentId || item.pmsSyncStatus === 'verified' || item.pmsSyncStatus === 'auto_synced') {
            verifiedBookedCount++;
            verifiedBookedValue += fee;
          }
        } else if (item.status === 'declined') {
          declinedCount++;
          declinedValue += fee;
        }
      }
    }

    const conversionRatePct = totalIdentifiedValue > 0
      ? Number(((totalBookedValue / totalIdentifiedValue) * 100).toFixed(1))
      : 0;

    const averageDaysToBook = daysToBookCount > 0
      ? Number((daysToBookTotal / daysToBookCount).toFixed(1))
      : 0;

    const subscriptionCost = 149;
    const netRoiMultiple = totalBookedValue > 0
      ? Number((totalBookedValue / subscriptionCost).toFixed(1))
      : 0;

    const summary: PracticeRoiSummary = {
      clinicId: clinicId || 'personal',
      month: new Date().toISOString().slice(0, 7),
      totalIdentifiedValue,
      totalBookedValue,
      totalCompletedValue,
      unscheduledCount,
      bookedCount,
      declinedCount,
      declinedValue,
      subscriptionCost,
      netRoiMultiple,
      verifiedBookedValue,
      verifiedBookedCount,
      conversionRatePct,
      averageDaysToBook
    };

    res.json(summary);
  } catch (err) {
    logger.error('Failed to compute pipeline ROI:', err);
    res.status(500).json({ error: 'Failed to calculate pipeline ROI metrics.' });
  }
});

const DENTAL_CLINICAL_SYSTEM_INSTRUCTION = `You are an expert dental transcription assistant and charting AI, specializing in record-keeping for the Australian dental market. Your task is to process a pre-session patient intake form and a clinical session transcript, and generate structured clinical notes and a patient summary letter. Note that the transcript is captured as a unified stream of dialogue and comments (with roles labeled as 'Dialogue' or 'Clinical Comment'). You must contextually infer which statements were spoken by the dentist vs. the patient to construct the correct findings.

Your output must comply with the Dental Board of Australia record-keeping guidelines (ADA format).

CRITICAL REQUIREMENTS:
1. DENTAL NOTATION: Australian dentists use the FDI World Dental Federation two-digit system exclusively (Quadrants 1 to 4: 11-18, 21-28, 31-38, 41-48). Any mentioned tooth numbers must be mapped and formatted in FDI notation in the clinical notes.
2. ACCENT & PHONETIC RESILIENCY: The transcript is generated from speakers with diverse accents, speeds, and dictions. It contains phonetic errors, homophones, or slurred words. You must contextually and semantically correct these errors:
   - "tooth category" or "feeling" -> "filling" or "carious lesion" or "restoration"
   - "tooth tree" or "tooth dirty tree" -> "tooth 33"
   - "tooth two four" -> "tooth 24"
   - "pocket depths tree two tree" -> "3-2-3 mm pocket depths"
   - "root can all" -> "root canal treatment"
   - "pulp it is" -> "pulpitis"
3. SPELLING: All patient-facing summaries and notes must utilize Australian/British English (en-AU) spelling conventions (e.g., "colour", "anaesthetic", "minimise", "programme", "haemorrhage").
4. NOTES FORMATTING (NON-REDUNDANT & CONCISE):
   - chiefComplaint: Concise 1-2 sentence statement of presenting symptom/reason for visit.
   - history: Patient medical/dental background and hygiene routine. Do NOT repeat the chief complaint or tooth findings here.
   - toothFindings: Specific hard-tissue observations and tooth-specific signs (using FDI tooth numbers). Keep precise and clinical.
   - findingsGingival: Soft tissue/gingival health, periodontal charting, pocket depths.
   - diagnosis: Explicit primary and secondary clinical diagnoses (e.g. Tooth 16: Symptomatic irreversible pulpitis). Do NOT restate procedural steps.
   - treatmentPerformed: Only procedures, examinations, vitality tests, or treatments completed during this appointment.
   - recommendations: Post-operative instructions and homecare guidance given to the patient.
   - recallRequirements: Recall interval (must choose exactly one of: "6 Months (Standard)", "3 Months (Periodontal)", "Next Available (Urgent)").
5. PATIENT SUMMARY:
   - A warm, friendly, plain-English summary letter written directly to the patient (in en-AU spelling). Explain the key takeaway and what they should do next in simple, accessible language. Do NOT copy-paste clinical jargon or duplicate the clinician note fields verbatim.
8. ADA ITEM CODE BILLING EXTRACTION:
   - Identify any diagnostic, preventive, restorative, or surgical procedures mentioned or performed in the session and output relevant Australian Dental Association (ADA) 3-digit item codes in 'adaCodes' as a comma-separated string (e.g., "011 - Comprehensive oral examination, 022 - Intraoral periapical radiograph (Tooth 16), 414 - Pulp extirpation (Tooth 16)").`;

const CLINICAL_NOTE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    chiefComplaint: { type: Type.STRING },
    history: { type: Type.STRING },
    toothFindings: { type: Type.STRING },
    findingsGingival: { type: Type.STRING },
    diagnosis: { type: Type.STRING },
    treatmentPerformed: { type: Type.STRING },
    recommendations: { type: Type.STRING },
    recallRequirements: { type: Type.STRING },
    patientSummary: { type: Type.STRING },
    adaCodes: { type: Type.STRING }
  },
  required: [
    'chiefComplaint',
    'history',
    'toothFindings',
    'findingsGingival',
    'diagnosis',
    'treatmentPerformed',
    'recommendations',
    'recallRequirements',
    'patientSummary'
  ],
};

const CLINICAL_AI_CONFIG = {
  responseMimeType: 'application/json',
  responseSchema: CLINICAL_NOTE_SCHEMA,
  systemInstruction: DENTAL_CLINICAL_SYSTEM_INSTRUCTION
};

/* ---------------------------------------------------------------------------
 * Template-driven note generation
 *
 * The note template (built-in library or a validated clinic custom template)
 * decides which clinical sections the model must populate. We assemble a fresh
 * JSON schema + system instruction from the selected template's sections, so a
 * hygiene visit produces periodontal-focused fields, a surgical visit produces
 * procedure/review fields, etc. — instead of the legacy fixed 8-field schema.
 * ------------------------------------------------------------------------- */

const RESERVED_NOTE_KEYS = new Set(['patientSummary', 'adaCodes']);

const TEMPLATE_DRIVEN_SYSTEM_INSTRUCTION = `You are an expert dental transcription assistant and charting AI for Australian dental practice. You receive a patient intake form and a clinical session transcript (speaker roles: 'Dentist', 'Patient', 'Dialogue', 'Clinical Comment' — infer who actually spoke from context). Return TWO things: (1) structured clinical notes whose sections are defined by the supplied note template, and (2) a patient summary letter.

Your output must comply with Dental Board of Australia record-keeping guidelines.

MANDATORY RULES:
1. FDI NOTATION: Use the FDI two-digit system exclusively (quadrants 1-4: 11-18, 21-28, 31-38, 41-48) whenever a tooth is referenced. Map spoken forms ("tooth one six", "tooth 16", "sixteen") to the correct two-digit FDI form.
2. ACCENT & PHONETIC RESILIENCY: The transcript contains phonetic errors and homophones from diverse accents. Correct them contextually (e.g. "tooth category"/"feeling" -> filling or carious lesion; "tooth dirty tree" -> tooth 33; "root can all" -> root canal treatment; "pulp it is" -> pulpitis; "pocket depths tree two tree" -> 3-2-3 mm pocket depths).
3. SPELLING: Use Australian/British English (en-AU): colour, anaesthetic, minimise, programme, haemorrhage.
4. NO FABRICATION (CRITICAL CLINICAL SAFETY): Extract ONLY what the intake form and transcript support. NEVER invent a diagnosis, treatment, drug, radiograph, test result, or recall interval that was not stated, and never guess a tooth number. If a section has no supporting evidence, return an empty string for it. Never pad a section with plausible-sounding content.
5. PATIENT SUMMARY: A warm, friendly, plain-English letter to the patient (en-AU spelling) that explains the visit and any follow-up simply. Do not restate clinical jargon verbatim and never invent advice.
6. ADA ITEM CODES: In adaCodes, list Australian Dental Association 3-digit item numbers that were actually mentioned or clearly performed in the session, as a comma-separated string e.g. "011 - Comprehensive oral examination, 022 - Intraoral periapical radiograph (Tooth 16), 414 - Pulp extirpation (Tooth 16)". If none were performed, return an empty string — never invent codes.
`;


/** Builds the JSON schema + system instruction for one note template. */
function buildTemplateAIConfig(template: NoteTemplate) {
  const properties: Record<string, any> = {};
  for (const section of template.sections) {
    properties[section.key] = { type: Type.STRING };
  }
  properties.patientSummary = { type: Type.STRING };
  properties.adaCodes = { type: Type.STRING };

  const responseSchema = {
    type: Type.OBJECT,
    properties,
    required: [...template.sections.map(s => s.key), 'patientSummary']
  };

  const sectionInstructions = template.sections
    .map(s => `- "${s.key}" (${s.label}): ${s.placeholder} Only include content the transcript supports; otherwise an empty string.`)
    .join('\n');

  const systemInstruction =
    TEMPLATE_DRIVEN_SYSTEM_INSTRUCTION +
    `\n\n=== CURRENT NOTE TEMPLATE: ${template.name} ===\nReturn exactly ONE JSON object containing exactly these string sections:\n${sectionInstructions}\n`;

  return { responseMimeType: 'application/json', responseSchema, systemInstruction };
}

/**
 * Resolves the template for a request. Clinic custom templates may be sent as
 * a full inline definition (intakeData.template); otherwise templateId must
 * reference the built-in library. Defaults to the AHPRA standard template.
 */
function validateInlineTemplate(raw: any): NoteTemplate | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) return null;
  if (raw.sections.length === 0 || raw.sections.length > 14) return null;

  const sections: TemplateSection[] = [];
  const seen = new Set<string>();
  for (const s of raw.sections) {
    if (!s || typeof s.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(s.key)) return null;
    if (RESERVED_NOTE_KEYS.has(s.key) || seen.has(s.key)) return null;
    if (typeof s.label !== 'string' || s.label.trim().length === 0 || s.label.length > 200) return null;
    seen.add(s.key);
    sections.push({
      key: s.key,
      label: s.label.trim().slice(0, 200),
      placeholder: typeof s.placeholder === 'string' ? s.placeholder.slice(0, 500) : ''
    });
  }

  return {
    id: 'custom',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : 'Custom Clinic Template',
    tagline: 'Clinic Template',
    description: '',
    isCustom: true,
    sections
  };
}

function resolveNoteTemplate(raw: any): { template: NoteTemplate; error?: string } {
  const inline = validateInlineTemplate(raw?.template);
  if (inline) return { template: inline };

  const id = raw?.templateId;
  if (id != null && typeof id === 'string' && !TEMPLATE_BY_ID[id]) {
    return { template: getTemplateById(undefined), error: `Unknown note template "${id.slice(0, 80)}". Choose a built-in template or send a full template definition.` };
  }
  return { template: getTemplateById(id) };
}

// API endpoint to compile clinical findings and correspondence letter via Gemini
app.post('/api/generate-notes', authenticateToken, async (req: express.Request, res: express.Response) => {
  const gcpProject = process.env.GCP_PROJECT_ID;
  let promptContext = '';
  // Resolved from intakeData.templateId (built-in) or intakeData.template
  // (inline clinic custom template) inside the try block; declared here so the
  // catch handlers can retry with the same per-template AI config.
  let noteTemplate: NoteTemplate = getTemplateById(undefined);
  let noteAIConfig: ReturnType<typeof buildTemplateAIConfig> | null = null;
  try {
    const { intakeData, transcript } = req.body;

    logger.info('Processing clinical note generation request', {
      appointmentType: intakeData?.appointmentType,
      transcriptLength: transcript?.length,
    });

    if (!intakeData || !transcript || !Array.isArray(transcript)) {
      return res.status(400).json({ error: 'Missing or invalid intakeData or transcript in request body.' });
    }

    // Input Validation & Sanitization (Security Hardening)
    let { firstName, lastName, dob, appointmentType } = intakeData;
    if (typeof firstName === 'string') {
      firstName = firstName.replace(/[<>]/g, '').trim();
      intakeData.firstName = firstName;
    }
    if (typeof lastName === 'string') {
      lastName = lastName.replace(/[<>]/g, '').trim();
      intakeData.lastName = lastName;
    }

    if (
      typeof firstName !== 'string' || firstName.trim().length === 0 || firstName.length > 100 ||
      typeof lastName !== 'string' || lastName.trim().length === 0 || lastName.length > 100
    ) {
      return res.status(400).json({ error: 'First name and last name must be non-empty strings under 100 characters.' });
    }

    // Date of Birth validation (YYYY-MM-DD format, e.g., 1900-01-01 to present)
    const dobRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof dob !== 'string' || !dobRegex.test(dob)) {
      return res.status(400).json({ error: 'Date of birth must be in YYYY-MM-DD format.' });
    }
    const parsedDate = Date.parse(dob);
    if (isNaN(parsedDate) || parsedDate > Date.now() || parsedDate < Date.parse('1900-01-01')) {
      return res.status(400).json({ error: 'Date of birth must be a valid date between 1900 and the present.' });
    }

    if (!isValidAppointmentType(appointmentType)) {
      return res.status(400).json({ error: 'Appointment type must be one of: examination, scale_clean, emergency, restorative, endodontic, surgical, prosthodontic, paediatric.' });
    }

    // Transcript validation: max 200 items, each item must have sender and text
    if (transcript.length > 200) {
      return res.status(400).json({ error: 'Transcript contains too many entries (maximum 200 items).' });
    }

    for (let i = 0; i < transcript.length; i++) {
      const item = transcript[i];
      if (!item || typeof item !== 'object') {
        return res.status(400).json({ error: `Transcript item at index ${i} is not a valid object.` });
      }
      const { sender, text } = item;
      if (typeof sender !== 'string' || sender.trim().length === 0 || sender.length > 50) {
        return res.status(400).json({ error: `Transcript item at index ${i} has an invalid or missing sender.` });
      }
      if (typeof text !== 'string' || text.length > 1000) {
        return res.status(400).json({ error: `Transcript item at index ${i} has an invalid or excessively long text.` });
      }
    }

    // Resolve the note template for this treatment type and build the
    // per-template AI schema + instruction (see buildTemplateAIConfig).
    const resolved = resolveNoteTemplate(intakeData);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    noteTemplate = resolved.template;
    noteAIConfig = buildTemplateAIConfig(noteTemplate);
    intakeData.templateId = noteTemplate.id;

    logAudit('notes_generated', (req as any).dentist?.id || 'unknown', {
      appointmentType: intakeData.appointmentType,
      templateId: noteTemplate.id,
      transcriptLength: transcript.length
    });

    const apiKey = process.env.GEMINI_API_KEY;

    let ai: GoogleGenAI;
    if (gcpProject) {
      logger.info('Initializing Vertex AI client for Australian sovereign clinical processing', {
        project: gcpProject,
        location: process.env.GCP_REGION || 'australia-southeast1'
      });

      const options: any = {
        vertexai: true,
        project: gcpProject,
        location: process.env.GCP_REGION || 'australia-southeast1'
      };

      if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
        try {
          options.credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
        } catch (e: any) {
          logger.error('Failed to parse GCP_SERVICE_ACCOUNT_KEY JSON:', e.message);
        }
      }

      ai = new GoogleGenAI(options);
    } else {
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return res.status(503).json({ error: 'Gemini API key is not configured on the server. Please check environment configuration.' });
      }
      ai = new GoogleGenAI({ apiKey });
    }

    // Format the inputs cleanly into the prompt context
    promptContext = `
=== PATIENT INTAKE DATA ===
First Name: ${intakeData.firstName}
Last Name: ${intakeData.lastName}
Date of Birth: ${intakeData.dob}
Appointment Type: ${intakeData.appointmentType}
Note Template: ${noteTemplate.name}${noteTemplate.appointmentType ? ` (recommended for ${noteTemplate.appointmentType.replace('_', ' ')})` : ''}

=== CLINICAL SESSION TRANSCRIPT ===
${transcript.map((t: any) => `${t.sender}: ${t.text}`).join('\n')}
`;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      contents: promptContext,
      config: noteAIConfig || CLINICAL_AI_CONFIG
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Gemini API returned an empty text field.');
    }

    res.json(normalizeTemplateOutput(noteTemplate, JSON.parse(responseText)));
  } catch (error: any) {
    logger.error('Error generating notes in /api/generate-notes:', error, {
      url: req.originalUrl,
      method: req.method,
    });

    const isCredentialsError = !!(error.message && (
      error.message.toLowerCase().includes('credentials') ||
      error.message.toLowerCase().includes('authenticated') ||
      error.message.toLowerCase().includes('default credentials')
    ));

    // Try a dynamic fallback to standard Gemini Developer API key if Vertex credentials are not loaded
    if (isCredentialsError && gcpProject) {
      logger.warn('[Vertex AI] Credentials error detected. Retrying dynamically with Gemini Developer API Studio Key...');
      try {
        const fallbackAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await fallbackAi.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
          contents: promptContext,
          config: noteAIConfig || CLINICAL_AI_CONFIG
        });

        const responseText = response.text;
        if (responseText) {
          return res.json(normalizeTemplateOutput(noteTemplate, JSON.parse(responseText)));
        }
      } catch (fallbackErr: any) {
        logger.error('[Vertex AI Fallback] Gemini Developer API Studio call failed as well:', fallbackErr.message || fallbackErr);
      }
    }

    // Classify error type
    const statusCode = error.status || (error.code ? Number(error.code) : 500);
    const errorMsg = (error.message || JSON.stringify(error) || '').toLowerCase();

    // If it's a rate-limit (429), credentials error, or a known API failure (credits
    // depleted), return an explicit error. NO fabricated clinical records are ever
    // produced — invented diagnoses or billing codes must never enter a patient record.
    const isRateLimited = statusCode === 429 || isCredentialsError ||
      errorMsg.includes('quota') ||
      errorMsg.includes('prepayment') ||
      errorMsg.includes('depleted') ||
      errorMsg.includes('resource_exhausted') ||
      errorMsg.includes('exhausted');

    if (isRateLimited) {
      // Tier 2 — hosted failover: a second Gemini project key (separate quota
      // pool). Enable with GEMINI_FALLBACK_API_KEY (+ optional
      // GEMINI_FALLBACK_MODEL). If the fallback key succeeds the dentist never
      // sees the outage; if it also fails we return 429 and the UI offers the
      // offline draft / on-device tiers.
      const fallbackKey = process.env.GEMINI_FALLBACK_API_KEY;
      if (noteAIConfig && fallbackKey && fallbackKey !== 'MY_GEMINI_API_KEY') {
        try {
          logger.warn('[Gemini API] Primary route exhausted. Retrying once with secondary Gemini key (GEMINI_FALLBACK_API_KEY)...');
          const fallbackAi = new GoogleGenAI({ apiKey: fallbackKey });
          const fallbackResponse = await fallbackAi.models.generateContent({
            model: process.env.GEMINI_FALLBACK_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash',
            contents: promptContext,
            config: noteAIConfig
          });
          const fallbackText = fallbackResponse.text;
          if (fallbackText) {
            logAudit('notes_generation_secondary_key', (req as any).dentist?.id || 'unknown', {});
            return res.json(normalizeTemplateOutput(noteTemplate, JSON.parse(fallbackText)));
          }
        } catch (secondaryErr: any) {
          logger.warn('[Gemini API] Secondary-key fallback also failed:', secondaryErr.message || secondaryErr);
        }
      }

      logger.warn('[Gemini API] Billing depleted or rate-limit reached on all hosted routes.');
      logAudit('notes_generation_quota_exhausted', (req as any).dentist?.id || 'unknown', {});
      return res.status(429).json({
        error: 'The AI note generator is temporarily rate-limited (quota or billing exhausted) on the primary and secondary Gemini keys. No notes were created. You can draft a note offline from the transcript, or retry shortly.',
        code: 'QUOTA_EXCEEDED'
      });
    }

    let errorCode = 'API_ERROR';
    if (statusCode === 429) {
      errorCode = 'QUOTA_EXCEEDED';
    } else if (error.message && error.message.toLowerCase().includes('timeout')) {
      errorCode = 'API_TIMEOUT';
    }

    res.status(statusCode).json({
      error: error.message || 'Failed to process clinical transcript and generate notes.',
      code: errorCode
    });
  }
});

// Telemetry check endpoint
app.get('/api/telemetry', (req, res) => {
  res.json(logger.getTelemetry());
});

// Unified Frontend Router (Dev vs Prod vs Test)
async function setupDevMode() {
  logger.info('Starting DentAI in DEVELOPMENT mode with Vite Middleware...');
  const { createServer } = await import('vite');

  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  app.use(vite.middlewares);

  // Serve transformed index.html for all non-API GET requests
  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const fs = await import('fs');
      let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });
}

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  setupDevMode().catch(err => {
    logger.error('Failed to start development mode with Vite:', err);
  });
} else {
  logger.info('Starting DentAI in PRODUCTION mode serving built files...');
  app.use(express.static(path.resolve(__dirname, 'dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

export { app };

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(Number(PORT), '0.0.0.0', () => {
    logger.info(`DentAI Server running successfully on http://localhost:${PORT}`);
  });
}
