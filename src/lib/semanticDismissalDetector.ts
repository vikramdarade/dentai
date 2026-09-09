import { DismissalDetectionResult } from './beaconTypes';

/**
 * Australian Dental Clinical Dismissal Script Patterns
 * Matches typical phrases spoken by dentists/oral health therapists
 * to patients when concluding active treatment and preparing for dismissal.
 */
export const DISMISSAL_PATTERNS: Array<{ regex: RegExp; label: string; weight: number }> = [
  // 1. Explicit completion statements
  {
    regex: /\b(?:we(?:'re| are)\s+)?all\s+(?:done|finished|set|sorted)(?:\s+for\s+today)?\b/i,
    label: 'All Done for Today',
    weight: 0.95
  },
  {
    regex: /\bthat(?:'s| is)\s+(?:us\s+)?all\s+(?:done|finished|wrapped\s+up)\b/i,
    label: 'That is all done',
    weight: 0.9
  },
  // 2. Post-op numbness & mastication cautions
  {
    regex: /\b(?:be\s+)?careful\s+(?:with|chewing(?:\s+on)?)\s+(?:the|that|your)\s+(?:numbness|side|lip|tongue|cheek)\b/i,
    label: 'Careful with Numbness Cautions',
    weight: 0.92
  },
  {
    regex: /\bnumbness\s+(?:should|will)\s+(?:wear\s+off|last)(?:\s+in)?(?:\s+about)?\s+\d+\s+(?:hours?|hrs?)\b/i,
    label: 'Numbness Wear-Off Instructions',
    weight: 0.88
  },
  {
    regex: /\bdon(?:'t|ot)\s+bite\s+(?:your\s+)?(?:lip|cheek|tongue)\s+while\s+(?:you(?:'re| are)\s+)?numb\b/i,
    label: 'Bite Prevention While Numb',
    weight: 0.85
  },
  // 3. Post-op hygiene (warm salt water)
  {
    regex: /\brinse\s+(?:out\s+)?with\s+(?:warm\s+)?salt\s+water\b/i,
    label: 'Warm Salt Water Rinse',
    weight: 0.86
  },
  // 4. Front desk / Reception handoff
  {
    regex: /\b(?:reception|front\s+desk|front\s+counter)\s+(?:will|to)\s+(?:help|settle|sort|give|book|take)\b/i,
    label: 'Reception Handoff',
    weight: 0.9
  },
  {
    regex: /\b(?:head|step|walk)\s+(?:out|on\s+out)\s+to\s+(?:reception|the\s+front)\b/i,
    label: 'Head Out to Reception',
    weight: 0.88
  },
  // 5. Recall / Next visit scheduling
  {
    regex: /\b(?:see\s+you|recall|book\s+you\s+in)\s+(?:in|for)?\s+(?:six|6)\s+months\b/i,
    label: '6-Month Recall Cue',
    weight: 0.85
  },
  {
    regex: /\bnext\s+visit\s+we(?:'ll| will)\s+(?:do|start|look\s+at|prep)\b/i,
    label: 'Next Visit Plan',
    weight: 0.8
  },
  // 6. Specialist Referral dispatch
  {
    regex: /\b(?:referral\s+letter|refer\s+you)\s+(?:to|for)\s+(?:the\s+)?(?:specialist|endodontist|periodontist|oral\s+surgeon)\b/i,
    label: 'Specialist Referral Dispatch',
    weight: 0.85
  }
];

/**
 * Evaluates transcript text or speech recognition interim text
 * against Australian clinical dismissal cues.
 */
export function detectDismissalCues(transcriptText: string): DismissalDetectionResult {
  if (!transcriptText || typeof transcriptText !== 'string') {
    return { detected: false, confidence: 0 };
  }

  const cleanText = transcriptText.trim();
  if (cleanText.length < 5) {
    return { detected: false, confidence: 0 };
  }

  for (const pattern of DISMISSAL_PATTERNS) {
    const match = pattern.regex.exec(cleanText);
    if (match) {
      return {
        detected: true,
        phrase: match[0],
        confidence: pattern.weight,
        detectedAt: Date.now()
      };
    }
  }

  return { detected: false, confidence: 0 };
}

/**
 * Model 4: Evaluates whether the consultation should automatically stop.
 * Condition:
 * 1. Dismissal cue was detected AND lull duration has elapsed (e.g. >= 60-90s)
 * OR
 * 2. Continuous silence exceeds the hard safety net threshold (e.g. >= 210s / 3.5 mins).
 */
export function shouldAutoStopConsultation(
  dismissalDetectedAt: number | null,
  inactivitySeconds: number,
  dismissalLullThresholdSeconds: number = 75,
  hardSilenceSafetyNetSeconds: number = 210
): boolean {
  if (dismissalDetectedAt && inactivitySeconds >= dismissalLullThresholdSeconds) {
    return true;
  }
  if (inactivitySeconds >= hardSilenceSafetyNetSeconds) {
    return true;
  }
  return false;
}

