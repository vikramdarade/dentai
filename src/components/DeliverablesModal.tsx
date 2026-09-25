import React from 'react';
import { FileText, Mail, AlertTriangle, ExternalLink, Check, Copy, X } from 'lucide-react';
import type { PatientEncounter } from './ChairsideWorkspace';

export interface DeliverablesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeEncounter: PatientEncounter | null;
  deliverablesActiveTab: 'referral' | 'postop';
  setDeliverablesActiveTab: (tab: 'referral' | 'postop') => void;
  getReferralText: () => string;
  getPostOpText: () => string;
  copiedDeliverable: string | null;
  setCopiedDeliverable: (val: string | null) => void;
}

export const DeliverablesModal: React.FC<DeliverablesModalProps> = ({
  isOpen,
  onClose,
  activeEncounter,
  deliverablesActiveTab,
  setDeliverablesActiveTab,
  getReferralText,
  getPostOpText,
  copiedDeliverable,
  setCopiedDeliverable,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 font-sans">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Patient Deliverables & Handover
              </h3>
              <p className="text-xs text-slate-500">
                {activeEncounter ? `${activeEncounter.patientName} • ${activeEncounter.procedureText}` : 'Active Patient'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <button
            type="button"
            onClick={() => setDeliverablesActiveTab('referral')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${deliverablesActiveTab === 'referral'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Specialist Referral Letter</span>
          </button>
          <button
            type="button"
            onClick={() => setDeliverablesActiveTab('postop')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${deliverablesActiveTab === 'postop'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Patient Post-Op Care Email</span>
          </button>
        </div>

        {/* Notice */}
        <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 flex items-start gap-2 text-[11px] text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <span>Grounded directly in this patient's clinical note and examination findings. Please review before sending.</span>
        </div>

        {/* Textarea */}
        <textarea
          readOnly
          rows={12}
          value={deliverablesActiveTab === 'referral' ? getReferralText() : getPostOpText()}
          className="w-full p-3.5 text-xs font-mono border border-slate-200 rounded-xl bg-slate-50 leading-relaxed text-slate-800 select-all"
        />

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <div>
            {deliverablesActiveTab === 'postop' && (
              <a
                href={`mailto:?subject=${encodeURIComponent(`Post-Operative Care Instructions — ${activeEncounter?.patientName || 'Patient'}`)}&body=${encodeURIComponent(getPostOpText())}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Email App</span>
              </a>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                const text = deliverablesActiveTab === 'referral' ? getReferralText() : getPostOpText();
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(text);
                }
                setCopiedDeliverable(deliverablesActiveTab);
                setTimeout(() => setCopiedDeliverable(null), 2000);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-sm flex items-center space-x-1.5"
            >
              {copiedDeliverable === deliverablesActiveTab ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Copied to Clipboard!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>
                    {deliverablesActiveTab === 'referral' ? 'Copy Referral Letter' : 'Copy Post-Op Email'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
