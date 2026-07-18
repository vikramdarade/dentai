/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { Consultation, TranscriptItem, ClinicalFindings } from './types';
import HistoryHub from './components/HistoryHub';
import PatientIntake from './components/PatientIntake';
import LiveRecording from './components/LiveRecording';
import ClinicalSummary from './components/ClinicalSummary';
import Login from './components/Login';

type ViewType = 'history' | 'intake' | 'record' | 'summary';

export default function App() {
  const [view, setView] = useState<ViewType>('history');
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);

  // Authentication State
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; specialty: string } | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Inactivity warning states
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const [inactivityCountdown, setInactivityCountdown] = useState(30);

  // Temporary container for active intake details
  const [activeIntake, setActiveIntake] = useState<{
    firstName: string;
    lastName: string;
    dob: string;
    appointmentType: 'examination' | 'scale_clean' | 'emergency';
  } | null>(null);

  // Load token and currentUser from sessionStorage on mount
  useEffect(() => {
    const savedToken = sessionStorage.getItem('dentai_token');
    const savedUser = sessionStorage.getItem('dentai_user');
    if (savedToken && savedUser) {
      try {
        setAuthToken(savedToken);
        setCurrentUser(JSON.parse(savedUser));

        // Restore active in-progress recording session if present!
        const savedIntake = sessionStorage.getItem('dentai_active_intake');
        if (savedIntake) {
          setActiveIntake(JSON.parse(savedIntake));
          setView('record');
        }
      } catch (e) {
        console.error('Failed to parse sessionStorage user credentials', e);
      }
    }
    setIsAuthLoading(false);
  }, []);

  // Inactivity session lock
  useEffect(() => {
    if (!authToken || !currentUser) return;

    let inactivityTimer: NodeJS.Timeout;
    let warningTimer: NodeJS.Timeout;

    const resetInactivityTimer = () => {
      setShowInactivityWarning(false);
      setInactivityCountdown(30);
      
      clearTimeout(inactivityTimer);
      clearInterval(warningTimer);

      // Trigger warning after 14m 30s (870,000ms) for 15m total timeout
      inactivityTimer = setTimeout(() => {
        setShowInactivityWarning(true);
      }, 870000);
    };

    // Track user movements
    window.addEventListener('mousemove', resetInactivityTimer);
    window.addEventListener('mousedown', resetInactivityTimer);
    window.addEventListener('keypress', resetInactivityTimer);
    window.addEventListener('scroll', resetInactivityTimer);

    resetInactivityTimer();

    return () => {
      clearTimeout(inactivityTimer);
      clearInterval(warningTimer);
      window.removeEventListener('mousemove', resetInactivityTimer);
      window.removeEventListener('mousedown', resetInactivityTimer);
      window.removeEventListener('keypress', resetInactivityTimer);
      window.removeEventListener('scroll', resetInactivityTimer);
    };
  }, [authToken, currentUser]);

  // Handle countdown decrement when warning is showing
  useEffect(() => {
    if (!showInactivityWarning) return;

    const interval = setInterval(() => {
      setInactivityCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showInactivityWarning]);

  // Fetch consultations whenever the authentication token changes
  useEffect(() => {
    if (authToken) {
      fetchConsultations();
    } else {
      setConsultations([]);
    }
  }, [authToken]);

  const fetchConsultations = async () => {
    try {
      const res = await fetch('/api/consultations', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setConsultations(data);
      } else if (res.status === 401 || res.status === 403) {
        handleLogout();
      }
    } catch (err) {
      console.error('Failed to fetch consultations:', err);
    }
  };

  const handleLoginSuccess = (token: string, dentist: any) => {
    setAuthToken(token);
    setCurrentUser(dentist);
    sessionStorage.setItem('dentai_token', token);
    sessionStorage.setItem('dentai_user', JSON.stringify(dentist));
    setView('history');
  };

  const handleLogout = async () => {
    if (authToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
      } catch (e) {
        console.error('Error logging out from server:', e);
      }
    }
    setAuthToken(null);
    setCurrentUser(null);
    sessionStorage.removeItem('dentai_token');
    sessionStorage.removeItem('dentai_user');
    setConsultations([]);
    setSelectedConsultation(null);
    setView('history');
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
    sessionStorage.setItem('dentai_active_intake', JSON.stringify(intakeData));
    setView('record');
  };

  const handleRecordFinish = async (finalTranscript: TranscriptItem[]) => {
    if (!activeIntake || !authToken) return;

    try {
      const response = await fetch('/api/generate-notes', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
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

      // Create consultation item
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

      // Persist to server
      const saveRes = await fetch('/api/consultations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(newConsult)
      });

      if (saveRes.ok) {
        const saved = await saveRes.json();
        sessionStorage.removeItem('dentai_active_intake');
        sessionStorage.removeItem('dentai_active_transcript');
        sessionStorage.removeItem('dentai_active_seconds');
        sessionStorage.removeItem('dentai_active_preset_index');
        setSelectedConsultation(saved);
        setConsultations(prev => [saved, ...prev]);
        setView('summary');
      } else {
        throw new Error('Failed to persist consultation to server.');
      }
    } catch (err) {
      console.error('Failed to generate clinical findings:', err);
      throw err;
    }
  };

  const handleSaveConsultation = async (updated: Consultation) => {
    if (!authToken) return;

    try {
      const res = await fetch(`/api/consultations/${updated.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(updated)
      });

      if (res.ok) {
        const saved = await res.json();
        const index = consultations.findIndex((c) => c.id === saved.id);
        let newList = [...consultations];

        if (index >= 0) {
          newList[index] = saved;
        } else {
          newList = [saved, ...newList];
        }

        setConsultations(newList);
        setSelectedConsultation(saved);
      }
    } catch (err) {
      console.error('Failed to save consultation updates:', err);
    }
  };

  const handleCloseSummary = () => {
    setSelectedConsultation(null);
    setView('history');
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#F8F7F5]">
        <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-650 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!authToken || !currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div id="dentai-viewport" className="min-h-screen bg-[#F8F7F5] selection:bg-primary-container selection:text-white">
      {view === 'history' && (
        <HistoryHub
          consultations={consultations}
          onSelectConsultation={handleSelectConsultation}
          onStartNewConsultation={handleStartNewConsultation}
          dentistName={currentUser.name}
          onLogout={handleLogout}
        />
      )}

      {view === 'intake' && (
        <PatientIntake
          onCancel={() => {
            sessionStorage.removeItem('dentai_active_intake');
            sessionStorage.removeItem('dentai_active_transcript');
            sessionStorage.removeItem('dentai_active_seconds');
            sessionStorage.removeItem('dentai_active_preset_index');
            setView('history');
          }}
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
          dentistName={currentUser.name}
        />
      )}
      {/* Inactivity Security Warning Modal */}
      <AnimatePresence>
        {showInactivityWarning && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
            <div className="bg-white rounded-2xl p-6 flex flex-col items-center text-center max-w-sm w-full mx-auto shadow-2xl border border-slate-100 font-sans">
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1.5 font-sans">
                Session Security Timeout
              </h3>
              <p className="text-slate-500 text-xs mb-6 leading-relaxed font-sans">
                Due to inactivity, you will be logged out automatically in <span className="font-mono font-bold text-slate-800 text-sm">{inactivityCountdown}</span> seconds to protect patient clinical records.
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowInactivityWarning(false);
                  setInactivityCountdown(30);
                }}
                className="w-full h-11 bg-primary hover:bg-opacity-95 text-white font-bold rounded-xl transition-all cursor-pointer text-xs shadow-md font-sans"
              >
                Keep Me Logged In
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
