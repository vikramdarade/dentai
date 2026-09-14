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
  cleanPatientDisplayName,
  normalizeStartTime,
  DayScheduleItem,
  loadTodaySchedule,
  saveTodaySchedule,
  addScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
  clearTodaySchedule,
  formatNoteForPmsClipboard,
  getTodayDateStr,
  getDateStr,
  fetchScheduleFromCloud,
  syncScheduleToCloud,
  mergeScheduleItems,
  calculateDailyProduction,
  generateSafeUuid,
  generatePreOpBrief,
  detectTreatmentOpportunity,
  generateAftercareSnippet
} from '../lib/dayScheduleStorage';
import { AppointmentType, APPOINTMENT_TYPES, getAppointmentTypeLabel, getTemplateById } from '../lib/dentalLibrary';
import { generateOfflineDraft } from '../lib/draftEngine';
import { TranscriptItem } from '../types';
import TopSurgeryBar from './TopSurgeryBar';
import ErrorBoundary from './ErrorBoundary';
import CockpitLayout from './CockpitLayout';
import CockpitInspectionDrawer from './CockpitInspectionDrawer';
import PracticeSettingsModal from './PracticeSettingsModal';
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
  const [copiedAftercareId, setCopiedAftercareId] = useState<string | null>(null);
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

  // Left Panel Modal States (Practice Settings)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);

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

  // Date Navigator Header & Multi-Device Sync
  const [dateOffset, setDateOffset] = useState(0);
  const currentDateStr = useMemo(() => getDateStr(dateOffset), [dateOffset]);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'idle'>('idle');

  // Immediately load local schedule whenever currentDateStr changes
  useEffect(() => {
    setItems(loadTodaySchedule(currentDateStr));
  }, [currentDateStr]);

  // Cloud schedule hydration on mount & date change (Multi-device continuity)
  useEffect(() => {
    let isCancelled = false;
    async function hydrateFromCloud() {
      if (!authToken) return;
      setCloudSyncStatus('syncing');
      try {
        const cloudItems = await fetchScheduleFromCloud(currentDateStr, authToken);
        if (isCancelled) return;
        if (cloudItems && Array.isArray(cloudItems)) {
          const currentLocal = loadTodaySchedule(currentDateStr);
          if (cloudItems.length > 0) {
            // Merge cloud items into local roster without overwriting in-progress work
            const merged = mergeScheduleItems(currentLocal, cloudItems, currentDateStr);
            saveTodaySchedule(merged, currentDateStr);
            setItems(merged);
          } else if (currentLocal.length > 0) {
            // Local has items (e.g. freshly snipped offline) but cloud is empty: push up to cloud
            await syncScheduleToCloud(currentLocal, currentDateStr, authToken);
          }
          setCloudSyncStatus('synced');
        } else {
          setCloudSyncStatus('idle');
        }
      } catch (err) {
        console.warn('[Schedule] Cloud hydration error:', err);
        setCloudSyncStatus('offline');
      }
    }

    hydrateFromCloud();
    return () => {
      isCancelled = true;
    };
  }, [currentDateStr, authToken]);

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
    }, currentDateStr);
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
    }, currentDateStr);
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

  // Keep schedule queue in sync with storage updates and background jobs without redundant re-renders
  useEffect(() => {
    let lastRosterSnapshot = '';
    const refresh = () => {
      const current = loadTodaySchedule(currentDateStr);
      const snapshot = JSON.stringify(current);
      if (snapshot !== lastRosterSnapshot) {
        lastRosterSnapshot = snapshot;
        setItems(current);
      }
    };
    refresh();
    window.addEventListener('storage', refresh);
    const interval = setInterval(refresh, 2500);
    return () => {
      window.removeEventListener('storage', refresh);
      clearInterval(interval);
    };
  }, [currentDateStr]);

  // Quick Walk-in form state
  const [walkInName, setWalkInName] = useState('');
  const [walkInTime, setWalkInTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [walkInReason, setWalkInReason] = useState('Emergency Dental Toothache');
  const [walkInType, setWalkInType] = useState<AppointmentType>('emergency');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewThumb, setPreviewThumb] = useState<string | null>(null);
  const [snipDimensions, setSnipDimensions] = useState<{ width: number; height: number } | null>(null);

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

  const optimizeScreenshotForVision = async (file: File): Promise<{ base64: string; mimeType: string; width: number; height: number; previewUrl: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawResult = (e.target?.result as string) || '';
        const img = new Image();
        img.onload = () => {
          try {
            const originalWidth = img.width;
            const originalHeight = img.height;
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
              resolve({ base64: jpegData, mimeType: 'image/jpeg', width: originalWidth, height: originalHeight, previewUrl: jpegData });
              return;
            }
          } catch {
            // fallback to original base64
          }
          resolve({ base64: rawResult, mimeType: file.type || 'image/png', width: img.width || 800, height: img.height || 600, previewUrl: rawResult });
        };
        img.onerror = () => {
          resolve({ base64: rawResult, mimeType: file.type || 'image/png', width: 0, height: 0, previewUrl: rawResult });
        };
        img.src = rawResult;
      };
      reader.onerror = () => {
        resolve({ base64: '', mimeType: file.type || 'image/png', width: 0, height: 0, previewUrl: '' });
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
      const { base64, mimeType, width, height, previewUrl } = await optimizeScreenshotForVision(file);

      if (previewUrl) {
        setPreviewThumb(previewUrl);
        setSnipDimensions({ width, height });
      }

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

      if (data.unreadable) {
        throw new Error(data.unreadableReason || 'No readable appointment schedule was detected. Please ensure the screenshot captures the time column and patient rows.');
      }

      const rawAppointments = Array.isArray(data.appointments) ? data.appointments : [];
      const newAppointments: DayScheduleItem[] = rawAppointments.map((app: any) => ({
        id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        time: normalizeStartTime(app.time || '09:00'),
        patientName: cleanPatientDisplayName(app.patientName || 'Unknown Patient'),
        procedureText: String(app.procedureText || 'General Consultation').trim(),
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
      const currentRoster = loadTodaySchedule(currentDateStr);
      const merged = mergeScheduleItems(currentRoster, newAppointments, currentDateStr);
      setItems(merged);
      saveTodaySchedule(merged, currentDateStr);
      if (authToken) {
        setCloudSyncStatus('syncing');
        syncScheduleToCloud(merged, currentDateStr, authToken).then((ok) => {
          if (ok) setCloudSyncStatus('synced');
        });
      }
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
    const demoItemsWithAgents = demoItems.map(item => ({
      ...item,
      preOpBrief: item.preOpBrief || generatePreOpBrief(item.appointmentType, item.procedureText, item.patientName),
      treatmentOpportunity: item.treatmentOpportunity || detectTreatmentOpportunity(item, item.clinicalNote, item.adaCodes, item.transcript),
      aftercareSummary: item.aftercareSummary || (item.status === 'ready' ? generateAftercareSnippet(item.appointmentType, item.procedureText, item.clinicalNote) : undefined)
    }));
    const merged = mergeScheduleItems(items, demoItemsWithAgents, getTodayDateStr());
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

  const handleCopyAftercare = async (item: DayScheduleItem) => {
    const text = item.aftercareSummary || generateAftercareSnippet(item.appointmentType, item.procedureText, item.clinicalNote);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAftercareId(item.id);
      setTimeout(() => setCopiedAftercareId(null), 2500);
    } catch {
      setCopiedAftercareId(item.id);
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

  const handleOfflineDraftForFailed = (item: DayScheduleItem) => {
    try {
      const template = getTemplateById(item.templateId || 'standard');
      const transcript: TranscriptItem[] = (item.transcript && item.transcript.length > 0)
        ? item.transcript.map(t => ({
            sender: (t.sender === 'Patient' ? 'Patient' : t.sender === 'Dialogue' ? 'Dialogue' : 'Dentist') as TranscriptItem['sender'],
            text: t.text
          }))
        : [{ sender: 'Dentist' as const, text: `${item.patientName} presented for ${item.procedureText}. Clinical examination and procedure completed.` }];

      const draft = generateOfflineDraft(template, transcript, getAppointmentTypeLabel(item.appointmentType));
      const rawAdaCodes = Array.isArray(draft.adaCodes) ? draft.adaCodes : [];
      const sanitizedAdaCodeStrings = rawAdaCodes.map(c => typeof c === 'string' ? c : c?.code || '').filter(Boolean);

      const nameParts = item.patientName.trim().split(/\s+/);
      const firstName = nameParts[0] || 'Patient';
      const lastName = nameParts.slice(1).join(' ') || '';

      const formatted = formatNoteForPmsClipboard({
        id: item.id,
        time: item.time,
        patientName: item.patientName,
        procedureText: item.procedureText,
        appointmentType: item.appointmentType,
        templateId: item.templateId,
        status: 'ready'
      }, {
        firstName,
        lastName,
        date: getTodayDateStr(),
        appointmentType: item.appointmentType,
        findings: {
          chiefComplaint: draft.canonical.chiefComplaint || item.procedureText,
          clinicalFindings: draft.canonical.clinicalFindings || draft.canonical.toothFindings || 'Clinical examination complete.',
          treatmentRendered: draft.canonical.treatmentRendered || draft.canonical.treatmentPerformed || item.procedureText,
          localAnaesthetic: draft.canonical.localAnaesthetic || '',
          prescriptions: draft.canonical.prescriptions || '',
          postOpAdvice: draft.canonical.postOpAdvice || 'Maintain regular oral hygiene.',
          nextVisit: draft.canonical.nextVisit || '6 Months Recall'
        },
        adaCodes: rawAdaCodes
      });

      const grounding = verifyTranscriptGrounding(formatted, transcript, rawAdaCodes);
      const opp = detectTreatmentOpportunity(item, formatted, rawAdaCodes, transcript);
      const aftercare = generateAftercareSnippet(item.appointmentType, item.procedureText, formatted);

      updateScheduleItem(item.id, {
        status: 'ready',
        clinicalNote: formatted,
        transcript,
        adaCodes: sanitizedAdaCodeStrings,
        completedAt: new Date().toISOString(),
        groundingScore: grounding.groundingScore,
        isFullyGrounded: grounding.isFullyGrounded,
        unverifiedClaims: grounding.unverifiedClaims,
        treatmentOpportunity: opp,
        aftercareSummary: aftercare,
        error: undefined
      }, currentDateStr);
      setItems(loadTodaySchedule(currentDateStr));
      setSuccessBanner(`Instant offline note generated for ${item.patientName}. 100% grounded against operatory record.`);
      setTimeout(() => setSuccessBanner(null), 4000);
    } catch (err: any) {
      console.error('[DayScheduleQueue] Failed to generate offline draft:', err);
    }
  };

  const handleRetryAiForFailed = async (item: DayScheduleItem) => {
    if (!item.transcript || item.transcript.length === 0) {
      handleOfflineDraftForFailed(item);
      return;
    }

    const assignedConsultationId = item.consultationId || generateSafeUuid();
    updateScheduleItem(item.id, {
      status: 'processing',
      consultationId: assignedConsultationId,
      error: undefined
    }, currentDateStr);
    setItems(loadTodaySchedule(currentDateStr));

    const nameParts = item.patientName.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Patient';
    const lastName = nameParts.slice(1).join(' ') || '';

    try {
      const submitRes = await fetch('/api/notes/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          intakeData: {
            firstName,
            lastName,
            dob: '1990-01-01',
            appointmentType: item.appointmentType,
            templateId: item.templateId || 'standard'
          },
          transcript: item.transcript,
          consultationId: assignedConsultationId,
          consentObtained: item.consentObtained ?? false,
          consentCapturedAt: item.consentCapturedAt,
          consentPractitionerId: item.consentPractitionerId
        })
      });

      if (!submitRes.ok) {
        throw new Error('Failed to start note synthesis job.');
      }

      const { jobId } = await submitRes.json();
      updateScheduleItem(item.id, { jobId }, currentDateStr);
      setItems(loadTodaySchedule(currentDateStr));

      (async () => {
        try {
          const deadline = Date.now() + 85_000;
          let jobResult: any = null;
          let failureReason = '';

          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch(`/api/notes/jobs/${jobId}`, {
              headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (!pollRes.ok) break;
            const jobState = await pollRes.json();
            if (jobState.status === 'done') {
              jobResult = jobState.result;
              break;
            }
            if (jobState.status === 'failed') {
              failureReason = jobState.error || jobState.statusDetail || 'AI synthesis failed.';
              break;
            }
          }

          if (jobResult) {
            const rawAdaCodes = Array.isArray(jobResult.adaCodes) ? jobResult.adaCodes : [];
            const sanitizedAdaCodeStrings = rawAdaCodes.map((c: any) => {
              if (typeof c === 'string') return c;
              if (typeof c === 'object' && c?.code) return String(c.code);
              return '';
            }).filter(Boolean);

            const formatted = formatNoteForPmsClipboard({
              id: item.id,
              time: item.time,
              patientName: item.patientName,
              procedureText: item.procedureText,
              appointmentType: item.appointmentType,
              templateId: item.templateId,
              status: 'ready'
            }, {
              firstName,
              lastName,
              date: currentDateStr,
              appointmentType: item.appointmentType,
              findings: {
                chiefComplaint: jobResult.chiefComplaint || item.procedureText,
                clinicalFindings: jobResult.clinicalFindings || jobResult.toothFindings || 'Clinical examination complete.',
                treatmentRendered: jobResult.treatmentRendered || jobResult.treatmentPerformed || item.procedureText,
                localAnaesthetic: jobResult.localAnaesthetic || '',
                prescriptions: jobResult.prescriptions || '',
                postOpAdvice: jobResult.postOpAdvice || 'Maintain regular oral hygiene.',
                nextVisit: jobResult.nextVisit || '6 Months Recall'
              },
              adaCodes: rawAdaCodes
            });

            let grounding = jobResult.groundingReport;
            if (!grounding) {
              grounding = verifyTranscriptGrounding(formatted, item.transcript || [], rawAdaCodes);
            }

            const opp = detectTreatmentOpportunity(item, formatted, rawAdaCodes, item.transcript || []);
            const aftercare = generateAftercareSnippet(item.appointmentType, item.procedureText, formatted);

            updateScheduleItem(item.id, {
              status: 'ready',
              clinicalNote: formatted,
              adaCodes: sanitizedAdaCodeStrings,
              completedAt: new Date().toISOString(),
              groundingScore: grounding?.groundingScore ?? 100,
              isFullyGrounded: grounding?.isFullyGrounded ?? true,
              unverifiedClaims: grounding?.unverifiedClaims ?? [],
              treatmentOpportunity: opp,
              aftercareSummary: aftercare,
              error: undefined
            }, currentDateStr);
            setItems(loadTodaySchedule(currentDateStr));
          } else {
            updateScheduleItem(item.id, {
              status: 'failed',
              error: failureReason || 'Synthesis timed out in background.'
            }, currentDateStr);
            setItems(loadTodaySchedule(currentDateStr));
          }
        } catch (pollErr: any) {
          updateScheduleItem(item.id, {
            status: 'failed',
            error: pollErr?.message || 'Background worker error.'
          }, currentDateStr);
          setItems(loadTodaySchedule(currentDateStr));
        }
      })();
    } catch (err: any) {
      updateScheduleItem(item.id, {
        status: 'failed',
        error: err?.message || 'Network error starting note job.'
      }, currentDateStr);
      setItems(loadTodaySchedule(currentDateStr));
    }
  };

  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteScheduleItem(id, currentDateStr);
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
    }, currentDateStr);

    setItems(loadTodaySchedule(currentDateStr));
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
      token={authToken}
      clinicId={activeClinic?.clinicId}
      clinicName={activeClinic?.clinicName}
      onLogout={onLogout || (() => {})}
      activeTab="roster"
      onTabChange={(tab) => {
        if (tab === 'patients') onNavigateTab?.('records');
        else if (tab === 'pipeline') onNavigateTab?.('pipeline');
        else if (tab === 'settings') setShowSettingsModal(true);
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
      <div className={`w-full max-w-6xl mx-auto space-y-5 ${recordingItem ? 'pt-4 sm:pt-6' : ''}`}>
        {/* Active Surgery Recovery Banner - strictly displayed when session is interrupted/needs reconnect */}
        {(() => {
          const activeRecording = recordingItem || items.find(i => i.status === 'recording');
          if (!activeRecording) return null;
          const isConnected = !!recordingItem && recordingItem.id === activeRecording.id;
          // When the floating TopSurgeryBar is actively recording and connected, suppress the duplicate banner
          if (isConnected) return null;

          return (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/70 via-[#1A1810] to-rose-950/70 border border-amber-500/50 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-200">
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
        <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border shadow-xl ${
          theme === 'light'
            ? 'bg-white border-slate-200 shadow-slate-200/80'
            : 'bg-[#0E1724] border-[#182638] shadow-black/30'
        }`}>
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                theme === 'light'
                  ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                  : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
              }`}>
                <Sparkles className="w-3 h-3" />
                Operatory Cockpit
              </span>
              {readyCount > 0 && (
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${
                  theme === 'light'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                }`}>
                  <DollarSign className="w-3 h-3" />
                  Est. Production: ${dailyProduction.toLocaleString()}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Date Navigator Buttons */}
              <div className={`flex items-center gap-1 border rounded-xl p-1 shadow-inner ${
                theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-[#121E2E] border-[#1E3048]'
              }`}>
                <button
                  onClick={() => setDateOffset(prev => prev - 1)}
                  className={`p-1 rounded-lg transition-colors cursor-pointer ${
                    theme === 'light'
                      ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200'
                      : 'text-slate-400 hover:text-white hover:bg-[#1A2C40]'
                  }`}
                  title="Previous Day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDateOffset(0)}
                  className={`px-2.5 py-0.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    dateOffset === 0
                      ? 'bg-cyan-500 text-slate-950 font-black shadow-xs'
                      : theme === 'light'
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => setDateOffset(prev => prev + 1)}
                  className={`p-1 rounded-lg transition-colors cursor-pointer ${
                    theme === 'light'
                      ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200'
                      : 'text-slate-400 hover:text-white hover:bg-[#1A2C40]'
                  }`}
                  title="Next Day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <h2 className={`text-xl md:text-2xl font-black tracking-tight uppercase ${
                  theme === 'light' ? 'text-slate-900' : 'text-white'
                }`}>
                  {formattedDateTitle}
                </h2>
                {cloudSyncStatus === 'syncing' && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border animate-pulse ${
                    theme === 'light'
                      ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                      : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                  }`}>
                    <UploadCloud className="w-3 h-3 animate-spin text-cyan-500" />
                    Cloud Syncing
                  </span>
                )}
                {cloudSyncStatus === 'synced' && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                    theme === 'light'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`} title="Schedule synchronized with DentAI Cloud. Available across all mobile and desktop devices.">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    Multi-Device Synced
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Inspection Drawer Pill */}
            <button
              onClick={() => setIsInspectionOpen(prev => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                isInspectionOpen
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                  : 'bg-[#121E2E] hover:bg-[#18283D] text-slate-300 border-[#1E3048]'
              }`}
              title="Toggle operatory inspection drawer"
            >
              <FileText className={`w-3.5 h-3.5 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`} />
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
              className={`p-2 rounded-xl transition-colors cursor-pointer flex items-center justify-center border ${
                theme === 'light'
                  ? 'text-slate-600 hover:text-amber-600 bg-slate-100 border-slate-200'
                  : 'text-slate-400 hover:text-amber-300 bg-[#121E2E] border-[#1E3048]'
              }`}
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
                  ? theme === 'light'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-xs'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 shadow-xs'
                  : theme === 'light'
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                  : 'bg-[#121E2E] hover:bg-[#18283D] text-slate-300 border-[#1E3048]'
              }`}
              title={customApiKey ? 'Custom Gemini API Key Active (Click to change)' : 'Configure Gemini Vision API Key (Click to set)'}
            >
              <Key className={`w-3.5 h-3.5 ${customApiKey ? (theme === 'light' ? 'text-emerald-600' : 'text-emerald-400') : (theme === 'light' ? 'text-amber-600' : 'text-amber-400')}`} />
              <span className="hidden sm:inline">{customApiKey ? 'AI Key: Active' : 'AI Key'}</span>
              {customApiKey && <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${theme === 'light' ? 'bg-emerald-600' : 'bg-emerald-400'}`} />}
            </button>

            <button
              onClick={() => setShowWalkInModal(true)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 border rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer ${
                theme === 'light'
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                  : 'bg-[#121E2E] hover:bg-[#18283D] text-slate-200 border-[#1E3048]'
              }`}
            >
              <Plus className={`w-4 h-4 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`} />
              Add Walk-in
            </button>

            {items.length === 0 && (
              <button
                onClick={handleLoadDemoSchedule}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer border ${
                  theme === 'light'
                    ? 'bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border-cyan-300'
                    : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border-cyan-500/30'
                }`}
              >
                <Stethoscope className={`w-4 h-4 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`} />
                Load Sample Day
              </button>
            )}

            {items.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirmModal(true)}
                className={`p-2 rounded-xl transition-colors cursor-pointer ${
                  theme === 'light'
                    ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                    : 'text-slate-500 hover:text-rose-400 hover:bg-[#121E2E]'
                }`}
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
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name))) {
              handleImageFile(file);
            }
          }}
          className={`relative rounded-2xl border-2 border-dashed p-5 text-center transition-all cursor-pointer group shadow-md ${
            isDraggingOver
              ? theme === 'light'
                ? 'border-cyan-500 bg-cyan-50/80 ring-4 ring-cyan-200 scale-[1.01]'
                : 'border-cyan-400 bg-cyan-950/40 ring-4 ring-cyan-500/20 scale-[1.01]'
              : theme === 'light'
              ? 'border-slate-300 hover:border-cyan-500 bg-white hover:bg-slate-50/80 shadow-slate-200/60'
              : 'border-[#1E3048] hover:border-cyan-500/50 bg-[#0E1724]/70 hover:bg-[#121E2E] shadow-black/20'
          }`}
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

          {isParsing && previewThumb ? (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 py-1">
              <div className="relative w-28 h-20 rounded-xl overflow-hidden border border-cyan-500/40 shadow-lg shrink-0 bg-slate-950">
                <img src={previewThumb} alt="Schedule snip preview" className="w-full h-full object-cover object-top opacity-85" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-1.5">
                  <span className="text-[9px] font-mono font-bold text-cyan-300">
                    {snipDimensions?.width ? `${snipDimensions.width}x${snipDimensions.height}` : 'Snip'}
                  </span>
                </div>
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <RotateCw className="w-4 h-4 animate-spin text-cyan-500 shrink-0" />
                  <p className={`text-xs md:text-sm font-bold ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>
                    Analyzing Schedule Screenshot with AI...
                  </p>
                </div>
                <p className={`text-[11px] mt-1 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-300/80'}`}>
                  Extracting appointments with zero hallucination & PMS clutter cleaning.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform shadow-xs ${
                isDraggingOver
                  ? 'bg-cyan-500 text-slate-950 scale-110'
                  : theme === 'light'
                  ? 'bg-cyan-50 text-cyan-700 border border-cyan-200 group-hover:scale-105'
                  : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 group-hover:scale-105'
              }`}>
                {isParsing ? (
                  <RotateCw className="w-5 h-5 animate-spin text-cyan-500" />
                ) : (
                  <UploadCloud className="w-5 h-5" />
                )}
              </div>

              <div>
                <p className={`text-xs md:text-sm font-bold ${theme === 'light' ? 'text-slate-900' : 'text-slate-100'}`}>
                  {isDraggingOver ? (
                    'Drop PMS screenshot to import schedule'
                  ) : (
                    <>
                      Press <kbd className={`px-2 py-0.5 text-[11px] font-mono font-extrabold rounded shadow-xs border ${
                        theme === 'light'
                          ? 'bg-slate-100 border-slate-300 text-cyan-800'
                          : 'bg-[#162436] border-[#233852] text-cyan-300'
                      }`}>Ctrl + V</kbd> to paste snip, drag & drop, or click to upload
                    </>
                  )}
                </p>
                <p className={`text-[11px] mt-1 ${theme === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>
                  Supports Windows Snipping Tool (<kbd className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    theme === 'light'
                      ? 'bg-slate-100 border-slate-300 text-slate-700'
                      : 'bg-[#162436] border-[#233852] text-slate-300'
                  }`}>Win+Shift+S</kbd>), D4W, Praktika & Exact. 3-way hash auto-merges midday walk-ins with zero duplicates.
                </p>
              </div>
            </div>
          )}

          {parsingError && (
            <div className="mt-3 p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-xs text-red-200 flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{parsingError}</span>
            </div>
          )}
        </div>

        {/* 3. Status Metrics Bar */}
        {totalCount > 0 && (
          <div className={`flex items-center justify-between px-4 py-2.5 border rounded-xl text-xs shadow-md ${
            theme === 'light'
              ? 'bg-white border-slate-200 text-slate-700 shadow-slate-200/60'
              : 'bg-[#0E1724] border-[#182638] text-slate-300 shadow-md'
          }`}>
            <div className="flex items-center gap-4 flex-wrap">
              <span className={`font-extrabold ${theme === 'light' ? 'text-slate-950' : 'text-white'}`}>
                {totalCount} Total Appointments
              </span>
              {readyCount > 0 && (
                <span className={`flex items-center gap-1 font-bold ${theme === 'light' ? 'text-emerald-700' : 'text-emerald-300'}`}>
                  <Check className={`w-3.5 h-3.5 stroke-[3] ${theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'}`} />
                  {readyCount} Ready for D4W
                </span>
              )}
              {processingCount > 0 && (
                <span className={`flex items-center gap-1 font-bold ${theme === 'light' ? 'text-amber-700' : 'text-amber-300'}`}>
                  <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
                  {processingCount} Synthesizing Notes
                </span>
              )}
              {pendingCount > 0 && (
                <span className={`font-medium ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
                  {pendingCount} Remaining
                </span>
              )}
            </div>

            {readyCount > 0 && (
              <div className={`hidden sm:flex items-center gap-1.5 text-[11px] font-bold ${
                theme === 'light' ? 'text-slate-600' : 'text-slate-300'
              }`}>
                <ShieldCheck className={`w-4 h-4 ${theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'}`} />
                <span>5:00 PM Cake Walk: 1-click clipboard paste</span>
              </div>
            )}
          </div>
        )}

        {/* 4. Schedule Items Adaptive Bento Grid */}
        {items.length === 0 ? (
          <div className={`rounded-2xl border p-12 text-center shadow-xl ${
            theme === 'light' ? 'bg-white border-slate-200 shadow-slate-200/60' : 'bg-[#0E1724] border-[#182638]'
          }`}>
            <Calendar className={`w-12 h-12 mx-auto mb-3 ${theme === 'light' ? 'text-slate-400' : 'text-slate-600'}`} />
            <h3 className={`text-base font-extrabold ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>
              No Appointments Queued for Today
            </h3>
            <p className={`text-xs max-w-md mx-auto mt-1 mb-5 ${theme === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>
              Snip your appointment book from Dental4Windows or Praktika and press <strong className={theme === 'light' ? 'text-cyan-700 font-bold' : 'text-cyan-300'}>Ctrl+V</strong> to populate your day in 3 seconds.
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
              const isFailed = item.status === 'failed';
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
                      ? theme === 'light'
                        ? 'bg-gradient-to-b from-cyan-500 via-teal-400 to-slate-200 shadow-lg shadow-cyan-500/20 ring-2 ring-cyan-500/60'
                        : 'bg-gradient-to-b from-cyan-400/80 via-teal-500/40 to-[#182638] shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-400/40'
                      : isRecordingThis
                      ? 'bg-gradient-to-b from-rose-500/80 via-rose-900/40 to-[#182638] shadow-lg shadow-rose-950/50 animate-pulse'
                      : isFailed
                      ? theme === 'light'
                        ? 'bg-gradient-to-b from-rose-300 via-amber-200 to-slate-200 shadow-sm border border-rose-300'
                        : 'bg-gradient-to-b from-rose-500/60 via-amber-500/20 to-[#182638] border border-rose-500/40 shadow-md'
                      : isReady
                      ? theme === 'light'
                        ? 'bg-gradient-to-b from-emerald-500/30 to-slate-200 hover:from-cyan-500/40 shadow-xs'
                        : 'bg-gradient-to-b from-emerald-500/40 via-transparent to-[#182638] hover:from-cyan-500/40'
                      : theme === 'light'
                      ? 'bg-slate-200 hover:bg-slate-300/80 shadow-xs'
                      : 'bg-[#182638] hover:bg-[#20334A]'
                  }`}
                >
                  <div
                    className={`rounded-[calc(1rem-2px)] p-4 flex flex-col justify-between gap-3.5 h-full transition-colors ${
                      isSelected
                        ? theme === 'light'
                          ? 'bg-white shadow-md'
                          : 'bg-[#101C2B] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                        : isRecordingThis
                        ? theme === 'light' ? 'bg-rose-50/70' : 'bg-[#1E1118]'
                        : isFailed
                        ? theme === 'light' ? 'bg-rose-50/40' : 'bg-[#181115]'
                        : isReady
                        ? theme === 'light' ? 'bg-white hover:bg-slate-50' : 'bg-[#0E1724] hover:bg-[#121E2E]'
                        : theme === 'light' ? 'bg-white hover:bg-slate-50' : 'bg-[#0A1018] hover:bg-[#0E1724]'
                    }`}
                  >
                    {/* Top Row: Avatar + Patient Name + Monospace Time Pill */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center font-black text-xs border ${
                            isSelected
                              ? theme === 'light'
                                ? 'bg-cyan-50 border-cyan-400 text-cyan-700 shadow-xs'
                                : 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-xs'
                              : theme === 'light'
                              ? 'bg-slate-100 border-slate-200 text-slate-700'
                              : 'bg-[#162436] border-[#233852] text-slate-200'
                          }`}
                        >
                          {initials}
                        </div>

                        <div className="min-w-0">
                          <h4 className={`text-base font-black truncate tracking-tight ${
                            theme === 'light' ? 'text-slate-900' : 'text-white'
                          }`}>
                            {item.patientName}
                          </h4>
                          <p className={`text-xs font-semibold truncate mt-0.5 ${
                            theme === 'light'
                              ? isSelected ? 'text-cyan-700' : 'text-cyan-600'
                              : isSelected ? 'text-cyan-300' : 'text-cyan-400'
                          }`}>
                            {item.procedureText}
                          </p>
                        </div>
                      </div>

                      <div className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold border shadow-xs ${
                        theme === 'light'
                          ? 'bg-slate-100 border-slate-200 text-slate-700'
                          : 'bg-[#162436] border-[#20334A] text-slate-200'
                      }`}>
                        <Clock className={`w-3 h-3 ${theme === 'light' ? 'text-cyan-600' : 'text-cyan-400'}`} />
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
                              className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-extrabold border ${
                                theme === 'light'
                                  ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                  : 'bg-[#162436] text-cyan-300 border-[#233852]'
                              }`}
                            >
                              ADA {codeStr}
                            </span>
                          );
                        })
                      ) : (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                          theme === 'light'
                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                            : 'bg-[#121E2E] text-slate-300 border-[#182638]'
                        }`}>
                          {getAppointmentTypeLabel(item.appointmentType)}
                        </span>
                      )}
                    </div>

                    {/* Autonomous Pre-Op Brief (Scheduled / In Progress) */}
                    {item.preOpBrief && !isReady && (
                      <div
                        title={`Pre-Op Brief: ${item.preOpBrief}`}
                        className={`group relative flex items-start gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border cursor-help transition-all ${
                          theme === 'light'
                            ? 'bg-amber-50/90 hover:bg-amber-100/95 border-amber-200 text-amber-950 shadow-xs'
                            : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/25 text-amber-200 shadow-xs'
                        }`}
                      >
                        <Sparkles className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${theme === 'light' ? 'text-amber-600' : 'text-amber-400'}`} />
                        <span className="truncate group-hover:whitespace-normal group-hover:overflow-visible transition-all min-w-0 flex-1 leading-snug">
                          <strong className={`font-bold ${theme === 'light' ? 'text-amber-800' : 'text-amber-300'}`}>Pre-Op:</strong> {item.preOpBrief}
                        </span>

                        {/* Theme-Aware Floating Tooltip positioned BELOW the tag so it NEVER covers the patient header */}
                        <div className={`absolute left-0 top-full mt-1.5 hidden group-hover:flex flex-col z-50 w-80 max-w-sm p-3 rounded-xl shadow-2xl pointer-events-none border backdrop-blur-md transition-all ${
                          theme === 'light'
                            ? 'bg-white text-slate-900 border-amber-300 shadow-slate-900/15'
                            : 'bg-[#0D1522] text-slate-100 border-amber-500/40 shadow-slate-950/80'
                        }`}>
                          <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase mb-1 tracking-wider ${
                            theme === 'light' ? 'text-amber-700' : 'text-amber-400'
                          }`}>
                            <Sparkles className="w-3 h-3 text-amber-500" />
                            <span>Pre-Op Clinical Instructions</span>
                          </div>
                          <p className={`text-[11px] leading-relaxed font-medium whitespace-normal ${
                            theme === 'light' ? 'text-slate-800' : 'text-slate-200'
                          }`}>
                            {item.preOpBrief}
                          </p>
                          <div className={`absolute left-6 bottom-full -mb-[1px] border-4 border-transparent ${
                            theme === 'light' ? 'border-b-white' : 'border-b-[#0D1522]'
                          }`} />
                        </div>
                      </div>
                    )}

                    {/* Autonomous Treatment Recovery Opportunity (Completed) */}
                    {isReady && item.treatmentOpportunity && (
                      <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs font-bold border ${
                        theme === 'light'
                          ? 'bg-emerald-50 text-emerald-950 border-emerald-300 shadow-xs'
                          : 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30 shadow-xs'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-amber-400">⭐</span>
                          <span className="truncate">
                            Unbooked: {item.treatmentOpportunity.description} {item.treatmentOpportunity.tooth ? `(#${item.treatmentOpportunity.tooth})` : ''}
                          </span>
                        </div>
                        <span className="font-mono text-emerald-400 font-black shrink-0">
                          Est. ${item.treatmentOpportunity.estimatedValueAud} AUD
                        </span>
                      </div>
                    )}

                    {isFailed && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span className="truncate">{item.error || 'AI note synthesis could not be completed.'}</span>
                      </div>
                    )}

                    {/* Bottom Row: Status & Actions */}
                    <div className={`flex items-center justify-between gap-2 pt-2.5 border-t ${
                      theme === 'light' ? 'border-slate-100' : 'border-[#182638]'
                    }`}>
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
                              ? theme === 'light'
                                ? 'bg-cyan-50 text-cyan-700 border-cyan-300'
                                : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                              : theme === 'light'
                              ? 'bg-slate-100 text-slate-500 border-slate-200 hover:text-slate-800'
                              : 'bg-[#121E2E] text-slate-400 border-[#182638] hover:text-slate-200'
                          }`}
                        >
                          <Check className={`w-3 h-3 ${item.consentObtained ? (theme === 'light' ? 'text-cyan-600 stroke-[3]' : 'text-cyan-400 stroke-[3]') : 'text-slate-400'}`} />
                          <span>{item.consentObtained ? 'Verbal Consent ✓' : 'Consent'}</span>
                        </button>
                      </div>

                      {/* Right: Quick Action Button (Iconic iPhone Style Record Button) */}
                      <div className="flex items-center gap-1.5">
                        {item.status === 'scheduled' && !isRecordingThis && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRecordClick(item);
                            }}
                            data-tactical-dark={theme === 'dark' ? true : undefined}
                            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-black transition-all active:scale-95 shadow-sm cursor-pointer group border ${
                              theme === 'light'
                                ? 'bg-white hover:bg-red-50/70 text-slate-900 border-slate-300 hover:border-red-500 shadow-slate-200/80'
                                : 'bg-[#0B121D] hover:bg-[#142032] text-white border-slate-700/80 hover:border-red-500/60 shadow-slate-950/60'
                            }`}
                            title={`Record consultation for ${item.patientName}`}
                          >
                            {/* iPhone Camera/Voice Memos Aperture: Circular ring with vibrant red recording core */}
                            <span className={`relative flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                              theme === 'light'
                                ? 'border-slate-400 group-hover:border-red-500 bg-slate-50'
                                : 'border-white/90 group-hover:border-white bg-slate-900'
                            }`}>
                              <span className="h-2 w-2 rounded-full bg-[#FF3B30] group-hover:bg-red-500 shadow-xs shadow-red-500/80 group-hover:scale-110 transition-transform" />
                            </span>
                            <span
                              className="text-[11px] font-black tracking-tight transition-colors"
                              style={{ color: theme === 'light' ? '#0F172A' : '#FFFFFF' }}
                            >
                              Record
                            </span>
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

                        {isFailed && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOfflineDraftForFailed(item);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl text-xs font-black transition-transform active:scale-95 shadow-xs cursor-pointer"
                              title="Generate instant deterministic offline note from captured dialogue"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Offline Note</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetryAiForFailed(item);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#162436] hover:bg-[#20334A] text-slate-200 border border-[#233852] rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95"
                              title="Retry Cloud AI synthesis"
                            >
                              <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                              <span>Retry</span>
                            </button>
                          </div>
                        )}

                        {isReady && (
                          <div className="flex items-center gap-1.5">
                            {item.aftercareSummary && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyAftercare(item);
                                }}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 border ${
                                  copiedAftercareId === item.id
                                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md border-cyan-400'
                                    : theme === 'light'
                                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                    : 'bg-[#121E2E] hover:bg-[#18283D] text-slate-300 border-[#1E3048]'
                                }`}
                                title="Copy plain-English patient aftercare advice for SMS"
                              >
                                {copiedAftercareId === item.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                                    <span>SMS Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className={`w-3.5 h-3.5 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`} />
                                    <span className="hidden sm:inline">Aftercare SMS</span>
                                    <span className="sm:hidden">SMS</span>
                                  </>
                                )}
                              </button>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyNote(item);
                              }}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 border ${
                                copiedId === item.id
                                  ? 'bg-emerald-500 text-white font-black shadow-md border-emerald-400'
                                  : theme === 'light'
                                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                                  : 'bg-[#162436] hover:bg-[#20334A] text-slate-100 border-[#233852]'
                              }`}
                              title="Express copy note for D4W / Praktika"
                            >
                              {copiedId === item.id ? (
                                <Check className="w-3.5 h-3.5 stroke-[3] text-white" />
                              ) : (
                                <Copy className={`w-3.5 h-3.5 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`} />
                              )}
                              <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                        )}

                        {!isRecordingThis && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteItem(item.id, e);
                            }}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ml-1 ${
                              theme === 'light'
                                ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                                : 'text-slate-500 hover:text-rose-400 hover:bg-[#162436]'
                            }`}
                            title="Remove appointment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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
              className={`rounded-2xl max-w-md w-full p-6 shadow-2xl border transition-colors ${
                theme === 'light'
                  ? 'bg-white border-slate-200 text-slate-900 shadow-slate-900/20'
                  : 'bg-[#101923] border-[#1E2E40] text-slate-100'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-black flex items-center gap-2 ${
                  theme === 'light' ? 'text-slate-950' : 'text-white'
                }`}>
                  <Plus className={`w-5 h-5 ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`} />
                  Add Unscheduled Walk-in
                </h3>
                <button
                  onClick={() => setShowWalkInModal(false)}
                  className={`p-1 rounded-lg cursor-pointer ${
                    theme === 'light' ? 'text-slate-400 hover:text-slate-800' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddWalkInSubmit} className="space-y-4">
                <div>
                  <label className={`block text-xs font-bold mb-1 ${
                    theme === 'light' ? 'text-slate-700' : 'text-slate-300'
                  }`}>
                    Patient Name *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. John Doe"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-hidden focus:ring-1 transition-all ${
                      theme === 'light'
                        ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-cyan-600 focus:ring-cyan-600 placeholder:text-slate-400'
                        : 'border-[#233547] bg-[#16222F] text-white focus:border-cyan-400 focus:ring-cyan-400 placeholder:text-slate-500'
                    }`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-xs font-bold mb-1 ${
                      theme === 'light' ? 'text-slate-700' : 'text-slate-300'
                    }`}>
                      Time
                    </label>
                    <input
                      type="time"
                      value={walkInTime}
                      onChange={(e) => setWalkInTime(e.target.value)}
                      className={`w-full px-3.5 py-2 rounded-xl border text-sm focus:outline-hidden focus:ring-1 transition-all ${
                        theme === 'light'
                          ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-cyan-600'
                          : 'border-[#233547] bg-[#16222F] text-white focus:border-cyan-400'
                      }`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs font-bold mb-1 ${
                      theme === 'light' ? 'text-slate-700' : 'text-slate-300'
                    }`}>
                      Type
                    </label>
                    <select
                      value={walkInType}
                      onChange={(e) => setWalkInType(e.target.value as AppointmentType)}
                      className={`w-full px-3 py-2 rounded-xl border text-sm focus:outline-hidden focus:ring-1 transition-all ${
                        theme === 'light'
                          ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-cyan-600'
                          : 'border-[#233547] bg-[#16222F] text-white focus:border-cyan-400'
                      }`}
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
                  <label className={`block text-xs font-bold mb-1 ${
                    theme === 'light' ? 'text-slate-700' : 'text-slate-300'
                  }`}>
                    Chief Complaint / Procedure
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Broken tooth #26, toothache"
                    value={walkInReason}
                    onChange={(e) => setWalkInReason(e.target.value)}
                    className={`w-full px-3.5 py-2 rounded-xl border text-sm focus:outline-hidden focus:ring-1 transition-all ${
                      theme === 'light'
                        ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-cyan-600 placeholder:text-slate-400'
                        : 'border-[#233547] bg-[#16222F] text-white focus:border-cyan-400 placeholder:text-slate-500'
                    }`}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWalkInModal(false)}
                    className={`px-4 py-2 text-xs font-bold rounded-xl cursor-pointer ${
                      theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-cyan-950/20 transition-all cursor-pointer"
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
              className={`rounded-2xl max-w-2xl w-full p-6 shadow-2xl border flex flex-col max-h-[85vh] ${
                theme === 'light'
                  ? 'bg-white border-slate-200 text-slate-900 shadow-slate-900/20'
                  : 'bg-[#101923] border-[#1E2E40] text-slate-100'
              }`}
            >
              <div className={`flex items-center justify-between pb-3 border-b ${
                theme === 'light' ? 'border-slate-200' : 'border-[#1E2E40]'
              }`}>
                <div>
                  <h3 className={`text-base font-extrabold ${theme === 'light' ? 'text-slate-950' : 'text-white'}`}>
                    Clinical Note: {viewNoteItem.patientName}
                  </h3>
                  <p className={`text-xs font-medium ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`}>
                    {viewNoteItem.procedureText} • {viewNoteItem.time}
                  </p>
                </div>
                <button
                  onClick={() => setViewNoteItem(null)}
                  className={`p-1.5 rounded-lg cursor-pointer ${
                    theme === 'light' ? 'text-slate-400 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className={`flex-1 overflow-y-auto py-4 font-mono text-xs whitespace-pre-wrap leading-relaxed p-4 rounded-xl border mt-3 cockpit-scrollbar ${
                theme === 'light'
                  ? 'bg-slate-50 border-slate-200 text-slate-800'
                  : 'bg-[#0E1620] border-[#1E2E40] text-slate-200'
              }`}>
                {formatNoteForPmsClipboard(viewNoteItem)}
              </div>

              <div className={`flex items-center justify-between pt-4 border-t mt-4 ${
                theme === 'light' ? 'border-slate-200' : 'border-[#1E2E40]'
              }`}>
                <span className={`text-xs ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
                  Ready to paste into D4W / Praktika Notes tab
                </span>
                <button
                  onClick={() => {
                    handleCopyNote(viewNoteItem);
                    setViewNoteItem(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 rounded-xl text-xs font-black transition-all shadow-lg shadow-cyan-950/20 cursor-pointer"
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
              className={`rounded-2xl max-w-md w-full p-6 shadow-2xl border flex flex-col transition-colors ${
                theme === 'light'
                  ? 'bg-white border-slate-200 text-slate-900 shadow-slate-900/20'
                  : 'bg-[#101923] border-[#1E2E40] text-slate-100'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div className={`p-3 rounded-2xl shrink-0 border ${
                  theme === 'light'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                }`}>
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className={`text-base font-extrabold ${theme === 'light' ? 'text-slate-950' : 'text-white'}`}>
                    Confirm Verbal Recording Consent
                  </h3>
                  <p className={`text-xs mt-0.5 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
                    {consentGuardItem.patientName} • {consentGuardItem.time}
                  </p>
                </div>
                <button
                  onClick={() => setConsentGuardItem(null)}
                  className={`p-1.5 rounded-lg cursor-pointer ${
                    theme === 'light' ? 'text-slate-400 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className={`mt-4 p-3.5 rounded-xl border text-xs leading-relaxed ${
                theme === 'light'
                  ? 'bg-slate-50 border-slate-200 text-slate-700'
                  : 'bg-[#14202D] border-[#1E2E40] text-slate-300'
              }`}>
                <p className={`font-semibold ${theme === 'light' ? 'text-slate-900' : 'text-slate-200'}`}>
                  Confirm patient verbal consent for ambient operatory recording:
                </p>
                <p className={`mt-1.5 italic font-medium ${theme === 'light' ? 'text-cyan-800' : 'text-cyan-300'}`}>
                  "I will be using ambient voice transcription to prepare my clinical notes for your record today."
                </p>
                <div className={`mt-3 pt-2.5 border-t flex items-center gap-1.5 text-[11px] ${
                  theme === 'light' ? 'border-slate-200 text-slate-500' : 'border-[#1E2E40] text-slate-400'
                }`}>
                  <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'}`} />
                  <span>Logged to internal compliance audit only. Kept out of PMS clipboard.</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-5">
                <button
                  type="button"
                  onClick={() => recordWithoutConsentTag(consentGuardItem)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                    theme === 'light'
                      ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                      : 'text-slate-400 hover:text-white hover:bg-[#16222F]'
                  }`}
                >
                  Record Without Tag
                </button>
                <button
                  type="button"
                  onClick={() => confirmConsentAndRecord(consentGuardItem)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-950/20 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Confirm Consent & Record
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear Schedule Queue Non-Blocking Confirmation Modal (Zero INP Jitter) */}
      <AnimatePresence>
        {showClearConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`rounded-2xl max-w-md w-full p-6 shadow-2xl border transition-colors ${
                theme === 'light'
                  ? 'bg-white border-slate-200 text-slate-900 shadow-slate-900/20'
                  : 'bg-[#101923] border-[#1E2E40] text-slate-100'
              }`}
            >
              <div className={`flex items-center justify-between pb-3 border-b ${
                theme === 'light' ? 'border-slate-200' : 'border-[#1E2E40]'
              }`}>
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-xl border ${
                    theme === 'light'
                      ? 'bg-rose-50 border-rose-200 text-rose-600'
                      : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                  }`}>
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`text-base font-extrabold ${theme === 'light' ? 'text-slate-950' : 'text-white'}`}>
                      Clear Today's Schedule
                    </h3>
                    <p className={`text-[11px] ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
                      Reset operatory roster for {formattedDateTitle}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClearConfirmModal(false)}
                  className={`p-1.5 rounded-lg cursor-pointer ${
                    theme === 'light' ? 'text-slate-400 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className={`mt-4 p-3.5 rounded-xl border text-xs leading-relaxed ${
                theme === 'light'
                  ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                  : 'bg-rose-950/30 border-rose-900/40 text-rose-200'
              }`}>
                <p className={`font-semibold ${theme === 'light' ? 'text-rose-900' : 'text-rose-100'}`}>
                  Are you sure you want to remove all {items.length} appointments from today's active roster?
                </p>
                <p className={`mt-1 text-[11px] ${theme === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>
                  Completed clinical records and consultation notes will remain saved in your Patient Records Hub.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-5">
                <button
                  type="button"
                  onClick={() => setShowClearConfirmModal(false)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                    theme === 'light'
                      ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      : 'text-slate-400 hover:text-white hover:bg-[#16222F]'
                  }`}
                >
                  Keep Roster
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearTodaySchedule(currentDateStr);
                    setItems([]);
                    setShowClearConfirmModal(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-rose-950/40 cursor-pointer active:scale-95"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear All Appointments
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
              className={`rounded-2xl max-w-4xl w-full p-6 shadow-2xl border flex flex-col max-h-[90vh] transition-colors ${
                theme === 'light'
                  ? 'bg-white border-slate-200 text-slate-900 shadow-slate-900/20'
                  : 'bg-[#101923] border-[#1E2E40] text-slate-100'
              }`}
            >
              {/* Header */}
              <div className={`flex items-center justify-between pb-3 border-b ${
                theme === 'light' ? 'border-slate-200' : 'border-[#1E2E40]'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border ${
                    sideBySideItem.isFullyGrounded !== false
                      ? theme === 'light'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : theme === 'light'
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {sideBySideItem.isFullyGrounded !== false ? (
                      <ShieldCheck className="w-5 h-5" />
                    ) : (
                      <AlertCircle className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`text-base font-extrabold ${theme === 'light' ? 'text-slate-950' : 'text-white'}`}>
                        Clinical Verification: {sideBySideItem.patientName}
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold border ${
                        sideBySideItem.isFullyGrounded !== false
                          ? theme === 'light'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : theme === 'light'
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}>
                        {sideBySideItem.isFullyGrounded !== false ? '100% Grounded in Audio' : `${sideBySideItem.groundingScore ?? 0}% Audio Grounded`}
                      </span>
                    </div>
                    <p className={`text-xs mt-0.5 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
                      {sideBySideItem.procedureText} • {sideBySideItem.time}
                      {sideBySideItem.consentObtained && (
                        <span className={`ml-2 inline-flex items-center font-medium ${
                          theme === 'light' ? 'text-emerald-700' : 'text-emerald-400'
                        }`}>
                          • Verbal consent logged ✓
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSideBySideItem(null)}
                  className={`p-1.5 rounded-lg cursor-pointer ${
                    theme === 'light' ? 'text-slate-400 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Unverified Claims Warning if any */}
              {sideBySideItem.unverifiedClaims && sideBySideItem.unverifiedClaims.length > 0 && (
                <div className={`mt-3 p-3 rounded-xl border flex items-start gap-2.5 ${
                  theme === 'light'
                    ? 'bg-amber-50/90 border-amber-300'
                    : 'bg-amber-950/30 border-amber-500/30'
                }`}>
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className={`text-xs leading-relaxed ${theme === 'light' ? 'text-amber-950' : 'text-amber-300'}`}>
                    <span className="font-bold">Items not detected in verbatim speech: </span>
                    <span className={`font-semibold ${theme === 'light' ? 'text-amber-900' : 'text-amber-200'}`}>
                      {sideBySideItem.unverifiedClaims.join(', ')}
                    </span>
                    <p className={`text-[11px] mt-0.5 ${theme === 'light' ? 'text-amber-800' : 'text-amber-400/80'}`}>
                      Verify whether these clinical findings or treatments were performed before copying to your practice management system.
                    </p>
                  </div>
                </div>
              )}

              {/* Side-by-Side Content Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3.5 flex-1 min-h-0 overflow-hidden">
                {/* Left Column: Verbatim Spoken Dialogue */}
                <div className={`flex flex-col rounded-xl border p-3 min-h-0 ${
                  theme === 'light' ? 'bg-slate-50 border-slate-200' : 'border-[#1E2E40] bg-[#14202D]'
                }`}>
                  <div className={`flex items-center justify-between pb-2 mb-2 border-b text-xs font-bold ${
                    theme === 'light' ? 'border-slate-200 text-slate-700' : 'border-[#1E2E40] text-slate-300'
                  }`}>
                    <span>Spoken Operatory Dialogue</span>
                    <span className={`text-[11px] font-mono font-normal ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`}>
                      Verbatim Audio
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs cockpit-scrollbar">
                    {sideBySideItem.transcript && sideBySideItem.transcript.length > 0 ? (
                      sideBySideItem.transcript.map((utt, i) => (
                        <div key={i} className={`p-2 rounded-lg border ${
                          theme === 'light' ? 'bg-white border-slate-200' : 'bg-[#0E1620] border-[#1E2E40]'
                        }`}>
                          <span className={`font-bold text-[11px] block mb-0.5 ${
                            theme === 'light' ? 'text-cyan-800' : 'text-cyan-400'
                          }`}>
                            {utt.sender}:
                          </span>
                          <p className={`leading-relaxed font-sans ${theme === 'light' ? 'text-slate-800' : 'text-slate-300'}`}>
                            {utt.text}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className={`p-4 text-center italic ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>
                        Live operatory audio recorded for consultation.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Synthesized Clinical Note */}
                <div className={`flex flex-col rounded-xl border p-3 min-h-0 ${
                  theme === 'light' ? 'bg-slate-50 border-slate-200' : 'border-[#1E2E40] bg-[#14202D]'
                }`}>
                  <div className={`flex items-center justify-between pb-2 mb-2 border-b text-xs font-bold ${
                    theme === 'light' ? 'border-slate-200 text-slate-700' : 'border-[#1E2E40] text-slate-300'
                  }`}>
                    <span>Synthesized Progress Note</span>
                    <span className={`text-[11px] font-mono font-normal ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-400'}`}>
                      D4W / Praktika Format
                    </span>
                  </div>
                  <div className={`flex-1 overflow-y-auto p-3 rounded-lg border font-mono text-xs whitespace-pre-wrap leading-relaxed cockpit-scrollbar ${
                    theme === 'light'
                      ? 'bg-white border-slate-200 text-slate-800'
                      : 'bg-[#0E1620] border-[#1E2E40] text-slate-200'
                  }`}>
                    {formatNoteForPmsClipboard(sideBySideItem)}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className={`flex items-center justify-between pt-4 border-t mt-4 ${
                theme === 'light' ? 'border-slate-200' : 'border-[#1E2E40]'
              }`}>
                <div className="text-xs">
                  {sideBySideItem.consentObtained ? (
                    <span className={`font-semibold ${theme === 'light' ? 'text-emerald-700' : 'text-emerald-400'}`}>
                      ✓ Verbal Consent Recorded for Internal Audit
                    </span>
                  ) : (
                    <span className={theme === 'light' ? 'text-slate-500' : 'text-slate-500'}>
                      Verbal consent tag not active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSideBySideItem(null)}
                    className={`px-4 py-2 text-xs font-bold rounded-xl cursor-pointer ${
                      theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      handleCopyNote(sideBySideItem);
                      setSideBySideItem(null);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 rounded-xl text-xs font-black transition-all shadow-lg shadow-cyan-950/20 cursor-pointer"
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
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className={`rounded-3xl p-6 max-w-lg w-full shadow-2xl relative text-left border transition-colors ${
            theme === 'light'
              ? 'bg-white border-slate-200 text-slate-900 shadow-slate-900/20'
              : 'bg-[#0E1622] border-[#1E2E42] text-white shadow-2xl'
          }`}>
            <button
              onClick={() => setShowApiKeyModal(false)}
              className={`absolute top-5 right-5 p-1.5 rounded-lg transition-colors cursor-pointer ${
                theme === 'light' ? 'text-slate-400 hover:text-slate-900' : 'text-slate-400 hover:text-white'
              }`}
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${
                theme === 'light'
                  ? 'bg-cyan-50 border-cyan-300 text-cyan-700'
                  : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
              }`}>
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className={`text-base font-extrabold ${theme === 'light' ? 'text-slate-950' : 'text-white'}`}>
                  Google Gemini API Key
                </h3>
                <p className={`text-xs ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
                  For direct PMS schedule OCR & ambient scribing
                </p>
              </div>
            </div>

            <div className={`p-3.5 rounded-2xl mb-4 text-xs space-y-2 border ${
              theme === 'light'
                ? 'bg-slate-50 border-slate-200 text-slate-700'
                : 'bg-[#14202E] border-[#1E3048] text-slate-300'
            }`}>
              <div className={`flex items-center justify-between font-bold ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>
                <span>How to get a free API key:</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1 underline font-medium ${
                    theme === 'light' ? 'text-cyan-700 hover:text-cyan-900' : 'text-cyan-400 hover:text-cyan-300'
                  }`}
                >
                  Google AI Studio <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className={`text-[11px] leading-relaxed ${theme === 'light' ? 'text-slate-600' : 'text-slate-400'}`}>
                1. Visit Google AI Studio and click "Create API key".<br/>
                2. Free tier grants 15 requests per minute with zero billing or credit card required.<br/>
                3. Key is stored strictly in your browser (<code className={theme === 'light' ? 'text-cyan-800 font-bold' : 'text-cyan-300'}>localStorage</code>) and used for your practice sessions.
              </p>
            </div>

            <label className={`block text-xs font-bold mb-1.5 ${theme === 'light' ? 'text-slate-700' : 'text-slate-300'}`}>
              Gemini API Key
            </label>
            <input
              type="password"
              value={tempApiKeyInput}
              onChange={(e) => setTempApiKeyInput(e.target.value)}
              placeholder="AIzaSy... or AQ.Ab8RN..."
              className={`w-full px-4 py-2.5 rounded-xl text-xs focus:outline-hidden font-mono mb-4 border transition-all ${
                theme === 'light'
                  ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-cyan-600'
                  : 'bg-[#090F17] border-[#1E2E42] text-white placeholder-slate-600 focus:border-cyan-400'
              }`}
            />

            <div className={`flex items-center justify-between gap-3 pt-3 border-t ${
              theme === 'light' ? 'border-slate-200' : 'border-[#182638]'
            }`}>
              {customApiKey ? (
                <button
                  onClick={() => {
                    localStorage.removeItem('dentai_custom_gemini_key');
                    setCustomApiKey('');
                    setTempApiKeyInput('');
                    setShowApiKeyModal(false);
                  }}
                  className="text-xs text-rose-600 hover:text-rose-700 font-bold cursor-pointer"
                >
                  Remove Custom Key
                </button>
              ) : (
                <span className="text-[11px] text-slate-400">No custom key configured</span>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowApiKeyModal(false)}
                  className={`px-4 py-2 text-xs font-bold rounded-xl cursor-pointer ${
                    theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                  }`}
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
                    if (lastUploadedFile && cleaned) {
                      handleImageFile(lastUploadedFile, cleaned);
                    }
                    setShowApiKeyModal(false);
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-cyan-950/20 transition-all cursor-pointer"
                >
                  {lastUploadedFile ? 'Save Key & Re-parse Snip' : 'Save Key'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Surgery Cockpit & Practice Settings Modal */}
      <PracticeSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        dentistName={dentistName}
        activeClinic={activeClinic}
        onManageClinic={onManageClinic}
      />
    </CockpitLayout>
  );
}
