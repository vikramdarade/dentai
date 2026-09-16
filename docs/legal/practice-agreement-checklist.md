# Practice agreement and DPA — onboarding checklist

You do not need a law firm to start, but you do need a signed one-pager before a
clinic's first patient record is entered. This is the minimum set; a solicitor
should review it before your fifth practice.

## What each practice must sign or acknowledge

1. **Service agreement** — the in-app terms (`#/terms`), with the practice's legal
   name, the plan, fees and the term.
2. **Data processing addendum** — the block below, signed or accepted by email.
3. **Privacy notice acknowledgement** — the practice confirms it has read
   `#/privacy` and will show the AI-assist disclosure to patients.
4. **Sub-processor list** — the table in
   `docs/legal/data-flow-and-subprocessors.md`, attached as a schedule.
5. **Authorised users** — named clinicians, and who administers the account.
6. **Support contact and hours** — what you actually offer (see the operator
   runbook). Over-promising here is the most common solo-founder mistake.

## Data processing addendum (template)

> **1. Roles.** The Practice is the entity responsible for the patient records it
> holds. DentAI processes those records on the Practice's instructions for the
> purpose of drafting clinical documentation.
>
> **2. Purpose limitation.** DentAI will process patient information only to
> provide the service, will not use it for its own purposes, will not sell it,
> and will not use it to train machine-learning models.
>
> **3. Sub-processors.** DentAI uses the sub-processors listed in Schedule A
> (attached). DentAI will give the Practice at least 14 days' notice before
> adding a sub-processor that processes patient information, and the Practice may
> object.
>
> **4. Location.** Patient information is processed in Australia by default, as
> described in Schedule A. If a processing path outside Australia is used, the
> Practice will be told.
>
> **5. Security.** Access requires an individual clinician profile, credentials
> are stored as salted hashes, sessions expire and can be revoked, failed sign-in
> attempts lock the account, and access to records is logged. DentAI will notify
> the Practice without undue delay (and within 24 hours) after becoming aware of
> a suspected or actual security incident affecting the Practice's information.
>
> **6. Access, correction, export and deletion.** DentAI will assist the Practice
> to respond to patient access and correction requests, will export the Practice's
> records on request, and will delete them on written instruction subject to the
> retention section below.
>
> **7. Retention.** Records are retained for the Practice's retention period
> (7 years by default, longer for minors) and then deleted or de-identified.
> Backup copies expire within 30 days.
>
> **8. Breach cooperation.** If a data breach is likely to result in serious
> harm, DentAI will cooperate with the Practice's assessment and any notification
> to affected individuals and the Office of the Australian Information
> Commissioner under the Notifiable Data Breaches scheme.
>
> **9. Support.** Response times are those in the plan. DentAI is a small
> provider; see the support hours stated in the service agreement.
>
> **10. Liability.** DentAI is documentation software and does not diagnose or
> prescribe. The treating practitioner reviews every draft and is responsible for
> the clinical record.

## Before the first practice goes live

- [ ] Entity name and ABN confirmed (insert in `src/components/LegalPage.tsx`).
- [ ] Professional indemnity / cyber insurance in place and the policy number
      recorded — some practices will ask for the certificate of currency.
- [ ] `DATABASE_URL` region set to Sydney; Vercel deployment region set to Sydney.
- [ ] `SESSION_SECRET`, `DENTAI_OPS_SECRET`, `CRON_SECRET` are long random values
      and stored somewhere you can retrieve them (a password manager, not Slack).
- [ ] `DENTAI_DISABLE_PROFILE_DIRECTORY=true` in production.
- [ ] Privacy notice and terms reachable from the sign-in screen (they are).
- [ ] A support email address that you actually monitor.
- [ ] One real end-to-end run with the practice's own clinician on their own
      hardware before go-live day.
