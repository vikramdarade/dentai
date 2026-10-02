# Human-Gated Defect Evidence Packs

**Run:** DENTAI — FINAL PRE-DENTIST HARDENING RUN · 2026-09-29
**Base:** `origin/main` @ `23768f87b6ed4ade81f9cf90de30496e39db7d5f`
**Verification tree:** pristine worktree `.worktrees/verify-qle-0022` (detached at `db3b035`)

> **STATUS: `HUMAN_SAFETY_REVIEW_REQUIRED` for all four defects below.**
> Nothing in this document has been implemented, committed, or deployed. All four touch
> protected clinical surfaces (patient identity, consultation identity, clinical content
> integrity, persistence of clinical information) and are therefore outside the
> autonomous release boundary. Each pack stops at "prepared".

**Current-state verification method:** static inspection of the reconciled `main` tree
(`git grep` / direct read of the handler body). None of the four has an existing automated
regression test, so a *live* behavioural reproduction is still outstanding for each — that is
recorded explicitly under RESIDUAL RISK rather than asserted away.

---

## QLE-2026-0001 — Logout destroys unsaved clinical work

**Severity:** P0 · **Clinical risk:** HIGH · **Surface:** client · **Screen:** `chairside-workspace`
**CURRENTLY REPRODUCIBLE? — UNVERIFIED in this run (code path present; see RESIDUAL RISK).**

### DEFECT
Signing out mid-consultation discards unsaved clinical work from the workspace.

### REPRODUCTION
Login as the synthetic clinician → type an observation into the chairside scratchpad → `Add` →
`Sign Out` → log in again → workspace is empty, 0 lines, and no server record exists. Ledger
records this as reproduced 2/2 by worker 1A.

### ROOT CAUSE
`src/App.tsx` `handleLogout` (line 447) clears the encounter state:

```ts
// src/App.tsx:464-469
// NOTE: the in-progress consultation (active intake + sessionStorage
// transcript) is deliberately NOT cleared here — logging out mid-consult must
// never destroy unsaved clinical work. On the next login the intake is
// restored and the recording resumes with its full transcript.
setConsultations([]);
setSelectedConsultation(null);
```

The comment asserts preservation, but the two statements immediately beneath it clear
`consultations` (which is what carries the chair-active scratchpad). The preservation claim is
therefore **partially implemented at best**: the active intake and the `sessionStorage` transcript
are intended to survive, while the typed scratchpad lines living in `consultations` are not
covered by that claim. The contradiction between the comment and the code is the defect signal —
either the comment is wrong or the two setters should not be unconditional.

### PROPOSED FIX (NOT IMPLEMENTED)
Persist the chair-active scratchpad before `setConsultations([])` runs, and rehydrate it on next
login — e.g. flush `consultations` (or only the `chair-active` record) to `sessionStorage`/server
as part of logout, and restore it on authentication. Alternative: make the preservation explicit
by clearing only non-chair-active records. The correct choice depends on whether the scratchpad is
considered clinical content that must be durable — a product decision, not an engineering one.

### FILES CHANGED
**None.** No code was modified.

### TESTS
No existing test covers this. A regression test would need a browser E2E: *logout mid-consult →
re-login → the scratchpad content is present*. None was added (adding it would encode a product
decision that has not been made).

### SAFETY IMPACT
Silent clinical data loss on a routine action. It directly contradicts the product's own stated
safety intent comment in the same function, which means the code's own documentation cannot be
trusted as a safety guarantee.

### RESIDUAL RISK
Reproduced by the discovery worker at the discovery SHA. The handler *has since gained* a
preservation comment, so the precise present-day blast radius (which exact content survives —
intake and transcript vs scratchpad lines) is **not** established from the static read alone.
It must be re-reproduced live before the fix is designed.

### EXACT HUMAN DECISION REQUIRED
**Is the in-progress consultation clinical content that must survive logout, or may it be
discarded with an explicit warning?** If it must survive: confirm that persisting the chair-active
scratchpad to durable storage on logout is acceptable (it writes partially-composed clinical
content to the record store), or choose explicit user-visible discard semantics instead.

---

## QLE-2026-0002 — History Hub reopen can land on the wrong patient surface

