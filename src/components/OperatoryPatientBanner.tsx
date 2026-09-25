import React from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Calendar, Plus, Shield, User } from 'lucide-react';
import { AppointmentType, APPOINTMENT_TYPES } from '../lib/dentalLibrary';

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
}) => {
  if (!encounter) {
    return (
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-center justify-between">
        <div className="flex items-center space-x-3 text-slate-500 text-sm">
          <User className="w-5 h-5 text-slate-400" />
          <span>No patient in chair</span>
        </div>
        <div className="flex items-center space-x-2">
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
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              {encounter.patientName}
            </h2>
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
        {onOpenWalkIn && (
          <button
            onClick={onOpenWalkIn}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition cursor-pointer"
            title="Add Walk-In Patient"
          >
            <Plus className="w-3.5 h-3.5 text-sky-600" />
            <span>Walk-In</span>
          </button>
        )}

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
    </div>
  );
};
