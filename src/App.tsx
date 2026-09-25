import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { Consultation, TranscriptItem, ClinicalFindings, GeneratedNotePayload, NoteOrigin, TranscriptProvenance, getTodayStr, getCurrentTimeStr } from './types';
import { ClinicMembership } from './lib/clinics';
import { getTemplateById, getDefaultTemplateIdForType, AppointmentType } from './lib/dentalLibrary';
import HistoryHub from './components/HistoryHub';
import Login from './components/Login';
import Landing from './components/Landing';
import DemoMovie from './demo/DemoMovie';
import CredentialScreen from './components/CredentialScreen';
import LegalPage from './components/LegalPage';
import BillingModal from './components/BillingModal';
import { AI_DISCLOSURE_VERSION } from './lib/compliance';
import PatientRoadmapPrototype from './components/PatientRoadmapPrototype';
import PhoneBeaconMode from './components/PhoneBeaconMode';
import {
  saveAuth,
  getAuth,
  clearAuth,
  saveLocalConsultations,
  getLocalConsultations,
  getPendingSync,
  queuePendingSync,
  removePendingSync,
  AuthUser
} from './utils/storage';
import { DayScheduleItem, updateScheduleItem, formatNoteForPmsClipboard } from './lib/dayScheduleStorage';
import ChairsideWorkspace from './components/ChairsideWorkspace';

type ViewType = 'workspace' | 'history';

