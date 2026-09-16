/**
 * Practice-initiated export.
 *
 * Data portability was a documented promise with no implementation: the runbook
 * said "run psql". That makes every patient access request a task for the
 * founder, and it means a practice leaving DentAI has to ask for its own
 * records — which is both a support burden and, under APP 12, a promise the
 * practice cannot keep without you.
 *
 * What a practice can now download:
 *   - every consultation in the clinic (JSON, or CSV a spreadsheet can open);
 *   - the clinic's members and their status;
 *   - the practice agreement acceptances (the evidence trail);
 *   - invitations that have been sent;
 *   - the clinic's own access log entries for its members;
 *   - a usage summary for the current day.
 *
 * Two rules it does not break:
 *   - **Authorisation is per clinic.** A clinician downloading records gets the
 *     clinic they own; a solo account gets their own records. Another clinic's
 *     rows cannot be reached by changing a query parameter.
 *   - **Every export is audited** with who, which clinic, how many records and
 *     in what format. An export is a bulk access event and must appear in the
 *     access log the practice is trusting.
 */

import type { Consultation } from '../types';
import { consultationsToCsv, csvToString, exportFilename } from '../lib/noteExport';
import type { AgreementGate } from './practiceAgreement';
import type { ClinicInvite, PracticeAcceptance } from './stores';

export interface ExportMember {
  dentistId: string;
  name: string;
  role: string;
  status: string;
}

export interface ExportAuditEntry {
  event: string;
  dentistId: string | null;
  detail: Record<string, any>;
  createdAt: string;
}

export interface ClinicExportDeps {
  logger: {
    error: (message: string, error?: any, context?: Record<string, any>) => void;
  };
  authenticate: (req: any, res: any, next: (err?: any) => void) => any;
  membershipsFor: (
    dentistId: string
  ) => Promise<Array<{ clinicId: string; clinicName?: string; role: string; status: string }>>;
  membersFor: (clinicId: string) => Promise<ExportMember[]>;
  consultationsForClinic: (clinicId: string) => Promise<Consultation[]>;
  consultationsForDentist: (dentistId: string) => Promise<Consultation[]>;
  auditEntries: (limit: number) => Promise<ExportAuditEntry[]>;
  acceptancesFor: (clinicId: string) => Promise<PracticeAcceptance[]>;
  invitesFor: (clinicId: string) => Promise<ClinicInvite[]>;
  usageToday: (scopeId: string) => Promise<{ used: number; limit: number }>;
  agreement: AgreementGate;
  logAudit: (event: string, dentistId: string, detail?: Record<string, any>) => void | Promise<void>;
  /** Included in the export so the practice can see what it has agreed to. */
  documentVersions: Record<string, string>;
  now?: () => Date;
}

export function registerClinicExportRoutes(app: any, deps: ClinicExportDeps): void {
  app.get('/api/clinic/export', deps.authenticate, async (req: any, res: any) => {
    const dentistId: string = req.dentist.id;
    try {
      const format = String(req.query.format || 'json').toLowerCase();
      if (format !== 'json' && format !== 'csv') {
        return res.status(400).json({ error: 'format must be "json" or "csv".' });
      }

      const memberships = await deps.membershipsFor(dentistId);
      const owned = memberships.find((m) => m.role === 'owner' && m.status === 'active');
      const active = owned || memberships.find((m) => m.status === 'active');

      if (active && owned) {
        // Taking data out of a practice is exactly the action that should
        // require the current terms to be accepted.
        const gate = await deps.agreement.check(dentistId);
        if (!gate.ok) {
          return res.status(403).json({ error: gate.message, code: 'AGREEMENT_REQUIRED' });
        }
      }

      const scope = active
        ? { kind: 'clinic' as const, id: active.clinicId, name: active.clinicName }
        : { kind: 'personal' as const, id: dentistId, name: req.dentist.name };

      const consultations =
        scope.kind === 'clinic'
          ? await deps.consultationsForClinic(scope.id)
          : await deps.consultationsForDentist(scope.id);

      const members = scope.kind === 'clinic' ? await deps.membersFor(scope.id) : [];
      const memberIds = new Set<string>(members.map((m) => m.dentistId));
      memberIds.add(dentistId);

      const [acceptances, invites, usage, audit] = await Promise.all([
        scope.kind === 'clinic' ? deps.acceptancesFor(scope.id) : Promise.resolve([]),
        scope.kind === 'clinic' ? deps.invitesFor(scope.id) : Promise.resolve([]),
        deps.usageToday(scope.id).catch(() => ({ used: 0, limit: 0 })),
        // Filtering by member ids is what keeps one practice's log out of
        // another's export; audit rows carry the actor, not the clinic.
        deps.auditEntries(5000).catch(() => []),
      ]);

      const clinicAudit = audit.filter((entry) => entry.dentistId && memberIds.has(entry.dentistId));

      const exportedAt = (deps.now ? deps.now() : new Date()).toISOString();
      const filename = exportFilename(
        `${scope.kind === 'clinic' ? 'dentai-practice' : 'dentai-records'}-export`,
        new Date(exportedAt)
      );

      await deps.logAudit('clinic_export_downloaded', dentistId, {
        scope: scope.kind,
        scopeId: scope.id,
        format,
        consultations: consultations.length,
        auditEntries: clinicAudit.length,
      });

      if (format === 'csv') {
        const csv = csvToString(consultationsToCsv(consultations));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.send(csv);
      }

      return res.json({
        export: {
          exportedAt,
          scope: scope.kind,
          clinic: scope.name ?? null,
          recordCount: consultations.length,
          note: 'This export contains patient information. Store it as carefully as the records themselves and delete it when no longer needed.',
          documentVersions: deps.documentVersions,
        },
        usageToday: usage,
        members,
        acceptances,
        invites,
        consultations,
        accessLog: clinicAudit,
      });
    } catch (err: any) {
      deps.logger.error('Clinic export failed:', err?.message || err, { url: req.originalUrl });
      return res.status(500).json({ error: 'Export failed. No data was sent — please try again.' });
    }
  });

  /**
   * A one-record export, for a practice answering a patient access request
   * without downloading everything. Same authorisation, same audit trail.
   */
  app.get('/api/clinic/export/consultation/:id', deps.authenticate, async (req: any, res: any) => {
    const dentistId: string = req.dentist.id;
    try {
      const memberships = await deps.membershipsFor(dentistId);
      const owned = memberships.find((m) => m.role === 'owner' && m.status === 'active');
      const active = owned || memberships.find((m) => m.status === 'active');
      const scopeId = active ? active.clinicId : dentistId;

      const consultations =
        owned && active
          ? await deps.consultationsForClinic(scopeId)
          : await deps.consultationsForDentist(dentistId);
      const record = consultations.find((c) => c.id === req.params.id);
      if (!record) {
        return res.status(404).json({ error: 'Record not found in your accessible records.' });
      }

      await deps.logAudit('patient_record_exported', dentistId, { recordId: record.id });
      return res.json({ exportedAt: new Date().toISOString(), consultation: record });
    } catch (err: any) {
      deps.logger.error('Single record export failed:', err?.message || err, {
        url: req.originalUrl,
      });
      return res.status(500).json({ error: 'Export failed. Please try again.' });
    }
  });
}
