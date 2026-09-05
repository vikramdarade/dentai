# DentAI Ecosystem & Growth Loop (Internal)

**What this is:** How DentAI becomes a self-contained ecosystem where word of mouth and referral are built into the product — not bolted on as marketing. Companion to `multi-clinic-validation.md` (the dentist-facing sheet). This doc is internal; do not share verbatim.

---

## The thesis

In a clinical product, word of mouth is two things compounding:

1. The product produces a moment good enough that a dentist **wants to be associated with it** ("we chart everything on DentAI now").
2. There is a **friction-free, professionally credible** way to bring a colleague in.

The clinic invite code solves (2). The ecosystem is what makes the code *worth sharing* — and that is mostly product, not marketing.

## The loop

```
1. Wow moment ──► 2. Natural trigger ──► 3. Friction-free artifact ──► 4. Trust gate ──► 5. Visible growth
   note finished      locum covers a         short, sayable              owner approval,      owner sees their
   in seconds at      shift / colleague      clinic code                 audited join,        network grow on the
   chairside          asks how they run      (e.g. SMILE42)              no data shared       Members screen
                      recall / CPD group
```

Each step must be nearly effortless or the loop dies there. Most referral loops die at step 3 (no artifact) or step 5 (the referrer never sees anything happen).

## The layers — and the order to build them

### Layer 0 — The reason to refer (do not skip)
The most viral artifact in this product is not a link — it is a **template**. "Here's how our clinic charts a crown prep" is a conversation dentists already have; a shareable template is the handshake. Ensure a clinic's note standards are something an owner is proud to show a colleague. That is the organic content engine of a clinical product.

### Layer 1 — The growth primitive (agreed with validation sheet)
Clinic entity + invite code + pending join + owner approval + Members screen (copy / rotate code). Small, and the spine everything else hangs on.

### Layer 2 — Network visibility (the compounding part)
Owner dashboard shows the funnel with zero extra tooling:

```
code issued → joins requested → approved → active (notes per week)
```

Not vanity metrics — it tells us whether word of mouth is real per clinic, and it is the only "reward" needed at first. Dentists are motivated by seeing that their recommendation mattered.

### Layer 3 — Referral program (only later, only if validation supports it)
- If DentAI monetizes: referral credit framed as a practice benefit ("3 months free for your practice"), never cash-per-signup.
- Association / CPD partnerships after that.
- Never leaderboards, never gamified spam, never contact scraping — in clinical software, discretion **is** the brand.

## Guardrails

1. **Do not ship referral rewards before the wow moment is proven.** Rewards on a product that is not yet loved just buy churn. The code flow gives us the measurement channel now; the reward is a dial to turn later.
2. **Referral mechanics are owner-visible and patient-invisible.** Nothing about who is in which clinic is ever shown outside it; no dentist ever feels tracked. If a dentist suspects joining a code surfaces their name publicly, the loop dies. Trust is the constraint that makes everything else work.
3. **One code per clinic, not per person.** Joining = the clinic's code. Personal referral attribution is a separate, optional hook later ("who told you about DentAI?" at signup). Do not merge the two concepts — it makes the data model messy for no gain.
4. **Keep the language professional.** "Invite friends, earn rewards" feels gimmicky in clinical software and can spook dentists. "Bring your network onto DentAI" in CPD/association contexts, not gamified referral spam. No auto-invites, no scraping — purely opt-in.

## Built-in measurement

- The invite table **is** the growth analytics: codes issued → joins requested → approved → active. 
- Segment the funnel by acquisition path: joined via owner's code / colleague's code / no code (organic). That tells us where word of mouth is real vs. where we are pushing.
- Later, if referral hooks ship: join attribution (clinic code) stays separate from referrer attribution (optional personal code) in the data model.

## Sequencing relative to validation

- The dentist-facing sheet (`multi-clinic-validation.md`) covers the *clinic features*. This doc covers the *ecosystem*.
- Q7 and Q8 on that sheet are the ecosystem signal: would they register with a colleague's code, and how would they actually share theirs? If the answers suggest the code is only ever shared internally (associates/locums), the growth story is retention, not acquisition — build Layer 1 and stop. If dentists describe sharing at CPD events and with other practices, Layers 2–3 earn their place.
- Do not put marketing-engine questions in front of dentists. Let the clinic-feature answers tell us whether the organic loop is real before building incentives on top of it.
