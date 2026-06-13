import React, { useState } from 'react';
import { Search, Plus, FileText, User, ArrowRight, Menu } from 'lucide-react';
import { Consultation } from '../types';
import { motion } from 'motion/react';

interface HistoryHubProps {
  consultations: Consultation[];
  onSelectConsultation: (consultation: Consultation) => void;
  onStartNewConsultation: () => void;
}

export default function HistoryHub({
  consultations,
  onSelectConsultation,
  onStartNewConsultation
}: HistoryHubProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filtering based on search query
  const filtered = consultations.filter((c) => {
    const term = searchQuery.toLowerCase();
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    const type = c.appointmentType.toLowerCase();
    const notesHeading = c.findings.chiefComplaint.toLowerCase();
    return fullName.includes(term) || type.includes(term) || notesHeading.includes(term);
  });

  // Group by date
  // Since we have a static set of dates, let's group dynamically or categorize
  const todayConsultations = filtered.filter(c => c.date.includes('Oct 24'));
  const yesterdayConsultations = filtered.filter(c => !c.date.includes('Oct 24'));

  // Utility to map type to label
  const getProcedureLabel = (type: string) => {
    switch (type) {
      case 'emergency':
        return 'Emergency Extraction Consultation';
      case 'examination':
        return 'Routine Prophylaxis & Exam';
      case 'scale_clean':
        return 'Invisalign Progress Check';
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
          <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-primary font-bold text-xs">
            DH
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
          {/* Today's Section */}
          {todayConsultations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-outline-variant"></div>
                <span className="font-label-sm text-slate-400 uppercase tracking-widest text-[11px] font-bold">
                  Today, Oct 24
                </span>
                <div className="h-px flex-1 bg-outline-variant"></div>
              </div>

              <div className="space-y-3">
                {todayConsultations.map((c) => {
                  const initials = `${c.firstName[0]}${c.lastName[0]}`;
                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onSelectConsultation(c)}
                      className="bg-white border border-outline-variant rounded-xl p-4 flex items-center justify-between shadow-sm hover:border-primary transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-12 h-12 rounded-full ${getAvatarBg(
                            initials
                          )} flex items-center justify-center font-bold text-base`}
                        >
                          {initials}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800 text-lg group-hover:text-primary transition-colors">
                            {c.firstName} {c.lastName}
                          </span>
                          <span className="text-secondary font-body-md text-slate-500">
                            {getProcedureLabel(c.appointmentType)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 text-right">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                            c.status === 'Completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-indigo-50 text-indigo-700 font-medium'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              c.status === 'Completed' ? 'bg-emerald-600' : 'bg-indigo-600'
                            }`}
                          ></span>
                          {c.status}
                        </span>
                        <span className="font-label-sm text-slate-400 text-xs">
                          {c.time}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Yesterday's Section */}
          {yesterdayConsultations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1 pt-2">
                <div className="h-px flex-1 bg-outline-variant"></div>
                <span className="font-label-sm text-slate-400 uppercase tracking-widest text-[11px] font-bold">
                  Yesterday, Oct 23
                </span>
                <div className="h-px flex-1 bg-outline-variant"></div>
              </div>

              <div className="space-y-3">
                {yesterdayConsultations.map((c) => {
                  const initials = `${c.firstName[0]}${c.lastName[0]}`;
                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onSelectConsultation(c)}
                      className="bg-white border border-outline-variant rounded-xl p-4 flex items-center justify-between shadow-sm hover:border-primary transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-12 h-12 rounded-full ${getAvatarBg(
                            initials
                          )} flex items-center justify-center font-bold text-base`}
                        >
                          {initials}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800 text-lg group-hover:text-primary transition-colors">
                            {c.firstName} {c.lastName}
                          </span>
                          <span className="text-secondary font-body-md text-slate-500">
                            {getProcedureLabel(c.appointmentType)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 text-right">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                            c.status === 'Completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-indigo-50 text-indigo-700 font-medium'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              c.status === 'Completed' ? 'bg-emerald-600' : 'bg-indigo-600'
                            }`}
                          ></span>
                          {c.status}
                        </span>
                        <span className="font-label-sm text-slate-400 text-xs">
                          {c.time}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

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

      {/* Floating Action Button for mobile screen */}
      <div className="fixed bottom-24 right-6 md:hidden z-40">
        <button
          onClick={onStartNewConsultation}
          className="w-14 h-14 bg-primary-container text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform"
        >
          <Plus className="w-8 h-8" />
        </button>
      </div>

      {/* Bottom Nav Bar (Shared element mimicking screenshot mobile nav shell) */}
      <nav id="mobile-home-nav" className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 h-20 pb-safe bg-white border-t border-outline-variant md:hidden shadow-lg">
        <div className="flex flex-col items-center justify-center text-primary font-bold transition-all p-2 rounded-xl">
          <FileText className="w-6 h-6" />
          <span className="font-label-sm text-[11px] mt-1 font-semibold">History</span>
        </div>
        <button
          onClick={onStartNewConsultation}
          className="flex flex-col items-center justify-center text-slate-400 hover:text-primary transition-all p-2"
        >
          <Plus className="w-6 h-6 animate-pulse" />
          <span className="font-label-sm text-[11px] mt-1">Add Consult</span>
        </button>
        <div className="flex flex-col items-center justify-center text-slate-400 hover:text-primary transition-all p-2">
          <User className="w-6 h-6" />
          <span className="font-label-sm text-[11px] mt-1">Profile</span>
        </div>
      </nav>
    </div>
  );
}
