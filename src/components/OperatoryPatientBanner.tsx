import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Calendar, Plus, Shield, User, X, Edit2, Check } from 'lucide-react';
import { AppointmentType, APPOINTMENT_TYPES } from '../lib/dentalLibrary';
import { AI_DISCLOSURE_TEXT, AI_DISCLOSURE_VERSION } from '../lib/compliance';
import { dobFieldError } from '../utils/date';
import type { ConsultationConsent } from '../types';

export interface PatientBannerData {
  id: string;
  patientName: string;
  dob?: string;
  operatory?: string;
  time?: string;
  appointmentType: AppointmentType;
  alerts?: { type: 'allergy' | 'medication' | 'general'; text: string }[];
}

export interface OperatoryPatientBannerProps {
  encounter: PatientBannerData | null;
  currentIndex: number;
  totalEncounters: number;
  onSelectPrev: () => void;
  onSelectNext: () => void;
  onOpenDaysheet: () => void;
  onOpenWalkIn?: () => void;
  onUpdateAppointmentType?: (appointmentType: AppointmentType) => void;
  onQuickInductPatient?: (data: { patientName: string; dob?: string; operatory?: string; appointmentType?: AppointmentType }) => void;
  /**
   * The AI-assist consent recorded for the encounter on screen, or null when
   * none has been recorded. Null is a real state the banner must show honestly:
   * a transcript cannot be saved on an enforcing deployment without it.
   */
  consent?: ConsultationConsent | null;
  /**
   * Records the patient's consent. The caller stamps the instant, the
   * disclosure version and the practitioner — the banner only collects the
   * clinician's explicit confirmation that the disclosure was given.
   */
  onRecordConsent?: () => void | Promise<void>;
}

