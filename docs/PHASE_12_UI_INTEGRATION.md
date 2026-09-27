# Phase 12 — UI Integration of Canonical ClinicalFact Architecture

**Verdict: `UI_INTEGRATION_COMPLETE`** (see §10)

---

## 1. Starting state

Already implemented, deployed and verified before Phase 12 (not repeated here, per Phase 12J):

- Vercel deployment, GitHub integration, PostgreSQL + migrations, durable jobs/workers.
- Server-authoritative clinical core: record governance middleware (client-supplied `groundingAudit`, `groundingReport`, `facts`, `recordVersion`, `revisions`, `identityNeedsReview` are **stripped** from every write), server-recomputed unified grounding audit on every consultation create/update, optimistic concurrency (409 `STALE_WRITE` with the server's copy), and the sign-off revalidation endpoint `POST /api/consultations/:id/sign` (409 `STALE_VERSION`/`REPLAY`, 422 `GROUNDING_NOT_APPROVED`/`VERIFICATION_BLOCKING_STATE`/`CONSENT_MISSING`/`EMPTY_NOTE`, server-minted `AttestationSeal`).
- Canonical ClinicalFact pipeline, selective verification, deterministic renderer — lab-verified by the 132-file test estate, gold-set gate and Phase 11 E2E.

What Phase 12 found missing: **no UI surface consumed any of it.** No component called the sign endpoint; the canvas badge derived from a hand-rolled inline condition plus a stale `noteOrigin` fallback; the PMS adapter accepted a client-supplied `grounding` report; the day-schedule queue recomputed grounding client-side. The UI was silent about verification rather than wrong about it — but it was not a consumer.

## 2. Integration map

| UI surface (old model) | New canonical API/model (consumed) |
|---|---|
| Canvas badge: inline condition + legacy `noteOrigin` fallback in `ChairsideWorkspace` | `deriveGroundingBadge(record, isMacroEngine)` → `groundingAudit.isApprovedForSigning === true` (server-recomputed on every write) |
| Editor badge prop (`groundingBadge` string) | Same helper; rendered verbatim by `ClinicalNoteEditorPanel` |
| No facts/evidence display | `serverConsultation.facts` → `deriveFactsForDisplay` → facts/evidence strip (verificationState, status, temporality, speaker, evidence-span counts, verbatim) |
| No sign-off UI | `requestSignOff` → `POST /api/consultations/:id/sign` → server seal displayed verbatim; refusal code + message displayed verbatim |
| Save path: whole-record PUT, no version | PUT carries `expectedVersion` from the record the edit was based on; 409 → visible conflict banner, server record reconciled into state, clinician's on-screen edits preserved |
| `DayScheduleQueue`: client-side `verifyTranscriptGrounding` recompute | Server `groundingReport` only; absence stays fail-closed (`isFullyGrounded ?? false`) |
| `toPmsEncounter`: `groundingAudit…\|\| (grounding?.isFullyGrounded ? 'Verified from Audio' : undefined)` | `groundingAudit?.alignment.statusBadge` only — client-supplied grounding can no longer mint a verified PMS line |

Canonical direction is `server record → UI display`; the only client→server clinical operations remain the existing save/correct/sign APIs. Legacy `ClinicalFindings` consumers (SOAP projection, PMS export, schedule display) are untouched **display compatibility** — no new business logic was added around them.

## 3. Files changed

| File | Change | Reason |
|---|---|---|
| `src/lib/uiVerification.ts` (new) | Fail-closed derivation helpers: `deriveGroundingBadge`, `deriveSignOffState`, `deriveFactsForDisplay` | One consumer-side projection of server state; eliminates ad-hoc badge logic |
| `src/lib/signOffClient.ts` (new) | `requestSignOff` transport to `/sign`; no local validation; never constructs a seal | 12E: client requests, server decides |
| `src/components/ChairsideWorkspace.tsx` | Badge via `deriveGroundingBadge`; sign-off state + `handleSignOffActiveNote`; `serverConsultation`/`recordVersion`/seal/refusal props to the editor; `noteOrigin` no longer inherits a stale legacy engine (hosted payload must stamp its own engine; `needsReview: true` always) | 12B + 12E; the old fallback let a legacy record's engine label gate the macro badge |
| `src/components/ClinicalNoteEditorPanel.tsx` | Facts/evidence strip (verbatim server verification states); sign-off section (server seal display, refusal display with `data-code`, stale-version current-version display) | 12C + 12E |
| `src/App.tsx` | PUT sends `expectedVersion`; 409 → visible `stale-write-conflict` banner, server record reconciled, clinician edits preserved; response record (with server `recordVersion`, recomputed audit) replaces the optimistic copy | 12F: no silent overwrite in either direction |
| `src/components/DayScheduleQueue.tsx` | Removed client-side `verifyTranscriptGrounding` recompute + import | 12D: consume server verdict only |
| `src/lib/pms/canonical.ts` | `groundingBadge` from `groundingAudit` only | 12A: close the client-supplied `grounding` bypass |
| `src/types.ts` | `Consultation.facts?: ReadonlyArray<ClinicalFact>`, `Consultation.recordVersion?: number` | Type the server contract the UI consumes |
| `tests/uiSafety.test.ts` (new) | 15 safety tests (§5) | 12H |
| `scripts/phase12-ui-smoke.ts` | Cases F (refusal) + G (seal) added; seed consent upgraded to the canonical object (the sign gate correctly refuses the bare legacy boolean) | 12I |

## 4. Clinical safety invariants preserved

- **The UI is a consumer, not an authority.** It displays server-derived `groundingAudit`, `facts`, seal and refusal payloads. It manufactures nothing.
- **"Verified from Audio" is fail-closed:** requires `groundingAudit.isApprovedForSigning === true`, which only the server recomputation can assert (client-supplied audits are stripped server-side and ignored client-side).
- **Stale approval cannot survive edits:** every server write recomputes the audit and returns it; App.tsx replaces the optimistic copy with the response record; the badge is re-derived from it (Test 4/5, smoke Case D).
- **Sign-off is server-authoritative:** refusal codes/messages are displayed verbatim; the seal is displayed only from the server's response; a locally cached seal is never proof (state resets are record-scoped; the server refuses replays).
- **Macro output can never appear verified:** `Template Applied` short-circuits even a maximally approving audit (Test 10, smoke Case C).
- **Stale writes cannot silently overwrite:** 409 carries the server's record and version; the UI shows a visible conflict and keeps the clinician's on-screen edits.
- No canonical model, taxonomy, grounding, sign-off authorization, seal, or audit-chain semantics were modified. The Clinical Safety Freeze was never triggered; no conflict needed escalation.

## 5. Tests added

`tests/uiSafety.test.ts` — T1 missing grounding → no verified badge · T2 `isApprovedForSigning=false` → none · T3 approved → badge shown · T4/T5 correction + server recomputation → stale badge gone · T10 macro → `Template Applied`, never verified · facts strip is a verbatim projection (`data-verification-state`) · T7 success → signed state only from server response · T6 refusal surfaced verbatim · T8 replay code verbatim · T9 (transport) stale refusal carries `currentVersion` · server gates: 422 `GROUNDING_NOT_APPROVED`, 409 `STALE_VERSION` with server version, 200 + server-minted seal, nonce replay → 409 `REPLAY`, stale PUT → 409 `STALE_WRITE` and content unchanged.

## 6. Test results (exact)

| Gate | Result |
|---|---|
| TypeScript (`tsc -b --noEmit`) | **0 errors** |
| Full Vitest (`npm test`) | **64 files passed, 1 skipped · 1083 passed, 19 skipped, 0 failed** (63.0s) |
| `tests/uiSafety.test.ts` | **15/15 passed** |
| Gold set (`eval:gold-set`) | **exit 0**, 217 cases, regression fixtures ALL PASS, 0 critical errors |
| Benchmark (`eval:benchmark`) | **exit 0**, 20/20 cases, 0.00% WER, FDI P/R 100%, pharmacology 100% — verdict satisfied |
| Clinical eval (`eval:notes`) | **3/3 passed**, 0 safety failures |
| Phase 11 API E2E (`phase11-e2e-flow.ts`) | **ALL CHECKS PASSED** (exit 0) |
| Rollback check (`phase12-rollback-check.ts`) | exit 0 (needs `DENTAI_E2E_DATABASE_URL` for the DB variant; JSON-store path ran) |
| Browser UI E2E | **16/16 checks PASS** (§7) |

No failure was converted to a skip; no assertion was weakened; the 19 pre-existing skips are untouched upstream conditionals (e.g. live-LLM gated suites).

## 7. Browser E2E result

`npx tsx scripts/phase12-ui-smoke.ts` (Playwright, hermetic staging profile, synthetic data): Cases A–E from Gate 7 all PASS (unverified note never shows "Verified from Audio"; approved note does; macro shows "Template Applied"; corrected note drops the stale badge; schedule literals intact) plus the new:

- **Case F** — sign-off request on an ungrounded note → refusal section visible with `data-code="GROUNDING_NOT_APPROVED"`; no signed state presented.
- **Case G** — sign-off on the server-approved record → server-minted seal displayed (`signoff-seal`); no refusal shown.

**Result: ALL SMOKE CHECKS PASSED (16/16).** Full path exercised: consultation → note → facts/evidence → sign-off refused (incomplete grounding) → sign-off approved → server seal → signed state.

## 8. Known limitations

- The browser E2E covers sign-off refusal and approval, but not replay/stale-version *in the browser* (covered exhaustively at API level in T9/T8 and `tests/signOffValidation.test.ts`).
- The 409 stale-write banner is covered by API-level tests; driving it through Playwright would require a deterministic two-writer choreography.
- The facts strip renders when the server record carries `facts`; hosted providers do not yet emit fact arrays, so in staging it appears for fact-bearing records only (empty state renders nothing — never a fabricated list).
- The macro badge in the schedule roster (`DayScheduleQueue` literals) predates this phase and was left as-is; the canvas badge is the canonical surface.

## 9. Remaining integration work

None required to close Phase 12. Forward-looking (out of scope here): surfacing `deriveSignOffState` once a single sign-state source-of-truth is desired across History Hub; wiring `identityNeedsReview` into a visible banner; the server emitting `facts` on the hosted path (the Phase 13 seam documented in `CLINICALFACT_INTEGRATION_AUDIT.md`).

## 10. Final verdict

**`UI_INTEGRATION_COMPLETE`**

The clinician UI now consumes and presents the server's canonical facts, evidence, verification, grounding, sign-off, seal and version state without recreating, weakening or bypassing any of them. This verdict covers UI integration only and does not declare the overall product production-ready.
