# DentAI — Gold-Set Specification (Phase 8)

**Corpus version:** `v2.0.0-phase8` (constant `GOLD_SET_VERSION`)
**Source module:** `src/lib/clinicalEvaluation/goldSet.ts`
**Runner:** `npm run eval:gold-set` (`scripts/eval-gold-set.ts`) · Test gate: `tests/goldSetEvaluation.test.ts`

---

## 1. Provenance (exit criterion 2)

Every case in this corpus is **fully synthetic**.

- Transcripts are authored clinical dialogue written for this corpus. No real
  consultation audio, no real patient records, and no content derived from
  either is included.
- Expected facts are authored **from** those transcripts by construction:
  every `ExpectedClinicalFact` carries `expectedEvidenceKeywords` that are
  quoted substrings of its own case transcript. This invariant is enforced by
  the test `every expected fact is grounded in its transcript (no invented
  gold)` — the corpus cannot contain an invented gold fact.
- No patient-identifiable content exists anywhere in the corpus (no names,
  DOBs, addresses, record numbers). The runner asserts the formatted summary
  is free of probe name strings.
- The corpus is seeded and deterministic: `mulberry32(0xD3E7A1)` for variation
  expansion. Two builds are **byte-identical** — asserted in tests.

## 2. Corpus structure

| Segment | Count | Purpose |
|---|---|---|
| Representative | 21 authored + seeded variations → 195 | Domain coverage |
| Adversarial | 17 cases covering 23 categories | Safety-relevant linguistic hazards |
| Regression | 5 permanent fixtures | Shipped-phase defect locks |
| **Total** | **217** | Exceeds the 200–500 target |

### 2.1 Representative domains (21)

`routine_examination`, `emergency`, `restorative`, `endodontic`, `periodontal`,
`prosthodontic`, `oral_surgery`, `implant`, `paediatric` (primary dentition,
FDI 54), `orthodontic`, `hygiene_preventive`, `referral`, `recall`,
`medical_history`, `medications`, `allergies`, `consent`, `treatment_plans`,
`declined_treatment`, `historical_treatment`, `postoperative_instructions`.

### 2.2 Adversarial categories (23, tagged per case)

`negation`, `double_negation`, `patient_speculation`, `patient_questions`,
`clinician_questions`, `indirect_speech`, `historical_events`, `future_plans`,
`cancelled_treatment`, `declined_treatment`, `performed_elsewhere`,
`ambiguous_tooth_numbers`, `similar_sounding_teeth`, `fdi_vs_nonfdi`,
`surface_ambiguity`, `dose_ambiguity`, `multiple_speakers`,
`overlapping_dialogue`, `background_speech`, `corrections_mid_sentence`,
`self_corrections`, `contradictory_statements`, `low_asr_confidence`.

Tag coverage is asserted in tests (the suite fails if a category loses
coverage).

### 2.3 Regression fixtures (5)

| Fixture | Locks |
|---|---|
| `phase5-negated-treatment-status` | "No filling was placed on 36 today" ≠ performed |
| `phase5-planned-vs-performed` | "We will restore 36 next visit" stays planned |
| `phase5-patient-vs-clinician-attribution` | "My tooth feels loose" never becomes clinician-observed |
| `phase7-macro-default-injection` | Unspoken Articaine/2.2 mL/shade A3 never appear |
| `phase5-empty-note-false-grounding` | Empty claims never report as grounded |

All regression fixtures must pass (`Regression fixtures: ALL PASS`); a
failure fails the evaluation and the test suite.

## 3. Seeded variation engine

Expansion to target size varies only the five domain templates whose content
is safely parameterisable, under these rules:

- **Tooth pool** is posterior permanent teeth only (14–17, 24–27, 34–37,
  44–47): anterior teeth have no occlusal surface, and the paediatric template
  must not vary dentition.
- **Surface substitution** applies only to templates whose transcripts contain
  surface vocabulary (`POSTERIOR_SURFACE_TEMPLATES` allow-list: gold-0003,
  gold-0004). Other templates get tooth variation only — never invented
  surfaces.
- Whole-word, boundary-checked substitution only; expected facts
  (teeth/surfaces/evidence keywords) are re-derived from the varied
  transcript so gold and transcript can never drift apart.
- **IDs are stateless**: variation IDs are `gold-var-<corpusBase + i + 1>`
  where `corpusBase` derives from the authored array lengths — never from
  module-level mutable counters. Builds are byte-identical (test-enforced).
- Variations never introduce new clinical semantics; tags carry
  `seeded_variation`.

## 4. Authoring invariants (enforced by tests)

1. Every expected fact cites transcript evidence keywords (no invented gold).
2. All 21 domains and all 23 adversarial tags retain coverage.
3. Every adversarial case has `isAdversarial: true` and `difficulty: 'adversarial'`.
4. Expansion is byte-identical across builds (determinism).
5. Full corpus ≥ 200 cases with ≥ 5 regression fixtures.

## 5. Running and reproducing

```bash
npm run eval:gold-set     # full report + critical ledger, exits non-zero on regression failure
npx vitest run tests/goldSetEvaluation.test.ts   # corpus invariants + reproducibility gates
```

The runner takes a target-size argument in code (`runGoldSetEvaluation(200)`)
and emits: aggregate metrics, per-case results, the **critical error ledger**,
regression failures, verification-rate measurements, and a PHI-free summary.

## 6. Extension policy (regression policy)

- **Never delete** a case because it lowers aggregate metrics. Difficult
  cases are the corpus's value.
- Every production defect that reaches clinical evaluation must become a
  permanent regression fixture with a `regressionFor` marker naming the defect.
- New domains/categories extend the constants in the test suite; the suite
  fails if coverage regresses.
- Case IDs are append-only; renumbering breaks reproducibility guarantees and
  is forbidden.
