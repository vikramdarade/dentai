import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Calendar,
  Clock,
  User,
  Plus,
  Copy,
  Check,
  Sparkles,
  AlertCircle,
  Play,
  RotateCw,
  Trash2,
  FileText,
  UploadCloud,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  X,
  Stethoscope,
  DollarSign,
  TrendingUp,
  MicOff,
  CheckCircle2,
  Sun,
  Moon,
  Key,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { verifyTranscriptGrounding } from '../lib/transcriptGrounding';
import {
  DayScheduleItem,
  loadTodaySchedule,
  saveTodaySchedule,
  addScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
  clearTodaySchedule,
  formatNoteForPmsClipboard,
  getTodayDateStr,
  mergeScheduleItems,
  calculateDailyProduction,
  generateSafeUuid
} from '../lib/dayScheduleStorage';
import { AppointmentType, APPOINTMENT_TYPES, getAppointmentTypeLabel } from '../lib/dentalLibrary';
import TopSurgeryBar from './TopSurgeryBar';
import ErrorBoundary from './ErrorBoundary';
import CockpitLayout from './CockpitLayout';
import CockpitInspectionDrawer from './CockpitInspectionDrawer';
import { ClinicMembership } from '../lib/clinics';
import { useSurgeryIsland } from '../context/SurgeryIslandContext';
import { useTheme } from '../context/ThemeContext';

interface DayScheduleQueueProps {
  onStartRecording?: (item: DayScheduleItem) => void;
  onViewConsultation?: (consultationId: string) => void;
  dentistName: string;
  authToken: string;
  onLogout?: () => void;
  onNavigateTab?: (tab: 'schedule' | 'records' | 'pipeline') => void;
  activeClinic?: ClinicMembership | null;
  clinics?: ClinicMembership[];
  onSelectClinic?: (clinicId: string) => void;
  onManageClinic?: () => void;
  onClinicChanged?: () => void;
  onJoinClinic?: (code: string) => Promise<{ ok: boolean; message: string }>;
}

