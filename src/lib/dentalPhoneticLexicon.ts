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

const DIGIT_WORD_MAP: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  tree: '3',
  dirty: '3', // Irish / diverse accent "dirty tree" -> 33
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8'
};

const TEEN_TO_FDI: Record<string, string> = {
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18'
};

const COMPOUND_CARDINALS: Record<string, string> = {
  'twenty one': '21',
  'twenty-one': '21',
  'twenty two': '22',
  'twenty-two': '22',
  'twenty three': '23',
  'twenty-three': '23',
  'twenty four': '24',
  'twenty-four': '24',
  'twenty five': '25',
  'twenty-five': '25',
  'twenty six': '26',
  'twenty-six': '26',
  'twenty seven': '27',
  'twenty-seven': '27',
  'twenty eight': '28',
  'twenty-eight': '28',
  'thirty one': '31',
  'thirty-one': '31',
  'thirty two': '32',
  'thirty-two': '32',
  'thirty three': '33',
  'thirty-three': '33',
  'thirty four': '34',
  'thirty-four': '34',
  'thirty five': '35',
  'thirty-five': '35',
  'thirty six': '36',
  'thirty-six': '36',
  'thirty seven': '37',
  'thirty-seven': '37',
  'thirty eight': '38',
  'thirty-eight': '38',
  'forty one': '41',
  'forty-one': '41',
  'forty two': '42',
  'forty-two': '42',
  'forty three': '43',
  'forty-three': '43',
  'forty four': '44',
  'forty-four': '44',
  'forty five': '45',
  'forty-five': '45',
  'forty six': '46',
  'forty-six': '46',
  'forty seven': '47',
  'forty-seven': '47',
  'forty eight': '48',
  'forty-eight': '48'
};

