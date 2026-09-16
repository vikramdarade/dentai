import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { DENTAL_SPEECH_CONTEXT, SpeechStreamServer } from '../src/server/speechStreamServer';

describe('Google Cloud Speech-to-Text Streaming Gateway & Dental Entity Tokenizer', () => {
  let app: any;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const serverModule = await import('../server.ts');
    app = serverModule.app;
  });

  it('should return 200 and speech status on GET /api/speech/status', async () => {
    const res = await request(app).get('/api/speech/status');
    expect(res.status).toBe(200);
    expect(res.body.model).toContain('Chirp 2');
    expect(res.body.status).toBeDefined();
    expect(res.body.gcpStatus).toBeDefined();
  });

  it('should include full FDI tooth notation (11-48, 51-85) and ADA billing codes in dental speech context', () => {
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('tooth 16');
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('tooth 26');
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('tooth 36');
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('tooth 46');
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('MOD');
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('item 531');
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('item 613');
    expect(DENTAL_SPEECH_CONTEXT.phrases).toContain('lignocaine 2% with 1:80,000 adrenaline');
    expect(DENTAL_SPEECH_CONTEXT.boost).toBe(15.0);
  });

  it('should verify GCP credentials status via SpeechStreamServer instance', () => {
    const server = new SpeechStreamServer();
    const status = server.verifyGcpCredentials();
    expect(typeof status.ok).toBe('boolean');
    expect(typeof status.authSource).toBe('string');
    expect(typeof status.recognizer).toBe('string');
  });
});