export default function DayScheduleQueue({
  onStartRecording,
  onViewConsultation,
  dentistName,
  authToken,
  onLogout,
  onNavigateTab,
  activeClinic,
  clinics,
  onSelectClinic,
  onManageClinic,
  onClinicChanged,
  onJoinClinic
}: DayScheduleQueueProps) {
  const [items, setItems] = useState<DayScheduleItem[]>(() => loadTodaySchedule());
  const [isParsing, setIsParsing] = useState(false);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [viewNoteItem, setViewNoteItem] = useState<DayScheduleItem | null>(null);
  const [consentGuardItem, setConsentGuardItem] = useState<DayScheduleItem | null>(null);
  const [sideBySideItem, setSideBySideItem] = useState<DayScheduleItem | null>(null);

  // Custom Gemini Key & Vision Extraction States
  const [customApiKey, setCustomApiKey] = useState<string>(() => {
    return localStorage.getItem('dentai_custom_gemini_key') || '';
  });
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKeyInput, setTempApiKeyInput] = useState('');
  const [fallbackNotice, setFallbackNotice] = useState<{
    reason: string;
    demoAppointments: DayScheduleItem[];
  } | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Cockpit Inspection Drawer State
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(() => {
    const initial = loadTodaySchedule();
    const readyOne = initial.find(i => i.status === 'ready');
    return readyOne ? readyOne.id : (initial[0]?.id || null);
  });
  const [isInspectionOpen, setIsInspectionOpen] = useState(true);

  // Active selected item for the persistent Inspection Drawer
  const selectedItem = useMemo(() => {
    if (!selectedInspectionId) {
      return items.find(i => i.status === 'ready') || items[0] || null;
    }
    return items.find(i => i.id === selectedInspectionId) || items[0] || null;
  }, [items, selectedInspectionId]);

  // Date Navigator Header
  const [dateOffset, setDateOffset] = useState(0);
  const formattedDateTitle = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    const day = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    if (dateOffset === 0) {
      return `TODAY • ${day}, ${monthDay}`;
    }
    return `${day}, ${monthDay}`;
  }, [dateOffset]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(n => n.toLowerCase() !== 'dr.')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'PT';
  };

  const toggleConsent = (item: DayScheduleItem) => {
    const nextVal = !item.consentObtained;
    const updated = updateScheduleItem(item.id, {
      consentObtained: nextVal,
      consentCapturedAt: nextVal ? new Date().toISOString() : undefined,
      consentPractitionerId: nextVal ? dentistName : undefined
    });
    setItems(updated);
  };

  const handleRecordClick = (item: DayScheduleItem) => {
    if (!item.consentObtained) {
      setConsentGuardItem(item);
    } else {
      startInPlaceRecording(item);
    }
  };

  const confirmConsentAndRecord = (item: DayScheduleItem) => {
    const updated = updateScheduleItem(item.id, {
      consentObtained: true,
      consentCapturedAt: new Date().toISOString(),
      consentPractitionerId: dentistName
    });
    setItems(updated);
    const target = updated.find(i => i.id === item.id) || {
      ...item,
      consentObtained: true,
      consentCapturedAt: new Date().toISOString(),
      consentPractitionerId: dentistName
    };
    setConsentGuardItem(null);
    startInPlaceRecording(target);
  };

  const recordWithoutConsentTag = (item: DayScheduleItem) => {
    setConsentGuardItem(null);
    startInPlaceRecording(item);
  };

  // Persistent Surgery Island context
  const {
    recordingItem,
    mediaStream,
    liveTranscript,
    micError,
    clearMicError,
    startInPlaceRecording,
    finishInPlaceRecording,
    cancelInPlaceRecording,
    reconnectInPlaceRecording
  } = useSurgeryIsland();
  const { theme, toggleTheme } = useTheme();

  // Keep schedule queue in sync with storage updates
  useEffect(() => {
    const refresh = () => setItems(loadTodaySchedule());
    window.addEventListener('storage', refresh);
    const interval = setInterval(refresh, 2000);
    return () => {
      window.removeEventListener('storage', refresh);
      clearInterval(interval);
    };
  }, []);

  // Quick Walk-in form state
  const [walkInName, setWalkInName] = useState('');
  const [walkInTime, setWalkInTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [walkInReason, setWalkInReason] = useState('Emergency Dental Toothache');
  const [walkInType, setWalkInType] = useState<AppointmentType>('emergency');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync with storage on mount and interval (for background jobs)
  useEffect(() => {
    let lastRosterSnapshot = '';
    const refresh = () => {
      const current = loadTodaySchedule();
      const snapshot = JSON.stringify(current);
      if (snapshot !== lastRosterSnapshot) {
        lastRosterSnapshot = snapshot;
        setItems(current);
      }
    };
    refresh();
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
  }, []);

  // Global paste handler (Win+Shift+S -> Ctrl+V anywhere on schedule)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;

      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (blob) {
            handleImageFile(blob);
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const optimizeScreenshotForVision = async (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawResult = (e.target?.result as string) || '';
        const img = new Image();
        img.onload = () => {
          try {
            const maxDimension = 1600;
            let width = img.width;
            let height = img.height;
            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const jpegData = canvas.toDataURL('image/jpeg', 0.88);
              resolve({ base64: jpegData, mimeType: 'image/jpeg' });
              return;
            }
          } catch {
            // fallback to original base64
          }
          resolve({ base64: rawResult, mimeType: file.type || 'image/png' });
        };
        img.onerror = () => {
          resolve({ base64: rawResult, mimeType: file.type || 'image/png' });
        };
        img.src = rawResult;
      };
      reader.onerror = () => {
        resolve({ base64: '', mimeType: file.type || 'image/png' });
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageFile = async (file: File, overrideKey?: string) => {
    setIsParsing(true);
    setParsingError(null);
    setFallbackNotice(null);
    setLastUploadedFile(file);

    try {
      const activeKey = overrideKey !== undefined ? overrideKey : customApiKey;
      const { base64, mimeType } = await optimizeScreenshotForVision(file);

      if (!base64) {
        throw new Error('Could not read image file.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      };
      if (activeKey) {
        headers['x-gemini-api-key'] = activeKey;
      }

      const res = await fetch('/api/schedule/parse-image', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          providerName: dentistName,
          userApiKey: activeKey || undefined
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to parse appointment screenshot.');
      }

      const data = await res.json();
      const rawAppointments = Array.isArray(data.appointments) ? data.appointments : [];
      const newAppointments: DayScheduleItem[] = rawAppointments.map((app: any) => ({
        id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        time: app.time || '09:00',
        patientName: app.patientName || 'Unknown Patient',
        procedureText: app.procedureText || 'General Consultation',
        appointmentType: app.appointmentType || 'examination',
        templateId: app.templateId || 'standard',
        status: 'scheduled',
        source: 'snip'
      }));

      // If the backend had to fallback to sample appointments because AI was unavailable/quota depleted:
      if (data.isSampleFallback) {
        setFallbackNotice({
          reason: data.fallbackReason || data.notice || 'AI Vision service is temporarily unavailable or out of quota.',
          demoAppointments: newAppointments
        });
        return;
      }

      if (newAppointments.length === 0) {
        throw new Error('No patient appointments could be detected in this screenshot. Please verify the image contains readable schedule rows.');
      }

      // 3-Way Smart Hash Merge: eliminates duplicates & preserves existing progress
      const currentRoster = loadTodaySchedule();
      const merged = mergeScheduleItems(currentRoster, newAppointments, getTodayDateStr());
      setItems(merged);
      saveTodaySchedule(merged);
      setSuccessBanner(`Successfully imported ${newAppointments.length} appointments from your schedule!`);
      setTimeout(() => setSuccessBanner(null), 5000);
    } catch (err: any) {
      setParsingError(err.message || 'Error processing image.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleLoadDemoSchedule = () => {
    const demoItems: DayScheduleItem[] = [
      {
        id: `sched_demo_1`,
        time: '08:30',
        patientName: 'Sarah Connor',
        procedureText: 'Comprehensive Exam & Bitewings (011, 022)',
        appointmentType: 'examination',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip',
        consentObtained: true,
        consentCapturedAt: new Date().toISOString()
      },
      {
        id: `sched_demo_2`,
        time: '09:15',
        patientName: 'David Miller',
        procedureText: 'Tooth #16 Ceramic Crown Prep (611)',
        appointmentType: 'prosthodontic',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip',
        consentObtained: false
      },
      {
        id: `sched_demo_3`,
        time: '10:00',
        patientName: 'Liam O\'Connor',
        procedureText: 'Emergency: Severe Pain & Pulpitis #36',
        appointmentType: 'emergency',
        templateId: 'soap',
        status: 'scheduled',
        source: 'snip',
        consentObtained: false
      },
      {
        id: `sched_demo_4`,
        time: '11:00',
        patientName: 'Emma Watson',
        procedureText: 'Adult Hygiene Scale & Clean & Fluoride (114, 121)',
        appointmentType: 'scale_clean',
        templateId: 'concise',
        status: 'ready',
        source: 'snip',
        consentObtained: true,
        consentCapturedAt: new Date().toISOString(),
        isFullyGrounded: true,
        groundingScore: 100,
        unverifiedClaims: [],
        adaCodes: ['114', '121'],
        transcript: [
          { sender: 'Dentist', text: 'Good morning Emma, we will perform your periodic adult hygiene scaling and topical fluoride treatment today.' },
          { sender: 'Patient', text: 'Sounds good doctor, my gums have been feeling a bit sensitive on the lower right.' },
          { sender: 'Dentist', text: 'Supragingival and subgingival calculus removed with ultrasonic scaler and hand curettes. Applied neutral sodium fluoride foam.' },
          { sender: 'Dentist', text: 'All finished. Avoid eating or hot drinks for thirty minutes.' }
        ],
        clinicalNote: `=== DENTAI AMBIENT CLINICAL NOTE ===\nPatient: Emma Watson\nDate: ${getTodayDateStr()} | Time: 11:00\nProcedure: Adult Hygiene Scale & Clean & Fluoride (114, 121)\n\nCHIEF COMPLAINT:\nRoutine 6-monthly preventive hygiene visit. Mild lower right gingival sensitivity reported.\n\nEXAMINATION & FINDINGS:\nGeneralized mild marginal gingivitis with localised calculus deposits lower anterior lingual surfaces. No deep periodontal pocketing (>3mm).\n\nTREATMENT PERFORMED:\nFull mouth scaling and root debridement using ultrasonic scaler and hand instrumentation (ADA 114). Polishing with fine prophy paste. Topical neutral sodium fluoride gel application for 4 minutes (ADA 121).\n\nPOST-OPERATIVE INSTRUCTIONS:\nPatient advised nil by mouth for 30 minutes. Gentle brushing with soft-bristled brush recommended.\n\nNEXT VISIT / RECALL:\n6 Months Routine Hygiene Recall.\n\nADA ITEM CODES:\n114 (Removal of calculus), 121 (Topical fluoride)`
      },
      {
        id: `sched_demo_5`,
        time: '13:30',
        patientName: 'Michael Chang',
        procedureText: 'Tooth #24 MO Resin Restoration (532)',
        appointmentType: 'restorative',
        templateId: 'standard',
        status: 'scheduled',
        source: 'snip',
        consentObtained: true,
        consentCapturedAt: new Date().toISOString()
      }
    ];

    // Smart merge demo items
    const merged = mergeScheduleItems(items, demoItems, getTodayDateStr());
    setItems(merged);
    saveTodaySchedule(merged);
  };

  // Surgery Cockpit recording lifecycle is now centrally managed by SurgeryIslandContext

  const handleCopyNote = async (item: DayScheduleItem) => {
    const text = formatNoteForPmsClipboard(item);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setCopiedId(item.id);
    }
  };

  const handleExpressCopyNext = () => {
    const uncopied = items.find(i => i.status === 'ready' && copiedId !== i.id);
    if (uncopied) {
      handleCopyNote(uncopied);
    } else {
      const firstReady = items.find(i => i.status === 'ready');
      if (firstReady) handleCopyNote(firstReady);
    }
  };

  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteScheduleItem(id);
    setItems(updated);
  };

  const handleAddWalkInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInName.trim()) return;

    addScheduleItem({
      time: walkInTime,
      patientName: walkInName.trim(),
      procedureText: walkInReason.trim(),
      appointmentType: walkInType,
      templateId: walkInType === 'emergency' ? 'soap' : 'standard',
      source: 'manual'
    });

    setItems(loadTodaySchedule());
    setWalkInName('');
    setShowWalkInModal(false);
  };

  // Metrics
  const totalCount = items.length;
  const readyCount = items.filter(i => i.status === 'ready').length;
  const processingCount = items.filter(i => i.status === 'processing').length;
  const pendingCount = items.filter(i => i.status === 'scheduled').length;
  const dailyProduction = calculateDailyProduction(items);

  return (
    <CockpitLayout
      dentistName={dentistName}
      onLogout={onLogout || (() => {})}
      activeTab="roster"
      onTabChange={(tab) => {
        if (tab === 'patients') onNavigateTab?.('records');
        else if (tab === 'pipeline') onNavigateTab?.('pipeline');
      }}
      onDrawerClose={() => setIsInspectionOpen(false)}
      rightDrawer={
        isInspectionOpen ? (
          <CockpitInspectionDrawer
            selectedItem={selectedItem}
            onClose={() => setIsInspectionOpen(false)}
            onExpressCopy={handleCopyNote}
            isCopied={copiedId === selectedItem?.id}
            onOpenSideBySide={(item) => setSideBySideItem(item)}
          />
        ) : undefined
      }
    >
      <div className="w-full max-w-6xl mx-auto space-y-5">
        {/* Active Surgery Recovery Banner */}
        {(() => {
          const activeRecording = recordingItem || items.find(i => i.status === 'recording');
          if (!activeRecording) return null;
          const isConnected = !!recordingItem && recordingItem.id === activeRecording.id;

          return (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/70 via-[#0E1B2A] to-teal-950/70 border border-cyan-500/40 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-cyan-200">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3.5 w-3.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500"></span>
                </span>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-white uppercase tracking-wider">
                      {isConnected ? 'Surgery Recording in Progress' : 'Surgery Recording Session Interrupted'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      {activeRecording.patientName}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {isConnected
                      ? 'The Active Surgery Island is currently recording at the top of your screen. Browse past records or pipeline freely.'
                      : 'Active recording session detected. Click Reconnect Island to resume microphone stream, or finish note now.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!isConnected && (
                  <button
                    onClick={() => reconnectInPlaceRecording(activeRecording)}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-400 to-teal-300 hover:from-cyan-300 hover:to-teal-200 text-slate-950 text-xs font-black rounded-xl shadow-md cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Reconnect Island
                  </button>
                )}
                <button
                  onClick={finishInPlaceRecording}
                  className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-slate-950 text-xs font-black rounded-xl shadow-md cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  Finish Note
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Discard active recording for ${activeRecording.patientName}?`)) {
                      cancelInPlaceRecording();
                    }
                  }}
                  className="px-2.5 py-1.5 text-slate-400 hover:text-rose-400 hover:bg-[#162436] rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

        {/* Mic Access Error Alert */}
        {micError && (
          <div className="p-4 bg-rose-950/50 border border-rose-500/50 rounded-2xl flex items-center justify-between gap-3 text-rose-200 text-xs shadow-xl">
            <div className="flex items-center gap-2">
              <MicOff className="w-5 h-5 text-rose-400 shrink-0" />
              <span className="font-semibold">{micError}</span>
            </div>
            <button
              onClick={clearMicError}
              className="text-rose-300 hover:text-white font-bold cursor-pointer underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. Header Bar: Date Switcher & Operatory Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0E1724] border border-[#182638] shadow-xl shadow-black/30">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                <Sparkles className="w-3 h-3" />
                Operatory Cockpit
              </span>
              {readyCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <DollarSign className="w-3 h-3" />
                  Est. Production: ${dailyProduction.toLocaleString()}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Date Navigator Buttons */}
              <div className="flex items-center gap-1 bg-[#121E2E] border border-[#1E3048] rounded-xl p-1 shadow-inner">
                <button
                  onClick={() => setDateOffset(prev => prev - 1)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-[#1A2C40] transition-colors cursor-pointer"
                  title="Previous Day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDateOffset(0)}
                  className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    dateOffset === 0
                      ? 'bg-cyan-500 text-slate-950 font-black shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => setDateOffset(prev => prev + 1)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-[#1A2C40] transition-colors cursor-pointer"
                  title="Next Day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <h2 className="text-xl md:text-2xl font-black text-white tracking-tight uppercase">
                {formattedDateTitle}
              </h2>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Inspection Drawer Pill */}
            <button
              onClick={() => setIsInspectionOpen(prev => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                isInspectionOpen
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-xs'
                  : 'bg-[#121E2E] hover:bg-[#18283D] text-slate-300 border-[#1E3048]'
              }`}
              title="Toggle operatory inspection drawer"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span>{isInspectionOpen ? 'Hide Inspection' : 'Inspect Patient'}</span>
            </button>

            {readyCount > 0 && (
              <button
                onClick={handleExpressCopyNext}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-all active:scale-95 shadow-lg shadow-emerald-950/60 cursor-pointer"
                title="Copy the next completed note directly for D4W"
              >
                <Copy className="w-4 h-4 stroke-[2.5]" />
                Express Copy (D4W)
              </button>
            )}

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-400 hover:text-amber-300 bg-[#121E2E] border border-[#1E3048] transition-colors cursor-pointer flex items-center justify-center"
              title={theme === 'dark' ? 'Switch to Clinical Light Mode' : 'Switch to Dark Cockpit Mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-cyan-600" />
              )}
            </button>

            {/* AI Key Config Button */}
            <button
              onClick={() => {
                setTempApiKeyInput(customApiKey);
                setShowApiKeyModal(true);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                customApiKey
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 shadow-xs'
                  : 'bg-[#121E2E] hover:bg-[#18283D] text-slate-300 border-[#1E3048]'
              }`}
              title={customApiKey ? 'Custom Gemini API Key Active (Click to change)' : 'Configure Gemini Vision API Key (Click to set)'}
            >
              <Key className={`w-3.5 h-3.5 ${customApiKey ? 'text-emerald-400' : 'text-amber-400'}`} />
              <span className="hidden sm:inline">{customApiKey ? 'AI Key: Active' : 'AI Key'}</span>
              {customApiKey && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </button>

            <button
              onClick={() => setShowWalkInModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#121E2E] hover:bg-[#18283D] text-slate-200 border border-[#1E3048] rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-cyan-400" />
              Add Walk-in
            </button>

            {items.length === 0 && (
              <button
                onClick={handleLoadDemoSchedule}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                <Stethoscope className="w-4 h-4 text-cyan-400" />
                Load Sample Day
              </button>
            )}

            {items.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('Clear today\'s schedule queue?')) {
                    clearTodaySchedule();
                    setItems([]);
                  }
                }}
                className="p-2 text-slate-500 hover:text-rose-400 rounded-xl hover:bg-[#121E2E] transition-colors cursor-pointer"
                title="Clear roster"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Success Banner if parsed */}
        {successBanner && (
          <div className="p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl flex items-center justify-between text-xs text-emerald-200 shadow-md">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-semibold">{successBanner}</span>
            </div>
            <button
              onClick={() => setSuccessBanner(null)}
              className="p-1 text-emerald-400/80 hover:text-emerald-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* AI Vision Quota / Fallback Notice Card */}
        {fallbackNotice && (
          <div className="p-4 bg-gradient-to-r from-amber-500/10 via-amber-600/10 to-orange-500/10 border border-amber-500/30 rounded-2xl text-left shadow-lg backdrop-blur-md">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs sm:text-sm font-black text-amber-200 uppercase tracking-wider">
                    Screenshot Could Not Be Read by AI
                  </h4>
                  <button
                    onClick={() => setFallbackNotice(null)}
                    className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-amber-300/90 mt-1 leading-relaxed">
                  {fallbackNotice.reason}
                </p>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  DentAI does not silently replace your uploaded schedule with sample patients. You can enter a free Google Gemini key in 30 seconds to parse your screenshot for real, or load the sample day below.
                </p>
                <div className="flex items-center gap-2.5 mt-3.5 flex-wrap">
                  <button
                    onClick={() => {
                      setTempApiKeyInput(customApiKey);
                      setShowApiKeyModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <Key className="w-3.5 h-3.5" />
                    Enter Free Gemini Key & Re-parse
                  </button>
                  <button
                    onClick={() => {
                      const currentRoster = loadTodaySchedule();
                      const merged = mergeScheduleItems(currentRoster, fallbackNotice.demoAppointments, getTodayDateStr());
                      setItems(merged);
                      saveTodaySchedule(merged);
                      setFallbackNotice(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#121E2E] hover:bg-[#18283D] text-slate-200 border border-[#1E3048] font-bold text-xs rounded-xl transition-all active:scale-95 cursor-pointer"
                  >
                    <Stethoscope className="w-3.5 h-3.5 text-cyan-400" />
                    Load Sample Schedule Anyway
                  </button>
                  <button
                    onClick={() => setFallbackNotice(null)}
                    className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. Snip & Paste Dropzone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative rounded-2xl border border-dashed border-[#1E3048] hover:border-cyan-500/50 bg-[#0E1724]/70 hover:bg-[#121E2E] p-5 text-center transition-all cursor-pointer group shadow-lg shadow-black/20"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
            }}
          />

          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center justify-center group-hover:scale-105 transition-transform shadow-xs">
              {isParsing ? (
                <RotateCw className="w-5 h-5 animate-spin text-cyan-400" />
              ) : (
                <UploadCloud className="w-5 h-5 text-cyan-300" />
              )}
            </div>

            <div>
              <p className="text-xs md:text-sm font-bold text-slate-100">
                {isParsing ? (
                  'Analyzing D4W / Praktika Screenshot with AI...'
                ) : (
                  <>
                    Press <kbd className="px-2 py-0.5 text-[11px] font-mono font-extrabold bg-[#162436] border border-[#233852] rounded text-cyan-300 shadow-xs">Ctrl + V</kbd> to paste snip, or click to upload
                  </>
                )}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Supports Windows Snipping Tool (<kbd className="text-[10px] bg-[#162436] px-1.5 py-0.5 rounded border border-[#233852] text-slate-300">Win+Shift+S</kbd>). 3-way hash auto-merges midday walk-ins with zero duplicate cards.
              </p>
            </div>
          </div>

          {parsingError && (
            <div className="mt-3 p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-xs text-red-200 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{parsingError}</span>
            </div>
          )}
        </div>

        {/* 3. Status Metrics Bar */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#0E1724] border border-[#182638] rounded-xl text-xs text-slate-300 shadow-md">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-extrabold text-white">
                {totalCount} Total Appointments
              </span>
              {readyCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-300 font-bold">
                  <Check className="w-3.5 h-3.5 stroke-[3] text-emerald-400" />
                  {readyCount} Ready for D4W
                </span>
              )}
              {processingCount > 0 && (
                <span className="flex items-center gap-1 text-amber-300 font-bold">
                  <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  {processingCount} Synthesizing Notes
                </span>
              )}
              {pendingCount > 0 && (
                <span className="text-slate-400 font-medium">
                  {pendingCount} Remaining
                </span>
              )}
            </div>

            {readyCount > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>5:00 PM Cake Walk: 1-click clipboard paste</span>
              </div>
            )}
          </div>
        )}

        {/* 4. Schedule Items Adaptive Bento Grid */}
        {items.length === 0 ? (
          <div className="bg-[#0E1724] rounded-2xl border border-[#182638] p-12 text-center shadow-xl">
            <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-extrabold text-white">No Appointments Queued for Today</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
              Snip your appointment book from Dental4Windows or Praktika and press <strong className="text-cyan-300">Ctrl+V</strong> to populate your day in 3 seconds.
            </p>
            <button
              onClick={handleLoadDemoSchedule}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 text-xs font-black rounded-xl transition-all shadow-lg shadow-cyan-950/40 cursor-pointer active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              Populate with Sample Day
            </button>
          </div>
        ) : (
          <div className={isInspectionOpen ? "grid grid-cols-1 xl:grid-cols-2 gap-4" : "grid grid-cols-1 md:grid-cols-2 gap-4"}>
            {items.map((item, index) => {
              const isSelected = selectedItem?.id === item.id;
              const isRecordingThis = recordingItem?.id === item.id || item.status === 'recording';
              const isReady = item.status === 'ready';
              const isProcessing = item.status === 'processing';
              const initials = getInitials(item.patientName);

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.02 }}
                  onClick={() => {
                    setSelectedInspectionId(item.id);
                    setIsInspectionOpen(true);
                  }}
                  className={`p-0.5 rounded-2xl transition-all duration-200 cursor-pointer relative group ${
                    isSelected
                      ? 'bg-gradient-to-b from-cyan-400/80 via-teal-500/40 to-[#182638] shadow-lg shadow-cyan-950/50'
                      : isRecordingThis
                      ? 'bg-gradient-to-b from-rose-500/80 via-rose-900/40 to-[#182638] shadow-lg shadow-rose-950/50 animate-pulse'
                      : isReady
                      ? 'bg-gradient-to-b from-emerald-500/40 via-transparent to-[#182638] hover:from-cyan-500/40'
                      : 'bg-[#182638] hover:bg-[#20334A]'
                  }`}
                >
                  <div
                    className={`rounded-[calc(1rem-2px)] p-4 flex flex-col justify-between gap-3.5 h-full transition-colors ${
                      isSelected
                        ? 'bg-[#101C2B] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                        : isRecordingThis
                        ? 'bg-[#1E1118]'
                        : isReady
                        ? 'bg-[#0E1724] hover:bg-[#121E2E]'
                        : 'bg-[#0A1018] hover:bg-[#0E1724]'
                    }`}
                  >
                    {/* Top Row: Avatar + Patient Name + Monospace Time Pill */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center font-black text-xs border ${
                            isSelected
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-xs'
                              : 'bg-[#162436] border-[#233852] text-slate-200'
                          }`}
                        >
                          {initials}
                        </div>

                        <div className="min-w-0">
                          <h4 className="text-base font-black text-white truncate tracking-tight">
                            {item.patientName}
                          </h4>
                          <p className="text-xs text-cyan-300 font-medium truncate mt-0.5">
                            {item.procedureText}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#162436] border border-[#20334A] text-slate-200 font-mono text-[11px] font-bold shadow-xs">
                        <Clock className="w-3 h-3 text-cyan-400" />
                        <span>{item.time || '09:00'}</span>
                      </div>
                    </div>

                    {/* ADA Item Codes & Procedure Chips */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.adaCodes && item.adaCodes.length > 0 ? (
                        item.adaCodes.map((c, idx) => {
                          const codeStr = typeof c === 'string' ? c : (c as any)?.code || '';
                          return (
                            <span
                              key={idx}
                              className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-extrabold bg-[#162436] text-cyan-300 border border-[#233852]"
                            >
                              ADA {codeStr}
                            </span>
                          );
                        })
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#121E2E] text-slate-300 border border-[#182638]">
                          {getAppointmentTypeLabel(item.appointmentType)}
                        </span>
                      )}
                    </div>

                    {/* Bottom Row: Status & Actions */}
                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#182638]">
                      {/* Left: Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isReady && item.isFullyGrounded !== false && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            Audio Verified 100%
                          </span>
                        )}

                        {isReady && item.isFullyGrounded === false && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSideBySideItem(item);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                          >
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                            Review Dialogue ({item.groundingScore ?? 0}%)
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleConsent(item);
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                            item.consentObtained
                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                              : 'bg-[#121E2E] text-slate-400 border-[#182638] hover:text-slate-200'
                          }`}
                        >
                          <Check className={`w-3 h-3 ${item.consentObtained ? 'text-cyan-400 stroke-[3]' : 'text-slate-500'}`} />
                          <span>{item.consentObtained ? 'Verbal Consent ✓' : 'Consent'}</span>
                        </button>
                      </div>

                      {/* Right: Quick Action Button */}
                      <div className="flex items-center gap-1.5">
                        {item.status === 'scheduled' && !isRecordingThis && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRecordClick(item);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-transform active:scale-95 shadow-sm cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            Record
                          </button>
                        )}

                        {isRecordingThis && recordingItem?.id === item.id && (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                              Island Active
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                finishInPlaceRecording();
                              }}
                              className="px-2.5 py-1 bg-emerald-400 hover:bg-emerald-300 text-slate-950 rounded-xl text-xs font-black shadow-xs cursor-pointer active:scale-95"
                              title="Finish consult & generate note"
                            >
                              Finish
                            </button>
                          </div>
                        )}

                        {isRecordingThis && recordingItem?.id !== item.id && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                reconnectInPlaceRecording(item);
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-cyan-400 to-teal-300 hover:from-cyan-300 hover:to-teal-200 text-slate-950 rounded-xl text-xs font-black shadow-md shadow-cyan-950/40 active:scale-95 cursor-pointer"
                              title="Reconnect live surgery island"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              Reconnect Island
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateScheduleItem(item.id, { status: 'scheduled' });
                                setItems(loadTodaySchedule());
                              }}
                              className="p-1 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-[#162436] transition-colors cursor-pointer text-xs"
                              title="Reset status"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {isProcessing && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <RotateCw className="w-3 h-3 animate-spin text-amber-400" />
                            Synthesizing
                          </span>
                        )}

                        {isReady && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyNote(item);
                            }}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 ${
                              copiedId === item.id
                                ? 'bg-emerald-400 text-slate-950 font-black shadow-md'
                                : 'bg-[#162436] hover:bg-[#20334A] text-slate-100 border border-[#233852]'
                            }`}
                            title="Express copy note for D4W / Praktika"
                          >
                            {copiedId === item.id ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
                            <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item.id, e);
                          }}
                          className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                          title="Remove appointment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

      {/* Quick Add Walk-in Modal */}
      <AnimatePresence>
        {showWalkInModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[#1E2E40] text-slate-100"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-cyan-400" />
                  Add Unscheduled Walk-in
                </h3>
                <button
                  onClick={() => setShowWalkInModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddWalkInSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Patient Name *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. John Doe"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 placeholder:text-slate-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Time
                    </label>
                    <input
                      type="time"
                      value={walkInTime}
                      onChange={(e) => setWalkInTime(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Type
                    </label>
                    <select
                      value={walkInType}
                      onChange={(e) => setWalkInType(e.target.value as AppointmentType)}
                      className="w-full px-3 py-2 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400"
                    >
                      {APPOINTMENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Chief Complaint / Procedure
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Broken tooth #26, toothache"
                    value={walkInReason}
                    onChange={(e) => setWalkInReason(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#233547] bg-[#16222F] text-white text-sm focus:outline-hidden focus:border-cyan-400 placeholder:text-slate-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWalkInModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-cyan-950/40 transition-all cursor-pointer"
                  >
                    Add to Roster
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clinical Note Preview Modal */}
      <AnimatePresence>
        {viewNoteItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-[#1E2E40] text-slate-100 flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#1E2E40]">
                <div>
                  <h3 className="text-base font-extrabold text-white">
                    Clinical Note: {viewNoteItem.patientName}
                  </h3>
                  <p className="text-xs text-cyan-400">{viewNoteItem.procedureText} • {viewNoteItem.time}</p>
                </div>
                <button
                  onClick={() => setViewNoteItem(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed bg-[#0E1620] p-4 rounded-xl border border-[#1E2E40] mt-3 cockpit-scrollbar">
                {formatNoteForPmsClipboard(viewNoteItem)}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#1E2E40] mt-4">
                <span className="text-xs text-slate-400">
                  Ready to paste into D4W / Praktika Notes tab
                </span>
                <button
                  onClick={() => {
                    handleCopyNote(viewNoteItem);
                    setViewNoteItem(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-all shadow-lg shadow-cyan-950/40 cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Smart Guard Verbal Consent Confirmation Popover */}
      <AnimatePresence>
        {consentGuardItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[#1E2E40] flex flex-col text-slate-100"
            >
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl shrink-0 border border-emerald-500/20">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-extrabold text-white">
                    Confirm Verbal Recording Consent
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {consentGuardItem.patientName} • {consentGuardItem.time}
                  </p>
                </div>
                <button
                  onClick={() => setConsentGuardItem(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 p-3.5 bg-[#14202D] rounded-xl border border-[#1E2E40] text-xs text-slate-300 leading-relaxed">
                <p className="font-semibold text-slate-200">
                  Confirm patient verbal consent for ambient operatory recording:
                </p>
                <p className="mt-1.5 text-cyan-300 italic">
                  "I will be using ambient voice transcription to prepare my clinical notes for your record today."
                </p>
                <div className="mt-3 pt-2.5 border-t border-[#1E2E40] flex items-center gap-1.5 text-[11px] text-slate-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Logged to internal compliance audit only. Kept out of PMS clipboard.</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-5">
                <button
                  type="button"
                  onClick={() => recordWithoutConsentTag(consentGuardItem)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-[#16222F] rounded-xl transition-colors cursor-pointer"
                >
                  Record Without Tag
                </button>
                <button
                  type="button"
                  onClick={() => confirmConsentAndRecord(consentGuardItem)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-950/40 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Confirm Consent & Record
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Side-by-Side Review & Confidence Verification Modal */}
      <AnimatePresence>
        {sideBySideItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#101923] rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-[#1E2E40] flex flex-col max-h-[90vh] text-slate-100"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#1E2E40]">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${sideBySideItem.isFullyGrounded !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                    {sideBySideItem.isFullyGrounded !== false ? (
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-white">
                        Clinical Verification: {sideBySideItem.patientName}
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold ${sideBySideItem.isFullyGrounded !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                        {sideBySideItem.isFullyGrounded !== false ? '100% Grounded in Audio' : `${sideBySideItem.groundingScore ?? 0}% Audio Grounded`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {sideBySideItem.procedureText} • {sideBySideItem.time}
                      {sideBySideItem.consentObtained && (
                        <span className="ml-2 inline-flex items-center text-emerald-400 font-medium">
                          • Verbal consent logged ✓
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSideBySideItem(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Unverified Claims Warning if any */}
              {sideBySideItem.unverifiedClaims && sideBySideItem.unverifiedClaims.length > 0 && (
                <div className="mt-3 p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300 leading-relaxed">
                    <span className="font-bold">Items not detected in verbatim speech: </span>
                    <span className="font-semibold text-amber-200">{sideBySideItem.unverifiedClaims.join(', ')}</span>
                    <p className="text-[11px] text-amber-400/80 mt-0.5">
                      Verify whether these clinical findings or treatments were performed before copying to your practice management system.
                    </p>
                  </div>
                </div>
              )}

              {/* Side-by-Side Content Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3.5 flex-1 min-h-0 overflow-hidden">
                {/* Left Column: Verbatim Spoken Dialogue */}
                <div className="flex flex-col rounded-xl border border-[#1E2E40] bg-[#14202D] p-3 min-h-0">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1E2E40] text-xs font-bold text-slate-300">
                    <span>Spoken Operatory Dialogue</span>
                    <span className="text-[11px] text-cyan-400 font-mono font-normal">Verbatim Audio</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs cockpit-scrollbar">
                    {sideBySideItem.transcript && sideBySideItem.transcript.length > 0 ? (
                      sideBySideItem.transcript.map((utt, i) => (
                        <div key={i} className="p-2 rounded-lg bg-[#0E1620] border border-[#1E2E40]">
                          <span className="font-bold text-[11px] text-cyan-400 block mb-0.5">
                            {utt.sender}:
                          </span>
                          <p className="text-slate-300 leading-relaxed font-sans">{utt.text}</p>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-slate-500 italic">
                        Live operatory audio recorded for consultation.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Synthesized Clinical Note */}
                <div className="flex flex-col rounded-xl border border-[#1E2E40] bg-[#14202D] p-3 min-h-0">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1E2E40] text-xs font-bold text-slate-300">
                    <span>Synthesized Progress Note</span>
                    <span className="text-[11px] text-cyan-400 font-mono font-normal">D4W / Praktika Format</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 bg-[#0E1620] rounded-lg border border-[#1E2E40] font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed cockpit-scrollbar">
                    {formatNoteForPmsClipboard(sideBySideItem)}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-[#1E2E40] mt-4">
                <div className="text-xs text-slate-400">
                  {sideBySideItem.consentObtained ? (
                    <span className="text-emerald-400 font-semibold">✓ Verbal Consent Recorded for Internal Audit</span>
                  ) : (
                    <span className="text-slate-500">Verbal consent tag not active</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSideBySideItem(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white rounded-xl cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      handleCopyNote(sideBySideItem);
                      setSideBySideItem(null);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-all shadow-lg shadow-cyan-950/40 cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    Approve & Copy to PMS
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
        {/* Google Gemini API Key Configuration Modal */}
        {showApiKeyModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-[#0E1622] border border-[#1E2E42] rounded-3xl p-6 max-w-lg w-full shadow-2xl relative text-left">
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Google Gemini API Key</h3>
                  <p className="text-xs text-slate-400">For direct PMS schedule OCR & ambient scribing</p>
                </div>
              </div>

              <div className="p-3.5 bg-[#14202E] border border-[#1E3048] rounded-2xl mb-4 text-xs text-slate-300 space-y-2">
                <div className="flex items-center justify-between font-bold text-white">
                  <span>How to get a free API key:</span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 underline font-medium"
                  >
                    Google AI Studio <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  1. Visit Google AI Studio and click "Create API key".<br/>
                  2. Free tier grants 15 requests per minute with zero billing or credit card required.<br/>
                  3. Key is stored strictly in your browser (<code className="text-cyan-300">localStorage</code>) and used for your practice sessions.
                </p>
              </div>

              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Gemini API Key
              </label>
              <input
                type="password"
                value={tempApiKeyInput}
                onChange={(e) => setTempApiKeyInput(e.target.value)}
                placeholder="AIzaSy... or AQ.Ab8RN..."
                className="w-full px-4 py-2.5 bg-[#090F17] border border-[#1E2E42] focus:border-cyan-400 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-hidden font-mono mb-4"
              />

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#182638]">
                {customApiKey ? (
                  <button
                    onClick={() => {
                      localStorage.removeItem('dentai_custom_gemini_key');
                      setCustomApiKey('');
                      setTempApiKeyInput('');
                      setShowApiKeyModal(false);
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                  >
                    Remove Custom Key
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500">No custom key configured</span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowApiKeyModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const cleaned = tempApiKeyInput.trim();
                      if (cleaned) {
                        localStorage.setItem('dentai_custom_gemini_key', cleaned);
                        setCustomApiKey(cleaned);
                      } else {
                        localStorage.removeItem('dentai_custom_gemini_key');
                        setCustomApiKey('');
                      }
                      setShowApiKeyModal(false);
                      if (lastUploadedFile && cleaned) {
                        handleImageFile(lastUploadedFile, cleaned);
                      }
                    }}
                    className="px-5 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-950/40 cursor-pointer active:scale-95 transition-all"
                  >
                    {lastUploadedFile ? 'Save Key & Re-parse Snip' : 'Save Key'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </CockpitLayout>
  );
}
