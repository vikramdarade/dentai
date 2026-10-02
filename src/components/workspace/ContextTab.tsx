import React, { useRef, useState } from 'react';

export interface AttachmentItem {
  id: string;
  name: string;
  type: string;
  size?: string;
}

interface ContextTabProps {
  contextText: string;
  onChangeContext: (text: string) => void;
  onSyncChangesToNote: () => void;
  isSyncing?: boolean;
  attachments?: AttachmentItem[];
  onAddAttachment?: (file: File) => void;
  onRemoveAttachment?: (id: string) => void;
}

export default function ContextTab({
  contextText,
  onChangeContext,
  onSyncChangesToNote,
  isSyncing = false,
  attachments = [
    { id: 'att-1', name: 'New_Patient_Intake_Form.pdf', type: 'pdf', size: '240 KB' },
    { id: 'att-2', name: 'Bitewing_Radiographs_BW24.jpg', type: 'image', size: '1.2 MB' },
    { id: 'att-3', name: 'GP_Medical_Clearance_Asthma.pdf', type: 'pdf', size: '110 KB' },
  ],
  onAddAttachment,
  onRemoveAttachment,
}: ContextTabProps) {
  const [localAttachments, setLocalAttachments] = useState<AttachmentItem[]>(attachments);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasContextChanged, setHasContextChanged] = useState(false);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChangeContext(e.target.value);
    setHasContextChanged(true);
  };

  const handleSyncClick = () => {
    onSyncChangesToNote();
    setHasContextChanged(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (onAddAttachment) {
        onAddAttachment(file);
      } else {
        const newAtt: AttachmentItem = {
          id: `att-${Date.now()}`,
          name: file.name,
          type: file.type.includes('pdf') ? 'pdf' : 'image',
          size: `${Math.round(file.size / 1024)} KB`,
        };
        setLocalAttachments(prev => [...prev, newAtt]);
      }
    }
  };

  const handleRemove = (id: string) => {
    if (onRemoveAttachment) {
      onRemoveAttachment(id);
    } else {
      setLocalAttachments(prev => prev.filter(a => a.id !== id));
    }
  };

  return (
    <div className="flex flex-col h-full bg-white p-6 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto flex flex-col gap-6">
        {/* Banner with sync trigger */}
        <div className="flex items-center justify-between bg-[#FAF9F7] p-4 rounded-xl border border-slate-200/80">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Pre-Consultation Context & History</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Enter medical alerts, allergies, and prior history to ground note generation.
            </p>
          </div>
          <button
            onClick={handleSyncClick}
            disabled={isSyncing || !contextText.trim()}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all shadow-sm ${
              hasContextChanged
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <svg
              className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {isSyncing ? 'Syncing...' : 'Sync changes to note'}
          </button>
        </div>

        {/* Freeform Context Textarea */}
        <div className="flex flex-col gap-2">
          <label htmlFor="context-notes" className="text-xs font-semibold text-slate-700">
            Clinical History, Allergies & Presenting Concerns
          </label>
          <textarea
            id="context-notes"
            value={contextText}
            onChange={handleTextChange}
            rows={7}
            placeholder="e.g. 25F presenting with cold sensitivity on tooth 46 for 4 days. Medical history: Mild asthma (Salbutamol PRN). No known drug allergies (NKDA). No bisphosphonates or anticoagulants."
            className="w-full text-sm text-slate-800 p-4 rounded-xl border border-slate-200 bg-[#FAF9F7]/50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all resize-y leading-relaxed font-sans placeholder:text-slate-400"
          />
        </div>

        {/* Attached Intake Documents & Radiographs */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">
              Attached Documents & Radiographs ({localAttachments.length})
            </label>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Attach file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.dcm"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {localAttachments.map(att => (
              <div
                key={att.id}
                className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-xs"
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    {att.type === 'pdf' ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-xs font-semibold text-slate-800 truncate" title={att.name}>
                      {att.name}
                    </span>
                    {att.size && <span className="text-[10px] text-slate-400">{att.size}</span>}
                  </div>
                </div>

                <button
                  onClick={() => handleRemove(att.id)}
                  className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 transition-colors"
                  aria-label={`Remove ${att.name}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Guidance Notice */}
        <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed">
          <span className="text-base leading-none">🛡️</span>
          <span>
            <strong>AHPRA & DBA Guideline:</strong> Context information helps verify patient consent and medical risk factors. Always confirm allergies and current medications verbally chairside before operative interventions.
          </span>
        </div>
      </div>
    </div>
  );
}
