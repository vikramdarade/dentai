import React, { useState } from 'react';
import { Search, Plus, FileText, Menu, Building2, Sparkles, TrendingUp, Calendar } from 'lucide-react';
import { Consultation, getTodayStr, getYesterdayStr } from '../types';
import { motion } from 'motion/react';
import ClinicSwitcher from './ClinicSwitcher';
import ClinicMembersModal from './ClinicMembersModal';
import TreatmentPipeline from './TreatmentPipeline';
import DayScheduleQueue from './DayScheduleQueue';
import ErrorBoundary from './ErrorBoundary';
import { DayScheduleItem } from '../lib/dayScheduleStorage';
import { isPmsPreviewEnabled } from '../utils/previewMode';
import { ClinicMembership } from '../lib/clinics';
import CockpitLayout from './CockpitLayout';

interface HistoryHubProps {
  consultations: Consultation[];
  onSelectConsultation: (consultation: Consultation) => void;
  onStartNewConsultation: () => void;
  onStartScheduledConsultation?: (item: DayScheduleItem) => void;
  dentistName: string;
  onLogout: () => void;
  // Clinic ecosystem (multi-clinic practice / invite codes)
  clinics: ClinicMembership[];
  activeClinic: ClinicMembership | null;
  onSelectClinic: (clinicId: string) => void;
  onJoinClinic: (code: string) => Promise<{ ok: boolean; message: string }>;
  onClinicChanged: () => void;
  authToken: string;
  /** Used to label colleague-authored notes in the owner view. */
  currentDentistId: string;
  memberNames: Record<string, string>;
}

