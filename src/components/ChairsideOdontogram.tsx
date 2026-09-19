import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ChevronDown, ChevronUp, CheckCircle2, ShieldAlert } from 'lucide-react';

interface ChairsideOdontogramProps {
  transcriptText?: string;
  findingsText?: string;
  onSelectTooth?: (fdi: string) => void;
}

// FDI Standard Quad groupings
const UPPER_RIGHT = ['18', '17', '16', '15', '14', '13', '12', '11'];
const UPPER_LEFT = ['21', '22', '23', '24', '25', '26', '27', '28'];
const LOWER_RIGHT = ['48', '47', '46', '45', '44', '43', '42', '41'];
const LOWER_LEFT = ['31', '32', '33', '34', '35', '36', '37', '38'];

// Anatomical tooth morphology categorization
function getToothType(fdi: string): 'molar' | 'premolar' | 'canine' | 'incisor' {
  const digit = parseInt(fdi[1], 10);
  if (digit >= 6) return 'molar';
  if (digit >= 4) return 'premolar';
  if (digit === 3) return 'canine';
  return 'incisor';
}

function getToothName(fdi: string): string {
  const quadNames: Record<string, string> = {
    '1': 'Upper Right',
    '2': 'Upper Left',
    '3': 'Lower Left',
    '4': 'Lower Right'
  };
  const toothNames: Record<string, string> = {
    '1': 'Central Incisor',
    '2': 'Lateral Incisor',
    '3': 'Canine (Cuspid)',
    '4': 'First Premolar',
    '5': 'Second Premolar',
    '6': 'First Molar (6-yr)',
    '7': 'Second Molar (12-yr)',
    '8': 'Third Molar (Wisdom)'
  };
  return `${quadNames[fdi[0]] || ''} ${toothNames[fdi[1]] || `Tooth ${fdi}`}`;
}