export default function App() {
  // Public (unauthenticated) screens, addressable by hash so they can be linked
  // from the landing page, from a clinic's onboarding email, and from support.
  // One parser rather than one flag per screen: a single source of truth is what
  // keeps "#/landing shows the landing page" true after the next route is added.
  //   #/demo               narrated product walkthrough
  //   #/landing            marketing/product page
  //   #/privacy            privacy notice (incl. AI disclosure + subprocessors)
  //   #/terms              terms of service
  //   #/recover            change PIN or redeem an operator recovery token
  //   #/roadmap-prototype  concept review prototype
  //   #/beacon             operatory phone beacon (chair-side capture)
  type PublicRoute =
    | 'demo'
    | 'landing'
    | 'privacy'
    | 'terms'
    | 'recover'
    | 'roadmap-prototype'
    | 'beacon'
    | 'billing'
    | null;
  const parseRoute = (hash: string): PublicRoute => {
    if (hash.startsWith('#/demo')) return 'demo';
    if (hash.startsWith('#/landing') || hash.startsWith('#landing')) return 'landing';
    if (hash.startsWith('#/privacy')) return 'privacy';
    if (hash.startsWith('#/terms')) return 'terms';
    if (hash.startsWith('#/recover') || hash.startsWith('#/credential')) return 'recover';
    if (hash.startsWith('#/roadmap-prototype') || hash.startsWith('#roadmap-prototype')) return 'roadmap-prototype';
    if (hash.startsWith('#/beacon') || hash.startsWith('#beacon')) return 'beacon';
    if (hash.startsWith('#/billing') || hash.startsWith('#billing')) return 'billing';
    return null;
  };

  const [publicRoute, setPublicRoute] = useState<PublicRoute>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setPublicRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const [view, setView] = useState<ViewType>('workspace');
  const [hubInitialTab, setHubInitialTab] = useState<'schedule' | 'records' | 'pipeline'>('schedule');
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
  const [showBillingModal, setShowBillingModal] = useState(false);

  // Inactivity warning states
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const [inactivityCountdown, setInactivityCountdown] = useState(30);
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

    const syncActiveClinic = () => {
      const ownerClinic = activeClinic?.role === 'owner' ? activeClinic : null;
      if (ownerClinic) {
        fetchClinicConsultations(ownerClinic.clinicId);
        fetchClinicMemberNames(ownerClinic.clinicId);
      } else {
        setMemberNames({});
      }
    };
    syncActiveClinic();

    // Cross-browser live operatory poll (fetches walk-ins & real-time dialogue every 3.5s)
    const pollTimer = setInterval(() => {
      fetchConsultations();
      syncActiveClinic();
    }, 3500);

    return () => clearInterval(pollTimer);
  }, [authToken, currentUser?.id, activeClinicId]);

  /** Records visible in the active clinic scope (owner view includes colleagues, own records always visible). */
  const visibleConsultations = useMemo(() => {
    if (!activeClinic) return consultations;
    return consultations.filter((c: Consultation) =>
      (currentUser?.id && c.dentistId === currentUser.id) ||
      c.clinicId === activeClinic.clinicId ||
      (!c.clinicId && activeClinic.role === 'owner')
    );
  }, [consultations, activeClinic, currentUser?.id]);

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

  const fetchConsultations = async (overrideToken?: string, overrideUser?: any) => {
    const tk = overrideToken || authToken;
    const usr = overrideUser || currentUser;
    if (!usr || !tk) return;
    try {
      const res = await fetch('/api/consultations', {
        headers: { 'Authorization': `Bearer ${tk}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Only keep consultations that belong to the current dentist
        const myServerData = Array.isArray(data)
          ? data.filter((c: Consultation) => !c.dentistId || c.dentistId === usr.id)
          : [];
        const local = getLocalConsultations(usr.id) || [];
        const myLocal = local.filter((c: Consultation) => !c.dentistId || c.dentistId === usr.id);

        // Crucial for cross-device sync: Add local baseline first, then server data overwrites with latest
        const mergedMap = new Map<string, Consultation>();
        myLocal.forEach((c: Consultation) => mergedMap.set(c.id, { ...c, dentistId: c.dentistId || usr.id }));
        myServerData.forEach((c: Consultation) => mergedMap.set(c.id, { ...c, dentistId: c.dentistId || usr.id }));

        const merged = Array.from(mergedMap.values());
        setConsultations(merged);
        saveLocalConsultations(merged, usr.id);
      }
    } catch (err) {
      console.warn('Failed to fetch consultations from server, falling back to local cache:', err);
      const cached = getLocalConsultations(usr?.id);
      if (cached && cached.length > 0) {
        setConsultations(cached.filter((c: Consultation) => !c.dentistId || c.dentistId === usr?.id));
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
    fetchConsultations(token, dentist);
    const local = getLocalConsultations(dentist.id);
    if (local) {
      setConsultations(local);
    } else {
      setConsultations([]);
    }
    setView('workspace');
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
    setView('workspace');
  };

  const handleStartNewConsultation = () => {
    setSelectedConsultation(null);
    setView('workspace');
  };


  const handleStartScheduledConsultation = (item: DayScheduleItem) => {
    const existing = consultations.find(c => c.id === item.id || (c as any).scheduleItemId === item.id);
    if (existing) {
      setSelectedConsultation(existing);
    } else {
      const nameParts = item.patientName.trim().split(/\s+/);
      const newConsult: Consultation = {
        id: item.id,
        dentistId: currentUser?.id || '',
        clinicId: activeClinic?.clinicId,
        firstName: nameParts[0] || 'Patient',
        lastName: nameParts.slice(1).join(' ') || '',
        dob: item.dob || '',
        appointmentType: item.appointmentType || 'restorative',
        date: getTodayStr(),
        time: item.time || getCurrentTimeStr(),
        createdAt: new Date().toISOString(),
        status: 'In Review',
        transcript: [],
        templateId: item.templateId || 'standard',
        patientSummary: '',
        findings: {
          chiefComplaint: '',
          history: '',
          toothFindings: '',
          findingsGingival: '',
          diagnosis: '',
          treatmentPerformed: '',
          recommendations: '',
          recallRequirements: '6 Months (Standard)',
          customSections: {},
          adaCodes: []
        }
      };
      setSelectedConsultation(newConsult);
    }
    setView('workspace');
  };

  const handleSaveConsultation = async (updated: Consultation) => {
    const updatedWithDentist = {
      ...updated,
      dentistId: updated.dentistId || currentUser?.id,
      clinicId: updated.clinicId || (activeClinic?.clinicId ? activeClinic.clinicId : undefined)
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
      const isNew = index === -1;
      const url = isNew ? '/api/consultations' : `/api/consultations/${updatedWithDentist.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(updatedWithDentist)
      });

      if (res.ok) {
        const saved = await res.json();
        removePendingSync(updatedWithDentist.id);
        const syncedList = newList.map(c => c.id === updatedWithDentist.id ? saved : c);
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
    setView('workspace');
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#F8F7F5]">
        <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-650 rounded-full animate-spin"></div>
      </div>
    );
  }

  const exitPublicRoute = () => {
    window.location.hash = '';
    setPublicRoute(null);
  };

  if (publicRoute === 'privacy' || publicRoute === 'terms') {
    return <LegalPage page={publicRoute} onExit={exitPublicRoute} />;
  }

  if (publicRoute === 'recover') {
    return (
      <CredentialScreen
        authToken={authToken}
        onExit={exitPublicRoute}
        onAuthenticated={(token, user) => {
          saveAuth(token, user);
          setAuthToken(token);
          setCurrentUser(user);
          exitPublicRoute();
        }}
      />
    );
  }

  if (publicRoute === 'demo') {
    return <DemoMovie onExit={exitPublicRoute} />;
  }

  if (publicRoute === 'landing') {
    return (
      <Landing
        onGetStarted={() => {
          exitPublicRoute();
        }}
      />
    );
  }

  if (publicRoute === 'roadmap-prototype') {
    return (
      <PatientRoadmapPrototype
        onClose={exitPublicRoute}
        dentistName={currentUser?.name || 'Dr. Sarah Chen'}
        clinicName={activeClinic?.clinicName || 'Bright Smile Dental'}
      />
    );
  }

  if (publicRoute === 'beacon') {
    return <PhoneBeaconMode onExit={exitPublicRoute} />;
  }

  if (!authToken || !currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div id="dentai-viewport" className="min-h-screen bg-[#F8F7F5] selection:bg-primary-container selection:text-white">
      {view === 'workspace' && (
        <ChairsideWorkspace
          currentUser={currentUser}
          dentistName={currentUser.name}
          authToken={authToken}
          consultations={visibleConsultations}
          activeClinicId={activeClinicId}
          activeClinic={activeClinic}
          initialPatientId={selectedConsultation?.id || null}
          onOpenHistoryHub={() => {
            setHubInitialTab('records');
            setView('history');
          }}
          onOpenPipeline={() => {
            setHubInitialTab('pipeline');
            setView('history');
          }}
          onLogout={handleLogout}
          onSaveConsultation={handleSaveConsultation}
        />
      )}

      {view === 'history' && (
        <HistoryHub
          consultations={visibleConsultations}
          initialTab={hubInitialTab}
          onSelectConsultation={handleSelectConsultation}
          onStartNewConsultation={handleStartNewConsultation}
          onStartScheduledConsultation={handleStartScheduledConsultation}
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
          onOpenWorkspace={() => setView('workspace')}
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

      {/* Practice Plan & Invoicing Modal */}
      {(publicRoute === 'billing' || showBillingModal) && (
        <BillingModal
          isOpen={true}
          onClose={() => {
            setShowBillingModal(false);
            if (publicRoute === 'billing') {
              window.location.hash = '#/';
            }
          }}
          activeClinic={activeClinic}
          authToken={authToken || ''}
          onPlanUpdated={() => refreshClinics()}
        />
      )}
    </div>
  );
}