export const OperatoryPatientBanner: React.FC<OperatoryPatientBannerProps> = ({
  encounter,
  currentIndex,
  totalEncounters,
  onSelectPrev,
  onSelectNext,
  onOpenDaysheet,
  onOpenWalkIn,
  onUpdateAppointmentType,
  onQuickInductPatient,
  consent,
  onRecordConsent,
}) => {
  const [showInductPopover, setShowInductPopover] = useState(false);
  const [showConsentPopover, setShowConsentPopover] = useState(false);
  const [inductName, setInductName] = useState('');
  const [inductDob, setInductDob] = useState('');
  const [inductRoom, setInductRoom] = useState('Room 1');
  const [inductApptType, setInductApptType] = useState<AppointmentType>('examination');
  // Set only when the clinician submits a date of birth that is not a real
  // calendar date; cleared as soon as they edit the field.
  const [inductError, setInductError] = useState<string | null>(null);

  /**
   * Escape dismisses either popover, matching the rest of the app
   * (`ChairsideWorkspace` global Escape, `TreatmentPipeline` modals). These two
   * overlays previously closed only via their own X/Cancel, so a keyboard user
   * who opened one had no way back to the surface underneath.
   */
  useEffect(() => {
    if (!showInductPopover && !showConsentPopover) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowInductPopover(false);
      setShowConsentPopover(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showInductPopover, showConsentPopover]);

  const handleOpenInduction = () => {
    setInductName(encounter && !/^In-Chair Patient/i.test(encounter.patientName) ? encounter.patientName : '');
    setInductDob(encounter?.dob || '');
    setInductRoom(encounter?.operatory || 'Room 1');
    setInductApptType(encounter?.appointmentType || 'examination');
    setInductError(null);
    setShowInductPopover(true);
  };

  /**
   * Adding a walk-in is NOT editing the patient in the chair.
   *
   * Both affordances open a name/dob/room form, so they were wired to the same
   * handler — the induction one — which renames the encounter that is already
   * open (`ChairsideWorkspace.handleQuickInductPatient` updates the active
   * consultation in place and toasts "Patient updated"). A walk-in therefore
   * never became its own appointment, and a new patient's name and date of birth
   * were written onto the previous patient's chart, which is the input to the
   * record that gets signed.
   *
   * `onOpenWalkIn` opens the real walk-in entry point (a collision-safe id and a
   * record with no inherited content). The induction form remains what it always
   * was: how a clinician edits the patient already in the chair, reached by
   * clicking the patient's name.
   */
  const handleOpenWalkIn = () => {
    if (onOpenWalkIn) {
      onOpenWalkIn();
      return;
    }
    handleOpenInduction();
  };

  /**
   * Confirm that the disclosure was given and record consent.
   *
   * Reached only through the explicit "patient consents" confirmation in the
   * popover — never as a side effect of a save — so the record can only ever
   * carry a consent the clinician actually made.
   */
  const handleRecordConsent = async () => {
    await onRecordConsent?.();
    setShowConsentPopover(false);
  };

  const handleInductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inductName.trim()) return;
    // Same refusal as the walk-in form: this date is written onto the patient's
    // chart, and note generation refuses an impossible one downstream.
    const dobProblem = dobFieldError(inductDob);
    if (dobProblem) {
      setInductError(dobProblem);
      return;
    }
    if (onQuickInductPatient) {
      onQuickInductPatient({
        patientName: inductName.trim(),
        dob: inductDob.trim() || undefined,
        operatory: inductRoom,
        appointmentType: inductApptType
      });
    }
    setShowInductPopover(false);
  };

  if (!encounter) {
    return (
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-[0_2px_12px_-3px_rgba(15,23,42,0.04)] flex items-center justify-between">
        <div className="flex items-center space-x-3 text-slate-500 text-sm">
          <User className="w-5 h-5 text-slate-400" />
          <span>No patient in chair</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleOpenWalkIn}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-sky-600" />
            <span>Walk-In Patient</span>
          </button>
          <button
            onClick={onOpenDaysheet}
            className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition cursor-pointer flex items-center space-x-1.5"
          >
            <Calendar className="w-3.5 h-3.5 text-sky-400" />
            <span>Select from Schedule</span>
          </button>
        </div>
      </div>
    );
  }

  const initials = encounter.patientName
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const roomLabel = encounter.operatory?.replace(/Op /i, 'Room ') || 'Room 1';

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-[0_2px_12px_-3px_rgba(15,23,42,0.04)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3.5">
      {/* Patient Avatar & Demographics */}
      <div className="flex items-center space-x-3.5">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-50 via-slate-50 to-blue-100/70 text-sky-950 flex items-center justify-center font-bold text-sm border border-sky-200/70 shadow-xs flex-shrink-0 tracking-tight">
          {initials}
        </div>

        <div>
          <div className="flex items-center space-x-2.5 flex-wrap">
            <div
              onClick={handleOpenInduction}
              className="flex items-center space-x-1.5 group cursor-pointer"
              title="Click to rename patient or update details"
            >
              <h2 className="text-lg font-bold text-slate-900 tracking-tight group-hover:text-sky-700 transition">
                {encounter.patientName}
              </h2>
              <Edit2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition" />
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-slate-500 font-medium">
              <span>•</span>
              <span>DOB: <strong className="font-semibold text-slate-700 font-mono font-tabular">{encounter.dob ? encounter.dob : 'Not recorded'}</strong></span>
              <span>•</span>
              <span className="font-semibold text-slate-700">{roomLabel}</span>
              {encounter.time && (
                <>
                  <span>•</span>
                  <span className="font-mono font-semibold text-slate-700 font-tabular">{encounter.time}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Appointment / Procedure Type */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Type:</span>
              <select
                value={encounter.appointmentType || 'examination'}
                onChange={e => onUpdateAppointmentType?.(e.target.value as AppointmentType)}
                className="px-2.5 py-0.5 text-xs font-semibold rounded-lg bg-slate-50/90 text-slate-800 border border-slate-200/90 hover:bg-slate-100/70 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition cursor-pointer"
              >
                {APPOINTMENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Medical Alert Pills */}
            {encounter.alerts?.map((alert, idx) => (
              <span
                key={idx}
                className={`inline-flex items-center space-x-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-lg border shadow-2xs ${
                  alert.type === 'allergy'
                    ? 'bg-rose-50 text-rose-800 border-rose-200/90'
                    : 'bg-amber-50 text-amber-800 border-amber-200/90'
                }`}
              >
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>{alert.text}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Operatory Quick Actions & Schedule Nav */}
      <div className="flex items-center space-x-2 self-end md:self-center">
        {/* AI-Assist Consent — recorded once, carried by every write */}
        {consent?.obtainedAt ? (
          <span
            className="px-3 py-1.5 rounded-xl border border-emerald-200/90 bg-emerald-50 text-emerald-800 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs"
            title={`AI-assist consent recorded ${new Date(consent.obtainedAt).toLocaleString()}${
              consent.recordedBy ? ` by ${consent.recordedBy}` : ''
            } — disclosure ${consent.disclosureVersion}. It is append-only and stays on the record.`}
          >
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            <span>Consent ✓</span>
          </span>
        ) : (
          <button
            onClick={() => setShowConsentPopover(true)}
            disabled={!onRecordConsent}
            className="px-3 py-1.5 rounded-xl border border-amber-200/90 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 disabled:pointer-events-none text-amber-800 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
            title="Record the patient's consent for AI-assisted note drafting (required before a transcript can be saved)"
          >
            <Shield className="w-3.5 h-3.5 text-amber-600" />
            <span>Consent</span>
          </button>
        )}

        <button
          onClick={handleOpenWalkIn}
          className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
          title="Add a walk-in patient as a new encounter"
        >
          <Plus className="w-3.5 h-3.5 text-sky-600" />
          <span>Walk-In</span>
        </button>

        <button
          onClick={onOpenDaysheet}
          className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition cursor-pointer"
          title="Open Daysheet Schedule (⌘V)"
        >
          <Calendar className="w-3.5 h-3.5 text-sky-400" />
          <span>Schedule</span>
        </button>

        {/* Patient Step Nav Buttons */}
        <div className="flex items-center space-x-1 pl-1.5 border-l border-slate-200/80">
          <button
            onClick={onSelectPrev}
            disabled={currentIndex <= 0}
            className="p-1.5 rounded-lg border border-slate-200/90 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer shadow-2xs"
            title="Previous Patient (⌘←)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs font-mono text-slate-600 px-1.5 font-semibold font-tabular">
            {currentIndex + 1}/{totalEncounters || 1}
          </span>

          <button
            onClick={onSelectNext}
            disabled={currentIndex >= totalEncounters - 1}
            className="p-1.5 rounded-lg border border-slate-200/90 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer shadow-2xs"
            title="Next Patient (⌘→)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* AI-Assist Consent Capture Popover — shows the disclosure, then records */}
      {showConsentPopover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center">
                  <Shield className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">AI-Assist Consent</h3>
              </div>
              <button
                onClick={() => setShowConsentPopover(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto custom-scrollbar rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
              <p className="text-xs text-slate-700 leading-relaxed">{AI_DISCLOSURE_TEXT}</p>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Confirming records this consent against the consultation with the current time, the practitioner you are
              signed in as, and disclosure version <span className="font-mono font-semibold text-slate-600">{AI_DISCLOSURE_VERSION}</span>. Consent is
              append-only — it cannot be changed or removed afterwards.
            </p>

            <div className="pt-1 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowConsentPopover(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRecordConsent}
                disabled={!onRecordConsent}
                className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold shadow-xs transition cursor-pointer flex items-center space-x-1"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Patient consents — record</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5-Second Patient Quick Induction Popover */}
      {showInductPopover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">Patient Quick Induction</h3>
              </div>
              <button
                onClick={() => setShowInductPopover(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInductSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Patient Full Name *
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={inductName}
                  onChange={e => setInductName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="text"
                    value={inductDob}
                    onChange={e => { setInductDob(e.target.value); if (inductError) setInductError(null); }}
                    placeholder="DD/MM/YYYY"
                    aria-invalid={inductError ? true : undefined}
                    className={`w-full px-3 py-2 text-xs rounded-xl border bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-900 font-mono font-tabular ${inductError ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Operatory
                  </label>
                  <select
                    value={inductRoom}
                    onChange={e => setInductRoom(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-900 font-medium cursor-pointer"
                  >
                    <option value="Room 1">Room 1</option>
                    <option value="Room 2">Room 2</option>
                    <option value="Room 3">Room 3</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Appointment Type
                </label>
                <select
                  value={inductApptType}
                  onChange={e => setInductApptType(e.target.value as AppointmentType)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-900 font-medium cursor-pointer"
                >
                  {APPOINTMENT_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {inductError && (
                <p className="text-[11px] font-semibold text-rose-700 flex items-start gap-1.5" data-testid="induct-dob-error">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  <span>{inductError}</span>
                </p>
              )}

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowInductPopover(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!inductName.trim()}
                  className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold shadow-xs transition cursor-pointer flex items-center space-x-1"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Induct to Chair</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
