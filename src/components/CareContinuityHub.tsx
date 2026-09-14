import React from 'react';
import TreatmentPipeline from './TreatmentPipeline';
import { ClinicMembership } from '../lib/clinics';
import { Consultation } from '../types';

interface CareContinuityHubProps {
  authToken: string;
  activeClinic: ClinicMembership | null;
  dentistName: string;
  currentDentistId: string;
  consultations?: Consultation[];
}

/**
 * CareContinuityHub (ADA Ethical Duty of Care & Informed Consent Engine)
 *
 * Designed to satisfy Australian Dental Association (ADA) Code of Conduct & AHPRA guidelines:
 * - Replaces aggressive "sales pipeline/lead" jargon with clinical care continuity.
 * - Tracks deferred clinical recommendations so dentists fulfil their medicolegal duty of care.
 * - Powers patient-centric informed consent summaries, fee estimates, and non-coercive follow-up.
 */
export default function CareContinuityHub(props: CareContinuityHubProps) {
  return <TreatmentPipeline {...props} />;
}

export { CareContinuityHub };
