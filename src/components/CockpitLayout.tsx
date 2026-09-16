import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Users,
  Settings,
  LogOut,
  Sparkles,
  ShieldCheck,
  HelpCircle,
  Columns4
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FounderExecutiveDashboard } from './FounderExecutiveDashboard';
import { ClinicFeedbackModal } from './ClinicFeedbackModal';
import OperatoryCommandCenter from './OperatoryCommandCenter';

interface CockpitLayoutProps {
  dentistName: string;
  onLogout: () => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  children: React.ReactNode;
  rightDrawer?: React.ReactNode;
  onDrawerClose?: () => void;
  isFounder?: boolean;
  token?: string | null;
  clinicName?: string;
  clinicId?: string;
}

export default function CockpitLayout({
  dentistName,
  onLogout,
  activeTab = 'roster',
  onTabChange,
  children,
  rightDrawer,
  onDrawerClose,
  isFounder,
  token,
  clinicName,
  clinicId
}: CockpitLayoutProps) {
  const [activeNav, setActiveNav] = useState(activeTab);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [cockpitMode, setCockpitMode] = useState<'standard' | 'quad'>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return (window.localStorage.getItem('dentai_cockpit_view_mode') as 'standard' | 'quad') || 'standard';
    }
    return 'standard';
  });

  // Founder authorization check
  const userIsFounder = isFounder ?? (
    dentistName?.toLowerCase().includes('vikram') ||
    dentistName?.toLowerCase() === 'vik' ||
    false
  );

  useEffect(() => {
    setActiveNav(activeTab);
  }, [activeTab]);

  const handleNavClick = (id: string) => {
    setActiveNav(id);
    onTabChange?.(id);
  };

  const initials = dentistName
    .split(' ')
    .filter(n => n.toLowerCase() !== 'dr.')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'DV';

  if (cockpitMode === 'quad') {
    return (
      <OperatoryCommandCenter
        dentistName={dentistName}
        dentistId={token || 'dentist'}
        token={token}
        onSwitchToStandard={() => {
          localStorage.setItem('dentai_cockpit_view_mode', 'standard');
          setCockpitMode('standard');
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans select-none bg-slate-50 text-slate-900">
      {/* 1. Left Vertical Surgery Nav Rail (Apple Medical Grade Machined Bezel) */}
      <aside className="w-16 md:w-20 shrink-0 flex flex-col items-center py-4 justify-between z-30 shadow-xs border-r bg-white border-slate-200/90">
        {/* Top Logo Bezel */}
        <div className="flex flex-col items-center gap-5 w-full">
          <div className="p-0.5 rounded-2xl border bg-gradient-to-b from-cyan-100 via-teal-50 to-transparent border-cyan-300 shadow-xs">
            <div className="w-10 h-10 md:w-11 md:h-11 rounded-[calc(1rem-2px)] flex items-center justify-center cursor-pointer hover:scale-105 transition-transform bg-white text-cyan-600">
              <Sparkles className="w-5 h-5 fill-current" />
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col items-center gap-2 w-full px-2">
            {/* Patients / Records */}
            <button
              onClick={() => handleNavClick('patients')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                activeNav === 'patients'
                  ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Patient Records Hub"
            >
              <Users className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Records</span>
              {activeNav === 'patients' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-500 rounded-r-full shadow-sm shadow-cyan-400" />
              )}
            </button>

            {/* Roster (Active Default) */}
            <button
              onClick={() => handleNavClick('roster')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                activeNav === 'roster'
                  ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Daily Patient Roster"
            >
              <Calendar className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-extrabold mt-1 tracking-tight">Roster</span>
              {activeNav === 'roster' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-500 rounded-r-full shadow-sm shadow-cyan-400" />
              )}
            </button>

            {/* Treatment Pipeline */}
            <button
              onClick={() => handleNavClick('pipeline')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                activeNav === 'pipeline'
                  ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Treatment Pipeline & Revenue"
            >
              <Sparkles className="w-5 h-5 stroke-[1.75] text-amber-500" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Pipeline</span>
              {activeNav === 'pipeline' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-500 rounded-r-full shadow-sm shadow-cyan-400" />
              )}
            </button>

            {/* Settings */}
            <button
              onClick={() => handleNavClick('settings')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                activeNav === 'settings'
                  ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Practice Settings"
            >
              <Settings className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Settings</span>
              {activeNav === 'settings' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-500 rounded-r-full shadow-sm shadow-cyan-400" />
              )}
            </button>

            {/* 4-Slice Command Center A/B Mode Toggle */}
            <button
              onClick={() => {
                localStorage.setItem('dentai_cockpit_view_mode', 'quad');
                setCockpitMode('quad');
              }}
              className="flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer text-slate-500 hover:text-cyan-800 hover:bg-cyan-50"
              title="Switch to 4-Slice Command Center"
              data-testid="switch-to-4slice-btn"
            >
              <Columns4 className="w-5 h-5 stroke-[1.75] text-cyan-600" />
              <span className="text-[10px] font-bold mt-1 tracking-tight text-cyan-800">4-Slice</span>
            </button>

            {/* SOLO FOUNDER EXECUTIVE COCKPIT (Visible ONLY to Founder) */}
            {userIsFounder && (
              <button
                onClick={() => handleNavClick('executive')}
                className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                  activeNav === 'executive'
                    ? 'bg-blue-50 text-blue-800 border border-blue-300 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Solo Founder Executive Hub"
              >
                <ShieldCheck className="w-5 h-5 stroke-[1.75] text-blue-500" />
                <span className="text-[10px] font-extrabold mt-1 tracking-tight">Executive</span>
                {activeNav === 'executive' && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-r-full shadow-sm shadow-blue-400" />
                )}
              </button>
            )}
          </nav>
        </div>

        {/* Clinic Help/Feedback, User Avatar & Logout */}
        <div className="flex flex-col items-center gap-2.5 w-full px-2 pt-3 border-t border-slate-200">
          {/* Clinic Support & Feedback Trigger */}
          <button
            onClick={() => setShowFeedbackModal(true)}
            className="p-2 rounded-xl transition-colors cursor-pointer flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50"
            title="Clinic Help & Feedback"
            aria-label="Clinic Help and Feedback"
          >
            <HelpCircle className="w-4 h-4 stroke-[1.75]" />
          </button>

          <div
            className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-600 via-teal-500 to-emerald-400 p-0.5 flex items-center justify-center shadow-md cursor-pointer hover:scale-105 transition-transform"
            title={dentistName}
            data-testid="dentist-profile-avatar"
            aria-label={dentistName}
          >
            <div className="w-full h-full rounded-full flex items-center justify-center font-extrabold text-xs bg-white text-cyan-700">
              {initials}
            </div>
          </div>
          <span data-testid="dentist-name-badge" className="sr-only">
            {dentistName}
          </span>
          <button
            onClick={onLogout}
            className="p-2 rounded-xl transition-colors cursor-pointer text-slate-500 hover:text-rose-600 hover:bg-rose-50"
            title="Logout"
          >
            <LogOut className="w-4 h-4 stroke-[1.75]" />
          </button>
        </div>
      </aside>

      {/* 2. Center Workspace (Roster Grid or Founder Executive Hub) */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative transition-colors bg-slate-50">
        <div className="flex-1 overflow-y-auto cockpit-scrollbar p-3.5 sm:p-5 md:p-6 lg:p-7 xl:p-8">
          {activeNav === 'executive' && userIsFounder ? (
            <FounderExecutiveDashboard
              token={token || localStorage.getItem('dentai_token')}
              isFounder={userIsFounder}
              dentistName={dentistName}
              onBackToOperatory={() => handleNavClick('roster')}
            />
          ) : (
            children
          )}
        </div>
      </main>

      {/* 3. Right Inspection Drawer - Dual Mode: Docked on Desktop, Slide-over on Tablet */}
      <AnimatePresence mode="wait">
        {rightDrawer && activeNav !== 'executive' && (
          <>
            {/* Tablet/Mobile Backdrop Overlay (<lg) */}
            <motion.div
              key="drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onDrawerClose}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden cursor-pointer"
            />

            {/* Desktop Docked Drawer (lg+) */}
            <motion.div
              key="drawer-desktop"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="hidden lg:block h-full shrink-0 overflow-hidden shadow-2xl transition-colors border-l border-slate-200/90 bg-white"
            >
              {rightDrawer}
            </motion.div>

            {/* Tablet Slide-Over Drawer (<lg) */}
            <motion.div
              key="drawer-tablet"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 240 }}
              className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] max-w-[92vw] h-full shadow-2xl lg:hidden flex flex-col transition-colors border-l bg-white border-slate-200/90"
            >
              {rightDrawer}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 4. Clinic In-App Reporting & Support Modal */}
      <ClinicFeedbackModal
        isOpen={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        clinicId={clinicId}
        clinicName={clinicName}
        dentistName={dentistName}
        token={token}
      />
    </div>
  );
}
