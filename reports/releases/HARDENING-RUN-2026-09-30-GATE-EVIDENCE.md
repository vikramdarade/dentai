# DentAI — Hardening Run Gate Evidence (2026-09-30)

Every result below was produced in this working tree on branch
`fix/qle-2026-0042-api-error-json` (HEAD `bf07bb8` + uncommitted changes), on
Node v24.21.0, with the repository's own tooling from `node_modules/.bin`
(there is no Bun install in this environment, so the `package.json` scripts were
invoked through their underlying binaries with identical arguments).

## 1. Typecheck (`bun run lint` equivalent)

```
node_modules/.bin/tsc -b --noEmit
TSC_EXIT=0
```

## 2. Full unit + integration suite (`bun run test` equivalent)

```
node_modules/.bin/vitest run --fileParallelism=false --test-timeout=60000

 Test Files  66 passed | 1 skipped (67)
      Tests  1153 passed | 19 skipped (1172)
   Duration  66.69s
```

- The 1 skipped file is `tests/postgres.test.ts` (19 tests) — it self-skips
  without `DENTAI_E2E_DATABASE_URL`; **no Postgres was available in this
  environment**, so the Postgres-backed paths are NOT verified by this run.
- Among the 19 individual skips are the live-Gemini integration cases, which
  self-skip on `RESOURCE_EXHAUSTED` (the configured key has no credit). The
  end-to-end note-generation path was therefore exercised **offline** (macro
  engine / recorded fixtures), never against a live model.
- Targeted re-runs used during the work:
  - `tests/server.test.ts` → 1 file, 65 tests passed.
  - `tests/uiSafety.test.ts tests/noteJobs.test.ts tests/signOffValidation.test.ts
    tests/signOffPersistence.test.ts tests/patientIdentity.test.ts tests/date.test.ts`
    → 6 files, 85 tests passed, 1.64s.

## 3. Production build (`bun run build` equivalent)

```
node_modules/.bin/vite build
  dist/index.html                     0.80 kB │ gzip:   0.43 kB
  dist/assets/index-CZ-6ofXc.css    124.87 kB │ gzip:  18.65 kB
  dist/assets/index-i16uI6bH.js   1,006.78 kB │ gzip: 267.76 kB
  ✓ built in 381ms
  (!) chunk-size warning only (>500 kB) — pre-existing, non-blocking

node_modules/.bin/esbuild server.ts --bundle --platform=node --format=esm \
  --outfile=server.js --external:vite --external:express --external:helmet \
  --external:express-rate-limit --external:dotenv --external:@google/genai
  server.js  928.0kb   Done in 27ms
BUILD_EXIT=0
```

## 4. Clinical evaluation (`bun run eval:notes --offline --min-score 0.9`)

```
node_modules/.bin/tsx scripts/eval-notes.ts --offline --min-score 0.9
PASS  endodontic-emergency-01  score 1.000
PASS  exam-routine-01          score 1.000
PASS  perio-scale-clean-01     score 1.000
Passed 3/3 · average score 1 · safety failures 0
Clinical eval passed.   EVAL_EXIT=0
```

## 5. Clinical benchmark (`scripts/run-clinical-benchmark.ts`)

```
Cases Passing Criteria            : 20 / 20 (100.0%)
Clinical Concept Word Error Rate  : 0.00%   (target <= 3.5%)   PASS
FDI Tooth Notation Precision      : 100.00% (target >= 99.0%)  PASS
FDI Tooth Notation Recall         : 100.00% (target >= 99.0%)  PASS
Critical Pharmacology Sensitivity : 100.0%  (target = 100.0%)  PASS
Average Synthesis Latency         : 1.9ms   (target < 4000ms)  PASS
VERDICT: AHPRA & DBA CLINICAL ACCURACY STANDARDS FULLY SATISFIED.
BENCH_EXIT=0
```

Not part of the repository's CI job set; run here as additional evidence.

## 6. Gold set (`scripts/eval-gold-set.ts`)

```
Cases: 217 (17 adversarial, 5 regression)
Facts: expected 785, extracted 695
Fact P/R/F1: 56.5% / 50.1% / 53.1%
Omission 49.9% | Hallucination 43.5% | Terminology errors 41.5%
Tooth 100.0% | Surface 25.6% | Negation 66.7% | Attribution 86.5%
Temporal 99.6% | Planned/Performed 99.0% | Hist/Curr 100.0%
Diagnosis 1.1% | Medication 100.0% | Dose 100.0% | Allergy 100.0%
Evidence grounding 100.0% | Provenance errors 0.0%
Verification: inappropriate 4.9% | missed 42.9%
CRITICAL ERROR LEDGER (0 entries across 7 cases; 3.2% of cases)
Regression fixtures: ALL PASS
GOLD_EXIT=0
```

