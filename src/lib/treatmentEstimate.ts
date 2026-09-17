import { TreatmentOpportunity } from '../types';

export interface TreatmentEstimateQuoteItem {
  adaCode: string;
  description: string;
  tooth?: string;
  estimatedFee: number;
  healthFundTip: string;
}

export interface FormattedTreatmentEstimate {
  patientFirstName: string;
  plainEnglishDiagnosis: string;
  urgencyLevel: 'urgent' | 'recommended' | 'routine';
  urgencyWarning: string;
  items: TreatmentEstimateQuoteItem[];
  totalEstimatedFee: number;
  smsMessage: string;
  whatsappMessage: string;
  emailSubject: string;
  emailBody: string;
}

/**
 * Returns plain-English explanations and clinical risks for patient education.
 */
function getClinicalExplanation(adaCode: string, procedureName: string, tooth?: string): {
  plainDiagnosis: string;
  urgencyLevel: 'urgent' | 'recommended' | 'routine';
  urgencyWarning: string;
} {
  const toothText = tooth ? `Tooth ${tooth}` : 'The affected tooth';

  if (adaCode.startsWith('61') || procedureName.toLowerCase().includes('crown')) {
    return {
      plainDiagnosis: `${toothText} has structural damage or a crack that requires protective full-coverage reinforcement to avoid catastrophic fracture.`,
      urgencyLevel: 'recommended',
      urgencyWarning: 'Without crown protection, biting pressure can cause the tooth to split vertically down to the root, which usually results in extraction.'
    };
  }

  if (adaCode.startsWith('41') || procedureName.toLowerCase().includes('root canal') || procedureName.toLowerCase().includes('endodontic')) {
    return {
      plainDiagnosis: `The internal nerve tissue of ${toothText} is inflamed or infected and requires root canal therapy to relieve pain and preserve your natural tooth.`,
      urgencyLevel: 'urgent',
      urgencyWarning: 'Delaying root canal treatment allows infection to spread into the surrounding jawbone, causing severe pain and swelling.'
    };
  }

  if (adaCode.startsWith('53') || adaCode.startsWith('52') || procedureName.toLowerCase().includes('composite') || procedureName.toLowerCase().includes('filling')) {
    return {
      plainDiagnosis: `${toothText} has active decay or a defective restoration that needs to be cleaned and restored with a tooth-coloured composite.`,
      urgencyLevel: 'recommended',
      urgencyWarning: 'Enamel decay progresses inward toward the nerve. Treating it early with a simple filling prevents needing a crown or root canal later.'
    };
  }

  if (adaCode.startsWith('31') || procedureName.toLowerCase().includes('extraction')) {
    return {
      plainDiagnosis: `${toothText} is non-restorable or causing chronic impaction/crowding and requires surgical removal.`,
      urgencyLevel: 'urgent',
      urgencyWarning: 'Leaving an unrestorable or infected tooth in place risks recurrent abscesses and damage to adjacent healthy teeth.'
    };
  }

  if (adaCode.startsWith('22') || procedureName.toLowerCase().includes('perio') || procedureName.toLowerCase().includes('debridement')) {
    return {
      plainDiagnosis: `There is active gum inflammation and deep pocketing around the roots requiring targeted periodontal therapy.`,
      urgencyLevel: 'recommended',
      urgencyWarning: 'Periodontal disease causes painless bone loss beneath the gums. Early intervention stops irreversible looseness and tooth loss.'
    };
  }

  return {
    plainDiagnosis: `${toothText} requires clinical care (${procedureName}) to protect oral health and prevent complications.`,
    urgencyLevel: 'routine',
    urgencyWarning: 'Early restorative care is faster, more comfortable, and significantly more affordable than emergency treatments.'
  };
}

/**
 * Generates an end-to-end patient treatment estimate and multi-channel outreach copy.
 */
