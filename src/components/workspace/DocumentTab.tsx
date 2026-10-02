import React, { useEffect, useState } from 'react';
import type { TranscriptItem } from '../../types';

export type DocumentKind = 'referral' | 'explainer' | 'certificate';

export const DOCUMENT_TABS: Array<{ kind: DocumentKind; label: string; icon: string }> = [
  { kind: 'referral', label: 'Specialist Referral Letter', icon: '📨' },
  { kind: 'explainer', label: 'Patient Care Guide', icon: '🧑‍⚕️' },
  { kind: 'certificate', label: 'Attendance Certificate', icon: '📜' },
];

interface DocumentTabProps {
  authToken?: string | null;
  /** The current clinical progress note — grounding context for generation. */
  currentNote?: string;
  /** Pre-consultation context (history, alerts) captured in the Context tab. */
  contextText?: string;
  transcript?: TranscriptItem[];
  patientName?: string;
  dentistName?: string;
  appointmentType?: string;
  /** Optionally lift the active sub-tab into the parent workspace. */
  activeKind?: DocumentKind;
  onKindChange?: (kind: DocumentKind) => void;
}

interface DocEntry {
  content: string;
  updatedAt: string | null;
}

const EMPTY_DOCS: Record<DocumentKind, DocEntry> = {
  referral: { content: '', updatedAt: null },
  explainer: { content: '', updatedAt: null },
  certificate: { content: '', updatedAt: null },
};

const PLACEHOLDER: Record<DocumentKind, string> = {
  referral:
    'The specialist referral letter will appear here. Generate it from the consultation note, then edit before sending.',
  explainer:
    'The patient care guide will appear here in plain language — findings, treatment today, aftercare and warning signs.',
  certificate:
    'The dental attendance certificate will appear here, ready to review, print and sign.',
};

const COPILOT_PROMPT: Record<DocumentKind, (ctx: { patientName: string; dentistName: string }) => string> = {
  referral: ({ patientName, dentistName }) =>
    `Draft a formal specialist referral letter for ${patientName}. State the reason for referral, relevant history and clinical findings, provisional diagnosis, treatment already provided, the clinical question for the specialist, and the referring clinician${dentistName ? ` (${dentistName})` : ''}. Use Australian clinical letter conventions.`,
  explainer: ({ patientName }) =>
    `Write a plain-language patient care guide for ${patientName} based on this consultation. Cover what was found, what was done today, home-care instructions, warning signs that need urgent attention, and follow-up timing. Keep it simple, non-technical and reassuring.`,
  certificate: ({ patientName, dentistName }) =>
    `Draft a dental attendance certificate for ${patientName} recording the date of attendance, the treatment performed and the treating clinician${dentistName ? ` (${dentistName})` : ''}, with formal Australian certificate wording ready to print and sign.`,
};

