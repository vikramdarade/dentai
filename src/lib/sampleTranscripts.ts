/**
 * Built-in sample audio transcripts — one realistic consultation per treatment
 * type, written the way a live en-AU speech-to-text stream would produce them.
 *
 * Purpose:
 *  - Let a dentist test every built-in note template in the live app with a
 *    one-click realistic transcript instead of inventing dialogue on the spot.
 *  - Act as a deterministic QA corpus: each transcript intentionally contains
 *    the clinical content its template's sections should capture (incl. spoken
 *    FDI tooth numbers, ADA item references, and occasional en-AU/accent
 *    phrasing quirks that exercise the accent-resilience layer).
 *
 * Conventions:
 *  - Senders alternate 'Dentist' / 'Patient' (matching the app's demo-case
 *    convention). A line tagged 'Clinical Comment' is dentist dictation typed
 *    directly, not captured speech.
 *  - Tooth numbers are often spoken as words or spaced digits ("tooth one six")
 *    so hosted AI and the offline draft engine both demonstrate FDI
 *    normalisation.
 *  - ADA item numbers are only ever spoken by the clinician with an explicit
 *    "item" flag — the same contract the draft engine enforces.
 */
import { AppointmentType } from './dentalLibrary';
import { TranscriptItem } from '../types';

export interface SampleTranscript {
  /** The treatment type (and therefore the built-in template) this tests. */
  appointmentType: AppointmentType;
  /** Short human title shown in the sample picker. */
  title: string;
  /** Typical patient for this consult — makes the transcript feel real. */
  patient: string;
  /** The simulated transcribed consultation. */
  items: TranscriptItem[];
}

