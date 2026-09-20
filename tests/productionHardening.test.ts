import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getConfiguredClinicTimeZone,
  getClinicDayKey,
  getClinicDayLabel,
  getClinicTimeLabel
} from '../src/utils/date';

/**
 * Hosting and timezone hardening.
 *
 * Both of these are silent if wrong: a shared rate-limit bucket looks like
 * "everyone got locked out at once", and a host-clock date looks like a record
 * filed on the wrong day.
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
// A throwaway store per run — never the developer's working data directory.
process.env.DENTAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dentai-hardening-'));

let app: any;

beforeAll(async () => {
  // Import the source explicitly; `import('../server')` resolves to the compiled
  // server.js bundle (Vite tries .js before .ts), which is a stale artefact.
  const mod = await import('../server.ts');
  app = mod.app;
});

describe('Reverse-proxy configuration', () => {
  it('declares the proxy hop so per-address limits are not shared by every practice', () => {
    const trustProxy = app.get('trust proxy');

    // Must be a hop count, never `true`. Trusting every hop lets a client set its
    // own X-Forwarded-For and therefore choose its own rate-limit bucket, which
    // defeats the limiter entirely.
    expect(trustProxy).not.toBe(true);
    expect(Number(trustProxy)).toBeGreaterThanOrEqual(0);
  });
});

describe('Clinic-local time', () => {
  it('defaults to a real Australian clinic zone', () => {
    const tz = getConfiguredClinicTimeZone();
    expect(tz).toBeTruthy();
    expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: tz })).not.toThrow();
  });

  it('derives the clinic day from the clinic zone, not the host zone', () => {
    const instant = new Date('2026-09-05T23:30:00Z');
    // 23:30 UTC on 5 Sep is 09:30 on 6 Sep in Sydney — the morning of the next
    // clinic day. Stamping this from the host clock (UTC on serverless) filed a
    // Sydney morning appointment on the previous day.
    expect(getClinicDayKey(instant, 'Australia/Sydney')).toBe('2026-09-06');
    // The same instant really is still 5 Sep in New York.
    expect(getClinicDayKey(instant, 'America/New_York')).toBe('2026-09-05');
  });

  it('formats the note-header date and clock labels in clinic time', () => {
    const instant = new Date('2026-09-05T23:30:00Z');
    expect(getClinicDayLabel(instant, 'Australia/Sydney')).toBe('Sep 6');
    expect(getClinicTimeLabel(instant, 'Australia/Sydney')).toMatch(/9:30\s?AM/i);
    // Local midnight rollover while Sydney is on AEST (+10).
    expect(getClinicDayKey(new Date('2026-09-06T14:30:00Z'), 'Australia/Sydney')).toBe('2026-09-07');
  });
});

describe('Landing page & demo claims substantiation guards', () => {
  const landingPath = path.resolve(__dirname, '../src/components/Landing.tsx');
  const scenesPath = path.resolve(__dirname, '../src/demo/Scenes.tsx');
  const demoScriptPath = path.resolve(__dirname, '../src/demo/demoScript.ts');
  const pipelinePath = path.resolve(__dirname, '../src/components/TreatmentPipeline.tsx');
  const serverPath = path.resolve(__dirname, '../server.ts');

  it('prevents reintroduction of invented marketing metrics, ROI multiples, or fabricated dollar constants on landing page', () => {
    const content = fs.readFileSync(landingPath, 'utf8');

    // Banned fabricated constants
    const bannedConstants = [
      '$34,800',
      '$18,400',
      '123.5x',
      '52.8%',
      '100x+',
      '40x–100x+',
      '40x-100x+',
      '14-day evaluation',
      '14-Day Free Evaluation',
    ];

    for (const token of bannedConstants) {
      expect(content).not.toContain(token);
    }

    // Guard against bare exaggerated ROI multiple claims (e.g. 100x ROI, 50x practice ROI)
    expect(content).not.toMatch(/\b\d+x\+?\s*(practice\s*)?ROI/i);

    // Guard against bare inflated pipeline dollar amounts (e.g. $30,000+)
    expect(content).not.toMatch(/\$\d{2,},\d{3}/);
  });

  it('demo visuals carry no fabricated constants or PMS-verification claims', () => {
    const content = fs.readFileSync(scenesPath, 'utf8');

    const bannedTokens = [
      '34800',
      '18400',
      '123.5x',
      '$51,600',
      '+$15k–$30k',
      '+$15k-$30k',
      '$99/mo',
      '$99–$149',
      '$99-$149',
      'Universal PMS Bridge',
      'Sync to D4W',
      '9 verified in PMS',
      'D4W #8491 Verified',
      'Eliminate 100% of After-Hours Charting',
      '15–20 min',
      '1.5–2 Hours',
    ];

    for (const token of bannedTokens) {
      expect(content).not.toContain(token);
    }
  });

  it('never claims a PMS integration that does not exist', () => {
    const surfaces = [landingPath, scenesPath, demoScriptPath];
    const bannedPhrases = [
      'Universal PMS Bridge',
      'Sync to D4W',
      'automatically update booking status',
      'PMS Sync',
    ];

    for (const surface of surfaces) {
      if (fs.existsSync(surface)) {
        const content = fs.readFileSync(surface, 'utf8');
        for (const phrase of bannedPhrases) {
          expect(content).not.toContain(phrase);
        }
      }
    }
  });

  it('never presents self-reported bookings as verified revenue', () => {
    const surfaces = [landingPath, scenesPath, pipelinePath];
    const bannedPatterns = [
      /\bverified in PMS\b/i,
      /\b#\d+\s+Verified\b/i,
      /\bPMS-verified\b/i,
    ];

    for (const surface of surfaces) {
      if (fs.existsSync(surface)) {
        const content = fs.readFileSync(surface, 'utf8');
        for (const pattern of bannedPatterns) {
          expect(content).not.toMatch(pattern);
        }
      }
    }
  });

  it('never computes an invented ROI multiple against a fixed denominator', () => {
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    const pipelineContent = fs.readFileSync(pipelinePath, 'utf8');
    const scenesContent = fs.readFileSync(scenesPath, 'utf8');

    expect(serverContent).not.toMatch(/const\s+subscriptionCost\s*=\s*149\s*;/);
    expect(pipelineContent).not.toMatch(/totalBookedValue\s*\/\s*149/);
    expect(scenesContent).not.toContain('123.5x');
  });
});
