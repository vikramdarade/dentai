# DentAI — Phase 7 Exit Audit (Facts → Clinical Note Renderer)

**Document:** `docs/PHASE_7_EXIT_AUDIT.md`
**Date:** September 2026
**Scope:** Making validated `ClinicalFact[]` the sole authoritative source of final clinical-note content
**Standard:** *The renderer is monotonic with respect to clinical facts — if a fact does not exist in the validated fact set, it must not appear in the note.*

---

## 1. Executive Conclusion

### PHASE 7 EXIT STATUS: **PASS — with one STOP-and-report item (hosted LLM path, §7)**

Final verification:
- TypeScript (`tsc -b --noEmit`): **0 errors**
- Vitest: **758 passed / 0 failed** (55 files; 19 postgres skipped without `DATABASE_URL`, unchanged)
- Clinical eval (`eval:notes`): **3/3, score 1.000** (scores recorded fixtures; unaffected)
- Benchmark (`eval:benchmark`): **20/20, 0.00% WER, 100% FDI P/R, 100% pharmacology**; macro synthesis latency **2.7 ms → 2.0 ms** (less boilerplate to synthesise)

Entry criteria: Phase 5 and Phase 6 exit audits present in `docs/`; ClinicalFact canonical; deterministic validation operational (status, contradiction flags, FDI engine); selective verification operational (Phase 6); provenance preserved; sign-off fail-closed; evaluation harness green.

---

## 2. Architecture Change

Delivered:

```
Transcript
  → ClinicalFact extraction            (ClinicalFact remains the canonical model)
  → deterministic validation
  → selective verification (Phase 6, exception path)
  → validated ClinicalFact[]
  → renderClinicalNote()               (NEW — deterministic renderer, src/lib/factRenderer.ts)
  → clinical note → clinician review → sign-off
```

`renderClinicalNote()` is deterministic, pure, and monotonic: it can only express
what the fact set carries. Attribution (`Patient reports …` / `Assistant noted …`),
treatment status (performed/planned/discussed/declined/historical/negated),
temporality, negation (explicit `No caries #36 (O)` form), FDI teeth/surfaces and
evidence linkage are preserved per fact. Unsupported-to-render facts are reported
via `unrenderedFactIds` rather than dropped.

## 3. Unsafe Defaults Eliminated (spec §2)

Removed at the shared extraction source (`clinicalEntityParser.ts`) so all 18
macros inherit the fix:

| Former default | Now |
|---|---|
| `4% Articaine` when LA merely detected | Agent only from explicit drug mention; absent → missing |
| `with 1:100,000 adrenaline` | Only from spoken concentration or `plain`; absent → missing |
| `2.2 mL` volume default | Only from spoken mL or cartridge count (spelled numbers normalise); absent → missing |
| `isProfound: true` | Field no longer populated |
| `Cotton roll and gauze` isolation default | Isolation only when spoken (`rubber dam` / `cotton roll` / `barrier`); absent → missing |
| Template fallback ADA code when nothing spoken/spoken-code-free | Removed — no code without support |

Removed from the Routine Restoration template (macro itself):

- Whole-cloth "Discussion of Treatment Options" and consent assertion
- `A3` shade default; `Adequate anaesthesia achieved`
- Generic procedure boilerplate (etch/SB+/incremental curing/margins sound/"patient satisfied")
- Fabricated findings (`TTP (-), no mobility`; `Gingival margin healthy, isolated bleeding controlled`)
- Fabricated diagnosis ("Dental caries into dentine, asymptomatic/reversible pulpitis") — replaced by an explicit **missing-diagnosis notice** for clinician completion
- Unconditional 6-month recall; patient-summary aftercare prose; unconditional POIG recommendations