export default function ChairsideOdontogram({
  transcriptText = '',
  findingsText = '',
  onSelectTooth
}: ChairsideOdontogramProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);

  // Extract all mentioned FDI teeth (11-48) from live speech and clinical findings
  const activeTeeth = useMemo(() => {
    const combined = `${transcriptText} ${findingsText}`.toLowerCase();
    const set = new Set<string>();
    
    // Match direct 2-digit FDI notation: 11 to 18, 21 to 28, 31 to 38, 41 to 48
    const matches = combined.match(/\b([1-4][1-8])\b/g);
    if (matches) {
      matches.forEach(m => set.add(m));
    }

    // Match spoken tooth phrases like "tooth 16", "upper right first molar", etc.
    const phraseMap: Record<string, string> = {
      'wisdom tooth': '18',
      'wisdom teeth': '18',
      'upper right molar': '16',
      'lower left molar': '36',
      'lower right molar': '46',
      'upper left molar': '26'
    };
    Object.entries(phraseMap).forEach(([phrase, fdi]) => {
      if (combined.includes(phrase)) set.add(fdi);
    });

    return set;
  }, [transcriptText, findingsText]);

  const renderToothCapsule = (fdi: string) => {
    const isActive = activeTeeth.has(fdi);
    const isSelected = selectedTooth === fdi;
    const type = getToothType(fdi);

    return (
      <button
        key={fdi}
        type="button"
        onClick={() => {
          setSelectedTooth(prev => prev === fdi ? null : fdi);
          onSelectTooth?.(fdi);
        }}
        title={`${fdi} — ${getToothName(fdi)}${isActive ? ' (Discussed in encounter)' : ''}`}
        className={`group relative flex flex-col items-center justify-between p-1 rounded-xl transition-all duration-200 cursor-pointer ${
          type === 'molar' ? 'w-8 h-12' : type === 'premolar' ? 'w-7 h-11' : 'w-6 h-11'
        } ${
          isActive
            ? 'bg-gradient-to-b from-[#E6F6F4] to-[#C7EFE9] border-2 border-[#00A389] shadow-sm shadow-[#00A389]/20'
            : isSelected
            ? 'bg-indigo-50 border-2 border-[#0071E3] shadow-sm'
            : 'bg-white hover:bg-slate-50 border border-slate-200/90 shadow-[0_1px_3px_rgba(0,0,0,0.03)]'
        }`}
      >
        {/* Active illumination dot */}
        {isActive && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#00A389] ring-2 ring-white animate-pulse" />
        )}

        {/* FDI Number */}
        <span className={`text-[10px] font-bold font-mono ${
          isActive ? 'text-[#007A66]' : 'text-slate-600'
        }`}>
          {fdi}
        </span>

        {/* Anatomical Icon Representation */}
        <div className={`w-full flex-1 flex items-center justify-center my-0.5 ${
          isActive ? 'text-[#00A389]' : 'text-slate-400 group-hover:text-slate-600'
        }`}>
          {type === 'molar' && (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 opacity-90">
              <path d="M4 6C4 4.5 5 3 7 3C8.5 3 9.5 4 10 4.5C10.5 4 11.5 3 13 3C15 3 16 4.5 16 6C16 8.5 15.5 11 15 14C14.5 16.5 13 17 12 17C11 17 10.5 15.5 10 15.5C9.5 15.5 9 17 8 17C7 17 5.5 16.5 5 14C4.5 11 4 8.5 4 6Z" />
            </svg>
          )}
          {type === 'premolar' && (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 opacity-90">
              <path d="M5 6C5 4.5 6 3.5 8 3.5C9.5 3.5 10 4.5 10 4.5C10 4.5 10.5 3.5 12 3.5C14 3.5 15 4.5 15 6C15 8.5 14.5 11 14 14C13.5 16.5 12.5 17 11.5 17C10.5 17 10.2 16 10 16C9.8 16 9.5 17 8.5 17C7.5 17 6.5 16.5 6 14C5.5 11 5 8.5 5 6Z" />
            </svg>
          )}
          {type === 'canine' && (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3.5 opacity-90">
              <path d="M6 7C6 4.5 8 3 10 3C12 3 14 4.5 14 7C14 10 13.5 13 12.5 15.5C11.8 17 11 17.5 10 17.5C9 17.5 8.2 17 7.5 15.5C6.5 13 6 10 6 7Z" />
            </svg>
          )}
          {type === 'incisor' && (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3.5 opacity-90">
              <rect x="6.5" y="3.5" width="7" height="13" rx="2.5" />
            </svg>
          )}
        </div>

        {/* Mini Status indicator */}
        <span className={`text-[8px] font-extrabold uppercase leading-none tracking-tighter ${
          isActive ? 'text-[#00A389]' : 'text-slate-300'
        }`}>
          {isActive ? '●' : '·'}
        </span>
      </button>
    );
  };

  return (
    <div className="max-w-4xl mx-auto w-full glass-apple rounded-2xl p-3 border border-slate-200/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] font-sans">
      {/* Odontogram Header Strip */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-lg bg-[#E6F6F4] text-[#00A389] flex items-center justify-center border border-[#00A389]/20">
            <span className="text-xs">🦷</span>
          </div>
          <span className="text-xs font-extrabold text-slate-800 tracking-tight">
            FDI Odontogram (32 Teeth)
          </span>
          {activeTeeth.size > 0 ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#E6F6F4] text-[#007A66] border border-[#00A389]/30 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-[#00A389]" />
              {activeTeeth.size} tooth {activeTeeth.size === 1 ? 'finding' : 'findings'} live
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
              Listening for FDI teeth (e.g. 16, 26, 36)...
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(prev => !prev)}
          className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <span>{isExpanded ? 'Collapse' : 'Expand Arch'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expandable Dual-Arch Dental Chart */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3 pt-3 border-t border-slate-100 space-y-2 overflow-x-auto"
          >
            {/* Upper Arch (Maxillary) */}
            <div className="flex items-center justify-between gap-1 min-w-[620px] px-1">
              <span className="text-[9px] font-black uppercase text-slate-400 w-12 text-left">
                Upper R
              </span>

              {/* Quadrant 1 (18 to 11) */}
              <div className="flex items-center gap-1">
                {UPPER_RIGHT.map(renderToothCapsule)}
              </div>

              {/* Midline separator */}
              <div className="w-px h-10 bg-slate-300 mx-1 relative">
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-slate-400">
                  MID
                </span>
              </div>

              {/* Quadrant 2 (21 to 28) */}
              <div className="flex items-center gap-1">
                {UPPER_LEFT.map(renderToothCapsule)}
              </div>

              <span className="text-[9px] font-black uppercase text-slate-400 w-12 text-right">
                Upper L
              </span>
            </div>

            {/* Arch Divider line */}
            <div className="w-full border-t border-dashed border-slate-200" />

            {/* Lower Arch (Mandibular) */}
            <div className="flex items-center justify-between gap-1 min-w-[620px] px-1">
              <span className="text-[9px] font-black uppercase text-slate-400 w-12 text-left">
                Lower R
              </span>

              {/* Quadrant 4 (48 to 41) */}
              <div className="flex items-center gap-1">
                {LOWER_RIGHT.map(renderToothCapsule)}
              </div>

              {/* Midline separator */}
              <div className="w-px h-10 bg-slate-300 mx-1" />

              {/* Quadrant 3 (31 to 38) */}
              <div className="flex items-center gap-1">
                {LOWER_LEFT.map(renderToothCapsule)}
              </div>

              <span className="text-[9px] font-black uppercase text-slate-400 w-12 text-right">
                Lower L
              </span>
            </div>

            {/* Active Selected Tooth Inspection Bar */}
            {selectedTooth && (
              <div className="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs text-slate-700">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-sm text-[#0071E3] px-2 py-0.5 rounded bg-blue-50 border border-blue-200">
                    FDI {selectedTooth}
                  </span>
                  <span className="font-bold">{getToothName(selectedTooth)}</span>
                  {activeTeeth.has(selectedTooth) && (
                    <span className="text-[10px] font-extrabold text-[#007A66] bg-[#E6F6F4] px-2 py-0.5 rounded-full border border-[#00A389]/30">
                      Identified in current consultation
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTooth(null)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  ✕ Close
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
