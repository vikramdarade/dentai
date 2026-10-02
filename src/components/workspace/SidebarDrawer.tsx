import React, { useState, useMemo } from 'react';
import { Consultation } from '../../types';

interface SidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  consultations: Consultation[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  dirtySessionIds?: string[];
}

export default function SidebarDrawer({
  isOpen,
  onClose,
  consultations,
  activeSessionId,
  onSelectSession,
  dirtySessionIds = [],
}: SidebarDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter consultations across patient name, date, or clinical content
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return consultations;
    const query = searchQuery.toLowerCase();
    return consultations.filter(c => {
      const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
      const date = (c.date || '').toLowerCase();
      const note = (c.clinicalProgressNote || '').toLowerCase();
      return name.includes(query) || date.includes(query) || note.includes(query);
    });
  }, [consultations, searchQuery]);

  if (!isOpen) return null;

  return (
    <aside
      aria-label="Patient Sessions Drawer"
      className="w-80 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col p-4 z-20 shadow-md animate-fade-in select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900">Patient Sessions</h2>
          <span className="text-[11px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {consultations.length}
          </span>
        </div>
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

      {/* Search Input */}
      <div className="relative mb-3">
        <input
          type="text"
          placeholder="Search by name, date or tooth..."
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
      <div className="flex-1 overflow-y-auto space-y-1 divide-y divide-slate-100 pr-1">
        {filteredSessions.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            No matching sessions found
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isDirty = dirtySessionIds.includes(session.id);
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

            return (
              <div
                key={session.id}
                onClick={() => {
                  onSelectSession(session.id);
                  onClose();
                }}
                className={`pt-2 first:pt-0 p-2.5 rounded-xl cursor-pointer transition-all flex items-start justify-between ${
                  isActive
                    ? 'bg-indigo-50/80 border-l-4 border-indigo-600 shadow-2xs'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                    isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {initials}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      {name}
                    </span>
                    <span className="text-[11px] text-slate-400 capitalize truncate">
                      {displayDate} • {apptType}
                    </span>
                  </div>
                </div>

                {/* Sync Badge */}
                <div className="shrink-0 flex items-center pt-1">
                  {isDirty ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full" title="Changes saved locally; pending server sync">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Local
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-600 flex items-center gap-1" title="Synced with server and PMS">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Synced
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="pt-3 border-t border-slate-100 mt-2 text-[11px] text-slate-400 flex items-center justify-between">
        <span>Cross-patient audio isolation active (Rule 14)</span>
      </div>
    </aside>
  );
}
