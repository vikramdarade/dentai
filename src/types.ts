export interface TranscriptItem {
  sender: 'Dentist' | 'Patient' | 'Dialogue' | 'Clinical Comment';
  text: string;
}

export interface AdaCodeItem {
  code: string;
  description: string;
  tooth?: string;
}

export interface ClinicalFindings {
  chiefComplaint: string;
  history: string;
  toothFindings: string;
  findingsGingival: string;
  diagnosis: string;
  treatmentPerformed: string;
  recommendations: string;
  recallRequirements: string;
  customSections?: Record<string, string>;
  adaCodes?: AdaCodeItem[];
}

export interface Consultation {
  id: string;
  dentistId?: string;
  firstName: string;
  lastName: string;
  dob: string;
  appointmentType: 'examination' | 'scale_clean' | 'emergency';
  date: string; // e.g., 'Oct 24'
  time: string; // e.g., '09:45 AM'
  status: 'Completed' | 'In Review';
  transcript: TranscriptItem[];
  findings: ClinicalFindings;
  patientSummary: string;
  templateId?: string;
}

export const getTodayStr = () => {
  const dateObj = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
};

export const getYesterdayStr = () => {
  const dateObj = new Date();
  dateObj.setDate(dateObj.getDate() - 1);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
};

export const getCurrentTimeStr = () => {
  const dateObj = new Date();
  const minutes = dateObj.getMinutes().toString().padStart(2, '0');
  let hours = dateObj.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
};
