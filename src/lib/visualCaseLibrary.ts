/**
 * Visual Case Presentation Library ("DentAI Visual Pack")
 *
 * High-impact anatomical & procedural visual presentations for dental patients.
 * Provides clear 3-stage visual progression (Current Pathology -> Precision Procedure -> Restored Outcome)
 * to maximize patient treatment acceptance for high-value treatments.
 */

export type VisualCaseCategory = 'crown' | 'implant' | 'endo' | 'veneer' | 'aligner' | 'perio' | 'general';

export interface VisualStage {
  step: number;
  badge: string;
  title: string;
  description: string;
  clinicalFocus: string;
  illustrationSvg: string;
}

export interface VisualCasePresentation {
  category: VisualCaseCategory;
  treatmentName: string;
  typicalAdaCodes: string[];
  tagline: string;
  patientValueProposition: string;
  stages: VisualStage[];
  clinicalAnatomyCallouts: Array<{ label: string; detail: string }>;
  keyPatientBenefits: string[];
}

export const VISUAL_CASE_PREVIEWS: Record<VisualCaseCategory, VisualCasePresentation> = {
  crown: {
    category: 'crown',
    treatmentName: 'Custom Ceramic Crown Restoration',
    typicalAdaCodes: ['611', '613', '615', '627'],
    tagline: '360° Structural Protection for Weakened or Cracked Teeth',
    patientValueProposition: 'Prevents catastrophic tooth fracture, restores 100% chewing force, and blends seamlessly with natural enamel.',
    keyPatientBenefits: [
      'Reinforces teeth with large existing fillings or micro-cracks',
      'High-translucency medical-grade ceramic matched to adjacent teeth',
      'Engineered for 15+ years of daily masticatory durability'
    ],
    clinicalAnatomyCallouts: [
      { label: 'Enamel & Dentin', detail: 'Conserves sound remaining tooth structure while removing decayed or brittle margins.' },
      { label: 'Core Buildup', detail: 'Composite core engineered to replace missing internal tooth structure.' },
      { label: 'Ceramic Coping', detail: 'Monolithic zirconia or lithium disilicate precision-milled to 20-micron margin accuracy.' }
    ],
    stages: [
      {
        step: 1,
        badge: 'Current State',
        title: 'Weakened / Cracked Tooth',
        description: 'Large failing restoration, internal micro-fracture line, or structural compromise posing severe risk of vertical root fracture.',
        clinicalFocus: 'Structural vulnerability under bite load',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Gingiva -->
          <path d="M20 125 C 60 120, 75 132, 100 123 C 125 132, 140 120, 180 125 L 180 155 L 20 155 Z" fill="#FCA5A5" opacity="0.45"/>
          <!-- Tooth Roots -->
          <path d="M65 125 C 65 95, 75 55, 78 40 C 82 25, 118 25, 122 40 C 125 55, 135 95, 135 125 C 120 128, 100 125, 100 125 C 100 125, 80 128, 65 125 Z" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2"/>
          <!-- Failing Large Filling -->
          <path d="M80 42 C 85 35, 115 35, 120 42 C 122 55, 118 68, 100 70 C 82 68, 78 55, 80 42 Z" fill="#CBD5E1" stroke="#64748B" stroke-width="1.5"/>
          <!-- Crack Line -->
          <path d="M100 70 L 98 88 L 104 105 L 102 118" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="2 1"/>
          <!-- Warning Badge -->
          <circle cx="102" cy="118" r="4" fill="#EF4444"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#EF4444" text-anchor="middle">Deep Structural Crack</text>
        </svg>`
      },
      {
        step: 2,
        badge: 'Precision Procedure',
        title: 'Tooth Preparation & Scan',
        description: 'Decay and weak walls are carefully contoured under magnification. Digital 3D optical scanning captures micron-level margins.',
        clinicalFocus: 'Preserving biological width & core support',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Gingiva -->
          <path d="M20 125 C 60 120, 75 132, 100 123 C 125 132, 140 120, 180 125 L 180 155 L 20 155 Z" fill="#FCA5A5" opacity="0.45"/>
          <!-- Prepared Stump / Core -->
          <path d="M72 125 C 72 95, 76 70, 84 56 C 88 50, 112 50, 116 56 C 124 70, 128 95, 128 125 Z" fill="#E2E8F0" stroke="#3B82F6" stroke-width="2"/>
          <!-- Core Buildup boundary -->
          <path d="M84 75 C 92 72, 108 72, 116 75" stroke="#3B82F6" stroke-dasharray="3 3" stroke-width="1.5"/>
          <!-- Precision Margin Chamfer -->
          <path d="M70 123 L 73 120 L 73 125" stroke="#3B82F6" stroke-width="2"/>
          <path d="M130 123 L 127 120 L 127 125" stroke="#3B82F6" stroke-width="2"/>
          <!-- Digital Scan Rays -->
          <line x1="100" y1="15" x2="100" y2="42" stroke="#004ac6" stroke-width="2" stroke-dasharray="2 2"/>
          <circle cx="100" cy="15" r="5" fill="#004ac6"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#004ac6" text-anchor="middle">3D Optical Digital Scan</text>
        </svg>`
      },
      {
        step: 3,
        badge: 'Final Result',
        title: 'Bonded Ceramic Crown',
        description: 'Custom ceramic crown bonded with resin cement. Restores ideal occlusal contacts, chewing efficiency, and lifelike aesthetics.',
        clinicalFocus: 'Complete 360° ferrule seal',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Gingiva -->
          <path d="M20 125 C 60 120, 75 132, 100 123 C 125 132, 140 120, 180 125 L 180 155 L 20 155 Z" fill="#FCA5A5" opacity="0.45"/>
          <!-- Crown Envelope -->
          <path d="M66 124 C 64 95, 70 48, 76 36 C 84 20, 116 20, 124 36 C 130 48, 136 95, 134 124 C 120 128, 100 125, 100 125 C 100 125, 80 128, 66 124 Z" fill="#EFF6FF" stroke="#10B981" stroke-width="2.5"/>
          <!-- Occlusal Cusps & Anatomy -->
          <path d="M82 34 C 88 42, 94 40, 100 44 C 106 40, 112 42, 118 34" stroke="#10B981" stroke-width="1.5"/>
          <path d="M100 44 L 100 68" stroke="#10B981" stroke-width="1" stroke-dasharray="2 2"/>
          <!-- Shimmer Highlight -->
          <circle cx="86" cy="46" r="3" fill="#6EE7B7"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#10B981" text-anchor="middle">Full Functional Strength</text>
        </svg>`
      }
    ]
  },

  implant: {
    category: 'implant',
    treatmentName: 'Titanium Dental Implant & Zirconia Crown',
    typicalAdaCodes: ['684', '688', '661', '671'],
    tagline: 'The Gold Standard Replacement for a Missing Tooth',
    patientValueProposition: 'Preserves jawbone density, prevents neighbouring teeth from drifting, and functions exactly like an original natural root.',
    keyPatientBenefits: [
      'Zero alteration or grinding of adjacent healthy teeth',
      'Prevents bone resorption and facial sagging over time',
      'Permanent, non-removable solution with 98%+ success rate'
    ],
    clinicalAnatomyCallouts: [
      { label: 'Titanium Fixture', detail: 'Bio-inert grade IV titanium screw that integrates directly with alveolar bone.' },
      { label: 'Osseointegration', detail: 'Living bone cells fuse to micro-grooves on the implant surface over 8-12 weeks.' },
      { label: 'Custom Abutment', detail: 'Precision titanium/zirconia connector matching natural gingival emergence profile.' }
    ],
    stages: [
      {
        step: 1,
        badge: 'Current State',
        title: 'Missing Tooth & Bone Loss',
        description: 'Empty space causes adjacent teeth to tilt and opposing teeth to over-erupt. Underlying jawbone gradually thins without stimulation.',
        clinicalFocus: 'Alveolar bone resorption risk',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Gingiva with dip -->
          <path d="M15 110 C 40 108, 65 112, 70 124 C 85 140, 115 140, 130 124 C 135 112, 160 108, 185 110 L 185 155 L 15 155 Z" fill="#FCA5A5" opacity="0.45"/>
          <!-- Adjacent Tooth Left -->
          <path d="M25 110 C 25 70, 32 40, 42 35 C 52 30, 62 45, 65 110 Z" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2"/>
          <!-- Adjacent Tooth Right (Drifting inwards) -->
          <path d="M135 110 C 138 45, 148 30, 158 35 C 168 40, 175 70, 175 110 Z" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2"/>
          <!-- Drift arrow -->
          <path d="M145 60 C 135 62, 125 70, 118 78" stroke="#EF4444" stroke-width="2" stroke-dasharray="2 2"/>
          <polygon points="115,75 118,83 124,78" fill="#EF4444"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#EF4444" text-anchor="middle">Teeth Drifting into Gap</text>
        </svg>`
      },
      {
        step: 2,
        badge: 'Precision Procedure',
        title: 'Implant Placement & Healing',
        description: 'Gentle surgical placement into sound bone under local anaesthetic. Guided keyhole precision ensures ideal 3D angulation.',
        clinicalFocus: 'Primary stability & osseointegration',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Bone Bed -->
          <path d="M15 120 C 60 118, 140 118, 185 120 L 185 155 L 15 155 Z" fill="#E2E8F0"/>
          <!-- Titanium Implant Screw -->
          <rect x="91" y="70" width="18" height="42" rx="3" fill="#64748B" stroke="#334155" stroke-width="2"/>
          <!-- Threads -->
          <line x1="88" y1="80" x2="112" y2="80" stroke="#004ac6" stroke-width="2"/>
          <line x1="88" y1="90" x2="112" y2="90" stroke="#004ac6" stroke-width="2"/>
          <line x1="88" y1="100" x2="112" y2="100" stroke="#004ac6" stroke-width="2"/>
          <!-- Healing Cap -->
          <rect x="88" y="60" width="24" height="10" rx="2" fill="#94A3B8" stroke="#475569" stroke-width="1.5"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#004ac6" text-anchor="middle">Osseointegration in Bone</text>
        </svg>`
      },
      {
        step: 3,
        badge: 'Final Result',
        title: 'Custom Zirconia Crown',
        description: 'Screw-retained ceramic crown fitted to custom abutment. Restores seamless natural smile line and prevents long-term bone shrinkage.',
        clinicalFocus: 'Natural emergence profile & occlusal harmony',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Bone & Gum -->
          <path d="M15 110 C 60 108, 85 116, 100 114 C 115 116, 140 108, 185 110 L 185 155 L 15 155 Z" fill="#FCA5A5" opacity="0.45"/>
          <!-- Integrated Implant -->
          <rect x="91" y="105" width="18" height="35" rx="3" fill="#64748B"/>
          <!-- Zirconia Crown -->
          <path d="M78 114 C 76 80, 80 40, 88 32 C 94 25, 106 25, 112 32 C 120 40, 124 80, 122 114 Z" fill="#EFF6FF" stroke="#10B981" stroke-width="2.5"/>
          <circle cx="94" cy="42" r="2.5" fill="#6EE7B7"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#10B981" text-anchor="middle">Permanent Natural Tooth</text>
        </svg>`
      }
    ]
  },

  endo: {
    category: 'endo',
    treatmentName: 'Root Canal Therapy & Coronal Seal',
    typicalAdaCodes: ['414', '415', '417', '418'],
    tagline: 'Save Your Natural Tooth from Infection and Extraction',
    patientValueProposition: 'Relieves severe dental pain, disinfects internal nerve canals, and allows you to keep your natural tooth for life.',
    keyPatientBenefits: [
      'Instant relief from acute pain and hot/cold sensitivity',
      'Removes deep bacterial abscess without pulling the tooth',
      'Followed by a protective crown to secure long-term durability'
    ],
    clinicalAnatomyCallouts: [
      { label: 'Pulp Chamber', detail: 'Contains nerves and blood supply affected by deep decay or trauma.' },
      { label: 'Canal Shaping', detail: 'Micro-rotary nickel-titanium instruments clean complex root anatomy.' },
      { label: 'Biocompatible Seal', detail: 'Thermal gutta-percha seal locks out future oral bacteria.' }
    ],
    stages: [
      {
        step: 1,
        badge: 'Current State',
        title: 'Infected Dental Pulp',
        description: 'Deep decay has breached the enamel and dentin into the pulp chamber, causing inflamed nerves, throbbing pain, and apical pressure.',
        clinicalFocus: 'Irreversible pulpitis & apical inflammation',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Tooth Outline -->
          <path d="M68 120 C 65 80, 72 40, 80 30 C 88 22, 112 22, 120 30 C 128 40, 135 80, 132 120 Z" fill="#F8FAFC" stroke="#94A3B8" stroke-width="2"/>
          <!-- Deep Decay -->
          <path d="M92 28 C 96 36, 104 36, 108 28 C 105 38, 95 38, 92 28 Z" fill="#78350F"/>
          <!-- Inflamed Red Pulp -->
          <path d="M96 45 C 96 65, 88 95, 84 118 M 104 45 C 104 65, 112 95, 116 118" stroke="#EF4444" stroke-width="4" stroke-linecap="round"/>
          <!-- Apical Radiopacity / Infection -->
          <circle cx="84" cy="122" r="8" fill="#FCA5A5" opacity="0.7"/>
          <circle cx="116" cy="122" r="8" fill="#FCA5A5" opacity="0.7"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#EF4444" text-anchor="middle">Acute Bacterial Infection</text>
        </svg>`
      },
      {
        step: 2,
        badge: 'Precision Procedure',
        title: 'Disinfection & Biomechanical Shaping',
        description: 'Under gentle rubber dam isolation, fine rotary instruments gently remove bacteria, wash the canals with antimicrobial irrigants, and soothe pain.',
        clinicalFocus: 'Complete microbial eradication & working length accuracy',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Tooth Outline -->
          <path d="M68 120 C 65 80, 72 40, 80 30 C 88 22, 112 22, 120 30 C 128 40, 135 80, 132 120 Z" fill="#F8FAFC" stroke="#94A3B8" stroke-width="2"/>
          <!-- Disinfected Clean Canal Paths -->
          <path d="M96 45 C 96 65, 88 95, 84 118 M 104 45 C 104 65, 112 95, 116 118" stroke="#38BDF8" stroke-width="4" stroke-linecap="round"/>
          <!-- Micro instrument file -->
          <line x1="84" y1="118" x2="88" y2="15" stroke="#004ac6" stroke-width="1.5"/>
          <circle cx="88" cy="15" r="4" fill="#004ac6"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#004ac6" text-anchor="middle">Micro-Disinfection Cleanse</text>
        </svg>`
      },
      {
        step: 3,
        badge: 'Final Result',
        title: 'Hermetic Gutta-Percha Seal',
        description: 'Canals are sealed with sterile gutta-percha and bioceramic sealer, preventing re-infection. Ready for protective crown reinforcement.',
        clinicalFocus: 'Long-term apical bone healing',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Tooth Outline -->
          <path d="M68 120 C 65 80, 72 40, 80 30 C 88 22, 112 22, 120 30 C 128 40, 135 80, 132 120 Z" fill="#EFF6FF" stroke="#10B981" stroke-width="2.5"/>
          <!-- Pink Gutta Percha Obturation -->
          <path d="M96 50 C 96 68, 88 95, 84 116 M 104 50 C 104 68, 112 95, 116 116" stroke="#F43F5E" stroke-width="4" stroke-linecap="round"/>
          <!-- Coronal Composite Seal -->
          <rect x="92" y="32" width="16" height="14" rx="2" fill="#10B981"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#10B981" text-anchor="middle">Tooth Saved & Healed</text>
        </svg>`
      }
    ]
  },

  veneer: {
    category: 'veneer',
    treatmentName: 'High-Aesthetic Porcelain Veneers',
    typicalAdaCodes: ['582', '583'],
    tagline: 'Transformative Smile Architecture with Minimal Enamel Reduction',
    patientValueProposition: 'Corrects deep staining, chips, irregular tooth shapes, and minor spacing gaps with bespoke hand-crafted porcelain.',
    keyPatientBenefits: [
      'Custom shade and contour crafted to match your facial features',
      'Stain-resistant glazed surface impervious to coffee, tea, and red wine',
      'Preserves maximum natural tooth enamel'
    ],
    clinicalAnatomyCallouts: [
      { label: 'Facial Enamel', detail: 'Ultra-conservative 0.3mm to 0.5mm surface contouring.' },
      { label: 'Incisal Wrap', detail: 'Reinforces the biting edge against micro-chipping.' },
      { label: 'Bonding Matrix', detail: 'Photopolymerised light-cured resin creates chemical bond to natural enamel.' }
    ],
    stages: [
      {
        step: 1,
        badge: 'Current State',
        title: 'Chipped / Stained Anterior Teeth',
        description: 'Enamel wear, tetracycline or intrinsic staining, small gaps, or chipped incisal edges diminishing smile confidence.',
        clinicalFocus: 'Aesthetic disharmony & enamel wear',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Incisors with chip & gap -->
          <path d="M55 40 C 55 25, 92 25, 92 40 L 92 105 L 85 112 L 72 105 L 55 105 Z" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2"/>
          <path d="M100 40 C 100 25, 137 25, 137 40 L 137 105 L 122 105 L 115 110 L 100 105 Z" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2"/>
          <!-- Staining marks -->
          <ellipse cx="74" cy="70" rx="6" ry="4" fill="#CBD5E1"/>
          <ellipse cx="118" cy="75" rx="7" ry="5" fill="#CBD5E1"/>
          <!-- Chip indicator -->
          <path d="M85 112 L 88 108" stroke="#EF4444" stroke-width="2"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#EF4444" text-anchor="middle">Enamel Chip & Discolouration</text>
        </svg>`
      },
      {
        step: 2,
        badge: 'Precision Procedure',
        title: 'Micro-Preparation & Digital Smile Design',
        description: 'Conservative 0.3mm preparation within enamel. Digital smile design simulation allows you to preview your bespoke shade and smile line.',
        clinicalFocus: 'Enamel preservation & digital shade mapping',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <path d="M57 40 C 57 25, 90 25, 90 40 L 90 105 L 57 105 Z" fill="#E2E8F0" stroke="#004ac6" stroke-width="1.5"/>
          <path d="M102 40 C 102 25, 135 25, 135 40 L 135 105 L 102 105 Z" fill="#E2E8F0" stroke="#004ac6" stroke-width="1.5"/>
          <!-- Precision depth guide grooves -->
          <line x1="68" y1="55" x2="78" y2="55" stroke="#004ac6" stroke-width="2"/>
          <line x1="68" y1="75" x2="78" y2="75" stroke="#004ac6" stroke-width="2"/>
          <line x1="113" y1="55" x2="123" y2="55" stroke="#004ac6" stroke-width="2"/>
          <line x1="113" y1="75" x2="123" y2="75" stroke="#004ac6" stroke-width="2"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#004ac6" text-anchor="middle">Micro-Prep & Digital Shade Match</text>
        </svg>`
      },
      {
        step: 3,
        badge: 'Final Result',
        title: 'Artisan Porcelain Bonded Smile',
        description: 'Individually glazed ceramic veneers bonded seamlessly. Natural vitality, light reflection, and perfect symmetric alignment.',
        clinicalFocus: 'Harmonious aesthetic smile line',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Restored Symmetric Teeth -->
          <path d="M54 40 C 54 24, 94 24, 94 40 L 94 108 C 84 110, 64 110, 54 108 Z" fill="#EFF6FF" stroke="#10B981" stroke-width="2.5"/>
          <path d="M98 40 C 98 24, 138 24, 138 40 L 138 108 C 128 110, 108 110, 98 108 Z" fill="#EFF6FF" stroke="#10B981" stroke-width="2.5"/>
          <!-- Shimmer Highlights -->
          <circle cx="68" cy="55" r="3" fill="#6EE7B7"/>
          <circle cx="112" cy="55" r="3" fill="#6EE7B7"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#10B981" text-anchor="middle">Flawless Aesthetic Symmetry</text>
        </svg>`
      }
    ]
  },

  aligner: {
    category: 'aligner',
    treatmentName: 'Clear Aligner Orthodontic Therapy',
    typicalAdaCodes: ['825', '881'],
    tagline: 'Discreet, Removable Tooth Alignment Without Metal Brackets',
    patientValueProposition: 'Straightens crowded or spaced teeth comfortably with virtually invisible medical-grade polymer trays.',
    keyPatientBenefits: [
      'Removable for normal eating, brushing, and flossing',
      'No metal brackets or sharp wires causing mouth ulcers',
      'Predictable 3D digital timeline showing final alignment before starting'
    ],
    clinicalAnatomyCallouts: [
      { label: 'SmartTrack Polymer', detail: 'Gentle continuous physiological force calibrated to tooth biology.' },
      { label: 'Tooth Attachments', detail: 'Tooth-coloured composite buttons providing leverage for rotational movements.' },
      { label: 'Interproximal Reduction', detail: 'Micron-level enamel smoothing to create space without extractions.' }
    ],
    stages: [
      {
        step: 1,
        badge: 'Current State',
        title: 'Crowding & Malocclusion',
        description: 'Overlapping front teeth, rotation, or bite misalignment causing uneven wear and plaque trapping.',
        clinicalFocus: 'Anterior crowding & contact tightness',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Crowded teeth arrangement -->
          <rect x="42" y="45" width="26" height="55" rx="6" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2" transform="rotate(-10 55 72)"/>
          <rect x="74" y="40" width="28" height="60" rx="6" fill="#F1F5F9" stroke="#EF4444" stroke-width="2" transform="rotate(12 88 70)"/>
          <rect x="110" y="45" width="26" height="55" rx="6" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2" transform="rotate(-6 123 72)"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#EF4444" text-anchor="middle">Crowded / Rotated Teeth</text>
        </svg>`
      },
      {
        step: 2,
        badge: 'Precision Procedure',
        title: 'Clear Aligner Trays & Movement',
        description: 'Trays changed every 7-10 days gently guide teeth through pre-programmed orthodontic stages.',
        clinicalFocus: 'Controlled biological tooth movement',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Semi-transparent aligner outline -->
          <rect x="36" y="38" width="128" height="68" rx="12" fill="#E0F2FE" fill-opacity="0.4" stroke="#004ac6" stroke-width="2" stroke-dasharray="4 2"/>
          <rect x="48" y="45" width="24" height="54" rx="4" fill="#F8FAFC" stroke="#64748B" stroke-width="1.5"/>
          <rect x="80" y="43" width="26" height="57" rx="4" fill="#F8FAFC" stroke="#64748B" stroke-width="1.5"/>
          <rect x="114" y="45" width="24" height="54" rx="4" fill="#F8FAFC" stroke="#64748B" stroke-width="1.5"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#004ac6" text-anchor="middle">Progressive Clear Trays</text>
        </svg>`
      },
      {
        step: 3,
        badge: 'Final Result',
        title: 'Broad Harmonious Arch',
        description: 'Ideal functional occlusion, straight aesthetic smile line, and dramatically easier plaque control.',
        clinicalFocus: 'Stable class I canine/molar relationship',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Straight aligned teeth -->
          <rect x="46" y="45" width="26" height="55" rx="5" fill="#EFF6FF" stroke="#10B981" stroke-width="2"/>
          <rect x="78" y="42" width="28" height="60" rx="5" fill="#EFF6FF" stroke="#10B981" stroke-width="2"/>
          <rect x="112" y="45" width="26" height="55" rx="5" fill="#EFF6FF" stroke="#10B981" stroke-width="2"/>
          <!-- Smile curve -->
          <path d="M35 110 C 70 120, 130 120, 165 110" stroke="#10B981" stroke-width="2" stroke-linecap="round"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#10B981" text-anchor="middle">Straight Aligned Smile</text>
        </svg>`
      }
    ]
  },

  perio: {
    category: 'perio',
    treatmentName: 'Periodontal Debridement & Root Planing',
    typicalAdaCodes: ['222', '281', '282'],
    tagline: 'Deep Gum Therapy to Halt Bone Loss and Save Loose Teeth',
    patientValueProposition: 'Removes deep subgingival calculus, eliminates bleeding gums, and prevents the leading cause of adult tooth loss.',
    keyPatientBenefits: [
      'Eliminates bacterial pockets that cause bad breath and gum tenderness',
      'Stabilizes teeth by halting progressive jawbone shrinkage',
      'Gentle ultrasonic treatment with numbing gel for complete comfort'
    ],
    clinicalAnatomyCallouts: [
      { label: 'Periodontal Pocket', detail: 'Space between tooth and gum exceeding healthy 3mm threshold.' },
      { label: 'Subgingival Calculus', detail: 'Hardened bacterial biofilm calcified onto root surfaces below the gum line.' },
      { label: 'Epithelial Attachment', detail: 'Healthy tissue re-attachment following thorough root debridement.' }
    ],
    stages: [
      {
        step: 1,
        badge: 'Current State',
        title: 'Deep Pockets & Subgingival Calculus',
        description: 'Plaque and calculus have migrated below the gum line, causing bleeding, 5-7mm pockets, and active bone loss.',
        clinicalFocus: 'Active periodontitis & bleeding on probing',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Inflamed red gum with pocket -->
          <path d="M20 95 C 60 90, 70 115, 80 125 C 100 120, 120 120, 130 125 C 140 115, 150 90, 180 95 L 180 155 L 20 155 Z" fill="#FCA5A5"/>
          <!-- Tooth Root -->
          <path d="M75 35 C 80 25, 120 25, 125 35 L 125 125 C 115 130, 85 130, 75 125 Z" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2"/>
          <!-- Subgingival Tartar (Dark brown) -->
          <path d="M74 85 C 70 95, 70 105, 75 110" stroke="#78350F" stroke-width="4" stroke-linecap="round"/>
          <path d="M126 85 C 130 95, 130 105, 125 110" stroke="#78350F" stroke-width="4" stroke-linecap="round"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#EF4444" text-anchor="middle">Deep 6mm Pocket & Tartar</text>
        </svg>`
      },
      {
        step: 2,
        badge: 'Precision Procedure',
        title: 'Ultrasonic Debridement & Irrigation',
        description: 'Micro-ultrasonic tips gently vibrate away hardened deposits and flush bacterial endotoxins under local anaesthetic.',
        clinicalFocus: 'Subgingival ultrasonic root smoothing',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <path d="M20 95 C 60 90, 70 115, 80 125 C 100 120, 120 120, 130 125 C 140 115, 150 90, 180 95 L 180 155 L 20 155 Z" fill="#FCA5A5" opacity="0.6"/>
          <path d="M75 35 C 80 25, 120 25, 125 35 L 125 125 C 115 130, 85 130, 75 125 Z" fill="#F1F5F9" stroke="#94A3B8" stroke-width="2"/>
          <!-- Ultrasonic tip cleaning root -->
          <path d="M60 70 L 73 95" stroke="#004ac6" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="73" cy="95" r="4" fill="#38BDF8"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#004ac6" text-anchor="middle">Micro-Ultrasonic Cleansing</text>
        </svg>`
      },
      {
        step: 3,
        badge: 'Final Result',
        title: 'Tight Gum Attachment & Healing',
        description: 'Gums tighten back against root surfaces. Pockets reduce to healthy 2-3mm margins with zero bleeding.',
        clinicalFocus: 'Pocket reduction & stable bone level',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <!-- Healthy Pink Gum tight on tooth -->
          <path d="M20 85 C 60 80, 72 90, 75 88 C 80 82, 120 82, 125 88 C 128 90, 140 80, 180 85 L 180 155 L 20 155 Z" fill="#FBCFE8"/>
          <path d="M75 35 C 80 25, 120 25, 125 35 L 125 125 C 115 130, 85 130, 75 125 Z" fill="#EFF6FF" stroke="#10B981" stroke-width="2"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#10B981" text-anchor="middle">Tight Healthy 2mm Gums</text>
        </svg>`
      }
    ]
  },

  general: {
    category: 'general',
    treatmentName: 'Comprehensive Restorative & Preventive Care',
    typicalAdaCodes: ['011', '114', '118', '531'],
    tagline: 'Proactive Oral Health Maintenance & Minimal Intervention Dentistry',
    patientValueProposition: 'Prevents minor enamel issues from developing into costly, painful root canals and crowns.',
    keyPatientBenefits: [
      'Diagnoses micro-cavities before they reach the sensitive nerve',
      'Strengthens enamel with high-potency topical remineralising therapy',
      'Maintains lifelong oral wellness with minimal out-of-pocket costs'
    ],
    clinicalAnatomyCallouts: [
      { label: 'Surface Enamel', detail: 'Hardest tissue in the human body protected by proactive remineralisation.' },
      { label: 'Plaque Biofilm', detail: 'Targeted removal prevents tooth decay and marginal gingivitis.' }
    ],
    stages: [
      {
        step: 1,
        badge: 'Assessment',
        title: 'Oral Health Examination',
        description: 'High-magnification charting and digital low-dose x-rays evaluate every tooth, margin, and soft tissue.',
        clinicalFocus: 'Early detection & diagnostic charting',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <circle cx="100" cy="75" r="45" fill="#EFF6FF" stroke="#004ac6" stroke-width="2"/>
          <path d="M85 75 L 95 85 L 118 62" stroke="#004ac6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#004ac6" text-anchor="middle">32-Tooth Digital Assessment</text>
        </svg>`
      },
      {
        step: 2,
        badge: 'Treatment',
        title: 'Preventive & Restorative Care',
        description: 'Plaque and tartar removal followed by tooth-coloured composite restoration where necessary.',
        clinicalFocus: 'Minimal intervention dentistry',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <path d="M70 120 C 70 80, 75 40, 85 30 C 95 20, 105 20, 115 30 C 125 40, 130 80, 130 120 Z" fill="#EFF6FF" stroke="#3B82F6" stroke-width="2"/>
          <ellipse cx="100" cy="45" rx="12" ry="8" fill="#93C5FD"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#3B82F6" text-anchor="middle">Gentle Cleaning & Care</text>
        </svg>`
      },
      {
        step: 3,
        badge: 'Long Term',
        title: 'Lifelong Prevention & Recall',
        description: 'Personalised recall interval protects your smile and secures optimal health fund benefits.',
        clinicalFocus: 'Recall maintenance & disease prevention',
        illustrationSvg: `<svg viewBox="0 0 200 160" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="160" rx="12" fill="#F8FAFC"/>
          <circle cx="100" cy="75" r="45" fill="#ECFDF5" stroke="#10B981" stroke-width="2"/>
          <path d="M100 50 L 100 75 L 115 75" stroke="#10B981" stroke-width="2.5" stroke-linecap="round"/>
          <text x="100" y="148" font-size="10" font-weight="700" fill="#10B981" text-anchor="middle">Continuous Recall Health</text>
        </svg>`
      }
    ]
  }
};

