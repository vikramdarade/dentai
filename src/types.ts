export interface TranscriptItem {
  sender: 'Dentist' | 'Patient' | 'Dialogue' | 'Clinical Comment';
  text: string;
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
}

export interface Consultation {
  id: string;
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

const todayStr = getTodayStr();
const yesterdayStr = getYesterdayStr();

export const INITIAL_CONSULTATIONS: Consultation[] = [
  {
    id: '1',
    firstName: 'Sarah',
    lastName: 'Jenkins',
    dob: '1988-04-12',
    appointmentType: 'emergency',
    date: todayStr,
    time: '09:45 AM',
    status: 'Completed',
    transcript: [
      {
        sender: 'Patient',
        text: "I've been having this sharp pain in the upper right quadrant for about two days now. It gets worse when I drink anything cold."
      },
      {
        sender: 'Dentist',
        text: 'Understood. Does the pain linger after the cold stimulus is removed, or is it just a quick flash?'
      },
      {
        sender: 'Patient',
        text: "It lingers for maybe 30 seconds to a minute. It's a throbbing sensation."
      },
      {
        sender: 'Dentist',
        text: "Okay, let's take a look. I'm going to perform a percussion test on tooth number 16 and 15."
      }
    ],
    findings: {
      chiefComplaint: "Patient reports severe lingering sensitivity when drinking cold liquids on upper right quadrant, lasting for approximately two days. Pain lingers after stimulus is removed.",
      history: "No significant clinical dental history. Brushes twice daily, flosses occasionally. Reports mild nocturnal bruxism, currently unmanaged.",
      toothFindings: "Tooth 16 and 15 (FDI notation) exhibit strong lingering sensitivity to thermal cold. Percussion test is positive on tooth 16, negative on tooth 15. Visible restoration marginal fracture on tooth 16.",
      findingsGingival: 'Mild localized inflammation, Type I gingivitis adjacent to upper right premolars. Standard pocket depths of 2-3mm observed.',
      diagnosis: 'Symptomatic irreversible pulpitis on tooth 16 secondary to dental caries under existing composite restoration.',
      treatmentPerformed: 'Conducted comprehensive clinical examination, vitality testing, and single-tooth radiograph. Root canal therapy recommended and scheduled.',
      recommendations: 'Avoid drinking extremely cold beverages or chewing hard materials on the upper right side. Manage pain with standard 400mg Ibuprofen as needed.',
      recallRequirements: 'Next Available (Urgent)'
    },
    patientSummary: "Hi Sarah, it was good seeing you today.\n\nWe addressed that severe cold sensitivity you've been having on your upper right side. After our testing, we found that the nerve inside tooth 16 is highly inflamed, likely due to decay beneath your existing filling.\n\nWhat we did: We performed sensitivity and tapping tests to confirm the source, took a detailed x-ray of the area, and discussed immediate treatment options.\n\nNext steps: We highly recommend a root canal procedure to relieve the pain and save the tooth. We have scheduled this for you. In the meantime, try to avoid cold inputs on that side and take mild pain relievers if needed."
  },
  {
    id: '2',
    firstName: 'Marcus',
    lastName: 'Thorne',
    dob: '1975-09-02',
    appointmentType: 'examination',
    date: todayStr,
    time: '08:15 AM',
    status: 'In Review',
    transcript: [
      {
        sender: 'Dentist',
        text: 'Good morning Marcus, how are your teeth feeling today?'
      },
      {
        sender: 'Patient',
        text: 'Generally pretty good, doc. No pain, maybe just a bit of build-up on the lower fronts.'
      },
      {
        sender: 'Dentist',
        text: "Sure, let's perform a thorough exam and clean that up."
      }
    ],
    findings: {
      chiefComplaint: 'Patient presents for routine comprehensive exam and scale and clean. Reports minor calculus buildup on mandibular incisors.',
      history: 'Pre-existing localized moderate calculus. Regular 6-month attendee. Non-smoker.',
      toothFindings: 'No active decay detected on visual and radiographic exam. Excellent structural state on all quadrants.',
      findingsGingival: 'Exceptional gingival scores. Plaque index < 10%. Healthy pink tissues, no bleeding on probing.',
      diagnosis: 'Healthy dentition. Healthy periodontium.',
      treatmentPerformed: 'Full mouth scale, prophy jet, and fluoride application. Visual examination of oral cavity.',
      recommendations: 'Continue excellent home oral hygiene routine (twice daily brushing, daily flossing).',
      recallRequirements: '6 Months (Standard)'
    },
    patientSummary: "Hi Marcus, it was a pleasure seeing you for your regular check-up today!\n\nOverall, your teeth and gums are in excellent health. We did a full cleaning to sweep away the build-up on the back of your lower front teeth, leaving your smile completely clean and polished.\n\nWhat we did: Performed a detailed dental examination, removed calculus plaque build-up, and applied a protective fluoride treatment.\n\nNext steps: Continue with your fantastic routine at home, and we'll see you in 6 months for your next routine cleaning!"
  },
  {
    id: '3',
    firstName: 'Elena',
    lastName: 'Rodriguez',
    dob: '1992-11-15',
    appointmentType: 'scale_clean',
    date: yesterdayStr,
    time: '04:30 PM',
    status: 'Completed',
    transcript: [
      {
        sender: 'Patient',
        text: "Hi! I tracker check-in for Invisalign. I'm currently on tray number 15 of 20."
      },
      {
        sender: 'Dentist',
        text: "Excellent tracking! Let's check the aligner seating and clear any build-up today."
      }
    ],
    findings: {
      chiefComplaint: "Invisalign tracking appointment. Seating looks outstanding. Minor interproximal staining noted.",
      history: "Orthodontic patient on tray 15 of 20. Highly compliant, wear time is 22 hours per day.",
      toothFindings: "Perfect tracking has occurred. Clear aligners sit flush. Teeth shifting precisely as mapped.",
      findingsGingival: 'Gingiva is tight and resilient. Patient maintains supreme oral hygiene throughout ortho journey.',
      diagnosis: 'Orthodontic therapy progressing optimally.',
      treatmentPerformed: 'Evaluated tray tracking, applied light interproximal polishing. Provided next 5 sets of trays.',
      recommendations: 'Continue wearing current trays for 7 days per set. Ensure aligners are fully seated with chewies.',
      recallRequirements: '6 Months (Standard)'
    },
    patientSummary: "Hi Elena, it was wonderful checking on your smile's progress today!\n\nYour Invisalign treatment is tracking perfectly. Tray 15 looks fully seated, and the alignment of your front teeth is progressing exactly as scheduled.\n\nWhat we did: Inspected orthodontic aligner fit, polished minor surface stains, and approved your tray transition routine.\n\nNext steps: Keep up the awesome work wearing your aligners 22 hours a day! We have provided your next sets of trays to continue your journey."
  }
];
