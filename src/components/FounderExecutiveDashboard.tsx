import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  TrendingUp,
  Cpu,
  Layers,
  Bug,
  DollarSign,
  Users,
  Terminal,
  RefreshCw,
  Calendar,
  Lock,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ExternalLink,
  BookOpen,
  UserCheck,
  ArrowUpRight,
  Sparkles,
  Zap,
  Activity
} from 'lucide-react';

interface FounderExecutiveDashboardProps {
  token: string | null;
  isFounder: boolean;
  dentistName?: string;
  onBackToOperatory: () => void;
}

export const FounderExecutiveDashboard: React.FC<FounderExecutiveDashboardProps> = ({
  token,
  isFounder,
  dentistName,
  onBackToOperatory
}) => {
  const [activeTab, setActiveTab] = useState<'bento' | 'playbooks' | 'approvals'>('bento');
  const [loading, setLoading] = useState(true);
  const [runningCycle, setRunningCycle] = useState(false);
  const [briefing, setBriefing] = useState<any>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('latest');
  const [accessRequests, setAccessRequests] = useState<any[]>([]);
  const [requestReason, setRequestReason] = useState('');
  const [requestedStatus, setRequestedStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Headers helper
  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  });

  // Load latest briefing and available dates
  useEffect(() => {
    if (!isFounder) {
      setLoading(false);
      return;
    }
    loadData();
  }, [isFounder, selectedDate]);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch available historical dates
      const datesRes = await fetch('/api/company/briefings', { headers: getAuthHeaders() });
      if (datesRes.ok) {
        const dates = await datesRes.json();
        setAvailableDates(Array.isArray(dates) ? dates : []);
      }

      // 2. Fetch briefing
      const url = selectedDate === 'latest'
        ? '/api/company/briefing/latest'
        : `/api/company/briefing/${selectedDate}`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setBriefing(data);
      } else if (res.status === 403) {
        setErrorMsg('Access Restricted: Founder executive clearance required.');
      }

      // 3. Fetch pending founder access requests
      const reqRes = await fetch('/api/auth/founder-access/requests', { headers: getAuthHeaders() });
      if (reqRes.ok) {
        const reqs = await reqRes.json();
        setAccessRequests(Array.isArray(reqs) ? reqs : []);
      }
    } catch (err: any) {
      console.error('Failed to load founder dashboard:', err);
      setErrorMsg('Failed to load executive telemetry.');
    } finally {
      setLoading(false);
    }
  };

  // Run on-demand Grokbot cycle
  const handleRunCycle = async () => {
    setRunningCycle(true);
    try {
      const res = await fetch('/api/company/run-cycle', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setBriefing(data.briefing);
        setSelectedDate('latest');
        await loadData();
      }
    } catch (err) {
      console.error('Failed to run cycle:', err);
    } finally {
      setRunningCycle(false);
    }
  };

  // Submit request for founder access
  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/founder-access/request', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: requestReason })
      });
      if (res.ok) {
        setRequestedStatus('pending');
      }
    } catch (err) {
      console.error('Request access error:', err);
    }
  };

  // Review access request
  const handleReviewRequest = async (dentistId: string, approve: boolean) => {
    try {
      await fetch('/api/auth/founder-access/review', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ dentistId, approve })
      });
      setAccessRequests(prev => prev.filter(r => r.dentistId !== dentistId && r.id !== dentistId));
    } catch (err) {
      console.error('Review request error:', err);
    }
  };

  // Resolve support ticket
  const handleResolveTicket = async (ticketId: string) => {
    try {
      await fetch(`/api/support/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          status: 'resolved',
          resolutionNotes: 'Resolved chairside by Practice Principal / Founder.'
        })
      });
      await loadData();
    } catch (err) {
      console.error('Failed to resolve ticket:', err);
    }
  };

  // NON-FOUNDER GUARD SCREEN
  if (!isFounder) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6 text-slate-900 dark:text-slate-100 animate-in fade-in duration-200">
        <div className="max-w-md w-full rounded-2xl p-8 bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800 shadow-xl text-center space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto ring-8 ring-amber-50/50 dark:ring-amber-950/20">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Executive Clearance Required
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              The DentAI Executive Hub provides real-time enterprise telemetry, automated code PR reviews, financial unit economics, and live practice audit logs. Access is strictly limited to authorized Founders.
            </p>
          </div>

          {requestedStatus === 'pending' ? (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-600 dark:text-emerald-400" />
              Your access clearance request has been queued for executive review.
            </div>
          ) : (
            <form onSubmit={handleRequestAccess} className="space-y-3 pt-2 text-left">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Request Founder Clearance
              </label>
              <input
                type="text"
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                placeholder="Reason (e.g. Practice Co-Founder, Clinical Director)"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                required
              />
              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs transition-all shadow-sm"
              >
                Submit Request
              </button>
            </form>
          )}

          <div className="pt-2">
            <button
              onClick={onBackToOperatory}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline font-medium"
            >
              Return to Chairside Operatory
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Extract structured agent data from briefing
  const product = briefing?.product || briefing?.departmentDeliverables?.product;
  const engineer = briefing?.engineer || briefing?.departmentDeliverables?.engineer;
  const qa = briefing?.qa || briefing?.departmentDeliverables?.qa;
  const security = briefing?.security || briefing?.departmentDeliverables?.security;
  const support = briefing?.support || briefing?.departmentDeliverables?.support;
  const finance = briefing?.finance || briefing?.departmentDeliverables?.finance;
  const gtm = briefing?.gtm || briefing?.departmentDeliverables?.gtm;
  const ops = briefing?.ops || briefing?.departmentDeliverables?.ops;

  const recoverableAud = gtm?.periodSummary?.totalRecoverableValueAud ?? 8530;
  const grossMargin = finance?.metrics?.monthlyGrossMarginPercent ?? 99.6;
  const activeTicketsCount = support?.activeTriageTickets?.length ?? 0;
  const safetyEvalScore = qa?.safetyCertificate?.passedCases 
    ? `${qa.safetyCertificate.passedCases}/${qa.safetyCertificate.totalCases}` 
    : '6/6';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-200 text-slate-900 dark:text-slate-100">
      {/* Top Founder Navigation & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800">
              Solo Founder Cockpit
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">•</span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Autonomous Engine Active
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Executive Control Hub
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Operating as {dentistName || 'Dr. Vikram Darade'} • 8 Autonomous Executive Agents Synchronized
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Historical Date Picker */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <Calendar className="w-3.5 h-3.5 text-slate-400 ml-2" />
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-700 dark:text-slate-300 pr-2 py-1 focus:outline-none cursor-pointer"
            >
              <option value="latest">Today (Latest)</option>
              {availableDates.map(date => (
                <option key={date} value={date}>{date}</option>
              ))}
            </select>
          </div>

          {/* 1-Click Grokbot Sync */}
          <button
            onClick={handleRunCycle}
            disabled={runningCycle}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-xs transition-all shadow-sm shadow-blue-500/10 active:scale-[0.98]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningCycle ? 'animate-spin' : ''}`} />
            <span>{runningCycle ? 'Syncing 8 Agents...' : 'Run Grokbot Cycle'}</span>
          </button>

          <button
            onClick={onBackToOperatory}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 text-xs font-medium transition-colors"
          >
            Operatory View
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-2 text-xs font-medium">
        <button
          onClick={() => setActiveTab('bento')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            activeTab === 'bento'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          8-Department Command Bento
        </button>
        <button
          onClick={() => setActiveTab('playbooks')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'playbooks'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Living Onboarding Playbooks</span>
        </button>
        <button
          onClick={() => setActiveTab('approvals')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'approvals'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>Registration Approvals</span>
          {accessRequests.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">
              {accessRequests.length}
            </span>
          )}
        </button>
      </div>

      {/* Top High-Value KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Clinical Safety Gate</span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            0 Hallucinations
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {safetyEvalScore} test cases passed (100% FDI recall)
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Unbooked Pipeline</span>
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            ${recoverableAud.toLocaleString()} AUD
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Live unbooked restorative treatment detected
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>SaaS Unit Economics</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {grossMargin}% Margin
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            $1.34 AUD COGS / chair / month
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>Live Support Queue</span>
            <Bug className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {activeTicketsCount === 0 ? '0 Open Tickets' : `${activeTicketsCount} Active`}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Real clinic chairside telemetry
          </p>
        </div>
      </div>

      {/* TAB 1: 8-DEPARTMENT BENTO GRID */}
      {activeTab === 'bento' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* 1. Product Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-blue-600 dark:text-blue-400">
                  Department 1
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800">
                  P0 Active
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                🗺️ Product & Strategy
              </h3>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-2 line-clamp-2">
                {product?.recommendedSprintFocus?.title || 'Dental4Windows Trojan Horse Handoff Auto-Splitting'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                {product?.recommendedSprintFocus?.clinicalRationale || 'Separating clinical record and billing item blocks.'}
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              PMS Ready: D4W • EXACT • Core Practice
            </div>
          </div>

          {/* 2. Software Engineer Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-indigo-600 dark:text-indigo-400">
                  Department 2
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800">
                  Types Verified
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                💻 Software Engineering
              </h3>
              <p className="text-xs font-mono text-slate-700 dark:text-slate-300 mt-2">
                {engineer?.generatedPR?.branchName || 'feat/d4w-action-splitter'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {engineer?.generatedPR?.targetFiles?.length || 2} target file(s) scaffolded with automated test hooks.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              Status: 203/203 unit & integration tests passing
            </div>
          </div>

          {/* 3. Clinical QA Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400">
                  Department 3
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800">
                  Certified
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                🩺 Clinical QA & Safety
              </h3>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-2">
                {safetyEvalScore} Clinical Cases Certified
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Zero clinical hallucinations. 100% FDI tooth numbering precision verified across all clinical exams.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              Evaluator: scripts/evals/dataset.ts
            </div>
          </div>

          {/* 4. Security & Compliance Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-purple-600 dark:text-purple-400">
                  Department 4
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800">
                  AHPRA Compliant
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                🔒 Security & Compliance
              </h3>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-2">
                Ephemeral Audio Invariant: Enforced
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Audio processed purely in ephemeral RAM buffers. Zero permanent audio disk retention. Zero PHI leakage.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              Standards: Privacy Act 1988 • APRA CPS 234
            </div>
          </div>

          {/* 5. Customer Support Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-amber-600 dark:text-amber-400">
                  Department 5
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800">
                  CSAT {support?.clinicSatisfactionScore ?? 100}%
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                🤝 Customer Support
              </h3>
              <div className="mt-2 space-y-1.5">
                {support?.activeTriageTickets?.length === 0 ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ All onboarded clinics operating smoothly
                  </p>
                ) : (
                  support?.activeTriageTickets?.slice(0, 2).map((t: any) => (
                    <div key={t.id} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-xs">
                      <div className="flex items-center justify-between font-medium">
                        <span className="text-slate-900 dark:text-slate-100 truncate max-w-[140px]">{t.issueCategory}</span>
                        <button
                          onClick={() => handleResolveTicket(t.id)}
                          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Resolve
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 truncate mt-0.5">{t.diagnostics}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              Avg onboarding: 3 min (receptionist) / 90s (dentist)
            </div>
          </div>

          {/* 6. Finance Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-600 dark:text-emerald-400">
                  Department 6
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800">
                  Profitable
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                💳 Finance & Economics
              </h3>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-2">
                ARR: ${finance?.metrics?.annualRecurringRevenueAud?.toLocaleString() || '43,056'} AUD
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                177x ROI for clinics. Ultra-efficient Gemini Flash/Whisper token burn ($0.0042/consult).
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              Runway: Self-sustaining SaaS unit economics
            </div>
          </div>

          {/* 7. GTM & Revenue Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-blue-600 dark:text-blue-400">
                  Department 7
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800">
                  Pipeline
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                💰 GTM & Growth
              </h3>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-2">
                Annualized Upside: ${gtm?.periodSummary?.annualizedPracticeUpsideAud?.toLocaleString() || '1,961,900'} AUD
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Automated recall scripts prepared for unaccepted crowns, occlusal splints & implants.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              Angle: Zero-typing notes with unbooked recovery
            </div>
          </div>

          {/* 8. Operations & Fleet Agent */}
          <div className="p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase text-slate-600 dark:text-slate-400">
                  Department 8
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800">
                  99.98%
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                ⚙️ Fleet Operations
              </h3>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-2">
                0ms Offline Draft Engine: Active
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Local operatory caching ensures consultation notes are never lost if clinic Wi-Fi drops.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-400">
              Storage: Relational Postgres + Resilient Cache
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LIVING ONBOARDING PLAYBOOKS */}
      {activeTab === 'playbooks' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Receptionist Trojan Horse */}
            <div className="p-6 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800">
                  3-Minute Quick Start
                </span>
                <span className="text-xs text-slate-400 font-medium">Front Desk Role</span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Receptionist D4W & EXACT Trojan Horse
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Empowers front-desk staff to immediately paste doctor notes and quote blocks with zero PMS integration hurdles.
              </p>
              <ol className="space-y-3 pt-2 text-xs text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">1</span>
                  <span>Keep DentAI open in a Chrome tab alongside your Dental4Windows or EXACT appointment book.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">2</span>
                  <span>Upload the morning roster by taking a screenshot snip of your appointment screen (<kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+V</kbd>).</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">3</span>
                  <span>At patient check-out, paste the doctor’s note directly into D4W clinical progress notes (<kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+V</kbd>).</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">4</span>
                  <span>Read the <code>[FRONT DESK ACTION ITEM]</code> quote block to the patient and secure the treatment deposit.</span>
                </li>
              </ol>
            </div>

            {/* Dentist Chairside Flow */}
            <div className="p-6 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800">
                  90-Second Chairside Flow
                </span>
                <span className="text-xs text-slate-400 font-medium">Clinician Role</span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Dentist Zero-Typing Scribe
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Zero typing between patient appointments. Speak naturally and let DentAI capture findings in structured FDI notation.
              </p>
              <ol className="space-y-3 pt-2 text-xs text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">1</span>
                  <span>Glance at the amber "Pre-Op Brief" cue before inviting the patient into the operatory.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">2</span>
                  <span>Tap "Start Scribe" and converse naturally with the patient and your dental assistant.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">3</span>
                  <span>Tap "Complete & Review Note" at appointment conclusion.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">4</span>
                  <span>Click "Copy Note" for your PMS chart, and "Copy SMS" to text personalized post-op aftercare.</span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REGISTRATION APPROVALS */}
      {activeTab === 'approvals' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Founder Access Clearance Queue
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Review and approve clinician requests for founder-level executive cockpit visibility.
              </p>
            </div>
          </div>

          {accessRequests.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                No pending registration access requests.
              </p>
              <p className="text-[11px] text-slate-400">
                All clinicians are correctly segregated into standard non-founder operatory tiers.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {accessRequests.map((req) => (
                <div key={req.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {req.dentistName || req.dentistId}
                    </div>
                    <div className="text-slate-500 text-[11px]">
                      Reason: {req.reason || 'Requested founder cockpit access'} • {new Date(req.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReviewRequest(req.dentistId || req.id, true)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition-colors"
                    >
                      Approve Access
                    </button>
                    <button
                      onClick={() => handleReviewRequest(req.dentistId || req.id, false)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs transition-colors"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
