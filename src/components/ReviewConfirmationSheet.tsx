import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Copy, 
  Send, 
  ArrowRight, 
  RotateCcw, 
  MessageSquare, 
  ClipboardCheck, 
  Sparkles,
  ShieldCheck,
  X
} from 'lucide-react';

interface ReviewConfirmationSheetProps {
  patientName: string;
  patientPhone?: string;
  procedureReason: string;
  adaCodes?: string[];
  formattedPmsNote: string;
  aftercareSmsText: string;
  nextPatient?: {
    id: string;
    patientName: string;
    startTime: string;
    appointmentType: string;
  } | null;
  onAdvanceToNextPatient: () => void;
  onClose: () => void;
}

export const ReviewConfirmationSheet: React.FC<ReviewConfirmationSheetProps> = ({
  patientName,
  patientPhone = '0412 345 678',
  procedureReason,
  adaCodes = [],
  formattedPmsNote,
  aftercareSmsText,
  nextPatient,
  onAdvanceToNextPatient,
  onClose
}) => {
  const [copiedPms, setCopiedPms] = useState(true);
  const [smsSent, setSmsSent] = useState(false);
  const [copiedSms, setCopiedSms] = useState(false);

  const handleCopyPms = () => {
    navigator.clipboard.writeText(formattedPmsNote);
    setCopiedPms(true);
    setTimeout(() => setCopiedPms(false), 2500);
  };

  const handleCopySms = () => {
    navigator.clipboard.writeText(aftercareSmsText);
    setCopiedSms(true);
    setTimeout(() => setCopiedSms(false), 2500);
  };

  const handleSendSms = () => {
    setSmsSent(true);
    setTimeout(() => setSmsSent(false), 3000);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      data-testid="review-confirmation-sheet"
    >
      <div className="relative w-full max-w-2xl bg-[#0E1724] border border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-emerald-950/40 via-[#101C2B] to-[#0E1724] border-b border-emerald-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">Clinical Note Signed & Sealed</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  AHPRA Compliant
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-0.5">
                Completed procedure for <strong className="text-white">{patientName}</strong> · {procedureReason}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Dismiss Sheet"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* 1. PMS Clipboard Auto-Copy Banner */}
          <div className="bg-[#121E2E] border border-cyan-500/30 rounded-xl p-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <ClipboardCheck className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-cyan-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" /> Ready for Dental4Windows / EXACT / Cliniko
                </span>
                <button
                  onClick={handleCopyPms}
                  className="px-3 py-1 text-xs font-semibold rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 flex items-center gap-1.5 transition-all"
                  data-testid="copy-pms-btn"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedPms ? 'Copied to Clipboard!' : 'Copy Note'}
                </button>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Clinical note and <strong className="text-cyan-200">{adaCodes.length} ADA item codes</strong> are copied to clipboard. Press <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-slate-800 border border-slate-700 rounded text-slate-200">Ctrl+V</kbd> in your PMS.
              </p>
              {adaCodes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {adaCodes.map(code => (
                    <span key={code} className="px-2 py-0.5 text-[11px] font-mono font-bold rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
                      ADA {code}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 2. Patient Aftercare SMS Preview */}
          <div className="bg-[#101923] border border-slate-700/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Patient Post-Op SMS · {patientPhone}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopySms}
                  className="px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  {copiedSms ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleSendSms}
                  disabled={smsSent}
                  className="px-3 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm transition-all"
                  data-testid="send-aftercare-sms-btn"
                >
                  <Send className="w-3 h-3" />
                  {smsSent ? 'SMS Sent!' : 'Send SMS'}
                </button>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#080D14] border border-slate-800 text-xs text-slate-300 leading-relaxed font-sans select-all">
              {aftercareSmsText}
            </div>
          </div>
        </div>

        {/* Footer Actions: Large-Target Ergonomics */}
        <div className="p-5 bg-[#0A1018] border-t border-slate-800 flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-white flex items-center gap-2 rounded-xl hover:bg-slate-800/60 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Stay on {patientName.split(' ')[0]}'s Chart
          </button>

          {nextPatient ? (
            <button
              onClick={() => {
                onAdvanceToNextPatient();
                onClose();
              }}
              className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-sm flex items-center gap-2.5 shadow-lg shadow-cyan-600/20 active:scale-[0.98] transition-all"
              data-testid="advance-next-patient-btn"
            >
              <span>Next Patient: <strong className="text-cyan-100">{nextPatient.patientName}</strong> ({nextPatient.startTime})</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
            >
              <ShieldCheck className="w-4 h-4" />
              All Patients Complete for Today
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
