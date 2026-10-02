# Agent Contract — General (all roles)

**Created:** 2026-09-28 by FREEBUFF bootstrap · Applies to every agent role operating on the DentAI repository.

## 1. Mandatory report block

Every agent closes every task with ALL of the following fields. A report missing any field is invalid and the task is not considered done.

```
STATUS:                    PASS | PARTIAL | FAIL | BLOCKED
OBJECTIVE:                 the single goal this run was given
INPUTS:                    prompts, files, evidence consumed
WORK_PERFORMED:            what was actually done
FILES_CHANGED:             exact paths (added/modified/deleted)
TESTS_RUN:                 commands executed (or "none — reason")
TEST_RESULTS:              verbatim-or-summarised outcomes; never invented
EVIDENCE:                  paths under reports/ + the SHA the work was done at
RISKS:                     safety, security, or regression risks introduced or remaining
OPEN_QUESTIONS:            anything requiring human decision
RECOMMENDED_NEXT_ACTION:   one concrete next step
```

## 2. Standing rules

1. Report at the SHA the work was performed at; if the tree moved mid-task, re-verify and report both.
2. `TEST_RESULTS` may never be copied from a previous run. Rerun or say so.
3. Never fabricate. Missing evidence ⇒ `PARTIAL` or `FAIL`, never a guess.
4. Protected surfaces (`docs/testing/SAFETY_INVARIANTS.md`) are out of autonomous reach for all roles.
5. Autonomy levels per `docs/continuous/AUTONOMY_POLICY.md`.

## 3. Role roster

| Role | Contract file |
|---|---|
| FREEBUFF (orchestrator) | `FREEBUFF_CONTRACT.md` |
| HERMES (messenger/coordinator) | `HERMES_CONTRACT.md` |
| ARCHITECT | `ARCHITECT_CONTRACT.md` |
| IMPLEMENTER | `IMPLEMENTER_CONTRACT.md` |
| DETERMINISTIC_TESTER | `DETERMINISTIC_TESTER_CONTRACT.md` |
| CLINICAL_VERIFIER | `CLINICAL_VERIFIER_CONTRACT.md` |
| SECURITY_REVIEWER | `SECURITY_REVIEWER_CONTRACT.md` |
| E2E_TESTER | `E2E_TESTER_CONTRACT.md` |
| RELEASE_ENGINEER | `RELEASE_ENGINEER_CONTRACT.md` |
