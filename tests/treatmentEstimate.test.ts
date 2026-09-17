import { describe, it, expect } from 'vitest';
import { generateTreatmentEstimate } from '../src/lib/treatmentEstimate';
import { TreatmentOpportunity } from '../src/types';

describe('Treatment Estimate & Patient Outreach Engine', () => {
  const sampleCrownOpportunity: TreatmentOpportunity = {
    id: 'consult-101-tx-crown-16',
    consultationId: 'consult-101',
    dentistId: 'dentist-001',
    patientName: 'Emma Watson',
    tooth: '16',
    adaCode: '611',
    procedureName: 'Full Crown - Ceramic',
    estimatedFee: 1650,
    clinicalReason: 'Cusp fracture 16',
    status: 'unscheduled',
    createdAt: new Date().toISOString()
  };

  const sampleFillingOpportunity: TreatmentOpportunity = {
    id: 'consult-102-tx-filling-46',
    consultationId: 'consult-102',
    dentistId: 'dentist-001',
    patientName: 'Liam Hemsworth',
    tooth: '46',
    adaCode: '532',
    procedureName: 'Posterior Resin Composite - 2 Surfaces',
    estimatedFee: 295,
    clinicalReason: 'Interproximal caries 46',
    status: 'unscheduled',
    createdAt: new Date().toISOString()
  };

  it('generates customized plain-English diagnosis and urgency warning for crowns', () => {
    const estimate = generateTreatmentEstimate(sampleCrownOpportunity, 'Smile Dental', 'Dr. Sarah Smith');

    expect(estimate.patientFirstName).toBe('Emma');
    expect(estimate.totalEstimatedFee).toBe(1650);
    expect(estimate.plainEnglishDiagnosis).toContain('Tooth 16 has structural damage');
    expect(estimate.urgencyWarning).toContain('split vertically down to the root');
    expect(estimate.items).toHaveLength(1);
    expect(estimate.items[0].adaCode).toBe('611');
    expect(estimate.items[0].healthFundTip).toContain('611');
  });

  it('formats multi-channel SMS copy with ADA item code for health fund rebates', () => {
    const estimate = generateTreatmentEstimate(sampleCrownOpportunity, 'Smile Dental', 'Dr. Sarah Smith');

    expect(estimate.smsMessage).toContain('Hi Emma');
    expect(estimate.smsMessage).toContain('Smile Dental');
    expect(estimate.smsMessage).toContain('$1,650');
    expect(estimate.smsMessage).toContain('611');
    expect(estimate.smsMessage).toContain('ADA Item Code for health fund rebates');
  });

  it('formats rich email copy with itemized breakdown and urgency rationale', () => {
    const estimate = generateTreatmentEstimate(sampleCrownOpportunity, 'Smile Dental', 'Dr. Sarah Smith');

    expect(estimate.emailSubject).toContain('Treatment Estimate & Health Fund Details: Full Crown - Ceramic');
    expect(estimate.emailBody).toContain('Dear Emma');
    expect(estimate.emailBody).toContain('Tooth 16');
    expect(estimate.emailBody).toContain('ADA Item Code: 611');
    expect(estimate.emailBody).toContain('WHY TIMING IS IMPORTANT');
    expect(estimate.emailBody).toContain('Bupa, Medibank, HCF');
  });

  it('generates appropriate restoration warnings for composite fillings', () => {
    const estimate = generateTreatmentEstimate(sampleFillingOpportunity, 'Bondi Dental', 'Dr. John Doe');

    expect(estimate.patientFirstName).toBe('Liam');
    expect(estimate.plainEnglishDiagnosis).toContain('active decay or a defective restoration');
    expect(estimate.urgencyWarning).toContain('Treating it early with a simple filling prevents needing a crown');
    expect(estimate.whatsappMessage).toContain('*Liam*');
    expect(estimate.whatsappMessage).toContain('`532`');
  });
});
