/**
 * Patient registry surface.
 *
 * Three things live here:
 *
 *  1. The intake **resolution** endpoint. The chairside UI asks "is this an
 *     existing patient?" and gets back a decision rather than a guess.
 *  2. Search and explicit creation, so a clinician can pick a patient instead of
 *     retyping a name and hoping the match is right.
 *  3. The **linker** that the consultation write path calls. Every saved record
 *     goes through it, so a record can never be attached to a patient by name
 *     alone, and an ambiguous identity is flagged for a human rather than
 *     silently resolved.
 *
 * The policy itself is in `src/lib/patients.ts` — pure and unit-tested. This file
 * is transport plus authorisation.
 */

import { patientDisplayName, type PatientRecord, type ResolveInput } from '../lib/patients';
import type { PatientStore } from './patientStore';

type Middleware = (req: any, res: any, next: (err?: any) => void) => any;

export interface PatientCandidateDto {
  id: string;
  name: string;
  dob: string;
}

export interface PatientLinkResult {
  /** Set when the record can be attached to a patient with confidence. */
  patientId?: string;
  /** True when same-named patients exist and a human must confirm which one. */
  identityNeedsReview?: boolean;
  patientCandidates?: PatientCandidateDto[];
}

export interface PatientRouteDeps {
  logger: {
    info: (message: string, context?: Record<string, any>) => void;
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  authenticate: Middleware;
  dbEnabled: boolean;
  store: PatientStore;
  /** Resolves and authorises the clinic scope for the calling dentist. */
  resolveClinicScope: (dentistId: string, requested?: string | null) => Promise<string | null>;
  /** Records for one patient at one clinic, newest first. */
  listConsultationsByPatient: (clinicId: string, patientId: string, limit?: number) => Promise<any[]>;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
}

const MAX_NAME_LENGTH = 120;

function cleanNamePart(value: unknown): string {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function candidateDto(p: PatientRecord): PatientCandidateDto {
  return { id: p.id, name: patientDisplayName(p), dob: p.dob || '' };
}

/**
 * Attaches a patient to a consultation payload.
 *
 * Order of precedence:
 *   1. An explicit `patientId` from the client is honoured **only** when it
 *      resolves to a patient at this clinic. An id from another practice (or a
 *      stale one) is ignored, never trusted.
 *   2. Otherwise the registry is asked to resolve the intake. One agreeing
 *      record links; nothing agreeing registers a new patient.
 *   3. If same-named patients exist without a detail that settles it, the record
 *      is left unlinked and flagged `identityNeedsReview`. The save still
 *      succeeds — clinical work is never discarded over an identity question —
 *      but the chart is not silently guessed at.
 */
export function createPatientLinker(
  deps: Pick<PatientRouteDeps, 'store' | 'logger'>
): (consultation: any) => Promise<PatientLinkResult> {
  return async function linkPatient(consultation: any): Promise<PatientLinkResult> {
    const clinicId: string | undefined =
      typeof consultation?.clinicId === 'string' && consultation.clinicId
        ? consultation.clinicId
        : undefined;
    // Without a clinic scope there is no registry to be correct against.
    if (!clinicId) return {};

    const requestedId = typeof consultation?.patientId === 'string' ? consultation.patientId : '';
    if (requestedId) {
      try {
        const patient = await deps.store.getById(clinicId, requestedId);
        if (patient) return { patientId: patient.id, identityNeedsReview: false };
        deps.logger.warn('Ignoring a patient id that does not belong to this clinic', {
          clinicId,
          patientId: requestedId
        });
      } catch (err: any) {
        deps.logger.warn('Could not verify the supplied patient id:', err?.message || err);
      }
    }

    const firstName = cleanNamePart(consultation?.firstName);
    const lastName = cleanNamePart(consultation?.lastName);
    if (!firstName && !lastName) return {};

    try {
      const resolved = await deps.store.resolve({
        clinicId,
        firstName,
        lastName,
        dob: typeof consultation?.dob === 'string' ? consultation.dob : '',
        phone: typeof consultation?.phone === 'string' ? consultation.phone : undefined
      });

      if (resolved.patient) {
        return { patientId: resolved.patient.id, identityNeedsReview: false };
      }

      if (resolved.decision.decision === 'ambiguous') {
        return {
          identityNeedsReview: true,
          patientCandidates: resolved.decision.candidates.map(candidateDto)
        };
      }

      return {};
    } catch (err: any) {
      // Identity is not worth failing a clinical save over. Leave the record
      // unlinked (the safe direction) and let it be reconciled later.
      deps.logger.error('Patient identity resolution failed:', err?.message || err, { clinicId });
      return { identityNeedsReview: true };
    }
  };
}

export function registerPatientRoutes(app: any, deps: PatientRouteDeps): void {
  /** Resolves the clinic the caller is working in, and requires membership. */
  async function scopedClinic(req: any, res: any, requested?: string | null): Promise<string | null> {
    const clinicId = await deps.resolveClinicScope(req.dentist.id, requested ?? null);
    if (!clinicId) {
      res.status(403).json({
        error: 'No clinic is available for this account. Ask your practice administrator.',
        code: 'NO_CLINIC_SCOPE'
      });
      return null;
    }
    return clinicId;
  }

  /** Candidates for a name. Never an identity decision — see the module header. */
  app.get('/api/patients', deps.authenticate, async (req: any, res: any) => {
    try {
      const clinicId = await scopedClinic(
        req,
        res,
        typeof req.query?.clinicId === 'string' ? req.query.clinicId : null
      );
      if (!clinicId) return;

      const query = typeof req.query?.query === 'string' ? req.query.query : '';
      const results = query
        ? await deps.store.searchByName(clinicId, query, 20)
        : await deps.store.listForClinic(clinicId, 200);

      res.setHeader('Cache-Control', 'no-store');
      return res.json(results.map(candidateDto));
    } catch (err: any) {
      deps.logger.error('Patient search failed:', err?.message || err);
      return res.status(500).json({ error: 'Failed to search patients.' });
    }
  });

  /**
   * Intake resolution.
   *
   * Returns `matched` (safe to reuse), `ambiguous` (a human must choose) or
   * `created` (a new patient was registered). The caller must not treat
   * `ambiguous` as "use the first candidate".
   */
  app.post('/api/patients/resolve', deps.authenticate, async (req: any, res: any) => {
    try {
      const clinicId = await scopedClinic(req, res, req.body?.clinicId);
      if (!clinicId) return;

      const firstName = cleanNamePart(req.body?.firstName);
      const lastName = cleanNamePart(req.body?.lastName);
      if (!firstName && !lastName) {
        return res.status(400).json({ error: 'A patient first name or last name is required.' });
      }

      const input: ResolveInput = {
        clinicId,
        firstName,
        lastName,
        dob: typeof req.body?.dob === 'string' ? req.body.dob.trim() : '',
        phone: typeof req.body?.phone === 'string' ? req.body.phone : undefined
      };

      const { decision, patient } = await deps.store.resolve(input);

      if (decision.decision === 'ambiguous') {
        void Promise.resolve(
          deps.logAudit('patient_identity_ambiguous', req.dentist.id, {
            clinicId,
            candidates: decision.candidates.length,
            reason: decision.reason
          })
        ).catch(() => {});
        return res.status(200).json({
          status: 'ambiguous',
          reason: decision.reason,
          candidates: decision.candidates.map(candidateDto)
        });
      }

      if (!patient) {
        return res.status(500).json({ error: 'Could not resolve the patient record.' });
      }

      if (decision.decision === 'create') {
        void Promise.resolve(
          deps.logAudit('patient_registered', req.dentist.id, {
            clinicId,
            patientId: patient.id,
            identityConfidence: decision.identityConfidence
          })
        ).catch(() => {});
        return res.status(201).json({
          status: 'created',
          // A record registered without a second identifying detail cannot be
          // told apart from a future same-named patient, so the UI is told.
          identityConfidence: decision.identityConfidence,
          patient: { ...candidateDto(patient), phone: patient.phone ?? null }
        });
      }

      return res.json({ status: 'matched', patient: { ...candidateDto(patient), phone: patient.phone ?? null } });
    } catch (err: any) {
      deps.logger.error('Patient resolution failed:', err?.message || err);
      return res.status(500).json({ error: 'Failed to resolve the patient.' });
    }
  });

  /** Explicit creation, for when a clinician says "this is a new patient". */
  app.post('/api/patients', deps.authenticate, async (req: any, res: any) => {
    try {
      const clinicId = await scopedClinic(req, res, req.body?.clinicId);
      if (!clinicId) return;

      const firstName = cleanNamePart(req.body?.firstName);
      const lastName = cleanNamePart(req.body?.lastName);
      if (!firstName && !lastName) {
        return res.status(400).json({ error: 'A patient first name or last name is required.' });
      }

      const patient = await deps.store.create({
        clinicId,
        firstName,
        lastName,
        dob: typeof req.body?.dob === 'string' ? req.body.dob.trim() : '',
        phone: typeof req.body?.phone === 'string' ? req.body.phone : undefined,
        createdBy: req.dentist.id
      });

      void Promise.resolve(
        deps.logAudit('patient_registered', req.dentist.id, { clinicId, patientId: patient.id })
      ).catch(() => {});

      return res.status(201).json({ ...candidateDto(patient), phone: patient.phone ?? null });
    } catch (err: any) {
      deps.logger.error('Patient creation failed:', err?.message || err);
      return res.status(500).json({ error: 'Failed to create the patient.' });
    }
  });

  /**
   * One patient's records at this clinic, newest first.
   *
   * Scoped by `patientId`, never by name. An empty list for a patient with no
   * linked records is the correct answer — the previous behaviour of falling back
   * to a name match is what put one patient's history on another's chart.
   */
  app.get('/api/patients/:id/history', deps.authenticate, async (req: any, res: any) => {
    try {
      const clinicId = await scopedClinic(
        req,
        res,
        typeof req.query?.clinicId === 'string' ? req.query.clinicId : null
      );
      if (!clinicId) return;

      const patient = await deps.store.getById(clinicId, String(req.params.id));
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found at this clinic.' });
      }

      const records = await deps.listConsultationsByPatient(clinicId, patient.id, 100);
      void Promise.resolve(
        deps.logAudit('patient_history_viewed', req.dentist.id, {
          clinicId,
          patientId: patient.id,
          count: records.length
        })
      ).catch(() => {});

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        patient: { ...candidateDto(patient), phone: patient.phone ?? null },
        consultations: records
      });
    } catch (err: any) {
      deps.logger.error('Patient history failed:', err?.message || err);
      return res.status(500).json({ error: 'Failed to load the patient history.' });
    }
  });
}
