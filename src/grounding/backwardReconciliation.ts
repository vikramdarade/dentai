/**
 * Backward Entity Reconciliation Engine (Work Package 3.2 - Zero-Omission Standard)
 *
 * Scans raw operatory audio transcripts to ensure critical clinical entities
 * (allergies, anticoagulants, antiresorptives, systemic diseases, teeth discussed)
 * spoken during the consultation are NEVER silently dropped from the generated note.
 */

import {
  TimestampedUtterance,
  OmissionAlert,
  BackwardReconciliationResult
} from './types';
import { isValidFdiTooth } from '../lib/fdiNotationEngine';

// Critical Clinical Dictionaries
const ALLERGY_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'Penicillin', regex: /\b(penicillin|amoxicillin|amoxil|augmentin)\b/i },
  { name: 'Cephalosporin', regex: /\b(cephalosporin|keflex|cephalexin)\b/i },
  { name: 'Latex', regex: /\blatex\b/i },
  { name: 'Chlorhexidine', regex: /\bchlorhexidine\b/i },
  { name: 'Codeine', regex: /\bcodeine\b/i },
  { name: 'Aspirin / NSAIDs', regex: /\b(aspirin|ibuprofen|nurofen|nsaid|nsaids)\b/i },
  { name: 'Sulfa Drugs', regex: /\b(sulfa|sulfonamide|bactrim)\b/i }
];

const MEDICATION_PATTERNS: { name: string; generic: string; category: string; regex: RegExp }[] = [
  // Anticoagulants / Antiplatelets
  { name: 'Eliquis (Apixaban)', generic: 'Apixaban', category: 'Anticoagulant', regex: /\b(eliquis|apixaban)\b/i },
  { name: 'Xarelto (Rivaroxaban)', generic: 'Rivaroxaban', category: 'Anticoagulant', regex: /\b(xarelto|rivaroxaban)\b/i },
  { name: 'Warfarin (Coumadin)', generic: 'Warfarin', category: 'Anticoagulant', regex: /\b(warfarin|coumadin|marevan)\b/i },
  { name: 'Pradaxa (Dabigatran)', generic: 'Dabigatran', category: 'Anticoagulant', regex: /\b(pradaxa|dabigatran)\b/i },
  { name: 'Plavix (Clopidogrel)', generic: 'Clopidogrel', category: 'Antiplatelet', regex: /\b(plavix|clopidogrel)\b/i },
  { name: 'Brilinta (Ticagrelor)', generic: 'Ticagrelor', category: 'Antiplatelet', regex: /\b(brilinta|ticagrelor)\b/i },
  // Antiresorptives / MRONJ risk
  { name: 'Prolia / Xgeva (Denosumab)', generic: 'Denosumab', category: 'Antiresorptive', regex: /\b(prolia|xgeva|denosumab)\b/i },
  { name: 'Fosamax (Alendronate)', generic: 'Alendronate', category: 'Antiresorptive', regex: /\b(fosamax|alendronate)\b/i },
  { name: 'Aclasta / Zometa (Zoledronic acid)', generic: 'Zoledronic acid', category: 'Antiresorptive', regex: /\b(aclasta|zometa|zoledronic)\b/i },
  { name: 'Actonel (Risedronate)', generic: 'Risedronate', category: 'Antiresorptive', regex: /\b(actonel|risedronate)\b/i },
  { name: 'Evenity (Romosozumab)', generic: 'Romosozumab', category: 'Antiresorptive', regex: /\b(evenity|romosozumab)\b/i }
];

const CONDITION_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'Heart flutter / Atrial Fibrillation', regex: /\b(heart flutter|atrial fib|afib|arrhythmia)\b/i },
  { name: 'Infective Endocarditis Risk', regex: /\b(endocarditis|valve replacement|heart valve|rheumatic)\b/i },
  { name: 'Diabetes', regex: /\b(diabetes|diabetic|insulin|metformin)\b/i },
  { name: 'Epilepsy / Seizures', regex: /\b(epilepsy|seizure|convulsion)\b/i },
  { name: 'Asthma', regex: /\b(asthma|ventolin|salbutamol)\b/i },
  { name: 'Osteoporosis', regex: /\bosteoporosis\b/i },
  { name: 'Bleeding Disorder', regex: /\b(bleeding disorder|hemophilia|von willebrand)\b/i }
];

/**
 * Reconciles the generated clinical note backward against the raw audio transcript.
 * Flags missing medical alerts, allergies, and discussed teeth.
 */
