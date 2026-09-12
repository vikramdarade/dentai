import React, { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check, UserPlus, Settings, Loader2, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { ClinicMembership } from '../lib/clinics';

interface ClinicSwitcherProps {
  clinics: ClinicMembership[];
  activeClinic: ClinicMembership | null;
  onSelectClinic: (clinicId: string) => void;
  onJoinClinic: (code: string) => Promise<{ ok: boolean; message: string }>;
  onManageClinic: () => void;
  onClinicChanged: () => void;
}

export default function ClinicSwitcher({
  clinics,
  activeClinic,
  onSelectClinic,
  onJoinClinic,
  onManageClinic,
  onClinicChanged
}: ClinicSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [joinMode, setJoinMode] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && joinMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open, joinMode]);

  const pendingClinics = clinics.filter(c => c.status === 'pending');
  const activeClinics = clinics.filter(c => c.status === 'active');

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code || joinBusy) return;
    setJoinBusy(true);
    setJoinFeedback(null);
    const result = await onJoinClinic(code);
    setJoinFeedback(result);
    setJoinBusy(false);
    if (result.ok) {
      setJoinCode('');
      setJoinMode(false);
      onClinicChanged();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setJoinMode(false); setJoinFeedback(null); }}
        className="flex items-center gap-2 h-9 px-3 rounded-xl bg-[#0E1724] border border-[#1E3048] hover:border-cyan-500/40 hover:bg-[#121E2E] transition-all cursor-pointer text-left shadow-xs"
        title="Switch clinic"
      >
        <Building2 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-slate-200 max-w-[140px] truncate">
          {activeClinic ? activeClinic.clinicName : 'Select clinic'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-[#0A1018] rounded-2xl border border-[#1E3048] shadow-2xl p-2 animate-fade-in text-slate-100">
            <div className="px-3 pt-2 pb-1 text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
              Your clinics
            </div>

            {activeClinics.length === 0 && (
              <div className="px-3 py-3 text-xs text-slate-400">
                You don't have an active clinic yet.
              </div>
            )}

            {activeClinics.map(m => (
              <button
                key={m.clinicId}
                type="button"
                onClick={() => {
                  onSelectClinic(m.clinicId);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                  activeClinic?.clinicId === m.clinicId
                    ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                    : 'hover:bg-[#121E2E] text-slate-300'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  activeClinic?.clinicId === m.clinicId ? 'bg-cyan-400 text-slate-950' : 'bg-[#121E2E] text-cyan-400'
                }`}>
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-bold truncate text-white">{m.clinicName}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    {m.role === 'owner' ? 'Owner' : 'Dentist'}
                  </span>
                </div>
                {activeClinic?.clinicId === m.clinicId && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
              </button>
            ))}

            {pendingClinics.length > 0 && (
              <>
                <div className="px-3 pt-2.5 pb-1 text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
                  Pending approval
                </div>
                {pendingClinics.map(m => (
                  <div key={m.clinicId} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl opacity-70">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                      <Building2 className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold text-slate-300 truncate">{m.clinicName}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
                        Awaiting owner approval
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="border-t border-[#182638] my-1.5" />

            {joinMode ? (
              <form onSubmit={handleJoinSubmit} className="px-2 py-1.5 flex flex-col gap-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#070B11] border border-[#1E3048] focus-within:border-cyan-400">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    ref={inputRef}
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Invite code e.g. SMILE42"
                    maxLength={12}
                    className="w-full bg-transparent text-xs font-mono font-bold tracking-widest text-white outline-none placeholder:text-slate-600 placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                  />
                </div>
                {joinFeedback && (
                  <div className={`flex items-start gap-1.5 px-1 text-[11px] font-semibold ${
                    joinFeedback.ok ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {joinFeedback.ok
                      ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                    <span>{joinFeedback.message}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setJoinMode(false); setJoinFeedback(null); }}
                    className="flex-1 h-8 rounded-lg border border-[#1E3048] text-slate-400 text-[11px] font-bold hover:bg-[#142030] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={joinBusy || !joinCode.trim()}
                    className="flex-1 h-8 rounded-lg bg-gradient-to-r from-cyan-400 to-teal-400 text-slate-950 text-[11px] font-black hover:opacity-90 disabled:opacity-40 transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    {joinBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{joinBusy ? 'Sending…' : 'Request join'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => { setJoinMode(true); setJoinFeedback(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#121E2E] text-slate-300 transition-colors cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold">Join a clinic with a code</span>
                </button>
                {activeClinic?.role === 'owner' && (
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onManageClinic(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[#121E2E] text-slate-300 transition-colors cursor-pointer"
                  >
                    <Settings className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold">Manage clinic · invite code</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}