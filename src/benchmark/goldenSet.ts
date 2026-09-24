/**
 * Australian Dental Operatory Golden-Set Benchmark Suite (Work Package 6.1)
 *
 * 20 multi-condition clinical encounters covering:
 * - Broad Australian accents and ESL clinicians
 * - Masked/PPE speech vs unmasked speech
 * - Operatory acoustic noise: Handpiece turbine (5,000–7,500 Hz), high-volume suction, ultrasonic scalers
 * - Full spectrum of Australian dental disciplines & ADA schedule codes
 * - Critical pharmacology safety triggers (Warfarin, Prolia, Penicillin anaphylaxis, Adrenaline)
 */

import type { GoldenSetCase } from './types';

export const GOLDEN_SET_BENCHMARK_CASES: GoldenSetCase[] = [
  // Case 01: Emergency Restorative
  {
    id: 'case-01',
    title: 'Emergency Restorative - Fractured Cusp Tooth 36',
    discipline: 'restorative',
    appointmentType: 'emergency',
    patientName: 'David Miller',
    patientDob: '1984-06-15',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Good morning David. Tell me what happened with your tooth.' },
      { sender: 'Patient', text: 'I bit down on an olive pip yesterday and felt a sharp crack in the lower left molar.' },
      { sender: 'Dentist', text: 'Examining the lower left quadrant. Tooth 36 has a fractured disto-occlusal cusp with exposed dentine. Cold test is normal and vital. No percussion tenderness.' },
      { sender: 'Dentist', text: 'Administered 2.2 millilitres of 2% lignocaine with 1:80,000 adrenaline via inferior alveolar nerve block. Tooth 36 isolated under rubber dam. Placed direct composite resin restoration two surfaces, ADA item 532.' }
    ],
    expectedClinicalConcepts: [
      'fractured', 'disto-occlusal', 'cusp', 'tooth 36', 'exposed dentine',
      'cold test normal vital', 'lignocaine', 'rubber dam', 'composite resin', '532'
    ],
    expectedFdiTeeth: [36],
    expectedAdaCodes: ['532']
  },

  // Case 02: Molar Endodontics with Broad Australian Accent
  {
    id: 'case-02',
    title: 'Molar Endodontics - Irreversible Pulpitis Tooth 16',
    discipline: 'endodontics',
    appointmentType: 'emergency',
    patientName: 'Garry Thorne',
    patientDob: '1976-11-03',
    acousticCondition: 'clean_operatory',
    accentCondition: 'broad_australian',
    transcript: [
      { sender: 'Dentist', text: 'G\'day Garry, fair dinkum looks like you have had a rough night with that top tooth.' },
      { sender: 'Patient', text: 'Bloody oath doc, couldn\'t sleep a wink. Throbbing pain in the upper right side keeping me awake.' },
      { sender: 'Dentist', text: 'Testing tooth 16. Cold test causes lingering throbbing pain over 30 seconds. Diagnosis is severe irreversible pulpitis on tooth 16.' },
      { sender: 'Dentist', text: 'Infiltrated 4% articaine with 1:100,000 adrenaline. Placed rubber dam on tooth 16, accessed pulp chamber, negotiated three canals. Extirpated inflamed pulp tissue and dressed canals with Ledermix and Cavit temporary filling, ADA 411 and 412.' }
    ],
    expectedClinicalConcepts: [
      'throbbing pain', 'tooth 16', 'irreversible pulpitis', 'articaine',
      'rubber dam', 'extirpated', 'ledermix', 'cavit', '411', '412'
    ],
    expectedFdiTeeth: [16],
    expectedAdaCodes: ['411', '412']
  },

  // Case 03: Surgical Exodontia with Mask/PPE & Suction Noise
  {
    id: 'case-03',
    title: 'Surgical Exodontia - Impacted Wisdom Tooth 38',
    discipline: 'surgical_exodontia',
    appointmentType: 'surgical',
    patientName: 'Liam Chen',
    patientDob: '2001-09-22',
    acousticCondition: 'muffled_ppe_surgical_mask',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Liam, we are proceeding with surgical removal of your partially erupted impacted lower left wisdom tooth 38 today.' },
      { sender: 'Dentist', text: 'IAN block given. Raised full-thickness mucoperiosteal flap. Conservative bone guttering performed. Tooth 38 sectioned through crown and roots elevated cleanly.' },
      { sender: 'Dentist', text: 'Irrigated surgical socket thoroughly with sterile saline. Placed two 3-0 silk sutures, ADA item 314 and 324. Discussed post-operative warnings regarding swelling, dry socket, and temporary nerve paresthesia.' }
    ],
    expectedClinicalConcepts: [
      'surgical removal', 'impacted', 'tooth 38', 'mucoperiosteal flap',
      'bone guttering', 'sectioned', 'sutures', 'dry socket', '314', '324'
    ],
    expectedFdiTeeth: [38],
    expectedAdaCodes: ['314', '324']
  },

  // Case 04: Periodontal Staging & Handpiece Noise
  {
    id: 'case-04',
    title: 'Periodontitis Staging & Ultrasonic Debridement',
    discipline: 'periodontics',
    appointmentType: 'scale_clean',
    patientName: 'Helen Papadopoulos',
    patientDob: '1965-03-14',
    acousticCondition: 'turbine_handpiece_noise',
    accentCondition: 'esl_mediterranean',
    transcript: [
      { sender: 'Dentist', text: 'Helen, we are completing your full periodontal charting today.' },
      { sender: 'Dentist', text: 'Deep periodontal pockets noted: tooth 16 mesio-buccal 6 millimetres, tooth 26 disto-palatal 7 millimetres, tooth 46 mesial 5 millimetres. Generalized subgingival calculus and bleeding on probing.' },
      { sender: 'Dentist', text: 'Diagnosis is Generalized Stage III Grade B Periodontitis. Completed quadrant ultrasonic scaling and subgingival root debridement under local anaesthetic, ADA items 222 and 250.' }
    ],
    expectedClinicalConcepts: [
      'periodontal charting', 'tooth 16', 'tooth 26', 'tooth 46',
      'periodontitis', 'subgingival calculus', 'ultrasonic scaling', 'root debridement', '222', '250'
    ],
    expectedFdiTeeth: [16, 26, 46],
    expectedAdaCodes: ['222', '250']
  },

  // Case 05: Fixed Prosthodontics Monolithic Zirconia Crown
  {
    id: 'case-05',
    title: 'Full Crown Preparation Tooth 14',
    discipline: 'fixed_prosthodontics',
    appointmentType: 'prosthodontic',
    patientName: 'Robert Campbell',
    patientDob: '1979-12-08',
    acousticCondition: 'turbine_handpiece_noise',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Robert, ready to prepare tooth 14 for a full monolithic zirconia crown today.' },
      { sender: 'Dentist', text: 'Tooth 14 has extensive cracked tooth lines on the mesial and distal marginal ridges.' },
      { sender: 'Dentist', text: 'Administered 2.2ml lignocaine. Completed 1.2mm circumferential shoulder preparation on tooth 14 with rounded internal line angles. Placed retraction cord size 00.' },
      { sender: 'Dentist', text: 'Took 3D digital intraoral scan for laboratory fabrication of zirconia crown. Fabricated and cemented provisional acrylic crown with Temp-Bond, ADA 611 and 627.' }
    ],
    expectedClinicalConcepts: [
      'tooth 14', 'zirconia crown', 'cracked tooth', 'shoulder preparation',
      'retraction cord', 'digital scan', 'provisional crown', '611', '627'
    ],
    expectedFdiTeeth: [14],
    expectedAdaCodes: ['611', '627']
  },

  // Case 06: Removable Prosthodontics Chrome Framework Try-in
  {
    id: 'case-06',
    title: 'Partial Denture Framework Try-in & Bite Registration',
    discipline: 'removable_prosthodontics',
    appointmentType: 'prosthodontic',
    patientName: 'Evelyn Murphy',
    patientDob: '1952-08-30',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Good morning Evelyn, we have the cast cobalt-chrome metal framework back from the laboratory for your lower jaw.' },
      { sender: 'Dentist', text: 'Checked lower chrome-cobalt framework intraorally. Rests on tooth 34 and tooth 44 fully seated with positive fit. Clasp arms engage correct retentive undercuts.' },
      { sender: 'Dentist', text: 'Registered centric occlusion bite relation with wax rim and Regisil bite registration material, ADA 721 and 722. Selected tooth shade A3 for denture teeth.' }
    ],
    expectedClinicalConcepts: [
      'cobalt chrome', 'framework', 'tooth 34', 'tooth 44',
      'rests', 'centric occlusion', 'bite registration', '721', '722'
    ],
    expectedFdiTeeth: [34, 44],
    expectedAdaCodes: ['721', '722']
  },

  // Case 07: Paediatric Dentistry Primary Dentition
  {
    id: 'case-07',
    title: 'Paediatric Pulpotomy & Stainless Steel Crown Tooth 85',
    discipline: 'paediatric',
    appointmentType: 'paediatric',
    patientName: 'Noah Patel',
    patientDob: '2019-04-10',
    acousticCondition: 'clean_operatory',
    accentCondition: 'esl_indian_subcontinent',
    transcript: [
      { sender: 'Dentist', text: 'Hello Noah, we are giving your tooth a shiny superhero silver hat today.' },
      { sender: 'Dentist', text: 'Administered nitrous oxide relative analgesia at 40% oxygen 60% nitrous mix. Infiltrated 1.0ml 2% lignocaine.' },
      { sender: 'Dentist', text: 'Deep occlusal caries on primary molar tooth 85 into pulp. Performed coronal pulpotomy, achieved haemostasis, placed MTA mineral trioxide aggregate over radicular pulp stumps.' },
      { sender: 'Dentist', text: 'Crimped, contoured, and cemented preformed stainless steel crown on primary tooth 85 with glass ionomer cement, ADA 415, 576, and 943.' }
    ],
    expectedClinicalConcepts: [
      'tooth 85', 'primary molar', 'nitrous oxide', 'pulpotomy',
      'haemostasis', 'stainless steel crown', '415', '576', '943'
    ],
    expectedFdiTeeth: [85],
    expectedAdaCodes: ['415', '576', '943']
  },

  // Case 08: Preventive & Scaling with Ultrasonic Noise
  {
    id: 'case-08',
    title: 'Routine Examination, Prophylaxis & Topical Fluoride',
    discipline: 'preventive',
    appointmentType: 'scale_clean',
    patientName: 'Emma Watson',
    patientDob: '1995-07-19',
    acousticCondition: 'ultrasonic_scaler_noise',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Emma, routine six-month dental checkup today.' },
      { sender: 'Dentist', text: 'Comprehensive examination completed: all teeth present and intact. Mild marginal gingivitis along lingual anterior mandibular teeth 31, 32, 41, 42.' },
      { sender: 'Dentist', text: 'Removed supragingival calculus using ultrasonic scaler. Polished teeth with fine pumice paste. Applied 5% sodium fluoride varnish to all enamel surfaces, ADA items 111, 114, and 121.' }
    ],
    expectedClinicalConcepts: [
      'examination', 'gingivitis', 'tooth 31', 'tooth 32', 'tooth 41', 'tooth 42',
      'supragingival calculus', 'ultrasonic', 'fluoride varnish', '111', '114', '121'
    ],
    expectedFdiTeeth: [31, 32, 41, 42],
    expectedAdaCodes: ['111', '114', '121']
  },

  // Case 09: Implant Consultation & CBCT
  {
    id: 'case-09',
    title: 'Dental Implant Assessment Edentulous Site 46',
    discipline: 'implantology',
    appointmentType: 'examination',
    patientName: 'Brian Scott',
    patientDob: '1970-05-18',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Brian, examining the edentulous space for dental implant planning in the lower right first molar site, tooth 46.' },
      { sender: 'Dentist', text: 'Site 46 has been healed for 6 months post-extraction. Adequate keratinized attached gingiva. Inter-occlusal clearance measures 8 millimetres.' },
      { sender: 'Dentist', text: 'Referred for cone beam computed tomography CBCT 3D scan to assess alveolar bone ridge width and height above the inferior alveolar nerve canal, ADA 688 and 026.' }
    ],
    expectedClinicalConcepts: [
      'implant', 'edentulous space', 'tooth 46', 'keratinized gingiva',
      'inter-occlusal', 'cbct', 'alveolar bone', '688', '026'
    ],
    expectedFdiTeeth: [46],
    expectedAdaCodes: ['688', '026']
  },

  // Case 10: Bruxism & Hard Acrylic Occlusal Splint
  {
    id: 'case-10',
    title: 'Nocturnal Bruxism & Upper Occlusal Splint',
    discipline: 'tmj_bruxism',
    appointmentType: 'examination',
    patientName: 'Chloe Bennett',
    patientDob: '1992-02-14',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Chloe reports morning jaw muscle tightness, tension headaches, and partner notes loud tooth grinding at night.' },
      { sender: 'Dentist', text: 'Intraoral examination demonstrates severe incisal attrition across teeth 11, 12, 21, 22 and bilateral masseter muscle hypertrophy consistent with nocturnal bruxism. TMJ without clicks or crepitus.' },
      { sender: 'Dentist', text: 'Took upper and lower impressions and facebow bite record for fabrication of a custom maxillary hard acrylic flat-plane occlusal splint nightguard, ADA 965.' }
    ],
    expectedClinicalConcepts: [
      'bruxism', 'incisal attrition', 'tooth 11', 'tooth 12', 'tooth 21', 'tooth 22',
      'masseter hypertrophy', 'occlusal splint', 'nightguard', '965'
    ],
    expectedFdiTeeth: [11, 12, 21, 22],
    expectedAdaCodes: ['965']
  },

  // Case 11: Clear Aligner Orthodontic Assessment
  {
    id: 'case-11',
    title: 'Orthodontic Evaluation & Interproximal Reduction Plan',
    discipline: 'orthodontics',
    appointmentType: 'examination',
    patientName: 'Sophie Taylor',
    patientDob: '1998-10-25',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Sophie presents for clear aligner orthodontic evaluation regarding lower front crowding.' },
      { sender: 'Dentist', text: 'Class I molar and canine relationships. Moderate crowding of 4.5 millimetres across mandibular incisors 31, 32, 41, 42. Overjet 2mm, overbite 25%.' },
      { sender: 'Dentist', text: 'Treatment plan: Clear aligner therapy with planned interproximal reduction IPR 0.3mm between 32-31 and 41-42, composite attachments, ADA 014 and 881.' }
    ],
    expectedClinicalConcepts: [
      'clear aligner', 'class i', 'crowding', 'tooth 31', 'tooth 32', 'tooth 41', 'tooth 42',
      'interproximal reduction', 'ipr', 'attachments', '014', '881'
    ],
    expectedFdiTeeth: [31, 32, 41, 42],
    expectedAdaCodes: ['014', '881']
  },

  // Case 12: Deep Caries & Indirect Pulp Capping with Biodentine
  {
    id: 'case-12',
    title: 'Selective Caries Removal & Biodentine Pulp Cap Tooth 26',
    discipline: 'restorative',
    appointmentType: 'restorative',
    patientName: 'Marcus Wong',
    patientDob: '1987-01-11',
    acousticCondition: 'turbine_handpiece_noise',
    accentCondition: 'esl_east_asian',
    transcript: [
      { sender: 'Dentist', text: 'Marcus, we are treating the very deep cavity on upper left molar tooth 26 today.' },
      { sender: 'Dentist', text: 'Bitewing radiograph shows extensive carious lesion extending into inner third of dentine close to pulp chamber on tooth 26.' },
      { sender: 'Dentist', text: 'Local infiltration 4% articaine. Rubber dam isolated tooth 26. Selective peripheral caries excavation leaving leathery affected dentine over pulp.' },
      { sender: 'Dentist', text: 'Placed Biodentine bioactive calcium silicate indirect pulp cap over axial wall, followed by bonded composite resin restoration three surfaces, ADA 533 and 417.' }
    ],
    expectedClinicalConcepts: [
      'deep cavity', 'tooth 26', 'selective caries', 'rubber dam',
      'biodentine', 'indirect pulp cap', 'composite resin', '533', '417'
    ],
    expectedFdiTeeth: [26],
    expectedAdaCodes: ['533', '417']
  },

  // Case 13: Alveolar Osteitis (Dry Socket) Emergency Treatment
  {
    id: 'case-13',
    title: 'Dry Socket Dressing Tooth 48',
    discipline: 'oral_medicine',
    appointmentType: 'emergency',
    patientName: 'Jordan Reed',
    patientDob: '1994-08-04',
    acousticCondition: 'high_volume_suction',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Jordan returned with severe throbbing deep jaw pain four days following extraction of lower right wisdom tooth 48.' },
      { sender: 'Dentist', text: 'Examination of socket 48 reveals loss of blood clot, exposed bare bone, foul odour, and exquisite tenderness to touch. Diagnosis: Alveolar osteitis dry socket.' },
      { sender: 'Dentist', text: 'Gently irrigated extraction socket 48 with warm sterile saline. Placed Alveogyl soothing antiseptic dressing containing eugenol into socket, ADA 393. Prescribed paracetamol and ibuprofen.' }
    ],
    expectedClinicalConcepts: [
      'throbbing pain', 'tooth 48', 'socket', 'alveolar osteitis', 'dry socket',
      'bare bone', 'saline', 'alveogyl', '393'
    ],
    expectedFdiTeeth: [48],
    expectedAdaCodes: ['393']
  },

  // Case 14: Medical Alert - Warfarin & High Bleeding Risk
  {
    id: 'case-14',
    title: 'Medical Alert: Anticoagulant Warfarin & Simple Extraction Tooth 25',
    discipline: 'surgical_exodontia',
    appointmentType: 'surgical',
    patientName: 'Arthur Jenkins',
    patientDob: '1948-11-20',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Arthur is here for extraction of non-restorable tooth 25. Medical history: Atrial fibrillation on daily Warfarin blood thinner.' },
      { sender: 'Dentist', text: 'Verified morning INR result: 2.3, which is within safe dental surgical range below 3.0.' },
      { sender: 'Dentist', text: 'Administered 2% lignocaine with 1:80,000 adrenaline. Carefully luxated and delivered tooth 25 with forceps. Preserved cortical bone plates.' },
      { sender: 'Dentist', text: 'Packaged socket with Surgicel oxidized cellulose hemostatic dressing and secured with cross-stitch resorbable suture to prevent post-operative bleeding, ADA 311. Instructed patient to bite on gauze for 45 minutes.' }
    ],
    expectedClinicalConcepts: [
      'extraction', 'tooth 25', 'warfarin', 'inr', 'surgicel',
      'hemostatic', 'suture', 'bleeding', '311'
    ],
    expectedFdiTeeth: [25],
    expectedAdaCodes: ['311'],
    expectedSafetyTriggers: [
      {
        drugOrAllergy: 'Warfarin',
        expectedAlertKind: 'contraindication',
        requiredWarningSubstring: 'anticoagulant'
      }
    ]
  },

  // Case 15: Medical Alert - Prolia / Denosumab & MRONJ Risk
  {
    id: 'case-15',
    title: 'Medical Alert: Prolia (Denosumab) & Osteonecrosis MRONJ Risk Tooth 47',
    discipline: 'restorative',
    appointmentType: 'emergency',
    patientName: 'Margaret Hughes',
    patientDob: '1946-06-12',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Margaret attends complaining of pain on biting lower right tooth 47.' },
      { sender: 'Dentist', text: 'CRITICAL MEDICAL ALERT: Patient receives subcutaneous Prolia (Denosumab) injections six-monthly for osteoporosis. High risk of Medication-Related Osteonecrosis of the Jaw MRONJ if invasive bone surgery is performed.' },
      { sender: 'Dentist', text: 'Examination tooth 47 shows occlusal caries without apical bone pathology. Decision: Conservative restoration without surgical extraction or periodontal reflection to prevent MRONJ.' },
      { sender: 'Dentist', text: 'Carefully restored tooth 47 with composite resin, ADA 522. Avoided any extraction or periosteal trauma.' }
    ],
    expectedClinicalConcepts: [
      'tooth 47', 'prolia', 'denosumab', 'osteoporosis',
      'osteonecrosis', 'mronj', 'conservative restoration', 'composite resin', '522'
    ],
    expectedFdiTeeth: [47],
    expectedAdaCodes: ['522'],
    expectedSafetyTriggers: [
      {
        drugOrAllergy: 'Prolia',
        expectedAlertKind: 'contraindication',
        requiredWarningSubstring: 'mronj'
      }
    ]
  },

  // Case 16: Medical Alert - Severe Penicillin Anaphylaxis
  {
    id: 'case-16',
    title: 'Medical Alert: Penicillin Anaphylaxis & Acute Dentoalveolar Abscess',
    discipline: 'oral_medicine',
    appointmentType: 'emergency',
    patientName: 'Samantha Green',
    patientDob: '1989-05-14',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Samantha presents with acute facial swelling and acute dentoalveolar abscess associated with non-vital tooth 12.' },
      { sender: 'Dentist', text: 'CRITICAL ALLERGY ALERT: Patient has confirmed severe life-threatening anaphylaxis to Amoxicillin and Penicillin. All beta-lactams and cephalosporins are strictly contraindicated.' },
      { sender: 'Dentist', text: 'Infiltrated local anaesthetic. Incised and drained fluctuating vestibular abscess on tooth 12. Extirpated necrotic pulp, ADA 411 and 399.' },
      { sender: 'Dentist', text: 'Prescribed non-penicillin antimicrobial: Clindamycin 300mg capsules three times daily for 5 days. Emphasized strictly avoiding amoxicillin.' }
    ],
    expectedClinicalConcepts: [
      'abscess', 'tooth 12', 'penicillin', 'anaphylaxis',
      'contraindicated', 'incised drained', 'clindamycin', '411', '399'
    ],
    expectedFdiTeeth: [12],
    expectedAdaCodes: ['411', '399'],
    expectedSafetyTriggers: [
      {
        drugOrAllergy: 'Penicillin',
        expectedAlertKind: 'allergy',
        requiredWarningSubstring: 'penicillin'
      }
    ]
  },

  // Case 17: Crown Recementation Tooth 21
  {
    id: 'case-17',
    title: 'Dislodged Crown Recementation Tooth 21',
    discipline: 'fixed_prosthodontics',
    appointmentType: 'emergency',
    patientName: 'Oliver White',
    patientDob: '1974-03-29',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Oliver attends holding his upper front porcelain-fused-to-metal crown which dislodged while eating lunch today.' },
      { sender: 'Dentist', text: 'Examined tooth 21 preparation. Core is intact, no recurrent caries, margins sound. Crown inspected: porcelain intact, no fractures.' },
      { sender: 'Dentist', text: 'Cleaned preparation tooth 21 with chlorhexidine scrub. Sandblasted internal intaglio surface of crown. Recemented crown tooth 21 with resin-modified glass ionomer cement Fuji PLUS, verified occlusion, ADA 651.' }
    ],
    expectedClinicalConcepts: [
      'tooth 21', 'crown dislodged', 'intact', 'cleaned',
      'recemented', 'glass ionomer', 'fuji plus', 'occlusion', '651'
    ],
    expectedFdiTeeth: [21],
    expectedAdaCodes: ['651']
  },

  // Case 18: In-Chair Vital Teeth Whitening
  {
    id: 'case-18',
    title: 'In-Chair Vital Bleaching Anterior Arches',
    discipline: 'preventive',
    appointmentType: 'scale_clean',
    patientName: 'Jessica Taylor',
    patientDob: '1997-12-04',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Jessica is here for in-office cosmetic teeth whitening.' },
      { sender: 'Dentist', text: 'Pre-operative tooth shade recorded as A3 on anterior teeth 13, 12, 11, 21, 22, 23.' },
      { sender: 'Dentist', text: 'Applied light-cured resin gingival dam barrier to protect gums. Placed 35% hydrogen peroxide bleaching gel on facial surfaces of anterior teeth for three 15-minute cycles, ADA 118.' },
      { sender: 'Dentist', text: 'Rinsed gel thoroughly, applied Tooth Mousse ACP desensitising paste. Post-operative shade achieved: B1.' }
    ],
    expectedClinicalConcepts: [
      'whitening', 'teeth 13 12 11 21 22 23', 'gingival dam',
      'hydrogen peroxide', 'tooth mousse', '118'
    ],
    expectedFdiTeeth: [13, 12, 11, 21, 22, 23],
    expectedAdaCodes: ['118']
  },

  // Case 19: Dental Trauma / Subluxation Tooth 11
  {
    id: 'case-19',
    title: 'Acute Dental Trauma & Flexible Splinting Tooth 11',
    discipline: 'trauma',
    appointmentType: 'emergency',
    patientName: 'Lucas Martin',
    patientDob: '2010-09-17',
    acousticCondition: 'clean_operatory',
    accentCondition: 'general_australian',
    transcript: [
      { sender: 'Dentist', text: 'Lucas was struck in the mouth during a rugby match two hours ago.' },
      { sender: 'Dentist', text: 'Clinical examination reveals subluxation of tooth 11: Grade 1 mobility, sulcular bleeding, tender to percussion, without crown fracture. Neighbouring teeth 12 and 21 are stable.' },
      { sender: 'Dentist', text: 'Periapical radiograph confirms no root fracture. Etched enamel surfaces of teeth 12, 11, 21 and placed passive flexible composite-wire splint for 2 weeks, ADA 392 and 022.' }
    ],
    expectedClinicalConcepts: [
      'trauma', 'subluxation', 'tooth 11', 'mobility', 'sulcular bleeding',
      'teeth 12 11 21', 'flexible splint', '392', '022'
    ],
    expectedFdiTeeth: [11, 12, 21],
    expectedAdaCodes: ['392', '022']
  },

  // Case 20: Complex Multidisciplinary Rehabilitation with ESL Clinician
  {
    id: 'case-20',
    title: 'Comprehensive Rehabilitation & Cracked Tooth 36',
    discipline: 'restorative',
    appointmentType: 'examination',
    patientName: 'Kavita Sharma',
    patientDob: '1981-05-19',
    acousticCondition: 'clean_operatory',
    accentCondition: 'esl_indian_subcontinent',
    transcript: [
      { sender: 'Dentist', text: 'Kavita presents for comprehensive dental examination and management of multiple deteriorating restorations.' },
      { sender: 'Dentist', text: 'Examination reveals failing amalgam restoration on tooth 35 with recurrent secondary caries. Tooth 36 demonstrates cracked tooth syndrome under mesio-occlusal amalgam, painful on tooth slooth bite test on mesio-lingual cusp.' },
      { sender: 'Dentist', text: 'Full mouth bitewing and periapical radiographs taken, ADA 011 and 022. Treatment plan: 1. Replace restoration on tooth 35 with bonded composite ADA 532. 2. Full cuspal coverage ceramic crown on tooth 36, ADA 611.' }
    ],
    expectedClinicalConcepts: [
      'examination', 'tooth 35', 'tooth 36', 'failing amalgam', 'recurrent caries',
      'cracked tooth syndrome', 'tooth slooth', 'composite', 'ceramic crown', '011', '022', '532', '611'
    ],
    expectedFdiTeeth: [35, 36],
    expectedAdaCodes: ['011', '022', '532', '611']
  }
];
