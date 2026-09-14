import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Users,
  FileText,
  Settings,
  Image as ImageIcon,
  Activity,
  LogOut,
  Bell,
  Sparkles,
  ChevronRight,
  Stethoscope,
  X,
  Sun,
  Moon,
  ShieldCheck,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../context/ThemeContext';
import { FounderExecutiveDashboard } from './FounderExecutiveDashboard';
import { ClinicFeedbackModal } from './ClinicFeedbackModal';

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
  const { theme, toggleTheme } = useTheme();

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

  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans select-none transition-colors ${
      theme === 'light' ? 'bg-slate-100 text-slate-900' : 'bg-[#070B11] text-slate-100'
    }`}>
      {/* 1. Left Vertical Surgery Nav Rail (Machined Doppelrand Bezel) */}
      <aside className={`w-16 md:w-20 shrink-0 flex flex-col items-center py-4 justify-between z-30 shadow-xl transition-colors border-r ${
        theme === 'light'
          ? 'bg-white border-slate-200 shadow-slate-200/50'
          : 'bg-[#0A1018] border-[#182638] shadow-black/40'
      }`}>
        {/* Top Logo Bezel */}
        <div className="flex flex-col items-center gap-5 w-full">
          <div className={`p-0.5 rounded-2xl border shadow-lg ${
            theme === 'light'
              ? 'bg-gradient-to-b from-cyan-100 via-teal-50 to-transparent border-cyan-300 shadow-cyan-500/10'
              : 'bg-gradient-to-b from-cyan-500/30 via-teal-500/10 to-transparent border-cyan-500/30 shadow-cyan-950/40'
          }`}>
            <div className={`w-10 h-10 md:w-11 md:h-11 rounded-[calc(1rem-2px)] flex items-center justify-center cursor-pointer hover:scale-105 transition-transform ${
              theme === 'light' ? 'bg-white text-cyan-600' : 'bg-[#0E1724] text-cyan-400'
            }`}>
              <Sparkles className="w-5 h-5 fill-current" />
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col items-center gap-2 w-full px-2">
            {/* Patients / Records */}
            <button
              onClick={() => handleNavClick('patients')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer ${
                activeNav === 'patients'
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Patient Records Hub"
            >
              <Users className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Records</span>
            </button>

            {/* Visualizer Studio */}
            <button
              onClick={() => handleNavClick('visualizer')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer ${
                activeNav === 'visualizer'
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Chairside Visualizer Studio (4 Paradigms)"
            >
              <Activity className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Studio</span>
              {activeNav === 'visualizer' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-400 rounded-r-full shadow-sm shadow-cyan-400" />
              )}
            </button>

            {/* Roster (Active Default) */}
            <button
              onClick={() => handleNavClick('roster')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                activeNav === 'roster'
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Daily Patient Roster"
            >
              <Calendar className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-extrabold mt-1 tracking-tight">Roster</span>
              {activeNav === 'roster' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-400 rounded-r-full shadow-sm shadow-cyan-400" />
              )}
            </button>

            {/* Treatment Pipeline */}
            <button
              onClick={() => handleNavClick('pipeline')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer ${
                activeNav === 'pipeline'
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Treatment Pipeline & Revenue"
            >
              <Sparkles className="w-5 h-5 stroke-[1.75] text-amber-500" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Pipeline</span>
            </button>

            {/* Charting */}
            <button
              onClick={() => handleNavClick('charting')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer ${
                activeNav === 'charting'
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="FDI Dental Charting"
            >
              <Activity className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Charting</span>
            </button>

            {/* Imaging */}
            <button
              onClick={() => handleNavClick('imaging')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer ${
                activeNav === 'imaging'
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Dental Imaging & Radiographs"
            >
              <ImageIcon className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Imaging</span>
            </button>

            {/* Settings */}
            <button
              onClick={() => handleNavClick('settings')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer ${
                activeNav === 'settings'
                  ? theme === 'light'
                    ? 'bg-cyan-50 text-cyan-800 border border-cyan-300 shadow-xs'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : theme === 'light'
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Practice Settings"
            >
              <Settings className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Settings</span>
            </button>

            {/* SOLO FOUNDER EXECUTIVE COCKPIT (Visible ONLY to Founder) */}
            {userIsFounder && (
              <button
                onClick={() => handleNavClick('executive')}
                className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                  activeNav === 'executive'
                    ? theme === 'light'
                      ? 'bg-blue-50 text-blue-800 border border-blue-300 shadow-xs'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-xs'
                    : theme === 'light'
                    ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
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

        {/* Theme Toggle, Help/Feedback & Bottom User Avatar & Logout */}
        <div className={`flex flex-col items-center gap-2.5 w-full px-2 pt-3 border-t ${
          theme === 'light' ? 'border-slate-200' : 'border-[#182638]'
        }`}>
          {/* Clinic Support & Feedback Trigger */}
          <button
            onClick={() => setShowFeedbackModal(true)}
            className={`p-2 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
              theme === 'light'
                ? 'text-slate-500 hover:text-blue-600 hover:bg-blue-50'
                : 'text-slate-400 hover:text-blue-400 hover:bg-[#162232]'
            }`}
            title="Clinic Help & Feedback"
            aria-label="Clinic Help and Feedback"
          >
            <HelpCircle className="w-4 h-4 stroke-[1.75]" />
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-xl transition-colors cursor-pointer flex items-center justify-center group ${
              theme === 'light'
                ? 'text-slate-600 hover:text-amber-600 hover:bg-slate-100'
                : 'text-slate-400 hover:text-amber-300 hover:bg-[#162232]'
            }`}
            title={theme === 'dark' ? 'Switch to Clinical Light Mode' : 'Switch to Dark Cockpit Mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400 group-hover:rotate-45 transition-transform" />
            ) : (
              <Moon className="w-4 h-4 text-cyan-600 group-hover:-rotate-12 transition-transform" />
            )}
          </button>

          <div
            className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-600 via-teal-500 to-emerald-400 p-0.5 flex items-center justify-center shadow-md cursor-pointer hover:scale-105 transition-transform"
            title={dentistName}
          >
            <div className={`w-full h-full rounded-full flex items-center justify-center font-extrabold text-xs ${
              theme === 'light' ? 'bg-white text-cyan-700' : 'bg-[#0A1018] text-cyan-300'
            }`}>
              {initials}
            </div>
          </div>
          <button
            onClick={onLogout}
            className={`p-2 rounded-xl transition-colors cursor-pointer ${
              theme === 'light'
                ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-50'
                : 'text-slate-400 hover:text-rose-400 hover:bg-[#162232]'
            }`}
            title="Logout"
          >
            <LogOut className="w-4 h-4 stroke-[1.75]" />
          </button>
        </div>
      </aside>

      {/* 2. Center Workspace (Roster Grid or Founder Executive Hub) */}
      <main className={`flex-1 flex flex-col min-w-0 overflow-hidden relative transition-colors ${
        theme === 'light' ? 'bg-slate-50' : 'bg-[#070B11]'
      }`}>
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
              className={`hidden lg:block h-full shrink-0 overflow-hidden shadow-2xl transition-colors border-l ${
                theme === 'light' ? 'border-slate-200 bg-white' : 'border-[#182638] bg-[#0A1018]'
              }`}
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
              className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] max-w-[92vw] h-full shadow-2xl lg:hidden flex flex-col transition-colors border-l ${
                theme === 'light' ? 'bg-white border-slate-200' : 'bg-[#0A1018] border-[#182638]'
              }`}
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
