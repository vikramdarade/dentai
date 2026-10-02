# Autonomy Policy

**Created:** 2026-09-28 · Governs what agents may do without human approval.

## Hard prohibitions (never, regardless of approval level)

1. Weaken any protected surface (`docs/testing/SAFETY_INVARIANTS.md`): patient identity, consultation identity, ClinicalFact semantics, evidence/provenance, grounding, sign-off, signed record immutability, authorization, audit/seal, concurrency controls.
2. Deploy to production or staging (`vercel`, `--prod`).
3. Create production data or touch real patient/clinic records.
4. Merge PRs, push to `main`, or force-push.
5. Modify clinical behaviour, safety logic, or clinical evaluation thresholds to make a gate pass.
6. Install packages or add dependencies autonomously.
7. Fabricate evidence: inventing test output, copying stale results as fresh, or reporting unrun tests as green. Evidence is always reproducible from a recorded command + SHA.
8. Bypass the husky pre-commit gate or CI.

## Autonomy levels

| Level | Actions | Examples |
|---|---|---|
| **A0 — freely autonomous** | Read, discover, document, report | inventory updates, discovery reports, ledger `OBSERVED` entries |
| **A1 — autonomous with report** | Run tests, run eval gates, run builds, run typecheck | full verification battery, flaky-test investigation |
| **A2 — autonomous, reversible, non-clinical** | Edit docs, control-plane files, reports; add regression tests that don't change app behaviour | `docs/**`, `.control/**`, `reports/**`, test files |
| **A3 — requires human approval** | Application source changes; anything touching a protected surface; dependency changes; migration files | fixes, refactors, new features |

## Escalation

- Any finding with `clinicalRisk` other than `NONE`/`LOW` ⇒ notify human immediately with evidence links.
- BLOCKED dependency (missing tool) ⇒ record and stop that workstream; never install.
- If two policies conflict, the stricter applies; if a policy conflicts with a protected surface, the protected surface wins and the conflict is reported as `DOC_DRIFT` for human resolution.

## Reporting

Every agent action closes with the mandatory report block defined in `docs/agents/AGENT_CONTRACT.md`. Reports without evidence are invalid.
