# PMS integration contingency plan — what to do if the vendors stall

**Prepared:** 2026-09-20 · **Owner:** Vikram Darade · **Status:** active
**Companion docs:** `docs/operations/pms-partnership-enquiries.md` (the emails sent 2026-09-20) · `docs/reviews/d4w-integration-route-patientdesk.md` (competitor + route evidence) · `docs/reviews/d4w-integration-evidence-hotdoc.md`

**Premise:** Centaur, Praktika and Cliniko were emailed on 2026-09-20. This plan assumes the likely outcome — **the on-premise vendor (Centaur) stalls or says no quietly, Cliniko replies usefully, Praktika is unknown** — and states what ships regardless.

**The governing rule:** *a PMS integration is not a gate. Nothing in the product roadmap waits on a vendor reply.* The clipboard path (`formatNoteForPmsClipboard`) and file export (`src/server/clinicExport.ts`) already work today and need no permission. Integration is an upside, not a prerequisite.

---

## 1. Why established vendors stall (so it isn't read as a personal setback)

Predictable and structural, not about the founder:

- **Deal-size triage.** A pre-revenue solo founder is not a priority account for a company with 4,500 practices and a BD team.
- **Their own AI roadmap.** Centaur already markets "AI-powered" software. A vendor building the same thing has a reason to be slow, or to decline without saying so.
- **Integration access is their moat.** A clinical-write API handed to third parties weakens what they sell against rivals. "No" is cheap; "yes" carries downside.
- **Even a "yes" is slow.** Partner programme → legal → security review → certification. PatientDesk's own figure is **~18 months** of integration work, with US$3.8M behind it.

**Consequence:** plan on a **multi-quarter** horizon for any on-premise write path. Do not sequence product work behind it.

---

## 2. The fallback ladder

| Tier | Path | Needs a vendor? | Ships when | Cost / risk |
|---|---|---|---|---|
| **0** | **Clipboard**, per-PMS formatting profiles, one-key paste | No | **Today** | ~support per PMS format; near zero |
| **1** | **File/PDF export** (already in `clinicExport.ts`) | No | Already partly built | Practice must import; low risk |
| **2** | **Go where the API is open** — Cliniko, and US platforms with public REST APIs (Open Dental, Dentrix, Eaglesoft, Curve) | No (public API) | Weeks, self-serve | None beyond normal API work |
| **3** | **Ride a licensed integrator** — HotDoc or an IT reseller who already holds the D4W relationship | Distribution deal, not technical | Months | Commercial terms; partner dependency |
| **4** | **Own Windows desktop agent** (one agent, per-PMS adapters) | No, but heavy | Multi-month **product line** | Per-workstation install, antivirus, support — what HotDoc's Sidebar is |

**Tier 0 is the product.** It is not a placeholder for a real integration — it is what the funded incumbent (HotDoc) ships for the fields it cannot write. Treat it as the shipping feature and improve it deliberately.

---

## 3. Trigger conditions — when to move down the ladder

- **Centaur replies "no" or gives partner terms that are out of reach** → stay at Tier 0/1 for D4W; move roadmap weight to **Tier 2** (open-API platforms). Do not build the watch-folder; the evidence is against it.
- **Centaur replies "yes, clinical-note writes are permitted"** → start the partner process immediately (it is long); keep shipping Tier 0 meanwhile. This is the only reply that justifies Tier 4 work later.
- **Centaur goes silent past ~3 weeks** → treat as "no for now". Send one nudge quoting the original subject; do not chase. Re-open only with customer leverage (§4).
- **Cliniko confirms note + invoice writes** → build the Cliniko connector first; it becomes the reference integration.
- **Cliniko confirms read-only** → Tier 2 loses its easiest target; the product stands on Tiers 0/1 alone. That is a decision-grade fact, not a failure.
- **Praktika replies** → identify the product/market, then re-ask the same three deciding questions.

---

## 4. The thing that actually breaks a stall

Vendors respond to **customers and revenue**, not to founders. The lever to unstick Centaur is a **paying practice or a DSO asking their rep why DentAI cannot write to their system.** Customer pressure moves a vendor; a cold email does not.

This inverts the priority: **the fallback is not a technical route around the vendor — it is distribution that makes the vendor want to talk.** Therefore, in order:

1. **Get one paying practice** and prove the outcome **from their own ledger** (not from our own ROI estimate). That is the case study, the testimonial, and the future leverage with Centaur.
2. **Approach a DSO or a dental distributor** whose incentive is volume; they can force the integration question on your behalf.
3. **Keep note quality and the compliance record as the differentiator** — those are ours and depend on nobody.

**Reframe worth stating plainly:** the binding constraint was never the API. It is distribution. A stall does not create the problem; it exposes it.

---

## 5. What ships regardless of any reply (do these now)

1. **Fix the pending claims** — see `docs/reviews/claims-fix-applied-and-pending.md`. The `server.ts` ROI denominator and the demo `Scenes.tsx` fabricated constants are false claims in front of any practice or investor, and no vendor reply changes that. *Blocked only by the editor's ~64 KB limit in this workspace; patches are written out for a whole-file writer.*
2. **Make Tier 0 excellent** — per-PMS formatting profiles, one-key paste, keyboard-first. It is the fallback that is already here.
3. **Close the measurement gaps** — the edit-rate metric currently reads 0% for a clinic that rewrites everything (`docs/reviews/vc-memo-verification.md`). Fixing it helps the pilot, diligence and roadmap at once.
4. **Do not** start building a watch-folder / XML-manifest D4W mechanism, and do not fabricate an integration claim anywhere in product copy.

---

## 6. One-line summary

**The vendors were emailed; the product was never waiting on them.** If they stall, the answer is Tier 0 shipping today, Tier 2 where the API is open, and one paying practice whose own ledger — not our estimate — becomes the proof and the leverage. Integration is upside. Distribution is the constraint.
