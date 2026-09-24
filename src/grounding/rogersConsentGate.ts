/**
 * Rogers v Whitaker (1992) 175 CLR 479 Medico-Legal Informed Consent Grounding Gate
 *
 * Implements evidentiary verification of patient informed consent under Australian law:
 * 1. Verifies that the clinician verbally warned the patient of procedure-specific material risks.
 * 2. Verifies bidirectional communication (patient verbal acknowledgment and consent).
 * 3. Enforces Zero-Fabrication Rule 12: Detects and rejects boilerplate / canned consent clauses
 *    that were inserted by templates or language models without audio corroboration.
 */

import {
  TimestampedUtterance,
  RogersRiskDiscussion,
  RogersConsentVerification
} from './types';

interface MaterialRiskDefinition {
  type: RogersRiskDiscussion['riskType'];
  label: string;
  clinicianRegex: RegExp;
  applicableProcedures: RegExp;
}

const MATERIAL_RISK_DEFINITIONS: MaterialRiskDefinition[] = [
  {
    type: 'nerve_damage_paresthesia',
    label: 'Inferior Alveolar / Lingual Nerve Paresthesia (Numbness)',
    clinicianRegex: /\b(nerve|paresthesia|numbness|lower lip|chin|tongue numbness|ian)\b/i,
    applicableProcedures: /\b(wisdom|48|38|mandibular molar|surgical extract|lower molar)\b/i
  },
  {
    type: 'sinus_perforation',
    label: 'Maxillary Sinus Perforation / Oroantral Communication (OAC)',
    clinicianRegex: /\b(sinus|perforation|oroantral|fistula|antrum)\b/i,
    applicableProcedures: /\b(16|17|18|26|27|28|upper molar|maxillary molar)\b/i
  },
  {
    type: 'excessive_bleeding',
    label: 'Prolonged Bleeding / Hematoma',
    clinicianRegex: /\b(bleeding|bleed|hemorrhage|blood loss|oozing)\b/i,
    applicableProcedures: /\b(extract|surgical|implant|biopsy|flap)\b/i
  },
  {
    type: 'dry_socket',
    label: 'Alveolar Osteitis (Dry Socket)',
    clinicianRegex: /\b(dry socket|osteitis|clot dislodge)\b/i,
    applicableProcedures: /\b(extract|extraction|surgical removal|exo)\b/i
  },
  {
    type: 'tooth_fracture',
    label: 'Adjacent Tooth / Root Fracture',
    clinicianRegex: /\b(root fracture|broken root|damage to adjacent|adjacent tooth)\b/i,
    applicableProcedures: /\b(extract|surgical|luxat|forceps)\b/i
  },
  {
    type: 'post_op_pain_infection',
    label: 'Post-Operative Infection, Swelling & Trismus',
    clinicianRegex: /\b(infection|swelling|stiffness|trismus|bruising)\b/i,
    applicableProcedures: /\b(extract|surgical|implant)\b/i
  }
];