**Severity:** P0 (per this run's instruction: treat as P0 until disproven) · **Clinical risk:** HIGH
**Surface:** client · **Screen:** `chairside-workspace` · **Journey:** `J9 history-reopen`
**CURRENTLY REPRODUCIBLE? — UNVERIFIED in this run (code path present; see RESIDUAL RISK).**

### DEFECT
Clicking a record in History Hub can leave the workspace focused on the `In-Chair Patient`
scratchpad rather than the record that was clicked — a *wrong-patient surface* class, which per
the safety invariants "must never occur".

### REPRODUCTION
With a consultation for a named patient present on the server for today: `Tools → Past Patient
Records → click the row` → the banner shows `In-Chair Patient` with an empty note. Ledger records
this as reproduced 2/2 by worker 1A.

### ROOT CAUSE
`src/components/ChairsideWorkspace.tsx:435-461` — `encountersForDate` filters the roster through a
four-way date heuristic and **silently drops anything that matches none of them**:

```ts
// src/components/ChairsideWorkspace.tsx:438-449
.filter(p => {
  const orig = consultations.find(c => c.id === p.id);
  if (!orig?.date) return false;
  const d = orig.date.trim();
  if (d === currentDateStr || d === shortDate || d.startsWith(shortDate) || d === fullDate) return true;
  try {
    const formattedOrig = formatClinicDate(d, { month: 'short', day: 'numeric' });
    if (formattedOrig === shortDate) return true;
  } catch {}
  return false;              // ← silent drop, no signal
})
```

A record whose stored `date` matches none of the accepted shapes is filtered out of the roster.
The neighbouring self-healing focus gate (lines 497-576) then finds `activePatientId` absent from
`encountersForDate` and falls back — landing the clinician on the scratchpad instead of the patient
they selected, with **no error surfaced**.

### PROPOSED FIX (NOT IMPLEMENTED)
Two independent halves, both needed:
1. **Normalize `date` to a single canonical form (ISO) at the persistence boundary**, so the
   heuristic has nothing to guess about.
2. **Make the match fail-loud**: a record that cannot be matched to the current clinic day must
   surface a visible, non-silent signal, never be dropped from the roster that drives focus.

### FILES CHANGED
**None.** No code was modified.

### TESTS
No existing test covers History Hub reopen. The closest harness
(`scripts/phase13a-encounter-safety-smoke.ts`) covers the focus invariant under external walk-in
injection (H1) and keyboard selection (H2), **but not** the History Hub reopen path. A regression
test should assert: a server record carrying a non-ISO date still appears in the roster, and
reopening it selects the clicked patient.

### SAFETY IMPACT
Wrong-patient surface. The clinician believes they are viewing the patient they selected. In
isolation this is a display/focus defect, but combined with any write path it becomes a
mis-attribution risk on the clinical record.

### RESIDUAL RISK
The heuristic is confirmed present verbatim in `main`. Whether it still *lands the clinician on the
wrong patient* has not been re-reproduced — substantial focus-gate work landed in Phase 13A
(lines 497-576, plus the "self-healing focus gate" behaviour), so the *consequence* may have been
narrowed even though the *root cause* survives. **Must be re-reproduced live before the fix is
designed.** Do not treat this pack as proof that the wrong-patient outcome currently occurs.

### EXACT HUMAN DECISION REQUIRED
**Confirm the intended behaviour when a stored record's date cannot be matched to the clinic day.**
Options: (a) normalise dates and always show the record (recommended — removes the silent drop
entirely), or (b) show the record plus an explicit "date unverified — confirm this patient"
banner. Option (b) changes visible clinical workflow and needs product sign-off.

---

## QLE-2026-0014 — Empty consultation body can create a blank consultation

**Severity:** P2 · **Clinical risk:** MODERATE · **Surface:** server
**API:** `POST /api/consultations` · **CURRENTLY REPRODUCIBLE? — code path CONFIRMED PRESENT.**

### DEFECT
`POST /api/consultations` accepts an empty body and creates a durable record.

### REPRODUCTION
`POST /api/consultations {}` → `201` with a durable record, `consent.obtainedAt: ''`, no transcript.
Ledger records this as reproduced across both 1E passes at the discovery SHA.

### ROOT CAUSE
`server.ts:3666` — the create route validates only the *type* of the body, never the *clinical
required fields*:

```ts
// server.ts:3666-3673
app.post('/api/consultations', authenticateToken, async (req: any, res) => {
  try {
    const consultation = req.body;
    if (!consultation || typeof consultation !== 'object') {
      return res.status(400).json({ error: 'Invalid consultation payload.' });
    }
```

`{}` is a valid object, so it passes. The record is then minted at line 3678
(`id: consultation.id || crypto.randomUUID()`) and persisted at lines 3737-3749. There is no
required-field gate anywhere on the create path.

### PROPOSED FIX (NOT IMPLEMENTED)
Add creation-side required-field validation matching the documented clinical contract, returning
`400` with a machine-readable `code`. **The exact required-field set is a clinical decision** —
this is why the defect is gated rather than fixed.

### FILES CHANGED
**None.** No code was modified.

### TESTS
Ledger's proposed regression test: `POST /api/consultations` with an empty body → `400`. Not added.
Note that tightening create-side validation can break existing callers that legitimately create a
record before content exists (the daysheet-import and chairside quick-start paths), so the test must
be written together with the chosen field set.

### SAFETY IMPACT
Bounded. The **sign gate refuses the resulting blank record downstream** (`422 EMPTY_NOTE`,
`422 GROUNDING_NOT_APPROVED`), and this was re-confirmed live in this run by the browser smoke
(Case E: an incomplete note presents no signed/verified state; Case F: refusal carries
`GROUNDING_NOT_APPROVED`). So no unsafe sign-off path was demonstrated. The exposure is
accumulation of blank, blank-consent records, with the downstream gates as the only defence.

### RESIDUAL RISK
If the above downstream gates ever regress, this permissive create path becomes the enabling
condition for a blank-but-signable record. The two defects should be treated as a pair.

### EXACT HUMAN DECISION REQUIRED
**Which fields are required to create a consultation record?** Specifically: may a consultation
exist before any content is dictated (required for the daysheet / quick-start flows), and if so,
what minimum fields (patient identity? clinician? clinic? consent state?) must be present at
creation? Approve the field set; the validation is then a small, safe change.

---

## QLE-2026-0015 — Client ID collision causes silent overwrite

**Severity:** P1 · **Clinical risk:** MODERATE · **Surface:** server
**API:** `POST /api/consultations` · **CURRENTLY REPRODUCIBLE? — code path CONFIRMED PRESENT.**

### DEFECT
A duplicate `POST /api/consultations` carrying an already-existing id **silently replaces** the
stored record and answers `201`. The two storage modes disagree about what happens on collision.

### REPRODUCTION
Create a consultation, then re-`POST` with the same client-supplied `id` → the stored record is
replaced and the response is `201` with no conflict signal. Ledger recorded this against the JSON
path at `server.ts:3744-3751`.

### ROOT CAUSE
`server.ts:3740-3747` — the JSON store path is an unchecked upsert:

```ts
// server.ts:3740-3747
} else {
  const consultationsData = await readConsultationsDb();
  const existingIdx = consultationsData.consultations.findIndex((c: any) => c.id === newConsultation.id);
  if (existingIdx !== -1) {
    consultationsData.consultations[existingIdx] = newConsultation;   // ← silent replacement
  } else {
    consultationsData.consultations.unshift(newConsultation);
  }
  await writeConsultationsDb(consultationsData);
}
```

There is no version, ownership, or existence conflict check. The Postgres branch (`dbInsertConsultation`,
line 3737) is reported to ignore the duplicate instead — so the same request produces *different*
clinical outcomes depending on which store is active. Client callers mint collision-prone ids
(`sched-` / `chairside-` / `consult-<Date.now()>`); the walk-in path already uses collision-safe
UUIDs, so the fix pattern already exists in the codebase.

### PROPOSED FIX (NOT IMPLEMENTED)
Make collision behaviour uniform across both stores and **fail loud**: either return `409` on an
id collision for an existing record, or converge to an explicit upsert with a version check —
whichever is chosen, JSON and Postgres must agree. Separately, migrate client id minting to UUIDs
(the walk-in path is the existing precedent).

### FILES CHANGED
**None.** No code was modified.

### TESTS
Ledger's proposed regression test: two near-simultaneous creates with a colliding id on the JSON
fallback → assert no silent overwrite. Not added. Note `vitest.config.ts` never parallelises files
because suites share JSON fixtures, so a genuinely *concurrent* test needs care.

### SAFETY IMPACT
Silent replacement of an existing clinical record, reported to the client as success (`201`) —
data loss disguised as a successful write. This is the "persistence of clinical information"
protected surface.

### RESIDUAL RISK
Changing the JSON path from upsert to `409` will surface latent collisions that are currently
silent. That is the intent, but it means the change can expose (and must not corrupt) previously
overwritten records. Roll-out needs the collision rate understood first.

### EXACT HUMAN DECISION REQUIRED
**On an id collision against an existing consultation, should the server refuse (`409`) or
converge as an explicit versioned upsert?** Refusal is safer and is recommended; it changes
behaviour for any caller that currently relies on replace-by-id, so the product owner must accept
that.

---

## Evidence-required findings (gathered, NOT yet implementation-ready)

These were flagged as "confirmed but insufficient evidence for autonomous implementation". Static
confirmation of the code paths was completed in this run; **behavioural** evidence is still
missing, which is what blocks autonomous implementation.

| ID | Finding | Current-state evidence gathered | Still missing |
|---|---|---|---|
| **QLE-2026-0016** | `POST /api/patients` accepts a malformed `dob` and silently drops a submitted `dateOfBirth` (alias never read). | **Present.** `src/server/patientRoutes.ts` reads only `req.body?.dob` (lines 199, 264); no `dateOfBirth` handling and no DOB format validation anywhere in the route. | A behavioural probe against a disposable store: malformed `dob` → currently `201`; `dateOfBirth` → currently dropped. Patient identity surface → gated. |
| **QLE-2026-0017** | Usage is metered twice when job dedupe collapses two submissions to one job. | **Partially present.** Dedupe is at the storage layer (`server.ts:2032-2038`, `!duplicate` guard) and quota is checked at submit (`server.ts:1988-1997`); the exact double-increment path is **not** visible from the submit handler alone — it depends on the job-processing path (`recordUsageEvent`, line 1759) and the `usageSnapshotFor` accounting. | A deterministic two-request probe with a converging UUID id asserting exactly one usage increment. Do **not** implement from the static read. |
| **QLE-2026-0017 sibling QLE-0006** | Duplicate jobs / duplicate durable consultations for **non-UUID** consultation ids (P1 / HIGH). | **Present.** `server.ts:2004-2008`: `id: isUuid(consultationId) ? consultationId : crypto.randomUUID()` — a non-UUID id gets a fresh random job id per call, so the dedupe guard can never fire. | Behavioural confirmation that the real chairside path (`consult-<ts>`, `chair-active`) persists non-UUID ids, establishing reachability. |
| **QLE-2026-0026** | `POST /api/patients/resolve` auto-matches on phone alone when the stored chart has no DOB, treating a conflicting caller-supplied DOB as agreement. | **Needs its own read** of the resolve route; ledger confidence is the lowest of the set (0.75) and the owner is `CLINICAL_VERIFIER`, not an implementer. | A CLINICAL_VERIFIER judgement on whether phone-only auto-match is acceptable, plus the conflicting-DOB probe. **This is a clinical-policy question before it is an engineering one.** |

---

## Workspace integrity finding (affects every gate, not a product defect)

The working tree at run start contained **197 untracked files** across `.control/`, `docs/agents/`,
`docs/continuous/`, `docs/testing/` and `reports/` — including **167 files under `reports/`** and a
scratch test file at `reports/discovery/workers/1D-clinical-safety/evidence2/fact-attacks.test.ts`.

Consequences, both verified in this run:

1. **Local `tsc -b --noEmit` fails on the working tree** — but only because `tsconfig.json` declares
   no `include`/`exclude`, so TypeScript compiles that untracked scratch file. The *tracked* project
   typechecks cleanly (`TSC_EXIT=0` in a pristine worktree). **CI is unaffected** (fresh clone never
   sees `reports/`).
2. **Vitest's default include glob also matches that scratch file**, so running the full suite in the
   working tree would execute untracked scratch code and produce misleading results.

All gate evidence in this run was therefore produced in a **pristine worktree**
(`.worktrees/verify-qle-0022`, detached at `db3b035`, no `reports/`), which is exactly what CI sees.

**This scaffolding was not deleted, committed, or modified.** It appears to be the partially-built
Continuous Engineering Control Plane that this run was explicitly told *not* to build. Deciding its
fate is a human call — but until it is resolved, local typecheck and local full-suite runs in the
main working tree are **not trustworthy**.
