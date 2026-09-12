/**
 * Dental Phonetic Lexicon & Operatory Speech Normalizer
 *
 * Real-time phonetic dictionary mapping spoken Australian operatory phrases,
 * accents, and speech recognition misinterpretations into accurate clinical dental terminology.
 */

export interface PhoneticRule {
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
  description?: string;
}

export const DENTAL_PHONETIC_RULES: PhoneticRule[] = [
  // 1. Spoken FDI Tooth Numbers
  {
    pattern: /\b(?:tooth\s*)?(?:dirty|tree)\s*tree\b/gi,
    replacement: 'tooth 33',
    description: 'Irish/Indian/diverse accent "dirty tree" -> tooth 33'
  },
  // Dynamic Spoken Tooth normalizer: handles "tooth two five" -> "tooth 25", "tooth 3 7" -> "tooth 37", "tooth four six" -> "tooth 46"
  // Permitted FDI quadrants: Permanent (1-4, teeth 1-8) and Primary/Deciduous (5-8, teeth 1-5)
  {
    pattern: /\b(?:tooth|teeth)\s+(one|two|three|four|five|six|seven|eight|1|2|3|4|5|6|7|8)\s+(one|two|three|four|five|six|seven|eight|nine|1|2|3|4|5|6|7|8|9)\b/gi,
    replacement: (_match: string, q: string, t: string) => {
      const DIGIT_MAP: Record<string, string> = {
        '1': '1', 'one': '1',
        '2': '2', 'two': '2',
        '3': '3', 'three': '3',
        '4': '4', 'four': '4',
        '5': '5', 'five': '5',
        '6': '6', 'six': '6',
        '7': '7', 'seven': '7',
        '8': '8', 'eight': '8',
        '9': '9', 'nine': '9'
      };
      const qd = DIGIT_MAP[q.toLowerCase()];
      const td = DIGIT_MAP[t.toLowerCase()];
      if (qd && td) {
        return `tooth ${qd}${td}`;
      }
      return _match;
    },
    description: 'Dynamic spoken FDI tooth ("tooth two five" -> tooth 25)'
  },
  // Bare spoken FDI pairs in dental context without the word "tooth" (e.g. "on one six", "cavity on two four")
  {
    pattern: /\b(on|in|at|check|inspect|probe|filling|crown|prep|restore)\s+(one|two|three|four)\s+(one|two|three|four|five|six|seven|eight)\b/gi,
    replacement: (_match: string, prep: string, q: string, t: string) => {
      const DIGIT_MAP: Record<string, string> = {
        'one': '1', 'two': '2', 'three': '3', 'four': '4',
        'five': '5', 'six': '6', 'seven': '7', 'eight': '8'
      };
      const qd = DIGIT_MAP[q.toLowerCase()];
      const td = DIGIT_MAP[t.toLowerCase()];
      if (qd && td) {
        return `${prep} tooth ${qd}${td}`;
      }
      return _match;
    },
    description: 'Prepositional spoken FDI ("on one six" -> on tooth 16)'
  },
  // Spoken 3-digit ADA item numbers: "item one one four" -> "item 114", "item zero one two" -> "item 012", "item nine six five" -> "item 965"
  {
    pattern: /\b(item|code|ada)\s+(zero|oh|one|two|three|four|five|six|seven|eight|nine)\s+(zero|oh|one|two|three|four|five|six|seven|eight|nine)\s+(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi,
    replacement: (_match: string, lead: string, d1: string, d2: string, d3: string) => {
      const DIGIT_MAP: Record<string, string> = {
        'zero': '0', 'oh': '0',
        'one': '1', 'two': '2', 'three': '3', 'four': '4',
        'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
      };
      const num1 = DIGIT_MAP[d1.toLowerCase()] ?? '0';
      const num2 = DIGIT_MAP[d2.toLowerCase()] ?? '0';
      const num3 = DIGIT_MAP[d3.toLowerCase()] ?? '0';
      return `${lead.toUpperCase()} ${num1}${num2}${num3}`;
    },
    description: 'Spoken ADA item code ("item one one four" -> ADA 114)'
  },
  {
    pattern: /\bupper\s*right\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 16',
    description: 'Quadrant text -> FDI 16'
  },
  {
    pattern: /\bupper\s*left\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 26',
    description: 'Quadrant text -> FDI 26'
  },
  {
    pattern: /\blower\s*left\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 36',
    description: 'Quadrant text -> FDI 36'
  },
  {
    pattern: /\blower\s*right\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 46',
    description: 'Quadrant text -> FDI 46'
  },

  // 2. Anatomical Surfaces (compound phrases first)
  {
    pattern: /\bme\s*zeal\s*occlusal\b/gi,
    replacement: 'mesio-occlusal',
    description: 'Phonetic "me zeal occlusal" -> mesio-occlusal'
  },
  {
    pattern: /\bdistal\s*buckle\b/gi,
    replacement: 'distobuccal',
    description: 'Speech recognition error "distal buckle" -> distobuccal'
  },
  {
    pattern: /\bme\s*zeal\b/gi,
    replacement: 'mesial',
    description: 'Phonetic "me zeal" -> mesial'
  },
  {
    pattern: /\bin\s*sigh\s*sul\b/gi,
    replacement: 'incisal',
    description: 'Phonetic "in sigh sul" -> incisal'
  },

  // 3. Clinical Diagnostics & Pathology
  {
    pattern: /\bpulp\s*it\s*is\b/gi,
    replacement: 'pulpitis',
    description: 'Phonetic "pulp it is" -> pulpitis'
  },
  {
    pattern: /\bpulp\s*expiration\b/gi,
    replacement: 'pulp extirpation',
    description: 'Acoustic confusion "pulp expiration" -> pulp extirpation'
  },
  {
    pattern: /\broot\s*can\s*all\b/gi,
    replacement: 'root canal',
    description: 'Phonetic "root can all" -> root canal'
  },
  {
    pattern: /\broute\s*canal\b/gi,
    replacement: 'root canal',
    description: 'Homophone "route canal" -> root canal'
  },
  {
    pattern: /\btree\s*two\s*tree\b/gi,
    replacement: '3-2-3 mm',
    description: 'Phonetic "tree two tree" -> 3-2-3 mm'
  },
  {
    pattern: /\bbleeding\s*on\s*(?:probe\s*in|probing|probe)\b/gi,
    replacement: 'bleeding on probing',
    description: 'Phonetic "bleeding on probe in" -> bleeding on probing'
  },
  {
    pattern: /\b(?:composite\s*)?feeling\b/gi,
    replacement: 'filling (composite restoration)',
    description: 'Homophone "feeling" -> filling'
  },

  // 4. Anaesthetics, Instruments & Materials
  {
    pattern: /\blight\s*no\s*cane\b/gi,
    replacement: 'lignocaine',
    description: 'Phonetic "light no cane" -> lignocaine'
  },
  {
    pattern: /\bligno\s*cane\b/gi,
    replacement: 'lignocaine',
    description: 'Phonetic "ligno cane" -> lignocaine'
  },
  {
    pattern: /\bartie\s*cane\b/gi,
    replacement: 'articaine',
    description: 'Phonetic "artie cane" -> articaine'
  },
  {
    pattern: /\bsept\s*an\s*est\b/gi,
    replacement: 'Septanest (articaine)',
    description: 'Phonetic "sept an est" -> Septanest'
  },
  {
    pattern: /\brubber\s*damn\b/gi,
    replacement: 'rubber dam',
    description: 'Homophone "rubber damn" -> rubber dam'
  },
  {
    pattern: /\bleader\s*mix\b/gi,
    replacement: 'Ledermix',
    description: 'Phonetic "leader mix" -> Ledermix'
  },
  {
    pattern: /\bgutta\s*perka\b/gi,
    replacement: 'gutta-percha',
    description: 'Phonetic "gutta perka" -> gutta-percha'
  },

  // 5. Bruxism, Occlusal Wear, TMD & Splints
  {
    pattern: /\b(?:brooks|brook|brux)\s*ism\b/gi,
    replacement: 'bruxism',
    description: 'Phonetic "brooks ism" -> bruxism'
  },
  {
    pattern: /\b(?:michigan|acrylic|night|knight|bite)\s*(?:guard|splint|plate)\b/gi,
    replacement: 'occlusal splint (nightguard)',
    description: 'Colloquial "michigan/acrylic splint / night guard" -> occlusal splint (nightguard)'
  },
  {
    pattern: /\b(?:nocturnal|night\s*time|night)\s*grinding\b/gi,
    replacement: 'sleep bruxism / nocturnal grinding',
    description: 'Colloquial "nocturnal grinding" -> sleep bruxism'
  },
  {
    pattern: /\b(?:occlusal|a\s*clue\s*zal|occlude\s*zal)\s*(?:split|sprint|spint|splint)\b/gi,
    replacement: 'occlusal splint',
    description: 'Phonetic "occlusal split/sprint" -> occlusal splint'
  },
  {
    pattern: /\bwear\s*(?:facet|facets|face\s*it|face\s*its)\b/gi,
    replacement: 'wear facets',
    description: 'Phonetic "wear face its" -> wear facets'
  },
  {
    pattern: /\b(?:mass\s*setter|mass\s*eater|mass\s*eter)\b/gi,
    replacement: 'masseter muscle',
    description: 'Phonetic "mass setter" -> masseter muscle'
  },
  {
    pattern: /\b(?:temp\s*or\s*al\s*is|temporalis)\s*(?:muscle)?\b/gi,
    replacement: 'temporalis muscle',
    description: 'Phonetic "temp or al is" -> temporalis muscle'
  },
  {
    pattern: /\b(?:t\s*m\s*j|t\.m\.j\.)\b/gi,
    replacement: 'TMJ',
    description: 'Spoken "T M J" -> TMJ'
  },
  {
    pattern: /\b(?:a\s*tuition|at\s*trition)\b/gi,
    replacement: 'attrition',
    description: 'Phonetic "a tuition" -> attrition'
  },
  {
    pattern: /\bab\s*fraction(?:s)?\b/gi,
    replacement: 'abfraction',
    description: 'Phonetic "ab fraction" -> abfraction'
  },
  {
    pattern: /\bclinching\b/gi,
    replacement: 'clenching',
    description: 'Colloquial "clinching" -> clenching'
  },
  {
    pattern: /\b(?:in\s*sigh\s*sul|in\s*size\s*al)\s*wear\b/gi,
    replacement: 'incisal wear',
    description: 'Phonetic "in sigh sul wear" -> incisal wear'
  },
  {
    pattern: /\b(?:k\s*nine|k-9)\s*guidance\b/gi,
    replacement: 'canine guidance',
    description: 'Phonetic "k-nine guidance" -> canine guidance'
  },
  {
    pattern: /\b(?:item|code)\s*(?:nine\s*six\s*five|965)\b/gi,
    replacement: 'ADA item 965 (occlusal splint)',
    description: 'Spoken "item nine six five" -> ADA item 965'
  }
];

/**
 * Normalizes live spoken clinical text by applying dental phonetic rules.
 */
export function normalizeSpokenDentalText(text: string): string {
  if (!text || typeof text !== 'string') return '';

  let normalized = text;
  for (const rule of DENTAL_PHONETIC_RULES) {
    if (typeof rule.replacement === 'string') {
      normalized = normalized.replace(rule.pattern, rule.replacement);
    } else {
      normalized = normalized.replace(rule.pattern, rule.replacement as any);
    }
  }

  return normalized;
}
