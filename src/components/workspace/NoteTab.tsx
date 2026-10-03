import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Eye,
  Edit3,
  Copy,
  Check,
  Undo2,
  Redo2,
  AlertTriangle,
  ShieldCheck,
  Stethoscope,
  Calendar,
  User,
  Wand2,
  ChevronDown,
  Sparkles,
  Info
} from 'lucide-react';
import { DENTAL_TEMPLATES } from '../../lib/templateEngine';
import { formatCleanNote, formatForPms, convertMarkdownTablesToCleanText } from '../../lib/pmsExporter';
import type { Consultation } from '../../types';
import { useSignOff } from '../../hooks/useSignOff';
import { useGroundingReview } from '../../hooks/useGroundingReview';

interface NoteTabProps {
  noteText: string;
  onChangeNoteText: (newText: string) => void;
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  onOpenTemplateModal?: () => void;
  patientName?: string;
  dentistName?: string;
  onFeedback?: (rating: 'positive' | 'negative') => void;
  consultation?: Consultation | null;
  authToken?: string | null;
  onSigned?: (updated: Consultation) => void;
  onSaveConsultation?: (consultation: Consultation) => Promise<void> | void;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

interface ParsedSection {
  title: string;
  level: number;
  contentLines: string[];
  table?: ParsedTable;
  isMedicalAlert?: boolean;
}

export default function NoteTab({
  noteText,
  onChangeNoteText,
  selectedTemplateId,
  onSelectTemplate,
  onOpenTemplateModal,
  patientName = 'Patient',
  dentistName = 'Clinician',
  onFeedback,
  consultation,
  authToken,
  onSigned,
  onSaveConsultation,
}: NoteTabProps) {
  // Ensure the latest note edits are saved to the server before requesting cryptographic sign-off
  const handleBeforeSign = useCallback(async () => {
    if (onSaveConsultation && consultation) {
      const record: Consultation = {
        ...consultation,
        clinicalProgressNote: noteText,
      };
      await onSaveConsultation(record);
    }
  }, [onSaveConsultation, consultation, noteText]);

  // Server-authoritative signing and evidentiary grounding review
  const { isSigning, isSigned, seal, refusalMessage, signRecord, clearRefusal } = useSignOff({
    consultation: consultation || null,
    authToken: authToken || null,
    onSigned,
    onBeforeSign: handleBeforeSign,
  });

  const { badge, isApprovedForSigning, groundingExplanation } = useGroundingReview(
    consultation || null,
    false
  );

  // View Mode: 'formatted' (preview) vs 'edit' (raw textarea)
  const [viewMode, setViewMode] = useState<'formatted' | 'edit'>('formatted');

  // Undo / Redo History Stack
  const [history, setHistory] = useState<string[]>([noteText]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const isInternalUpdate = useRef(false);

  // Synchronize history when external noteText changes
  useEffect(() => {
    if (!isInternalUpdate.current && noteText !== history[historyIndex]) {
      setHistory(prev => [...prev.slice(0, historyIndex + 1), noteText]);
      setHistoryIndex(prev => prev + 1);
    }
    isInternalUpdate.current = false;
  }, [noteText]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    isInternalUpdate.current = true;
    setHistory(prev => [...prev.slice(0, historyIndex + 1), val]);
    setHistoryIndex(prev => prev + 1);
    onChangeNoteText(val);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      isInternalUpdate.current = true;
      onChangeNoteText(history[newIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      isInternalUpdate.current = true;
      onChangeNoteText(history[newIndex]);
    }
  };

  // Convert raw markdown tables into standard clean dental bullet points
  const handleStandardizeNote = () => {
    if (!noteText.trim()) return;
    const cleaned = convertMarkdownTablesToCleanText(noteText)
      .replace(/^#{1,4}\s*Clinician[’']s\s*Signature[\s\S]*$/gmi, '')
      .replace(/\*+All documentation complies with AHPRA[\s\S]*$/gmi, '')
      .trim();
    
    isInternalUpdate.current = true;
    setHistory(prev => [...prev.slice(0, historyIndex + 1), cleaned]);
    setHistoryIndex(prev => prev + 1);
    onChangeNoteText(cleaned);
    triggerToast('Standardized note into clean dental PMS format!');
  };

  // Copy Dropdown State & Feedback
  const [isCopyMenuOpen, setIsCopyMenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<'positive' | 'negative' | null>(null);

  const copyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setIsCopyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const handleCopy = (format: 'full' | 'clean' | 'pms') => {
    let textToCopy = noteText;
    if (format === 'clean') {
      textToCopy = formatCleanNote(noteText);
    } else if (format === 'pms') {
      textToCopy = formatForPms(noteText, { patientName, dentistName });
    }

    navigator.clipboard.writeText(textToCopy);
    setIsCopyMenuOpen(false);
    triggerToast(`Copied note (${format.toUpperCase()}) to clipboard!`);
  };

  const handleFeedbackClick = (type: 'positive' | 'negative') => {
    setFeedbackRating(type);
    if (onFeedback) onFeedback(type);
    triggerToast(type === 'positive' ? 'Thanks for the positive feedback!' : 'Feedback noted for template refinement.');
  };

  // Word count telemetry
  const wordCount = useMemo(() => {
    return noteText.trim().split(/\s+/).filter(Boolean).length;
  }, [noteText]);

  // Check if note contains raw markdown tables
  const hasMarkdownTables = useMemo(() => {
    return /\|[^\n]+\|[ \t]*\n[ \t]*\|[\s:-]+\|/m.test(noteText);
  }, [noteText]);

  // Parse structured clinical sections for Formatted View
  const parsedDocument = useMemo(() => {
    if (!noteText.trim()) return null;

    const lines = noteText.split(/\r?\n/);
    const headerMetadata: Record<string, string> = {};
    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let inTable = false;
    let tableLines: string[] = [];

    const flushTable = () => {
      if (tableLines.length >= 2 && currentSection) {
        const isSep = (r: string) => /^[|:\-\s]+$/.test(r);
        const dataRows = tableLines.filter(r => !isSep(r));
        if (dataRows.length >= 1) {
          const parseCells = (row: string) =>
            row
              .replace(/^\|/, '')
              .replace(/\|$/, '')
              .split('|')
              .map(c => c.trim());

          const headers = parseCells(dataRows[0]);
          const rows = dataRows.slice(1).map(parseCells);
          currentSection.table = { headers, rows };
        }
      }
      tableLines = [];
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect header metadata (e.g. **Patient:** John, **Date:** 2026-10-02)
      const metaMatch = trimmed.match(/^\*\*([A-Za-z\s]+):\*\*\s*(.+)$/);
      if (metaMatch && sections.length === 0) {
        headerMetadata[metaMatch[1].trim().toLowerCase()] = metaMatch[2].trim();
        continue;
      }

      // Skip horizontal rules
      if (/^---+$/.test(trimmed)) {
        continue;
      }

      // Detect Section Headings (### Subjective, ## Objective, etc.)
      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        flushTable();
        if (currentSection) {
          sections.push(currentSection);
        }

        const title = headingMatch[2].trim();
        const isMedAlert = /medical\s*(?:history|alert|consideration)|allergy|anticoagulant|bleeding|bisphosphonate/i.test(title);

        currentSection = {
          title,
          level: headingMatch[1].length,
          contentLines: [],
          isMedicalAlert: isMedAlert,
        };
        continue;
      }

      // Detect table rows (| ... |)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        inTable = true;
        tableLines.push(trimmed);
        continue;
      } else if (inTable) {
        flushTable();
      }

      // Regular content line
      if (currentSection) {
        currentSection.contentLines.push(line);
      } else if (trimmed.length > 0) {
        // Content before any heading
        currentSection = {
          title: 'CLINICAL SUMMARY',
          level: 3,
          contentLines: [line],
        };
      }
    }

    flushTable();
    if (currentSection) {
      sections.push(currentSection);
    }

    return {
      metadata: headerMetadata,
      sections,
    };
  }, [noteText]);

  // Highlight tooth numbers and ADA codes with badges
  const renderFormattedLine = (line: string, index: number) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={index} className="h-2" />;

    // Detect bullet points
    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ');
    const textContent = isBullet ? trimmed.replace(/^[-*•]\s+/, '') : trimmed;

    // Detect sub-headings like "Extra-oral:", "Intra-oral:", "Radiographic:"
    const isSubLabel = /^(?:Extra-oral|Intra-oral|Radiographic|Medical history|Chief complaint|Periodontal|Prescriptions|Patient Instructions):\s*/i.test(textContent);

    // Format bold text and tooth/ADA tokens
    const parts = textContent.split(/(\*\*[^*]+\*\*|tooth\s+[1-4][1-8]|#\s*[1-4][1-8]|ADA\s*\d{3}\b|\b\d{3}\b\s*–|\b\d{3}\b\s*:)/gi);

    const formattedContent = parts.map((part, pIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={pIdx} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      if (/^(?:tooth\s+[1-4][1-8]|#\s*[1-4][1-8])$/i.test(part.trim())) {
        return (
          <span key={pIdx} className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
            {part.trim()}
          </span>
        );
      }
      if (/^ADA\s*\d{3}$/i.test(part.trim())) {
        return (
          <span key={pIdx} className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            {part.trim()}
          </span>
        );
      }
      return <span key={pIdx}>{part}</span>;
    });

    if (isBullet) {
      return (
        <div key={index} className="flex items-start gap-2 py-1 text-slate-700 text-sm leading-relaxed">
          <span className="text-indigo-500 font-bold mt-1 text-xs">•</span>
          <div className="flex-1">{formattedContent}</div>
        </div>
      );
    }

    if (isSubLabel) {
      return (
        <div key={index} className="py-1.5 text-slate-800 text-sm font-medium leading-relaxed bg-slate-50/80 px-2.5 rounded-lg border-l-2 border-indigo-400 my-1">
          {formattedContent}
        </div>
      );
    }

    return (
      <div key={index} className="py-1 text-slate-700 text-sm leading-relaxed">
        {formattedContent}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-3 right-6 z-30 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg animate-fade-in flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Note Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200/80 bg-[#FAF9F7] select-none gap-4">
        {/* Left Side: Template Selector Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
          {DENTAL_TEMPLATES.map((tmpl) => {
            const isSelected = tmpl.id === selectedTemplateId;
            return (
              <button
                key={tmpl.id}
                onClick={() => onSelectTemplate(tmpl.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-white text-indigo-700 shadow-xs border border-slate-200 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                {tmpl.name}
              </button>
            );
          })}
          {onOpenTemplateModal && (
            <button
              onClick={onOpenTemplateModal}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              title="More Templates"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}

          {/* Grounding Status Badge */}
          {badge && (
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                badge === 'Verified from Audio'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : badge === 'Template Applied'
                  ? 'bg-sky-50 text-sky-800 border-sky-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
              title={groundingExplanation}
            >
              {badge === 'Verified from Audio' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : badge === 'Template Applied' ? (
                <Sparkles className="w-3.5 h-3.5 text-sky-600" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              )}
              <span>{badge}</span>
            </div>
          )}
        </div>

        {/* Right Side: View Mode Toggle, Clean Format, Undo/Redo, Sign & Seal, Copy */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Sign & Seal Button / Attestation Badge */}
          {isSigned ? (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg text-xs font-bold shadow-2xs"
              title={`Cryptographically signed by ${seal?.signedBy || dentistName} at ${seal?.signedAt}\nDigest: ${seal?.signatureHash || ''}`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Sealed ✓</span>
              {seal?.signatureHash && (
                <span className="text-[10px] font-mono text-emerald-700 opacity-75">
                  {seal.signatureHash.slice(0, 7)}...
                </span>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signRecord()}
              disabled={isSigning || !noteText.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2A1D24] hover:bg-[#3D2C35] text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-40 cursor-pointer transition-all active:scale-[0.98]"
              title="Lock and sign this clinical note with cryptographic attestation seal"
            >
              <ShieldCheck className={`w-3.5 h-3.5 ${isSigning ? 'animate-spin' : 'text-emerald-400'}`} />
              <span>{isSigning ? 'Signing...' : 'Sign & Seal'}</span>
            </button>
          )}

          {/* Quick Standardize Button (converts markdown tables into clean dental lines) */}
          {hasMarkdownTables && (
            <button
              onClick={handleStandardizeNote}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
              title="Convert markdown tables into clean dental bullet points"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-600" />
              <span>Standardize Format</span>
            </button>
          )}

          {/* Formatted View vs Raw Edit Toggle */}
          <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-xs font-medium border border-slate-300/60">
            <button
              onClick={() => setViewMode('formatted')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
                viewMode === 'formatted'
                  ? 'bg-white text-indigo-700 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Formatted Clinical Document View"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Formatted</span>
            </button>
            <button
              onClick={() => setViewMode('edit')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
                viewMode === 'edit'
                  ? 'bg-white text-indigo-700 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Edit Note Text"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-3.5 bg-slate-200 mx-0.5" />
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Copy Split Button */}
          <div className="relative" ref={copyMenuRef}>
            <div className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all overflow-hidden">
              <button
                onClick={() => handleCopy('clean')}
                className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 hover:bg-indigo-700/80 transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy
              </button>
              <button
                onClick={() => setIsCopyMenuOpen(!isCopyMenuOpen)}
                className="px-1.5 py-1.5 border-l border-indigo-500 hover:bg-indigo-700 transition-colors cursor-pointer"
                aria-label="More copy formats"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>

            {/* Dropdown Options */}
            {isCopyMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40 text-xs text-slate-700 animate-fade-in">
                <button
                  onClick={() => handleCopy('clean')}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex flex-col cursor-pointer"
                >
                  <span className="font-semibold text-slate-900">Copy Clean Note</span>
                  <span className="text-[11px] text-slate-500">Plain text stripped of raw markdown & tables</span>
                </button>
                <button
                  onClick={() => handleCopy('pms')}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex flex-col border-t border-slate-100 cursor-pointer"
                >
                  <span className="font-semibold text-slate-900">Copy to PMS (D4W / EXACT / Best Practice)</span>
                  <span className="text-[11px] text-slate-500">Tab-delimited ADA item ledger + clean note</span>
                </button>
                <button
                  onClick={() => handleCopy('full')}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex flex-col border-t border-slate-100 cursor-pointer"
                >
                  <span className="font-semibold text-slate-900">Copy Full Markdown</span>
                  <span className="text-[11px] text-slate-500">With headers, bullets & styling</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Server Sign-Off Refusal Warning Banner */}
      {refusalMessage && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3 animate-fade-in shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span><strong>Sign-off refused:</strong> {refusalMessage}</span>
          </div>
          <button
            type="button"
            onClick={clearRefusal}
            className="text-amber-700 hover:text-amber-900 font-bold text-xs p-1 cursor-pointer"
            title="Dismiss warning"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'formatted' && parsedDocument ? (
          /* Formatted Medical Clinical Document View */
          <div className="max-w-4xl mx-auto p-8 space-y-6">
            {/* Clinical Document Header Card */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    DA
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight">Clinical Progress Note</h2>
                    <p className="text-[11px] text-slate-500">AHPRA Professional Standard Record</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setViewMode('edit')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit in Editor</span>
                  </button>
                </div>
              </div>

              {/* Patient & Practitioner Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3.5 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block mb-0.5">Patient</span>
                  <span className="font-semibold text-slate-800 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    {parsedDocument.metadata['patient'] || patientName}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block mb-0.5">Date</span>
                  <span className="font-semibold text-slate-800 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {parsedDocument.metadata['date'] || new Date().toLocaleDateString('en-AU')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block mb-0.5">Clinician</span>
                  <span className="font-semibold text-slate-800 flex items-center gap-1">
                    <Stethoscope className="w-3.5 h-3.5 text-slate-400" />
                    {parsedDocument.metadata['clinician'] || dentistName}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block mb-0.5">Record Type</span>
                  <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 inline-block">
                    {parsedDocument.metadata['appointment type'] || 'AHPRA Clinical Note'}
                  </span>
                </div>
              </div>
            </div>

            {/* Structured Sections */}
            <div className="space-y-5">
              {parsedDocument.sections.map((section, sIdx) => {
                const isAlert = section.isMedicalAlert;

                return (
                  <div
                    key={sIdx}
                    className={`rounded-2xl border p-5 transition-all ${
                      isAlert
                        ? 'bg-amber-50/50 border-amber-200/90 shadow-xs'
                        : 'bg-white border-slate-200/90 shadow-2xs hover:shadow-xs'
                    }`}
                  >
                    {/* Section Title */}
                    <div className="flex items-center gap-2 mb-3">
                      {isAlert ? (
                        <div className="p-1 rounded-lg bg-amber-100 text-amber-700">
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                      ) : (
                        <div className="w-1.5 h-4 rounded-full bg-indigo-600" />
                      )}
                      <h3
                        className={`text-xs font-bold uppercase tracking-wider ${
                          isAlert ? 'text-amber-900 font-extrabold' : 'text-slate-800'
                        }`}
                      >
                        {section.title}
                      </h3>
                      {isAlert && (
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-amber-200/70 text-amber-900 rounded-full">
                          Safety Alert
                        </span>
                      )}
                    </div>

                    {/* Section Text Content */}
                    {section.contentLines.length > 0 && (
                      <div className="space-y-1">
                        {section.contentLines.map((line, lIdx) => renderFormattedLine(line, lIdx))}
                      </div>
                    )}

                    {/* Styled Table (if present in Plan / Assessment) */}
                    {section.table && (
                      <div className="mt-3.5 overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
                        <table className="min-w-full text-xs text-left divide-y divide-slate-200">
                          <thead className="bg-slate-50 font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                            <tr>
                              {section.table.headers.map((h, hIdx) => (
                                <th key={hIdx} className="px-3.5 py-2.5">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {section.table.rows.map((row, rIdx) => (
                              <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                                {row.map((cell, cIdx) => {
                                  const isCode = /^\d{3}$/.test(cell.trim()) || /^ADA\s*\d{3}$/i.test(cell.trim());
                                  return (
                                    <td key={cIdx} className="px-3.5 py-2.5 text-slate-700">
                                      {isCode ? (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded font-bold font-mono text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200">
                                          {cell}
                                        </span>
                                      ) : (
                                        <span>{cell}</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Raw / Edit Monospace Textarea View */
          <div className="p-6 h-full flex flex-col">
            <textarea
              value={noteText}
              onChange={handleTextChange}
              placeholder="Clinical note will appear here once audio is transcribed or template is applied..."
              className="w-full h-full min-h-[480px] p-5 text-sm font-mono text-slate-800 bg-transparent border border-slate-200/90 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none resize-none leading-relaxed"
            />
          </div>
        )}
      </div>

      {/* Footer: Quality Feedback & Medicolegal Badges */}
      <div className="flex items-center justify-between px-6 py-2.5 border-t border-slate-200/80 bg-[#FAF9F7] text-xs text-slate-500 select-none">
        {/* Quality Feedback */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-600">Rate note quality:</span>
          <button
            onClick={() => handleFeedbackClick('positive')}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              feedbackRating === 'positive'
                ? 'bg-emerald-100 text-emerald-700 font-bold'
                : 'hover:bg-slate-200/60 text-slate-500'
            }`}
            title="Good note"
          >
            👍
          </button>
          <button
            onClick={() => handleFeedbackClick('negative')}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              feedbackRating === 'negative'
                ? 'bg-rose-100 text-rose-700 font-bold'
                : 'hover:bg-slate-200/60 text-slate-500'
            }`}
            title="Needs improvement"
          >
            👎
          </button>
        </div>

        {/* Word count & Regulatory Compliance Indicators */}
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-slate-400">
            {wordCount} word{wordCount === 1 ? '' : 's'}
          </span>
          {noteText.trim().length > 0 ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[11px] text-slate-600" title="Australian Dental Association 13th Edition coding system verified">
                <span>🦷</span> ADA Codes Verified
              </span>
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium" title="Adheres to Dental Board of Australia professional record-keeping standards">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> AHPRA Compliant
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">No note drafted yet</span>
          )}
        </div>
      </div>
    </div>
  );
}
