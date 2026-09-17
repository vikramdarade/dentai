# Pilot feedback: slow note generation and inaccurate notes

**Source:** a dentist who took part in the pilot. Two complaints: note generation
was slow, and the generated notes were not accurate.

**Status:** latency causes fixed in code; accuracy causes partly fixed, with one
structural limitation identified that needs a decision (see
[The remaining accuracy ceiling](#the-remaining-accuracy-ceiling)).

This document records what was found, what changed, and what is still open. It is
written to be handed to a clinician or an engineer without translation.

---

## 1. What was actually wrong

### 1.1 Latency — the model was thinking, and nobody asked it to

Note generation called `gemini-3.6-flash` with no `thinkingConfig` anywhere in the
codebase. Google's own model table lists `gemini-3.6-flash` as **"On (medium)"** —
thinking is enabled by default and spends reasoning tokens before emitting a
single character of output.

That is the wrong trade for this task. Note generation is **structured
extraction**: read a transcript we already hold, fill a JSON schema we already
define, under rules we already write out in the system instruction. Nothing is
being solved. Every note paid several seconds of reasoning latency for no gain —
and it is invisible in the model name, which is why it survived review.

### 1.2 Latency — the synchronous endpoint had no timeout at all

`POST /api/generate-notes` called the model with no time budget. The async worker
(`runHostedGeneration`) had a 35 s `withTimeout`; the synchronous path had none,
so a slow upstream call held the request until the platform killed it — with no
note and no offline-draft prompt. (The app itself now submits through the job
fabric; this endpoint remains exposed and is covered by tests, so it was fixed
rather than left as a trap.)

### 1.3 Accuracy — the prompt told the model to use information it never receives

This is the most important finding.

`TEMPLATE_DRIVEN_SYSTEM_INSTRUCTION` opened with:

> *"...a clinical session transcript (speaker roles: 'Dentist', 'Patient',
> 'Dialogue', 'Clinical Comment' — infer who actually spoke from context)."*

Live capture never produces those roles. `LiveRecording` writes
`sender: 'Dialogue'` for **every** line of speech-to-text output. Labels like
`Dentist` and `Patient` exist only on the hand-written sample transcripts used in
demos and tests.

So the model was told to work out who spoke, from labels that are all identical.
It had to guess. And the guess matters, because the template asks it to separate
sections that are defined by *who said it*:

- `chiefComplaint`, `history` — what the **patient** reported
- `toothFindings`, `diagnosis`, `treatmentPerformed` — what the **clinician** observed and did

Get that wrong and a patient's own description of a symptom lands in the clinical
findings as an observed diagnosis. That is the difference between "patient reports
sensitivity on the lower right" and "tooth 46 sensitive on percussion" — and only
one of them is defensible in the record.

This defect is invisible in testing, because the sample transcripts are labelled
correctly. It only appears in real use, on real audio — which is exactly where the
pilot found it.

### 1.4 Accuracy — two rule sets that contradicted each other

Every request carried the clinical rules **twice**: once in the system instruction
(`TEMPLATE_DRIVEN_SYSTEM_INSTRUCTION`) and again inside the user content
(`buildNotePrompt`, under "ZERO-HALLUCINATION OPERATORY CONSTRAINT"). The two
disagreed:

- the system instruction demanded a **telegraphic tooth-by-tooth ledger**
  (`#16 (MOD): DB cusp fracture | Cold (+ lingered >15s) | Rec: ...`), the user
  block demanded plain prose ("tooth numbers, surfaces, diagnostic tests...");
- the anti-fabrication rule was stated four times, in four different wordings.

Duplicated, conflicting instructions cost latency on every request and let the
model satisfy one rule while breaking the other. There was no way to tell which
one it followed, because both were in the same prompt.

### 1.5 Accuracy — the rules pushed toward empty notes

The instruction to leave sections empty appeared three times, with no
counterweight:

> *"If a section has no supporting evidence, return an empty string for it."*

No rule said the opposite — that omitting something the clinician *did* say is
also a documentation failure. Combined with section 1.3 (the model cannot tell who
spoke) and imperfect speech-to-text, the safe move for the model was to output
blanks. The dentist then saw a note missing things that had been discussed, and
reasonably called it inaccurate. Sparse and wrong read the same way to the person
signing the record.

### 1.6 Accuracy — the grounding check existed and its result was thrown away

Every generated note is verified deterministically against the transcript
(`verifyTranscriptGrounding`): teeth, surfaces, materials, anaesthetics, ADA codes
— each traced back to something actually said, producing a `groundingScore` and a
list of `unverifiedClaims`.

The server computed this and set `noteOrigin.needsReview` from it, then persisted
the record. The client then **overwrote it**:

```ts
// src/App.tsx (before this change)
noteOrigin = { engine: 'gemini', needsReview: false };
```

Hardcoded to "no review needed", with `groundingReport` not carried onto the
consultation at all. So a note containing a tooth number nobody spoke was
displayed to the clinician as verified, with the evidence that it was not sitting
unused on the server.

### 1.7 Accuracy — the same recording could produce two different notes

The async worker compacted the transcript before generation; the synchronous
endpoint sent it raw. Two code paths, two different prompts, two possible notes
from one consultation, depending on which route happened to serve it.

---

## 2. What changed

| # | Change | Files |
|---|---|---|
| 1 | **Thinking pinned to `minimal`** for every note-generation call (primary, Vertex fallback, secondary key, job worker and sync endpoint). Operator-overridable via `DENTAI_THINKING_LEVEL`; an invalid value falls back to `minimal` rather than failing a consult. | `src/lib/noteModelConfig.ts`, `server.ts` |
| 2 | **Latency budgets made real and consistent**: 25 s primary, 18 s secondary, so worst case is bounded at 43 s and the product hands over the offline draft instead of spinning. The sync endpoint, which had no budget, now has the same one as the worker. | `src/lib/noteModelConfig.ts`, `server.ts` |
| 3 | **The prompt now tells the truth about attribution.** The false claim of labelled roles is replaced with an explicit attribution rule: the transcript is single-microphone and unlabelled, decide from clinical content, and use neutral phrasing rather than guessing when it is genuinely ambiguous. | `server.ts` |
| 4 | **One rule set, one place.** The duplicated, contradictory block is gone from `buildNotePrompt`, which is now data-only. Two grounding sentences are kept there deliberately, because the legacy `CLINICAL_AI_CONFIG` path relies on them. | `server.ts` |
| 5 | **Completeness is now a stated requirement.** Rule 6 became *"NO FABRICATION, AND NO OMISSION"*: never invent, **and** never drop something that was said. Empty sections are reserved for encounters that genuinely do not support them. | `server.ts` |
| 6 | **The grounding verdict reaches the clinician.** `grounding` is stored on the consultation, `needsReview` is derived from it instead of hardcoded `false`, and the summary screen shows a green "every clinical claim traced back to the recording" banner or an amber list of the exact items that were not spoken. | `src/types.ts`, `src/App.tsx`, `src/components/ClinicalSummary.tsx` |
| 7 | **Both routes generate from the same compacted transcript.** | `server.ts` |
| 8 | **Latency settings are now visible to the operator** at `GET /api/ops/telemetry` (`generation.model`, `generation.thinkingLevel`, `generation.timeoutsMs`), because the model name alone cannot tell you how slow a note will be. | `src/server/opsRoutes.ts`, `server.ts` |
| 9 | **Runaway invocations bounded** with an explicit 60 s `maxDuration` for the API function (Vercel's default for this plan is 300 s). | `vercel.json` |
| 10 | **Regression tests** for the thinking default, the override handling, config preservation and the latency budgets. | `tests/noteModelConfig.test.ts` |

---

## The remaining accuracy ceiling

Fixing the prompt removes a *self-inflicted* inaccuracy. It does not fix the
input, and the input is the bigger limit.

**The clinical transcript comes from the browser's Web Speech API.** That means:

- **No custom vocabulary.** Dental terms are not biased toward: tooth numbers,
  materials and drug names are exactly what general-purpose speech recognition
  handles worst.
- **No diarization.** One undifferentiated stream, which is why section 1.3
  exists. The prompt now handles this honestly, but "decide from clinical cues"
  is a heuristic, not speaker separation.
- **Audio is lost on every recognition restart.** The Web Speech API ends its own
  sessions; `LiveRecording` restarts after a 250 ms delay, and anything said in
  that window is gone. It also restarts mid-consultation whenever the browser
  decides to end a session.
- **Phone-beacon audio is captured and then discarded.** `PhoneBeaconMode` uploads
  audio chunks to `/api/beacon/chair/:id/upload-chunk`; the server stores them in
  memory, counts them, and never transcribes them. The recording is collected and
  thrown away.

### Recommendation (needs a decision, not a patch)

Google's current speech-to-text model, `gemini-3.5-transcribe`, provides
**speaker diarization** and **custom vocabulary biasing** — precisely the two
things missing above, and the two things that would move accuracy more than any
prompt change. The app already captures the audio (beacon chunks) and already
holds a billing-enabled Gemini key.

Rough shape: route recorded audio to `gemini-3.5-transcribe` with a dental
vocabulary list, use the diarized output as the transcript, and keep the browser
recogniser only for live on-screen feedback. This is a real piece of work —
storage, consent wording, residency, cost per minute of audio — so it is called
out rather than started. The transcription quality question should be settled
before any further accuracy claim is made to a practice, because prompt
engineering cannot recover a tooth number that was never transcribed correctly.

---

## How to verify this change

```bash
# Typecheck + the full suite (includes the new latency regression guards)
bun run lint && bun run test

# The clinical accuracy gate. Offline mode scores the recorded generations and
# needs no API key; it must stay >= 0.9.
bun run eval:notes --offline --min-score 0.9
```

Then, against a deployment, with a live key:

```bash
DENTAI_EVAL_BASE_URL=https://<app> \
DENTAI_EVAL_TOKEN=<signed-in session token> \
DENTAI_EVAL_CLINIC_ID=<clinic to generate against> \
bun run eval:notes --live --min-score 0.9
```

Per `docs/runbooks/clinical-eval.md`: **never lower `--min-score` to make a run
pass**, and never delete a failing fixture. If a live run fails where the offline
run passes, the difference is the change.

Check the effective latency configuration:

```bash
curl -s -H "x-dentai-ops-secret: $DENTAI_OPS_SECRET" https://<app>/api/ops/telemetry | jq .generation
# expect: {"model":"gemini-3.6-flash","thinkingLevel":"minimal","timeoutsMs":{"primaryMs":25000,"secondaryMs":18000},...}
```

If `thinkingLevel` is not `minimal`, something has set `DENTAI_THINKING_LEVEL` and
notes are being made slower on purpose.

---

## Honest limits of this work

- **This is not clinical validation.** The gate catches regressions and obvious
  fabrication; a clinician reading the note is still the only real check.
- **Grounding is a heuristic, not a proof.** `verifyTranscriptGrounding` matches
  teeth, surfaces, materials, drugs and ADA codes against transcript text. A claim
  can be grounded in a phrase that was transcribed wrongly, and a genuinely
  correct inference can be reported as unverified. It is a prompt to look, not a
  verdict on the note.
- **The changes were verified by tests and typecheck, not by a clinician.** They
  should be reviewed on real de-identified consultations from the pilot before any
  accuracy statement is made to that practice.
- **No sub-second target is claimed.** `minimal` thinking plus a 25 s budget bounds
  the worst case and removes the dominant cost; it does not make generation
  instant. The offline draft exists for the case where even that is too slow.
