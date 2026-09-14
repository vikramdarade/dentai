import React, { useState } from 'react';
import { Search, FileText } from 'lucide-react';
import { Consultation, getTodayStr, getYesterdayStr } from '../types';
import { motion } from 'motion/react';
import TreatmentPipeline from './TreatmentPipeline';
import DayScheduleQueue from './DayScheduleQueue';
import ErrorBoundary from './ErrorBoundary';
import { DayScheduleItem } from '../lib/dayScheduleStorage';
import { isPmsPreviewEnabled } from '../utils/previewMode';
import { ClinicMembership } from '../lib/clinics';
import CockpitLayout from './CockpitLayout';
import PracticeSettingsModal from './PracticeSettingsModal';
import { SurgeryIslandProvider, SurgeryIslandHUD } from '../context/SurgeryIslandContext';

interface HistoryHubProps {
  consultations: Consultation[];
  onSelectConsultation: (consultation: Consultation) => void;
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

function HistoryHubInner({
  consultations,
  onSelectConsultation,
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
  const [previewEnabled] = useState(() => isPmsPreviewEnabled());
  const [hubTab, setHubTab] = useState<'schedule' | 'records' | 'pipeline'>('schedule');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

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

  return (
    <>
      <SurgeryIslandHUD onSelectSchedule={() => setHubTab('schedule')} />

      {previewEnabled && hubTab === 'schedule' ? (
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
            onClinicChanged={onClinicChanged}
            onJoinClinic={onJoinClinic}
          />
        </ErrorBoundary>
      ) : (
        <CockpitLayout
          dentistName={dentistName}
          token={authToken}
          clinicId={activeClinic?.clinicId}
          clinicName={activeClinic?.clinicName}
          onLogout={onLogout}
          activeTab={hubTab === 'schedule' ? 'roster' : hubTab === 'pipeline' ? 'pipeline' : 'patients'}
          onTabChange={(tab) => {
            if (tab === 'roster') setHubTab('schedule');
            else if (tab === 'pipeline') setHubTab('pipeline');
            else if (tab === 'patients') setHubTab('records');
            else if (tab === 'settings') setShowSettingsModal(true);
          }}
        >
          <div className="w-full max-w-6xl mx-auto space-y-5 text-slate-100 font-sans pb-16">

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
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                            {headerLabel}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 font-semibold">
                            ({dateConsultations.length} {dateConsultations.length === 1 ? 'record' : 'records'})
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {dateConsultations.map((c) => {
                            const initials = `${c.firstName[0] || ''}${c.lastName[0] || ''}`.toUpperCase();

                            return (
                              <motion.div
                                key={c.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: idx * 0.03 }}
                                onClick={() => onSelectConsultation(c)}
                                className="group p-4 bg-[#0A1018] hover:bg-[#0E1724] border border-[#182638] hover:border-cyan-500/40 rounded-2xl transition-all cursor-pointer shadow-md shadow-black/30 hover:shadow-cyan-950/40 flex flex-col justify-between gap-4"
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${getAvatarBg(initials)}`}>
                                    {initials}
                                  </div>

                                  <div className="flex flex-col min-w-0 flex-1">
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
                      <p className="text-slate-400 text-xs max-w-sm">No clinical notes match your search query. Verify the spelling or select a patient from the daily roster.</p>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* Surgery Cockpit & Practice Settings Modal */}
            <PracticeSettingsModal
              isOpen={showSettingsModal}
              onClose={() => setShowSettingsModal(false)}
              dentistName={dentistName}
              activeClinic={activeClinic}
            />

          </div>
        </CockpitLayout>
      )}
    </>
  );
}

export default function HistoryHub(props: HistoryHubProps) {
  return (
    <SurgeryIslandProvider
      authToken={props.authToken}
      dentistName={props.dentistName}
    >
      <HistoryHubInner {...props} />
    </SurgeryIslandProvider>
  );
}
