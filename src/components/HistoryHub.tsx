import React, { useState } from 'react';
import { Search, Plus, FileText, User, ArrowRight, Menu } from 'lucide-react';
import { Consultation, getTodayStr, getYesterdayStr } from '../types';
import { motion } from 'motion/react';

interface HistoryHubProps {
  consultations: Consultation[];
  onSelectConsultation: (consultation: Consultation) => void;
  onStartNewConsultation: () => void;
  dentistName: string;
  onLogout: () => void;
}

export default function HistoryHub({
  consultations,
  onSelectConsultation,
  onStartNewConsultation,
  dentistName,
  onLogout
}: HistoryHubProps) {
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
        <div className="flex items-center gap-3">
          <Menu className="text-primary h-6 w-6 cursor-pointer" />
          <h1 className="font-headline-md text-headline-md font-bold text-primary">DentAI</h1>
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
        {/* Hero Section */}
        <section className="py-6 space-y-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface">History Hub</h2>
            <p className="text-secondary font-body-md text-slate-500">
              Manage and review clinical patient records. Select any past visit to review charts or start a new recording session.
            </p>
          </div>

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
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileHover={{ y: -2, scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => onSelectConsultation(c)}
                        className="p-1 bg-[#1a1a2e]/5 hover:bg-indigo-50/20 rounded-2xl cursor-pointer transition-all duration-300 hover:shadow-md border border-slate-200/40"
                      >
                        <div className="bg-white border border-slate-100 rounded-[calc(1rem-0.25rem)] p-4 flex items-center justify-between shadow-sm">
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-base shadow-sm ${getAvatarBg(
                                initials
                              )}`}
                            >
                              {initials}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-800 text-base group-hover:text-primary transition-colors">
                                {c.firstName} {c.lastName}
                              </span>
                              <span className="text-secondary font-body-md text-slate-500 text-xs mt-0.5">
                                {getProcedureLabel(c.appointmentType)}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 text-right">
                            <span
                              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                                c.status === 'Completed'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                  : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  c.status === 'Completed' ? 'bg-emerald-600' : 'bg-indigo-600'
                                }`}
                              ></span>
                              {c.status}
                            </span>
                            <span className="font-mono text-slate-400 text-xs">
                              {c.time}
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
      </main>
    </div>
  );
}
