import React, { useState } from 'react';
import {
  Gift,
  Copy,
  Check,
  Share2,
  X,
  Sparkles,
  Radio,
  Users,
  TrendingUp,
  MessageCircle,
  ExternalLink
} from 'lucide-react';
import { motion } from 'motion/react';

interface GiftChairModalProps {
  isOpen: boolean;
  onClose: () => void;
  clinicName?: string;
  dentistName?: string;
}

export default function GiftChairModal({
  isOpen,
  onClose,
  clinicName = 'Bright Smile Dental',
  dentistName = 'Dr. Vikram Darade'
}: GiftChairModalProps) {
  const [chairLabel, setChairLabel] = useState('Operatory 2 (Associate)');
  const [loading, setLoading] = useState(false);
  const [giftCode, setGiftCode] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerateGift = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('dentai_token') || sessionStorage.getItem('dentai_token');
      const res = await fetch('/api/referrals/gift-chair', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          recipientChairLabel: chairLabel
        })
      });

      if (!res.ok) {
        throw new Error('Failed to generate chair gift pass.');
      }

      const data = await res.json();
      setGiftCode(data.gift.id);
      const fullUrl = `${window.location.origin}${data.inviteUrl}`;
      setInviteUrl(fullUrl);
      setWhatsappUrl(data.whatsappShareUrl || `https://wa.me/?text=${encodeURIComponent(`Hey! I gifted you a free 30-day DentAI Chair 2 pass for our operatory. Claim it here: ${fullUrl}`)}`);
    } catch (err: any) {
      setError(err.message || 'Could not connect to gift server.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden text-slate-900 dark:text-slate-100"
      >
        {/* Header */}
        <div className="relative p-6 bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-800 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner">
                <Gift className="w-5 h-5 text-emerald-200" />
              </div>
              <div>
                <h3 className="font-bold text-base tracking-tight">Gift Chair 2 (30-Day Pass)</h3>
                <p className="text-xs text-emerald-100 font-medium">{clinicName} • Multi-Operatory Expansion</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-emerald-100 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/30 border border-emerald-300/30 text-emerald-100">
              <Sparkles className="w-3 h-3" />
              $149 AUD Value • 100% Free
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/30 border border-cyan-300/30 text-cyan-100">
              <Radio className="w-3 h-3" />
              Unlocks Operatory Intercom
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {!giftCode ? (
            <form onSubmit={handleGenerateGift} className="space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Invite your associate dentist, hygienist, or neighboring operatory to use DentAI chairside.
                Zero IT setup required — they simply open Chrome on their surgery computer to begin ambient transcription.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Operatory / Recipient Label
                </label>
                <input
                  type="text"
                  required
                  value={chairLabel}
                  onChange={(e) => setChairLabel(e.target.value)}
                  placeholder="e.g. Operatory 2 (Associate)"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none transition-all"
                />
              </div>

              {/* Flywheel Benefits */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 space-y-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="flex items-start gap-2">
                  <Radio className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 mt-0.5 shrink-0" />
                  <span><strong>Operatory Intercom:</strong> Instant chair-to-chair mic intercom for quick clinical second opinions without leaving the sterile field.</span>
                </div>
                <div className="flex items-start gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <span><strong>Treatment Velocity:</strong> Practice owner dashboard surfaces collective unscheduled restorative pipeline across all chairs.</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 disabled:opacity-50"
              >
                {loading ? (
                  <span>Generating 30-Day Chair 2 Pass...</span>
                ) : (
                  <>
                    <Gift className="w-4 h-4" />
                    <span>Generate 30-Day Pass for Chair 2</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                  Pass Ready to Share
                </span>
                <div className="font-mono text-xl font-extrabold text-emerald-900 dark:text-emerald-100 tracking-wider">
                  {giftCode}
                </div>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  Valid for 30 days on {chairLabel}. Full features included.
                </p>
              </div>

              {/* Copy Invite Link */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Direct Claim URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteUrl || ''}
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300 select-all outline-none"
                  />
                  <button
                    onClick={handleCopyLink}
                    className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                      copied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-teal-700 hover:bg-teal-600 text-white'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* WhatsApp & Social Share Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all text-center"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>WhatsApp Pass</span>
                  </a>
                )}
                <button
                  onClick={handleCopyLink}
                  className="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-300 dark:border-slate-700 transition-all cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share Pass Link</span>
                </button>
              </div>

              {/* Multi-chair unlock notice */}
              <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/60 text-xs text-teal-800 dark:text-teal-300 flex items-start gap-2.5">
                <Radio className="w-4 h-4 text-teal-600 dark:text-teal-400 mt-0.5 shrink-0" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Automatic Operatory Intercom:</strong> Once the associate claims this link, both operatories will see the live Intercom icon in their title bar.
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs cursor-pointer transition-all"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
