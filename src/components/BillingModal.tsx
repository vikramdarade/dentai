import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
  ShieldCheck,
  ArrowRight,
  Receipt,
  FileText,
  Sparkles
} from 'lucide-react';
import { ClinicMembership } from '../lib/clinics';
import { PLANS, PlanId, Entitlements } from '../lib/plans';

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeClinic: ClinicMembership | null;
  authToken: string;
  onPlanUpdated?: () => void;
}

interface BillingStatusResponse {
  clinicId: string;
  stripeConfigured: boolean;
  subscription: {
    plan?: PlanId;
    tier?: PlanId;
    status: string;
    seats: number;
    currentPeriodEnd?: string;
  } | null;
  entitlements: Entitlements;
  plans: typeof PLANS[PlanId][];
}

export default function BillingModal({
  isOpen,
  onClose,
  activeClinic,
  authToken,
  onPlanUpdated
}: BillingModalProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [billingData, setBillingData] = useState<BillingStatusResponse | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<boolean>(false);
  const [portalBusy, setPortalBusy] = useState<boolean>(false);
  const [activeMembersCount, setActiveMembersCount] = useState<number>(1);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'info'; message: string } | null>(null);

  // Check URL parameters for checkout redirect feedback
  useEffect(() => {
    if (isOpen) {
      const hash = window.location.hash;
      if (hash.includes('status=success')) {
        setBannerNotice({
          type: 'success',
          message: 'Payment received! Your Practice Plan is now active. Tax receipt sent to your email.'
        });
      } else if (hash.includes('status=cancelled')) {
        setBannerNotice({
          type: 'info',
          message: 'Checkout was cancelled. No charges were made to your card.'
        });
      }
    }
  }, [isOpen]);

  const loadBillingStatus = async () => {
    if (!activeClinic) return;
    setLoading(true);
    setError(null);

    try {
      const billingRes = await fetch(
        `/api/billing/status?clinicId=${encodeURIComponent(activeClinic.clinicId)}`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      if (billingRes.status === 403) {
        setError('Only the practice owner can manage subscription and billing settings.');
        setLoading(false);
        return;
      }

      if (!billingRes.ok) {
        const errJson = await billingRes.json().catch(() => ({}));
        setError(errJson.error || 'Could not load billing status.');
        setLoading(false);
        return;
      }

      const data: BillingStatusResponse = await billingRes.json();
      setBillingData(data);

      const targetClinicId = data.clinicId || activeClinic.clinicId;
      const membersRes = await fetch(`/api/clinics/${targetClinicId}/members`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (membersRes.ok) {
        const membersData = await membersRes.json();
        const activeCount = Array.isArray(membersData.members)
          ? membersData.members.filter((m: any) => m.status === 'active').length
          : 1;
        setActiveMembersCount(activeCount);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error loading billing information.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadBillingStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeClinic?.clinicId]);

  const handleUpgrade = async () => {
    setCheckoutBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          plan: 'practice',
          clinicId: billingData?.clinicId || activeClinic?.clinicId
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Checkout initialization failed.');
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Checkout URL not received.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to start Stripe checkout.');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleOpenPortal = async () => {
    setPortalBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          clinicId: billingData?.clinicId || activeClinic?.clinicId
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not open billing portal.');
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No billing portal URL returned.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not open billing portal.');
      setPortalBusy(false);
    }
  };

  if (!isOpen) return null;

  const currentPlanId: PlanId = (billingData?.subscription?.plan || billingData?.entitlements?.plan || 'solo') as PlanId;
  const isPracticeActive = currentPlanId === 'practice' && billingData?.entitlements?.active;
  const maxSeats = billingData?.entitlements?.seats || PLANS[currentPlanId]?.seats || 1;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100 font-sans my-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-3xl z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-primary flex items-center justify-center border border-indigo-100">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-800 leading-tight">
                Practice Plan & Invoicing
              </h3>
              <span className="text-[11px] font-bold text-slate-400">
                {activeClinic?.clinicName || 'Clinic Management'} · Australian GST Compliant
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

        <div className="p-6 space-y-6">
          {/* Status Alert Banners */}
          {bannerNotice && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold border ${
              bannerNotice.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-indigo-50 text-indigo-800 border-indigo-200'
            }`}>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{bannerNotice.message}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
              <span className="text-xs font-medium">Checking practice subscription...</span>
            </div>
          ) : (
            <>
              {/* Current Subscription Card */}
              <div className="bg-slate-50 rounded-3xl p-6 border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Current Plan
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${
                      isPracticeActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    }`}>
                      {isPracticeActive ? 'Practice Standard (Active)' : 'Solo Plan (Free Forever)'}
                    </span>
                  </div>

                  <div className="text-2xl font-black text-slate-800 tracking-tight">
                    {isPracticeActive ? '$149 AUD / month' : '$0 / month'}
                    <span className="text-xs font-medium text-slate-400 ml-1.5">
                      {isPracticeActive ? 'ex GST ($163.90 inc GST)' : 'No card required'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 font-medium pt-1">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Clinician Seats: <strong>{activeMembersCount} of {maxSeats} active</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Daily AI Notes: <strong>{billingData?.entitlements?.dailyNotes || 15} notes/day</strong>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  {isPracticeActive ? (
                    <button
                      onClick={handleOpenPortal}
                      disabled={portalBusy}
                      className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      {portalBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Receipt className="w-3.5 h-3.5 text-slate-300" />
                      )}
                      <span>Manage Payment Method & Receipts</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleUpgrade}
                      disabled={checkoutBusy}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-500/20 cursor-pointer disabled:opacity-50"
                    >
                      {checkoutBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                      )}
                      <span>Upgrade to Practice Plan ($149/mo)</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Plan Comparison Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Solo Plan Card */}
                <div className="border border-slate-200 rounded-3xl p-5 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="font-extrabold text-sm text-slate-800">Solo Plan</h4>
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                        Free Forever
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Designed for solo practitioners, associates, and locums.
                    </p>
                    <ul className="space-y-2 mt-4 text-xs text-slate-600">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>1 Clinician seat</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>15 AI notes / clinic / day</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>All 8 ADA procedure templates</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>Offline draft engine (zero lost charts)</span>
                      </li>
                    </ul>
                  </div>
                  <div className="text-[11px] text-slate-400 italic">
                    Included with every registered account.
                  </div>
                </div>

                {/* Practice Plan Card */}
                <div className="border-2 border-indigo-600 bg-indigo-50/20 rounded-3xl p-5 flex flex-col justify-between space-y-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[9px] font-black uppercase px-3 py-1 rounded-bl-xl tracking-wider">
                    Recommended
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="font-extrabold text-sm text-slate-800">Practice Plan</h4>
                    </div>
                    <div className="mt-1">
                      <span className="text-lg font-black text-slate-800">$149 AUD</span>
                      <span className="text-xs text-slate-500 font-medium"> / month</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Full operatory team suite for private practices.
                    </p>
                    <ul className="space-y-2 mt-4 text-xs text-slate-700">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span><strong>Up to 6 Clinician seats</strong></span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span><strong>200 AI notes / clinic / day</strong></span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Patient Recall Engine & Worklist</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Multi-chair compliance & team audit log</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Automated payment receipts via Stripe</span>
                      </li>
                    </ul>
                  </div>

                  {!isPracticeActive && (
                    <button
                      onClick={handleUpgrade}
                      disabled={checkoutBusy}
                      className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      {checkoutBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <span>Activate Practice Tier</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Payment & Compliance Assurance Footer */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/60 text-xs text-slate-500 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>Australian Business & Medical Privacy Standards</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  DentAI subscriptions are billed monthly in AUD via Stripe with automated digital payment receipts.
                  Stripe handles payment processing with zero health data disclosure. You can cancel or modify your subscription anytime without lock-in contracts.
                </p>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
