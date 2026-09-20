# Retention, export and deletion

A practice must be able to answer "how long do you keep my records, and can I
get them back or have them destroyed?". This is the policy you apply; the
defaults are in `src/lib/compliance.ts` (`DEFAULT_RETENTION_YEARS`) and are
recorded on each consultation.

## Enforcement state — read before quoting the table below

The schedule below is the **policy**, and the horizon is stamped on every
consultation at save time. It is not currently applied automatically: the sweep
(`src/server/retention.ts`) is **off unless `DENTAI_RETENTION_ENABLED=true`**, and
dry-run even then unless `DENTAI_RETENTION_DRY_RUN` is explicitly false
(`src/lib/retentionPolicy.ts`). `src/server/configCheck.ts` states the
consequence in its own words:

> "The 7-year retention promise in the privacy notice stays unexecuted; the sweep
> only reports."

So today deletion is **manual** — use the procedures at the end of this file.
Until the sweep is enabled, do not tell a practice or a patient that records are
deleted automatically on a schedule. To close the gap: run one dry sweep, read the
report, then enable it and note the date here.

## Default schedule

| Data | Default retention | Why |
|---|---|---|
| Clinical records (consultations, notes, correspondence) | 7 years from last entry | Aligns with the Dental Board of Australia / AHPRA record-keeping expectation for adults |
| Records of patients treated as a minor | Until the patient turns 25 (or 7 years, whichever is longer) | The AHPRA guideline for minors |
| Access log (who opened/changed what) | 7 years | An audit trail is only useful if it outlives the query about it |
| Usage ledger (cost metering) | 24 months | Billing and cost control; contains no clinical content |
| AI recovery codes | 1 hour (they expire) | Single-use, short-lived by design |
| Backup copies | Rolling 30 days, then expired | See the backup runbook |

A practice may set a **longer** retention period for its own jurisdiction. Never
shorten clinical retention below the practice's stated policy without written
instruction — you are deleting their records, not yours.

## Export (practice or patient access request)

Records are per-dentist in Postgres. Today, export is an operator task, which is
acceptable at low volume if you are quick about it:

```bash
# All consultations for one clinician, as JSON
psql "$DATABASE_URL" -c "\copy (SELECT * FROM consultations WHERE dentist_id = '<id>') TO 'export.json'"
```

Rules for handling the export:
1. Produce it only for the account/clinic that owns the record, and log that you
   did (`logAudit` event, plus the request in writing).
2. Deliver over an encrypted channel (password-protected archive, expiring link).
   Never plain email attachment.
3. Delete your working copy once the practice confirms receipt.
4. A patient asking for their own record should be referred to their practice
   first — the practice holds it. Only hand over records directly if the practice
   instructs it in writing.

## Deletion

| Request | Procedure |
|---|---|
| Remove a clinician's access | `bun run scripts/delete-profile.ts --list` then `--id <id> --yes`. Removes the profile, their consultations and memberships. **This deletes records — do not use it as an "offboarding" tool without the practice's sign-off.** |
| Offboard a clinician but keep the records | Have the practice owner remove them from the clinic (Members screen) and rotate the clinic invite code. The consultation history stays with the practice. |
| Delete a single patient record | Manual SQL against `consultations` by consultation id, plus the audit entry. Do it in a transaction and record the request. |
| Close a clinic account | Export first, confirm receipt, then delete by clinic id. Keep the audit log. |

Deletion is not instant across backups: state plainly that residual copies expire
within 30 days and are never restored except to recover from a loss event.

## What must never happen

- Deleting records to hide a mistake. Corrections are amendments, not deletions —
  the note-revision history (`src/server/recordGovernance.ts`) keeps the previous
  version and the amendment is the record.
- Leaving a departed clinician's profile active "just in case". An unused profile
  with a 4-digit PIN is the most likely way a practice gets breached.
- Promising a retention period shorter than the practice's own policy.