export default function DocumentTab({
  authToken = null,
  currentNote = '',
  contextText = '',
  transcript = [],
  patientName = 'the patient',
  dentistName = '',
  appointmentType = '',
  activeKind,
  onKindChange,
}: DocumentTabProps) {
  const [internalKind, setInternalKind] = useState<DocumentKind>(activeKind ?? 'referral');
  const [docs, setDocs] = useState<Record<DocumentKind, DocEntry>>(EMPTY_DOCS);
  const [busyKind, setBusyKind] = useState<DocumentKind | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const kind = activeKind ?? internalKind;

  useEffect(() => {
    if (activeKind && activeKind !== internalKind) setInternalKind(activeKind);
  }, [activeKind, internalKind]);

  const triggerToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage((current) => (current === message ? null : current)), 3500);
  };

  const selectKind = (next: DocumentKind) => {
    setInternalKind(next);
    onKindChange?.(next);
  };

  const updateContent = (next: DocumentKind, content: string) => {
    setDocs((prev) => ({
      ...prev,
      [next]: { content, updatedAt: new Date().toISOString() },
    }));
  };

  const handleGenerate = async (target: DocumentKind = kind) => {
    if (busyKind) return;
    setBusyKind(target);
    try {
      const res = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken || ''}`,
        },
        body: JSON.stringify({
          prompt: COPILOT_PROMPT[target]({ patientName, dentistName }),
          currentNote,
          context: contextText,
          transcript,
          patientName,
          appointmentType,
        }),
      });

      if (!res.ok) {
        throw new Error(`The document service responded with ${res.status}.`);
      }
      const data = await res.json();
      const content =
        typeof data?.result === 'string'
          ? data.result
          : data?.result != null
            ? JSON.stringify(data.result, null, 2)
            : '';
      if (!content.trim()) {
        throw new Error('No document content was returned.');
      }
      updateContent(target, content);
      triggerToast(
        target === 'referral'
          ? 'Generated specialist referral letter.'
          : target === 'explainer'
            ? 'Created patient home-care guide.'
            : 'Created dental attendance certificate.',
      );
    } catch (error) {
      console.warn('Document generation failed:', error);
      triggerToast(
        error instanceof Error ? error.message : 'Document generation failed. Please try again.',
      );
    } finally {
      setBusyKind(null);
    }
  };

  const handleCopy = async () => {
    const content = docs[kind].content;
    if (!content.trim()) {
      triggerToast('Generate the document before copying it.');
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      triggerToast('Copied document to clipboard.');
    } catch {
      triggerToast('Clipboard access was blocked — select the text and copy manually.');
    }
  };

  const entry = docs[kind];
  const wordCount = entry.content.trim() ? entry.content.trim().split(/\s+/).length : 0;
  const activeLabel = DOCUMENT_TABS.find((tab) => tab.kind === kind)?.label ?? 'Document';

  return (
    <div className="flex flex-col h-full bg-white relative">
      {toastMessage && (
        <div className="absolute top-3 right-6 z-30 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-xl shadow-lg flex items-center gap-2">
          <span>✓</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Sub-tab toolbar */}
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-slate-200/80 bg-[#FAF9F7]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {DOCUMENT_TABS.map((tab) => {
            const selected = tab.kind === kind;
            return (
              <button
                key={tab.kind}
                type="button"
                onClick={() => selectKind(tab.kind)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors cursor-pointer ${
                  selected
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span aria-hidden>{tab.icon}</span>
                <span>{tab.label}</span>
                {docs[tab.kind].content.trim() && (
                  <span className={`w-1.5 h-1.5 rounded-full ${selected ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={busyKind !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {busyKind === kind ? (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <span aria-hidden>✨</span>
                {entry.content.trim() ? 'Regenerate' : 'Generate'}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!entry.content.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <span aria-hidden>📋</span>
            Copy Document
          </button>
        </div>
      </div>

      {/* Output editor */}
      <div className="flex-1 flex flex-col px-6 py-4 overflow-hidden">
        <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col gap-2 min-h-0">
          <div className="flex items-center justify-between">
            <label htmlFor="document-editor" className="text-xs font-semibold text-slate-700">
              {activeLabel}
            </label>
            <span className="text-[11px] text-slate-400">
              {wordCount} word{wordCount === 1 ? '' : 's'}
              {entry.updatedAt
                ? ` · updated ${new Date(entry.updatedAt).toLocaleTimeString('en-AU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </span>
          </div>
          <textarea
            id="document-editor"
            value={entry.content}
            onChange={(event) => updateContent(kind, event.target.value)}
            placeholder={PLACEHOLDER[kind]}
            className="flex-1 w-full min-h-[280px] text-sm text-slate-800 leading-relaxed p-4 rounded-xl border border-slate-200 bg-[#FAF9F7]/50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all resize-none font-sans placeholder:text-slate-400"
          />
          <div className="text-[11px] text-amber-700 font-medium">
            ⚠️ Review and edit every generated document before it leaves the practice — AI drafts can miss or
            misstate clinical detail.
          </div>
        </div>
      </div>
    </div>
  );
}
