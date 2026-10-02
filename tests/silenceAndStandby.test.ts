import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import {
  decideSilenceAction,
  SILENCE_SLEEP_SECONDS,
  SILENCE_WARN_SECONDS,
  SILENCE_WARN_CHIME_HZ
} from '../src/lib/silencePolicy';
import { evaluateChunkIngestion } from '../src/lib/standbyPolicy';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const { app, invalidateDbCache } = await import('../server.ts');

const chairSessionsDbPath = path.join(__dirname, '..', 'data', 'chair_sessions.json');

describe('Clinical Silence Policy & Standby Boundary Hardening', () => {
  let sessionsBackup: string | null = null;

  beforeAll(() => {
    if (fs.existsSync(chairSessionsDbPath)) {
      sessionsBackup = fs.readFileSync(chairSessionsDbPath, 'utf-8');
    }
  });

  afterAll(() => {
    if (sessionsBackup !== null) {
      fs.writeFileSync(chairSessionsDbPath, sessionsBackup);
    } else if (fs.existsSync(chairSessionsDbPath)) {
      fs.unlinkSync(chairSessionsDbPath);
    }
    invalidateDbCache();
  });

  describe('Pure Silence Sleep Policy (3-Minute Rule)', () => {
    it('declares the immutable clinical constants', () => {
      expect(SILENCE_SLEEP_SECONDS).toBe(180);
      expect(SILENCE_WARN_SECONDS).toBe(150);
      expect(SILENCE_WARN_CHIME_HZ).toBe(784);
    });

    it('evaluates silence thresholds precisely at boundaries', () => {
      expect(decideSilenceAction(0)).toBe('none');
      expect(decideSilenceAction(60)).toBe('none');
      expect(decideSilenceAction(149)).toBe('none');
      expect(decideSilenceAction(149.9)).toBe('none');

      // 150s: Pre-pause countdown warning
      expect(decideSilenceAction(150)).toBe('warn');
      expect(decideSilenceAction(151)).toBe('warn');
      expect(decideSilenceAction(179.9)).toBe('warn');

      // 180s (3:00): Auto-pause listening
      expect(decideSilenceAction(180)).toBe('pause');
      expect(decideSilenceAction(181)).toBe('pause');
      expect(decideSilenceAction(600)).toBe('pause');
    });
  });

  describe('Pure Standby & Session Ingestion Boundary Policy', () => {
    it('accepts audio when session is active and unbound or matching', () => {
      expect(evaluateChunkIngestion({}, undefined)).toEqual({ action: 'accept' });
      expect(evaluateChunkIngestion({ activeConsultationId: 'consult-101' }, 'consult-101')).toEqual({ action: 'accept' });
    });

    it('refuses audio when session has been closed', () => {
      const res = evaluateChunkIngestion({ isClosed: true }, 'consult-101');
      expect(res.action).toBe('refuse');
      if (res.action === 'refuse') {
        expect(res.code).toBe('SESSION_CLOSED');
      }
    });

    it('refuses audio when consultationId is missing on a bound session', () => {
      const res = evaluateChunkIngestion({ activeConsultationId: 'consult-101' }, undefined);
      expect(res.action).toBe('refuse');
      if (res.action === 'refuse') {
        expect(res.code).toBe('CONSULTATION_REQUIRED');
      }
    });

    it('refuses audio when consultationId does not match the active patient consultation', () => {
      const res = evaluateChunkIngestion({ activeConsultationId: 'consult-101' }, 'consult-999-other-patient');
      expect(res.action).toBe('refuse');
      if (res.action === 'refuse') {
        expect(res.code).toBe('PATIENT_MISMATCH');
      }
    });
  });
});

