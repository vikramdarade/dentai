# PMS partnership & integration enquiries (ready to send)

**Prepared:** 2026-09-20 · **From:** DentAI (Vikram Darade) · **Status:** **SENT 2026-09-20** — to Centaur Software, Praktika and Cliniko. Awaiting replies.

**Follow-up date:** if no reply by ~2026-09-27 (one week), send a short nudge quoting the original subject line.

These are the three integration enquiries to open the PMS write-path question. They are written to a single standard, consistent with `docs/reviews/d4w-integration-route-patientdesk.md`: **ask the deciding yes/no questions, claim nothing DentAI does not do, and reassure on clinical safety.**

> **Recipient addresses — deliberately not invented.** No verified contact email could be retrieved for any of these vendors during this investigation. Send each through the vendor's own contact/enquiry form (or reply to an existing support thread). The names below are real people from public pages; use them to address the message, not as a guaranteed inbox. Confirm the address on the vendor's site before sending.

---

## 1. Centaur Software — Dental4Windows / Dental4Web

**Send via:** `centaursoftware.com.au` → "Contact Us" / "Enquire Now".
**Address the enclosure to:** Kevin Joseph (Head of Business Development and Growth) — cc Sean Perera (Chief Technology Officer), if the form permits.

**Subject:** Integration partnership enquiry — third-party clinical documentation (DentAI)

> Hi Kevin,
>
> I'm Vikram Darade, founder of DentAI, an Australian-built ambient AI clinical documentation tool for dental practices. Clinicians dictate chairside, and DentAI produces a structured clinical note that the treating dentist reviews and approves before it goes anywhere near the patient record.
>
> We currently ship a clipboard export — the note is formatted for the practice's PMS and the clinician pastes it in. I'd like to move beyond that, and I'd rather do it the supported way than work around your product.
>
> Could you help me with three questions?
>
> 1. **Is there a supported path for a third party to write to a patient record** in Dental4Windows or Dental4Web — an API, SDK, automation interface, or partner integration? If so, is there technical documentation you can share?
> 2. **Does Centaur run an integration partner programme** — how do we apply, what does it involve, and what is the typical lead time?
> 3. **What is actually permitted to be written?** Specifically: can a third party create or append a **clinical/treatment note** (not just patient demographics), and can it create an **appointment** or add **billable items** to an invoice?
>
> For context on what we'd be sending: a structured note with findings, treatment rendered and **proposed** ADA item codes, always after clinician review — we never auto-file clinical content or auto-populate an invoice without the dentist confirming it.
>
> I'm aware D4W and D4Web are different platforms, so I'm happy to be pointed at whichever is the right starting point. I appreciate this may be a longer process — I'd rather start it properly than guess.
>
> Thanks,
> Vikram Darade
> DentAI · [phone] · [email]

---

## 2. Praktika

> ⚠️ **Unverified.** I could not confirm what "Praktika" is as a dental PMS, which market it serves, or whether it exposes any integration interface — web search was rate-limited throughout and I will not guess vendor facts. Confirm the product and region before sending, and adjust the bracketed line.

**Send via:** the vendor's contact/support channel.
**Subject:** Integration partnership enquiry — third-party clinical documentation (DentAI)

> Hello,
>
> I'm Vikram Darade, founder of DentAI, an ambient AI clinical documentation tool for dental practices. A clinician dictates chairside; DentAI drafts a structured clinical note that the treating dentist reviews and approves before it reaches the patient record. We export today via clipboard and format the note for the practice's PMS.
>
> I'm reaching out to ask whether **[Praktika — confirm exact product name]** offers a supported way for a third-party application to integrate, and specifically:
>
> 1. Is there a **public or partner API** (REST, SDK, or automation interface), and where is its documentation?
> 2. Do you operate an **integration partner programme** — how does a developer apply?
> 3. **What can a third party write?** Can we create or append a **clinical/treatment note**, create an **appointment**, or add **billable items** to an invoice?
> 4. What **authentication** model is used (OAuth, API key), is there a sandbox, and are there per-practice or residency constraints?
>
> We would only ever send a note after clinician review, and we *propose* item codes rather than filing them automatically — patient safety and the clinician's ownership of the record come first.
>
> If integration isn't something you support today, I'd still value knowing the roadmap, so I can be honest with practices about what's possible.
>
> Thanks,
> Vikram Darade
> DentAI · [phone] · [email]

---

## 3. Cliniko (cloud)

**Send via:** Cliniko help/contact (their `www.cliniko.com/contact` routes to their help centre) — ask for the developer/API or integrations team.

**Subject:** API capability question — creating treatment notes and invoice items as a third party

> Hi Cliniko team,
>
> I'm Vikram Darade, founder of DentAI, an ambient AI clinical documentation tool for dental practices. We're building an integration with Cliniko and want to confirm what the API supports before we scope it, rather than assume.
>
> We already read from Cliniko (appointments/practitioners) and format notes for clipboard paste. Before we build further, could you confirm:
>
> 1. Can a **third-party API client create a finalised treatment note** on a patient, against an appointment? If so, which endpoint and what does the note body accept?
> 2. Can a third party **add billable items / treatment items** to an appointment's invoice?
> 3. Can we **create or reschedule an appointment** via the API?
> 4. What are the **authentication** requirements (API key vs OAuth app), rate limits, and any per-practice onboarding needed for a third-party integration?
> 5. Do you have an **integrations/partner directory** we could be listed in once live?
>
> For context, DentAI sends a structured clinical note (findings, treatment rendered, **proposed** item codes) **after the treating clinician reviews and approves it**. We never write clinical content unattended, and we propose item codes rather than filing them.
>
> If any of the above isn't supported, knowing that now saves us — and your customers — a lot of time.
>
> Thanks,
> Vikram Darade
> DentAI · [phone] · [email]

---

## The three questions that decide everything

Whichever vendor they go to, these are the load-bearing answers — a "no" on any of them changes the roadmap:

1. **Is there a supported third-party write path at all** (vs clipboard only)?
2. **May a third party write a *clinical note*** — not just demographics or a booking?
3. **May a third party write *billable items*** to an invoice?

The PatientDesk evidence (`docs/reviews/d4w-integration-route-patientdesk.md`) suggests the realistic ceiling is: supported path = **yes for the vendor's own partners**, clinical note = **likely no**, billing = **very likely no**. Asking directly is how the guess becomes a fact.

---

## Fill in before sending

- `[phone]`, `[email]` — your contact details.
- Confirm the correct **recipient address/form** for each vendor.
- Confirm the **Praktika** product name and market.
- Keep the honesty line about clinician review in every version — it is true, and it is what makes a clinical vendor comfortable replying.
