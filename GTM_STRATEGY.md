# DentAI: Grounded Go-To-Market (GTM) Strategy & Execution Roadmap

**Document Version:** 1.0 (Production-Ready)  
**Target Market:** Australia & New Zealand Private Dental Clinics (15,000+ Registered Dentists)  
**Core Thesis:** Eliminate after-hours operatory documentation, capture lost high-value treatment revenue, and bypass PMS walled gardens via ambient chairside intelligence.

---

## 1. Executive Summary & Distribution Model

### The Distribution Dilemma: "Free" vs. "High Trust"
Dentists are among the most risk-averse, privacy-conscious professionals in healthcare. Releasing DentAI as generic "Free Consumer Software" triggers immediate suspicion:
> *"Why is it free? Are you selling my patient health records? Will this disappear next month?"*

### The "Trojan Horse" Strategy: Scarcity-Led Clinical Pilot
Instead of a wide-open freemium funnel, DentAI launches as an **"Exclusive 6-Month Clinical Pilot for 30 Leading Australian Practices"**:
1. **Free Tier (Clinician Scribe):** Zero-cost solo ambient scribing, voice tooth notation, AHPRA-standard notes, referral letters, and patient summaries. Eliminates the 5:00 PM charting backlog.
2. **Paid Practice Tier ($149 – $299 AUD / month / practice):** The **Treatment Revenue Moat & PMS Opportunity Tracker**. Centralized multi-chair compliance, unbooked treatment recovery ($1,800 crowns, $4,500 implants), and PMS webhook automation.

---

## 2. Realistic Unit Economics & Capital Plan

### A. The True Cost of Goods Sold (COGS) Per Dentist
*Based on full-time associate treating 18 patients/day, 20 days/month (360 consults/month).*

| Cost Component | Architecture in DentAI | Monthly Cost / Dentist (AUD) |
| :--- | :--- | :--- |
| **Real-time Live Scribing** | Client-side Web Speech API | **$0.00** |
| **AHPRA Note Drafting** | Deterministic Offline Draft Engine | **$0.00** |
| **Audio Scribe Buffer Fallback** | Gemini 2.0 / 1.5 Flash Audio API ($0.072/hr) | **$1.80 – $3.50** |
| **PMS Schedule Vision Parser** | Gemini Flash Image (1–2 uploads/day) | **$0.25 – $0.40** |
| **Australian Cloud DB & Hosting** | Supabase Pro / AWS Sydney (`ap-southeast-2`) | **$0.60 – $1.10** |
| **Total Cloud/AI COGS** | **Per Active Dentist / Month** | **~$2.65 – $5.00 AUD** |

*Note: For clinicians utilizing the built-in **Custom Gemini API Key (BYOK)** feature, AI COGS drops to **$0.00**.*

---

### B. The Seed Budget: What It Actually Takes to Hit 50–100 Active Practices

| Budget Allocation | Capital Required (AUD) | Purpose & Deliverable |
| :--- | :--- | :--- |
| **Medico-Legal & Health Privacy Package** | **$5,000 – $7,000** | Retain Australian healthcare IT legal counsel. Draft Business Associate Agreement (BAA), Privacy Act 1988 & APP compliance certification, and patient consent forms. |
| **Australian Cloud Hosting & Dedicated DB** | **$1,200 / year** ($100/mo) | AWS Sydney / Supabase Pro with encrypted storage and automated backups guaranteeing data residency. |
| **Google Cloud Enterprise AI Quota Pool** | **$1,500 – $2,500 / year** | Paid Tier 2 quota to eliminate `429 RESOURCE_EXHAUSTED` bottlenecks during peak 11am/4pm clinic hours. |
| **Operatory Demo Hardware Pool** | **$1,500** | 10 directional boundary microphones (Anker PowerConf / Jabra) for pilot surgeries without active PC microphones. |
| **Clinical Collateral & Practice Kits** | **$1,000** | Laminated chairside dictation cheat sheets, QR beacon desk stands, and dental assistant quick-start cards. |
| **Founder Travel & Direct Onboarding** | **$2,000** | Fuel, coffee, and in-person chairside operatory setup across local metro practices. |
| **Total Seed Investment Required** | **$12,200 – $15,200 AUD** | **Sufficient runway to achieve 50–100 sticky daily active practices.** |

---

## 3. Four Real-World Operatory Obstacles & Countermeasures

### Obstacle 1: The AI API Rate-Limit Trap
- **The Reality:** Free-tier Gemini keys cap out at 15 Requests Per Minute (RPM). When multiple surgeries hit "Finish Note" simultaneously, requests fail with 429 quota errors.
- **Countermeasure:** Deploy a paid Google Cloud billing account with Tier 2 capacity, sequential fallback keys (`server.ts`), and client-side BYOK key persistence in localStorage.

### Obstacle 2: Australian Health Privacy Laws (Privacy Act 1988 & APPs)
- **The Reality:** Dental clinical records are "Sensitive Health Information". Under state Surveillance Devices legislation (NSW/VIC/QLD), unauthorized audio recording carries criminal penalties.
- **Countermeasure:** 
  1. Mandatory verbal consent audit logging built into every note (`consentObtained: true`).
  2. Zero permanent audio storage: audio buffers are processed in-memory and immediately discarded.
  3. Formally published Australian Privacy Principles (APP) compliance charter hosted at `/privacy`.

### Obstacle 3: Locked-Down Surgery PCs & No Microphones
- **The Reality:** Most operatory PCs are locked down by corporate IT, lack external microphones, and sit 2–3 meters away from the patient chair amidst suction and ultrasonic noise.
- **Countermeasure:** The **Operatory Phone Beacon**. Clinicians scan a 4-digit PIN QR code on their smartphone, place it on the bracket table 30cm from the patient, and stream audio directly without needing PC administrative rights or hardware upgrades.