export const DENTAL_PHONETIC_RULES: PhoneticRule[] = [
  // ─── 1. SPOKEN FDI TOOTH NUMBERS (Systematic FDI Notation) ───
  // Accent special: "dirty tree" -> 33
  {
    pattern: /\b(?:(tooth)\s*)?(?:dirty|tree)\s*tree\b/gi,
    replacement: (_m, tooth) => `${tooth && /^[A-Z]/.test(tooth) ? 'Tooth' : 'tooth'} 33`,
    description: 'Accent "dirty tree" / "tree tree" -> tooth 33'
  },
  // "tooth 1 6" or "tooth 4 7" (spaced single digits from Chrome)
  {
    pattern: /\b(tooth)\s+([1-4])\s+([1-8])\b/gi,
    replacement: (_m, tooth, d1, d2) => `${/^[A-Z]/.test(tooth) ? 'Tooth' : 'tooth'} ${d1}${d2}`,
    description: 'Chrome spaced digits "tooth 1 6" -> tooth 16'
  },
  // "tooth eleven" -> tooth 11, "tooth sixteen" -> tooth 16
  {
    pattern: /\b(tooth)\s+(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen)\b/gi,
    replacement: (_match, tooth, teen) => `${/^[A-Z]/.test(tooth) ? 'Tooth' : 'tooth'} ${TEEN_TO_FDI[teen.toLowerCase()] || teen}`,
    description: 'Spoken teen cardinal -> tooth 11-18'
  },
  // "tooth twenty-one" ... "tooth forty-eight"
  {
    pattern: /\b(tooth)\s+(twenty|thirty|forty)[-\s](one|two|three|four|five|six|seven|eight)\b/gi,
    replacement: (_match, tooth, tens, ones) => {
      const key = `${tens.toLowerCase()}-${ones.toLowerCase()}`;
      return `${/^[A-Z]/.test(tooth) ? 'Tooth' : 'tooth'} ${COMPOUND_CARDINALS[key] || `${tens} ${ones}`}`;
    },
    description: 'Compound cardinal -> tooth 21-48'
  },
  // Spoken digit pairs preceded by "tooth" or clinical prepositions ("on", "in", "to", "for", "at", "around", "of")
  // e.g. "crown on one six", "pocket depth on four seven", "chip on two one", "tooth three six"
  {
    pattern: /\b(tooth|(?:crown|filling|restoration|implant|extract|extracted|prep|prepped|pain|decay|caries|pocket|chip|fracture|mobility)\s+on|(?:on|in|around|at)\s+tooth|(?:on|in|around|at))\s+(one|two|three|tree|four)\s+(one|two|three|tree|four|five|six|seven|eight)\b/gi,
    replacement: (_match, prefix, q, t) => {
      const qDigit = DIGIT_WORD_MAP[q.toLowerCase()];
      const tDigit = DIGIT_WORD_MAP[t.toLowerCase()];
      if (qDigit && tDigit) {
        const cleanPrefix = prefix.trim();
        const isCapitalized = /^[A-Z]/.test(cleanPrefix);
        const toothWord = isCapitalized ? 'Tooth' : 'tooth';
        if (/^tooth$/i.test(cleanPrefix)) {
          return `${toothWord} ${qDigit}${tDigit}`;
        }
        return `${cleanPrefix} tooth ${qDigit}${tDigit}`;
      }
      return _match;
    },
    description: 'Spoken FDI digit pairs with clinical anchor -> tooth XX'
  },
  // Direct "one six", "four seven", "two one", etc. at word boundaries
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
  // Spoken anatomical quadrant references
  {
    pattern: /\bupper\s*right\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 16',
    description: 'Quadrant text -> FDI 16'
  },
  {
    pattern: /\bupper\s*right\s*second\s*molar\b/gi,
    replacement: 'tooth 17',
    description: 'Quadrant text -> FDI 17'
  },
  {
    pattern: /\bupper\s*right\s*(?:third\s*molar|wisdom\s*tooth)\b/gi,
    replacement: 'tooth 18',
    description: 'Quadrant text -> FDI 18'
  },
  {
    pattern: /\bupper\s*left\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 26',
    description: 'Quadrant text -> FDI 26'
  },
  {
    pattern: /\bupper\s*left\s*second\s*molar\b/gi,
    replacement: 'tooth 27',
    description: 'Quadrant text -> FDI 27'
  },
  {
    pattern: /\bupper\s*left\s*(?:third\s*molar|wisdom\s*tooth)\b/gi,
    replacement: 'tooth 28',
    description: 'Quadrant text -> FDI 28'
  },
  {
    pattern: /\blower\s*left\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 36',
    description: 'Quadrant text -> FDI 36'
  },
  {
    pattern: /\blower\s*left\s*second\s*molar\b/gi,
    replacement: 'tooth 37',
    description: 'Quadrant text -> FDI 37'
  },
  {
    pattern: /\blower\s*left\s*(?:third\s*molar|wisdom\s*tooth)\b/gi,
    replacement: 'tooth 38',
    description: 'Quadrant text -> FDI 38'
  },
  {
    pattern: /\blower\s*right\s*(?:first\s*)?molar\b/gi,
    replacement: 'tooth 46',
    description: 'Quadrant text -> FDI 46'
  },
  {
    pattern: /\blower\s*right\s*second\s*molar\b/gi,
    replacement: 'tooth 47',
    description: 'Quadrant text -> FDI 47'
  },
  {
    pattern: /\blower\s*right\s*(?:third\s*molar|wisdom\s*tooth)\b/gi,
    replacement: 'tooth 48',
    description: 'Quadrant text -> FDI 48'
  },
  {
    pattern: /\bupper\s*right\s*central(?:\s*incisor)?\b/gi,
    replacement: 'tooth 11',
    description: 'Quadrant text -> FDI 11'
  },
  {
    pattern: /\bupper\s*left\s*central(?:\s*incisor)?\b/gi,
    replacement: 'tooth 21',
    description: 'Quadrant text -> FDI 21'
  },
  {
    pattern: /\blower\s*left\s*central(?:\s*incisor)?\b/gi,
    replacement: 'tooth 31',
    description: 'Quadrant text -> FDI 31'
  },
  {
    pattern: /\blower\s*right\s*central(?:\s*incisor)?\b/gi,
    replacement: 'tooth 41',
    description: 'Quadrant text -> FDI 41'
  },

  // ─── 2. DENTAL SURFACES & RESTORATIVE TERMINOLOGY ───
  // Compound surfaces first
  {
    pattern: /\b(?:me\s*zeal|measles|museum)\s*occlusal\b/gi,
    replacement: 'mesio-occlusal',
    description: 'Phonetic "me zeal occlusal" -> mesio-occlusal'
  },
  {
    pattern: /\bdistal\s*(?:buckle|buckel|bocal)\b/gi,
    replacement: 'distobuccal',
    description: 'Speech error "distal buckle" -> distobuccal'
  },
  {
    pattern: /\b(?:me\s*zeal|measles|museum)\s*(?:buckle|buckel|bocal)\b/gi,
    replacement: 'mesiobuccal',
    description: '"mesial buckle" -> mesiobuccal'
  },
  {
    pattern: /\bdistal\s*occlusal\b/gi,
    replacement: 'disto-occlusal',
    description: '"distal occlusal" -> disto-occlusal'
  },
  {
    pattern: /\b(?:buckle|buckel)\s*occlusal\b/gi,
    replacement: 'bucco-occlusal',
    description: '"buckle occlusal" -> bucco-occlusal'
  },
  {
    pattern: /\blingual\s*occlusal\b/gi,
    replacement: 'linguo-occlusal',
    description: '"lingual occlusal" -> linguo-occlusal'
  },
  {
    pattern: /\bpalatal\s*occlusal\b/gi,
    replacement: 'palato-occlusal',
    description: '"palatal occlusal" -> palato-occlusal'
  },
  {
    pattern: /\b(?:M\s*O\s*D|m\s*o\s*d)\b/g,
    replacement: 'MOD',
    description: '"M O D" -> MOD'
  },
  {
    pattern: /\b(?:M\s*O|m\s*o)\b(?=\s+(?:restoration|filling|cavity|composite|amalgam|caries))/g,
    replacement: 'MO',
    description: '"M O" before restorative noun -> MO'
  },
  {
    pattern: /\b(?:D\s*O|d\s*o)\b(?=\s+(?:restoration|filling|cavity|composite|amalgam|caries))/g,
    replacement: 'DO',
    description: '"D O" before restorative noun -> DO'
  },
  // Isolated anatomical surfaces
  {
    pattern: /\bme\s*zeal\b/gi,
    replacement: 'mesial',
    description: 'Phonetic "me zeal" -> mesial'
  },
  {
    pattern: /\b(?:measles|museum)\s+(?=margin|surface|aspect|wall|caries|decay|pit|root|edge|pocket|defect|lesion|restoration|filling)/gi,
    replacement: 'mesial ',
    description: 'Chrome error "measles [dental word]" -> mesial'
  },
  {
    pattern: /\bin\s*sigh\s*sul\b/gi,
    replacement: 'incisal',
    description: 'Phonetic "in sigh sul" -> incisal'
  },
  {
    pattern: /\b(?:in\s*size\s*all|in\s*sisal|in\s*cycle)\b/gi,
    replacement: 'incisal',
    description: 'Phonetic "in size all" -> incisal'
  },
  {
    pattern: /\b(?:palette\s*all|pallette\s*all|palate\s*all)\b/gi,
    replacement: 'palatal',
    description: 'Phonetic "palette all" -> palatal'
  },
  {
    pattern: /\b(?:buckle|buckel|bocal)\b(?=\s+(?:surface|aspect|pit|groove|cusp|cervical|margin|wall|shelf|mucosa|caries|lesion|pocket|defect))/gi,
    replacement: 'buccal',
    description: 'Phonetic "buckle [dental word]" -> buccal'
  },
  {
    pattern: /\b(?:on\s+the|at\s+the)\s+(?:buckle|buckel)\b/gi,
    replacement: 'on the buccal',
    description: '"on the buckle" -> on the buccal'
  },
  {
    pattern: /\b(?:a\s*clue\s*so|a\s*closure)\b/gi,
    replacement: 'occlusal',
    description: 'Phonetic "a clue so" / "a closure" -> occlusal'
  },
  {
    pattern: /\bocclusion\s+(?=surface|table|wear|caries|restoration|reduction|margin)/gi,
    replacement: 'occlusal ',
    description: '"occlusion [surface]" -> occlusal'
  },

  // ─── 3. CLINICAL DIAGNOSTICS & PATHOLOGY ───
  // Caries homophones: "carries" / "curries" -> caries
  {
    pattern: /\b(?:recurrent|secondary|root|deep|active|arrested|interproximal|incipient|occlusal|buccal|mesial|distal|lingual|palatal|cervical|enamel|dentin|dentinal)\s+(?:carries|curries|Careys|Kerry's)\b/gi,
    replacement: (match) => match.replace(/(?:carries|curries|Careys|Kerry's)/i, 'caries'),
    description: 'Clinical adjective + "carries" -> caries'
  },
  {
    pattern: /\b(?:carries|curries|Careys|Kerry's)\s+(?=on|in|into|lesion|lesions|detected|noted|present|excavated|arrested|identified|observed)/gi,
    replacement: 'caries ',
    description: '"carries [verb/prep]" -> caries'
  },
  {
    pattern: /\bdental\s+(?:carries|curries)\b/gi,
    replacement: 'dental caries',
    description: '"dental carries" -> dental caries'
  },
  // Endodontic & pulpal
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
  // Periodontal probing depths
  {
    pattern: /\btree\s*two\s*tree\b/gi,
    replacement: '3-2-3 mm',
    description: 'Phonetic "tree two tree" -> 3-2-3 mm'
  },
  {
    pattern: /\b(?:probe\s+depths?|depths?|probing|pocket\s+depths?)\s+(?:are|is)?\s*([1-9])\s+([1-9])\s+([1-9])\b/gi,
    replacement: 'pocket depths are $1-$2-$3 mm',
    description: 'Digit triplet probe depth -> X-X-X mm'
  },
  {
    pattern: /\b([1-9])\s*[-–]\s*([1-9])\s*[-–]\s*([1-9])\s*(?:mils|mills)\b/gi,
    replacement: '$1-$2-$3 mm',
    description: 'Probe triplet "3-2-3 mils" -> 3-2-3 mm'
  },
  {
    pattern: /\bperiod\s*on\s*tight\s*is\b/gi,
    replacement: 'periodontitis',
    description: 'Phonetic "period on tight is" -> periodontitis'
  },
  {
    pattern: /\bginger\s*vitis\b/gi,
    replacement: 'gingivitis',
    description: 'Phonetic "ginger vitis" -> gingivitis'
  },
  {
    pattern: /\bsub\s*gingival\b/gi,
    replacement: 'subgingival',
    description: '"sub gingival" -> subgingival'
  },
  {
    pattern: /\bsupra\s*gingival\b/gi,
    replacement: 'supragingival',
    description: '"supra gingival" -> supragingival'
  },
  {
    pattern: /\b(?:for\s*cation|fur\s*cation)\b/gi,
    replacement: 'furcation',
    description: 'Phonetic "for cation" -> furcation'
  },
  {
    pattern: /\b(grade)\s+([1-3])\s+vacation\b/gi,
    replacement: (_m, g, num) => `${/^[A-Z]/.test(g) ? 'Grade' : 'grade'} ${num} furcation`,
    description: 'Acoustic mis-transcription "grade X vacation" -> grade X furcation'
  },
  {
    pattern: /\bcalculas\b/gi,
    replacement: 'calculus',
    description: '"calculas" -> calculus'
  },
  {
    pattern: /\b(?:composite\s*)?feeling\b/gi,
    replacement: 'filling (composite restoration)',
    description: 'Homophone "feeling" -> filling'
  },
  {
    pattern: /\bwhite\s+feeling\b/gi,
    replacement: 'white filling (composite restoration)',
    description: 'Homophone "white feeling" -> white filling'
  },
  {
    pattern: /\bPerry\s*apical\b/gi,
    replacement: 'periapical',
    description: 'Phonetic "Perry apical" -> periapical'
  },
  {
    pattern: /\bradio\s*(?:lucency|loosen\s*see)\b/gi,
    replacement: 'radiolucency',
    description: 'Phonetic "radio loosen see" -> radiolucency'
  },
  {
    pattern: /\bradio\s*(?:opacity|pass\s*it\s*tea)\b/gi,
    replacement: 'radiopacity',
    description: 'Phonetic "radio pass it tea" -> radiopacity'
  },
  {
    pattern: /\bdry\s*sock\s*it\b/gi,
    replacement: 'dry socket (alveolar osteitis)',
    description: 'Phonetic "dry sock it" -> dry socket'
  },

  // ─── 4. ANAESTHETICS, PHARMACOLOGY & DOSING ───
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
    pattern: /\barty\s*cane\b/gi,
    replacement: 'articaine',
    description: 'Phonetic "arty cane" -> articaine'
  },
  {
    pattern: /\bme\s*pivot\s*cane\b/gi,
    replacement: 'mepivacaine',
    description: 'Phonetic "me pivot cane" -> mepivacaine'
  },
  {
    pattern: /\bprill?o\s*cane\b/gi,
    replacement: 'prilocaine',
    description: 'Phonetic "prillo cane" -> prilocaine'
  },
  {
    pattern: /\bsept\s*an\s*est\b/gi,
    replacement: 'Septanest (articaine)',
    description: 'Phonetic "sept an est" -> Septanest'
  },
  {
    pattern: /\bscan\s*doe\s*nest\b/gi,
    replacement: 'Scandonest (mepivacaine)',
    description: 'Phonetic "scan doe nest" -> Scandonest'
  },
  {
    pattern: /\b(?:one|1)\s+in\s+(?:eighty\s*thousand|80[, ]?000)\b/gi,
    replacement: '1:80,000',
    description: 'Spoken vasoconstrictor ratio -> 1:80,000'
  },
  {
    pattern: /\b(?:one|1)\s+in\s+(?:one\s*hundred\s*thousand|100[, ]?000)\b/gi,
    replacement: '1:100,000',
    description: 'Spoken vasoconstrictor ratio -> 1:100,000'
  },
  {
    pattern: /\b(?:one|1)\s+in\s+(?:two\s*hundred\s*thousand|200[, ]?000)\b/gi,
    replacement: '1:200,000',
    description: 'Spoken vasoconstrictor ratio -> 1:200,000'
  },
  {
    pattern: /\bchlorine\s*hex\s*(?:a\s*dean|idine)\b/gi,
    replacement: 'chlorhexidine',
    description: 'Phonetic "chlorine hex idine" -> chlorhexidine'
  },
  {
    pattern: /\bchlo\s*hex\b/gi,
    replacement: 'chlorhexidine',
    description: 'Colloquial "chlo hex" -> chlorhexidine'
  },

  // ─── 5. DENTAL MATERIALS & INSTRUMENTS ───
  {
    pattern: /\brubber\s*damn\b/gi,
    replacement: 'rubber dam',
    description: 'Homophone "rubber damn" -> rubber dam'
  },
  {
    pattern: /\bdamn\s*clamp\b/gi,
    replacement: 'dam clamp',
    description: 'Homophone "damn clamp" -> dam clamp'
  },
  {
    pattern: /\bleader\s*mix\b/gi,
    replacement: 'Ledermix',
    description: 'Phonetic "leader mix" -> Ledermix'
  },
  {
    pattern: /\bleather\s*mix\b/gi,
    replacement: 'Ledermix',
    description: 'Phonetic "leather mix" -> Ledermix'
  },
  {
    pattern: /\b(?:kavit|cave\s*it)\b/gi,
    replacement: 'Cavit',
    description: 'Phonetic "cave it" / "kavit" -> Cavit'
  },
  {
    pattern: /\b(?:not\s+safe\s+to\s+give\s+you\s+|give\s+you\s+)?anti\s*virus\b/gi,
    replacement: 'antibiotics',
    description: 'Phonetic "antivirus" in bacterial dental context -> antibiotics'
  },
  {
    pattern: /\bdressing\s+inside\s+the\s+(?:poop|pipe|pulping)\b/gi,
    replacement: 'dressing inside the pulp chamber',
    description: 'Acoustic misinterpretation "inside the poop" -> inside the pulp chamber'
  },
  {
    pattern: /\boutside\s+the\s+tool\b/gi,
    replacement: 'outside the tooth',
    description: 'Phonetic "outside the tool" -> outside the tooth'
  },
  // ── Surgical & Extraction Acoustic Mis-Transcriptions ──
  // Fast speech / accent error: Chrome hears "take the tooth [out]" / "taking the tooth [out]" as "2000" / "2000 out"
  {
    pattern: /\btaking\s+(?:the\s+)?2000(?:\s+out)?\b/gi,
    replacement: (m) => (/^[A-Z]/.test(m) ? 'Taking the tooth out' : 'taking the tooth out'),
    description: 'Acoustic mis-transcription "taking the 2000" -> taking the tooth out'
  },
  {
    pattern: /\btake\s+(?:the\s+)?2000(?:\s+out)?\b/gi,
    replacement: (m) => (/^[A-Z]/.test(m) ? 'Take the tooth out' : 'take the tooth out'),
    description: 'Acoustic mis-transcription "take the 2000" / "take 2000 out" -> take the tooth out'
  },
  {
    pattern: /\bto\s+2000\s+out\b/gi,
    replacement: (m) => (/^[A-Z]/.test(m) ? 'To take the tooth out' : 'to take the tooth out'),
    description: 'Acoustic mis-transcription "to 2000 out" -> to take the tooth out'
  },
  {
    pattern: /\b2000\s+out\b/gi,
    replacement: 'take the tooth out',
    description: 'Acoustic mis-transcription "2000 out" -> take the tooth out'
  },
  {
    pattern: /\b((?:options?\s+(?:is|are|either)\s+(?:to\s+)?|like\s+to\s+|want\s+to\s+|going\s+to\s+|we\s+can\s+|can\s+|or\s+to\s+|or\s+we\s+can\s+|specialist\s+to\s+)2000)\b(?!\s*(?:dollars?|bucks?|\.00|AUD|percent|patients?|teeth|mg|ml))\b/gi,
    replacement: (_match, prefix) => prefix.replace(/2000$/, 'take the tooth out'),
    description: 'Extraction context "like to 2000" / "we can 2000" -> take the tooth out'
  },
  {
    pattern: /\btemporary\s+(?:Canon|cannon)\b/gi,
    replacement: 'temporary crown',
    description: 'Phonetic "temporary Canon" -> temporary crown'
  },
  {
    pattern: /\bput\s+the\s+temperature\b/gi,
    replacement: 'place temporary restoration',
    description: 'Phonetic "put the temperature" -> place temporary restoration'
  },
  {
    pattern: /\bgutta\s*perka\b/gi,
    replacement: 'gutta-percha',
    description: 'Phonetic "gutta perka" -> gutta-percha'
  },
  {
    pattern: /\bgood\s*a\s*purchase\b/gi,
    replacement: 'gutta-percha',
    description: 'Acoustic mis-transcription "good a purchase" -> gutta-percha'
  },
  {
    pattern: /\ba\s*mal\s*gum\b/gi,
    replacement: 'amalgam',
    description: 'Phonetic "a mal gum" -> amalgam'
  },
  {
    pattern: /\b(?:glass\s*I\s*honor|G\s*I\s*see)\b/gi,
    replacement: 'GIC (glass ionomer)',
    description: 'Phonetic "glass I honor" / "G I see" -> GIC'
  },
  {
    pattern: /\bfuji\s*(?:nine|9)\b/gi,
    replacement: 'Fuji IX',
    description: 'Spoken "fuji nine" -> Fuji IX'
  },
  {
    pattern: /\bfuji\s*(?:two|2)\b/gi,
    replacement: 'Fuji II',
    description: 'Spoken "fuji two" -> Fuji II'
  },
  {
    pattern: /\bdie\s*(?:cal|cull)\b/gi,
    replacement: 'Dycal',
    description: 'Phonetic "die cal" -> Dycal'
  },
  {
    pattern: /\bI\s*R\s*M\b/g,
    replacement: 'IRM',
    description: '"I R M" -> IRM'
  },
  {
    pattern: /\b(?:H|action)\s+and\s+bond\b/gi,
    replacement: 'etch and bond',
    description: 'Phonetic "H and bond" / "action and bond" -> etch and bond'
  },
  {
    pattern: /\bbite\s*wings?\b/gi,
    replacement: (m) => (/s$/i.test(m) ? 'bitewings' : 'bitewing'),
    description: '"bite wing(s)" -> bitewing(s)'
  },
  {
    pattern: /\b(?:oh\s*PG|O\s*P\s*G)\b/gi,
    replacement: 'OPG',
    description: 'Spoken "oh PG" -> OPG'
  },
  {
    pattern: /\b(?:CBC\s*T|C\s*B\s*C\s*T)\b/gi,
    replacement: 'CBCT',
    description: 'Spoken "CBC T" -> CBCT'
  },
  {
    pattern: /\bvi\s*crill\b/gi,
    replacement: 'Vicryl',
    description: 'Phonetic "vi crill" -> Vicryl'
  },
  // ── High-Risk Dental Pharmacotherapy (MRONJ & Bleeding Risk Normalization) ──
  {
    pattern: /\b(?:dimosuma|dimosumab|dinusimab|denosa\s*mab|deno\s*sumab)(?!\s*\(Prolia\))\b/gi,
    replacement: 'Denosumab (Prolia)',
    description: 'Acoustic mis-transcriptions of Denosumab -> Denosumab (Prolia)'
  },
  {
    pattern: /\b(?:pro\s*lee\s*a)(?!\s*\(Prolia\))\b/gi,
    replacement: 'Prolia',
    description: 'Spoken "pro lee a" -> Prolia'
  },
  {
    pattern: /\b(?:x\s*geva|exgeva)(?!\s*\(denosumab\))\b/gi,
    replacement: 'Xgeva (denosumab)',
    description: 'Spoken "exgeva" -> Xgeva (denosumab)'
  },
  {
    pattern: /\b(?:fos\s*a\s*max|fossa\s*max)(?!\s*\(alendronate\))\b/gi,
    replacement: 'Fosamax (alendronate)',
    description: 'Spoken "fos a max" -> Fosamax (alendronate)'
  },
  {
    pattern: /\b(?:act\s*o\s*nell?|actonel)(?!\s*\(risedronate\))\b/gi,
    replacement: 'Actonel (risedronate)',
    description: 'Spoken "actonel" -> Actonel (risedronate)'
  },
  {
    pattern: /\b(?:a\s*clasta|aklasta)(?!\s*\(zoledronic acid\))\b/gi,
    replacement: 'Aclasta (zoledronic acid)',
    description: 'Spoken "aklasta" -> Aclasta (zoledronic acid)'
  },
  {
    pattern: /\b(?:bone\s*injection|osteoporosis\s*injection)\b/gi,
    replacement: 'osteoporosis antiresorptive injection',
    description: 'Colloquial "bone injection" -> osteoporosis antiresorptive injection'
  },
  {
    pattern: /\b(?:the\s+thinner\s+right|a\s+thinner\s+right)\b/gi,
    replacement: 'blood thinner',
    description: 'Acoustic mis-transcription "the thinner right" -> blood thinner'
  },
  {
    pattern: /\b(?:el\s*e\s*quis|el\s*i\s*quis)(?!\s*\(apixaban\))\b/gi,
    replacement: 'Eliquis (apixaban)',
    description: 'Spoken "elequis" -> Eliquis (apixaban)'
  },
  {
    pattern: /\b(?:za\s*rel\s*toe|xarelto)(?!\s*\(rivaroxaban\))\b/gi,
    replacement: 'Xarelto (rivaroxaban)',
    description: 'Spoken "zareltoe" -> Xarelto (rivaroxaban)'
  },
  {
    pattern: /\b(?:plav\s*ix|plavex)(?!\s*\(clopidogrel\))\b/gi,
    replacement: 'Plavix (clopidogrel)',
    description: 'Spoken "plavex" -> Plavix (clopidogrel)'
  },
  {
    pattern: /\b(?:pra\s*daxa)(?!\s*\(dabigatran\))\b/gi,
    replacement: 'Pradaxa (dabigatran)',
    description: 'Spoken "pradaxa" -> Pradaxa (dabigatran)'
  },
  {
    pattern: /\bGP\s*clear(?:ance)?\b/gi,
    replacement: 'GP medical clearance',
    description: 'Spoken "GP clear" -> GP medical clearance'
  },
  {
    pattern: /\bdoctor\s*clear(?:ance)?\b/gi,
    replacement: 'physician medical clearance',
    description: 'Spoken "doctor clear" -> physician medical clearance'
  },
  // ── Idempotency Collapsing Guards: prevent repeated parentheticals ──
  {
    pattern: /\bDenosumab(?:\s*\(Prolia\)){2,}/gi,
    replacement: 'Denosumab (Prolia)',
    description: 'Collapse repeated (Prolia) chains'
  },
  {
    pattern: /\bEliquis(?:\s*\(apixaban\)){2,}/gi,
    replacement: 'Eliquis (apixaban)',
    description: 'Collapse repeated (apixaban) chains'
  },
  {
    pattern: /\bXarelto(?:\s*\(rivaroxaban\)){2,}/gi,
    replacement: 'Xarelto (rivaroxaban)',
    description: 'Collapse repeated (rivaroxaban) chains'
  },
  {
    pattern: /\bFosamax(?:\s*\(alendronate\)){2,}/gi,
    replacement: 'Fosamax (alendronate)',
    description: 'Collapse repeated (alendronate) chains'
  },
  {
    pattern: /\bActonel(?:\s*\(risedronate\)){2,}/gi,
    replacement: 'Actonel (risedronate)',
    description: 'Collapse repeated (risedronate) chains'
  },
  {
    pattern: /\bAclasta(?:\s*\(zoledronic acid\)){2,}/gi,
    replacement: 'Aclasta (zoledronic acid)',
    description: 'Collapse repeated (zoledronic acid) chains'
  },
  {
    pattern: /\bXgeva(?:\s*\(denosumab\)){2,}/gi,
    replacement: 'Xgeva (denosumab)',
    description: 'Collapse repeated (denosumab) chains'
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
