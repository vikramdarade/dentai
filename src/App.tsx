/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Consultation, TranscriptItem, INITIAL_CONSULTATIONS, ClinicalFindings } from './types';
import HistoryHub from './components/HistoryHub';
import PatientIntake from './components/PatientIntake';
import LiveRecording from './components/LiveRecording';
import ClinicalSummary from './components/ClinicalSummary';

type ViewType = 'history' | 'intake' | 'record' | 'summary';

export default function App() {
  const [view, setView] = useState<ViewType>('history');
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);

  // Temporary container for active intake details
  const [activeIntake, setActiveIntake] = useState<{
    firstName: string;
    lastName: string;
    dob: string;
    appointmentType: 'examination' | 'scale_clean' | 'emergency';
  } | null>(null);

  // Load from LocalStorage or Fallback on first render
  useEffect(() => {
    const saved = localStorage.getItem('dentai_consultations');
    if (saved) {
      try {
        setConsultations(JSON.parse(saved));
      } catch (err) {
        console.error('Error parsing loaded consultations:', err);
        setConsultations(INITIAL_CONSULTATIONS);
      }
    } else {
      setConsultations(INITIAL_CONSULTATIONS);
      localStorage.setItem('dentai_consultations', JSON.stringify(INITIAL_CONSULTATIONS));
    }
  }, []);

  // Sync to LocalStorage
  const syncConsultations = (updatedList: Consultation[]) => {
    setConsultations(updatedList);
    localStorage.setItem('dentai_consultations', JSON.stringify(updatedList));
  };

  const handleSelectConsultation = (c: Consultation) => {
    setSelectedConsultation(c);
    setView('summary');
  };

  const handleStartNewConsultation = () => {
    setView('intake');
  };

  const handleIntakeSubmit = (intakeData: {
    firstName: string;
    lastName: string;
    dob: string;
    appointmentType: 'examination' | 'scale_clean' | 'emergency';
  }) => {
    setActiveIntake(intakeData);
    setView('record');
  };



  const handleRecordFinish = async (finalTranscript: TranscriptItem[]) => {
    if (!activeIntake) return;

    try {
      const response = await fetch('/api/generate-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intakeData: activeIntake,
          transcript: finalTranscript,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned error status ${response.status}`);
      }

      const parsedData = await response.json();

      // Create consultation item with real API-generated response
      const dateObj = new Date();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateStr = `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;

      let minutes = dateObj.getMinutes().toString().padStart(2, '0');
      let hoursStr = dateObj.getHours();
      let ampm = hoursStr >= 12 ? 'PM' : 'AM';
      hoursStr = hoursStr % 12;
      hoursStr = hoursStr ? hoursStr : 12; // 0 becomes 12
      const timeStr = `${hoursStr.toString().padStart(2, '0')}:${minutes} ${ampm}`;

      const newConsult: Consultation = {
        id: Math.random().toString(36).substring(2, 9),
        firstName: activeIntake.firstName,
        lastName: activeIntake.lastName,
        dob: activeIntake.dob,
        appointmentType: activeIntake.appointmentType,
        date: dateStr,
        time: timeStr,
        status: 'In Review',
        transcript: finalTranscript,
        findings: {
          chiefComplaint: parsedData.chiefComplaint || '',
          history: parsedData.history || '',
          toothFindings: parsedData.toothFindings || '',
          findingsGingival: parsedData.findingsGingival || '',
          diagnosis: parsedData.diagnosis || '',
          treatmentPerformed: parsedData.treatmentPerformed || '',
          recommendations: parsedData.recommendations || '',
          recallRequirements: parsedData.recallRequirements || '6 Months (Standard)',
        },
        patientSummary: parsedData.patientSummary || '',
      };

      setSelectedConsultation(newConsult);
      setView('summary');
    } catch (err) {
      console.error('Failed to generate clinical findings:', err);
      throw err;
    }
  };

  const handleSaveConsultation = (updated: Consultation) => {
    // Check if item already exists in consultations array to update, otherwise insert it
    const index = consultations.findIndex((c) => c.id === updated.id);
    let newList = [...consultations];

    if (index >= 0) {
      newList[index] = updated;
    } else {
      newList = [updated, ...newList]; // Add to top of list as recent item
    }

    syncConsultations(newList);
    setSelectedConsultation(updated);
  };

  const handleCloseSummary = () => {
    setSelectedConsultation(null);
    setView('history');
  };

  return (
    <div id="dentai-viewport" className="min-h-screen bg-[#F8F7F5] selection:bg-primary-container selection:text-white">
      {view === 'history' && (
        <HistoryHub
          consultations={consultations}
          onSelectConsultation={handleSelectConsultation}
          onStartNewConsultation={handleStartNewConsultation}
        />
      )}

      {view === 'intake' && (
        <PatientIntake
          onCancel={() => setView('history')}
          onSubmit={handleIntakeSubmit}
        />
      )}

      {view === 'record' && activeIntake && (
        <LiveRecording
          patientName={`${activeIntake.firstName} ${activeIntake.lastName}`}
          appointmentType={activeIntake.appointmentType}
          onBack={() => setView('intake')}
          onFinish={handleRecordFinish}
        />
      )}

      {view === 'summary' && selectedConsultation && (
        <ClinicalSummary
          consultation={selectedConsultation}
          onSave={handleSaveConsultation}
          onBack={handleCloseSummary}
        />
      )}
    </div>
  );
}
