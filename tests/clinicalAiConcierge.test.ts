import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import ClinicalAiConcierge from '../src/components/ClinicalAiConcierge';

dotenv.config({ path: '.env.local' });
dotenv.config();

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.DATABASE_URL = '';

const { app, generateToken } = await import('../server.ts');

describe('Slice 3: Autonomous Clinical AI Concierge (In-App Support Bot)', () => {
  const dentistId = '5a002da7-d8e6-4d5c-8566-000d534e2a32';
  let token: string;

  beforeAll(() => {
    token = generateToken({
      dentistId,
      name: 'Dr. Vikram Darade',
      specialty: 'General & Implant Dentistry'
    });
  });

  it('exports ClinicalAiConcierge component cleanly', () => {
    expect(ClinicalAiConcierge).toBeDefined();
    expect(typeof ClinicalAiConcierge).toBe('function');
  });

  describe('POST /api/support/concierge', () => {
    it('rejects empty or missing query with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/support/concierge')
        .set('Authorization', `Bearer ${token}`)
        .send({ query: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Query is required.');
    });

    it('resolves PMS clipboard paste workflows with F12 and Ctrl+V guidance', async () => {
      const res = await request(app)
        .post('/api/support/concierge')
        .set('Authorization', `Bearer ${token}`)
        .send({ query: 'How do I paste notes into Dental4Windows or EXACT?' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('pms_workflow');
      expect(res.body.answer).toContain('F12');
      expect(res.body.answer).toContain('Ctrl + V');
      expect(res.body.answer).toContain('Dental4Windows');
    });

    it('resolves ADA item code queries for 3-surface composite restorations', async () => {
      const res = await request(app)
        .post('/api/support/concierge')
        .set('Authorization', `Bearer ${token}`)
        .send({ query: 'What is the ADA billing code for a 3-surface molar composite?' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('ada_code');
      expect(res.body.answer).toContain('533');
      expect(res.body.answer).toContain('3 surfaces');
    });

    it('resolves AHPRA dental record-keeping compliance guidelines', async () => {
      const res = await request(app)
        .post('/api/support/concierge')
        .set('Authorization', `Bearer ${token}`)
        .send({ query: 'What are the AHPRA legal requirements for tooth numbering?' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('ahpra_compliance');
      expect(res.body.answer).toContain('FDI Two-Digit Notation');
      expect(res.body.answer).toContain('Contemporaneous Documentation');
    });

    it('resolves sterile audio and microphone hardware questions', async () => {
      const res = await request(app)
        .post('/api/support/concierge')
        .set('Authorization', `Bearer ${token}`)
        .send({ query: 'How do I connect my Bluetooth headset to filter suction noise?' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('audio_hardware');
      expect(res.body.answer).toContain('Tier 2 (Smart Bluetooth Headset)');
      expect(res.body.answer).toContain('SNR');
    });
  });
});
