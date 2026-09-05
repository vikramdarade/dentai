import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { Consultation, TranscriptItem, ClinicalFindings, GeneratedNotePayload, NoteOrigin, getTodayStr, getCurrentTimeStr } from './types';
import { ClinicMembership } from './lib/clinics';
import { getTemplateById, getDefaultTemplateIdForType, AppointmentType } from './lib/dentalLibrary';
import { normalizedToPayload } from './lib/normalizeNoteOutput';
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
  getPendingSync,
  queuePendingSync,
  removePendingSync,
  AuthUser
} from './utils/storage';

type ViewType = 'history' | 'intake' | 'record' | 'summary';

export default function App() {
  const [view, setView] = useState<ViewType>('history');
  const [consultations, setConsultations] = useState<Consultation[]>(() => {
    return getLocalConsultations() || [];
  });
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);

  // Clinic ecosystem (Ecosystem Layer 1 — invite codes / multi-clinic practice)
  const [clinics, setClinics] = useState<ClinicMembership[]>([]);
  const [activeClinicId, setActiveClinicId] = useState<string | null>(null);
  // Dentist display names per clinic, used to label colleague-authored notes.
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});

  const activeClinic = useMemo(() => {
    if (!activeClinicId) return null;
    return clinics.find(c => c.clinicId === activeClinicId && c.status === 'active') || null;
  }, [clinics, activeClinicId]);

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
    appointmentType: AppointmentType;
    templateId?: string;
  } | null>(null);

  // Load token and currentUser from persistent storage on mount
  useEffect(() => {
    const { token, user } = getAuth();
    if (token && user) {
      setAuthToken(token);
      setCurrentUser(user);
      const local = getLocalConsultations(user.id);
      if (local) {
        setConsultations(local);
      }

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

  // Inactivity session lock — armed only on the history hub (idle between patients).
  // It is intentionally disarmed while the dentist is mid-consultation (intake /
  // record / summary): a dentist can easily go 15+ minutes without touching the
  // device during a consult, and a forced logout mid-task destroys unsaved clinical
  // work. The recording screen persists its transcript to sessionStorage and
  // restores it on mount, so even a real session expiry stays recoverable.
  const resetInactivityRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!authToken || !currentUser) return;
    if (view !== 'history') {
      // Working view (intake / record / summary) — lock is disarmed.
      setShowInactivityWarning(false);
      return;
    }

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
    resetInactivityRef.current = resetInactivityTimer;

    // Track user activity: mouse, touch, keyboard, scroll
    window.addEventListener('mousemove', resetInactivityTimer);
    window.addEventListener('mousedown', resetInactivityTimer);
    window.addEventListener('pointerdown', resetInactivityTimer);
    window.addEventListener('touchstart', resetInactivityTimer);
    window.addEventListener('keydown', resetInactivityTimer);
    window.addEventListener('scroll', resetInactivityTimer);

    resetInactivityTimer();

    return () => {
      resetInactivityRef.current = () => {};
      clearTimeout(inactivityTimer);
      clearInterval(warningTimer);
      window.removeEventListener('mousemove', resetInactivityTimer);
      window.removeEventListener('mousedown', resetInactivityTimer);
      window.removeEventListener('pointerdown', resetInactivityTimer);
      window.removeEventListener('touchstart', resetInactivityTimer);
      window.removeEventListener('keydown', resetInactivityTimer);
      window.removeEventListener('scroll', resetInactivityTimer);
    };
  }, [authToken, currentUser, view]);

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

  /**
   * Reloads the dentist's clinic memberships (self-healing: the backend
   * materialises the personal clinic on first authenticated call). Keeps the
   * active clinic selection when it is still an active membership, otherwise
   * falls back to the first active clinic (personal clinic preferred).
   */
  const refreshClinics = useCallback(async (token?: string) => {
    const tk = token ?? authToken;
    if (!tk) return;
    try {
      const res = await fetch('/api/clinics/mine', {
        headers: { 'Authorization': `Bearer ${tk}` }
      });
      if (!res.ok) return;
      const list: ClinicMembership[] = await res.json();
      if (!Array.isArray(list)) return;
      setClinics(list);
      setActiveClinicId(prev => {
        if (prev && list.some(c => c.clinicId === prev && c.status === 'active')) return prev;
        const fallback = list.find(c => c.role === 'owner' && c.status === 'active')
          || list.find(c => c.status === 'active');
        return fallback ? fallback.clinicId : null;
      });
    } catch (err) {
      console.warn('[Clinics] Failed to load clinic memberships:', err);
    }
  }, [authToken]);

  /** Owner-only: merge every note recorded under this clinic into the list. */
  const fetchClinicConsultations = async (clinicId: string) => {
    if (!authToken || !currentUser) return;
    try {
      const res = await fetch(`/api/clinics/${clinicId}/consultations`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      setConsultations(prev => {
        const map = new Map<string, Consultation>();
        prev.forEach(c => map.set(c.id, c));
        data.forEach((c: Consultation) => {
          map.set(c.id, { ...c, dentistId: c.dentistId || currentUser.id });
        });
        return Array.from(map.values());
      });
    } catch (err) {
      console.warn('Failed to fetch clinic records:', err);
    }
  };

  /** Owner-only: dentist display names for the clinic, for note attribution. */
  const fetchClinicMemberNames = async (clinicId: string) => {
    if (!authToken) return;
    try {
      const res = await fetch(`/api/clinics/${clinicId}/members`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.members)) return;
      const names: Record<string, string> = {};
      data.members.forEach((m: any) => {
        if (m.dentistId && m.name) names[m.dentistId] = m.name;
      });
      setMemberNames(names);
    } catch (err) {
      console.warn('Failed to load clinic member names:', err);
    }
  };

  /** Request to join a clinic via its invite code (lands as pending). */
  const handleJoinClinic = async (code: string): Promise<{ ok: boolean; message: string }> => {
    if (!authToken) return { ok: false, message: 'Not signed in.' };
    try {
      const res = await fetch('/api/clinics/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ inviteCode: code })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 202) {
        refreshClinics();
        return { ok: true, message: data.message || 'Join request sent.' };
      }
      return { ok: false, message: data.error || 'Could not request to join that clinic.' };
    } catch (err) {
      return { ok: false, message: 'Network error — please try again.' };
    }
  };

  // Fetch consultations for the active scope whenever auth or the selected
  // clinic changes. An owner additionally sees every note recorded under the
  // clinics they own (cross-clinic view); switching away drops colleague
  // records so notes never leak between clinics.
  useEffect(() => {
    if (!authToken || !currentUser) {
      setConsultations([]);
      return;
    }
    fetchConsultations();
    flushPendingSync();
    refreshClinics();

    const ownerClinic = activeClinic?.role === 'owner' ? activeClinic : null;
    if (ownerClinic) {
      fetchClinicConsultations(ownerClinic.clinicId);
      fetchClinicMemberNames(ownerClinic.clinicId);
    } else {
      setMemberNames({});
      setConsultations(prev => prev.filter(
        (c: Consultation) => !c.clinicId || c.dentistId === currentUser.id
      ));
    }
  }, [authToken, currentUser?.id, activeClinicId]);

  /** Records visible in the active clinic scope (owner view includes colleagues). */
  const visibleConsultations = useMemo(() => {
    if (!activeClinic) return consultations;
    return consultations.filter((c: Consultation) =>
      c.clinicId === activeClinic.clinicId ||
      (!c.clinicId && activeClinic.role === 'owner')
    );
  }, [consultations, activeClinic]);

  // Re-upload any consultations that were queued while the backend was unreachable.
  // Tries PUT first (record exists) and falls back to POST (record is new).
  const flushPendingSync = async () => {
    if (!authToken || !currentUser) return;
    const pending = getPendingSync();
    if (pending.length === 0) return;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    };

    for (const consult of pending) {
      try {
        let res = await fetch(`/api/consultations/${consult.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(consult)
        });
        if (res.status === 404) {
          res = await fetch('/api/consultations', {
            method: 'POST',
            headers,
            body: JSON.stringify(consult)
          });
        }
        if (res.ok) {
          removePendingSync(consult.id);
        }
      } catch (err) {
        console.warn('Pending sync flush interrupted; remaining items will retry on next load.', err);
        break;
      }
    }
  };

  const fetchConsultations = async () => {
    if (!currentUser || !authToken) return;
    try {
      const res = await fetch('/api/consultations', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Only keep consultations that belong to the current dentist
        const myServerData = Array.isArray(data)
          ? data.filter((c: Consultation) => !c.dentistId || c.dentistId === currentUser.id)
          : [];
        const local = getLocalConsultations(currentUser.id) || [];
        const myLocal = local.filter((c: Consultation) => !c.dentistId || c.dentistId === currentUser.id);

        const mergedMap = new Map<string, Consultation>();
        myServerData.forEach((c: Consultation) => mergedMap.set(c.id, { ...c, dentistId: c.dentistId || currentUser.id }));
        myLocal.forEach((c: Consultation) => mergedMap.set(c.id, { ...c, dentistId: c.dentistId || currentUser.id }));

        const merged = Array.from(mergedMap.values());
        setConsultations(merged);
        saveLocalConsultations(merged, currentUser.id);
      }
    } catch (err) {
      console.warn('Failed to fetch consultations from server, falling back to local cache:', err);
      const cached = getLocalConsultations(currentUser?.id);
      if (cached && cached.length > 0) {
        setConsultations(cached.filter((c: Consultation) => !c.dentistId || c.dentistId === currentUser?.id));
      }
    }
  };

  const handleLoginSuccess = (token: string, dentist: any) => {
    setAuthToken(token);
    setCurrentUser(dentist);
    saveAuth(token, dentist);
    // Clinics are refreshed from the backend (login does not return them);
    // the authToken effect above also calls refreshClinics() on login.
    refreshClinics(token);
    const local = getLocalConsultations(dentist.id);
    if (local) {
      setConsultations(local);
    } else {
      setConsultations([]);
    }
    // Resume any in-progress consultation that survived a logout or session
    // expiry — same recovery the cold-load mount path performs, so re-login
    // without a page reload also restores the recording with its transcript.
    const savedIntake = getActiveIntake();
    if (savedIntake) {
      setActiveIntake(savedIntake);
      setView('record');
    } else {
      setView('history');
    }
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
    setClinics([]);
    setActiveClinicId(null);
    setMemberNames({});
    // NOTE: the in-progress consultation (active intake + sessionStorage
    // transcript) is deliberately NOT cleared here — logging out mid-consult must
    // never destroy unsaved clinical work. On the next login the intake is
    // restored and the recording resumes with its full transcript.
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
    appointmentType: AppointmentType;
    templateId?: string;
  }) => {
    setActiveIntake(intakeData);
    saveActiveIntake(intakeData);
    setView('record');
  };

  const handleRecordFinish = async (
    finalTranscript: TranscriptItem[],
    fallbackNote?: { engine: 'offline-draft' | 'on-device'; modelId?: string; payload: GeneratedNotePayload }
  ) => {
    if (!activeIntake || !currentUser) return;
    const template = getTemplateById(activeIntake.templateId || getDefaultTemplateIdForType(activeIntake.appointmentType));

    try {
      let payload: GeneratedNotePayload;
      let noteOrigin: NoteOrigin;

      if (fallbackNote) {
        // Fallback tier produced the note on this device — no hosted AI fetch.
        payload = fallbackNote.payload;
        noteOrigin = {
          engine: fallbackNote.engine,
          needsReview: true,
          detail:
            fallbackNote.engine === 'on-device'
              ? `Generated on this device with the local model${fallbackNote.modelId ? ` (${fallbackNote.modelId})` : ''} after the hosted AI was unavailable. Review before saving.`
              : 'Drafted offline from the transcript (no AI available). Review and complete before saving.'
        };
      } else {
        const response = await fetch('/api/generate-notes', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            intakeData: { ...activeIntake, templateId: template.id },
            transcript: finalTranscript,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          if (response.status === 429 || errorData.code === 'QUOTA_EXCEEDED') {
            throw new Error('AI note generation is temporarily rate-limited (quota or billing exhausted) on the hosted Gemini routes. Your recording is preserved — wait a few minutes and retry, or draft the note offline now.');
          }
          if (response.status === 503) {
            throw new Error('AI note generation is not configured yet. Ask the administrator to add GEMINI_API_KEY in the environment settings. Your recording is still here.');
          }
          throw new Error(errorData.error || `Server returned error status ${response.status}`);
        }

        const parsedData = await response.json();
        payload = normalizedToPayload(template, parsedData);
        noteOrigin = { engine: 'gemini', needsReview: false };
      }

      const findings: ClinicalFindings = {
        chiefComplaint: payload.canonical.chiefComplaint || '',
        history: payload.canonical.history || '',
        toothFindings: payload.canonical.toothFindings || '',
        findingsGingival: payload.canonical.findingsGingival || '',
        diagnosis: payload.canonical.diagnosis || '',
        treatmentPerformed: payload.canonical.treatmentPerformed || '',
        recommendations: payload.canonical.recommendations || '',
        recallRequirements: payload.canonical.recallRequirements || '6 Months (Standard)',
        customSections: payload.customSections || {},
        adaCodes: payload.adaCodes || []
      };

      const newConsult: Consultation = {
        id: crypto.randomUUID(),
        dentistId: currentUser.id,
        clinicId: activeClinic?.clinicId,
        firstName: activeIntake.firstName,
        lastName: activeIntake.lastName,
        dob: activeIntake.dob,
        appointmentType: activeIntake.appointmentType,
        date: getTodayStr(),
        time: getCurrentTimeStr(),
        status: 'In Review',
        transcript: finalTranscript,
        templateId: template.id,
        findings,
        patientSummary: payload.patientSummary || '',
        noteOrigin
      };

      // Always save to scoped local cache immediately to prevent data loss
      const updatedConsultations = [newConsult, ...consultations];
      setConsultations(updatedConsultations);
      saveLocalConsultations(updatedConsultations, currentUser.id);
      clearActiveIntake();
      sessionStorage.removeItem('dentai_active_transcript');
      sessionStorage.removeItem('dentai_active_seconds');
      sessionStorage.removeItem('dentai_active_preset_index');
      sessionStorage.removeItem('dentai_active_item_times');
      setSelectedConsultation(newConsult);
      setView('summary');

      // Persist to server in background or sync. If the backend is unreachable, the
      // consultation is queued and re-uploaded on the next successful load.
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
          removePendingSync(newConsult.id);
          const syncedList = [saved, ...consultations.filter(c => c.id !== newConsult.id)];
          setConsultations(syncedList);
          saveLocalConsultations(syncedList, currentUser.id);
          setSelectedConsultation(saved);
        } else {
          queuePendingSync(newConsult);
        }
      } catch (saveErr) {
        console.warn('Network issue while syncing consultation to backend; queued for retry.', saveErr);
        queuePendingSync(newConsult);
      }
    } catch (err) {
      console.error('Failed to generate clinical findings:', err);
      throw err;
    }
  };

  const handleSaveConsultation = async (updated: Consultation) => {
    const updatedWithDentist = {
      ...updated,
      dentistId: updated.dentistId || currentUser?.id
    };
    // Immediately persist locally
    const index = consultations.findIndex((c) => c.id === updatedWithDentist.id);
    let newList = [...consultations];

    if (index >= 0) {
      newList[index] = updatedWithDentist;
    } else {
      newList = [updatedWithDentist, ...newList];
    }

    setConsultations(newList);
    if (currentUser?.id) {
      saveLocalConsultations(newList, currentUser.id);
    }
    setSelectedConsultation(updatedWithDentist);

    if (!authToken) return;

    try {
      const res = await fetch(`/api/consultations/${updatedWithDentist.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(updatedWithDentist)
      });

      if (res.ok) {
        const saved = await res.json();
        removePendingSync(updatedWithDentist.id);
        const syncedList = newList.map(c => c.id === saved.id ? saved : c);
        setConsultations(syncedList);
        if (currentUser?.id) {
          saveLocalConsultations(syncedList, currentUser.id);
        }
      } else {
        queuePendingSync(updatedWithDentist);
      }
    } catch (err) {
      console.warn('Failed to sync consultation update to backend; queued for retry.', err);
      queuePendingSync(updatedWithDentist);
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
          consultations={visibleConsultations}
          onSelectConsultation={handleSelectConsultation}
          onStartNewConsultation={handleStartNewConsultation}
          dentistName={currentUser.name}
          onLogout={handleLogout}
          clinics={clinics}
          activeClinic={activeClinic}
          onSelectClinic={(id) => setActiveClinicId(id)}
          onJoinClinic={handleJoinClinic}
          onClinicChanged={() => refreshClinics()}
          authToken={authToken}
          currentDentistId={currentUser.id}
          memberNames={memberNames}
        />
      )}

      {view === 'intake' && (
        <PatientIntake
          onCancel={() => {
            clearActiveIntake();
            sessionStorage.removeItem('dentai_active_transcript');
            sessionStorage.removeItem('dentai_active_seconds');
            sessionStorage.removeItem('dentai_active_preset_index');
            sessionStorage.removeItem('dentai_active_item_times');
            setView('history');
          }}
          onSubmit={handleIntakeSubmit}
        />
      )}

      {view === 'record' && activeIntake && (
        <LiveRecording
          patientName={`${activeIntake.firstName} ${activeIntake.lastName}`}
          dob={activeIntake.dob}
          appointmentType={activeIntake.appointmentType}
          templateId={activeIntake.templateId || ''}
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
                  // Re-arm the full inactivity timer instead of only dismissing
                  // the warning — otherwise the lock silently stops firing for
                  // the rest of the session.
                  resetInactivityRef.current();
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
