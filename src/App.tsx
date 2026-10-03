import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { Consultation, TranscriptItem, ClinicalFindings, GeneratedNotePayload, NoteOrigin, TranscriptProvenance, getTodayStr, getCurrentTimeStr } from './types';
import { ClinicMembership } from './lib/clinics';
import Login from './components/Login';
import Landing from './components/Landing';
import CredentialScreen from './components/CredentialScreen';
import LegalPage from './components/LegalPage';
import BillingModal from './components/BillingModal';
import {
  saveAuth,
  getAuth,
  clearAuth,
  saveLocalConsultations,
  getLocalConsultations,
  getPendingSync,
  queuePendingSync,
  removePendingSync,
  clearPendingSync,
  AuthUser
} from './utils/storage';
import { createConsultationListStore, upsertConsultation, mergeConsultationLists } from './lib/consultationList';
import ClinicalWorkspace from './components/ClinicalWorkspace';
import HistoryHub from './components/HistoryHub';

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
    | 'billing'
    | null;
  const parseRoute = (hash: string): PublicRoute => {
    if (hash.startsWith('#/beacon') || hash.startsWith('#beacon')) {
      if (typeof window !== 'undefined' && window.location.hash) {
        window.location.hash = '';
      }
      return null;
    }
    if (hash.startsWith('#/demo')) return 'demo';
    if (hash.startsWith('#/landing') || hash.startsWith('#landing')) return 'landing';
    if (hash.startsWith('#/privacy')) return 'privacy';
    if (hash.startsWith('#/terms')) return 'terms';
    if (hash.startsWith('#/recover') || hash.startsWith('#/credential')) return 'recover';
    if (hash.startsWith('#/roadmap-prototype') || hash.startsWith('#roadmap-prototype')) return 'roadmap-prototype';
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
  // QLE-2026-0012: one synchronous source of truth for the consultation list.
  //
  // Every write used to compute the next list from the `consultations` value
  // captured by the current render, so two overlapping saves (type in A's note,
  // click B before A's PUT resolves) both started from the same pre-update
  // snapshot and the second setConsultations reverted the first save's entry;
  // that reverted list was then mirrored to localStorage and round-tripped to
  // the server on the next save. `consultationsStore` is updated *synchronously*
  // by `applyConsultations`, so its read() is never a render behind — which a
  // ref synced in an effect would be.
  const consultationsStore = useRef(createConsultationListStore<Consultation>(consultations));
  // QLE-2026-0009: ids whose save has been sent but not settled. A poll response
  // that arrives in that window must not overwrite them.
  const inFlightSaveIdsRef = useRef<Set<string>>(new Set());
  // Sequential per-record save queue: ensures subsequent rapid edits on the same device
  // await the in-flight server response and inherit the latest stamped recordVersion.
  const saveChainMapRef = useRef<Map<string, Promise<void>>>(new Map());
  const applyConsultations = useCallback(
    (updater: Consultation[] | ((prev: Consultation[]) => Consultation[])) => {
      setConsultations(consultationsStore.current.apply(updater));
    },
    []
  );
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);

  // Phase 12F: a refused (409 stale) write is a visible conflict, never a
  // silent overwrite in either direction. Holds the server's message, its
  // current version and its copy of the record for reconciliation.
  const [consultationConflict, setConsultationConflict] = useState<{ id: string; message: string; currentVersion?: number; serverRecord: Consultation | null } | null>(null);

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

  // Save a consultation: apply it locally (live list + per-dentist cache) and
  // then persist it to the clinic's system. This used to stop at local state,
  // so a generated note or a separated session was reported as saved — the
  // sidebar counted it, the toast confirmed it — and then vanished on reload,
  // because nothing had been written anywhere but this tab.
  const handleSaveConsultation = useCallback(async (consult: Consultation) => {
    const priorPromise = saveChainMapRef.current.get(consult.id) || Promise.resolve();

    const nextPromise = priorPromise.then(async () => {
      const currentList = consultationsStore.current.read();
      const existing = currentList.find(c => c.id === consult.id);
      const latestVersion = typeof existing?.recordVersion === 'number'
        ? (typeof consult.recordVersion === 'number' ? Math.max(consult.recordVersion, existing.recordVersion) : existing.recordVersion)
        : consult.recordVersion;

      const stamped: Consultation = {
        ...consult,
        dentistId: consult.dentistId || currentUser?.id,
        clinicId: consult.clinicId || activeClinic?.clinicId || undefined,
        recordVersion: latestVersion,
      };

      const upsert = upsertConsultation(currentList, stamped);
      applyConsultations(upsert.list);
      if (currentUser?.id) {
        saveLocalConsultations(upsert.list, currentUser.id);
      }

      if (!authToken) return;

      inFlightSaveIdsRef.current.add(stamped.id);
      try {
        const url = upsert.isNew ? '/api/consultations' : `/api/consultations/${stamped.id}`;
        const bodyForServer: any = { ...stamped };
        // Phase 12F: only a server-confirmed version is sent, so the server can
        // refuse a stale write (409) rather than silently last-write-wins.
        if (!upsert.isNew && typeof stamped.recordVersion === 'number') {
          bodyForServer.expectedVersion = stamped.recordVersion;
        }

        let res = await fetch(url, {
          method: upsert.isNew ? 'POST' : 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(bodyForServer),
        });

        // If PUT returned 404 (record does not exist on server), fall back to POST
        if (res.status === 404 && !upsert.isNew) {
          res = await fetch('/api/consultations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify(stamped),
          });
        }

        if (res.ok) {
          const saved: Consultation = await res.json().catch(() => stamped);
          removePendingSync(stamped.id);
          setPendingSyncCount(getPendingSync().length);
          setSessionExpired(false);
          // Merge the server echo into whatever the list is *now*: a newer save
          // for another encounter may have landed while this write was in flight.
          const synced = consultationsStore.current.read().map(c => (c.id === stamped.id ? saved : c));
          applyConsultations(synced);
          if (currentUser?.id) {
            saveLocalConsultations(synced, currentUser.id);
          }
        } else if (res.status === 409) {
          const conflict = await res.json().catch(() => ({}));
          setConsultationConflict({
            id: stamped.id,
            message: conflict?.error || 'This record changed on another device since you opened it.',
            currentVersion: conflict?.currentVersion,
            serverRecord: conflict?.serverConsultation || null,
          });
        } else {
          // A refused write is held on this device and the banner says so, rather
          // than a screen that merely looks saved.
          queuePendingSync(stamped);
          setPendingSyncCount(getPendingSync().length);
          if (res.status === 401 || res.status === 403) setSessionExpired(true);
        }
      } catch (err) {
        console.warn('Consultation save could not reach the clinic system; held on this device.', err);
        queuePendingSync(stamped);
        setPendingSyncCount(getPendingSync().length);
      } finally {
        inFlightSaveIdsRef.current.delete(stamped.id);
      }
    });

    saveChainMapRef.current.set(consult.id, nextPromise);
    await nextPromise;
  }, [applyConsultations, currentUser, activeClinic, authToken]);

  // A dead session and a queue of unsent records tell the clinician the same
  // thing: what is on screen is not yet in the clinic's system. Both used to be
  // silent — a write the server refused (403 'Session expired or invalid.',
  // network down) was queued on this device and the screen went on looking
  // saved. These two states are what make that visible.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Inactivity warning states
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const [inactivityCountdown, setInactivityCountdown] = useState(30);
  // Load token and currentUser from persistent storage on mount
  useEffect(() => {
    const { token, user } = getAuth();
    if (token && user) {
      setAuthToken(token);
      setCurrentUser(user);
      setPendingSyncCount(getPendingSync().length);
      const local = getLocalConsultations(user.id);
      if (local) {
        applyConsultations(local);
      }

      // Verify token with backend silently without aggressive session drop
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (res.status === 401) {
            handleLogout();
          } else if (res.status === 403) {
            // The server answers an expired or revoked session with 403
            // ('Session expired or invalid.'), so reading only 401 left the app
            // treating a dead session as healthy — and then failing every write
            // from that session into the local queue, invisibly.
            setSessionExpired(true);
          } else if (res.ok) {
            setSessionExpired(false);
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
  const resetInactivityRef = useRef<() => void>(() => { });
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
      resetInactivityRef.current = () => { };
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
      applyConsultations(prev => {
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
  // Re-upload any consultations that were queued while the backend was unreachable.
  // Tries PUT first (record exists) and falls back to POST (record is new).
  const flushPendingSync = useCallback(async (tokenOverride?: string, userOverride?: any) => {
    const tk = tokenOverride || authToken;
    const usr = userOverride || currentUser;
    if (!tk || !usr) return;
    const pending = getPendingSync();
    if (pending.length === 0) {
      setPendingSyncCount(0);
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tk}`
    };

    for (const consult of pending) {
      try {
        const body = {
          ...consult,
          dentistId: consult.dentistId || usr.id
        };

        let res = await fetch(`/api/consultations/${consult.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body)
        });
        if (res.status === 404) {
          res = await fetch('/api/consultations', {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          });
        }
        if (res.ok || res.status === 409) {
          // If 200/201 saved, or 409 (already exists on server), remove from local queue
          removePendingSync(consult.id);
        } else if (res.status === 401 || res.status === 403) {
          setSessionExpired(true);
          break;
        }
      } catch (err) {
        console.warn('Pending sync flush interrupted; remaining items will retry on next load.', err);
        break;
      }
    }

    const remaining = getPendingSync().length;
    setPendingSyncCount(remaining);
    if (remaining === 0) setSessionExpired(false);
  }, [authToken, currentUser]);

  useEffect(() => {
    if (!authToken || !currentUser) {
      applyConsultations([]);
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

    // Cross-browser live operatory poll. 30s is ample for clinic-note sync and
    // keeps serverless load sustainable; paused while the tab is hidden
    // (browser throttles background timers anyway). Runs immediately on mount
    // and again when the tab becomes visible after a period hidden, so data is
    // fresh on refocus without paying for a tick the tab never saw.
    const pollTimer = setInterval(() => {
      if (document.hidden) return;
      fetchConsultations();
      syncActiveClinic();
      flushPendingSync();
    }, 30_000);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        fetchConsultations();
        syncActiveClinic();
        flushPendingSync();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [authToken, currentUser?.id, activeClinicId, flushPendingSync]);

  /** Records visible in the active clinic scope (owner view includes colleagues, own records always visible). */
  const visibleConsultations = useMemo(() => {
    if (!activeClinic) return consultations;
    return consultations.filter((c: Consultation) =>
      (currentUser?.id && c.dentistId === currentUser.id) ||
      c.clinicId === activeClinic.clinicId ||
      (!c.clinicId && activeClinic.role === 'owner')
    );
  }, [consultations, activeClinic, currentUser?.id]);


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

        // Crucial for cross-device sync: local baseline first, then server data
        // overwrites with the latest — EXCEPT for records whose save has not
        // settled yet (QLE-2026-0009): a poll response must never revert work
        // that is still being written, or the reverted record seeds the next PUT
        // with a stale expectedVersion and loops on 409.
        const inFlight = inFlightSaveIdsRef.current;
        const stillSaving = inFlight.size > 0
          ? consultationsStore.current.read().filter((c) => inFlight.has(c.id))
          : [];
        const merged = mergeConsultationLists(
          myLocal.map((c: Consultation) => ({ ...c, dentistId: c.dentistId || usr.id })),
          myServerData.map((c: Consultation) => ({ ...c, dentistId: c.dentistId || usr.id })),
          stillSaving
        );
        applyConsultations(merged);
        saveLocalConsultations(merged, usr.id);
        setSessionExpired(false);
      } else if (res.status === 401 || res.status === 403) {
        // The load was refused, so what is on screen is the local cache, not the
        // clinic record. Say so instead of rendering a silently emptied day.
        setSessionExpired(true);
      }
    } catch (err) {
      console.warn('Failed to fetch consultations from server, falling back to local cache:', err);
      const cached = getLocalConsultations(usr?.id);
      if (cached && cached.length > 0) {
        applyConsultations(cached.filter((c: Consultation) => !c.dentistId || c.dentistId === usr?.id));
      }
    }
  };

  const handleLoginSuccess = (token: string, dentist: any) => {
    setAuthToken(token);
    setCurrentUser(dentist);
    setSessionExpired(false);
    saveAuth(token, dentist);
    // Clinics are refreshed from the backend (login does not return them);
    // the authToken effect above also calls refreshClinics() on login.
    refreshClinics(token);
    fetchConsultations(token, dentist);
    flushPendingSync(token, dentist);
    const local = getLocalConsultations(dentist.id);
    if (local) {
      applyConsultations(local);
    } else {
      applyConsultations([]);
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
    // QLE-2026-0001: this used to claim that signing out cannot destroy
    // unsaved clinical work, while the two statements beneath it cleared the
    // consultation state — a documented guarantee the code did not implement.
    // The accurate current behaviour is:
    //   * a COMPLETED (and server-persisted) record survives, because it is in
    //     the durable store and in the per-dentist local cache;
    //   * an IN-PROGRESS chairside scratchpad does NOT survive: its note text and
    //     captured lines live only in the workspace component's memory, and
    //     unmounting the workspace discards them.
    // The workspace therefore refuses to sign out silently while unsaved
    // clinical work exists (it asks the clinician to confirm discarding it).
    // Preserving the scratchpad itself remains a product decision.
    applyConsultations([]);
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





  if (!authToken || !currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div id="dentai-viewport" className="min-h-screen bg-[#F8F7F5] selection:bg-primary-container selection:text-white">
      {/* Whether what the clinician just wrote reached the clinic's system is
          the one thing they must never have to guess. A refused session used to
          be indistinguishable from a successful save: the record was queued on
          this device and the screen went on looking saved, while the day's
          schedule quietly rendered from cache. */}
      {(sessionExpired || pendingSyncCount > 0) && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[55] max-w-xl w-[calc(100%-1.5rem)] bg-rose-50 border border-rose-300 text-rose-900 rounded-xl shadow-lg px-4 py-3 text-xs"
          data-testid="unsaved-records-banner"
          role="status"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <div className="font-bold mb-0.5">
                {sessionExpired ? 'Session expired — records are not reaching the clinic system' : 'Records held on this device only'}
              </div>
              <div className="text-rose-800">
                {pendingSyncCount > 0
                  ? `${pendingSyncCount} record${pendingSyncCount === 1 ? '' : 's'} saved on this device but not yet in the clinic system. `
                  : ''}
                {sessionExpired
                  ? 'Sign out and sign in again to upload them — nothing written from here is in the clinic record until then.'
                  : 'They upload automatically once the clinic system is reachable.'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!sessionExpired && pendingSyncCount > 0 && (
                <button
                  type="button"
                  onClick={() => flushPendingSync()}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg shadow-xs transition-colors cursor-pointer text-xs"
                  data-testid="sync-retry-btn"
                >
                  Retry Upload
                </button>
              )}
              {sessionExpired && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg shadow-xs transition-colors cursor-pointer text-xs"
                  data-testid="sync-relogin-btn"
                >
                  Sign In Again
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  clearPendingSync();
                  setPendingSyncCount(0);
                }}
                className="px-2.5 py-1 bg-white hover:bg-rose-100 text-rose-700 border border-rose-300 font-semibold rounded-lg transition-colors cursor-pointer text-xs"
                data-testid="sync-discard-btn"
                title="Discard records stored only on this device"
              >
                Discard Local
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 12F: a refused (409 stale) write is surfaced as a visible
          conflict — the clinician's on-screen edits are preserved and the
          server's copy is available for reconciliation. Never silent. */}
      {consultationConflict && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-lg w-[calc(100%-1.5rem)] bg-amber-50 border border-amber-300 text-amber-900 rounded-xl shadow-lg px-4 py-3 text-xs"
          data-testid="stale-write-conflict"
          role="alert"
        >
          <div className="font-bold mb-0.5">Record changed on another device</div>
          <div className="text-amber-800">{consultationConflict.message}</div>
          {consultationConflict.currentVersion != null && (
            <div className="text-amber-700 mt-0.5">Server version: {consultationConflict.currentVersion} — review the latest version, re-apply your edits, then save again.</div>
          )}
          <button
            onClick={() => setConsultationConflict(null)}
            className="mt-2 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
            data-testid="stale-write-acknowledge"
          >
            Acknowledge
          </button>
        </div>
      )}
      {view === 'workspace' && (
        <ClinicalWorkspace
          currentUser={currentUser}
          dentistName={currentUser.name}
          authToken={authToken}
          consultations={visibleConsultations}
          activeClinicId={activeClinicId}
          activeClinic={activeClinic}
          clinics={clinics}
          onSelectClinic={(id) => setActiveClinicId(id)}
          onJoinClinic={handleJoinClinic}
          onClinicChanged={() => refreshClinics()}
          onLogout={handleLogout}
          onSaveConsultation={handleSaveConsultation}
          pendingSyncCount={pendingSyncCount}
          initialSessionId={selectedConsultation?.id}
          onNavigateToHub={(tab) => {
            setHubInitialTab(tab || 'schedule');
            setView('history');
          }}
        />
      )}
      {view === 'history' && (
        <HistoryHub
          consultations={visibleConsultations}
          onSelectConsultation={(consultation) => {
            setSelectedConsultation(consultation);
            setView('workspace');
          }}
          onStartNewConsultation={() => {
            setSelectedConsultation(null);
            setView('workspace');
          }}
          onStartScheduledConsultation={(item) => {
            const parts = (item.patientName || '').trim().split(' ');
            const first = parts[0] || 'Patient';
            const last = parts.slice(1).join(' ') || '';
            const newConsult: Consultation = {
              id: `sess-${Date.now()}`,
              firstName: first,
              lastName: last,
              dob: item.dob || '',
              appointmentType: item.appointmentType || 'examination',
              date: getTodayStr(),
              time: item.time || getCurrentTimeStr(),
              status: 'In Review',
              dentistId: currentUser.id,
              dentistName: currentUser.name,
              clinicId: activeClinicId || undefined,
              patientSummary: item.procedureText || 'Scheduled consultation',
              findings: {
                chiefComplaint: item.procedureText || 'Scheduled consultation',
                history: '',
                toothFindings: '',
                findingsGingival: '',
                diagnosis: '',
                treatmentPerformed: '',
                recommendations: '',
                recallRequirements: '',
              },
              transcript: [],
              clinicalProgressNote: '',
            };
            void handleSaveConsultation(newConsult);
            setSelectedConsultation(newConsult);
            setView('workspace');
          }}
          dentistName={currentUser.name}
          onLogout={handleLogout}
          clinics={clinics}
          activeClinic={activeClinic}
          onSelectClinic={(clinicId) => setActiveClinicId(clinicId)}
          onJoinClinic={handleJoinClinic}
          onClinicChanged={() => refreshClinics()}
          authToken={authToken}
          currentDentistId={currentUser.id}
          memberNames={memberNames}
          onOpenWorkspace={() => setView('workspace')}
          initialTab={hubInitialTab}
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
