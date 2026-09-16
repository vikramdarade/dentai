/**
 * Practice-level agreement record.
 *
 * The gap this closes: patient consent was stored per consultation, and the
 * disclosures were versioned, but nothing recorded that the *practice* accepted
 * a specific version of the service terms and the data-processing terms. Those
 * are the documents a dispute, an insurer or a due-diligence review asks for
 * first, and "we emailed it to them" is not evidence.
 *
 * Design decisions worth knowing:
 *  - **Only the owner can accept**, because the owner is who the practice has
 *    authorised — a locum cannot bind the practice.
 *  - **Versions are immutable.** Changing the wording means bumping the version
 *    in src/lib/compliance.ts, which invalidates every prior acceptance and
 *    surfaces "re-acceptance required" to that practice. Silently updating a
 *    document a practice already agreed to is the thing this prevents.
 *  - **Enforcement is a gate, not a wall.** With
 *    DENTAI_REQUIRE_PRACTICE_AGREEMENT=true, an owner cannot invite colleagues
 *    or export records until the current versions are accepted; treating
 *    patients is never interrupted, because that would punish the patient for an
 *    administrative lapse.
 */

import crypto from 'crypto';
import type { PracticeAcceptance, PracticeAcceptanceStore } from './stores';

export interface AgreementVersions {
  terms: string;
  privacy: string;
  dpa: string;
}

