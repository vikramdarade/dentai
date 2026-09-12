import React, { useState } from 'react';
import { X, Activity, Check, Info, Sparkles, ShieldCheck } from 'lucide-react';
import { DayScheduleItem } from '../lib/dayScheduleStorage';
import { extractToothNumbers } from '../lib/transcriptGrounding';

interface FdiChartingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedItem?: DayScheduleItem | null;
}

// Standard FDI 2-digit Australian dental numbering quadrants
const MAXILLARY_RIGHT = ['18', '17', '16', '15', '14', '13', '12', '11'];
const MAXILLARY_LEFT = ['21', '22', '23', '24', '25', '26', '27', '28'];
const MANDIBULAR_LEFT = ['31', '32', '33', '34', '35', '36', '37', '38'];
const MANDIBULAR_RIGHT = ['48', '47', '46', '45', '44', '43', '42', '41'];

const TOOTH_NAMES: Record<string, string> = {
  '11': 'Upper Right Central Incisor',
  '12': 'Upper Right Lateral Incisor',
  '13': 'Upper Right Canine',
  '14': 'Upper Right First Premolar',
  '15': 'Upper Right Second Premolar',
  '16': 'Upper Right First Molar',
  '17': 'Upper Right Second Molar',
  '18': 'Upper Right Third Molar (Wisdom)',
  '21': 'Upper Left Central Incisor',
  '22': 'Upper Left Lateral Incisor',
  '23': 'Upper Left Canine',
  '24': 'Upper Left First Premolar',
  '25': 'Upper Left Second Premolar',
  '26': 'Upper Left First Molar',
  '27': 'Upper Left Second Molar',
  '28': 'Upper Left Third Molar (Wisdom)',
  '31': 'Lower Left Central Incisor',
  '32': 'Lower Left Lateral Incisor',
  '33': 'Lower Left Canine',
  '34': 'Lower Left First Premolar',
  '35': 'Lower Left Second Premolar',
  '36': 'Lower Left First Molar',
  '37': 'Lower Left Second Molar',
  '38': 'Lower Left Third Molar (Wisdom)',
  '41': 'Lower Right Central Incisor',
  '42': 'Lower Right Lateral Incisor',
  '43': 'Lower Right Canine',
  '44': 'Lower Right First Premolar',
  '45': 'Lower Right Second Premolar',
  '46': 'Lower Right First Molar',
  '47': 'Lower Right Second Molar',
  '48': 'Lower Right Third Molar (Wisdom)',
};

