# Notifiable Data Breach response

The Notifiable Data Breaches (NDB) scheme under the Privacy Act 1988 applies to
you as a service provider holding health information. Health information is
"sensitive information", so the serious-harm threshold is low. Assume a breach of
patient records is notifiable until you have assessed otherwise, in writing.

**Deadline: assess "as soon as practicable" and within 30 days of becoming aware.
Your DPA promises the practice notice within 24 hours — do that first, then
assess.**

## Step 0 — Contain (first hour)

- [ ] Revoke access: rotate `SESSION_SECRET` (invalidates every session and
      every forged token), rotate `DENTAI_OPS_SECRET` and `CRON_SECRET`, rotate
      the Gemini/Google key and `DATABASE_URL` credentials if they may be exposed.
- [ ] If a credential is compromised: issue recovery tokens / require new PINs for
      affected accounts, and remove any account that should not exist.
- [ ] Preserve evidence before cleaning up: export the relevant audit-log rows and
      deployment logs. Do not "fix" the cause until you have the timeline.
- [ ] Stop the bleeding in code if needed (disable the affected endpoint and
      redeploy) rather than leaving a live hole open while you investigate.

## Step 1 — Assess (same day)

Write down, in one document:

1. **What kind of information**: patient names, DOB, clinical notes, transcripts,
   PIN hashes. Health information plus identifiers is the worst case.
2. **How many people** and which practices.
3. **Whether it is accessible or was actually accessed** — unexplained access is
   treated as accessed.
4. **Likely harm**: identity fraud, embarrassment, clinical prejudice. For health
   records, the OAIC expects you to assume a real risk of serious harm.
5. **Whether encryption or another control made it unintelligible.** For a
   leaked salted PBKDF2 hash of a 4-digit PIN, this is *not* a safe harbour — the
   keyspace is 10,000.

If any of 1–4 is present and 5 does not clearly apply → **notifiable**.

## Step 2 — Notify (within 30 days, but do it in days)

1. **The practice(s) affected** — first, and within 24 hours. They hold the
   patient relationship and may have their own notification obligations. Give
   them: what happened, what data, who is affected, what you have done, what you
   recommend they say.
2. **The OAIC** — complete the online Notifiable Data Breach form
   (oaic.gov.au → Notifiable Data Breaches). You may start the assessment and
   finalise after investigating.
3. **Affected individuals** — via the practice where possible. The statement must
   say what happened, what information was involved, what you have done, and what
   they should do (e.g. watch for unsolicited contact). Recommend they contact
   IDCARE (1800 595 160) if identity information was involved.

## Step 3 — Learn (within a week)

- [ ] Add the control that would have prevented it. If it was a code path, add a
      test that fails without the fix.
- [ ] Update `docs/legal/data-flow-and-subprocessors.md` if the breach revealed a
      processing path you had not documented — that gap is itself a finding.
- [ ] Offer the practice an honest written summary. Practices talk to each other;
      a founder who owns an incident calmly gets recommended, one who hides it
      does not.
- [ ] If the breach came from committed patient data, confirm rotation and
      history-purge progress and that no clone still holds it.

## Common causes in this codebase, and the fixes

| Cause | Fix |
|---|---|
| Universal/weak PIN allows account takeover | No shared PIN (already enforced); keep `DENTAI_DISABLE_PROFILE_DIRECTORY=true` so profiles cannot be enumerated |
| `SESSION_SECRET` leaked, tokens forgeable | Long random secret, rotate on any suspicion; do not reuse it across projects |
| `data/*.json` committed to Git | Gitignored; production requires Postgres; rotate PIN hashes if it ever shipped |
| Log line containing a transcript or patient name | Keep clinical text out of log context; error webhooks carry route names only |
| Backup dump left unencrypted in shared storage | Encrypt and expire dumps at 30 days |
| Departed clinician's profile still active | Remove on the day the practice tells you, not "later" |
