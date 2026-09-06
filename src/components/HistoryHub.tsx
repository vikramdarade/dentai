import React, { useState } from 'react';
import { Search, Plus, FileText, Menu, Building2, Sparkles, TrendingUp } from 'lucide-react';
import { Consultation, getTodayStr, getYesterdayStr } from '../types';
import { motion } from 'motion/react';
import ClinicSwitcher from './ClinicSwitcher';
import ClinicMembersModal from './ClinicMembersModal';
import TreatmentPipeline from './TreatmentPipeline';
import { ClinicMembership } from '../lib/clinics';

interface HistoryHubProps {
  consultations: Consultation[];
  onSelectConsultation: (consultation: Consultation) => void;
  onStartNewConsultation: () => void;
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
  const [hubTab, setHubTab] = useState<'records' | 'pipeline'>('records');
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(n => n.toLowerCase() !== 'dr.')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };
  const [searchQuery, setSearchQuery] = useState('');

  // Filtering based on search query
  const filtered = consultations.filter((c) => {
    const term = searchQuery.toLowerCase();
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    const type = c.appointmentType.toLowerCase();
    const notesHeading = c.findings.chiefComplaint.toLowerCase();
    return fullName.includes(term) || type.includes(term) || notesHeading.includes(term);
  });

  // Group by date dynamically
  const todayStr = getTodayStr();
  const yesterdayStr = getYesterdayStr();
  const uniqueDates = Array.from(new Set(filtered.map(c => c.date)));

  // Utility to map type to label (8 core procedure types)
  const getProcedureLabel = (type: string) => {
    switch (type) {
      case 'examination':
        return 'Comprehensive Examination';
      case 'scale_clean':
        return 'Scale & Clean (Hygiene)';
      case 'emergency':
        return 'Emergency / Pain Relief';
      case 'restorative':
        return 'Restorative (Filling)';
      case 'endodontic':
        return 'Endodontic (Root Canal)';
      case 'surgical':
        return 'Surgical (Extraction)';
      case 'prosthodontic':
        return 'Prosthodontic (Crown & Bridge)';
      case 'paediatric':
        return 'Paediatric (Child)';
      default:
        return 'Clinical Dental Consultation';
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

  return (
    <div id="history-hub-container" className="flex flex-col min-h-screen bg-[#F8F7F5] pb-24 text-on-background">
      {/* Top App Bar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-surface border-b border-outline-variant">
        <div className="flex items-center gap-3 min-w-0">
          <Menu className="text-primary h-6 w-6 cursor-pointer shrink-0" />
          <h1 className="hidden sm:block font-headline-md text-headline-md font-bold text-primary">DentAI</h1>
          <ClinicSwitcher
            clinics={clinics}
            activeClinic={activeClinic}
            onSelectClinic={onSelectClinic}
            onJoinClinic={onJoinClinic}
            onManageClinic={() => setManageOpen(true)}
            onClinicChanged={onClinicChanged}
          />
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onStartNewConsultation}
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-primary-container text-white rounded-lg font-label-md transition-all hover:bg-opacity-90 active:scale-95"
          >
            <Plus className="w-5 h-5" />
            <span>New Consultation</span>
          </button>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-xs font-bold text-slate-800">{dentistName}</span>
              <button
                onClick={onLogout}
                className="text-[9px] text-red-650 hover:underline font-extrabold uppercase tracking-wider cursor-pointer bg-transparent border-none p-0"
              >
                Logout
              </button>
            </div>
            <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-primary font-bold text-xs shadow-sm">
              {getInitials(dentistName)}
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-grow pt-20 px-4 md:px-8 max-w-4xl mx-auto w-full">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200/80 pt-4 mb-6">
          <button
            onClick={() => setHubTab('records')}
            className={`pb-3 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
              hubTab === 'records'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Patient Records ({filtered.length})</span>
          </button>
          <button
            onClick={() => setHubTab('pipeline')}
            className={`pb-3 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
              hubTab === 'pipeline'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>Treatment Pipeline & ROI</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black border border-emerald-200">
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
          <>
            {/* Hero Section */}
            <section className="py-2 space-y-4">
              <div className="flex flex-col gap-1">
                <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface">History Hub</h2>
                <p className="text-secondary font-body-md text-slate-500">
                  Manage and review clinical patient records. Select any past visit to review charts or start a new recording session.
                </p>
              </div>

              {activeClinic?.role === 'owner' && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary-light/60 border border-indigo-100 text-primary text-xs font-semibold">
                  <Building2 className="w-4 h-4 shrink-0" />
                  <span>
                    Owner view — showing notes recorded by every dentist in{' '}
                    <span className="font-extrabold">{activeClinic.clinicName}</span>.
                  </span>
                </div>
              )}

              {/* Search Bar Component */}
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none group-focus-within:text-primary transition-colors" />
                <input
                  type="text"
                  placeholder="Search patient name, procedure, or complaints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-12 pl-12 pr-4 bg-white border border-outline-variant rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-body-md shadow-sm text-on-surface"
                />
              </div>

              {/* Mobile New Consultation bar */}
              <div id="mobile-new-consult" className="md:hidden pt-2">
                <button
                  onClick={onStartNewConsultation}
                  className="flex items-center justify-center gap-2 w-full h-12 bg-primary border hover:bg-opacity-90 text-white rounded-xl font-medium shadow-sm transition-all"
                >
                  <Plus className="w-5 h-5" />
                  <span>New Consultation</span>
                </button>
              </div>
            </section>

            {/* List of Consultations */}
            <section className="space-y-6 pt-2">
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
                    <div className={`flex items-center gap-2 px-1 ${idx > 0 ? 'pt-2' : ''}`}>
                      <div className="h-px flex-1 bg-outline-variant"></div>
                      <span className="font-label-sm text-slate-400 uppercase tracking-widest text-[11px] font-bold">
                        {headerLabel}
                      </span>
                      <div className="h-px flex-1 bg-outline-variant"></div>
                    </div>

                    <div className="space-y-3">
                      {dateConsultations.map((c) => {
                        const initials = `${c.firstName[0]}${c.lastName[0]}`;
                        return (
                          <motion.div
                            key={c.id}
                            onClick={() => onSelectConsultation(c)}
                            whileHover={{ y: -2 }}
                            whileTap={{ scale: 0.99 }}
                            className="bg-white border border-outline-variant hover:border-primary rounded-2xl p-4 transition-all cursor-pointer shadow-sm hover:shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-4">
                              <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-base shadow-sm ${getAvatarBg(initials)}`}>
                                {initials}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-title-md font-bold text-on-surface text-base">
                                  {c.firstName} {c.lastName}
                                </span>
                                <span className="text-slate-500 font-body-sm text-xs">
                                  {getProcedureLabel(c.appointmentType)}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-outline-variant">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400 font-label-sm text-xs">
                                  {c.time}
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  c.status === 'Completed'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                  {c.status}
                                </span>
                              </div>
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
                <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-outline-variant p-8 flex flex-col items-center gap-3">
                  <FileText className="text-slate-300 w-16 h-16" />
                  <div className="text-lg font-bold text-slate-800">No Patient Records Found</div>
                  <p className="text-slate-500 max-w-sm">No clinical notes or consultations match your search. Make sure the spelling is correct or check the appointment filters.</p>
                  <button
                    onClick={onStartNewConsultation}
                    className="mt-2 inline-flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg font-medium shadow transition-all hover:bg-opacity-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add First Consultation</span>
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Owner clinic management (invite code, members, approvals) */}
      {manageOpen && activeClinic?.role === 'owner' && (
        <ClinicMembersModal
          clinic={activeClinic}
          authToken={authToken}
          onClose={() => setManageOpen(false)}
          onChanged={onClinicChanged}
        />
      )}
    </div>
  );
}
