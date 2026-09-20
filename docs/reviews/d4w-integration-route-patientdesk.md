# Competitor & integration-route brief: how PatientDesk books into D4W — and what it means for DentAI

**Sources (all read 2026-09-20):**
- `patientdesk.ai/d4w-stack` — *"AI receptionist for Dental4Windows & D4Web"*
- `patientdesk.ai/platform` — platform/build-vs-buy page
- `patientdesk.ai/ai-receptionist`, `patientdesk.ai/online-booking-opendental`, `patientdesk.ai/blog/dental-tech-integrations-8-12-platforms-one-seamless-stack`
- `centaursoftware.com.au` — Centaur Software (the D4W vendor) home page

**Why this matters:** the "Two-Pillar PMS Moat" plan proposed an on-premise D4W mechanism (a watched `AutoImport` folder) with no external evidence, and a later revision invented an XML manifest schema (`import_manifest.xml`, root `<D4WImport>`, "Centaur Bridge Manifest"). PatientDesk is a real, funded, YC-backed competitor that *does* write into D4W. This brief records what is actually verifiable about how, and separates it from what is not.

---

## 1. The headline: PatientDesk is an official integration partner, not a reverse-engineer

Verbatim from `patientdesk.ai/d4w-stack`:

> **Official D4W integration partner**
> **Built with D4W, not bolted on afterwards**
> Patientdesk works with **Dental4Windows and D4Web as an official integration partner**, so your existing PMS stays at the centre of the workflow.

> **Patientdesk at ADX Sydney with the Dental4Windows team.** *(photo caption)*

And the vendor side confirms the same structure exists — `centaursoftware.com.au`:

> **Connected Partner Network**
> Our partner ecosystem expands what your practice can achieve across every part of your operations. Easily connect with systems that enhance performance and efficiency…

**Conclusion:** the route into D4W is a **negotiated vendor relationship**, published by both parties. It is not a file-drop mechanism, and it is not something a third party can obtain by reverse-engineering a folder. This is the strongest available confirmation of the read in `d4w-integration-evidence-hotdoc.md` §2.6 — the incumbent has the relationship the plan tried to route around ("zero vendor negotiation").

## 2. "D4W Windows and web" is two products, and likely two mechanisms

Centaur's home page draws the line explicitly:

> **Dental4Windows** — *"Australia's leading **on-premise** dental practice management software"* — appointment booking, patient records, clinical charting.

> **Dental4Web** — *"the next step… available on a **cloud-based subscription model**, dental practitioners can access the Dental4Web platform securely from anywhere with an internet connection."*

A cloud product plausibly exposes a real API; the 30-year-old on-premise desktop product is where the hard integration lives. So PatientDesk's single marketing sentence — "D4W Windows and web" — most likely covers **two different mechanisms**, not one.

## 3. The tell: even the official partner stops at *booking*, and never says how

Read the D4W page closely. Even holding a partner relationship, the copy stays hedged:

> *"moves the conversation toward the right D4W **booking path**"* · *"**Connected to** Dental4Windows or D4Web"* · *"Eligible … appointments trigger a timely request"*

What is **never** claimed anywhere on the D4W page: writing a **clinical note**, extracting **ADA item codes**, or populating an **invoice**. The integration PatientDesk sells into D4W is **appointments/scheduling**.

**Consequence for DentAI:** DentAI's product is *notes*, not bookings. Even an official partner with a funded team built the **narrower, more commonly-sanctioned object**. Writing clinical content is a harder target than booking a slot — do not assume the booking path generalises to it.

## 4. What the integration portfolio cost them

From `patientdesk.ai/platform` and the blog:

- **Backed by Y Combinator and e2vc; raised US$3.8M; three founders "building together since 2016."**
- *"Ten practice management systems pre-wired across the US dental ecosystem. **Eighteen months of integration work** you skip on day one."*
- *"PMS integrations for Open Dental, Dentrix, Eaglesoft, CareStack and more **take around 18 months**."*

Note that the named systems — Open Dental, Dentrix, Eaglesoft, CareStack, Curve — are the **US** platforms, several of which publish open REST APIs. D4W is handled separately, through the partner program. Their `/platform` page also shows the integrations are sold as a **platform to agencies/IT firms**, not just as a consumer product — the integration breadth is the business, not a feature of it.

**Order of magnitude, honestly stated:** a funded team spent **~18 months** on PMS integrations and treats them as the moat. That is the scale bar for this work.

## 5. What remains unknown (do not fill this in with a guess)

- **The exact wire protocol for D4W desktop.** Centaur's partner documentation and any D4W developer API are not public. Web search was rate-limited during this investigation (four attempts) and no developer-facing docs were retrievable.
- **Whether D4Web exposes a third-party booking/notes API**, and under what terms.
- **The commercial terms** of the Centaur partner program (who qualifies, cost, lead time, whether clinical-note writes are permitted at all).

Anyone who states the exact mechanism — a folder path, an XML schema, an endpoint — without a Centaur partner agreement is guessing. That is precisely the failure mode of the invented `import_manifest.xml` in the earlier plan.

## 6. Practical routes for DentAI, in order

1. **Apply to Centaur's "Connected Partner Network."** It is public and it is the only sanctioned path to D4W. Treat it as a BD project with a long lead time — start it early; it is not a sprint.
2. **Target D4Web (cloud) before legacy D4W desktop.** An API-based route is plausible there and avoids the per-workstation desktop-agent problem entirely.
3. **Keep the clipboard as the shipping product for D4W desktop** — per-PMS formatting profiles, one-key paste. It is what HotDoc itself ships (§HotDoc evidence) and it needs no permission.
4. **Do not build the watch-folder / XML-manifest mechanism.** The funded competitor with the official relationship did not need it, which is further evidence it is not the real mechanism — and it is unsupported on both the vendor and the practical-stability grounds already documented.

## 7. Non-negotiable, whichever route is taken

- **Resolve patient identity before anything is written.** A bare chart ID parsed from a filename, an OCR read, or a window title is the bug `src/lib/patients.ts` exists to prevent (two patients named John Smith sharing a chart).
- **Propose ADA codes; never populate an invoice unattended.** An incorrect item number is a claim against a health-fund rebate with the dentist's name on it.
- **Never write clinical content into a record without a clinician in the loop.** An unattended `TREATMENT PERFORMED` / `ADA CODES` write into a medicolegal chart contradicts the project's own guardrail "never synthesise clinical evidence" (`PROJECT_CONTEXT.md` §6).

---

**One-line summary:** the real competitor reached D4W by **becoming the vendor's partner**, writes **bookings not clinical notes**, and spent **~18 months and US$3.8M of backing** on integrations — which is both the proof that the relationship is the moat and the honest scale of the work.
