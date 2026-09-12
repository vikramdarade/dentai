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
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../context/ThemeContext';

interface CockpitLayoutProps {
  dentistName: string;
  onLogout: () => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  children: React.ReactNode;
  rightDrawer?: React.ReactNode;
  onDrawerClose?: () => void;
}

export default function CockpitLayout({
  dentistName,
  onLogout,
  activeTab = 'roster',
  onTabChange,
  children,
  rightDrawer,
  onDrawerClose
}: CockpitLayoutProps) {
  const [activeNav, setActiveNav] = useState(activeTab);
  const { theme, toggleTheme } = useTheme();

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
    <div className="flex h-screen w-full bg-[#070B11] text-slate-100 overflow-hidden font-sans select-none">
      {/* 1. Left Vertical Surgery Nav Rail (Machined Doppelrand Bezel) */}
      <aside className="w-16 md:w-20 shrink-0 bg-[#0A1018] border-r border-[#182638] flex flex-col items-center py-4 justify-between z-30 shadow-xl shadow-black/40">
        {/* Top Logo Bezel */}
        <div className="flex flex-col items-center gap-5 w-full">
          <div className="p-0.5 rounded-2xl bg-gradient-to-b from-cyan-500/30 via-teal-500/10 to-transparent border border-cyan-500/30 shadow-lg shadow-cyan-950/40">
            <div className="w-10 h-10 md:w-11 md:h-11 rounded-[calc(1rem-2px)] bg-[#0E1724] flex items-center justify-center text-cyan-400 cursor-pointer hover:scale-105 transition-transform">
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
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Patient Records Hub"
            >
              <Users className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Records</span>
            </button>

            {/* Roster (Active Default) */}
            <button
              onClick={() => handleNavClick('roster')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer relative ${
                activeNav === 'roster'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
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
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Treatment Pipeline & Revenue"
            >
              <Sparkles className="w-5 h-5 stroke-[1.75] text-amber-400" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Pipeline</span>
            </button>

            {/* Charting */}
            <button
              onClick={() => handleNavClick('charting')}
              className={`flex flex-col items-center justify-center w-full py-2.5 rounded-xl transition-all active:scale-95 cursor-pointer ${
                activeNav === 'charting'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
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
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
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
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#121E2E]'
              }`}
              title="Practice Settings"
            >
              <Settings className="w-5 h-5 stroke-[1.75]" />
              <span className="text-[10px] font-bold mt-1 tracking-tight">Settings</span>
            </button>
          </nav>
        </div>

        {/* Theme Toggle & Bottom User Avatar & Logout */}
        <div className="flex flex-col items-center gap-2.5 w-full px-2 pt-3 border-t border-[#182638]">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl text-slate-400 hover:text-amber-300 hover:bg-[#162232] dark:hover:bg-[#162232] transition-colors cursor-pointer flex items-center justify-center group"
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
            <div className="w-full h-full rounded-full bg-[#0A1018] flex items-center justify-center text-cyan-300 font-extrabold text-xs">
              {initials}
            </div>
          </div>
          <button
            onClick={onLogout}
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-[#162232] rounded-xl transition-colors cursor-pointer"
            title="Logout"
          >
            <LogOut className="w-4 h-4 stroke-[1.75]" />
          </button>
        </div>
      </aside>

      {/* 2. Center Workspace (Roster Grid & Day Schedule) */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#070B11] overflow-hidden relative">
        <div className="flex-1 overflow-y-auto cockpit-scrollbar p-3.5 sm:p-5 md:p-6 lg:p-7 xl:p-8">
          {children}
        </div>
      </main>

      {/* 3. Right Inspection Drawer - Dual Mode: Docked on Desktop, Slide-over on Tablet */}
      <AnimatePresence mode="wait">
        {rightDrawer && (
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
              className="hidden lg:block h-full shrink-0 border-l border-[#182638] bg-[#0A1018] overflow-hidden shadow-2xl"
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
              className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] max-w-[92vw] h-full bg-[#0A1018] border-l border-[#182638] shadow-2xl lg:hidden flex flex-col"
            >
              {rightDrawer}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