export function generateTreatmentEstimate(
  opp: TreatmentOpportunity,
  clinicName: string = 'DentAI Dental Practice',
  dentistName: string = 'your dentist'
): FormattedTreatmentEstimate {
  const patientFirstName = opp.patientName.trim().split(/\s+/)[0] || 'there';
  const cleanDentist = dentistName.startsWith('Dr.') ? dentistName : `Dr. ${dentistName}`;
  const toothLabel = opp.tooth ? `Tooth ${opp.tooth}` : 'Recommended Procedure';

  const { plainDiagnosis, urgencyLevel, urgencyWarning } = getClinicalExplanation(
    opp.adaCode,
    opp.procedureName,
    opp.tooth
  );

  const items: TreatmentEstimateQuoteItem[] = [
    {
      adaCode: opp.adaCode,
      description: opp.procedureName,
      tooth: opp.tooth,
      estimatedFee: opp.estimatedFee,
      healthFundTip: `Quote item code ${opp.adaCode} to your health fund (Bupa, Medibank, HCF) for rebate estimation.`
    }
  ];

  const formattedFee = `$${opp.estimatedFee.toLocaleString()}`;

  // Formatted SMS Message
  const smsMessage = `Hi ${patientFirstName}, this is ${clinicName}. Following your consult with ${cleanDentist}, we prepared your treatment estimate for ${opp.procedureName} (${toothLabel}): ${formattedFee}.

ADA Item Code for health fund rebates: ${opp.adaCode}.
Note: ${plainDiagnosis}

To reserve your chair time or ask questions, reply to this message or call our team.`;

  // Formatted WhatsApp Message
  const whatsappMessage = `Hi *${patientFirstName}*, this is ${clinicName} following up on your consultation with *${cleanDentist}*.

🦷 *Treatment Summary: ${opp.procedureName} (${toothLabel})*
💰 *Estimated Fee:* ${formattedFee}
📋 *ADA Item Code:* \`${opp.adaCode}\` *(quote this to your health fund for your rebate)*

*Clinical Overview:*
${plainDiagnosis}

⚠️ *Why timing matters:*
${urgencyWarning}

We have reserved priority booking slots with ${cleanDentist} next week. Please reply here if you would like us to secure your appointment!`;

  // Formatted Email Subject & Body
  const emailSubject = `Treatment Estimate & Health Fund Details: ${opp.procedureName} – ${clinicName}`;
  const emailBody = `Dear ${patientFirstName},

Thank you for visiting ${clinicName} for your consultation with ${cleanDentist}.

To help you plan your care, here is your treatment estimate and clinical summary:

--------------------------------------------------
RECOMMENDED TREATMENT DETAILS
--------------------------------------------------
Procedure: ${opp.procedureName}
Tooth: ${opp.tooth ? `Tooth ${opp.tooth}` : 'N/A'}
ADA Item Code: ${opp.adaCode}
Estimated Practice Fee: ${formattedFee}

HEALTH FUND REBATE TIP:
You can check your out-of-pocket gap prior to your visit. Simply quote ADA Item Code ${opp.adaCode} in your health insurance app (e.g. Bupa, Medibank, HCF) or over the phone.

CLINICAL OVERVIEW:
${plainDiagnosis}

WHY TIMING IS IMPORTANT:
${urgencyWarning}

--------------------------------------------------
NEXT STEPS & SCHEDULING
--------------------------------------------------
We have prioritized appointment slots available for ${cleanDentist} next week. 

To book your visit or discuss payment options (including interest-free payment plans), please reply directly to this email or call our front desk.

Warm regards,
Treatment Coordinator
${clinicName}
`;

  return {
    patientFirstName,
    plainEnglishDiagnosis: plainDiagnosis,
    urgencyLevel,
    urgencyWarning,
    items,
    totalEstimatedFee: opp.estimatedFee,
    smsMessage,
    whatsappMessage,
    emailSubject,
    emailBody
  };
}