export default function HistoryHub({
  consultations,
  onSelectConsultation,
  onStartNewConsultation,
  onStartScheduledConsultation,
  dentistName,
  onLogout,
  clinics,
  activeClinic,
  onSelectClinic,
  onJoinClinic,
  onClinicChanged,
  authToken,
  currentDentistId,
  memberNames
}: HistoryHubProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const [previewEnabled] = useState(() => isPmsPreviewEnabled());
  const [hubTab, setHubTab] = useState<'schedule' | 'records' | 'pipeline'>(() => {
    return previewEnabled ? 'schedule' : 'records';
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Group consultations by date
  const todayStr = getTodayStr();
  const yesterdayStr = getYesterdayStr();

  const filtered = consultations.filter((c) => {
    const query = searchQuery.toLowerCase();
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    const chiefComplaint = (c.findings?.chiefComplaint || '').toLowerCase();
    const aptType = c.appointmentType.toLowerCase();
    return fullName.includes(query) || chiefComplaint.includes(query) || aptType.includes(query);
  });

  const uniqueDates = Array.from(new Set(filtered.map((c) => c.date)));

  const getProcedureLabel = (type: string) => {
    switch (type) {
      case 'emergency':
        return 'Limited Exam / Emergency';
      case 'comprehensive':
        return 'Comprehensive Oral Evaluation';
      case 'periodic':
        return 'Periodic Oral Exam';
      case 'crown_prep':
        return 'Crown Prep & Impression';
      case 'root_canal':
        return 'Endodontic Therapy';
      case 'extraction':
        return 'Surgical Extraction';
      case 'scale_clean':
        return 'Scale & Clean / Prophylaxis';
      default:
        return 'Dental Consultation';
    }
  };

  // Avatar backgrounds based on initials to make it visually distinctive
  const getAvatarBg = (initials: string) => {
    switch (initials) {
      case 'SJ':
        return 'bg-secondary-container text-on-secondary-container';
      case 'MT':
        return 'bg-primary-fixed text-on-primary-fixed';
      case 'ER':
        return 'bg-surface-container-highest text-on-secondary-fixed';
      default:
        return 'bg-error-container text-on-error-container';
    }
  };

  if (previewEnabled && hubTab === 'schedule') {
    return (
      <ErrorBoundary fallbackTitle="Day Schedule Roster Self-Recovered">
        <DayScheduleQueue
          onStartRecording={(item) => {
            if (onStartScheduledConsultation) {
              onStartScheduledConsultation(item);
            }
          }}
          onViewConsultation={(consultId) => {
            const match = consultations.find(c => c.id === consultId);
            if (match) onSelectConsultation(match);
          }}
          dentistName={dentistName}
          authToken={authToken}
          onLogout={onLogout}
          onNavigateTab={(tab) => setHubTab(tab)}
          clinics={clinics}
          activeClinic={activeClinic}
          onSelectClinic={onSelectClinic}
          onManageClinic={() => setManageOpen(true)}
          onClinicChanged={onClinicChanged}
          onJoinClinic={onJoinClinic}
        />
        {manageOpen && activeClinic && (
          <ClinicMembersModal
            clinic={activeClinic}
            authToken={authToken}
            onClose={() => setManageOpen(false)}
            onChanged={onClinicChanged}
          />
        )}
      </ErrorBoundary>
    );
  }

  return (
    <CockpitLayout
      dentistName={dentistName}
      onLogout={onLogout}
      activeTab={hubTab === 'pipeline' ? 'pipeline' : 'patients'}
      onTabChange={(tab) => {
        if (tab === 'roster') setHubTab('schedule');
        else if (tab === 'pipeline') setHubTab('pipeline');
        else if (tab === 'patients') setHubTab('records');
      }}
    >
      <div className="w-full max-w-6xl mx-auto space-y-5 text-slate-100 font-sans pb-16">
        {/* Top Control Toolbar in Dark Cockpit Styling */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[#0A1018] border border-[#182638] shadow-lg shadow-black/40">
          <div className="flex items-center gap-3">
            <ClinicSwitcher
              clinics={clinics}
              activeClinic={activeClinic}
              onSelectClinic={onSelectClinic}
              onJoinClinic={onJoinClinic}
              onManageClinic={() => setManageOpen(true)}
              onClinicChanged={onClinicChanged}
            />
            {activeClinic?.role === 'owner' && (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                Owner Mode Active
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onStartNewConsultation}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 font-black rounded-xl text-xs shadow-md shadow-cyan-950/50 cursor-pointer active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>New Consultation</span>
            </button>
          </div>
        </div>

        {/* Unified Hub Navigation Switcher Tabs */}
        <div className="flex items-center gap-2 border-b border-[#182638] pb-3 flex-wrap">
          {previewEnabled && (
            <button
              onClick={() => setHubTab('schedule')}
              className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-2 cursor-pointer border-[#1E3048] bg-[#0A1018] text-slate-400 hover:text-white hover:bg-[#121E2E]"
            >
              <Calendar className="w-4 h-4 text-cyan-400" />
              <span>Today's Schedule</span>
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 text-[10px] font-black border border-cyan-500/30">
                PMS Queue
              </span>
            </button>
          )}

          <button
            onClick={() => setHubTab('records')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-2 cursor-pointer ${
              hubTab === 'records'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-xs'
                : 'border-[#1E3048] bg-[#0A1018] text-slate-400 hover:text-white hover:bg-[#121E2E]'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Patient Records ({filtered.length})</span>
          </button>

          <button
            onClick={() => setHubTab('pipeline')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-2 cursor-pointer ${
              hubTab === 'pipeline'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-xs'
                : 'border-[#1E3048] bg-[#0A1018] text-slate-400 hover:text-white hover:bg-[#121E2E]'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Treatment Pipeline & ROI</span>
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-[10px] font-black border border-emerald-500/30">
              Revenue Engine
            </span>
          </button>
        </div>

        {hubTab === 'pipeline' ? (
          <TreatmentPipeline
            authToken={authToken}
            activeClinic={activeClinic}
            dentistName={dentistName}
            currentDentistId={currentDentistId}
            consultations={consultations}
          />
        ) : (
          <div className="space-y-6">
            {/* Header / Search Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-white tracking-tight">Patient Records Hub</h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  Search and review archived clinical charts, generated SOAP notes, and treatment quotes.
                </p>
              </div>

              {/* Search Bar Component */}
              <div className="relative w-full sm:w-80 group">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none group-focus-within:text-cyan-400 transition-colors" />
                <input
                  type="text"
                  placeholder="Search patient name, tooth, or note..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 bg-[#0A1018] border border-[#182638] rounded-xl focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 outline-none transition-all text-xs font-semibold text-white placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* List of Consultations */}
            <section className="space-y-6">
              {uniqueDates.map((date, idx) => {
                const dateConsultations = filtered.filter(c => c.date === date);
                const isToday = date === todayStr;
                const isYesterday = date === yesterdayStr;
                const headerLabel = isToday
                  ? `Today, ${date}`
                  : isYesterday
                  ? `Yesterday, ${date}`
                  : date;

                return (
                  <div key={date} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-[#182638]"></div>
                      <span className="font-mono text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                        {headerLabel}
                      </span>
                      <div className="h-px flex-1 bg-[#182638]"></div>
                    </div>

                    <div className="space-y-2.5">
                      {dateConsultations.map((c) => {
                        const initials = `${c.firstName[0]}${c.lastName[0]}`.toUpperCase();
                        return (
                          <motion.div
                            key={c.id}
                            onClick={() => onSelectConsultation(c)}
                            whileHover={{ scale: 1.005 }}
                            whileTap={{ scale: 0.995 }}
                            className="bg-[#0A1018] hover:bg-[#0E1724] border border-[#182638] hover:border-cyan-500/40 rounded-2xl p-4 transition-all cursor-pointer shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-3.5">
                              <div className="w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-sm bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
                                {initials}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-bold text-white text-sm truncate">
                                  {c.firstName} {c.lastName}
                                </span>
                                <span className="text-slate-400 font-mono text-xs truncate">
                                  {getProcedureLabel(c.appointmentType)}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-[#182638]">
                              <span className="text-cyan-400 font-mono text-xs font-bold">
                                {c.time}
                              </span>
                              <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                c.status === 'Completed'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              }`}>
                                {c.status}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Empty State */}
              {filtered.length === 0 && (
                <div className="text-center py-12 bg-[#0A1018] rounded-2xl border border-dashed border-[#182638] p-8 flex flex-col items-center gap-3">
                  <FileText className="text-slate-600 w-12 h-12" />
                  <div className="text-base font-bold text-white">No Patient Records Found</div>
                  <p className="text-slate-400 text-xs max-w-sm">No clinical notes match your search query. Verify the spelling or start a new consultation.</p>
                  <button
                    onClick={onStartNewConsultation}
                    className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all hover:opacity-95 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Start Consultation</span>
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Owner clinic management modal */}
        {manageOpen && activeClinic && (
          <ClinicMembersModal
            clinic={activeClinic}
            authToken={authToken}
            onClose={() => setManageOpen(false)}
            onChanged={onClinicChanged}
          />
        )}
      </div>
    </CockpitLayout>
  );
}
