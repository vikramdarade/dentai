import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { Consultation, TranscriptItem, ClinicalFindings, GeneratedNotePayload, NoteOrigin, TranscriptProvenance, getTodayStr, getCurrentTimeStr } from './types';
import { ClinicMembership } from './lib/clinics';
import { getTemplateById, getDefaultTemplateIdForType, AppointmentType } from './lib/dentalLibrary';
import { normalizedToPayload } from './lib/normalizeNoteOutput';
import type { GroundingReport } from './lib/transcriptGrounding';
import HistoryHub from './components/HistoryHub';
import PatientIntake from './components/PatientIntake';
import LiveRecording from './components/LiveRecording';
import ClinicalSummary from './components/ClinicalSummary';
import Login from './components/Login';
import Landing from './components/Landing';
import DemoMovie from './demo/DemoMovie';
import CredentialScreen from './components/CredentialScreen';
import LegalPage from './components/LegalPage';
import { AI_DISCLOSURE_VERSION } from './lib/compliance';
import PatientRoadmapPrototype from './components/PatientRoadmapPrototype';
import PhoneBeaconMode from './components/PhoneBeaconMode';
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
import { DayScheduleItem, updateScheduleItem, formatNoteForPmsClipboard } from './lib/dayScheduleStorage';
import ChairsideWorkspace from './components/ChairsideWorkspace';