### Obstacle 4: Associate-to-Owner Buying Disconnect
- **The Reality:** Associate dentists want to leave work at 5:00 PM, but Practice Owners pay the bills and care about practice turnover and clinical liability.
- **Countermeasure:** Equip associates with the **Treatment Pipeline ROI pitch**: *"DentAI saved me 1.5 hours daily and automatically tracked $14,000 of unbooked crown and implant opportunities this month for your clinic."*

---

## 4. Timelines & Phased Execution Roadmap

```
┌─────────────────┐       ┌─────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  Phase 0: Base  │  ──►  │ Phase 1: Pilot  │  ──►  │ Phase 2: Scale   │  ──►  │ Phase 3: Mon.    │
│  Weeks 1 – 2    │       │ Weeks 3 – 6     │       │ Weeks 7 – 16     │       │ Months 4 – 8     │
│                 │       │                 │       │                  │       │                  │
│ Legal, Privacy, │       │ 10 Live Clinics │       │ 50 Clinics       │       │ 200+ Practices   │
│ Tier 2 AI Quota │       │ Founder on site │       │ Peer Study Clubs │       │ Paid Moat ($149) │
└─────────────────┘       └─────────────────┘       └──────────────────┘       └──────────────────┘
```

### Phase 0: Foundations & Compliance (Weeks 1 – 2)
- [x] Dual-stream audio engine with operatory acoustic constraints implemented.
- [ ] Retain Australian medical legal counsel; complete APP Privacy & Patient Consent Charter.
- [ ] Activate Paid Google Cloud Billing account with 300+ RPM quota.
- [ ] Print 30 Operatory Launch Kits (acrylic QR Phone Beacon stands + laminated dictation cards).

### Phase 1: The First 10 Alpha Practices (Weeks 3 – 6)
- **Target:** 10 friendly clinical practices (dental school peers, locums, warm contacts).
- **Execution:** In-person founder onboarding. Attend the morning huddle, set up the Phone Beacon on the bracket table, observe 3 real patient consults chairside.
- **Success Metric:** >= 8 out of 10 dentists actively using DentAI 4+ days a week; zero night-time charting backlog.

### Phase 2: Regional Virality & Study Clubs (Weeks 7 – 16)
- **Target:** 50 Daily Active Practices across Sydney, Melbourne, and Brisbane.
- **Execution:**
  1. Leverage locums rotating across multiple practices.
  2. Sponsor 2 local Clinical Study Clubs (e.g. Endodontic or Restorative study groups) providing free custom procedure templates.
  3. Publish organic operatory video walkthroughs on LinkedIn highlighting Clinical Light Mode under surgical lighting.
- **Success Metric:** 50 daily active clinics generating > 2,000 consultation notes per week.

### Phase 3: Commercial Monetization & DSO Expansion (Months 4 – 8)
- **Target:** Convert 25% of active clinics to Paid Practice Tier ($149 – $299 AUD/month).
- **Execution:** Trigger automated Practice Owner ROI reports: *"This month DentAI captured 12 unbooked crown candidates worth $19,200 in gross production."*
- **Success Metric:** $15,000+ AUD Monthly Recurring Revenue (MRR), achieving cash-flow breakeven.

---

## 5. Stakeholder & Ecosystem Map: Who Can Help?

| Role / Partner Category | Target Profiles & Organizations | How They Accelerate DentAI |
| :--- | :--- | :--- |
| **Clinical Champions (Key Opinion Leaders)** | Respected young CPD educators, clinical tutors at USyd / UMelb / UQ Dental Schools. | Test custom procedure templates (e.g. "Dr. Kumar's Rotary Endo Checklist") and share them with hundreds of student alumni. |
| **Locum Dentists** | Dentists registered with dental agency networks (e.g. Dental locum agencies across Australia/NZ). | Natural viral distribution: locums practice at 3–5 different clinics monthly, introducing DentAI to every practice owner. |
| **Australian Legal & Compliance Counsel** | Specialist healthcare IT lawyers (e.g. Meridian Lawyers, TressCox, or Holley Nethercote). | Review patient consent workflow, sign off on Privacy Act 1988 / APPs compliance, giving practice owners 100% legal confidence. |
| **Dental Practice Management Consultants** | Coaches advising dental practices on profitability (e.g. Prime Practice, Dental Engine). | Recommend DentAI’s **Treatment Revenue Moat** to clinic owners looking to increase treatment case acceptance without spending more on marketing. |
| **Operatory Support Champions** | Final-year dental hygiene or dental assisting students. | Part-time operatory setup assistants: visit clinics for 20 minutes to pair phone beacons, train assistants, and ensure smooth first-day adoption. |
| **Industry & Media Channels** | *Australasian Dentist* magazine, *Bite Magazine*, Australian Dental Association (ADA) state branch newsletters. | Thought leadership articles on "Combatting Clinician Burnout: How Ambient AI Scribing Restores the 5:00 PM Finish." |

---

## 6. Immediate Next Steps (Next 14 Days)

1. **Publish Privacy & Consent Pack:** Deploy the Australian Patient Consent & Privacy statement to `/privacy`.
2. **Setup Paid AI Pool:** Connect Google Cloud billing to unlock Tier 2 quota and eliminate 429 errors.
3. **Assemble First 5 Operatory Kits:** Order 5 Anker PowerConf microphones and 10 acrylic Phone Beacon stands for immediate practice drop-ins.
4. **Deploy Pilot Campaign:** Reach out to the first 10 pilot clinicians using the structured templates in [`OUTREACH_CAMPAIGN.md`](file:///c:/Users/swati/Downloads/dentai/OUTREACH_CAMPAIGN.md).
