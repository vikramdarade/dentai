import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X, Copy, RefreshCw, ShieldCheck, Check, AlertCircle, Loader2, Building2, Pencil, CheckCircle2, XCircle
} from 'lucide-react';
import { ClinicMembership, ClinicMemberSummary } from '../lib/clinics';

interface ClinicMembersModalProps {
  clinic: ClinicMembership;
  authToken: string;
  onClose: () => void;
  /** Called after approve/decline/rotate/rename so App can refresh state. */
  onChanged: () => void;
}

export default function ClinicMembersModal({ clinic, authToken, onClose, onChanged }: ClinicMembersModalProps) {
  const [members, setMembers] = useState<ClinicMemberSummary[]>([]);
  const [inviteCode, setInviteCode] = useState(clinic.inviteCode || '');
  const [clinicName, setClinicName] = useState(clinic.clinicName);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [renameMode, setRenameMode] = useState(false);
  const [renameValue, setRenameValue] = useState(clinic.clinicName);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };

  const loadMembers = async () => {
    try {
      const res = await fetch(`/api/clinics/${clinic.clinicId}/members`, { headers: authHeaders });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not load clinic members.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
      if (data.inviteCode) setInviteCode(data.inviteCode);
    } catch (err) {
      setError('Network error while loading members.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic.clinicId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Clipboard unavailable — select and copy the code manually.');
    }
  };

  const handleRotate = async () => {
    setBusyAction('rotate');
    setError(null);
    try {
      const res = await fetch(`/api/clinics/${clinic.clinicId}/rotate-code`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to rotate code.');
      setInviteCode(data.inviteCode);
      onChanged();
    } catch (err: any) {
      setError(err.message || 'Failed to rotate invite code.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim() || renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/clinics/${clinic.clinicId}/rename`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ name: renameValue.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to rename clinic.');
      setClinicName(data.name);
      setRenameMode(false);
      onChanged();
    } catch (err: any) {
      setRenameError(err.message || 'Failed to rename clinic.');
    } finally {
      setRenameBusy(false);
    }
  };

  const handleDecision = async (dentistId: string, action: 'approve' | 'decline') => {
    setBusyAction(`${action}-${dentistId}`);
    setError(null);
    try {
      const res = await fetch(`/api/clinics/${clinic.clinicId}/members/${dentistId}/${action}`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to ${action} member.`);
      setMembers(prev => action === 'approve'
        ? prev.map(m => m.dentistId === dentistId ? { ...m, status: 'active' } : m)
        : prev.filter(m => m.dentistId !== dentistId));
      onChanged();
    } catch (err: any) {
      setError(err.message || `Failed to ${action} member.`);
    } finally {
      setBusyAction(null);
    }
  };

  const pending = members.filter(m => m.status === 'pending');
  const active = members.filter(m => m.status === 'active');
  const getInitials = (name: string) =>
    name.split(' ').filter(n => n.toLowerCase() !== 'dr.').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4 py-10">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        className="bg-white rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-100 font-sans"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-primary flex items-center justify-center border border-indigo-100">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-base font-extrabold text-slate-800 leading-tight">{clinicName}</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Clinic management · Owner
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-6">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Invite code card */}
          <section className="rounded-2xl border border-slate-200 bg-[#faf9f7] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
                  Invite colleagues with this code
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono font-extrabold text-xl tracking-[0.2em] text-primary">
                    {inviteCode || '·······'}
                  </span>
                  {copied && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Copied
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!inviteCode || busyAction === 'rotate'}
                  className="h-9 px-3 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-opacity-90 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRotate}
                  disabled={busyAction === 'rotate'}
                  className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1.5"
                  title="Generate a new code if this one was shared too widely"
                >
                  {busyAction === 'rotate'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">New code</span>
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              Share this code with associates, locums, or colleagues. New members land as
              <span className="font-bold text-slate-500"> pending</span> and see nothing until you approve them below.
            </p>
          </section>

          {/* Rename clinic */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
                Clinic name
              </span>
              {!renameMode && (
                <button
                  type="button"
                  onClick={() => { setRenameMode(true); setRenameError(null); }}
                  className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-primary transition-colors cursor-pointer"
                >
                  <Pencil className="w-3 h-3" /> Rename
                </button>
              )}
            </div>
            {renameMode ? (
              <form onSubmit={handleRename} className="flex flex-col gap-2">
                <input
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  maxLength={80}
                  autoFocus
                  className="h-10 px-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm text-slate-800"
                />
                {renameError && (
                  <span className="text-[11px] font-semibold text-red-600">{renameError}</span>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRenameMode(false)}
                    className="flex-1 h-9 rounded-lg border border-slate-200 text-slate-500 text-[11px] font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={renameBusy || !renameValue.trim()}
                    className="flex-1 h-9 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-opacity-90 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {renameBusy ? 'Saving…' : 'Save name'}
                  </button>
                </div>
              </form>
            ) : (
              <span className="text-sm font-bold text-slate-700">{clinicName}</span>
            )}
          </section>

          {/* Members */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400">
                Members ({members.length})
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-bold">Loading members…</span>
              </div>
            ) : (
              <>
                {pending.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                      Pending approval ({pending.length})
                    </span>
                    {pending.map(m => (
                      <div key={m.dentistId} className="flex items-center gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50/50">
                        <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {getInitials(m.name)}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold text-slate-800 truncate">{m.name}</span>
                          <span className="text-[10px] text-slate-500">
                            Requested to join — approves to a dentist member
                          </span>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busyAction === `approve-${m.dentistId}`}
                            onClick={() => handleDecision(m.dentistId, 'approve')}
                            className="h-8 px-2.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            {busyAction === `approve-${m.dentistId}`
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Check className="w-3 h-3" />}
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyAction === `decline-${m.dentistId}`}
                            onClick={() => handleDecision(m.dentistId, 'decline')}
                            className="h-8 px-2.5 rounded-lg border border-red-200 bg-white text-red-600 text-[10px] font-bold hover:bg-red-50 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            {busyAction === `decline-${m.dentistId}`
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <XCircle className="w-3 h-3" />}
                            <span>Decline</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Active ({active.length})
                  </span>
                  {active.map(m => (
                    <div key={m.dentistId} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-white">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                        m.role === 'owner' ? 'bg-primary text-white' : 'bg-indigo-50 text-primary'
                      }`}>
                        {getInitials(m.name)}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-800 truncate">{m.name}</span>
                        <span className="text-[10px] text-slate-500">
                          {m.role === 'owner' ? 'Clinic owner' : 'Dentist member'}
                        </span>
                      </div>
                      {m.role === 'owner' && (
                        <span className="px-2 py-0.5 rounded-full bg-primary-light text-primary text-[9px] font-extrabold uppercase tracking-wider shrink-0">
                          Owner
                        </span>
                      )}
                    </div>
                  ))}
                  {active.length === 0 && pending.length === 0 && (
                    <div className="text-xs text-slate-400 py-3 text-center">
                      No members yet — share your invite code above.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </motion.div>
    </div>
  );
}