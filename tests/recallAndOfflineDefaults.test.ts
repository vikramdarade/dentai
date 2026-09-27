/**
 * Phase 10 remediation — F-1 (offline draft boilerplate) and B-2 (recall default).
 *
 * F-1: with a sparse transcript, the offline draft engine must contain NO
 * unsupported clinical boilerplate ("medical history reviewed", "consent
 * obtained", "patient understood risks", "treatment completed", "post-operative
 * instructions provided") — sections stay empty when nothing was said. Offline
 * drafts remain review-only by construction.
 *
 * B-2: the durable worker must not invent a recall interval. When the model
 * output carries no recall, the persisted consultation keeps recallRequirements
 * empty — never the former '6 Months (Standard)' default.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import dotenv from 'dotenv';
import { getTemplateById } from '../src/lib/dentalLibrary';
import { generateOfflineDraft } from '../src/lib/draftEngine';
import type { TranscriptItem } from '../src/types';

// Mock the AI SDK BEFORE any server import: unit tests must never reach a
// real provider (learned the hard way — a .env.local key leaked into a run).
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              chiefComplaint: 'Routine examination',
              history: 'Stable',
              toothFindings: 'No acute findings',
              diagnosis: '',
              treatmentPerformed: 'Examination completed',
              recommendations: '',
              recallRequirements: '',
              patientSummary: ''
            })
          })
        }
      };
    }),
    Type: { OBJECT: 'OBJECT', STRING: 'STRING' }
  };
});

// Repo-wide fabrication vocabulary for offline output (F-1).
const OFFLINE_BOILERPLATE = [
  /medical history (?:reviewed|taken|confirmed)/i,
  /written and verbal medical history/i,
  /\bnil contraindications\b/i,
  /\bverbal (?:informed )?consent (?:obtained|confirmed)\b/i,
  /\bconsent (?:obtained|confirmed)\b/i,
  /patient (?:understands?|understood|verbalised|approved)/i,
  /risks? (?:explained|discussed|of)/i,
  /treatment options discussed/i,
  /\bno complications\b/i,
  /instructions (?:given|provided|explained)/i,
  /\bpoig\b/i,
  /\badequate anaesthesia\b/i,
  /profound anaesthesia/i,
  /6[- ]month recall/i,
  /\brecall in \d+\s*(?:month|week)s?\b/i,
];

function draftText(draft: ReturnType<typeof generateOfflineDraft>): string {
  return [
    ...Object.values(draft.canonical),
    ...Object.values(draft.customSections ?? {}),
    draft.patientSummary,
    JSON.stringify(draft.adaCodes),
  ].join(' ');
}

const SPARSE_TRANSCRIPTS: Array<[string, TranscriptItem[]]> = [
  ['sparse greeting', [
    { sender: 'Dentist', text: 'Hello, let us get started.' },
    { sender: 'Patient', text: 'Okay.' },
  ]],
  ['patient-only small talk', [
    { sender: 'Patient', text: 'I am a bit nervous about dentists.' },
  ]],
  ['findings only, no treatment', [
    { sender: 'Dentist', text: 'Tooth 36 has caries.' },
  ]],
];

describe('F-1: offline draft engine adds no unsupported clinical boilerplate', () => {
  for (const [name, transcript] of SPARSE_TRANSCRIPTS) {
    for (const templateId of ['standard', 'emergency', 'surgical', 'hygiene']) {
      it(`${templateId} × ${name}: zero fabricated assertions, empty sections stay empty`, () => {
        const template = getTemplateById(templateId);
        const draft = generateOfflineDraft(template, transcript, template.name);
        const text = draftText(draft);
        const violations = OFFLINE_BOILERPLATE.filter(p => p.test(text));
        expect(
          violations.map(p => p.source),
          `${templateId}/${name} emitted boilerplate`
        ).toEqual([]);
        // Codes are spoken-item assertions; sparse speech yields none.
        expect(draft.adaCodes).toEqual([]);
        // An empty clinical section is the honest outcome.
        expect((draft.canonical.treatmentPerformed ?? '').trim()).toBe('');
      });
    }
  }

  it('keeps spoken evidence intact while adding nothing (sparse evidence-in, evidence-out)', () => {
    const template = getTemplateById('emergency');
    const draft = generateOfflineDraft(template, [
      { sender: 'Patient', text: 'I have had a sharp pain in the upper right for two days.' },
      { sender: 'Dentist', text: 'Percussion on tooth 16 is tender.' },
      { sender: 'Dentist', text: 'Access opening completed today on 16.' },
    ], 'Emergency / Pain');
    expect(draft.canonical.chiefComplaint.toLowerCase()).toContain('pain');
    expect(draft.canonical.toothFindings).toContain('16');
    expect(draft.canonical.treatmentPerformed.toLowerCase()).toContain('access');
    // Still zero boilerplate around the real evidence.
    const violations = OFFLINE_BOILERPLATE.filter(p => p.test(draftText(draft)));
    expect(violations.map(p => p.source)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B-2: the durable worker path must not invent a recall interval.
// ---------------------------------------------------------------------------

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
dotenv.config({ path: '.env.local' });
dotenv.config();
// Blank ALL provider credentials after the dotenv preload so no developer key
// can ever reach a real API from this suite.
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.GROQ_API_KEY = '';
process.env.GROQ_API_PROD_KEY = '';
process.env.LLM_PROVIDER = '';
process.env.OLLAMA_BASE_URL = '';
process.env.LLAMA_CPP_BASE_URL = '';
process.env.OPENAI_BASE_URL = '';
process.env.OPENAI_API_KEY = '';
process.env.DENTAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-b2-'));
process.env.DENTAI_DAILY_NOTE_LIMIT = '500';
process.env.DENTAI_DAILY_TOKEN_LIMIT = '5000000';

const serverPromise = import('../server.ts');

async function ensureClinician(name: string, pin: string): Promise<string> {
  const { app } = await serverPromise;
  const reg = await request(app).post('/api/auth/register').send({ name, specialty: 'General Dentistry', pin });
  if (reg.status === 201) return reg.body.token;
  const profiles = await request(app).get('/api/auth/profiles');
  const profile = profiles.body.find((p: any) => p.name === name);
  const login = await request(app).post('/api/auth/login').send({ dentistId: profile.id, pin });
  return login.body.token;
}

describe('B-2: no invented recall in the durable worker path', () => {
  it('persists an empty recall when the model output has no recall interval', async () => {
    const { app } = await serverPromise;
    const token = await ensureClinician('Dr. Recall Probe', '4471');
    const res = await request(app).post('/api/notes/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        intakeData: { firstName: 'Test', lastName: 'Patient', dob: '1990-01-01', appointmentType: 'examination' },
        transcript: [{ sender: 'Dentist', text: 'Routine examination today, all stable.' }],
      });
    expect([200, 202]).toContain(res.status);
    await new Promise(r => setTimeout(r, 300));
    const dataDir = process.env.DENTAI_DATA_DIR as string;
    const cons = JSON.parse(fs.readFileSync(path.join(dataDir, 'consultations.json'), 'utf8'));
    const persisted = cons.consultations.find((c: any) => c.dentistId && c.findings);
    expect(persisted).toBeTruthy();
    // The former '6 Months (Standard)' default must be gone — absent stays absent.
    expect(persisted.findings.recallRequirements ?? '').toBe('');
    expect(persisted.findings.recallRequirements).not.toMatch(/6 Months/i);
  });
});
