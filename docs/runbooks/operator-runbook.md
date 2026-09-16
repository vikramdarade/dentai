# Operator runbook (solo founder)

What you do when it is 8:40am, a hygienist cannot sign in, and the first patient
is already in the chair. Keep this open in a tab.

## 1. The three URLs

| URL | Auth | Use |
|---|---|---|
| `/api/health` | none | Is it up? Is the database reachable? `200 ok`, `503 degraded` |
| `/api/ops/telemetry` | `DENTAI_OPS_SECRET` | Error counts, latency, `openNoteJobs` queue depth |
| `/api/ops/drain` | `DENTAI_OPS_SECRET` | Force a queue tick while debugging |

```bash
curl -s https://<app>/api/health | jq
curl -s -H "x-dentai-ops-secret: $OPS" https://<app>/api/ops/telemetry | jq
curl -s -X POST -H "x-dentai-ops-secret: $OPS" https://<app>/api/ops/drain | jq
```

Telemetry is **per instance** on serverless: it resets on cold start. Treat it as
"what has this instance seen", and use `ERROR_WEBHOOK_URL` plus your host's log
search for anything that has to survive a restart.

## 2. Symptom → action

| Symptom | Likely cause | Do this |
|---|---|---|
| "Cannot sign in", several clinicians at once | Database down, or a bad deploy | `/api/health` → if `database: unavailable`, check the Neon dashboard; if healthy, roll back the deployment |
| One clinician cannot sign in, others fine | Locked account (failed PINs) or forgotten PIN | Verify identity, then `bun run scripts/issue-recovery-token.ts --name "<name>"` and read them the single-use code |
| Sign-in succeeds but screens are empty | `DATABASE_URL` missing/mispointed, so it fell back to file storage (or the wrong project) | Confirm the env var in the deployment; check `/api/health` `storage` field — it must say `postgres` |
| Notes stuck at "Drafting…" | Queue not draining, or AI quota exhausted | `/api/ops/drain`; check `openNoteJobs`; check the Gemini key's quota; the offline draft tier should still let them finish |
| Notes appear with a "review required" banner | Hosted AI unavailable; an offline/fallback draft was used | Expected behaviour — reassure the clinician it is deliberate and safe to complete |
| Costs spiking | One clinic heavy, or the daily ceiling is too high | `DENTAI_DAILY_NOTE_LIMIT` / `DENTAI_DAILY_TOKEN_LIMIT`; metering is per clinic |
| "It's slow today" | Provider latency | `/api/ops/telemetry` p95; if the AI path is slow, the fallback chain will kick in |
| Suspected account compromise | Shared PIN, stolen device | `POST /api/auth/sessions/revoke-all` for that user (they can do it from Account access), then issue a recovery token and require a new PIN |

## 3. Recovering a locked-out clinician

1. Confirm you are talking to the real person (practice owner confirms, or a
   video call — you are handing over access to patient records).
2. `bun run scripts/issue-recovery-token.ts --name "Dr Jane Smith"`
   (needs `DATABASE_URL`; the script prints a single-use token valid for one hour).
3. Send it by phone or in person, never plain email.
4. They paste it at **Account access → Recover access with a recovery code** and
   choose a new PIN. Every other device is signed out and the event is logged.

## 4. Support you can honestly promise

Write this into the service agreement and then keep it:

- **Hours**: business hours AEST, Monday–Friday. Not 24×7.
- **Channel**: one address (`support@…`) that you monitor and that opens a ticket
  you can find later. Not your personal mobile.
- **Severity 1 (cannot record or cannot sign in, during clinic hours)**: same
  business day, target 4 hours.
- **Severity 2 (one feature broken)**: next business day.
- **Severity 3 (question/request)**: within 3 business days.
- **Data incidents**: notify the practice within 24 hours of becoming aware —
  this is a promise you make in the DPA, so honour it.

## 5. Weekly and monthly rhythm (30 minutes)

**Weekly**
- [ ] `/api/health` from outside your network; check your uptime monitor's log
- [ ] Read new support requests and anything the error webhook sent
- [ ] Confirm the queue drained: `openNoteJobs` should return to 0
- [ ] Check the Gemini/Google bill against your per-clinic estimate

**Monthly**
- [ ] Rehearse a restore (see `docs/runbooks/backup-and-restore.md`) — a backup
      you have never restored is a rumour
- [ ] Review who has an account; remove any profile that should not exist
- [ ] Confirm dependency updates did not break the test suite
- [ ] Look at the access log for anything unusual (a dentist opening far more
      records than they see patients)

## 6. Things not to do

- Do not edit the database by hand to "fix" a note. Amendments are the record;
  use the app or an audited SQL transaction.
- Do not delete a profile to solve a sign-in problem — recovery exists and
  deletion destroys records the clinic must keep.
- Do not paste patient data into a spreadsheet, chat, or an LLM to debug an
  issue. Reproduce with synthetic data instead.
- Do not restart infrastructure hoping it helps. Check `/api/health` first;
  cold starts are normal on serverless and restarting server processes does
  nothing for a database problem.
