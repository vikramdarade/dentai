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

describe('Product claims guard — no claim may exceed what the code does', () => {
  /**
   * Read a surface as the user sees it: comments stripped.
   *
   * Comments are how we explain why a claim was removed, so they must be allowed
   * to quote it. Only copy and code — JSX text and string literals — are claims.
   */
  const readSurface = (rel: string): string =>
    fs
      .readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  it('prevents reintroduction of invented marketing metrics, ROI multiples, or fabricated dollar constants', () => {
    const content = readSurface('src/components/Landing.tsx');

    // Banned fabricated constants from §5 & §7
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

  /**
   * There is no PMS integration in this codebase: notes leave via a formatted
   * clipboard copy (`formatNoteForPmsClipboard`) and a booking is recorded by the
   * practice. `/api/webhooks/pms-booking` exists as an endpoint, but nothing is
   * configured to call it, so "webhooks automatically update booking status"
   * describes a capability no clinic has.
   *
   * These surfaces are read aloud or shown to a practice, so a false integration
   * claim is a trust event, not a copy nit.
   */
  it('never claims a PMS integration that does not exist', () => {
    const surfaces = [
      'src/components/Landing.tsx',
      'src/components/LegalPage.tsx',
      'src/demo/demoScript.ts',
      'src/components/TreatmentPipeline.tsx',
    ];
    const banned = [
      'verify bookings directly',
      'directly in Dental4Windows',
      'PMS Bridge',
      'PMS Sync',
      'automatically update booking status',
      'two-way sync',
    ];

    for (const file of surfaces) {
      const fileContent = readSurface(file);
      for (const token of banned) {
        expect(fileContent, `${file} must not claim: ${token}`).not.toContain(token);
      }
    }
  });

  /**
   * The pipeline's booked figure is the sum of fees WE estimated, for items the
   * practice's own staff marked booked. Calling that "verified" is the label an
   * accountant acts on, so it must not come back without a real PMS read-back.
   */
  it('never presents self-reported bookings as verified revenue', () => {
    const surfaces = [
      'src/components/Landing.tsx',
      'src/components/TreatmentPipeline.tsx',
      'src/demo/demoScript.ts',
    ];
    const banned = [
      'Verified Recovered Revenue',
      'verified recovered production',
      'verified practice revenue',
      'PMS-verified',
      'on your ledger',
    ];

    for (const file of surfaces) {
      const fileContent = readSurface(file);
      for (const token of banned) {
        expect(fileContent, `${file} must not claim: ${token}`).not.toContain(token);
      }
    }
  });

  /**
   * The ROI denominator is the clinic's own plan price. When it was a hardcoded
   * 149, a free Solo clinic was shown a return against a subscription it does not
   * hold — so an invented multiple is worse here than no multiple at all.
   */
  it('never states a return-on-investment multiple in product copy', () => {
    const surfaces = [
      'src/components/Landing.tsx',
      'src/demo/demoScript.ts',
      'src/components/TreatmentPipeline.tsx',
    ];

    for (const file of surfaces) {
      const fileContent = readSurface(file);
      expect(fileContent, `${file} must not state an ROI multiple`).not.toMatch(
        /\b\d+\s*x\s+return on investment/i
      );
      expect(fileContent, `${file} must not state an ROI multiple`).not.toMatch(/over \d+x\b/i);
    }
  });

  /**
   * Deletion is manual today: the retention sweep is off by default
   * (`DENTAI_RETENTION_ENABLED`) and dry-run even when enabled. The privacy notice
   * must not tell a patient records are removed automatically.
   */
  it('does not promise automatic deletion of clinical records', () => {
    const legalPage = readSurface('src/components/LegalPage.tsx');
    expect(legalPage).not.toContain('and then deleted or de-identified');
    expect(legalPage).not.toMatch(/automatically\s+(deleted|de-identified|purged)/i);
  });

  /**
   * The ROI multiple must divide by the clinic's own plan price. The client is not
   * told the plan (ClinicMembership carries none), so it must not invent a
   * denominator — it used to fall back to `totalBookedValue / 149`, which showed a
   * free Solo clinic a return against a subscription it does not hold.
   */
  it('never divides booked value by a hardcoded plan price', () => {
    const pipeline = readSurface('src/components/TreatmentPipeline.tsx');
    expect(pipeline).not.toMatch(/\/\s*149\b/);
    expect(pipeline).not.toMatch(/subscriptionCost\s*=\s*[0-9]/);
  });

  /**
   * PENDING — not yet enforced. The demo VISUALS still carry the fabricated
   * constants the landing-page guard above bans, plus PMS-verification claims
   * removed everywhere else:
   *
   *   Scenes.tsx:1847-1849  Math.min(34800, …)  ·  18400  ·  '123.5x'
   *   Scenes.tsx:1928       "9 verified in PMS"
   *   Scenes.tsx:1985       "✓ D4W #8491 Verified"
   *   Scenes.tsx:2058       "Sync to D4W"
   *   Scenes.tsx:1878,1888,1893  "Revenue Engine & PMS Sync" · "Universal PMS
   *                              Bridge" · "D4W · EXACT · Cliniko Verified"
   *   Scenes.tsx:1486,1501,1528,1547  "Eliminate 100% of After-Hours Charting" ·
   *                              "15–20 min" · "1.5–2 Hours … every single day" ·
   *                              "+$15k–$30k"
   *
   * The replacement patch is written out in
   * docs/reviews/claims-fix-applied-and-pending.md. `src/demo/Scenes.tsx` is 2,125
   * lines and the editor available for that pass could not reach past ~64 KB of a
   * file, so the fix needs a session that can write the whole file. When it lands:
   * enable this test and add 'src/demo/Scenes.tsx' to the `surfaces` arrays above.
   */
  it.skip('PENDING: demo visuals carry no fabricated constants or PMS-verification claims', () => {
    const scenes = readSurface('src/demo/Scenes.tsx');
    const pending = [
      '34800',
      '18400',
      '123.5x',
      '9 verified in PMS',
      'Universal PMS Bridge',
      'Sync to D4W',
      '+$15k–$30k',
    ];
    for (const token of pending) {
      expect(scenes, `src/demo/Scenes.tsx must not claim: ${token}`).not.toContain(token);
    }
  });
});
