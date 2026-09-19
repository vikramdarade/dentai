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