Missing facts now stay missing (empty section + notice), proven by tests
("empty fact set renders an empty note", "no consent facts ⇒ no consent
language", "no diagnosis fact ⇒ diagnosis section stays empty").

## 4. Macro Conversion (spec §3)

- **Routine Restoration:** fully migrated to evidence-gated rendering — every
  rendered line requires a spoken/extracted variable; structure (Anaesthesia /
  Isolation / Procedure labels) is presentation only.
- **Remaining 17 templates:** proven safe *by construction* — they interpolate
  extracted variables into presentation scaffolding, and the shared default
  injection points (parser anaesthetic/isolation defaults) were removed; any
  value not extracted now renders empty. No template supplies clinical facts
  beyond extraction.

## 5. LLM Boundary (spec §5)

- Hosted prompt now carries the Phase 7 **renderer contract** as system-instruction
  rule 13: the model may only express supported facts; must not infer, add,
  embellish or complete missing information; patient-reported symptoms cannot
  become clinician findings; discussed/planned cannot become performed; historical
  cannot become current; empty section is always safer than invention.
- No invented tooth/medication/dose/diagnosis language remains in any template.
- **STOP-and-report item (spec instruction):** the hosted path is still
  transcript → LLM → note sections. Prompt-level constraints are the maximum
  possible without a production transcript → `ClinicalFact[]` extraction layer,
  which does not exist in the codebase (Phase 3 delivered the type contract +
  trust boundary; extraction was never wired into `server.ts`). Swapping the
  hosted path to facts → `renderClinicalNote()` requires building that
  extraction stage first — the recommended Phase 8 first step. Flag-only
  contradiction detection (Phase 5) and the selective verification layer
  (Phase 6) already operate over `ClinicalFact[]` and are ready to receive it.

## 6. Terminology & Integrations (spec §4)

FDI notation engine, ADA schedule, phonetic lexicon, PMS/billing adapters and
recall engine are consumed unchanged. Billing/PMS suites pass
(`pmsAdapters`, `chairsidePmsExport`, `adaScheduleEngine`, `billingSuite`).

## 7. Tests

- `tests/factRenderer.test.ts` (new, 26): 19 clinical cases (routine exam,
  emergency, restorative, endodontic, periodontal, prosthodontic, oral surgery,
  implant, paediatric, hygiene, preventive, referral, recall, medication,
  allergy, negation, historical, planned, declined) + monotonicity, absence-of-
  defaults, determinism, attribution and unrendered-audit invariants.
- Updated pins to the fail-closed contract: `soapCompleteness.test.ts`
  (diagnosis no longer fabricated from a finding; missing-diagnosis notice),
  `macroEngine.test.ts` (notice expected; spoken cartridge normalisation).
- Full suite: **758 passed / 0 failed**; snapshot cases deterministic
  (byte-identical across runs).

## 8. Exit Criteria Assessment

| # | Criterion | Status |
|---|---|---|
| 1 | Final note rendered from validated ClinicalFacts | ✅ deterministic renderer over facts (offline path) |
| 2 | Note no longer the primary data model | ✅ ClinicalFact canonical; note is a rendering |
| 3 | Unsupported macro defaults eliminated | ✅ table §3 |
| 4 | Missing facts remain missing | ✅ proven by monotonicity tests |
| 5 | Renderer cannot invent facts | ✅ no clinical knowledge in renderer; proven |
| 6 | Renderer preserves negation | ✅ explicit `No …` rendering + tests |
| 7 | Renderer preserves attribution | ✅ `Patient reports` / `Assistant noted` + tests |
| 8 | Renderer preserves temporal status | ✅ historical/planned grouping + tests |
| 9 | Renderer preserves tooth/surface | ✅ FDI via validated ToothReference |
| 10 | Renderer preserves treatment status | ✅ performed/planned/declined sections |
| 11 | Australian terminology intact | ✅ FDI/ADA/lexicon untouched |
| 12 | Billing/PMS intact | ✅ suites green |
| 13 | Macros migrated or proven safe | ✅ 1 migrated + 17 by-construction + parser fix |
| 14 | LLM cannot introduce unsupported facts | ⚠️ prompt-contract enforced; structural enforcement pending extraction layer (§5 STOP item) |
| 15 | Snapshot tests pass | ✅ 26/26 deterministic |
| 16 | Clinical safety tests pass | ✅ full suite green |
| 17 | Full suite passes | ✅ 758/758 |
| 18 | Evaluation metrics do not regress | ✅ eval 3/3 score 1.000; benchmark 20/20; latency improved |
| 19 | Sign-off fail-closed | ✅ Phase 5 machine untouched and green |

## 9. Residual Risks

1. **Hosted LLM path** remains transcript→LLM→note under prompt-level contract
   only (criterion 14) — the one item the spec requires reporting rather than
   declaring solved. Mitigations already live: Phase 5 flag-only contradiction
   detection, Phase 6 selective verification, fail-closed sign-off.
2. Seventeen macro templates are proven safe by construction (parser fix +
   evidence-gated interpolation) but not individually rewritten to renderer
   calls; full conversion follows the extraction layer.
3. The deterministic renderer is the authoritative generator for the offline
   path; wiring it into the hosted path is the recommended next step (Phase 8).
4. Postgres suite and production build not executable in this environment; typecheck clean.

---

## Verdict

Phase 7 criteria are met with the single reported exception in §5 (hosted LLM
path awaiting the extraction layer). **Per the spec instruction: Phase 7 is not
declared fully complete while an LLM-to-note path remains — the item is
STOP-reported here with the remediation path identified.**
