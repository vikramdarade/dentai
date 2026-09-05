# Multi-Clinic Support — Validation Sheet for Dentists

**What this is:** We're considering letting a dental practice run DentAI across several clinics — one owner, several sites, shared standards, and a simple way for colleagues to join. Before we build it, we need your answers. Circle a rating for each feature and answer the questions at the end. Five minutes, honest answers.

---

## The idea in 60 seconds

1. **Every clinic gets its own code** — e.g. `SMILE42`. You share it with associates, locums, or colleagues at other practices.
2. **Joining is one step** — a dentist registers, types in your code, and lands as a *pending member*. You approve them. No admin accounts to create.
3. **You see your whole practice** — the owner can view notes across all their clinics; dentists see their own. A dentist who works at two clinics switches between them with one tap.
4. **Clinic standards stay consistent** — the clinic can set note templates once and every dentist in the practice gets them (still optional for now — see Q3).

---

## What it would look like

**Sign-up (dentist side)** — one extra optional field:

```
┌─────────────────────────────────────────────┐
│  Your name          Dr. Priya Sharma        │
│  4-digit PIN        ••••                    │
│  Specialty          General                 │
│  Clinic code        SMILE42        [optional]
│                                             │
│  [ Create account ]                         │
└─────────────────────────────────────────────┘
```

**Clinic switcher (top of the app)** — for dentists who work at more than one clinic:

```
┌───────────────────────────────────────────┐
│  DentAI      [ Parramatta ⌄ ]   History Hub│
└───────────────────────────────────────────┘
              Parramatta
              Bondi Junction
              + Join another clinic (code)
```

**Owner's Members screen** — approve joins, see who's in your practice, copy or rotate the code:

```
┌───────────────────────────────────────────────┐
│  Members — Parramatta            Invite code  │
│  ─────────────────────           SMILE42      │
│  Dr. Priya Sharma   Owner        [ Copy ]     │
│  Dr. David Nguyen   Dentist      [ New code ] │
│  Dr. Emma Walsh     Pending       (if leaked) │
│        [ Approve ]  [ Decline ]               │
└───────────────────────────────────────────────┘
```

**Owner's view** — a practice owner can see all notes across their clinics; a dentist still sees only their own.

---

## Feature ratings

| # | Feature | Must have | Nice to have | Not needed |
|---|---------|:---:|:---:|:---:|
| 1 | Clinic code to join (invite a colleague) | | | |
| 2 | Owner approves new members before they see anything | | | |
| 3 | Clinic switcher for dentists working at multiple clinics | | | |
| 4 | Owner can see all notes across their clinics | | | |
| 5 | Clinic sets one note-template standard for all its dentists | | | |
| 6 | Clinic name/address printed on notes and patient letters | | | |
| 7 | Practice owner dashboard (patients seen, notes done, per clinic) | | | |

---

## Questions

1. **Who uses it at your clinic** — just dentists, or also a practice manager / front desk who needs to see *all* notes?
2. **Do the same dentists work across multiple of your clinics** (or locums visit), or does each dentist belong to one site?
3. **Note templates: one clinic-wide standard, or each dentist's own preference?** (Owners usually want the first; dentists often want the second.)
4. **If you have independent clinics** (not one group), should they be fully separate — never able to see each other's records — or is shared owner-level visibility fine?
5. **Do patients visit more than one of your sites?** If yes, should a patient's record follow them across clinics?
6. **Who should be allowed to add/invite dentists to a clinic** — only the owner, or any member?
7. **The referral side:** would you register with a colleague's clinic code? And are you comfortable with your clinic's name being shown when someone joins via *your* code? (This is how the app spreads practice-to-practice.)
8. **How would you actually share your clinic's code** — with associates and locums, at CPD events, in dental groups, or with colleagues at other practices?

---

## What we'd build first (if you say go)

Clinic codes + owner approval + clinic switcher + owner's members screen. Everything else on the rating table follows from what you mark as must-have.

*Please send back your circled ratings and any answers. Nothing is built yet — this decides what gets built.*