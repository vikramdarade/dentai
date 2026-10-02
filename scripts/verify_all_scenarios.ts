import { normalizeSpokenDentalText } from '../src/lib/dentalPhoneticLexicon';

async function runVerification() {
  console.log('================================================================');
  console.log('DENTAI CLINICAL VERIFICATION OF THE 5 REPORTED SCENARIOS');
  console.log('================================================================\n');

  // 1. Get or create Auth Token
  let token = '';
  const testClinicianName = 'Dr. Sarah Jenkins';
  const testPin = '4826';

  const regRes = await fetch('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: testClinicianName,
      specialty: 'General Dentistry',
      pin: testPin
    })
  });

  if (regRes.status === 201) {
    const regData = await regRes.json();
    token = regData.token;
    console.log(`[AUTH] Registered and authenticated as: ${testClinicianName}`);
  } else {
    // Already registered, login
    const profileRes = await fetch('http://localhost:3000/api/auth/profiles');
    const profiles = await profileRes.json();
    const dentist = profiles.find((p: any) => p.name === testClinicianName) || profiles[0];
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dentistId: dentist.id, pin: testPin })
    });
    const loginData = await loginRes.json();
    token = loginData.token;
    console.log(`[AUTH] Logged in as: ${dentist.name} (${dentist.id})`);
  }

  if (!token) {
    throw new Error('Authentication failed: unable to acquire session token.');
  }
  console.log('[AUTH] Session token acquired successfully.\n');

  // -------------------------------------------------------------------------
  // SCENARIO 1: Speech Normalisation & Audio Transcript Updating
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('SCENARIO 1: Audio Transcript Normalisation & Recognition');
  console.log('----------------------------------------------------------------');
  const spokenInputs = [
    'patient presents with pain in lower right first molar tooth four six',
    'cavity on distal occlusal surface tooth 16 prepare do composite restoration',
    'bleeding on probing quadrant 1 periodontal charting pocket four millimetres'
  ];

  spokenInputs.forEach((rawSpoken, i) => {
    const normalised = normalizeSpokenDentalText(rawSpoken);
    console.log(`Input ${i + 1} (Spoken Audio): "${rawSpoken}"`);
    console.log(`Normalized for Transcript:   "${normalised}"\n`);
  });

  // -------------------------------------------------------------------------
  // SCENARIO 2: Context Considered in Final Note Generation
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('SCENARIO 2: Context Tab Explicitly Considered in Note Generation');
  console.log('----------------------------------------------------------------');
  const contextData = 'MEDICAL ALERT: Severe Penicillin allergy. Type 2 Diabetic (HbA1c 6.8). Patient experiences dental anxiety.';
  const transcriptData = 'Dialogue: Dentist: Good morning Sarah. We are reviewing tooth 46 today.\nDialogue: Patient: Yes, it aches when drinking cold water.\nDialogue: Dentist: Checking tooth 46 cold sensitivity test positive. We will prepare an MO composite restoration under local anaesthetic.';
  
  const genNoteRes = await fetch('http://localhost:3000/api/copilot/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      prompt: 'generate clinical note from context and conversation',
      patientName: 'Sarah Jenkins',
      context: contextData,
      transcript: transcriptData,
      appointmentType: 'Restorative'
    })
  });
  const genNoteData = await genNoteRes.json();
  console.log('Context Input:');
  console.log(contextData);
  console.log('\nGenerated Clinical Note:');
  console.log(genNoteData.result);
  console.log('\nVerification Check:');
  console.log('- Contains Penicillin allergy in Note:', genNoteData.result.includes('Penicillin'));
  console.log('- Contains Diabetic history in Note:', genNoteData.result.toLowerCase().includes('diabet'));
  console.log('- Contains Tooth 46:', genNoteData.result.includes('46'));

  // -------------------------------------------------------------------------
  // SCENARIO 3: Downstream Document - Specialist Referral Letter
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 3: Specialist Referral Letter (Dynamic Data)');
  console.log('----------------------------------------------------------------');
  const referralRes = await fetch('http://localhost:3000/api/copilot/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      prompt: 'draft specialist referral letter for endodontics',
      patientName: 'Marcus Vance 38M',
      context: 'Referred for complex root canal anatomy. Pre-op periapical shows curved MB2 canal.',
      currentNote: 'Tooth 16 symptomatic irreversible pulpitis with curved roots.',
      appointmentType: 'Consultation'
    })
  });
  const referralData = await referralRes.json();
  console.log(referralData.result);
  console.log('\nVerification Check:');
  console.log('- Mentions Patient Name (Marcus Vance):', referralData.result.includes('Marcus Vance'));
  console.log('- Mentions Tooth 16:', referralData.result.includes('16'));
  console.log('- Mentions Specialist / Endodontist:', referralData.result.toLowerCase().includes('endodont'));

  // -------------------------------------------------------------------------
  // SCENARIO 4: Patient Care Guide & Attendance Certificate
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 4: Patient Care Guide (Dynamic Post-Op Guidance)');
  console.log('----------------------------------------------------------------');
  const careGuideRes = await fetch('http://localhost:3000/api/copilot/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      prompt: 'create a patient care guide and home care instructions',
      patientName: 'Marcus Vance',
      currentNote: 'Extraction of tooth 38 under local anaesthesia with sutures placed.',
      appointmentType: 'Surgical Extraction'
    })
  });
  const careGuideData = await careGuideRes.json();
  console.log(careGuideData.result);

  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 4 (Part B): Medical Attendance Certificate');
  console.log('----------------------------------------------------------------');
  const certificateRes = await fetch('http://localhost:3000/api/copilot/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      prompt: 'draft attendance certificate for employer',
      patientName: 'Marcus Vance',
      currentNote: 'Emergency surgical procedure completed chairside.',
      appointmentType: 'Emergency'
    })
  });
  const certData = await certificateRes.json();
  console.log(certData.result);

  // -------------------------------------------------------------------------
  // SCENARIO 5: Left Menu Sessions Data & Rehydration
  // -------------------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('SCENARIO 5: Sessions List Data Format & Patient Name Resolution');
  console.log('----------------------------------------------------------------');

  const consult1 = {
    id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
    firstName: 'Marcus',
    lastName: 'Vance',
    appointmentType: 'Surgical Extraction',
    date: 'Oct 2',
    time: '10:30 AM',
    transcript: [{ sender: 'Dentist', text: 'Examined tooth 38, surgical extraction planned.' }],
    findings: {
      toothFindings: '#38: Horizontally impacted | Rec: Surgical removal',
      diagnosis: '#38: Recurrent pericoronitis'
    }
  };

  const consult2 = {
    id: 'a12b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
    patientName: 'Emma Watson',
    appointmentType: 'Comprehensive Examination',
    date: 'Oct 2',
    time: '11:15 AM',
    transcript: [{ sender: 'Dentist', text: 'Comprehensive examination, full charting, prophylaxis.' }],
    findings: {
      toothFindings: '#16: Sound | #26: Sound | Generalized mild gingivitis',
      diagnosis: 'Gingivitis plaque-induced'
    }
  };

  await fetch('http://localhost:3000/api/consultations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(consult1)
  });

  await fetch('http://localhost:3000/api/consultations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(consult2)
  });

  const consultListRes = await fetch('http://localhost:3000/api/consultations', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const consultations = await consultListRes.json();
  console.log(`Retrieved ${consultations.length} consultations from server for ${testClinicianName}:`);
  consultations.forEach((c: any, index: number) => {
    const resolvedName = (c.firstName || c.lastName) 
      ? `${c.firstName || ''} ${c.lastName || ''}`.trim() 
      : (c.patientName || `Session #${c.id.slice(0, 8)}`);
    console.log(`[Session ${index + 1}] ID: ${c.id}`);
    console.log(`  - Display Name: "${resolvedName}"`);
    console.log(`  - Date / Time:  "${c.date || 'Today'} ${c.time || ''}"`);
    console.log(`  - Appt Type:    "${c.appointmentType || 'General Dental'}"`);
    console.log(`  - Has Findings: ${Boolean(c.findings?.toothFindings || c.findings?.diagnosis)}`);
  });
}

runVerification().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