export function reconcileEntitiesBackward(
  utterances: TimestampedUtterance[],
  noteText: string
): BackwardReconciliationResult {
  const normNote = noteText.toLowerCase();

  const detectedAllergies = new Set<string>();
  const detectedMedications = new Set<string>();
  const detectedConditions = new Set<string>();
  const detectedTeeth = new Set<number>();

  const omissions: OmissionAlert[] = [];
  let alertCounter = 1;

  for (const utterance of utterances) {
    const text = utterance.text;
    const lower = text.toLowerCase();

    // 1. Scan for Allergies
    const isAllergyContext = /\b(allerg|hives|rash|reaction|anaphylax|swell|itch)\b/i.test(lower);
    for (const allergy of ALLERGY_PATTERNS) {
      if (allergy.regex.test(lower)) {
        detectedAllergies.add(allergy.name);

        // Check if note records this allergy
        const recordedInNote = allergy.regex.test(normNote);
        if (!recordedInNote) {
          // Check if this was phrased as an actual allergy (not e.g. "no penicillin allergy")
          if (isAllergyContext || lower.includes('allergic to') || lower.includes('hives with')) {
            const alreadyAlerted = omissions.some(o => o.entityName === allergy.name);
            if (!alreadyAlerted) {
              omissions.push({
                alertId: `omission-${alertCounter++}`,
                entityType: 'allergy',
                entityName: allergy.name,
                spokenInUtterance: {
                  utteranceId: utterance.id,
                  speaker: utterance.sender,
                  verbatimText: utterance.text,
                  timestampMs: utterance.startTimeMs
                },
                severity: 'critical',
                title: `Critical Safety Alert: Spoken ${allergy.name} Allergy Omitted from Clinical Record`,
                reconciliationPrompt: `Patient or clinician stated allergy to ${allergy.name} at ${Math.floor(utterance.startTimeMs / 1000)}s ("${utterance.text.slice(0, 80)}..."), but it is missing from the Medical History. Please update before signing.`
              });
            }
          }
        }
      }
    }

    // 2. Scan for High-Risk Medications
    for (const med of MEDICATION_PATTERNS) {
      if (med.regex.test(lower)) {
        detectedMedications.add(med.name);

        // Verify presence in note
        const recordedInNote = med.regex.test(normNote) || normNote.includes(med.generic.toLowerCase());
        if (!recordedInNote) {
          const alreadyAlerted = omissions.some(o => o.entityName === med.name);
          if (!alreadyAlerted) {
            omissions.push({
              alertId: `omission-${alertCounter++}`,
              entityType: 'medication',
              entityName: med.name,
              spokenInUtterance: {
                utteranceId: utterance.id,
                speaker: utterance.sender,
                verbatimText: utterance.text,
                timestampMs: utterance.startTimeMs
              },
              severity: 'critical',
              title: `Critical Alert: High-Risk ${med.category} (${med.name}) Omitted from Record`,
              reconciliationPrompt: `Patient reported taking ${med.name} at ${Math.floor(utterance.startTimeMs / 1000)}s, but it was not captured in the note. Hemostasis precautions and surgical risk discussion must be documented.`
            });
          }
        }
      }
    }

    // 3. Scan for Systemic Conditions
    for (const cond of CONDITION_PATTERNS) {
      if (cond.regex.test(lower)) {
        detectedConditions.add(cond.name);

        const recordedInNote = cond.regex.test(normNote);
        if (!recordedInNote) {
          const alreadyAlerted = omissions.some(o => o.entityName === cond.name);
          if (!alreadyAlerted) {
            omissions.push({
              alertId: `omission-${alertCounter++}`,
              entityType: 'systemic_condition',
              entityName: cond.name,
              spokenInUtterance: {
                utteranceId: utterance.id,
                speaker: utterance.sender,
                verbatimText: utterance.text,
                timestampMs: utterance.startTimeMs
              },
              severity: 'high',
              title: `Medical Notice: Spoken Condition (${cond.name}) Not Documented`,
              reconciliationPrompt: `Patient mentioned ${cond.name} during discussion. Ensure relevant systemic precautions are noted.`
            });
          }
        }
      }
    }

    // 4. Scan for Discussed Teeth
    const toothMatches = lower.match(/\b(?:tooth|teeth)?\s*([1-8][1-8])\b/g) || [];
    for (const m of toothMatches) {
      const numMatch = m.match(/([1-8][1-8])/);
      if (numMatch) {
        const fdi = parseInt(numMatch[1], 10);
        if (isValidFdiTooth(fdi)) {
          detectedTeeth.add(fdi);
        }
      }
    }
  }

  // Cross-reference teeth discussed in pain/complaint
  for (const toothNum of Array.from(detectedTeeth)) {
    const toothPattern = new RegExp(`\\b(?:tooth\\s+)?${toothNum}\\b`, 'i');
    if (!toothPattern.test(normNote)) {
      omissions.push({
        alertId: `omission-${alertCounter++}`,
        entityType: 'discussed_tooth',
        entityName: `Tooth ${toothNum}`,
        spokenInUtterance: {
          utteranceId: 'transcript',
          speaker: 'Operatory Speech',
          verbatimText: `Spoken reference to tooth ${toothNum}`,
          timestampMs: 0
        },
        severity: 'warning',
        title: `Clinical Notice: Tooth ${toothNum} Mentioned in Audio but Omitted from Note`,
        reconciliationPrompt: `Tooth ${toothNum} was discussed during the visit but does not appear in findings or plan.`
      });
    }
  }

  const hasCriticalOmissions = omissions.some(o => o.severity === 'critical');

  return {
    hasCriticalOmissions,
    omissionsCount: omissions.length,
    detectedSpokenEntities: {
      allergies: Array.from(detectedAllergies),
      medications: Array.from(detectedMedications),
      conditions: Array.from(detectedConditions),
      teeth: Array.from(detectedTeeth)
    },
    omissions
  };
}
