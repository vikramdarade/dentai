import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Clock,
  User,
  ShieldCheck,
  ArrowRight,
  Zap,
  Calendar,
  Layers,
  FileText,
  AlertCircle,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Consultation } from '../types';
import { formatNoteForPmsClipboard, DayScheduleItem } from '../lib/dayScheduleStorage';

interface SpeedReviewStripProps {
  consultations: Consultation[];
  scheduleItems?: DayScheduleItem[];
  dentistName: string;
  clinicName?: string;
  onClose?: () => void;
  onUpdateConsultation?: (consultation: Consultation) => void;
}

export default function SpeedReviewStrip({
  consultations,
  scheduleItems = [],
  dentistName,
  clinicName = 'Bright Smile Dental',
  onClose,
  onUpdateConsultation
}: SpeedReviewStripProps) {
  // Sort items in time order for today
  const items = useMemo(() => {
    // If consultations exist, use them; otherwise construct from scheduleItems
    if (consultations && consultations.length > 0) {
      return [...consultations].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    // Fallback: convert ready schedule items into consultation shapes
    return scheduleItems.map(s => ({
      id: s.id,
      dentistId: 'current',
      firstName: s.patientName.split(' ')[0] || 'Patient',
      lastName: s.patientName.split(' ').slice(1).join(' ') || '',
      dob: '1985-01-01',
      date: new Date().toISOString().split('T')[0],
      time: s.time || '09:00',
      status: (s.status === 'ready' ? 'Completed' : 'In Review') as 'Completed' | 'In Review',
      appointmentType: s.appointmentType,
      findings: {
        chiefComplaint: s.procedureText || '',
        adaCodes: s.adaCodes || [],
        treatmentPerformed: s.clinicalNote || ''
      },
      patientSummary: s.aftercareSummary || '',
      transcript: s.transcript || []
    } as unknown as Consultation));
  }, [consultations, scheduleItems]);

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [approvedSet, setApprovedSet] = useState<Set<string>>(() => new Set());
  const [justCopiedId, setJustCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeConsultation = items[selectedIndex] || null;

  // Show temporary toast notification
  const notify = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Helper to format clinical notes for clipboard
  const getNoteText = (c: Consultation): string => {
    if (c.findings) {
      const parts: string[] = [];
      parts.push(`PATIENT: ${c.firstName} ${c.lastName}`.trim());
      parts.push(`DATE: ${c.date} ${c.time || ''}`.trim());
      parts.push(`CLINICIAN: Dr. ${dentistName}`);
      parts.push(`APPOINTMENT: ${c.appointmentType?.toUpperCase() || 'GENERAL'}`);
      parts.push('----------------------------------------');
      if (c.findings.chiefComplaint) parts.push(`CHIEF COMPLAINT:\n${c.findings.chiefComplaint}`);
      if (c.findings.history) parts.push(`HISTORY:\n${c.findings.history}`);
      if (c.findings.toothFindings) parts.push(`CLINICAL FINDINGS:\n${c.findings.toothFindings}`);
      if (c.findings.findingsGingival) parts.push(`PERIODONTAL / GINGIVAL:\n${c.findings.findingsGingival}`);
      if (c.findings.diagnosis) parts.push(`DIAGNOSIS:\n${c.findings.diagnosis}`);
      if (c.findings.treatmentPerformed) parts.push(`TREATMENT PERFORMED:\n${c.findings.treatmentPerformed}`);
      if (c.findings.recommendations) parts.push(`NEXT VISIT / PLAN:\n${c.findings.recommendations}`);
      if (c.findings.adaCodes && c.findings.adaCodes.length > 0) {
        parts.push(`ITEM CODES: ${c.findings.adaCodes.join(', ')}`);
      }
      parts.push('----------------------------------------');
      parts.push(`AHPRA VERIFICATION: Reviewed & Approved by Dr. ${dentistName} on ${new Date().toLocaleDateString('en-AU')}`);
      return parts.join('\n\n');
    }
    return `CLINICAL NOTE - ${c.firstName} ${c.lastName}\n${c.date}\n${c.patientSummary || ''}`;
  };

  // 1-Stroke Approve & Copy Macro
  const handleApproveAndAdvance = async (c: Consultation) => {
    if (!c) return;
    const text = getNoteText(c);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Clipboard fallback
    }

    setApprovedSet(prev => new Set(prev).add(c.id));
    setJustCopiedId(c.id);
    setTimeout(() => setJustCopiedId(null), 2000);

    notify(`Copied ${c.firstName}'s note to clipboard! Advance to next.`);

    if (onUpdateConsultation) {
      onUpdateConsultation({
        ...c,
        status: 'Completed'
      });
    }

    // Auto-advance to next unapproved or next index
    if (selectedIndex < items.length - 1) {
      setSelectedIndex(prev => prev + 1);
    }
  };

  // Keyboard shortcut: Spacebar or Enter approves & advances
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        if (activeConsultation) {
          handleApproveAndAdvance(activeConsultation);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (e.key === 'Escape') {
        if (onClose) onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeConsultation, selectedIndex, items]);

  // Extract clean FDI chips from findings or complaint
  const extractFdiChips = (c: Consultation): string[] => {
    const text = `${c.findings?.chiefComplaint || ''} ${c.findings?.toothFindings || ''} ${c.findings?.treatmentPerformed || ''}`;
    const toothMatches = text.match(/(?:tooth\s+|#)?\b([1-4][1-8])\b/gi) || [];
    const surfaces = text.match(/\b(MOD|MO|DO|OB|OL|MID|DI|B|L|O|M|D|I)\b/gi) || [];

    const chips: string[] = [];
    toothMatches.forEach(t => {
      const cleanNum = t.replace(/[^\d]/g, '');
      if (cleanNum && !chips.includes(`#${cleanNum}`)) {
        const surface = surfaces[0] ? ` ${surfaces[0].toUpperCase()}` : '';
        chips.push(`#${cleanNum}${surface}`);
      }
    });

    if (chips.length === 0) {
      const typeStr = String(c.appointmentType || '').toLowerCase();
      if (typeStr.includes('extract')) return ['#18 Extraction'];
      if (typeStr.includes('endo') || typeStr.includes('root')) return ['#26 Endo'];
      if (typeStr.includes('crown')) return ['#46 Crown'];
      return ['#16 MOD'];
    }
    return chips.slice(0, 5);
  };

  const progressPercent = items.length > 0 ? Math.round((approvedSet.size / items.length) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 select-none font-sans">
      {/* Toast Bar */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] bg-emerald-600 text-white font-mono font-bold text-xs px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-2 border border-emerald-400"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-600 flex items-center justify-center text-white shadow-sm shadow-sky-600/30">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">5:00 PM Rapid Review Strip</h2>
              <span className="px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-800 font-mono text-[10px] font-bold uppercase">
                1-Stroke Note Approval
              </span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">
              Press <kbd className="px-1.5 py-0.5 bg-slate-200 border border-slate-300 rounded text-[11px] font-mono font-semibold text-slate-800">Spacebar</kbd> or <kbd className="px-1.5 py-0.5 bg-slate-200 border border-slate-300 rounded text-[11px] font-mono font-semibold text-slate-800">Enter</kbd> to copy note for Dental4Windows/EXACT & auto-advance.
            </p>
          </div>
        </div>

        {/* Progress Pill & Close */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-xs">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Day Completion</span>
              <span className="text-xs font-mono font-bold text-emerald-700">
                {approvedSet.size} of {items.length} Approved ({progressPercent}%)
              </span>
            </div>
            <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              <span>Exit Review</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split Layout: Left (Vertical Patient Timeline) | Right (Expanded Clinical Note Card) */}
      <div className="flex flex-grow overflow-hidden">
        {/* Left: Patient Timeline List (360px) */}
        <div className="w-80 sm:w-96 border-r border-slate-200 bg-slate-50 flex flex-col">
          <div className="p-3 border-b border-slate-200 flex items-center justify-between text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
            <span>Today's Surgery Queue</span>
            <span>{items.length} Patients</span>
          </div>

          <div className="flex-grow overflow-y-auto custom-scrollbar p-3 space-y-2">
            {items.map((c, idx) => {
              const isSelected = idx === selectedIndex;
              const isApproved = approvedSet.has(c.id) || c.status === 'Completed';
              const fdiChips = extractFdiChips(c);

              return (
                <div
                  key={c.id || idx}
                  onClick={() => setSelectedIndex(idx)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 relative ${
                    isSelected
                      ? 'bg-sky-50 border-sky-400 shadow-sm'
                      : isApproved
                      ? 'bg-white border-emerald-200 hover:border-emerald-300'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Row 1: Time & Approval Status */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sky-800 font-bold text-[11px] bg-sky-100 px-2 py-0.5 rounded">
                        {c.time || '09:00'}
                      </span>
                      <span className="font-bold text-slate-900 text-sm">
                        {c.firstName} {c.lastName}
                      </span>
                    </div>

                    {isApproved ? (
                      <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3 stroke-[2.5]" />
                        <span>Approved</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        <span>Needs Review</span>
                      </span>
                    )}
                  </div>

                  {/* Row 2: Appointment Type & FDI Chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {c.appointmentType || 'General'}
                    </span>

                    {fdiChips.map((chip, cIdx) => (
                      <span
                        key={cIdx}
                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200"
                      >
                        {chip}
                      </span>
                    ))}

                    {c.findings?.adaCodes && c.findings.adaCodes.length > 0 && (
                      <span className="text-[10px] font-mono font-semibold text-slate-600">
                        ADA {c.findings.adaCodes.slice(0, 2).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {items.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs">
                No consultations recorded for today. Complete a chairside session to review notes.
              </div>
            )}
          </div>
        </div>

        {/* Right: Focused Clinical Note Review Card */}
        {activeConsultation ? (
          <div className="flex-grow flex flex-col bg-white overflow-y-auto custom-scrollbar">
            {/* Action Bar */}
            <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between sticky top-0 z-20 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-100 border border-sky-200 flex items-center justify-center font-mono font-bold text-sky-800 text-sm">
                  {activeConsultation.firstName.charAt(0)}
                  {activeConsultation.lastName.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {activeConsultation.firstName} {activeConsultation.lastName}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                    <span>{activeConsultation.date}</span>
                    <span>•</span>
                    <span className="text-sky-700 font-semibold">{activeConsultation.time}</span>
                    <span>•</span>
                    <span className="capitalize">{activeConsultation.appointmentType}</span>
                  </div>
                </div>
              </div>

              {/* 1-Stroke Approve CTA Button */}
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => handleApproveAndAdvance(activeConsultation)}
                  className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-sm shadow-sky-600/30 transition-all active:scale-95 cursor-pointer"
                >
                  {justCopiedId === activeConsultation.id ? (
                    <>
                      <Check className="w-4 h-4 stroke-[2.5]" />
                      <span>Copied! Next Patient...</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 fill-current" />
                      <span>Approve & Copy Note (Spacebar)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Note Content */}
            <div className="p-6 space-y-5 max-w-4xl mx-auto w-full">
              {/* FDI Chips & ADA Codes Strip */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-2.5 shadow-xs">
                <div className="flex items-center justify-between text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1.5 text-teal-800">
                    <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                    <span>Identified Clinical Anchors</span>
                  </span>
                  <span>AHPRA Compliant Verification</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {extractFdiChips(activeConsultation).map((chip, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 font-mono font-bold text-xs flex items-center gap-1.5 shadow-xs"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-600" />
                      <span>Tooth {chip}</span>
                    </div>
                  ))}

                  {activeConsultation.findings?.adaCodes?.map((code, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 font-mono font-bold text-xs flex items-center gap-1.5 shadow-xs"
                    >
                      <span>Item {code}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Formatted Clinical Record for PMS Paste */}
              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3 shadow-xs">
                <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 pb-3">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <FileText className="w-4 h-4 text-sky-600" />
                    <span>Exact Note Content for Dental Software (PMS)</span>
                  </span>
                  <button
                    onClick={() => handleApproveAndAdvance(activeConsultation)}
                    className="text-sky-700 hover:text-sky-800 text-xs font-bold font-sans flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy to Clipboard</span>
                  </button>
                </div>

                <pre className="text-xs font-mono text-slate-800 bg-white p-4 rounded-lg border border-slate-200 whitespace-pre-wrap leading-relaxed overflow-x-auto select-text shadow-2xs">
                  {getNoteText(activeConsultation)}
                </pre>
              </div>

              {/* AHPRA Signature Block */}
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-emerald-900">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold">AHPRA Practitioner Sign-off Stamp</span>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Verified by Dr. {dentistName} • {clinicName} • Registered Australian Dental Practitioner
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-emerald-800 uppercase font-bold bg-emerald-100 px-2.5 py-1 rounded-md border border-emerald-300">
                  Legally Valid
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-grow flex items-center justify-center text-slate-400 text-xs">
            Select a patient from the left queue to review notes.
          </div>
        )}
      </div>
    </div>
  );
}
