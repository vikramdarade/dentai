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
  {
    pattern: /\b(?:tooth\s*)?one\s*six\b/gi,
    replacement: 'tooth 16',
    description: 'Spoken "one six" -> tooth 16'
  },
  {
    pattern: /\b(?:tooth\s*)?one\s*one\b/gi,
    replacement: 'tooth 11',
    description: 'Spoken "one one" -> tooth 11'
  },
  {
    pattern: /\b(?:tooth\s*)?two\s*one\b/gi,
    replacement: 'tooth 21',
    description: 'Spoken "two one" -> tooth 21'
  },
  {
    pattern: /\b(?:tooth\s*)?two\s*four\b/gi,
    replacement: 'tooth 24',
    description: 'Spoken "two four" -> tooth 24'
  },
  {
    pattern: /\b(?:tooth\s*)?two\s*six\b/gi,
    replacement: 'tooth 26',
    description: 'Spoken "two six" -> tooth 26'
  },
  {
    pattern: /\b(?:tooth\s*)?three\s*six\b/gi,
    replacement: 'tooth 36',
    description: 'Spoken "three six" -> tooth 36'
  },
  {
    pattern: /\b(?:tooth\s*)?four\s*six\b/gi,
    replacement: 'tooth 46',
    description: 'Spoken "four six" -> tooth 46'
  },
  {
    pattern: /\b(?:tooth\s*)?four\s*seven\b/gi,
    replacement: 'tooth 47',
    description: 'Spoken "four seven" -> tooth 47'
  },
  {
    pattern: /\b(?:tooth\s*)?four\s*eight\b/gi,
    replacement: 'tooth 48',
    description: 'Spoken "four eight" -> tooth 48'
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
    pattern: /\b(?:night|knight|bite)\s*(?:guard|splint)\b/gi,
    replacement: 'occlusal splint (nightguard)',
    description: 'Colloquial "night guard/bite splint" -> occlusal splint (nightguard)'
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
