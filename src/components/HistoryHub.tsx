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
          <div className="w-full max-w-6xl mx-auto space-y-5 text-slate-900 font-sans pb-16">

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
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Patient Records Hub</h2>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Search and review archived clinical charts, generated SOAP notes, and treatment quotes.
                    </p>
                  </div>

                  {/* Search Bar Component */}
                  <div className="relative w-full sm:w-80 group">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none group-focus-within:text-cyan-600 transition-colors" />
                    <input
                      type="text"
                      placeholder="Search patient name, tooth, or note..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-10 pl-10 pr-4 bg-white border border-slate-200 rounded-xl focus:border-[#0071E3] focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-xs font-semibold text-slate-900 placeholder:text-slate-400 shadow-2xs"
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
                          <span className="text-xs font-bold uppercase tracking-wider text-cyan-800">
                            {headerLabel}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500 font-semibold">
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
                                className="group p-4 bg-white hover:bg-slate-50/80 border border-slate-200/90 hover:border-cyan-400/50 rounded-2xl transition-all cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between gap-4"
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${getAvatarBg(initials)}`}>
                                    {initials}
                                  </div>

                                  <div className="flex flex-col min-w-0 flex-1">
                                    <span className="font-bold text-slate-900 text-sm truncate">
                                      {c.firstName} {c.lastName}
                                    </span>
                                    <span className="text-slate-500 font-mono text-xs truncate">
                                      {getProcedureLabel(c.appointmentType)}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                                  <span className="text-cyan-700 font-mono text-xs font-bold">
                                    {c.time}
                                  </span>
                                  <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider font-mono ${
                                    c.status === 'Completed'
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                      : 'bg-amber-50 text-amber-800 border border-amber-200'
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
                    <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-200 p-8 flex flex-col items-center gap-3 shadow-xs">
                      <FileText className="text-slate-400 w-12 h-12" />
                      <div className="text-base font-bold text-slate-900">No Patient Records Found</div>
                      <p className="text-slate-500 text-xs max-w-sm">No clinical notes match your search query. Verify the spelling or select a patient from the daily roster.</p>
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