/**
 * Detects the most relevant visual case presentation category based on ADA codes,
 * procedure text, or clinical appointment context.
 */
export function detectVisualCaseCategory(
  adaCodes: Array<{ code: string; description?: string }>,
  clinicalText: string = ''
): VisualCaseCategory {
  const text = clinicalText.toLowerCase();
  const codes = new Set(adaCodes.map((c) => c.code));

  // 1. Crown & Bridge (600s)
  if (
    codes.has('611') || codes.has('613') || codes.has('615') || codes.has('627') ||
    text.includes('crown') || text.includes('bridge') || text.includes('onlay')
  ) {
    return 'crown';
  }

  // 2. Implantology (660s, 680s)
  if (
    codes.has('688') || codes.has('684') || codes.has('661') || codes.has('671') ||
    text.includes('implant') || text.includes('fixture') || text.includes('osseointegrat')
  ) {
    return 'implant';
  }

  // 3. Endodontics (400s)
  if (
    codes.has('414') || codes.has('415') || codes.has('417') || codes.has('418') ||
    text.includes('root canal') || text.includes('pulp') || text.includes('endo') || text.includes('extirpation')
  ) {
    return 'endo';
  }

  // 4. Veneers (580s)
  if (
    codes.has('582') || codes.has('583') ||
    text.includes('veneer') || text.includes('aesthetic') || text.includes('smile design')
  ) {
    return 'veneer';
  }

  // 5. Aligners / Ortho (800s)
  if (
    codes.has('825') || codes.has('881') ||
    text.includes('aligner') || text.includes('invisalign') || text.includes('ortho') || text.includes('crowding')
  ) {
    return 'aligner';
  }

  // 6. Periodontics (200s deep scale)
  if (
    codes.has('222') || codes.has('281') || codes.has('282') ||
    text.includes('periodont') || text.includes('deep scale') || text.includes('root planing') || text.includes('pocket')
  ) {
    return 'perio';
  }

  return 'general';
}

export function getVisualCasePresentation(category: VisualCaseCategory): VisualCasePresentation {
  return VISUAL_CASE_PREVIEWS[category] || VISUAL_CASE_PREVIEWS.general;
}