export const SAMPLE_TRANSCRIPTS: SampleTranscript[] = [
  // 1 — Comprehensive Examination → AHPRA Standard (8-point)
  {
    appointmentType: 'examination',
    title: 'Comprehensive Exam',
    patient: 'Priya Sharma',
    items: [
      { sender: 'Dentist', text: "Good morning Priya, I'm Dr Kumar. What brings you in today for your check-up?" },
      { sender: 'Patient', text: "I've noticed a little bleeding when I brush my lower front teeth, and it's been a while since my last proper check." },
      { sender: 'Dentist', text: "And how long has the bleeding been happening for? Any pain or sensitivity anywhere?" },
      { sender: 'Patient', text: "A few months I think. No pain at all, just the bleeding, and my gums look a bit red in the mirror." },
      { sender: 'Dentist', text: "Okay, I'll do a full examination today and take two bitewing x-rays to check in between the back teeth. That will be item 026 for the two bitewings." },
      { sender: 'Clinical Comment', text: 'Extraoral examination NAD. Intraoral: mucosal tissues healthy. BPE scores of 2 in the lower anterior sextant, 1s elsewhere. No probing depths over 4 millimetres.' },
      { sender: 'Dentist', text: "I can see a small early cavity on the biting surface of tooth four six — it's just in the enamel at this stage, so we'll keep an eye on it rather than filling it today." },
      { sender: 'Patient', text: "Oh good. So nothing urgent then?" },
      { sender: 'Dentist', text: "Nothing urgent. The main thing is the gum inflammation from the plaque build-up along the gumline — a professional clean and better flossing will sort that out. Today's visit is item 011, the comprehensive examination." },
      { sender: 'Dentist', text: "I'd like to see you back in six months for a clean and a review of that early cavity on tooth 46. In the meantime, brush twice a day and start flossing the lower front teeth daily." }
    ]
  },

  // 2 — Scale & Clean → Hygiene template
  {
    appointmentType: 'scale_clean',
    title: 'Scale & Clean',
    patient: 'David Nguyen',
    items: [
      { sender: 'Dentist', text: "Morning David, how have your gums been since the last clean?" },
      { sender: 'Patient', text: "Honestly they still bleed when I brush, and I can feel a rough build-up behind my bottom teeth." },
      { sender: 'Dentist', text: "And are you still smoking about ten a day?" },
      { sender: 'Patient', text: "Yeah, trying to cut down but it's hard." },
      { sender: 'Clinical Comment', text: 'Medical history: otherwise well, no medications, no allergies. Smoker approximately 10/day. No diabetes, not pregnant.' },
      { sender: 'Dentist', text: "Right, let's have a look. There's moderate calculus on the lower front teeth from 32 across to 42, and the gum around there is inflamed and bleeding on gentle probing." },
      { sender: 'Patient', text: "That's the bit that feels rough." },
      { sender: 'Dentist', text: "The BPE is a 2 in the lower anteriors and 1s elsewhere, so no deep pockets — good news, no bone loss at this stage. The diagnosis is generalised plaque-induced gingivitis." },
      { sender: 'Dentist', text: "Today I'll do a full-mouth scale and clean with the ultrasonic and hand instruments to remove all the calculus — that's item 114 — then polish the teeth and finish with a fluoride varnish, item 121." },
      { sender: 'Dentist', text: "Afterwards I want you using an interdental brush in the lower front once a day, and I'd strongly encourage you to think about quitting smoking — I can point you to the Quit program. Given the smoking, I'd like to see you back in three months rather than six." },
      { sender: 'Patient', text: "Three months, okay. Thanks." }
    ]
  },

  // 3 — Emergency / Pain → Emergency template
  {
    appointmentType: 'emergency',
    title: 'Emergency / Pain',
    patient: 'John Mitchell',
    items: [
      { sender: 'Dentist', text: "John, this is an emergency visit — tell me what's been happening with the pain." },
      { sender: 'Patient', text: "It started about two days ago on the bottom left, and last night it was throbbing so bad I couldn't sleep. Cold drinks make it worse and the ache stays for a while after." },
      { sender: 'Dentist', text: "Any swelling of the face or cheek, or any difficulty swallowing?" },
      { sender: 'Patient', text: "No swelling yet, and I can swallow fine." },
      { sender: 'Clinical Comment', text: 'Medical screen: nil significant, no allergies, no regular medications. Patient reports no fever, no extraoral swelling.' },
      { sender: 'Dentist', text: "I'm going to take one periapical x-ray of that area — item 022 — and tap on the tooth to test it. This one here, tooth three six, is tender to percussion and reacts to cold with lingering pain." },
      { sender: 'Dentist', text: "The x-ray shows the decay is right into the nerve chamber. My diagnosis is symptomatic irreversible pulpitis with early apical involvement, and the tooth needs root canal treatment." },
      { sender: 'Patient', text: "Can you do something about the pain today at least?" },
      { sender: 'Dentist', text: "Yes — I'll numb the tooth and open into it today to release the pressure, then place a sedative dressing. That's the emergency treatment; the definitive root canal I'd like to book within the next few days. This emergency examination is item 013." },
      { sender: 'Dentist', text: "Take ibuprofen 400 milligrams with food every six hours as needed, and if you get any facial swelling or the pain gets worse before your appointment, call us immediately." }
    ]
  },

  // 4 — Restorative (Filling) → Restorative template
  {
    appointmentType: 'restorative',
    title: 'Restorative Filling',
    patient: 'Chloe Brown',
    items: [
      { sender: 'Dentist', text: "Chloe, you said something's been catching when you bite on the bottom right?" },
      { sender: 'Patient', text: "Yeah, the old filling on that back tooth — it feels like food keeps getting stuck around it." },
      { sender: 'Dentist', text: "Any sensitivity to cold or sweet at all?" },
      { sender: 'Patient', text: "A tiny bit of cold sensitivity, but it goes away quickly." },
      { sender: 'Clinical Comment', text: 'Sensibility: tooth 46 responds within normal limits to cold, no lingering response. No tenderness to percussion. Radiograph shows a defective distal margin with caries beneath the existing DO composite.' },
      { sender: 'Dentist', text: "I can see the old filling on tooth four six has a cracked margin with decay underneath it — that's why things are getting stuck. The nerve is still healthy, so we'll replace the filling today rather than needing a root canal." },
      { sender: 'Patient', text: "Good, I'd rather not go through that." },
      { sender: 'Dentist', text: "I'll isolate the tooth with a rubber dam, remove the old composite and the decay — the cavity is into dentine but not near the pulp — then place a new composite filling, shade A2, to match your other teeth. That's item 511 for the two-surface filling." },
      { sender: 'Dentist', text: "I'll check the bite with articulating paper to make sure there are no high spots, and polish it smooth. While the numbness lasts, be careful chewing on that side for a couple of hours." },
      { sender: 'Dentist', text: "A little sensitivity in the first few days is normal; if it lingers beyond that, give us a call. Otherwise I'll see you at your routine recall in six months." }
    ]
  },

  // 5 — Endodontic (Root Canal) → Endo template
  {
    appointmentType: 'endodontic',
    title: 'Endodontic / Root Canal',
    patient: 'Sam Whitfield',
    items: [
      { sender: 'Dentist', text: "Sam, you had that deep filling on the upper left about a month ago and then the pain — tell me how it's been." },
      { sender: 'Patient', text: "The sharp pain settled, but it's been a dull ache on and off, and the tooth feels a bit different when I press on it." },
      { sender: 'Dentist', text: "Any swelling, sinus, or a bad taste?" },
      { sender: 'Patient', text: "No, none of that." },
      { sender: 'Clinical Comment', text: 'Tooth 26: tender to percussion and palpation over the apex. Cold test negative — tooth non-vital. No mobility, no periodontal pocketing. Pre-op radiograph shows a large composite with a periapical radiolucency at the apex of the palatal root.' },
      { sender: 'Dentist', text: "The nerve in tooth two six has died, and there's an infection shadow at the tip of the root on the x-ray. The diagnosis is necrotic pulp with asymptomatic apical periodontitis, and the tooth needs root canal treatment over two visits." },
      { sender: 'Patient', text: "Okay, let's just get it sorted." },
      { sender: 'Dentist', text: "Today I'll do the first stage: numbing the tooth, placing a rubber dam, opening access, and removing the dead nerve tissue — that's item 414 for the extirpation. I measured the working length at twenty-one millimetres on the first canal." },
      { sender: 'Dentist', text: "I've cleaned and shaped the canals with rotary files, irrigated thoroughly with sodium hypochlorite, and placed a medicated dressing inside. I'll see you back in two weeks to finish and fill the canals — item 415 — and after that the tooth will need a crown to protect it." },
      { sender: 'Dentist', text: "Until then, avoid chewing hard foods on that side and take simple pain relief if needed. If you get any swelling, call us straight away." }
    ]
  },

  // 6 — Surgical (Extraction) → Surgical template
  {
    appointmentType: 'surgical',
    title: 'Surgical Extraction',
    patient: 'Alan Foster',
    items: [
      { sender: 'Dentist', text: "Alan, we're taking that wisdom tooth out today — tooth four eight. Just to confirm the reason: it's only partly come through, and every time it flares up you get pain and swelling around the gum." },
      { sender: 'Patient', text: "Yeah, it flared up again last week. I'm over it." },
      { sender: 'Dentist', text: "Before we start — any blood-thinning medication, anything for osteoporosis, or any allergies? And you're happy with the risks and benefits we talked through, including the small chance of nerve tingling?" },
      { sender: 'Patient', text: "No blood thinners, no allergies. And yes, I've signed the consent form." },
      { sender: 'Clinical Comment', text: 'Pre-op radiograph: tooth 48 mesioangular, partial bony impaction, roots converging. No periapical pathology. Medical screen clear — ASA I.' },
      { sender: 'Dentist', text: "So my diagnosis is recurrent pericoronitis around a partially impacted tooth 48, and we've agreed the best option is to remove it today. I'll numb the area with local anaesthetic — articaine with adrenaline — and because the tooth is partly buried I'll lift a small gum flap, remove a little bit of bone, and section the tooth to remove it in two pieces." },
      { sender: 'Dentist', text: "Okay, the tooth's out cleanly, I've placed three resorbable sutures, and there's good clot in the socket. Bite firmly on this gauze for thirty minutes. That was item 311, a surgical removal." },
      { sender: 'Dentist', text: "For today: ice pack on the cheek ten minutes on, ten minutes off for the first few hours. Soft diet, no hot food or drinks, don't rinse vigorously for twenty-four hours, and no smoking for at least forty-eight hours — that's really important for the healing." },
      { sender: 'Dentist', text: "Take ibuprofen four hundred milligrams with food as needed. If the pain or swelling gets worse after two or three days, or you have heavy bleeding, call the practice. I'll see you back in about seven days to check the healing." }
    ]
  },

  // 7 — Prosthodontic (Crown & Bridge) → Prostho template
  {
    appointmentType: 'prosthodontic',
    title: 'Crown Preparation',
    patient: 'Teresa Lucas',
    items: [
      { sender: 'Dentist', text: "Teresa, you've had that crown on the upper left for a while — what have you noticed?" },
      { sender: 'Patient', text: "It feels a bit loose, and I think food's getting underneath it. The gum around it is a bit sore too." },
      { sender: 'Dentist', text: "Let's have a look and take an x-ray to check what's happening at the margin and under the crown." },
      { sender: 'Clinical Comment', text: 'Tooth 26: existing PFM crown loose with recurrent caries at the mesial margin visible on radiograph. Tooth is asymptomatic, responds normally, and has adequate remaining coronal structure. Percussion negative.' },
      { sender: 'Dentist', text: "The old crown has decay underneath it at the edge, which is why it's loosened. The tooth itself is still healthy, so the plan is to replace it with a new crown." },
      { sender: 'Patient', text: "Will I have to go without a tooth?" },
      { sender: 'Dentist', text: "No — today I'll take the old crown off, remove the decay, build the tooth up with a composite core, and prepare it for a new crown. I'll take a mould and fit you with a temporary crown so you're never without a tooth. This preparation is item 572." },
      { sender: 'Dentist', text: "I've matched the shade to your other teeth — A2 — and taken the final impression in silicone. The temporary crown's cemented with a soft cement and the bite's been checked so it's comfortable." },
      { sender: 'Dentist', text: "For the next two weeks, avoid sticky or very hard foods on that side — lollies and crusty bread are the usual culprits — and if the temporary ever comes off, keep it and call us. Your new crown will be ready in about two weeks and we'll cement it in then." }
    ]
  },

  // 8 — Paediatric (Child) → Paediatric template
  {
    appointmentType: 'paediatric',
    title: 'Paediatric Check-up',
    patient: 'Lily Nguyen (age 6)',
    items: [
      { sender: 'Dentist', text: "Hi Lily, I'm Dr Patel. And Mum, what brings you in today?" },
      { sender: 'Patient', text: "It's her first big check-up and the school sent a form asking us to see a dentist. She's also said sweets sometimes make one of her back teeth hurt." },
      { sender: 'Dentist', text: "Thanks. Lily, can you open nice and wide like a lion for me? Good girl. Any medical conditions or medicines, Mum? And how does she go with brushing?" },
      { sender: 'Patient', text: "No medical problems. She brushes morning and night but I have to remind her, and she does love her juice boxes." },
      { sender: 'Clinical Comment', text: 'Behaviour: cooperative throughout, Frankl 4. Tell-show-do used. All primary teeth present, plus first permanent molars 16 and 26 erupted. No caries detected on any primary teeth. Tooth 54 responds normally; no visible lesion.' },
      { sender: 'Dentist', text: "The teeth look great, Mum — no holes at all. The soreness with sweets is likely just the new adult molars coming through. Because they're brand new with deep grooves, I'd like to protect them with a tooth-coloured sealant on the two top molars today — that's item 161 for each tooth — and then a fluoride varnish over everything, item 121." },
      { sender: 'Patient', text: "That sounds good. Will she sit still for it?" },
      { sender: 'Dentist', text: "Lily was fantastic. All done — sealants on the top molars and the fluoride varnish is on. She can eat and drink straight away, just nothing too hot." },
      { sender: 'Dentist', text: "For home: keep up the twice-daily brushing with a pea-sized amount of standard fluoride toothpaste, and let's swap the juice boxes for water — the sugar in juice is the biggest cause of decay in kids her age. I'll sign the school form on the way out." },
      { sender: 'Dentist', text: "I'd like to see Lily back in six months for a routine check, and we'll do the bottom molars with sealants once they're fully through." }
    ]
  }
];

/** Returns the sample transcript that matches a given treatment type, if any. */
export const getSampleForType = (type: AppointmentType): SampleTranscript | undefined =>
  SAMPLE_TRANSCRIPTS.find((s) => s.appointmentType === type);
