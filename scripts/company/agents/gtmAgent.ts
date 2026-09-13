/**
 * Grokbot Autonomous GTM & Growth Agent
 * 
 * Analyzes practice business intelligence, unbooked restorative treatment value ($AUD),
 * and generates practice-principal ROI teardowns and practice manager release notes.
 */

import { ADA_BENCHMARK_FEES, detectTreatmentOpportunity, type DayScheduleItem } from '../../../src/lib/dayScheduleStorage.js';

export interface TreatmentRoiMetric {
  category: string;
  count: number;
  totalValueAud: number;
  averageValueAud: number;
}

export interface GtmCycleResult {
  agentName: string;
  timestamp: string;
  periodSummary: {
    totalRecoverableValueAud: number;
    annualizedPracticeUpsideAud: number;
    highValueOpportunityCount: number;
    topCategories: TreatmentRoiMetric[];
  };
  practiceOwnerExecutiveBrief: string;
  practiceManagerChangelog: string;
  outboundSalesPitchAngle: string;
}

export async function runGtmAgent(sampleItems?: DayScheduleItem[]): Promise<GtmCycleResult> {
  // Default benchmark cohort if no live schedule is injected
  const itemsToAnalyze: DayScheduleItem[] = sampleItems && sampleItems.length > 0 ? sampleItems : [
    {
      id: 'mock-1',
      time: '09:00',
      patientName: 'David H.',
      appointmentType: 'restorative',
      templateId: 'restorative_general',
      procedureText: 'Crown preparation tooth 16',
      status: 'ready',
      clinicalNote: 'Tooth 16 large MOD amalgam fractured mesial cusp. Discussed full coverage monolithic zirconia crown (ADA 611). Patient agreed.',
      treatmentOpportunity: {
        code: '611',
        description: 'Ceramic Crown',
        estimatedValueAud: 1850,
        tooth: '16'
      }
    },
    {
      id: 'mock-2',
      time: '10:30',
      patientName: 'Sarah M.',
      appointmentType: 'emergency',
      templateId: 'emergency_triage',
      procedureText: 'Severe pain lower left molar',
      status: 'ready',
      clinicalNote: 'Tooth 36 irreversible pulpitis. Extirpation completed. Scheduled for chemomechanical preparation & obturation root canal (ADA 414).',
      treatmentOpportunity: {
        code: '414',
        description: 'Root Canal Treatment',
        estimatedValueAud: 1200,
        tooth: '36'
      }
    },
    {
      id: 'mock-3',
      time: '11:45',
      patientName: 'Michael C.',
      appointmentType: 'examination',
      templateId: 'comprehensive_exam',
      procedureText: 'Comprehensive examination and charting',
      status: 'ready',
      clinicalNote: 'Severe attrition across anterior teeth due to nocturnal bruxism. Recommended upper rigid occlusal splint (ADA 965).',
      treatmentOpportunity: {
        code: '965',
        description: 'Occlusal Splint',
        estimatedValueAud: 980,
        tooth: 'Maxilla'
      }
    },
    {
      id: 'mock-4',
      time: '14:00',
      patientName: 'Emma T.',
      appointmentType: 'examination',
      templateId: 'comprehensive_exam',
      procedureText: 'Missing tooth 24 implant consultation',
      status: 'ready',
      clinicalNote: 'Consultation for single-tooth implant tooth 24 fixture placement (ADA 688). Bone height adequate on OPG. Quote provided.',
      treatmentOpportunity: {
        code: '688',
        description: 'Implant Fixture',
        estimatedValueAud: 4500,
        tooth: '24'
      }
    }
  ];

  let totalValueAud = 0;
  const categoryMap: Record<string, { count: number; total: number }> = {};

  for (const item of itemsToAnalyze) {
    const opp = item.treatmentOpportunity || (item.clinicalNote ? detectTreatmentOpportunity(item, item.clinicalNote, []) : undefined);
    if (opp) {
      totalValueAud += opp.estimatedValueAud;
      if (!categoryMap[opp.description]) {
        categoryMap[opp.description] = { count: 0, total: 0 };
      }
      categoryMap[opp.description].count += 1;
      categoryMap[opp.description].total += opp.estimatedValueAud;
    }
  }

  const topCategories: TreatmentRoiMetric[] = Object.entries(categoryMap).map(([desc, data]) => ({
    category: desc,
    count: data.count,
    totalValueAud: data.total,
    averageValueAud: Math.round(data.total / data.count)
  })).sort((a, b) => b.totalValueAud - a.totalValueAud);

  // Calculate annual potential assuming 46 clinical weeks, 5 days/week
  const annualizedPracticeUpsideAud = totalValueAud * 46 * 5;

  const practiceOwnerExecutiveBrief = [
    `# Practice Principal ROI Teardown: Dormant Treatment Recovery`,
    ``,
    `> **Daily Unbooked Treatment Found**: $${totalValueAud.toLocaleString()} AUD across ${itemsToAnalyze.length} patient encounters.`,
    `> **Annualized Upside per Operatory**: $${annualizedPracticeUpsideAud.toLocaleString()} AUD in high-margin restorative/implant production.`,
    ``,
    `### Key Opportunities Captured:`,
    ...topCategories.map(c => `- **${c.category}** (${c.count} identified): $${c.totalValueAud.toLocaleString()} AUD (Avg $${c.averageValueAud.toLocaleString()} AUD)`),
    ``,
    `DentAI's autonomous chairside detection tags high-value treatments directly into the receptionist clipboard handoff so front-desk staff collect booking deposits before the patient walks out the door.`
  ].join('\n');

  const practiceManagerChangelog = [
    `### 📢 Dental Practice Manager Update — What's New Today`,
    `- **1-Click D4W / EXACT Note & Action Splitting**: Front desk receptionists now get a dedicated \`[FRONT DESK ACTION ITEM]\` block with ADA codes and itemized fees.`,
    `- **Instant Aftercare SMS**: Clinicians can copy 1-click patient aftercare instructions directly to your SMS gateway, cutting Monday morning phone inquiries.`,
    `- **Zero Software Installation**: Operates entirely in the browser; no IT overhead or server reboots required.`
  ].join('\n');

  const outboundSalesPitchAngle = `Australian dental practices lose $14,000+ AUD/week in unbooked crowns and splints mentioned chairside but forgotten at reception. DentAI's Autonomous Practice Cockpit surfaces these opportunities with 1-click receptionist handoff.`;

  return {
    agentName: 'Grokbot GTM & Revenue Intelligence Agent',
    timestamp: new Date().toISOString(),
    periodSummary: {
      totalRecoverableValueAud: totalValueAud,
      annualizedPracticeUpsideAud,
      highValueOpportunityCount: itemsToAnalyze.filter(i => i.treatmentOpportunity).length,
      topCategories
    },
    practiceOwnerExecutiveBrief,
    practiceManagerChangelog,
    outboundSalesPitchAngle
  };
}
