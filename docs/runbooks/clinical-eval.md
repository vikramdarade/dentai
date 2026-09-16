# Clinical accuracy gate

Every note this product produces goes in front of a patient's record. Nothing else
in the system is like that: a slow page is a bad day, an invented finding is a
clinical event. This runbook covers the only automated check that stands between a
prompt/model/template change and a clinic — and, just as importantly, its limits.

## What it is

A fixed set of synthetic transcripts with known-correct expectations, scored by
`src/lib/clinicalEval.ts`:

| Piece | Where |
|---|---|
| Fixtures (transcript + intake + expectations + a recorded generation) | `tests/fixtures/clinical-eval/*.json` |
| Scorer | `src/lib/clinicalEval.ts` |
| CLI | `scripts/eval-notes.ts` (`bun run eval:notes`) |
| CI job | `.github/workflows/ci.yml` → `clinical-eval` |

Each fixture asserts four things:

- **`required`** — per field, groups of alternative keywords; every group must
  match. `"recallRequirements": [["six months", "6 months"]]` means the note must
  carry a recall interval, in either spelling.
- **`mustBePresent`** — fields that may not come back empty.
- **`forbidden`** — text that must *not* appear (for example
  `"irreversible pulpitis"` on a clean examination). This is the safety half: a
  note that invents pathology fails even if every other field is perfect.
- **`expectedCodes`** — the clinical codes a correct note could carry. A code that
  is neither expected nor in the procedure list counts as fabricated.

A fixture fails on any violation, and the run exits non-zero, which fails the
build. The intent is that a change making notes worse cannot reach a clinic.

## Running it

```bash
# What CI runs: score the recorded generations, no model calls, no API key.
bun run eval:notes --offline --min-score 0.9

# Inspect the fixtures and their per-field scores without failing.
bun run eval:notes --offline --list
```

### After changing a prompt, model or template (do this, do not skip it)

```bash
DENTAI_EVAL_BASE_URL=https://your-deployment.example \
DENTAI_EVAL_TOKEN=<a signed-in session token> \
DENTAI_EVAL_CLINIC_ID=<the clinic to generate against> \
bun run eval:notes --live --min-score 0.9
```

Live mode submits each fixture's transcript to the running deployment, waits for
the queued note, and scores what the model actually produced. Use a clinic created
for this purpose: it consumes AI allowance like any other work.

**Before a live run, check the meter.** The run spends one generation per fixture
against your own daily ceiling (`DENTAI_DAILY_NOTE_LIMIT`).

## When it fails

1. **Read the violation, not the score.** `fabricated_code` and `missing_field` are
   different problems: the first is a safety failure, the second is a prompt or
   template regression.
2. **Never lower `--min-score` to make a run pass.** The threshold is the whole
   control. If a fixture is wrong, fix the fixture and say why in the commit.
3. **Never delete a failing fixture.** Move it to `expectations.knownFailures` if
   the behaviour is accepted for now, so the gap stays visible.
4. If a live run fails and the offline run passes, the difference is the change —
   revert the prompt/model, re-run, then re-apply deliberately.

## Changing expectations

A fixture records what a *correct* note contains, so editing one is a clinical
judgement, not a test-maintenance chore:

- Keep `forbidden` strict. Adding a term there is cheap; removing one needs a
  reason recorded in the commit message.
- New fixtures should come from a real de-identified scenario wherever possible,
  described in `description` so the next reader knows what it protects.
- Record the generation you are comparing against (`recorded`) from a run you have
  reviewed by hand. A fixture whose "expected" output was never read is a test that
  asserts your own bug.

## What this gate does not do

Be honest about this with a practice, and with yourself:

- **It is not clinical validation.** Keyword groups in a JSON file cannot tell you
  whether a note is clinically sound; a clinician reading the note is still the
  only real check. The gate catches regressions and obvious fabrication, nothing
  more.
- **It is not a cohort study.** Three to a dozen synthetic fixtures is a smoke
  detector. Accuracy claims to a clinic need a reviewed sample of that clinic's own
  cases, with consent.
- **It does not cover audio quality.** Speech-to-text errors enter as transcript
  text; a mistranscribed tooth number looks like a model error. Add fixtures from
  real operatory audio (with consent) when you have them.
- **It is not a substitute for `needsReview`.** Fallback-generated notes are marked
  for review in the product; the gate assumes a clinician reviews everything.

## Review cadence

- Every prompt, model or template change: `--live` run, score recorded in the PR.
- Monthly: re-read the fixtures and delete ones that no longer reflect real
  dentistry; add one from the month's support conversations.
- Before a new clinic: run it live once and keep the output for your own file, so
  you can point at a dated score if a practice asks how you test.