type ViewType = 'workspace' | 'history' | 'intake' | 'record' | 'summary';

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
    | null;
  const parseRoute = (hash: string): PublicRoute => {
    if (hash.startsWith('#/demo')) return 'demo';
    if (hash.startsWith('#/landing') || hash.startsWith('#landing')) return 'landing';
    if (hash.startsWith('#/privacy')) return 'privacy';
    if (hash.startsWith('#/terms')) return 'terms';
    if (hash.startsWith('#/recover') || hash.startsWith('#/credential')) return 'recover';
    if (hash.startsWith('#/roadmap-prototype') || hash.startsWith('#roadmap-prototype')) return 'roadmap-prototype';
    if (hash.startsWith('#/beacon') || hash.startsWith('#beacon')) return 'beacon';
    return null;
  };

  const [publicRoute, setPublicRoute] = useState<PublicRoute>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setPublicRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const [view, setView] = useState<ViewType>('workspace');
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
  /** Live status line shown on the processing overlay (async job progress). */
  const [processingHint, setProcessingHint] = useState<string | null>(null);

  // Temporary container for active intake details (including the patient's
  // recorded consent, which is stamped onto the consultation on save).
  const [activeIntake, setActiveIntake] = useState<{
    firstName: string;
    lastName: string;
    dob: string;
    appointmentType: AppointmentType;
    templateId?: string;
    consent?: { obtainedAt: string; disclosureVersion: string };
    scheduleItemId?: string;
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
    // Resume any in-progress consultation that survived a logout or session
    // expiry — same recovery the cold-load mount path performs, so re-login
    // without a page reload also restores the recording with its transcript.
    const savedIntake = getActiveIntake();
    if (savedIntake) {
      setActiveIntake(savedIntake);
      setView('record');
    } else {
      setView('workspace');
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
    setView('workspace');
  };

  const handleStartNewConsultation = () => {
    setSelectedConsultation(null);
    setView('workspace');
  };

  const handleIntakeSubmit = (intakeData: {
    firstName: string;
    lastName: string;
    dob: string;
    appointmentType: AppointmentType;
    templateId?: string;
    consent?: { obtainedAt: string; disclosureVersion: string };
  }) => {
    setActiveIntake(intakeData);
    saveActiveIntake(intakeData);
    setView('record');
  };

  const handleStartScheduledConsultation = (item: DayScheduleItem) => {
    const nameParts = item.patientName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Patient';
    const lastName = nameParts.slice(1).join(' ') || '';

    const intakeData = {
      firstName,
      lastName,
      // Left empty rather than defaulted: a written DOB is identity data, and a
      // fabricated one is indistinguishable from a real one later. The record
      // shows it is missing instead.
      dob: '',
      appointmentType: item.appointmentType,
      templateId: item.templateId || 'standard',
      scheduleItemId: item.id
    };

    setActiveIntake(intakeData);
    saveActiveIntake(intakeData);
    updateScheduleItem(item.id, { status: 'recording' });
    setView('record');
  };

  const handleRecordFinish = async (
    finalTranscript: TranscriptItem[],
    fallbackNote?: { engine: 'offline-draft' | 'on-device'; modelId?: string; payload: GeneratedNotePayload },
    provenance?: TranscriptProvenance
  ) => {
    if (!activeIntake || !currentUser) return;
    const template = getTemplateById(activeIntake.templateId || getDefaultTemplateIdForType(activeIntake.appointmentType));

    try {
      let payload: GeneratedNotePayload;
      let noteOrigin: NoteOrigin;
      // The server verifies every generated note against the transcript and
      // returns the verdict with the job. It used to be dropped on the floor
      // here, so a note containing teeth or procedures nobody said was shown as
      // fully verified. Carried through to the record and the summary screen.
      let grounding: GroundingReport | undefined;
      // One id per consultation across every engine: the hosted-AI path sends
      // it with the job so the server's durable completion lands on the same
      // record the client saves; fallback paths use it for the local record.
      const consultationId = crypto.randomUUID();

      // Background Scribe for PMS Day Queue:
      // When started from an appointment schedule item, immediately return to Day Schedule
      // and synthesize the clinical note asynchronously in the background.
      if (activeIntake.scheduleItemId && !fallbackNote) {
        const schedId = activeIntake.scheduleItemId;
        const currentIntake = { ...activeIntake };
        const assignedConsultationId = consultationId;

        const submitRes = await fetch('/api/notes/jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            intakeData: { ...currentIntake, templateId: template.id },
            transcript: finalTranscript,
            clinicId: activeClinic?.clinicId,
            consultationId: assignedConsultationId,
          }),
        });

        if (!submitRes.ok) {
          const errData = await submitRes.json().catch(() => ({}));
          updateScheduleItem(schedId, {
            status: 'failed',
            error: errData.error || 'Failed to submit background note job.'
          });
          clearActiveIntake();
          sessionStorage.removeItem('dentai_active_transcript');
          sessionStorage.removeItem('dentai_active_seconds');
          sessionStorage.removeItem('dentai_active_preset_index');
          sessionStorage.removeItem('dentai_active_item_times');
          setView('history');
          return;
        }

        const { jobId } = await submitRes.json();
        updateScheduleItem(schedId, {
          status: 'processing',
          jobId,
          consultationId: assignedConsultationId
        });

        // Immediately free up the UI and return to Day Schedule!
        clearActiveIntake();
        sessionStorage.removeItem('dentai_active_transcript');
        sessionStorage.removeItem('dentai_active_seconds');
        sessionStorage.removeItem('dentai_active_preset_index');
        sessionStorage.removeItem('dentai_active_item_times');
        setView('history');

        // Detached background worker drains the job and auto-saves the consultation
        (async () => {
          try {
            const deadline = Date.now() + 85_000;
            let jobPayload: any = null;

            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 2000));
              const pollRes = await fetch(`/api/notes/jobs/${jobId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
              });
              if (!pollRes.ok) break;
              const jobState = await pollRes.json();
              if (jobState.status === 'done') {
                jobPayload = normalizedToPayload(template, jobState.result);
                grounding = jobState.result?.groundingReport;
                break;
              }
              if (jobState.status === 'failed') break;
            }

            if (jobPayload) {
              const findings: ClinicalFindings = {
                chiefComplaint: jobPayload.canonical.chiefComplaint || '',
                history: jobPayload.canonical.history || '',
                toothFindings: jobPayload.canonical.toothFindings || '',
                findingsGingival: jobPayload.canonical.findingsGingival || '',
                diagnosis: jobPayload.canonical.diagnosis || '',
                treatmentPerformed: jobPayload.canonical.treatmentPerformed || '',
                recommendations: jobPayload.canonical.recommendations || '',
                recallRequirements: jobPayload.canonical.recallRequirements || '6 Months (Standard)',
                customSections: jobPayload.customSections || {},
                adaCodes: jobPayload.adaCodes || []
              };

              // Establish patient identity before the record is stored, so the
              // chairside prior-history lookup has a chart to read and an
              // ambiguous name is flagged instead of guessed at.
              const identity = await resolvePatientIdentity(currentIntake);

              const newConsult: Consultation = {
                id: assignedConsultationId,
                dentistId: currentUser.id,
                clinicId: activeClinic?.clinicId,
                ...identity,
                firstName: currentIntake.firstName,
                lastName: currentIntake.lastName,
                dob: currentIntake.dob,
                appointmentType: currentIntake.appointmentType,
                date: getTodayStr(),
                time: getCurrentTimeStr(),
                // Real timestamp: display date/time cannot be ordered reliably.
                createdAt: new Date().toISOString(),
                status: 'Completed',
                transcript: finalTranscript,
                templateId: template.id,
                findings,
                patientSummary: jobPayload.patientSummary || '',
                noteOrigin: {
                  engine: 'gemini',
                  needsReview: !(grounding?.isFullyGrounded ?? false),
                  detail: grounding && !grounding.isFullyGrounded ? grounding.summary : undefined
                },
                grounding
              };

              setConsultations((prev) => [newConsult, ...prev]);
              saveLocalConsultations([newConsult, ...consultations], currentUser.id);

              fetch('/api/consultations', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(newConsult)
              }).catch(() => {});

              const formatted = formatNoteForPmsClipboard({
                id: schedId,
                time: '',
                patientName: `${currentIntake.firstName} ${currentIntake.lastName}`,
                procedureText: '',
                appointmentType: currentIntake.appointmentType,
                templateId: template.id,
                status: 'ready'
              }, newConsult);

              updateScheduleItem(schedId, {
                status: 'ready',
                clinicalNote: formatted,
                adaCodes: jobPayload.adaCodes || [],
                completedAt: new Date().toISOString()
              });
            } else {
              updateScheduleItem(schedId, {
                status: 'failed',
                error: 'Note generation timed out in background.'
              });
            }
          } catch (err: any) {
            updateScheduleItem(schedId, {
              status: 'failed',
              error: err?.message || 'Background synthesis error.'
            });
          }
        })();

        return;
      }

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
        // Async-first generation (the scale pivot): submit a durable job and
        // poll for the result. The server retries with backoff on quota, so a
        // rate-limit no longer dead-ends the dentist; per-clinic metering
        // degrades gracefully to the offline draft instead. The consultation
        // id is generated ONCE here and sent with the job so the server-side
        // durable completion and this client record converge on one id — a
        // browser death mid-generate still leaves exactly one record.
        setProcessingHint(null);
        const submitRes = await fetch('/api/notes/jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            intakeData: { ...activeIntake, templateId: template.id },
            transcript: finalTranscript,
            clinicId: activeClinic?.clinicId,
            consultationId,
          }),
        });

        if (!submitRes.ok) {
          const errorData = await submitRes.json().catch(() => ({}));
          if (submitRes.status === 429 || errorData.code === 'QUOTA_DAILY' || errorData.code === 'QUOTA_EXCEEDED') {
            throw new Error(errorData.error || 'AI note generation is rate-limited for your clinic today. Your recording is preserved — draft the note offline now, or retry later.');
          }
          if (submitRes.status === 503) {
            throw new Error('AI note generation is not configured yet. Ask the administrator to add GEMINI_API_KEY in the environment settings. Your recording is still here.');
          }
          throw new Error(errorData.error || `Server returned error status ${submitRes.status}`);
        }

        const { jobId } = await submitRes.json();
        const deadline = Date.now() + 50_000;
        let jobPayload: any = null;

        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const pollRes = await fetch(`/api/notes/jobs/${jobId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (!pollRes.ok) {
            const pollErr = await pollRes.json().catch(() => ({}));
            throw new Error(pollErr.error || `Lost track of the note job (status ${pollRes.status}). Your transcript is preserved — retry or draft offline.`);
          }
          const jobState = await pollRes.json();

          if (jobState.status === 'done') {
            jobPayload = normalizedToPayload(template, jobState.result);
            grounding = jobState.result?.groundingReport;
            break;
          }
          if (jobState.status === 'failed') {
            throw new Error(jobState.error || 'The AI could not generate this note. Your transcript is preserved — draft offline now.');
          }
          if (jobState.statusDetail) {
            setProcessingHint(jobState.statusDetail);
          } else if (jobState.nextAttemptAt) {
            const waitS = Math.max(1, Math.round((Date.parse(jobState.nextAttemptAt) - Date.now()) / 1000));
            setProcessingHint(`Cloud AI is busy (rate-limited) — retrying automatically in ~${waitS}s (attempt ${jobState.attempts}).`);
          }
        }

        if (!jobPayload) {
          throw new Error('Cloud AI is experiencing extended delays or traffic limits. Your transcript is preserved — generate your clinical note offline instantly.');
        }
        payload = jobPayload;
        setProcessingHint(null);
        // A hosted note is NOT automatically "needs no review": the server's
        // grounding verdict decides. Unverified claims (a tooth, material, drug
        // or ADA code that was never spoken) flip the record into needsReview so
        // the clinician is shown what to check rather than trusting it.
        noteOrigin = {
          engine: 'gemini',
          needsReview: !(grounding?.isFullyGrounded ?? false),
          detail: grounding && !grounding.isFullyGrounded ? grounding.summary : undefined
        };
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

      // Patient identity first: a record with no patientId shows no prior
      // history, and an ambiguous name must be flagged rather than guessed at.
      const identity = await resolvePatientIdentity(activeIntake);

      const newConsult: Consultation = {
        id: authToken ? consultationId : crypto.randomUUID(),
        dentistId: currentUser.id,
        clinicId: activeClinic?.clinicId,
        ...identity,
        firstName: activeIntake.firstName,
        lastName: activeIntake.lastName,
        dob: activeIntake.dob,
        appointmentType: activeIntake.appointmentType,
        date: getTodayStr(),
        time: getCurrentTimeStr(),
        createdAt: new Date().toISOString(),
        status: 'In Review',
        transcript: finalTranscript,
        // Which capture produced this transcript, carried with the record: a note
        // built from live speech recognition (speakers not separated) is not the
        // same evidence as one built from diarized recorded audio, and a later
        // reviewer needs to be able to tell them apart.
        ...(provenance ? { transcriptProvenance: provenance } : {}),
        templateId: template.id,
        findings,
        patientSummary: payload.patientSummary || '',
        noteOrigin,
        grounding,
        // Patient consent travels with the record: what they were told, when,
        // and under which disclosure version (APP 3/5 evidence).
        consent: activeIntake.consent
          ? { ...activeIntake.consent, recordedBy: currentUser.id }
          : { obtainedAt: '', disclosureVersion: AI_DISCLOSURE_VERSION, recordedBy: currentUser.id }
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

  /**
   * Resolves the patient registry entry for an intake.
   *
   * The server links every write as well, but asking at intake is what lets the
   * clinician be *told* when a name is ambiguous: two patients called John Smith
   * must not share a chart, so the record is left unlinked until a human says
   * which one this is. A failed resolve never blocks the consultation — the
   * record is stored unlinked, which is the safe direction.
   */
  const resolvePatientIdentity = async (intake: {
    firstName: string;
    lastName: string;
    dob: string;
  }): Promise<{ patientId?: string; identityNeedsReview?: boolean }> => {
    if (!authToken || !activeClinic?.clinicId) return {};
    try {
      const res = await fetch('/api/patients/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          firstName: intake.firstName,
          lastName: intake.lastName,
          dob: intake.dob,
          clinicId: activeClinic.clinicId
        })
      });
      if (!res.ok) return {};
      const data = await res.json();
      if (data?.status === 'matched' || data?.status === 'created') {
        return { patientId: data.patient?.id, identityNeedsReview: false };
      }
      if (data?.status === 'ambiguous') return { identityNeedsReview: true };
      return {};
    } catch {
      return {};
    }
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
          initialPatientId={selectedConsultation?.id || null}
          onOpenHistoryHub={() => setView('history')}
          onOpenPipeline={() => setView('history')}
          onLogout={handleLogout}
          onSaveConsultation={handleSaveConsultation}
        />
      )}

      {view === 'history' && (
        <HistoryHub
          consultations={visibleConsultations}
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
          processingHint={processingHint}
          authToken={authToken}
          activeClinicId={activeClinic?.clinicId}
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
