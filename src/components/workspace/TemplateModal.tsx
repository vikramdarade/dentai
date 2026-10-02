import React from 'react';
import { DENTAL_TEMPLATES, DentalTemplateDefinition } from '../../lib/templateEngine';

interface TemplateModalProps {
  isOpen: boolean;
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  onClose: () => void;
}

export default function TemplateModal({
  isOpen,
  selectedTemplateId,
  onSelectTemplate,
  onClose,
}: TemplateModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dental Note Template Library"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-[#FAF9F7]">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span className="text-xl">🦷</span> Dental Template Library
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select an Australian AHPRA-compliant template tailored to your procedure type.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            aria-label="Close template modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Template List */}
        <div className="p-6 overflow-y-auto divide-y divide-slate-100 space-y-4">
          {DENTAL_TEMPLATES.map((tmpl: DentalTemplateDefinition) => {
            const isSelected = tmpl.id === selectedTemplateId;
            return (
              <div
                key={tmpl.id}
                onClick={() => {
                  onSelectTemplate(tmpl.id);
                  onClose();
                }}
                className={`pt-4 first:pt-0 p-4 rounded-xl cursor-pointer transition-all border ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-50/40 shadow-sm'
                    : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-sm text-slate-900">{tmpl.name}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {tmpl.badge}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="flex items-center text-xs font-medium text-indigo-600 gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Active
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-600 mb-3">{tmpl.description}</p>

                {/* Section headers preview */}
                <div className="flex flex-wrap gap-1.5">
                  {tmpl.sections.map((sec) => (
                    <span
                      key={sec.key}
                      className="text-[11px] bg-white border border-slate-200/80 text-slate-600 px-2 py-0.5 rounded-md"
                    >
                      {sec.title.split(' ')[0]}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-[#FAF9F7] flex items-center justify-between text-xs text-slate-500">
          <span>Non-assertive placeholders prevent fabricated anatomy (Rule 19)</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
