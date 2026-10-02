import React, { useState } from 'react';
import {
  FileText,
  Sparkles,
  Copy,
  Check,
  CheckCircle2,
  Tag,
  Layers,
  RefreshCw,
  ArrowRight,
  PenLine,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import { CHAIRSIDE_MACRO_OPTIONS } from '../lib/australianClinicalMacros';
import { deriveFactsForDisplay } from '../lib/uiVerification';
import type { Consultation } from '../types';
import type { AttestationSeal } from '../lib/attestation';

export interface ClinicalNoteEditorPanelProps {
  activeEncounterId: string;
  noteText: string;
  onNoteChange: (text: string) => void;
  isGenerating: boolean;
  onGenerateNote: () => void;
  onApplyMacro: (macroId: string) => void;
  onCopyPMS: (format: 'd4w' | 'exact' | 'universal') => void;
  copiedFormat: string | null;
  onOpenDeliverables?: () => void;
  onNextPatient?: () => void;
  hasActualGeneratedNote?: boolean;
  groundingBadge?: string;
  /**
   * Phase 12: canonical facts as the SERVER recorded them (consultation record
   * from the last server response). Displayed verbatim — never re-derived,
   * re-verified or reconstructed client-side.
   */
  serverConsultation?: Consultation | null;
  /** recordVersion as last confirmed by the server (stale-write guard). */
  recordVersion?: number;
  /** Requests sign-off; the server validates and mints the seal. */
  onSignOff?: () => Promise<void>;
  /** True ONLY after the server's sign-off endpoint returned a seal. */
  isSignedByServer?: boolean;
  /** Server-minted seal to display; the client never generates one. */
  serverSeal?: AttestationSeal | null;
  /** Machine-readable refusal from the last sign-off attempt (409/422 class). */
  signOffError?: { code: string; message: string; currentVersion?: number } | null;
  /** Current operatory encounter lifecycle state */
  encounterState?: 'empty' | 'active' | 'finished';
  /** Whether Next Patient is unlocked and permitted to advance */
  canAdvanceNextPatient?: boolean;
  /** Explanatory message when Next Patient is locked */
  nextPatientLockReason?: string;
  /** Action to finish the current encounter, stopping recording and unlocking Next Patient */
  onFinishEncounter?: () => void;
  /** Loading state during finish encounter finalization */
  isFinishingEncounter?: boolean;
}

export const ClinicalNoteEditorPanel: React.FC<ClinicalNoteEditorPanelProps> = ({
  activeEncounterId,
  noteText,
  onNoteChange,
  isGenerating,
  onGenerateNote,
  onApplyMacro,
  onCopyPMS,
  copiedFormat,
  onOpenDeliverables,
  onNextPatient,
  groundingBadge,
  serverConsultation,
  recordVersion,
  onSignOff,
  isSignedByServer,
  signOffError,
  serverSeal,
  encounterState = 'active',
  canAdvanceNextPatient = true,
  nextPatientLockReason,
  onFinishEncounter,
  isFinishingEncounter = false,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'d4w' | 'exact' | 'universal'>(() => {
    try {
      const saved = localStorage.getItem('dentai_preferred_pms');
      if (saved === 'exact' || saved === 'universal' || saved === 'd4w') {
        return saved;
      }
    } catch {}
    return 'd4w';
  });

  const handleSelectFormat = (format: 'd4w' | 'exact' | 'universal') => {
    setSelectedFormat(format);
    try {
      localStorage.setItem('dentai_preferred_pms', format);
    } catch {}
  };

  // Phase 12: projection of the server's canonical facts for display only.
  const factRows = deriveFactsForDisplay(serverConsultation);

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_12px_-3px_rgba(15,23,42,0.04)] overflow-hidden">
      {/* Panel Header & 1-Click PMS Export Controls */}
      <div className="px-4 py-2.5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50/80">
        {/* Title & Grounding Verification Status */}
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-lg bg-sky-50 border border-sky-200/70 flex items-center justify-center text-sky-700 shadow-2xs">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-bold text-slate-800 tracking-tight">
            Clinical Note Canvas
          </h3>
          {/* Phase 5 (fail-closed): the badge reflects ONLY an actual grounding
              verdict. Note existence alone must never present as verified. */}
          {groundingBadge && (
            <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center space-x-1 shadow-2xs ${
              groundingBadge === 'Verified from Audio'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200/90'
                : 'bg-sky-50 text-sky-800 border-sky-200/90'
            }`}>
              <CheckCircle2 className={`w-3 h-3 ${groundingBadge === 'Verified from Audio' ? 'text-emerald-600' : 'text-sky-600'}`} />
              <span>{groundingBadge}</span>
            </span>
          )}
        </div>

        {/* Unified Primary Action Suite: Regenerate + PMS Format Switcher + Copy / Next Patient */}
        <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap">
          {/* Prominent Regenerate Note Button */}
          <button
            onClick={onGenerateNote}
            disabled={isGenerating}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-sky-300/80 bg-sky-50 hover:bg-sky-100/80 text-sky-800 disabled:opacity-50 text-xs font-semibold shadow-2xs cursor-pointer"
            title="Generate or recreate clinical note from consultation speech (⌘+G)"
          >
            {isGenerating ? (
              <RefreshCw className="w-3.5 h-3.5 text-sky-600 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-sky-600" />
            )}
            <span>{isGenerating ? 'Generating...' : 'Regenerate Note'}</span>
          </button>

          {/* PMS Format Selector (D4W, EXACT, Universal) */}
          <div className="flex rounded-xl border border-slate-200/90 bg-slate-100/70 p-0.5 shadow-2xs">
            <button
              onClick={() => handleSelectFormat('d4w')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg cursor-pointer ${
                selectedFormat === 'd4w'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              D4W
            </button>
            <button
              onClick={() => handleSelectFormat('exact')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg cursor-pointer ${
                selectedFormat === 'exact'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              EXACT
            </button>
            <button
              onClick={() => handleSelectFormat('universal')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg cursor-pointer ${
                selectedFormat === 'universal'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Universal
            </button>
          </div>

          {/* Copy to PMS */}
          <button
            onClick={() => onCopyPMS(selectedFormat)}
            disabled={!noteText.trim()}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl font-semibold text-xs shadow-xs cursor-pointer disabled:opacity-40 ${
              copiedFormat === selectedFormat
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400/40'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
            title="Copy formatted note to clipboard (⌘C)"
          >
            {copiedFormat === selectedFormat ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-200" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-sky-400" />
                <span>Copy to {selectedFormat.toUpperCase()}</span>
              </>
            )}
          </button>

          {/* Finish Encounter action — stops mic, saves note, and unlocks Next Patient */}
          {onFinishEncounter && encounterState === 'active' && (
            <button
              onClick={onFinishEncounter}
              disabled={isFinishingEncounter}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50 transition"
              title="Finish active encounter and unlock next patient"
            >
              {isFinishingEncounter ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-200" />
                  <span>Finishing...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-200" />
                  <span>Finish Encounter</span>
                </>
              )}
            </button>
          )}

          {encounterState === 'finished' && (
            <div className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Saved</span>
            </div>
          )}

          {/* Next Patient — state-guarded against accidental transition during active visit */}
          {onNextPatient && (
            canAdvanceNextPatient ? (
              <button
                onClick={onNextPatient}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm cursor-pointer animate-pulse transition"
                title="Advance to next patient (⌘→)"
              >
                <span>Next Patient</span>
                <ArrowRight className="w-3.5 h-3.5 text-white" />
              </button>
            ) : (
              <button
                disabled
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 text-xs font-semibold opacity-50 cursor-not-allowed"
                title={nextPatientLockReason || "Finish current encounter to unlock next patient"}
              >
                <span>Next Patient</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
              </button>
            )
          )}
        </div>
      </div>

      {/* Operatory Quick-Pick Macros Bar */}
      <div className="px-4 py-2 bg-slate-50/40 border-b border-slate-200/70 flex items-center justify-between gap-2 overflow-x-auto custom-scrollbar">
        <div className="flex items-center space-x-1.5 flex-nowrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1 mr-1">
            <Tag className="w-3 h-3 text-slate-400" />
            <span>Macros:</span>
          </span>
          {CHAIRSIDE_MACRO_OPTIONS.slice(0, 6).map(macro => (
            <button
              key={macro.id}
              onClick={() => onApplyMacro(macro.id)}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-sky-50 hover:border-sky-300 border border-slate-200/80 text-[11px] font-medium text-slate-700 whitespace-nowrap shadow-2xs cursor-pointer"
            >
              {macro.label}
            </button>
          ))}
        </div>

        {/* Secondary Operatory Tools */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {onOpenDeliverables && (
            <button
              onClick={onOpenDeliverables}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-2xs cursor-pointer"
              title="Post-op instructions, referrals & prescriptions"
            >
              <Layers className="w-3.5 h-3.5 text-sky-600" />
              <span>Deliverables</span>
            </button>
          )}
        </div>
      </div>

      {/* Full Monospace Clinical Note Canvas (Maximized Space, No SOAP Box Clutter) */}
      <div className="flex-1 p-3.5 bg-white flex flex-col min-h-[320px]">
        <textarea
          value={noteText}
          onChange={e => onNoteChange(e.target.value)}
          placeholder="Clinical note will generate automatically as consultation progresses, or click [Regenerate Note] / select a macro above..."
          className="w-full flex-1 p-3.5 rounded-xl border border-slate-200/90 text-xs font-mono text-slate-800 leading-[1.65] bg-[#FDFDFE] focus:outline-none focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/10 resize-none custom-scrollbar"
        />
      </div>

      {/* Phase 12 — Canonical facts & evidence strip. Rendered verbatim from the
          server's record: verificationState, status, temporality, speaker and
          evidence-span counts are displayed, never re-derived client-side. */}
      {factRows.length > 0 && (
        <div className="px-4 py-2.5 border-t border-slate-200/80 bg-slate-50/60 max-h-40 overflow-y-auto custom-scrollbar" data-testid="facts-strip">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-sky-600" />
            <span>Clinical Facts &amp; Evidence</span>
            <span className="font-normal normal-case tracking-normal text-slate-400">
              ({factRows.length} from server audit)
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {factRows.map(f => (
              <div key={f.id} className="flex items-center gap-2 text-[11px] leading-tight">
                <span
                  className={`px-1.5 py-0.5 rounded font-semibold text-[10px] border whitespace-nowrap ${
                    f.verificationState === 'verified'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : f.verificationState === 'rejected'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                  data-verification-state={f.verificationState || 'unverified'}
                >
                  {f.verificationState || 'unverified'} · {f.evidenceCount > 0 ? `${f.evidenceCount} ev` : 'no ev'}
                </span>
                <span className="text-slate-500 font-mono text-[10px] whitespace-nowrap">
                  {f.type}
                  {f.status && f.status !== 'performed' ? ` · ${f.status}` : ''}
                  {f.temporality && f.temporality !== 'current' ? ` · ${f.temporality}` : ''}
                </span>
                <span className="text-slate-700 flex-1 truncate" title={f.summary}>
                  {f.summary || <span className="text-slate-400">(no value)</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phase 12E — Server-authoritative sign-off. The client only requests;
          the server revalidates (version, grounding, blocking fact states,
          consent) and mints the seal itself. A locally cached seal is never
          treated as proof of signing. */}
      {onSignOff && (
        <div className="px-4 py-2.5 border-t border-slate-200/80 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2" data-testid="signoff-section">
          {isSignedByServer ? (
            <div className="flex items-center gap-2 text-[11px] text-emerald-800 font-semibold" data-testid="signoff-seal">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                Signed — server seal {serverSeal?.signatureHash ? `${String(serverSeal.signatureHash).slice(0, 12)}…` : ''}
                {serverSeal?.signedAt ? ` · ${new Date(serverSeal.signedAt).toLocaleString()}` : ''}
              </span>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-[200px] text-[11px] text-slate-600">
                {signOffError ? (
                  <span
                    className="text-rose-700 font-semibold flex items-center gap-1.5"
                    data-testid="signoff-refusal"
                    data-code={signOffError.code}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      {signOffError.message}
                      {signOffError.currentVersion != null && (
                        <span className="font-normal text-slate-500"> (server version: {signOffError.currentVersion})</span>
                      )}
                    </span>
                  </span>
                ) : (
                  <span>
                    Sign-off is validated server-side: grounding approval, blocking fact states and consent are re-checked before a seal is minted.
                  </span>
                )}
              </div>
              <button
                onClick={onSignOff}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="signoff-button"
              >
                <PenLine className="w-3.5 h-3.5" />
                <span>Sign Off{recordVersion != null ? ` (v${recordVersion})` : ''}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
