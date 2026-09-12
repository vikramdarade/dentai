import React, { useState } from 'react';
import { X, Settings, Key, ShieldCheck, Sun, Moon, ExternalLink, Building2, Check, AlertCircle } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { ClinicMembership } from '../lib/clinics';

interface PracticeSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dentistName: string;
  activeClinic?: ClinicMembership | null;
  onManageClinic?: () => void;
}

export default function PracticeSettingsModal({
  isOpen,
  onClose,
  dentistName,
  activeClinic,
  onManageClinic
}: PracticeSettingsModalProps) {
  const { theme, toggleTheme } = useTheme();
  const [apiKeyInput, setApiKeyInput] = useState(() => {
    return localStorage.getItem('dentai_custom_gemini_key') || '';
  });
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSaveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (trimmed) {
      localStorage.setItem('dentai_custom_gemini_key', trimmed);
    } else {
      localStorage.removeItem('dentai_custom_gemini_key');
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#0A1018] border border-[#182638] rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col text-slate-100 text-left">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#182638] bg-[#0E1724]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">Practice & Surgery Cockpit Settings</h2>
              <p className="text-[11px] text-slate-400">
                Clinician: {dentistName} • Australian Dental Board Standards
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Section 1: AI Vision & Scribing API Key */}
          <div className="p-4 bg-[#0E1724] border border-[#182638] rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Google Gemini AI Vision & Scribe Key
                </h3>
              </div>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-cyan-400 hover:text-cyan-300 underline inline-flex items-center gap-1 font-medium"
              >
                Get Free Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Required for real-time D4W / Praktika schedule OCR and ambient operatory dialogue transcription. Google AI Studio provides a free tier with 15 requests per minute and 0 credit card required.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy... or AQ.Ab8RN..."
                className="flex-1 px-3.5 py-2 bg-[#070B11] border border-[#1E3048] focus:border-cyan-400 rounded-xl text-xs text-white font-mono placeholder-slate-600 focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleSaveApiKey}
                className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black text-xs rounded-xl shadow cursor-pointer active:scale-95 transition-all shrink-0"
              >
                {saveSuccess ? 'Saved ✓' : 'Save Key'}
              </button>
            </div>

            {saveSuccess && (
              <p className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                Key saved to your browser! Schedule screenshots will now be processed using your personal quota.
              </p>
            )}
          </div>

          {/* Section 2: Clinical Display & Appearance */}
          <div className="p-4 bg-[#0E1724] border border-[#182638] rounded-2xl flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Operatory Lighting Theme
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Switch between Dark Cockpit Mode and Clinical Light Mode
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#121E2E] hover:bg-[#18283D] border border-[#1E3048] rounded-xl text-xs font-bold text-slate-200 cursor-pointer"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-cyan-600" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>
          </div>

          {/* Section 3: Active Clinic & Team Multi-Chair */}
          <div className="p-4 bg-[#0E1724] border border-[#182638] rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Clinic Profile & Multi-Chair
                </h3>
              </div>
              {onManageClinic && activeClinic?.role === 'owner' && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onManageClinic();
                  }}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-bold underline cursor-pointer"
                >
                  Manage Roster & Locums
                </button>
              )}
            </div>

            <p className="text-xs text-slate-300">
              Active Practice: <strong className="text-white">{activeClinic?.clinicName || 'Default Practice'}</strong>
            </p>
            <p className="text-[11px] text-slate-400">
              Role: <span className="font-semibold text-cyan-300 capitalize">{activeClinic?.role || 'Clinician'}</span>
              {activeClinic?.role === 'owner' && ' (Practice Owner tier with centralized multi-chair compliance)'}
            </p>
          </div>

          {/* Section 4: Australian Privacy & Consent Audit */}
          <div className="p-4 bg-[#0E1724] border border-[#182638] rounded-2xl space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Privacy Act 1988 Compliance
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              All operatory transcripts are verified against verbatim audio dialogue before clinical notes are generated. Verbal consent captures are logged with timestamp and practitioner ID for internal practice audit trails.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#182638] bg-[#0E1724] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black text-xs rounded-xl shadow cursor-pointer active:scale-95 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
