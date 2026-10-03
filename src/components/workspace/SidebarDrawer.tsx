import React, { useState, useMemo } from 'react';
import { Consultation } from '../../types';

interface SidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  consultations: Consultation[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession?: () => void;
  dirtySessionIds?: string[];
}

type FilterTab = 'all' | 'in_progress' | 'completed' | 'signed';

export default function SidebarDrawer({
  isOpen,
  onClose,
  consultations,
  activeSessionId,
  onSelectSession,
  onNewSession,
  dirtySessionIds = [],
}: SidebarDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  // Categorize counts (mutually exclusive clinical lifecycle states)
  const counts = useMemo(() => {
    let inProgress = 0;
    let completed = 0;
    let signed = 0;

    for (const c of consultations) {
      if (c.attestation?.signatureHash) {
        signed++;
      } else if (c.status === 'Completed' || (c.clinicalProgressNote && c.clinicalProgressNote.trim().length > 30)) {
        completed++;
      } else {
        inProgress++;
      }
    }

    return { all: consultations.length, inProgress, completed, signed };
  }, [consultations]);

  // Filter consultations across tab, patient name, date, or clinical content
  const filteredSessions = useMemo(() => {
    return consultations.filter(c => {
      // 1. Tab filter
      const isSigned = Boolean(c.attestation?.signatureHash);
      const isCompleted = !isSigned && (c.status === 'Completed' || (c.clinicalProgressNote && c.clinicalProgressNote.trim().length > 30));
      const isInProgress = !isSigned && !isCompleted;

      if (activeFilter === 'in_progress') {
        if (!isInProgress) return false;
      } else if (activeFilter === 'completed') {
        if (!isCompleted) return false;
      } else if (activeFilter === 'signed') {
        if (!isSigned) return false;
      }

      // 2. Search query filter
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      const name = `${c.firstName || ''} ${c.lastName || ''} ${(c as any).patientName || ''}`.toLowerCase();
      const date = (c.date || '').toLowerCase();
      const note = (c.clinicalProgressNote || '').toLowerCase();
      const complaint = (c.findings?.chiefComplaint || '').toLowerCase();
      return name.includes(query) || date.includes(query) || note.includes(query) || complaint.includes(query);
    });
  }, [consultations, activeFilter, searchQuery]);

  if (!isOpen) return null;

  return (
    <aside
      aria-label="Patient Sessions Drawer"
      className="w-96 flex-shrink-0 bg-white border-r border-slate-200/90 flex flex-col p-4 z-20 shadow-xl animate-fade-in select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-900">Patient Sessions</h2>
          <span className="text-[11px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
            {consultations.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onNewSession && (
            <button
              onClick={() => {
                onNewSession();
                onClose();
              }}
              className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/80 px-2.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
              title="Start a new session"
            >
              <span>+ New</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer transition-colors"
            aria-label="Close sessions drawer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl mb-3 text-[11px] font-medium text-slate-600">
        <button
          onClick={() => setActiveFilter('all')}
          className={`flex-1 py-1 px-1.5 rounded-lg transition-all text-center ${
            activeFilter === 'all'
              ? 'bg-white text-slate-900 font-bold shadow-2xs'
              : 'hover:text-slate-900'
          }`}
        >
          All ({counts.all})
        </button>
        <button
          onClick={() => setActiveFilter('in_progress')}
          className={`flex-1 py-1 px-1.5 rounded-lg transition-all text-center ${
            activeFilter === 'in_progress'
              ? 'bg-white text-indigo-700 font-bold shadow-2xs'
              : 'hover:text-slate-900'
          }`}
        >
          In Progress ({counts.inProgress})
        </button>
        <button
          onClick={() => setActiveFilter('completed')}
          className={`flex-1 py-1 px-1.5 rounded-lg transition-all text-center ${
            activeFilter === 'completed'
              ? 'bg-white text-emerald-700 font-bold shadow-2xs'
              : 'hover:text-slate-900'
          }`}
        >
          Saved ({counts.completed})
        </button>
        <button
          onClick={() => setActiveFilter('signed')}
          className={`flex-1 py-1 px-1.5 rounded-lg transition-all text-center ${
            activeFilter === 'signed'
              ? 'bg-white text-violet-700 font-bold shadow-2xs'
              : 'hover:text-slate-900'
          }`}
        >
          Signed ({counts.signed})
        </button>
      </div>

      {/* Search Input */}
      <div className="relative mb-3">
        <input
          type="text"
          placeholder="Search by patient, note, or date..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-7 py-2 text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 outline-none transition-all"
        />
        <svg
          className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {filteredSessions.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
            <span className="text-2xl">📋</span>
            <span>No matching patient sessions found.</span>
            {onNewSession && (
              <button
                onClick={() => {
                  onNewSession();
                  onClose();
                }}
                className="mt-1 text-xs text-indigo-600 font-semibold hover:underline cursor-pointer"
              >
                Start a fresh session
              </button>
            )}
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isSigned = Boolean(session.attestation?.signatureHash);
            const isDirty = !isSigned && dirtySessionIds.includes(session.id);
            const isCompleted = !isSigned && (session.status === 'Completed' || (session.clinicalProgressNote && session.clinicalProgressNote.trim().length > 30));
            const rawFirst = (session.firstName || '').trim();
            const rawLast = (session.lastName || '').trim();
            const fallbackName = (session as any).patientName || (session as any).name;
            const name = (rawFirst || rawLast)
              ? `${rawFirst} ${rawLast}`.trim()
              : (fallbackName || `Session #${session.id.slice(-6)}`);
            const initials = name
              .split(' ')
              .map(n => n[0])
              .filter(Boolean)
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'PT';

            const displayDate = session.date || (session.createdAt ? new Date(session.createdAt).toLocaleDateString('en-AU') : 'Today');
            const apptType = session.appointmentType ? session.appointmentType.replace(/_/g, ' ') : 'Consultation';
            const utterancesCount = session.transcript?.length || 0;

            // Note preview text
            const notePreview = (session.clinicalProgressNote || session.findings?.chiefComplaint || 'Consultation in progress...')
              .replace(/^[#\-\*\s]+/gm, '')
              .slice(0, 75);

            return (
              <div
                key={session.id}
                onClick={() => {
                  onSelectSession(session.id);
                  onClose();
                }}
                className={`p-3 rounded-xl cursor-pointer transition-all border ${
                  isActive
                    ? 'bg-indigo-50/90 border-indigo-300 shadow-xs'
                    : 'bg-white hover:bg-slate-50 border-slate-200/80 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {initials}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {name}
                      </span>
                      <span className="text-[10px] text-slate-400 capitalize truncate">
                        {displayDate} • {apptType}
                      </span>
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="shrink-0 flex items-center gap-1">
                    {isSigned ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200/60" title="Cryptographically sealed">
                        ✓ Signed
                      </span>
                    ) : isCompleted ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-full">
                        Saved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-100/90 px-1.5 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                        In Progress
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center text-[9px] font-bold text-indigo-700 bg-indigo-100/80 px-1.5 py-0.2 rounded-full border border-indigo-200">
                        Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Clinical Content Snippet */}
                <p className="text-[11px] text-slate-500 line-clamp-1 italic mb-2">
                  "{notePreview}..."
                </p>

                {/* Footer Metrics */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <span>🎙️ {utterancesCount} lines</span>
                    {session.findings?.toothFindings && (
                      <span>🦷 Teeth noted</span>
                    )}
                  </div>
                  <div>
                    {isDirty ? (
                      <span className="text-amber-600 font-medium flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                        Unsaved edits
                      </span>
                    ) : (
                      <span className="text-emerald-600 font-medium">✓ Synced</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="pt-3 border-t border-slate-100 mt-2 text-[11px] text-slate-400 flex items-center justify-between">
        <span>Cross-patient boundary isolation active (Rule 14)</span>
      </div>
    </aside>
  );
}
