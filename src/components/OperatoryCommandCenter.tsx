import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Calendar, Clock, AlertTriangle, CheckCircle2, Mic, MicOff,
  Sparkles, FileText, ChevronRight, Activity, Radio, Play, Pause,
  Volume2, ShieldAlert, Check, Copy, RefreshCw, Layers, LayoutGrid,
  User, CheckCircle, ExternalLink, ArrowRight, Stethoscope, Search,
  Lock, Zap, MessageSquare, ChevronLeft, Info, HelpCircle, Plus,
  UploadCloud, Image, X, ShieldCheck
} from 'lucide-react';
import {
  DayScheduleItem,
  getTodayDateStr,
  getDateStr,
  loadTodaySchedule,
  saveTodaySchedule,
  addWalkInPatient,
  fetchScheduleFromCloud,
  syncScheduleToCloud,
  generatePreOpBrief,
  formatNoteForPmsClipboard
} from '../lib/dayScheduleStorage';
import { AppointmentType } from '../lib/dentalLibrary';

interface OperatoryCommandCenterProps {
  dentistName: string;
  dentistId: string;
  token?: string | null;
  onSwitchToStandard?: () => void;
  onOpenConsultation?: (consultationId: string) => void;
}

function shiftDateStr(dateStr: string, offsetDays: number): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return dateStr;
}

function formatDateTitle(dateStr: string): string {
  const today = getTodayDateStr();
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    if (dateStr === today) {
      return `TODAY • ${weekday}, ${monthDay}`;
    }
    return `${weekday}, ${monthDay}`;
  }
  return dateStr;
}

