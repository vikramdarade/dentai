# Evidence note: what HotDoc's D4W integration actually does — and what it means for Pillar 1

**Source:** HotDoc support centre, "How to download or update the Sidebar for Best Practice, Medical Director (Pracsoft) or Zedmed" and "How do I create a new patient file in Dental4Windows (D4W) from a form submission in the Sidebar?" — `support.hotdoc.com.au/hc/en-gb/articles/4410975722905`
**Read:** 2026-09-20. The page returns `403` to automated fetches; the text was supplied by the product owner and is quoted below.
**Why this matters:** the "Two-Pillar PMS Moat" plan rests its entire on-premise pillar on a claimed D4W mechanism. This is the first *external, vendor-authored* evidence about how a real company actually writes into D4W.

---

## 1. What the article says, verbatim

The mechanism, in the vendor's own words:

> Log in to your workstation **using an administrator account**.
> Click this link to download the HotDoc Sidebar installer.
> Open the downloaded file and follow the prompts to complete the installation.
> You may see **security prompts from Windows or your browser** during this process.

> **Have the D4W program open and running on your computer** (otherwise you will see an error in the Sidebar)

> In a patients New Patient Registration Form submission, click the **Create Patient File in Dental4Windows button**.

> To copy the outstanding information into the patient file by clicking **Copy Fields** in the Sidebar and **copy and paste the details into D4W**. Select Finished Copy & Pasting once complete!

Fields that copy automatically:

> first name · last name · middle name · preferred name · date of birth · address 1 · address 2 · postcode · phone · mobile

And the Sidebar is one agent covering several PMS products:

> Please follow the steps below if your practice is using **Best Practice, Medical Director or Zedmed** as your practice management software.

---

## 2. What this establishes

### 2.1 The write path is a **locally installed desktop agent**, not a server folder

Three independent signals, all from the vendor:

1. **Per-workstation install under an administrator account**, with Windows security prompts.
2. **D4W must be open and running on the same computer** — "otherwise you will see an error."
3. The action is **a button in the Sidebar's UI**, pressed by a logged-in human.

A network-folder watch daemon has none of those properties. It needs no admin install, would not care whether D4W is running on the operator's machine, and would not present a button. So this is **local integration with a running desktop application**, not file-drop ingestion.

**Consequence for the plan:** the `\\SERVER\D4W\AutoImport\` watch-folder theory — the load-bearing assumption of Pillar 1 — has no supporting evidence, and the market's most prominent D4W integration is built the other way. If D4W shipped a folder that files notes by patient ID, a well-resourced vendor would almost certainly use it: it is cheaper, needs no per-machine install, and works when the PC is off. Their architecture is the strongest available signal that no such path exists.

### 2.2 The write is **demographic, and partial even then**

Every auto-filled field is patient *demographics*. **No clinical content is written at all** — no findings, no treatment, no ADA codes. And even for demographics, HotDoc ships a **manual copy-paste fallback**:

> To copy the outstanding information … **copy and paste the details into D4W**.

So the honest summary is: the leading integration in this market can create a patient file, fill most demographic fields, and **falls back to the clipboard for the rest**. It does not file a clinical note.

**Consequence for the plan:** Pillar 1's actual deliverable — an RTF containing `TREATMENT PERFORMED` and `ADA BILLING CODES` filing itself into the patient's progress notes — is the **least supported claim in the document**. There is no evidence that any third party, with or without a vendor relationship, can write a clinical note into D4W. The plan should not be scoped around it.

### 2.3 "Zero IT friction" is wrong

The plan claimed: *"Setting this up takes 60 seconds during onboarding — we just ask the practice manager for their D4W Import path."*

Reality from the vendor: an **administrator account on every workstation**, a per-machine installer, Windows/antivirus prompts, and the PMS must be running. In a six-chair practice that is six installs. For a solo founder that is not a feature — it is a **support operation with a per-machine unit cost and a per-clinic failure mode**.

### 2.4 The clipboard is not a failure — it is the market's answer

This is the most useful finding in the article. HotDoc is a large, funded Australian vendor with a real D4W relationship, and its answer for the fields it cannot write is **a "Copy Fields" button and a paste**. That is exactly what `formatNoteForPmsClipboard` already does in this codebase.

So the clipboard path is not technical debt to be escaped — it is **what the incumbent ships**, for the same reason: the PMS allows nothing better. Treating it as the product (rather than as a placeholder for an integration that may not be buildable) is the correct strategic read, and it requires no vendor relationship.

### 2.5 A correction to my previous message

I suggested the highest-value move was to "ride HotDoc" — to hand the note to a platform that already owns a certified D4W path. **This article does not support that.** What it documents is HotDoc's own forms pipeline writing a patient file. There is no third-party note-filing API in evidence. Riding HotDoc as a *technical* route is unsupported; it may still be worth investigating as a *distribution* channel, but that is a separate, unproven question.

### 2.6 Inferring the relationship

The article does not state the nature of HotDoc's arrangement with Centaur/Henry Schein. But an admin-installed, per-workstation agent that integrates with a running commercial desktop application is the shape of a **sanctioned integration**, not a workaround. That is consistent with the plan's own instinct being backwards: the thing it tried to route around ("zero vendor negotiation") is precisely what the incumbent has.

---

## 3. What to do instead

1. **Park the D4W watch-folder.** Do not implement it. The mechanism is unverified and the available evidence is against it.
2. **Ask Centaur/Henry Schein directly — one email, decides the pillar:** *"Is there a supported API, automation path, or partnership program for a third party to write a clinical note to a patient's record in D4W?"* If the answer is no, the pillar is closed for now and the roadmap changes. If yes, it is a BD project with a long lead time — start it early, because it is not a sprint.
3. **Invest in the clipboard as the product.** Per-PMS formatting profiles, one-key paste, keyboard-first flow. It is what the incumbent ships and it needs no permission from anyone.
4. **Keep Cliniko as the first self-built pillar** — public REST API, no desktop agent, no gatekeeping — and **confirm the write capability first**: can a third party *create* a finalised treatment note, and can it write billable items? Half of Pillar 2 dies if the answer to either is no.
5. **If a local agent is ever the answer, scope it as a product line**, not a feature: a Windows agent with per-PMS adapters, per-workstation install, antivirus considerations, and a support process. That is what the Sidebar is, and it is why it is one agent for Best Practice, Medical Director, Zedmed *and* D4W.

**Unchanged, and non-negotiable whichever route is taken:** resolve patient identity before anything is written (the plan's bare-ID-from-filename is the bug `src/lib/patients.ts` exists to prevent), and **propose** ADA codes rather than populating an invoice — an incorrect item number is a claim against a health-fund rebate with the dentist's name on it.
