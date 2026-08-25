import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { logger } from './logger';
import fs from 'fs';
import crypto from 'crypto';
import { kv } from '@vercel/kv';
import {
  dbEnabled,
  initDbSchema,
  seedFromJsonFallback,
  dbGetDentists,
  dbInsertDentist,
  dbDeleteDentist,
  dbListConsultations,
  dbInsertConsultation,
  dbUpdateConsultation,
  dbAppendAudit
} from './src/lib/db';

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
});

app.use('/api/', apiLimiter);

// JSON database file paths
const USERS_FILE = path.resolve(__dirname, 'data', 'users.json');
const CONSULTATIONS_FILE = path.resolve(__dirname, 'data', 'consultations.json');
const AUDIT_FILE = path.resolve(__dirname, 'data', 'audit.json');

// In-memory caching layer for read-only environments (like Vercel serverless)
const dbCache: Record<string, any> = {
  'dentai:users': null,
  'dentai:consultations': null
};

const isKvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

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
    const usersData = await readUsersDb();
    const dentist = usersData.dentists.find((d: any) => d.id === dentistId);

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

    const usersData = await readUsersDb();
    const exists = usersData.dentists.some((d: any) => d.name.toLowerCase() === name.toLowerCase());
    if (exists) {
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
      salt
    };

    if (dbEnabled) {
      await dbInsertDentist(newDentist);
    } else {
      usersData.dentists.push(newDentist);
      await writeUsersDb(usersData);
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
        specialty: newDentist.specialty
      }
    });
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register dentist account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { dentistId, pin } = req.body;
    if (!dentistId || typeof dentistId !== 'string') {
      return res.status(400).json({ error: 'Dentist ID is required.' });
    }
    if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
    }

    // Brute-force protection: lock the dentist+IP pair after repeated failures.
    const attemptKey = `${dentistId}:${req.ip || 'unknown'}`;
    const attempt = loginAttempts.get(attemptKey);
    if (attempt && attempt.lockedUntil > Date.now()) {
      return res.status(429).json({ error: 'Too many failed attempts. Please try again in 15 minutes.' });
    }
    if (attempt && attempt.lockedUntil <= Date.now()) {
      loginAttempts.delete(attemptKey);
    }

    const usersData = await readUsersDb();
    const dentist = usersData.dentists.find((d: any) => d.id === dentistId);

    // The profile MUST exist in the database. Client-supplied hashes/custom profiles are
    // never accepted — that previously allowed logging in as any known dentist.
    if (!dentist) {
      logAudit('login_failed', dentistId, { reason: 'profile_not_found' });
      return res.status(401).json({ error: 'Invalid dentist profile or PIN.' });
    }

    const dentistSalt = dentist.salt || getDentistSalt(dentistId);
    const isValid =
      verifyPinHash(pin, dentistSalt, dentist.pinHash) ||
      verifyPinHash(pin, getDentistSalt(dentistId), dentist.pinHash);

    if (!isValid) {
      const next = { count: (attempt?.count || 0) + 1, lockedUntil: 0 };
      if (next.count >= LOGIN_MAX_ATTEMPTS) {
        next.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
        next.count = 0;
      }
      loginAttempts.set(attemptKey, next);
      logAudit('login_failed', dentistId, { reason: 'invalid_pin' });
      return res.status(401).json({ error: 'Invalid dentist profile or PIN.' });
    }

    loginAttempts.delete(attemptKey);

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
        specialty: dentist.specialty
      }
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Failed to authenticate.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.sendStatus(204);
});

app.get('/api/auth/me', authenticateToken, (req: any, res) => {
  res.json({
    id: req.dentist.id,
    name: req.dentist.name,
    specialty: req.dentist.specialty
  });
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

    await writeConsultationsDb(consultationsData);
    logAudit('consultation_updated', req.dentist.id, { consultationId: id });
    res.json(consultationsData.consultations[index]);
  } catch (err) {
    logger.error('Failed to update consultation:', err);
    res.status(500).json({ error: 'Failed to update consultation record.' });
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

// API endpoint to compile clinical findings and correspondence letter via Gemini
app.post('/api/generate-notes', authenticateToken, async (req: express.Request, res: express.Response) => {
  const gcpProject = process.env.GCP_PROJECT_ID;
  let promptContext = '';
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

    const validAppointmentTypes = ['examination', 'scale_clean', 'emergency'];
    if (!validAppointmentTypes.includes(appointmentType)) {
      return res.status(400).json({ error: 'Appointment type must be one of: examination, scale_clean, emergency.' });
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

    logAudit('notes_generated', (req as any).dentist?.id || 'unknown', {
      appointmentType: intakeData.appointmentType,
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

=== CLINICAL SESSION TRANSCRIPT ===
${transcript.map((t: any) => `${t.sender}: ${t.text}`).join('\n')}
`;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      contents: promptContext,
      config: CLINICAL_AI_CONFIG
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Gemini API returned an empty text field.');
    }

    const structuredFindings = JSON.parse(responseText);
    const parseAdaCodes = (raw: any) => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        return raw.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean).map(item => {
          const match = item.match(/^(\d{3})\s*[-:]\s*(.*?)(?:\s*\((?:Tooth\s*|FDI\s*)?(\d{2})\))?$/i);
          if (match) {
            return { code: match[1], description: match[2].trim(), tooth: match[3] };
          }
          const simpleMatch = item.match(/^(\d{3})\s*(.*)$/);
          if (simpleMatch) {
            return { code: simpleMatch[1], description: simpleMatch[2].trim() };
          }
          return { code: '011', description: item };
        });
      }
      return [];
    };

    structuredFindings.adaCodes = parseAdaCodes(structuredFindings.adaCodes);
    res.json(structuredFindings);
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
          config: CLINICAL_AI_CONFIG
        });

        const responseText = response.text;
        if (responseText) {
          const structuredFindings = JSON.parse(responseText);
          const parseAdaCodes = (raw: any) => {
            if (Array.isArray(raw)) return raw;
            if (typeof raw === 'string') {
              return raw.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean).map(item => {
                const match = item.match(/^(\d{3})\s*[-:]\s*(.*?)(?:\s*\((?:Tooth\s*|FDI\s*)?(\d{2})\))?$/i);
                if (match) {
                  return { code: match[1], description: match[2].trim(), tooth: match[3] };
                }
                return { code: '011', description: item };
              });
            }
            return [];
          };
          structuredFindings.adaCodes = parseAdaCodes(structuredFindings.adaCodes);
          return res.json(structuredFindings);
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
      logger.warn('[Gemini API] Billing depleted or rate-limit reached. Returning an error so the dentist can retry.');
      logAudit('notes_generation_quota_exhausted', (req as any).dentist?.id || 'unknown', {});
      return res.status(429).json({
        error: 'The AI note generator is temporarily rate-limited (quota or billing exhausted). No notes were created — please try again shortly.',
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