export interface PracticeAgreementDeps {
  logger: {
    warn: (message: string, context?: Record<string, any>) => void;
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  authenticate: (req: any, res: any, next: (err?: any) => void) => any;
  store: PracticeAcceptanceStore;
  versions: AgreementVersions;
  /** Memberships for a dentist, used to find the clinic they own. */
  membershipsFor: (dentistId: string) => Promise<
    Array<{ clinicId: string; role: string; status: string; clinicName?: string }>
  >;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
  /** When true, invites and exports are refused until acceptance. */
  enforce: boolean;
}

/** True when the latest acceptance is missing or predates the current versions. */
export function needsAcceptance(
  latest: PracticeAcceptance | null,
  versions: AgreementVersions
): boolean {
  if (!latest) return true;
  return (
    latest.termsVersion !== versions.terms ||
    latest.privacyVersion !== versions.privacy ||
    latest.dpaVersion !== versions.dpa
  );
}

export interface AgreementStatus {
  required: boolean;
  accepted: boolean;
  versions: AgreementVersions;
  latest: PracticeAcceptance | null;
  clinicId: string | null;
  clinicName?: string;
  canAccept: boolean;
  summary: string;
}

/**
 * The result of the gate. Kept as a flat optional shape rather than a
 * discriminated union so callers can read `message` without narrowing.
 */
export interface AgreementCheckResult {
  ok: boolean;
  /** Present when `ok` is false. */
  message?: string;
  clinicId?: string | null;
}

export interface AgreementGate {
  /** The owner's clinic, or null when the dentist owns none. */
  ownedClinicId(dentistId: string): Promise<string | null>;
  statusFor(dentistId: string): Promise<AgreementStatus>;
  /**
   * Gate used by the invite and export routes. Returns a refusal message when
   * acceptance is required and missing.
   */
  check(dentistId: string): Promise<AgreementCheckResult>;
}

export function createAgreementGate(deps: PracticeAgreementDeps): AgreementGate {
  async function ownedClinicId(dentistId: string): Promise<string | null> {
    const memberships = await deps.membershipsFor(dentistId);
    const owned = memberships.find((m) => m.role === 'owner' && m.status === 'active');
    return owned?.clinicId ?? null;
  }

  async function statusFor(dentistId: string): Promise<AgreementStatus> {
    const memberships = await deps.membershipsFor(dentistId);
    const owned = memberships.find((m) => m.role === 'owner' && m.status === 'active');
    const clinicId = owned?.clinicId ?? null;
    const latest = clinicId ? await deps.store.latestForClinic(clinicId) : null;
    const required = needsAcceptance(latest, deps.versions);
    return {
      required,
      accepted: !required,
      versions: deps.versions,
      latest,
      clinicId,
      clinicName: owned?.clinicName,
      canAccept: !!clinicId,
      summary: !clinicId
        ? 'No clinic is owned by this account.'
        : required
          ? latest
            ? 'The practice terms have been updated. The practice owner must accept the current versions.'
            : 'The practice owner has not accepted the terms, privacy notice and data-processing terms yet.'
          : `Accepted ${latest?.acceptedAt?.slice(0, 10)} by ${latest?.acceptedByName}.`,
    };
  }

  return {
    ownedClinicId,
    statusFor,
    async check(dentistId): Promise<AgreementCheckResult> {
      if (!deps.enforce) return { ok: true };
      const status = await statusFor(dentistId);
      if (!status.required || !status.canAccept) return { ok: true };
      return {
        ok: false,
        clinicId: status.clinicId,
        message:
          'The practice owner must accept the current DentAI service terms and data-processing terms before this action is available. Open Practice terms to review and accept.',
      };
    },
  };
}

export function registerPracticeAgreementRoutes(app: any, deps: PracticeAgreementDeps): AgreementGate {
  const gate = createAgreementGate(deps);

  app.get('/api/practice/agreement', deps.authenticate, async (req: any, res: any) => {
    try {
      const status = await gate.statusFor(req.dentist.id);
      return res.json({ ...status, enforce: deps.enforce });
    } catch (err: any) {
      deps.logger.error('Failed to read practice agreement status:', err?.message || err, {
        url: req.originalUrl,
      });
      return res.status(500).json({ error: 'Could not read the practice agreement status.' });
    }
  });

  app.post('/api/practice/agreement/accept', deps.authenticate, async (req: any, res: any) => {
    try {
      const { acceptedByName, acceptedByEmail } = req.body || {};
      if (typeof acceptedByName !== 'string' || acceptedByName.trim().length < 3) {
        return res.status(400).json({
          error: 'Enter the full name of the person accepting on behalf of the practice.',
        });
      }
      if (acceptedByEmail && typeof acceptedByEmail !== 'string') {
        return res.status(400).json({ error: 'Email address is not valid.' });
      }

      const status = await gate.statusFor(req.dentist.id);
      if (!status.clinicId) {
        return res.status(403).json({
          error: 'Only the practice owner can accept these terms, and no clinic is owned by this account.',
          code: 'OWNER_REQUIRED',
        });
      }

      const acceptance: PracticeAcceptance = {
        id: crypto.randomUUID(),
        clinicId: status.clinicId,
        termsVersion: deps.versions.terms,
        privacyVersion: deps.versions.privacy,
        dpaVersion: deps.versions.dpa,
        acceptedByName: acceptedByName.trim(),
        acceptedByEmail: typeof acceptedByEmail === 'string' && acceptedByEmail.trim()
          ? acceptedByEmail.trim().toLowerCase()
          : null,
        acceptedByDentistId: req.dentist.id,
        acceptedAt: new Date().toISOString(),
      };

      await deps.store.record(acceptance);
      await deps.logAudit('practice_terms_accepted', req.dentist.id, {
        clinicId: acceptance.clinicId,
        termsVersion: acceptance.termsVersion,
        privacyVersion: acceptance.privacyVersion,
        dpaVersion: acceptance.dpaVersion,
      });

      return res.status(201).json({
        success: true,
        acceptance,
        message:
          'Recorded. A copy of these versions is kept against the practice, and re-acceptance is required if the terms change.',
      });
    } catch (err: any) {
      deps.logger.error('Failed to record practice acceptance:', err?.message || err, {
        url: req.originalUrl,
      });
      return res.status(500).json({ error: 'Could not record the acceptance. Please try again.' });
    }
  });

  return gate;
}
