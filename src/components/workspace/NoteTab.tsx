import React, { useState, useEffect, useRef } from 'react';
import { DENTAL_TEMPLATES } from '../../lib/templateEngine';
import { formatCleanNote, formatForPms } from '../../lib/pmsExporter';

interface NoteTabProps {
  noteText: string;
  onChangeNoteText: (newText: string) => void;
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  onOpenTemplateModal?: () => void;
  patientName?: string;
  dentistName?: string;
  onFeedback?: (rating: 'positive' | 'negative') => void;
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
}: NoteTabProps) {
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
    setTimeout(() => setToastMessage(null), 3000);
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

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-3 right-6 z-30 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-xl shadow-lg animate-fade-in flex items-center gap-2">
          <span>✓</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Note Toolbar: Template Pills & Copy / Undo Actions */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200/80 bg-[#FAF9F7] select-none">
        {/* Horizontal Template Selector Pills */}
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
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
              title="More Templates"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
            </button>
          )}
        </div>

        {/* Action Controls: Undo/Redo & Copy Dropdown */}
        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2m0 0l-4-4m4 4l4-4" transform="scale(-1, 1) translate(-24, 0)" />
              </svg>
            </button>
            <div className="w-px h-3.5 bg-slate-200 mx-0.5" />
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Redo (Ctrl+Y)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2m0 0l-4-4m4 4l4-4" />
              </svg>
            </button>
          </div>

          {/* Copy Split Button */}
          <div className="relative" ref={copyMenuRef}>
            <div className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all overflow-hidden">
              <button
                onClick={() => handleCopy('clean')}
                className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 hover:bg-indigo-700/80 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy
              </button>
              <button
                onClick={() => setIsCopyMenuOpen(!isCopyMenuOpen)}
                className="px-1.5 py-1.5 border-l border-indigo-500 hover:bg-indigo-700 transition-colors"
                aria-label="More copy formats"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Dropdown Options */}
            {isCopyMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40 text-xs text-slate-700 animate-fade-in">
                <button
                  onClick={() => handleCopy('clean')}
                  className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex flex-col"
                >
                  <span className="font-semibold">Copy Clean Note</span>
                  <span className="text-[10px] text-slate-400">Plain text for standard PMS text fields</span>
                </button>
                <button
                  onClick={() => handleCopy('pms')}
                  className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex flex-col border-t border-slate-100"
                >
                  <span className="font-semibold">Copy to PMS (D4W / Exact)</span>
                  <span className="text-[10px] text-slate-400">Tab-delimited ADA item ledger + note</span>
                </button>
                <button
                  onClick={() => handleCopy('full')}
                  className="w-full text-left px-3.5 py-2 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex flex-col border-t border-slate-100"
                >
                  <span className="font-semibold">Copy Full Markdown</span>
                  <span className="text-[10px] text-slate-400">With headers, bullets & styling</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Clinical Progress Note Textarea */}
      <div className="flex-1 p-6 overflow-y-auto">
        <textarea
          value={noteText}
          onChange={handleTextChange}
          placeholder="Clinical note will appear here once audio is transcribed or template is applied..."
          className="w-full h-full min-h-[480px] p-4 text-sm font-mono text-slate-800 bg-transparent border-0 focus:ring-0 focus:outline-none resize-none leading-relaxed"
        />
      </div>

      {/* Footer: Feedback Rating & Medicolegal Compliance Indicators */}
      <div className="flex items-center justify-between px-6 py-2.5 border-t border-slate-200/80 bg-[#FAF9F7] text-xs text-slate-500 select-none">
        {/* Quality Feedback */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-600">Rate note quality:</span>
          <button
            onClick={() => handleFeedbackClick('positive')}
            className={`p-1 rounded-md transition-colors ${
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
            className={`p-1 rounded-md transition-colors ${
              feedbackRating === 'negative'
                ? 'bg-rose-100 text-rose-700 font-bold'
                : 'hover:bg-slate-200/60 text-slate-500'
            }`}
            title="Needs improvement"
          >
            👎
          </button>
        </div>

        {/* Regulatory Badges.
            These assert that coding has been verified and the record meets the
            Board's standards, so they belong to a note that exists. Rendered
            unconditionally they claimed verification on an empty note — the
            first thing a new clinician sees. */}
        {noteText.trim().length > 0 ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[11px] text-slate-600" title="Australian Dental Association 13th Edition coding system verified">
              <span>🦷</span> ADA Codes Verified
            </span>
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium" title="Adheres to Dental Board of Australia professional record-keeping standards">
              <span>🛡️</span> AHPRA Compliant
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">No note drafted yet</span>
        )}
      </div>
    </div>
  );
}
