import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { Consultation, TranscriptItem, ClinicalFindings, getTodayStr, getCurrentTimeStr } from './types';
import HistoryHub from './components/HistoryHub';
import PatientIntake from './components/PatientIntake';
import LiveRecording from './components/LiveRecording';
import ClinicalSummary from './components/ClinicalSummary';
import Login from './components/Login';
import {
  saveAuth,
  getAuth,
  clearAuth,
  saveLocalConsultations,
  getLocalConsultations,
  saveActiveIntake,
  getActiveIntake,
  clearActiveIntake,
  AuthUser
} from './utils/storage';

type ViewType = 'history' | 'intake' | 'record' | 'summary';

export default function App() {
  const [view, setView] = useState<ViewType>('history');
  const [consultations, setConsultations] = useState<Consultation[]>(() => {
    return getLocalConsultations() || [];
  });
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);

  // Authentication State
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
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

  // Load token and currentUser from persistent storage on mount
  useEffect(() => {
    const { token, user } = getAuth();
    if (token && user) {
      setAuthToken(token);
      setCurrentUser(user);

      // Verify token with backend silently without aggressive session drop
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (res.status === 401) {
            handleLogout();
          }
        })
        .catch(err => {
          console.warn('[Auth] Silent token verification failed (offline/serverless cold start):', err);
        });

      // Restore active in-progress recording session if present!
      const savedIntake = getActiveIntake();
      if (savedIntake) {
        setActiveIntake(savedIntake);
        setView('record');
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
        // Merge server data with local cache without losing local records
        const local = getLocalConsultations() || [];
        const mergedMap = new Map<string, Consultation>();
        if (Array.isArray(data)) {
          data.forEach((c: Consultation) => mergedMap.set(c.id, c));
        }
        if (Array.isArray(local)) {
          local.forEach((c: Consultation) => mergedMap.set(c.id, c));
        }
        const merged = Array.from(mergedMap.values());
        setConsultations(merged);
        saveLocalConsultations(merged);
      }
    } catch (err) {
      console.warn('Failed to fetch consultations from server, falling back to local cache:', err);
      const cached = getLocalConsultations();
      if (cached && cached.length > 0) {
        setConsultations(cached);
      }
    }
  };

  const handleLoginSuccess = (token: string, dentist: any) => {
    setAuthToken(token);
    setCurrentUser(dentist);
    saveAuth(token, dentist);
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
    clearAuth();
    clearActiveIntake();
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
    saveActiveIntake(intakeData);
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

      const newConsult: Consultation = {
        id: Math.random().toString(36).substring(2, 9),
        firstName: activeIntake.firstName,
        lastName: activeIntake.lastName,
        dob: activeIntake.dob,
        appointmentType: activeIntake.appointmentType,
        date: getTodayStr(),
        time: getCurrentTimeStr(),
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

      // Always save to local cache immediately to prevent data loss
      const updatedConsultations = [newConsult, ...consultations];
      setConsultations(updatedConsultations);
      saveLocalConsultations(updatedConsultations);
      clearActiveIntake();
      sessionStorage.removeItem('dentai_active_transcript');
      sessionStorage.removeItem('dentai_active_seconds');
      sessionStorage.removeItem('dentai_active_preset_index');
      setSelectedConsultation(newConsult);
      setView('summary');

      // Persist to server in background or sync
      try {
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
          const syncedList = [saved, ...consultations.filter(c => c.id !== newConsult.id)];
          setConsultations(syncedList);
          saveLocalConsultations(syncedList);
          setSelectedConsultation(saved);
        }
      } catch (saveErr) {
        console.warn('Network issue while syncing consultation to backend; local copy preserved safely.', saveErr);
      }
    } catch (err) {
      console.error('Failed to generate clinical findings:', err);
      throw err;
    }
  };

  const handleSaveConsultation = async (updated: Consultation) => {
    // Immediately persist locally
    const index = consultations.findIndex((c) => c.id === updated.id);
    let newList = [...consultations];

    if (index >= 0) {
      newList[index] = updated;
    } else {
      newList = [updated, ...newList];
    }

    setConsultations(newList);
    saveLocalConsultations(newList);
    setSelectedConsultation(updated);

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
        const serverIndex = newList.findIndex((c) => c.id === saved.id);
        if (serverIndex >= 0) {
          newList[serverIndex] = saved;
        }
        setConsultations(newList);
        saveLocalConsultations(newList);
      }
    } catch (err) {
      console.error('Failed to save consultation updates to server, preserved locally:', err);
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
            clearActiveIntake();
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
