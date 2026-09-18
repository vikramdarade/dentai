import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Set up clean test environment prior to importing server
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'TEST_API_KEY';
process.env.DATABASE_URL = '';
process.env.DENTAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-support-test-'));

const { app } = await import('../server.ts');

describe('POST /api/support/github-issue', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  afterAll(() => {
    if (originalToken) {
      process.env.GITHUB_TOKEN = originalToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it('rejects submissions with missing title or description', async () => {
    const res = await request(app)
      .post('/api/support/github-issue')
      .send({ title: '', description: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Title is required/i);
  });

  it('returns 400 with MISSING_GITHUB_TOKEN when no server or client token is provided', async () => {
    const res = await request(app)
      .post('/api/support/github-issue')
      .send({
        title: 'Microphone DSP Glitch',
        description: 'Audio squelch drops high frequency whistle.',
        category: 'clinical-audio',
        priority: 'high'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_GITHUB_TOKEN');
    expect(res.body.message).toMatch(/Direct GitHub creation requires a GITHUB_TOKEN/i);
  });

  it('successfully creates an issue directly in GitHub when token is supplied', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        number: 42,
        html_url: 'https://github.com/vikramdarade/dentai/issues/42',
        title: '[CLINICAL-AUDIO] Microphone DSP Glitch'
      })
    } as any);

    const res = await request(app)
      .post('/api/support/github-issue')
      .send({
        title: 'Microphone DSP Glitch',
        description: 'Audio squelch drops high frequency whistle.',
        category: 'clinical-audio',
        priority: 'high',
        customToken: 'ghp_mock_token_1234567890',
        telemetry: {
          clientVersion: 'DentAI v2.4.0-apple-med',
          screen: 'ChairsideWorkspace'
        }
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.issueNumber).toBe(42);
    expect(res.body.issueUrl).toBe('https://github.com/vikramdarade/dentai/issues/42');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0];
    expect(fetchUrl).toBe('https://api.github.com/repos/vikramdarade/dentai/issues');
    expect((fetchOptions as any).headers['Authorization']).toBe('token ghp_mock_token_1234567890');
    
    const sentPayload = JSON.parse((fetchOptions as any).body);
    expect(sentPayload.title).toBe('[CLINICAL-AUDIO] Microphone DSP Glitch');
    expect(sentPayload.labels).toContain('clinical-audio');
    expect(sentPayload.labels).toContain('clinical-feedback');
    expect(sentPayload.labels).toContain('dentai-chairside');
    expect(sentPayload.body).toContain('### Clinical Context & Request');
    expect(sentPayload.body).toContain('Audio squelch drops high frequency whistle.');
  });

  it('uses process.env.GITHUB_TOKEN if client token is omitted', async () => {
    process.env.GITHUB_TOKEN = 'ghp_server_env_token_abcdef';

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        number: 43,
        html_url: 'https://github.com/vikramdarade/dentai/issues/43',
        title: '[DENTAL-LEXICON] New Lexicon Request: Bioactive Liner'
      })
    } as any);

    const res = await request(app)
      .post('/api/support/github-issue')
      .send({
        title: 'New Lexicon Request: Bioactive Liner',
        description: 'Please add TheraCal LC to pulp capping detection.',
        category: 'dental-lexicon',
        priority: 'normal'
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.issueNumber).toBe(43);

    const [, fetchOptions] = mockFetch.mock.calls[0];
    expect((fetchOptions as any).headers['Authorization']).toBe('token ghp_server_env_token_abcdef');
  });

  it('relays GitHub API error status and details if rejected', async () => {
    process.env.GITHUB_TOKEN = 'ghp_invalid_token';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Bad credentials' })
    } as any);

    const res = await request(app)
      .post('/api/support/github-issue')
      .send({
        title: 'Any title',
        description: 'Any description',
        category: 'operatory-bug'
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Bad credentials');
    expect(res.body.details).toEqual({ message: 'Bad credentials' });
  });
});