export default function FdiChartingModal({ isOpen, onClose, selectedItem }: FdiChartingModalProps) {
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);

  if (!isOpen) return null;

  // Extract teeth referenced in clinical note or procedure text
  const referencedTeeth = new Set<string>();
  if (selectedItem?.procedureText) {
    extractToothNumbers(selectedItem.procedureText).forEach(t => referencedTeeth.add(t));
  }
  if (selectedItem?.clinicalNote) {
    extractToothNumbers(selectedItem.clinicalNote).forEach(t => referencedTeeth.add(t));
  }

  const renderToothButton = (tooth: string) => {
    const isReferenced = referencedTeeth.has(tooth);
    const isClicked = selectedTooth === tooth;

    return (
      <button
        key={tooth}
        type="button"
        onClick={() => setSelectedTooth(tooth)}
        className={`w-9 h-11 sm:w-10 sm:h-12 rounded-xl flex flex-col items-center justify-center font-mono transition-all cursor-pointer border ${
          isClicked
            ? 'bg-cyan-400 text-slate-950 font-black border-cyan-300 ring-2 ring-cyan-400 shadow-md scale-105'
            : isReferenced
            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 font-extrabold shadow-sm hover:scale-105'
            : 'bg-[#101C2B] text-slate-300 border-[#1E3048] hover:bg-[#18283D] hover:border-slate-500'
        }`}
        title={`FDI #${tooth} - ${TOOTH_NAMES[tooth] || ''}`}
      >
        <span className="text-[11px] font-bold">{tooth}</span>
        {isReferenced && (
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-0.5 animate-pulse" />
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#0A1018] border border-[#182638] rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col text-slate-100 text-left">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#182638] bg-[#0E1724]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">FDI Dental Charting (ISO 3950)</h2>
              <p className="text-[11px] text-slate-400">
                {selectedItem ? `Active Patient: ${selectedItem.patientName} (${selectedItem.time})` : 'Universal Australian 2-Digit FDI Notation'}
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

        {/* Arch Visualizer */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          <div className="p-3.5 bg-[#0E1724] border border-[#182638] rounded-2xl text-xs text-slate-300 flex items-start gap-3">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-bold text-slate-100">Ambient Tooth Detection: </span>
              DentAI automatically listens for Australian dental dialogue during the consult (e.g. <em>“tooth 16 has occlusal caries”</em> or <em>“restoration #24”</em>) and maps it straight into FDI notation without manual keyboard entry.
            </div>
          </div>

          {/* Maxillary Upper Arch */}
          <div className="space-y-2 text-center">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
              Maxillary Arch (Upper Jaw)
            </div>
            <div className="flex items-center justify-center gap-4 flex-wrap sm:flex-nowrap">
              {/* Q1: 18 - 11 */}
              <div className="flex items-center gap-1 bg-[#0E1724] p-2 rounded-2xl border border-[#182638]">
                {MAXILLARY_RIGHT.map(renderToothButton)}
              </div>
              <div className="h-8 w-px bg-cyan-500/40 hidden sm:block" />
              {/* Q2: 21 - 28 */}
              <div className="flex items-center gap-1 bg-[#0E1724] p-2 rounded-2xl border border-[#182638]">
                {MAXILLARY_LEFT.map(renderToothButton)}
              </div>
            </div>
            <div className="flex justify-between px-6 text-[10px] font-mono text-slate-500">
              <span>Quadrant 1 (UR)</span>
              <span>Quadrant 2 (UL)</span>
            </div>
          </div>

          {/* Mandibular Lower Arch */}
          <div className="space-y-2 text-center pt-2 border-t border-[#182638]">
            <div className="flex justify-between px-6 text-[10px] font-mono text-slate-500">
              <span>Quadrant 4 (LR)</span>
              <span>Quadrant 3 (LL)</span>
            </div>
            <div className="flex items-center justify-center gap-4 flex-wrap sm:flex-nowrap">
              {/* Q4: 48 - 41 */}
              <div className="flex items-center gap-1 bg-[#0E1724] p-2 rounded-2xl border border-[#182638]">
                {MANDIBULAR_RIGHT.map(renderToothButton)}
              </div>
              <div className="h-8 w-px bg-cyan-500/40 hidden sm:block" />
              {/* Q3: 31 - 38 */}
              <div className="flex items-center gap-1 bg-[#0E1724] p-2 rounded-2xl border border-[#182638]">
                {MANDIBULAR_LEFT.map(renderToothButton)}
              </div>
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
              Mandibular Arch (Lower Jaw)
            </div>
          </div>

          {/* Selected Tooth Detail Box */}
          {selectedTooth && (
            <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-cyan-300 text-sm">
                  FDI Tooth #{selectedTooth}
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-200">
                  {referencedTeeth.has(selectedTooth) ? 'Detected in Session ✓' : 'Sound / Unselected'}
                </span>
              </div>
              <p className="text-slate-300 text-xs font-medium">
                {TOOTH_NAMES[selectedTooth]}
              </p>
              {referencedTeeth.has(selectedTooth) && (
                <p className="text-[11px] text-cyan-200 mt-1">
                  Mentioned in {selectedItem?.patientName}'s clinical notes: <em>{selectedItem?.procedureText}</em>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#182638] bg-[#0E1724] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>Cyan highlighted teeth indicate detected active findings</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black text-xs rounded-xl shadow cursor-pointer active:scale-95 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