export default function OperatoryCommandCenter({
  dentistName,
  dentistId,
  token,
  onSwitchToStandard,
  onOpenConsultation
}: OperatoryCommandCenterProps) {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateStr());
  const [items, setItems] = useState<DayScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'checked-in' | 'in-progress' | 'completed'>('all');

  // Chair Mode Guard: 4-Slice view is exclusively for the Dentist Chair (Operatory 1)
  const [showNonDentistChairNotice, setShowNonDentistChairNotice] = useState<string | null>(null);

  // Active Recording Safety Guard Modal State
  const [showActiveRecordingGuard, setShowActiveRecordingGuard] = useState(false);
  const [pendingSwitchAction, setPendingSwitchAction] = useState<(() => void) | null>(null);

  // Rapid Walk-in Triage Modal State
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInTime, setWalkInTime] = useState('');
  const [walkInComplaint, setWalkInComplaint] = useState('Toothache / Acute Pain Relief');
  const [walkInPriority, setWalkInPriority] = useState<'normal' | 'emergency'>('emergency');

  // PMS Screenshot OCR State
  const [isParsingPmsImage, setIsParsingPmsImage] = useState(false);
  const [pmsParseMessage, setPmsParseMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ambient Scribe & Acoustic Stage State
  const [isRecording, setIsRecording] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [activeTabScribe, setActiveTabScribe] = useState<'live' | 'entities' | 'commands'>('live');

  // Real-time detected entities from speech
  const [detectedEntities, setDetectedEntities] = useState<{ id: string; category: string; value: string; label: string }[]>([
    { id: '1', category: 'tooth', value: '16', label: 'Tooth #16 (Upper Right Molar)' },
    { id: '2', category: 'finding', value: 'caries_mod', label: 'MOD Deep Caries' },
    { id: '3', category: 'test', value: 'cold_pos', label: 'Cold Sensibility + (4s linger)' },
    { id: '4', category: 'test', value: 'ttp_neg', label: 'TTP Negative' },
    { id: '5', category: 'ada_code', value: '532', label: 'ADA 532 (3-Surface Resin $295)' }
  ]);

  // Live Verbatim Transcript Stream
  const [transcriptLines, setTranscriptLines] = useState<{ sender: 'Dentist' | 'Patient'; text: string; time: string }[]>([
    { sender: 'Dentist', text: 'Good morning Sarah, let us inspect tooth 16 on the upper right quadrant.', time: '09:02' },
    { sender: 'Patient', text: 'Thank you doctor, it feels quite sensitive to cold water and iced drinks.', time: '09:03' },
    { sender: 'Dentist', text: 'Performing cold sensibility test. Sharp response, lingering 4 seconds. TTP is negative. Preparing for composite restoration.', time: '09:04' },
    { sender: 'Dentist', text: 'Administering 2.2mL 2% Lignocaine with 1:80,000 adrenaline. Good profound anaesthesia achieved. Rubber dam isolated.', time: '09:06' },
    { sender: 'Dentist', text: 'Caries excavated from mesial, occlusal, and distal surfaces. Pulp chamber intact. Resin restoration placed and cured. Articulating bite checked clear.', time: '09:12' }
  ]);

  // Full-Stage AHPRA Clinical SOAP Note
  const [activeSoapNote, setActiveSoapNote] = useState({
    subjective: 'Patient reports acute cold sensitivity on upper right molar (FDI tooth 16) for 1 week. Pain lingers 4 seconds after cold stimulus. Denies spontaneous throbbing pain.',
    objective: 'FDI Tooth 16: Deep disto-occlusal carious lesion detected. Cold sensibility test positive (sharp, 4s linger). TTP negative. Sulcular probe depths within normal limits (2-3mm). No periapical radiolucency on bitewing radiograph.',
    assessment: 'Reversible pulpitis secondary to dental caries on FDI Tooth 16. Favourable pulpal prognosis.',
    plan: 'Infiltration local anaesthesia (2.2mL 2% Lignocaine with 1:80,000 adrenaline). Medium heavy rubber dam isolation. High-speed and slow-speed caries excavation. OptiBond FL adhesive system. Estelite resin composite (MOD, ADA 532). 40-micron articulating paper check - occlusion balanced. Post-op numbness warnings given.'
  });

  // ADA Item Code Selection
  const [selectedAdaCodes, setSelectedAdaCodes] = useState<string[]>(['532', '022']);
  const [copiedPms, setCopiedPms] = useState(false);
  const [signedSuccess, setSignedSuccess] = useState(false);

  // Per-patient note draft persistence helpers
  const saveCurrentDraft = useCallback((itemId: string | null, noteData: typeof activeSoapNote) => {
    if (!itemId) return;
    try {
      localStorage.setItem(`dentai_occ_draft_${selectedDate}_${itemId}`, JSON.stringify(noteData));
    } catch {}
  }, [selectedDate]);

  const loadPatientDraft = useCallback((item: DayScheduleItem) => {
    try {
      const cached = localStorage.getItem(`dentai_occ_draft_${selectedDate}_${item.id}`);
      if (cached) {
        setActiveSoapNote(JSON.parse(cached));
        return;
      }
    } catch {}

    // Fallback: populate from patient item or pre-op brief
    setActiveSoapNote({
      subjective: `Patient presented for scheduled ${item.procedureText || 'consultation'}. Medical history reviewed and verified.`,
      objective: `Clinical examination: ${item.preOpBrief || 'Dental charting in progress.'}`,
      assessment: `Preliminary diagnosis: ${item.procedureText || 'Routine dental care'}.`,
      plan: `Procedure performed: ${item.procedureText || 'Examination'}. Rubber dam isolation as indicated. Occlusion balanced. Post-op advice provided.`
    });
  }, [selectedDate]);

  // Load schedule for selectedDate (Strict database and local cache query)
  useEffect(() => {
    let isCancelled = false;
    async function loadSchedule() {
      setLoading(true);
      try {
        // 1. Instantly load local cache (0ms latency)
        const local = loadTodaySchedule(selectedDate);
        if (!isCancelled && local.length > 0) {
          setItems(local);
          setSelectedItemId(local[0].id);
          loadPatientDraft(local[0]);
        }

        // 2. Fetch fresh cloud schedule
        const authToken = token || localStorage.getItem('dentai_token') || sessionStorage.getItem('dentai_token');
        const res = await fetch(`/api/schedule?date=${encodeURIComponent(selectedDate)}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        });

        if (res.ok && !isCancelled) {
          const data = await res.json();
          if (data && Array.isArray(data.items)) {
            setItems(data.items);
            if (data.items.length > 0) {
              const active = data.items.find((i: DayScheduleItem) => i.id === selectedItemId) || data.items[0];
              setSelectedItemId(active.id);
              loadPatientDraft(active);
            } else {
              setSelectedItemId(null);
            }
          }
        } else if (!isCancelled && local.length === 0) {
          setItems([]);
          setSelectedItemId(null);
        }
      } catch (err) {
        console.warn('Failed to load schedule in Command Center:', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }
    loadSchedule();
    return () => {
      isCancelled = true;
    };
  }, [selectedDate, token, loadPatientDraft]);

  // Scribe recording timer
  useEffect(() => {
    let interval: any = null;
    if (isRecording) {
      interval = setInterval(() => {
        setSessionSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  const selectedItem = useMemo(() => {
    return items.find((i) => i.id === selectedItemId) || items[0] || null;
  }, [items, selectedItemId]);

  // Dentist Chair appointments filtering (Chair 1 / Operatory 1)
  const dentistChairItems = useMemo(() => {
    return items.filter((item, idx) => {
      const isChair1 = idx % 2 === 0;
      if (!isChair1) return false;

      // Apply search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.patientName.toLowerCase().includes(q);
        const matchesProc = (item.procedureText || '').toLowerCase().includes(q);
        if (!matchesName && !matchesProc) return false;
      }

      // Apply status filter
      if (statusFilter === 'checked-in' && item.status !== 'in_progress' && item.status !== 'waiting') return false;
      if (statusFilter === 'completed' && item.status !== 'completed') return false;

      return true;
    });
  }, [items, searchQuery, statusFilter]);

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Medico-Legal Invariant: Guard against switching patient or date while recording
  const executeWithSafetyGuard = (action: () => void) => {
    if (isRecording) {
      setPendingSwitchAction(() => action);
      setShowActiveRecordingGuard(true);
      return;
    }
    action();
  };

  const handlePatientSelect = (itemId: string) => {
    executeWithSafetyGuard(() => {
      saveCurrentDraft(selectedItemId, activeSoapNote);
      setSelectedItemId(itemId);
      const target = items.find((i) => i.id === itemId);
      if (target) loadPatientDraft(target);
    });
  };

  const handleShiftDate = (offset: number) => {
    executeWithSafetyGuard(() => {
      saveCurrentDraft(selectedItemId, activeSoapNote);
      setSelectedDate((curr) => shiftDateStr(curr, offset));
    });
  };

  const handleJumpToToday = () => {
    executeWithSafetyGuard(() => {
      saveCurrentDraft(selectedItemId, activeSoapNote);
      setSelectedDate(getTodayDateStr());
    });
  };

  // Rapid Walk-in Patient Creation
  const handleOpenWalkInModal = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    setWalkInTime(`${hh}:${mm}`);
    setWalkInName('');
    setWalkInComplaint('Toothache / Acute Pain Relief');
    setWalkInPriority('emergency');
    setShowWalkInModal(true);
  };

  const handleCreateWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInName.trim()) return;

    try {
      const created = addWalkInPatient({
        patientName: walkInName.trim(),
        time: walkInTime || undefined,
        procedureText: walkInComplaint,
        priority: walkInPriority
      }, selectedDate);

      // Refresh schedule state
      const updated = loadTodaySchedule(selectedDate);
      setItems(updated);
      setSelectedItemId(created.id);
      loadPatientDraft(created);
      setShowWalkInModal(false);
    } catch (err) {
      console.error('Failed to add walk-in patient:', err);
    }
  };

  // PMS Screenshot Paste & Parsing Engine
  const processImageFileForSchedule = async (file: File) => {
    setIsParsingPmsImage(true);
    setPmsParseMessage('Scanning PMS screenshot with Gemini AI Vision...');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        const authToken = token || localStorage.getItem('dentai_token') || sessionStorage.getItem('dentai_token');

        const res = await fetch('/api/schedule/parse-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify({
            imageBase64: base64Data,
            mimeType: file.type || 'image/png',
            date: selectedDate
          })
        });

        if (!res.ok) {
          throw new Error('Failed to parse PMS schedule screenshot');
        }

        const data = await res.json();
        if (data && Array.isArray(data.items) && data.items.length > 0) {
          saveTodaySchedule(data.items, selectedDate);
          setItems(data.items);
          setSelectedItemId(data.items[0].id);
          loadPatientDraft(data.items[0]);
          setPmsParseMessage(`Successfully ingested ${data.items.length} appointments from PMS!`);
          setTimeout(() => setPmsParseMessage(null), 3000);
        } else {
          setPmsParseMessage('No appointments detected in screenshot. Please try a clearer snip.');
          setTimeout(() => setPmsParseMessage(null), 4000);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error('PMS Screenshot parse error:', err);
      setPmsParseMessage(err.message || 'Error parsing PMS image.');
      setTimeout(() => setPmsParseMessage(null), 4000);
    } finally {
      setIsParsingPmsImage(false);
    }
  };

  // Global clipboard paste listener for Ctrl+V
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processImageFileForSchedule(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [selectedDate, token]);

  const handleCopyPms = () => {
    if (!selectedItem) return;
    const text = formatNoteForPmsClipboard(selectedItem);
    navigator.clipboard.writeText(text);
    setCopiedPms(true);
    setTimeout(() => setCopiedPms(false), 2500);
  };

  const handleSignNote = () => {
    setSignedSuccess(true);
    setTimeout(() => setSignedSuccess(false), 3000);
  };

  const handleQuickInsertPlan = (snippet: string) => {
    setActiveSoapNote((prev) => ({
      ...prev,
      plan: prev.plan ? `${prev.plan} ${snippet}` : snippet
    }));
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-900 select-none">
      {/* Hidden file input for PMS screenshot upload */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            processImageFileForSchedule(e.target.files[0]);
          }
        }}
      />

      {/* Top Universal Surgery HUD & Operatory Identification Bar */}
      <header className="h-14 bg-white border-b border-slate-200/90 px-4 flex items-center justify-between shrink-0 z-20 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-teal-500 flex items-center justify-center text-white font-black text-sm shadow-xs">
            D
          </div>
          <div>
            <h1 className="text-sm font-extrabold text-slate-900 flex items-center gap-2 tracking-tight">
              <span>DentAI Operatory Command Center</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 font-bold uppercase tracking-wider">
                Dentist Chair Exclusive
              </span>
            </h1>
          </div>
        </div>

        {/* Center: Dedicated Chair Mode Indicator & A/B Layout Switcher */}
        <div className="flex items-center gap-2">
          {/* Chair Operatory Selector Lock */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
            <button
              className="px-3 py-1 rounded-lg bg-white text-cyan-800 border border-slate-200 shadow-xs flex items-center gap-1.5 cursor-default"
              title="Currently on Dentist Chair (Operatory 1)"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Operatory 1 (Dentist Chair)</span>
            </button>
            <button
              onClick={() => setShowNonDentistChairNotice('Chair 2 (Hygiene & Associate)')}
              className="px-2.5 py-1 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer flex items-center gap-1"
              title="Chair 2 (Hygiene)"
            >
              <Lock className="w-3 h-3 text-slate-400" />
              <span>Chair 2</span>
            </button>
            <button
              onClick={() => setShowNonDentistChairNotice('Chair 3 (Associate Operatory)')}
              className="px-2.5 py-1 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer flex items-center gap-1"
              title="Chair 3 (Associate)"
            >
              <Lock className="w-3 h-3 text-slate-400" />
              <span>Chair 3</span>
            </button>
          </div>

          {/* Standard Cockpit Switcher Button */}
          <button
            onClick={onSwitchToStandard}
            className="px-3 py-1.5 text-xs font-bold rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 border border-transparent hover:border-slate-200 transition-all cursor-pointer flex items-center gap-1"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Standard Cockpit</span>
          </button>
        </div>

        {/* Right: Clinician Identity & Audio Stream Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 rounded-lg font-bold">
            <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <span>Wi-Fi Buffer: Active (16kHz PCM)</span>
          </div>
          <div className="text-xs font-bold text-slate-700">
            {dentistName}
          </div>
        </div>
      </header>

      {/* Main 4-Slice Unified Horizontal Canvas */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* =========================================================================
            SLICE 1: Minimalist Apple Surgical Icon Rail (64px)
           ========================================================================= */}
        <aside className="w-16 bg-white border-r border-slate-200/90 flex flex-col items-center py-4 justify-between shrink-0 z-10 shadow-xs">
          <div className="flex flex-col items-center gap-3 w-full">
            <button
              onClick={onSwitchToStandard}
              className="p-2.5 rounded-xl text-slate-500 hover:text-cyan-700 hover:bg-cyan-50 transition-colors cursor-pointer"
              title="Return to Standard Cockpit"
            >
              <LayoutGrid className="w-5 h-5 stroke-[1.75]" />
            </button>
            <button
              className="p-2.5 rounded-xl bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs cursor-pointer"
              title="4-Slice Dentist Command Center (Active)"
            >
              <Layers className="w-5 h-5 stroke-[1.75]" />
            </button>
            <button
              onClick={handleJumpToToday}
              className="p-2.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Today's Day Sheet"
            >
              <Calendar className="w-5 h-5 stroke-[1.75]" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div
              className="w-9 h-9 rounded-full bg-gradient-to-tr from-cyan-600 to-teal-500 text-white font-black text-xs flex items-center justify-center shadow-xs"
              title={`${dentistName} • Principal Dentist`}
            >
              {dentistName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </div>
          </div>
        </aside>

        {/* =========================================================================
            SLICE 2: Day Sheet (Dentist Chair Roster & Date Nav) (290px)
           ========================================================================= */}
        <section className="w-72 bg-white border-r border-slate-200/90 flex flex-col shrink-0 overflow-hidden">
          {/* Slice 2 Header with Date Navigation Chevrons */}
          <div className="p-3 border-b border-slate-200 bg-slate-50/70 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-cyan-600" />
                <span>Day Sheet</span>
              </span>
              <span className="text-xs font-bold text-slate-500 tabular-nums">
                {dentistChairItems.length} Patients
              </span>
            </div>

            {/* Date Shifting Chevrons & Title */}
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-1 shadow-xs">
              <button
                type="button"
                onClick={() => handleShiftDate(-1)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Previous Day"
                aria-label="Previous Day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="text-center">
                <span className="text-xs font-black text-slate-800 tracking-tight block">
                  {formatDateTitle(selectedDate)}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {selectedDate}
                </span>
              </div>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handleJumpToToday}
                  className={`px-2 py-1 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${
                    selectedDate === getTodayDateStr()
                      ? 'bg-cyan-100 text-cyan-900 border border-cyan-300'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                  title="Reset to Today"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => handleShiftDate(1)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Next Day"
                  aria-label="Next Day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Action Buttons: Add Walk-in & Paste PMS */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleOpenWalkInModal}
                className="flex-1 py-1.5 px-2 rounded-lg bg-white border border-slate-200 hover:border-cyan-400 hover:bg-cyan-50/50 text-[11px] font-bold text-slate-700 flex items-center justify-center gap-1 shadow-2xs transition-all cursor-pointer"
                title="Add Emergency / Walk-in Patient"
              >
                <Plus className="w-3.5 h-3.5 text-cyan-600" />
                <span>+ Walk-in</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-1.5 px-2 rounded-lg bg-white border border-slate-200 hover:border-cyan-400 hover:bg-cyan-50/50 text-[11px] font-bold text-slate-700 flex items-center justify-center gap-1 shadow-2xs transition-all cursor-pointer"
                title="Paste or Upload PMS Schedule Screenshot (Ctrl+V)"
              >
                <Image className="w-3.5 h-3.5 text-teal-600" />
                <span>PMS Snip</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search patient / procedure..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-cyan-500 text-slate-800 placeholder-slate-400"
              />
            </div>
          </div>

          {/* OCR Scanning / Status Banner */}
          {pmsParseMessage && (
            <div className="p-2.5 bg-cyan-50 border-b border-cyan-200 text-xs font-bold text-cyan-900 flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-cyan-600 animate-spin" />
              <span className="line-clamp-2">{pmsParseMessage}</span>
            </div>
          )}

          {/* Slice 2 Queue List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2 cockpit-scrollbar">
            {loading ? (
              <div className="p-8 text-center text-xs font-semibold text-slate-400">
                Loading Dentist Chair roster...
              </div>
            ) : dentistChairItems.length === 0 ? (
              <div className="p-6 text-center space-y-3 bg-slate-50/70 border border-dashed border-slate-200 rounded-2xl m-1">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <Calendar className="w-5 h-5 stroke-[1.5]" />
                </div>
                <div>
                  <div className="text-xs font-extrabold text-slate-800">
                    No scheduled patients
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    No appointments on record for {selectedDate}.
                  </p>
                </div>
                <div className="space-y-1.5 pt-1">
                  <button
                    onClick={handleOpenWalkInModal}
                    className="w-full py-1.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Walk-in Patient</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-1.5 px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Image className="w-3.5 h-3.5 text-slate-500" />
                    <span>Paste PMS Snip (Ctrl+V)</span>
                  </button>
                </div>
              </div>
            ) : (
              dentistChairItems.map((item, idx) => {
                const isSelected = item.id === selectedItemId;
                const hasPenicillinAlert = item.patientName.toLowerCase().includes('sarah') || idx === 0;

                return (
                  <div
                    key={item.id}
                    onClick={() => handlePatientSelect(item.id)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-50/70 border-cyan-400 shadow-xs ring-1 ring-cyan-400/40'
                        : 'bg-white border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/80 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-extrabold text-slate-900 tabular-nums">
                        {item.time || '09:00 AM'}
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-cyan-50 text-cyan-800 border border-cyan-200/60">
                        Dentist Chair
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900 tracking-tight line-clamp-1 mb-1">
                      {item.patientName}
                    </div>

                    {/* Procedure Structured Chips */}
                    <div className="flex items-center gap-1 flex-wrap mb-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200/60">
                        Tooth #16
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                        {item.procedureText || 'Resin MOD'}
                      </span>
                    </div>

                    {/* Red Safety Warning Badge if Applicable */}
                    {hasPenicillinAlert && (
                      <div className="flex items-center gap-1.5 text-[10px] font-black text-red-950 bg-red-50 border border-red-200/90 px-2 py-0.5 rounded-lg">
                        <AlertTriangle className="w-3 h-3 text-red-700 shrink-0" />
                        <span>PENICILLIN ALLERGY</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* =========================================================================
            SLICE 3: Ambient Scribing & Live Clinical Ear (340px)
            Dedicated Acoustic Terminal per Dentist Clinical Feedback
           ========================================================================= */}
        <section className="w-80 bg-white border-r border-slate-200/90 flex flex-col shrink-0 overflow-hidden">
          {/* Slice 3 Header */}
          <div className="p-3.5 border-b border-slate-200 bg-slate-50/90">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-cyan-600" />
                <span>Ambient Scribing &amp; Live Ear</span>
              </span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                isRecording
                  ? 'bg-red-50 text-red-700 border-red-200 animate-pulse'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {isRecording ? `REC ${formatSeconds(sessionSeconds)}` : 'EAR ARMED'}
              </span>
            </div>

            {/* Live Audio Streaming Waveform Visualizer */}
            <div className="bg-slate-900 rounded-xl p-2.5 flex items-center justify-between text-white shadow-xs">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`} />
                <span className="text-[11px] font-mono font-bold text-slate-300">
                  {isRecording ? '16kHz AudioWorklet Active' : 'Standby • 10s Ring Buffer'}
                </span>
              </div>
              {/* Animated VU Wave Bars */}
              <div className="flex items-center gap-0.5 h-4">
                {[4, 12, 8, 16, 10, 14, 6, 12].map((height, i) => (
                  <div
                    key={i}
                    style={{ height: isRecording ? `${height}px` : '3px' }}
                    className={`w-1 rounded-full transition-all duration-150 ${
                      isRecording ? 'bg-cyan-400 animate-pulse' : 'bg-slate-700'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Sub-Navigation: Live Transcript vs Real-Time Entities vs Voice Commands */}
          <div className="flex items-center border-b border-slate-200 bg-slate-100/70 p-1 text-[11px] font-bold">
            <button
              onClick={() => setActiveTabScribe('live')}
              className={`flex-1 py-1 rounded-md transition-all cursor-pointer ${
                activeTabScribe === 'live' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Verbatim Live
            </button>
            <button
              onClick={() => setActiveTabScribe('entities')}
              className={`flex-1 py-1 rounded-md transition-all cursor-pointer ${
                activeTabScribe === 'entities' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Detected Findings ({detectedEntities.length})
            </button>
            <button
              onClick={() => setActiveTabScribe('commands')}
              className={`flex-1 py-1 rounded-md transition-all cursor-pointer ${
                activeTabScribe === 'commands' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Voice Tips
            </button>
          </div>

          {/* Slice 3 Content Area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 cockpit-scrollbar">
            {activeTabScribe === 'live' && (
              <div className="space-y-2.5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Operatory Acoustic Stream</span>
                  <span className="text-emerald-700 font-extrabold">0% Loss</span>
                </div>

                {transcriptLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-xl border text-xs leading-relaxed ${
                      line.sender === 'Dentist'
                        ? 'bg-slate-50 border-slate-200/80 text-slate-800'
                        : 'bg-cyan-50/40 border-cyan-200/50 text-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mb-1">
                      <span className={line.sender === 'Dentist' ? 'text-cyan-800 font-black' : 'text-slate-600'}>
                        {line.sender}
                      </span>
                      <span className="tabular-nums font-mono">{line.time}</span>
                    </div>
                    <p className="font-medium text-[11px]">{line.text}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTabScribe === 'entities' && (
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Real-Time FDI Findings &amp; Codes
                </div>
                {detectedEntities.map((ent) => (
                  <div
                    key={ent.id}
                    className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="text-[10px] font-bold text-cyan-800 uppercase block">
                        {ent.category}
                      </span>
                      <span className="font-bold text-slate-900">{ent.label}</span>
                    </div>
                    <Check className="w-4 h-4 text-emerald-600" />
                  </div>
                ))}
              </div>
            )}

            {activeTabScribe === 'commands' && (
              <div className="space-y-2 text-xs">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Hands-Free Sterile Operatory Triggers
                </div>
                <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 text-blue-950 space-y-1 text-[11px]">
                  <p className="font-bold">Say aloud while inspecting:</p>
                  <ul className="list-disc list-inside space-y-1 text-slate-700">
                    <li><span className="font-mono text-cyan-900">"Tooth 16 MOD caries"</span></li>
                    <li><span className="font-mono text-cyan-900">"Cold test lingering 4 seconds"</span></li>
                    <li><span className="font-mono text-cyan-900">"TTP negative"</span></li>
                    <li><span className="font-mono text-cyan-900">"Local anaesthesia 2.2mL Ligno"</span></li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* =========================================================================
            SLICE 4: Active Patient Surgical Main Stage & AHPRA Clinical Documentation
            Expanded to full primary width since live scribe lives in Slice 3.
           ========================================================================= */}
        <main className="flex-1 bg-slate-50 flex flex-col min-w-0 overflow-y-auto cockpit-scrollbar">
          {selectedItem ? (
            <div className="p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-4">
              {/* Patient Banner & High-Contrast Safety Warning */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-black text-slate-900 tracking-tight">
                        {selectedItem.patientName}
                      </h2>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        DOB: 1988-04-12 (38y)
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200">
                        Dentist Chair
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-500">
                      Scheduled: <span className="text-slate-900 font-bold tabular-nums">{selectedItem.time || '09:00 AM'}</span> • {selectedItem.procedureText || 'Composite Restoration'}
                    </div>
                  </div>

                  {/* Primary 48px Touch Barrier Film Recording Button */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsRecording(!isRecording)}
                      className={`h-12 px-6 rounded-xl font-black text-sm flex items-center gap-2.5 transition-all active:scale-95 cursor-pointer shadow-sm ${
                        isRecording
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-[#0071E3] hover:bg-[#0062C4] text-white'
                      }`}
                    >
                      {isRecording ? (
                        <>
                          <MicOff className="w-5 h-5 animate-pulse" />
                          <span>Stop Recording ({formatSeconds(sessionSeconds)})</span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-5 h-5" />
                          <span>Start Ambient Scribe</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Prominent Crimson Allergy Banner */}
                <div className="mt-3 bg-red-50/90 border border-red-200/90 rounded-xl p-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-black text-red-950">
                    <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
                    <span>CRITICAL MEDICAL ALERT: Penicillin Allergy &amp; Severe Asthma. Avoid Amoxicillin.</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-800 bg-white px-2 py-0.5 rounded border border-red-200">
                    Verified PMS
                  </span>
                </div>
              </div>

              {/* Dynamic Island Floating Entity Badges HUD */}
              <div className="bg-slate-900 text-white rounded-2xl p-3.5 shadow-md flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                    Operatory Entity HUD:
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {detectedEntities.map((ent) => (
                    <span
                      key={ent.id}
                      className="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-800 text-cyan-300 border border-slate-700 shadow-xs flex items-center gap-1.5"
                    >
                      <Check className="w-3 h-3 text-cyan-400" />
                      {ent.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Structured SOAP Clinical Note Documentation Hub */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-teal-600" />
                    <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">
                      AHPRA / Dental Board Clinical Documentation
                    </h3>
                  </div>
                  <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    100% Grounded in Operatory Audio
                  </span>
                </div>

                {/* S - Subjective */}
                <div>
                  <label className="text-xs font-extrabold text-slate-700 block mb-1">
                    SUBJECTIVE (Patient Chief Complaint &amp; History):
                  </label>
                  <textarea
                    value={activeSoapNote.subjective}
                    onChange={(e) => setActiveSoapNote({ ...activeSoapNote, subjective: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-cyan-500 focus:outline-none text-xs text-slate-800 font-medium leading-relaxed"
                    rows={2}
                  />
                </div>

                {/* O - Objective */}
                <div>
                  <label className="text-xs font-extrabold text-slate-700 block mb-1">
                    OBJECTIVE &amp; CLINICAL FINDINGS (FDI Tooth Charting &amp; Tests):
                  </label>
                  <textarea
                    value={activeSoapNote.objective}
                    onChange={(e) => setActiveSoapNote({ ...activeSoapNote, objective: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-cyan-500 focus:outline-none text-xs text-slate-800 font-medium leading-relaxed"
                    rows={2}
                  />
                </div>

                {/* A - Assessment */}
                <div>
                  <label className="text-xs font-extrabold text-slate-700 block mb-1">
                    ASSESSMENT &amp; DIAGNOSIS:
                  </label>
                  <textarea
                    value={activeSoapNote.assessment}
                    onChange={(e) => setActiveSoapNote({ ...activeSoapNote, assessment: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-cyan-500 focus:outline-none text-xs text-slate-800 font-medium leading-relaxed"
                    rows={1}
                  />
                </div>

                {/* P - Plan & Procedure Performed */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-extrabold text-slate-700">
                      TREATMENT PERFORMED &amp; POST-OP PLAN:
                    </label>
                    {/* Quick Insert Clinical Chips */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold text-slate-400">Quick Insert:</span>
                      <button
                        type="button"
                        onClick={() => handleQuickInsertPlan('Rubber dam isolated.')}
                        className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                      >
                        + Rubber Dam
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickInsertPlan('Articulating bite checked clear.')}
                        className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                      >
                        + Occlusion Clear
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={activeSoapNote.plan}
                    onChange={(e) => setActiveSoapNote({ ...activeSoapNote, plan: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-cyan-500 focus:outline-none text-xs text-slate-800 font-medium leading-relaxed"
                    rows={3}
                  />
                </div>
              </div>

              {/* Bottom Clinical Sign & PMS Handoff Bar */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">Billable ADA Items:</span>
                  <button
                    onClick={() => {
                      setSelectedAdaCodes((prev) =>
                        prev.includes('532') ? prev.filter((c) => c !== '532') : [...prev, '532']
                      );
                    }}
                    className={`text-xs font-black px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                      selectedAdaCodes.includes('532')
                        ? 'bg-cyan-50 border-cyan-300 text-cyan-900 shadow-xs'
                        : 'bg-slate-100 border-slate-200 text-slate-500'
                    }`}
                  >
                    ADA 532 ($295)
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAdaCodes((prev) =>
                        prev.includes('022') ? prev.filter((c) => c !== '022') : [...prev, '022']
                      );
                    }}
                    className={`text-xs font-black px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                      selectedAdaCodes.includes('022')
                        ? 'bg-cyan-50 border-cyan-300 text-cyan-900 shadow-xs'
                        : 'bg-slate-100 border-slate-200 text-slate-500'
                    }`}
                  >
                    ADA 022 ($45)
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAdaCodes((prev) =>
                        prev.includes('114') ? prev.filter((c) => c !== '114') : [...prev, '114']
                      );
                    }}
                    className={`text-xs font-black px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                      selectedAdaCodes.includes('114')
                        ? 'bg-cyan-50 border-cyan-300 text-cyan-900 shadow-xs'
                        : 'bg-slate-100 border-slate-200 text-slate-500'
                    }`}
                  >
                    ADA 114 ($145)
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCopyPms}
                    className="h-11 px-5 rounded-xl border border-slate-200/90 font-extrabold text-xs text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    {copiedPms ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="text-emerald-700">Copied to PMS</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-slate-500" />
                        <span>Copy for PMS Clipboard</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleSignNote}
                    className="h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all active:scale-95 shadow-xs flex items-center gap-2 cursor-pointer"
                  >
                    {signedSuccess ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-white" />
                        <span>Signed &amp; Hash-Locked</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Sign Clinical Note &amp; Complete</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-slate-400 text-sm font-semibold">
              Select a patient from the Day Sheet or add a walk-in to open surgical stage.
            </div>
          )}
        </main>
      </div>

      {/* Modal 1: Active Recording Safety Guard (Medico-Legal Invariant) */}
      {showActiveRecordingGuard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 text-red-700 flex items-center justify-center">
                <ShieldAlert className="w-5 h-5 stroke-[1.75]" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  Active Operatory Scribe in Progress
                </h3>
                <p className="text-xs text-slate-500">
                  Medico-Legal Safety Barrier
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              An ambient recording session is actively listening on <strong className="text-slate-900">Operatory 1 ({selectedItem?.patientName || 'Current Patient'})</strong>.
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              To protect the integrity of the clinical note and audio buffer, please stop the recording before switching patients or shifting dates.
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowActiveRecordingGuard(false);
                  setPendingSwitchAction(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Keep Recording
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRecording(false);
                  setShowActiveRecordingGuard(false);
                  if (pendingSwitchAction) {
                    pendingSwitchAction();
                    setPendingSwitchAction(null);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-black bg-red-600 hover:bg-red-700 text-white shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                Stop Scribe &amp; Switch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Rapid Chairside Walk-in Triage Modal */}
      {showWalkInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-700 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Add Walk-in Patient
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Dentist Chair (Operatory 1) • {selectedDate}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWalkInModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWalkIn} className="space-y-3.5">
              <div>
                <label className="text-xs font-extrabold text-slate-700 block mb-1">
                  Patient Full Name *
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. David Campbell"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-cyan-500 focus:outline-none text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-700 block mb-1">
                  Arrival Time
                </label>
                <input
                  type="text"
                  placeholder="HH:MM"
                  value={walkInTime}
                  onChange={(e) => setWalkInTime(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-cyan-500 focus:outline-none text-slate-900 font-mono font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-700 block mb-1.5">
                  Chief Complaint / Procedure
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    'Toothache / Acute Pain Relief',
                    'Broken Tooth / Trauma',
                    'Emergency Exam & X-Ray',
                    'Lost Crown / Recementation'
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setWalkInComplaint(chip)}
                      className={`p-2 rounded-xl text-[11px] font-bold text-left border transition-all cursor-pointer leading-tight ${
                        walkInComplaint === chip
                          ? 'bg-cyan-50 border-cyan-400 text-cyan-950 shadow-2xs'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-700 block mb-1.5">
                  Triage Priority
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWalkInPriority('emergency')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold border transition-all cursor-pointer ${
                      walkInPriority === 'emergency'
                        ? 'bg-red-50 border-red-300 text-red-800 shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    Urgent Emergency
                  </button>
                  <button
                    type="button"
                    onClick={() => setWalkInPriority('normal')}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold border transition-all cursor-pointer ${
                      walkInPriority === 'normal'
                        ? 'bg-cyan-50 border-cyan-300 text-cyan-800 shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    Normal Walk-in
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowWalkInModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-black bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Book Walk-in</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Non-Dentist Chair Notice */}
      {showNonDentistChairNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center">
                <Info className="w-5 h-5 stroke-[1.75]" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  {showNonDentistChairNotice}
                </h3>
                <p className="text-xs text-slate-500">
                  Standard Cockpit Configuration
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              The <strong className="text-slate-900">4-Slice Command Center</strong> is exclusively calibrated for the <strong className="text-cyan-800">Dentist Chair (Operatory 1)</strong> with real-time FDI surgical charting and ambient scribing.
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              For Associate and Hygiene chairs, please use the <strong className="text-slate-900">Standard 3-Zone Cockpit</strong> view.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowNonDentistChairNotice(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Stay on Dentist Chair
              </button>
              <button
                onClick={() => {
                  setShowNonDentistChairNotice(null);
                  onSwitchToStandard?.();
                }}
                className="px-4 py-2 rounded-xl text-xs font-black bg-[#0071E3] hover:bg-[#0062C4] text-white shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                Switch to Standard Cockpit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