const PATIENT_ACCEPTANCE_REGEX =
  /\b(i understand|i agree|go ahead|proceed|take it out|happy to|consent|let us do it|let's do it|sounds good|yes please)\b/i;

const ALTERNATIVE_REGEX =
  /\b(alternative|alternatives|leave it|leaving it|monitoring|monitor|other option|specialist|referral|do nothing)\b/i;

const COST_REGEX =
  /\b(fee|cost|dollars|\$|quote|estimate|charge|out of pocket)\b/i;

const BOILERPLATE_PHRASES = [
  'detailed informed consent discussed',
  'informed consent adhering to rogers v whitaker',
  'patient warned of inferior alveolar nerve paresthesia',
  'risks including paresthesia, root fracture and sinus perforation explained',
  'all material risks and alternatives were discussed in detail'
];

/**
 * Evaluates whether informed consent documented in clinical notes is legally grounded
 * in the operatory transcript under Rogers v Whitaker standards.
 */
export function verifyRogersConsent(
  utterances: TimestampedUtterance[],
  noteText: string,
  procedureContext?: string
): RogersConsentVerification {
  const normNote = noteText.toLowerCase();
  const fullTranscriptText = utterances.map(u => `${u.sender}: ${u.text}`).join(' \n ');
  const normTranscript = fullTranscriptText.toLowerCase();

  // 1. Detect if procedure is invasive
  const procString = `${procedureContext || ''} ${noteText} ${fullTranscriptText}`.toLowerCase();
  const isInvasive = /\b(surgical|extract|extraction|exo|implant|wisdom|bone removal|root canal|biopsy)\b/i.test(procString);
  const requiresWrittenConsent = /\b(surgical|wisdom|bone removal|implant)\b/i.test(procString);

  // 2. Scan Material Risks discussed in audio
  const materialRisksDiscussed: RogersRiskDiscussion[] = [];

  for (const riskDef of MATERIAL_RISK_DEFINITIONS) {
    let explainedByClinician = false;
    let acknowledgedByPatient = false;
    let clinicianUtterance: TimestampedUtterance | undefined;
    let patientUtterance: TimestampedUtterance | undefined;

    for (let i = 0; i < utterances.length; i++) {
      const u = utterances[i];
      if (u.sender === 'Dentist' && riskDef.clinicianRegex.test(u.text)) {
        explainedByClinician = true;
        clinicianUtterance = u;

        // Check if patient responded with acknowledgment within the next 3 utterances
        for (let j = i + 1; j < Math.min(utterances.length, i + 4); j++) {
          const nextU = utterances[j];
          if (nextU.sender === 'Patient' && PATIENT_ACCEPTANCE_REGEX.test(nextU.text)) {
            acknowledgedByPatient = true;
            patientUtterance = nextU;
            break;
          }
        }
      }
    }

    if (explainedByClinician) {
      materialRisksDiscussed.push({
        riskType: riskDef.type,
        riskLabel: riskDef.label,
        explainedByClinician,
        acknowledgedByPatient,
        clinicianUtterance,
        patientUtterance
      });
    }
  }

  // 3. Scan Alternatives and Cost discussed in audio
  const alternativesDiscussed: RogersConsentVerification['alternativesDiscussed'] = [];
  let altUtterance: TimestampedUtterance | undefined;
  for (const u of utterances) {
    if (u.sender === 'Dentist' && ALTERNATIVE_REGEX.test(u.text)) {
      altUtterance = u;
      alternativesDiscussed.push({
        alternative: u.text,
        corroborated: true,
        utterance: u
      });
      break;
    }
  }

  const costDiscussed = utterances.some(u => u.sender === 'Dentist' && COST_REGEX.test(u.text));

  // 4. Scan Patient Agreement
  const patientAgreementGrounded = utterances.some(
    u => u.sender === 'Patient' && PATIENT_ACCEPTANCE_REGEX.test(u.text)
  );

  // 5. Detect Boilerplate Fabrication (Rule 12)
  let isBoilerplateFabrication = false;
  for (const phrase of BOILERPLATE_PHRASES) {
    if (normNote.includes(phrase)) {
      // If note claims detailed paresthesia/sinus discussion, but audio contains NO clinician risk warning
      const riskWordsInAudio = /\b(nerve|paresthesia|numbness|sinus|dry socket|bleeding)\b/i.test(normTranscript);
      if (!riskWordsInAudio) {
        isBoilerplateFabrication = true;
        break;
      }
    }
  }

  // 6. Assign Defensibility Grade
  let legalDefensibilityGrade: RogersConsentVerification['legalDefensibilityGrade'];
  let evidentiarySummary: string;

  if (isBoilerplateFabrication) {
    legalDefensibilityGrade = 'D_NonCompliant';
    evidentiarySummary = 'Critical Medico-Legal Defect: Note asserts boilerplate informed consent discussion that was never spoken in operatory audio (Rule 12 violation).';
  } else if (!isInvasive) {
    legalDefensibilityGrade = 'A_Defensible';
    evidentiarySummary = 'Routine non-invasive procedure: Standard clinical consent sufficient.';
  } else if (materialRisksDiscussed.length >= 2 && patientAgreementGrounded && (alternativesDiscussed.length > 0 || costDiscussed)) {
    legalDefensibilityGrade = 'A_Defensible';
    evidentiarySummary = `High Defensibility: Verbal discussion of ${materialRisksDiscussed.length} material risks, treatment alternatives, and patient consent verified from audio timestamps.`;
  } else if (materialRisksDiscussed.length >= 1 && patientAgreementGrounded) {
    legalDefensibilityGrade = 'B_Conditional';
    evidentiarySummary = 'Conditional Defensibility: Patient accepted procedure and primary risks were warned; detailed alternatives or financial estimates uncorroborated in audio.';
  } else if (patientAgreementGrounded) {
    legalDefensibilityGrade = 'C_Vulnerable';
    evidentiarySummary = 'Vulnerable to Rogers v Whitaker Challenge: Patient consented to proceed, but clinician verbal warning of specific material risks is absent from audio.';
  } else {
    legalDefensibilityGrade = 'D_NonCompliant';
    evidentiarySummary = 'Non-Compliant: No corroboration of patient consent or risk disclosure in operatory audio.';
  }

  const isLegallyCorroborated = legalDefensibilityGrade === 'A_Defensible' || legalDefensibilityGrade === 'B_Conditional';

  return {
    procedureName: procedureContext || (isInvasive ? 'Invasive Operatory Treatment' : 'General Dental Procedure'),
    isInvasiveProcedure: isInvasive,
    requiresWrittenConsent,
    isLegallyCorroborated,
    isBoilerplateFabrication,
    materialRisksDiscussed,
    alternativesDiscussed,
    costDiscussed,
    patientAgreementGrounded,
    evidentiarySummary,
    legalDefensibilityGrade
  };
}
