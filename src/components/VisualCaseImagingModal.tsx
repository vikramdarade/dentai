import React, { useState } from 'react';
import { X, Image as ImageIcon, Sparkles, CheckCircle2, ArrowRight, ShieldCheck } from 'lucide-react';
import { VISUAL_CASE_PREVIEWS, VisualCaseCategory } from '../lib/visualCaseLibrary';

interface VisualCaseImagingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: VisualCaseCategory;
}

const CATEGORIES: Array<{ key: VisualCaseCategory; label: string; iconEmoji: string }> = [
  { key: 'crown', label: 'Ceramic Crown', iconEmoji: '👑' },
  { key: 'implant', label: 'Dental Implant', iconEmoji: '🔩' },
  { key: 'endo', label: 'Root Canal (RCT)', iconEmoji: '⚡' },
  { key: 'veneer', label: 'Porcelain Veneer', iconEmoji: '✨' },
  { key: 'aligner', label: 'Clear Aligner', iconEmoji: '📐' },
  { key: 'perio', label: 'Periodontal Therapy', iconEmoji: '🩺' },
];

export default function VisualCaseImagingModal({
  isOpen,
  onClose,
  initialCategory = 'crown'
}: VisualCaseImagingModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<VisualCaseCategory>(initialCategory);
  const [activeStageIndex, setActiveStageIndex] = useState(0);

  if (!isOpen) return null;

  const caseData = VISUAL_CASE_PREVIEWS[selectedCategory] || VISUAL_CASE_PREVIEWS.crown;
  const currentStage = caseData.stages[activeStageIndex] || caseData.stages[0];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#0A1018] border border-[#182638] rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col text-slate-100 text-left max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#182638] bg-[#0E1724]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 flex items-center justify-center">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">Visual Case Presentation & Imaging</h2>
              <p className="text-[11px] text-slate-400">
                High-impact 3-stage anatomical progressions for patient chairside education & consent
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

        {/* Category Selector Tabs */}
        <div className="px-6 py-2.5 bg-[#0C131D] border-b border-[#182638] flex items-center gap-2 overflow-x-auto cockpit-scrollbar">
          {CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat.key);
                  setActiveStageIndex(0);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1.5 border ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50 shadow-xs'
                    : 'bg-[#0E1724] text-slate-400 hover:text-slate-200 border-[#182638]'
                }`}
              >
                <span>{cat.iconEmoji}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content Area */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Title & Patient Value Prop */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#0E1724] border border-[#182638] rounded-2xl">
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400">
                ADA Treatment Plan Presentation
              </span>
              <h3 className="text-base font-black text-white mt-0.5">
                {caseData.treatmentName}
              </h3>
              <p className="text-xs text-slate-300 mt-1 max-w-xl">
                {caseData.patientValueProposition}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              {caseData.typicalAdaCodes.map((code) => (
                <span
                  key={code}
                  className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#162436] text-cyan-300 border border-[#233852]"
                >
                  ADA {code}
                </span>
              ))}
            </div>
          </div>

          {/* 3-Stage Visual Progression Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {caseData.stages.map((stage, idx) => {
              const isSelected = activeStageIndex === idx;
              return (
                <button
                  key={stage.step}
                  type="button"
                  onClick={() => setActiveStageIndex(idx)}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-gradient-to-b from-cyan-500/20 to-[#101C2B] border-cyan-400/60 shadow-lg ring-1 ring-cyan-400/40'
                      : 'bg-[#0E1724] border-[#182638] hover:bg-[#121E2E] hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="font-mono font-bold text-cyan-400">Stage {stage.step}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#162436] text-slate-300">
                      {stage.badge}
                    </span>
                  </div>
                  <h4 className="text-xs font-extrabold text-white">{stage.title}</h4>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {stage.clinicalFocus}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Active Stage Detailed Presentation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5 bg-[#0E1724] border border-[#182638] rounded-2xl">
            {/* SVG Visual Illustration */}
            <div className="flex flex-col items-center justify-center p-4 bg-[#070B11] border border-[#182638] rounded-xl">
              <div
                className="w-full max-w-[320px] aspect-square flex items-center justify-center text-cyan-400"
                dangerouslySetInnerHTML={{ __html: currentStage.illustrationSvg }}
              />
              <span className="text-[10px] font-mono text-slate-500 mt-2">
                Figure {currentStage.step}: {currentStage.title}
              </span>
            </div>

            {/* Stage Clinical Narrative & Benefits */}
            <div className="flex flex-col justify-between space-y-4 text-xs text-left">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400">
                  {currentStage.badge}
                </span>
                <h4 className="text-base font-black text-white mt-0.5">
                  {currentStage.title}
                </h4>
                <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                  {currentStage.description}
                </p>
              </div>

              {/* Key Benefits */}
              <div className="p-3.5 bg-[#0A1018] rounded-xl border border-[#182638] space-y-2">
                <span className="text-[11px] font-bold text-slate-200 block">
                  Patient Confidence & Outcome:
                </span>
                {caseData.keyPatientBenefits.map((b, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-slate-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#182638] bg-[#0E1724] flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-400">
            Use on operatory monitor to visually explain diagnosis and expected treatment outcome
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black text-xs rounded-xl shadow cursor-pointer active:scale-95 transition-all"
          >
            Close Presentation
          </button>
        </div>
      </div>
    </div>
  );
}
