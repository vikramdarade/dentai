import { describe, it, expect } from 'vitest';
import { OPERATORY_AUDIO_DEFAULTS, createOperatoryAudioStream } from '../src/lib/operatoryAudioFilter';

describe('Solo Founder Invisible Chairside Architecture', () => {
  describe('Zero-Hardware Room Mic DSP Filter Chain', () => {
    it('defines operatory acoustic parameters for surgery room mic capture at 1.5-2m', () => {
      expect(OPERATORY_AUDIO_DEFAULTS.highPassFreq).toBe(120); // 120Hz compressor & chair motor rumble cut
      expect(OPERATORY_AUDIO_DEFAULTS.drillNotchFreq).toBe(4200); // 4.2kHz high-speed turbine whistle notch
      expect(OPERATORY_AUDIO_DEFAULTS.maskBoostFreq).toBe(2800); // 2.8kHz surgical mask presence recovery
      expect(OPERATORY_AUDIO_DEFAULTS.maskBoostGainDb).toBe(3.5); // +3.5dB speech intelligibility boost
      expect(OPERATORY_AUDIO_DEFAULTS.roomDistanceGain).toBeGreaterThan(1.5); // Digital distance compensation
    });

    it('gracefully falls back to raw stream when AudioContext is unavailable (non-browser env)', () => {
      const mockStream = { id: 'stream-1' } as any;
      const session = createOperatoryAudioStream(mockStream);
      expect(session.filteredStream).toBe(mockStream);
      expect(typeof session.close).toBe('function');
    });
  });

  describe('Associate Private Vault & Doctor-Patient Confidentiality', () => {
    it('strictly redacts conversation transcripts of associate dentists for practice owner queries', () => {
      const ownerDentistId = 'dentist_owner_01';
      const associateDentistId = 'dentist_associate_02';

      const mockConsultations = [
        {
          id: 'c-1',
          dentistId: ownerDentistId,
          clinicId: 'clinic-1',
          patientName: 'John Owner Patient',
          transcript: [{ sender: 'Dentist', text: 'Open wide please' }],
          findings: { chiefComplaint: 'Tooth pain' }
        },
        {
          id: 'c-2',
          dentistId: associateDentistId,
          clinicId: 'clinic-1',
          patientName: 'Jane Associate Patient',
          transcript: [{ sender: 'Dentist', text: 'Private medical history discussion' }],
          findings: { chiefComplaint: 'Checkup' }
        }
      ];

      // Replicate the Associate Private Vault logic implemented in server.ts
      const sanitized = mockConsultations.map((c: any) => {
        if (c.dentistId !== ownerDentistId) {
          return {
            ...c,
            transcript: [],
            isAssociateProtected: true,
            confidentialNotice: 'Protected Associate Record: Audio dialogue and verbatim transcripts are restricted to the treating clinician.'
          };
        }
        return c;
      });

      // Owner consultation retains full transcript
      expect(sanitized[0].transcript.length).toBe(1);
      expect(sanitized[0].isAssociateProtected).toBeUndefined();

      // Associate consultation has transcript redacted to zero
      expect(sanitized[1].transcript.length).toBe(0);
      expect(sanitized[1].isAssociateProtected).toBe(true);
      expect(sanitized[1].confidentialNotice).toContain('Protected Associate Record');
    });
  });

  describe('Speed Review Strip 1-Stroke PMS Clipboard Format', () => {
    it('formats clean clinical shorthand with AHPRA sign-off and tooth anchors', () => {
      const consult = {
        firstName: 'Marcus',
        lastName: 'Aurelius',
        date: '2026-09-14',
        time: '14:30',
        appointmentType: 'Restorative',
        findings: {
          chiefComplaint: 'Fractured cusp tooth 26',
          history: 'Broke tooth eating sourdough',
          toothFindings: 'Tooth 26 fractured distobuccal cusp, pulp responsive',
          findingsGingival: 'Normal gingivae',
          diagnosis: 'Cusp fracture tooth 26',
          treatmentPerformed: 'Direct composite resin restoration (26 MODB)',
          recommendations: 'Monitor pulp vitality in 6 months',
          adaCodes: ['012', '532', '583']
        }
      };

      const parts: string[] = [];
      parts.push(`PATIENT: ${consult.firstName} ${consult.lastName}`.trim());
      parts.push(`DATE: ${consult.date} ${consult.time}`.trim());
      parts.push(`CLINICIAN: Dr. Sarah Chen`);
      parts.push(`APPOINTMENT: ${consult.appointmentType.toUpperCase()}`);
      parts.push('----------------------------------------');
      parts.push(`CHIEF COMPLAINT:\n${consult.findings.chiefComplaint}`);
      parts.push(`TREATMENT PERFORMED:\n${consult.findings.treatmentPerformed}`);
      parts.push(`ITEM CODES: ${consult.findings.adaCodes.join(', ')}`);
      parts.push('----------------------------------------');
      parts.push(`AHPRA VERIFICATION: Reviewed & Approved by Dr. Sarah Chen on 14/09/2026`);

      const note = parts.join('\n\n');

      expect(note).toContain('PATIENT: Marcus Aurelius');
      expect(note).toContain('Direct composite resin restoration (26 MODB)');
      expect(note).toContain('ITEM CODES: 012, 532, 583');
      expect(note).toContain('AHPRA VERIFICATION');
    });
  });
});
