# Backup and restore

Patient records are the one thing in this product that cannot be regenerated. A
note can be redrafted; a deleted year of a practice's records cannot be
recovered. Treat this as the highest-consequence process you own.

## What must be backed up

| Data | Where | Backup method |
|---|---|---|
| Dentists, clinics, memberships | Postgres | Provider-managed backups |
| Consultations (the patient records) | Postgres | Provider-managed backups |
| Audit log | Postgres | Provider-managed backups |
| Note job queue | Postgres | Included; a lost job is a re-submission, not a loss |
| Secrets (`SESSION_SECRET`, ops/cron secrets) | Your password manager | Manual — **if you lose `SESSION_SECRET`, every session is invalidated, which is recoverable; if you lose `DATABASE_URL`, nothing is** |

Application code lives in Git. Nothing else needs backing up.

## Configuring it (Neon example)

1. Neon takes a copy-on-write branch history by default; confirm your project's
   **history retention window** (7 days on the free tier, longer on paid) and
   that point-in-time restore is available for your plan.
2. Add an independent, longer-lived copy — do not rely on one provider:
   ```bash
   # Nightly logical dump to object storage you control (runs outside the app)
   pg_dump "$DATABASE_URL" --format=custom --no-owner \
     | gzip > "dentai-$(date +%F).dump.gz"
   ```
   Store it encrypted (object storage with SSE, or `age`/`gpg` first). Retain 30
   days, then delete. A dump of clinical data sitting in a personal Dropbox is a
   reportable breach waiting to happen.
3. Set a calendar reminder for the retention settings on both the provider and
   the dump target.

## Restore rehearsal (do this monthly, ~20 minutes)

Never rehearse against production. Create a throwaway branch/database first.

```bash
# 1. Create a scratch database (Neon branch, or a local Postgres in Docker)
export SCRATCH="postgresql://.../dentai_restore_test"

# 2. Restore the most recent dump into it
gunzip -c dentai-2026-09-15.dump.gz | pg_restore --no-owner --dbname "$SCRATCH"

# 3. Prove the data is actually there
psql "$SCRATCH" -c "SELECT count(*) AS dentists FROM dentists;"
psql "$SCRATCH" -c "SELECT count(*) AS consultations FROM consultations;"
psql "$SCRATCH" -c "SELECT max(created_at) AS newest_record FROM consultations;"

# 4. Spot-check one record end to end
psql "$SCRATCH" -c "SELECT id, patient_first_name, created_at FROM consultations ORDER BY created_at DESC LIMIT 5;"

# 5. Tear the scratch database down
```

Record the result: date, dump used, row counts, how long the restore took. If the
newest record is older than your last backup window, your backups are not running.

## Recovering from a real loss

1. **Stop writing.** If data was deleted by a bad migration or a script, take the
   app out of service (scale the deployment to zero, or revoke `DATABASE_URL`
   access) so the loss does not grow.
2. **Assess the window.** Point-in-time restore to the second before the incident
   is usually better than a nightly dump — it loses minutes, not a day.
3. **Restore into a new database**, verify row counts and the newest record, then
   point the app at it and redeploy.
4. **Tell the affected practice.** If patient records were lost, exposed, or
   altered, this is potentially a notifiable data breach — follow
   `docs/runbooks/notifiable-data-breach.md` and the 24-hour DPA promise.
5. **Write down what happened** while it is fresh, even if it was your mistake.
   The next incident will be easier, and a practice asking "what did you change?"
   deserves a real answer.

## What you should not do

- Do not restore a dump over a live database to "fix" one record.
- Do not keep dumps longer than 30 days unless a practice's retention policy
  requires it — long-lived copies multiply your breach exposure.
- Do not store dumps next to the database credentials.
