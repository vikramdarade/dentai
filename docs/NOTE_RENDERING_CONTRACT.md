# DentAI — Note Rendering Contract (Phase 7)

**Status:** Active contract for all note generation
**Authority:** `docs/PHASE_7_EXIT_AUDIT.md` · implemented in `src/lib/factRenderer.ts`

---

## 1. Canonical pipeline

```
Transcript
  → ClinicalFact extraction            (canonical domain — ClinicalFact is the data model)
  → deterministic validation           (fdiNotationEngine, treatmentStatus, contradiction flags)
  → selective verification             (Phase 6, exception path only)
  → validated ClinicalFact[]
  → renderClinicalNote()               (deterministic renderer — the ONLY note generator)
  → clinical note
  → clinician review → sign-off        (fail-closed, Phase 5 state machine)
```

**Clinical facts are the canonical representation. The note is a rendering of
those facts. The note is never the data model.**

## 2. Monotonicity rule (the safety rule)

> If a fact does not exist in the validated `ClinicalFact` set, the renderer
> must not introduce it.

Consequences, enforced and tested:

- No default anaesthetic agent, adrenaline concentration, or volume.
- No default composite shade, material, liner, suture or isolation method.
- No fabricated findings ("TTP (-), no mobility", "Gingival margin healthy").
- No template diagnosis, recall interval, or consent language.
- No post-operative boilerplate that was not spoken.
- A missing fact renders as a missing line — never as invented content.
- The renderer contains no clinical knowledge; it only formats what facts carry.

## 3. Renderer semantics (per dimension)

| Dimension | Rule |
|---|---|
| **Attribution** | Patient-voiced facts render as `Patient reports …`; assistant facts as `Assistant noted …`; clinician facts render unattributed (clinician is the author). |
| **Status** | `performed` → Treatment Performed · `planned`/`discussed` → Treatment Planned · `declined` → Treatment Declined · `historical` (status or temporal) → History · `negated` → explicit `No …` statement. |
| **Temporality** | `temporal: historical / previous_appointment` never renders under today's treatment. `next_appointment`/`future` render under Treatment Planned. |
| **Negation** | Negated findings/procedures render as `No <concept> <anatomy>` (e.g. `No caries #36 (O)`). Negations are never dropped or converted to positives. |
| **Anatomy** | FDI teeth render as `#36 (MOD)` via the existing validated `ToothReference` model; no tooth is rendered that no fact carries. |
| **Evidence** | Facts keep evidence spans upstream; the note itself contains prose only — evidence linkage remains available for review UI, not embedded as note text. |
| **Empty sections** | An empty string means "no supported fact". Sections are never padded. |

## 4. LLM role boundary

Where the hosted LLM path remains in use, its prompt is bound by the renderer
contract (system instruction rule 13 in `server.ts`): it may only verbalise
supported facts; it must not infer, add, embellish or complete missing clinical
information; empty sections are always safer than invented ones. The LLM is
never the authoritative source of clinical content; deterministic rendering is
preferred wherever facts suffice.

## 5. Macro template migration status

Macros provide **presentation structure only**; they must not supply clinical
facts. Migration state of the 18 Australian procedure templates:

| Template | Status |
|---|---|
| Routine Restoration (composite) | **Migrated** — all clinical content evidence-gated; defaults (Articaine, 1:100,000, 2.2 mL, A3, cotton-roll isolation, profound anaesthesia, consent/options discussion, generic procedure steps, findings, diagnosis, 6-month recall, patient-summary aftercare, fallback ADA code) removed; diagnosis is flagged as missing instead of fabricated. |
| Remaining 17 templates | **Proven-safe by construction** — they interpolate extracted variables into presentation scaffolding; their clinical values come from `parseClinicalEntities`, whose Phase 7 zero-fabrication fix (evidence-only anaesthetic/isolation/shade extraction) removed the shared default-injection source. Any template output not backed by an extracted variable now renders empty rather than defaulted. |
| Clinical entity parser | **Zero-fabrication enforced** — LA fields, isolation and shade exist only when spoken; spelled-number cartridges normalise (transcription normalisation, not invention). |

Australian dental infrastructure (FDI engine, ADA schedule, phonetic lexicon,
PMS/billing adapters) is consumed as-is — not duplicated or rewritten.

## 6. Failure behaviour

- Missing evidence → empty section + `missingProtocolNotices` entry.
- No supported fact for a section → empty section.
- Renderer can never throw away a fact's meaning: unsupported-to-render facts
  are reported in `unrenderedFactIds` (audit trail), never silently dropped.