Measured against the deterministic offline extractor, which this run did not
touch. No pre-change baseline for this fixture set was recorded in the
repository, so these figures cannot be compared against a previous run here;
they are reported as observed. Not part of the CI job set.

## 7. API end-to-end flow (`scripts/phase11-e2e-flow.ts`)

```
node_modules/.bin/tsx scripts/phase11-e2e-flow.ts
  PASS: negated-procedure transcript accepted for processing
  PASS: no performed filling fact in the rendered record
  PASS: extractor yields no performed filling (statuses: negated)
  PASS: no false verification of a negated procedure
  PASS: planned restoration is not performed
  PASS: planned status preserved (planned)
  PASS: patient speculation never becomes a clinician diagnosis
  PASS: patient-voiced statements stay patient-reported
  PASS: evidence-less fact admits its state honestly (no invented evidence)
  PASS: fabricated/negative timestamps are rejected by validation
  PASS: ambiguous reference invents no tooth (teeth: none)
  PASS: no dose guessed for vague medication speech (0 medication facts)
=== RESULT: ALL CHECKS PASSED ===   E2E_EXIT=0
```

## 8. Browser smoke — UI safety badges (`scripts/phase12-ui-smoke.ts`)

Real Chromium via Playwright against a hermetic staging server (macro provider,
throwaway JSON store, synthetic data):

```
  PASS: Case A: unverified note does NOT display "Verified from Audio"
  PASS: Case C: macro/deterministic path displays "Template Applied"
  PASS: Case C: macro path does NOT claim "Verified from Audio"
  PASS: Case D: after a correction invalidates grounding, no verified badge is displayed
  PASS: Case E: incomplete note presents no signed/verified state in the UI
  PASS: Case F: sign-off refusal is displayed for an ungrounded note
  PASS: Case F: refusal carries the server code GROUNDING_NOT_APPROVED
  PASS: Case F: no signed state is presented after a refused sign-off
  PASS: Case G: the server-minted seal is displayed after successful sign-off
  PASS: Case B (schedule): fully grounded roster item shows "Verified from Audio ✓"
  PASS: Case A (schedule): unverified roster item shows the review control, not a verified badge
  PASS: Case A (schedule): verification modal states "Clinician Verification Required"
=== RESULT: ALL SMOKE CHECKS PASSED ===
```

## 9. Encounter-safety browser smoke (`scripts/phase13a-encounter-safety-smoke.ts`)

Real Chromium, two browser contexts, hermetic staging server:

```
  PASS: H1: walk-in id is collision-safe
  PASS: H1: walk-in transcript contains NO fabricated speech (§17)
  PASS: H1: unselected walk-in type uses the safe generic intake, not emergency
  PASS: H1: active patient REMAINS P1 after external walk-in injection (focus invariant)
  PASS: H1: operatory banner still names P1
  PASS: H2: ⌘→ advanced the active patient to P2
  PASS: H2: after ⌘→ (manual lock), a further external addition does not move focus
  PASS: H2: navigation order is stable
  PASS: H3: the server-minted seal is displayed after sign-off
  PASS: H3: Signed state SURVIVES reload in a fresh browser (server-persisted seal)
  PASS: H3: the signed record still presents its seal after a duplicate sign attempt
  PASS: H4: content edit to a signed record is refused 409 RECORD_SIGNED
  PASS: H4: duplicate sign-off is refused 409 REPLAY
  PASS: H4 (control): ungrounded note still refuses sign-off 422
=== RESULT: ALL ENCOUNTER-SAFETY CHECKS PASSED ===
```

Note: this smoke takes ~4 minutes (its own internal watchdog is 240s); an initial
attempt was cut off by a 300s command timeout and was re-run to completion.

## 10. Not run in this environment

| Gate | Reason |
|---|---|
| `bun run test:postgres` (Postgres suite) | no Postgres/Docker available; suite self-skips |
| `scripts/phase12-rollback-check.ts` | exits with "Set DENTAI_E2E_DATABASE_URL to a disposable database." |
| GitHub CI job conclusions | no `gh` CLI, no GitHub token |
| Vercel deployment record | no `vercel` CLI, no Vercel token |
| Live-model note generation | Gemini key depleted (`RESOURCE_EXHAUSTED`); cases self-skip |
| Direct `curl` to production | answered by the Vercel edge Security Checkpoint (429 challenge); probes were run from a real browser session instead — see `reports/releases/PRODUCTION-PROBE-2026-09-30.md` |
