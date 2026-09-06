import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DollarSign,
  TrendingUp,
  Clock,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  Phone,
  Mail,
  MessageSquare,
  Share2,
  Copy,
  Check,
  AlertCircle,
  Building2,
  ChevronRight,
  ChevronLeft,
  User,
  ShieldCheck,
  ExternalLink,
  Calendar,
  X,
  XCircle,
  RotateCcw,
  ClipboardCheck,
  FileText,
  Send
} from 'lucide-react';
import { TreatmentOpportunity, TreatmentStatus, PracticeRoiSummary, Consultation, PmsType } from '../types';
import { ClinicMembership } from '../lib/clinics';
import { extractProposedTreatmentsFromFindings } from '../lib/adaFees';
import { generateTreatmentEstimate, FormattedTreatmentEstimate } from '../lib/treatmentEstimate';

interface TreatmentPipelineProps {
  authToken: string;
  activeClinic: ClinicMembership | null;
  dentistName: string;
  currentDentistId: string;
  consultations?: Consultation[];
}

export default function TreatmentPipeline({
  authToken,
  activeClinic,
  dentistName,
  currentDentistId,
  consultations = []
}: TreatmentPipelineProps) {
  // Extract treatment opportunities from client consultations if available
  const clientExtractedOpportunities = useMemo(() => {
    const list: TreatmentOpportunity[] = [];
    for (const c of consultations) {
      let items: TreatmentOpportunity[] = [];
      if (c.findings?.proposedTreatments && c.findings.proposedTreatments.length > 0) {
        items = c.findings.proposedTreatments;
      } else if (c.findings) {
        items = extractProposedTreatmentsFromFindings({
          findings: c.findings,
          patientName: `${c.firstName} ${c.lastName}`,
          dentistId: c.dentistId || currentDentistId,
          clinicId: c.clinicId,
          consultationId: c.id
        });
      }
      for (const item of items) {
        if (!item.dentistId) item.dentistId = c.dentistId || currentDentistId;
        if (!item.clinicId && c.clinicId) item.clinicId = c.clinicId;
        list.push(item);
      }
    }
    return list;
  }, [consultations, currentDentistId]);

  const [opportunities, setOpportunities] = useState<TreatmentOpportunity[]>(() => clientExtractedOpportunities);
  const [roiSummary, setRoiSummary] = useState<PracticeRoiSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showVerifiedOnly, setShowVerifiedOnly] = useState<boolean>(false);
  const [activeModalOpp, setActiveModalOpp] = useState<TreatmentOpportunity | null>(null);
  const [estimateModalOpp, setEstimateModalOpp] = useState<TreatmentOpportunity | null>(null);
  const [pmsVerifyModalOpp, setPmsVerifyModalOpp] = useState<TreatmentOpportunity | null>(null);
  const [pmsTypeInput, setPmsTypeInput] = useState<PmsType>('d4w');
  const [pmsAppointmentIdInput, setPmsAppointmentIdInput] = useState<string>('');
  const [pmsCopySuccess, setPmsCopySuccess] = useState<boolean>(false);
  const [declineModalOpp, setDeclineModalOpp] = useState<TreatmentOpportunity | null>(null);
  const [selectedDeclineReason, setSelectedDeclineReason] = useState<string>('cost');
  const [customDeclineNote, setCustomDeclineNote] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const PAGE_SIZE = 25;
  const [outreachChannel, setOutreachChannel] = useState<'sms' | 'whatsapp' | 'email'>('sms');
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const DECLINE_PRESETS = [
    { id: 'cost', label: 'Cost / Financial Constraint', desc: 'Out of pocket expense or lack of private health cover' },
    { id: 'anxiety', label: 'Dental Anxiety / Procedural Fear', desc: 'Patient nervous about treatment, drilling, or injection' },
    { id: 'second_opinion', label: 'Seeking Second Opinion', desc: 'Patient consulting another clinician or family dentist' },
    { id: 'timing', label: 'Timing / Scheduling Conflict', desc: 'Work, travel, or scheduling availability issues' },
    { id: 'asymptomatic', label: 'Asymptomatic / Patient Deferred', desc: 'No active symptoms, patient preferring to monitor' },
    { id: 'other', label: 'Other / Custom Barrier', desc: 'Specific personal reason or custom clinical note' }
  ];

  // Sync client extracted if opportunities is currently empty but client has items
  useEffect(() => {
    if (opportunities.length === 0 && clientExtractedOpportunities.length > 0) {
      setOpportunities(clientExtractedOpportunities);
    }
  }, [clientExtractedOpportunities]);

  // Fetch pipeline and ROI data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const clinicParam = activeClinic?.clinicId ? `?clinicId=${encodeURIComponent(activeClinic.clinicId)}` : '';
      const [pipeRes, roiRes] = await Promise.all([
        fetch(`/api/pipeline${clinicParam}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        }),
        fetch(`/api/pipeline/roi${clinicParam}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        })
      ]);

      if (pipeRes.ok) {
        const pipeData = await pipeRes.json();
        const serverOpps: TreatmentOpportunity[] = pipeData.opportunities || [];
        if (serverOpps.length > 0) {
          const existingIds = new Set(serverOpps.map(o => o.id));
          const combined = [...serverOpps];
          for (const co of clientExtractedOpportunities) {
            if (!existingIds.has(co.id)) {
              combined.push(co);
            }
          }
          setOpportunities(combined);
        } else if (clientExtractedOpportunities.length > 0) {
          setOpportunities(clientExtractedOpportunities);
        } else {
          setOpportunities([]);
        }
      } else if (clientExtractedOpportunities.length > 0) {
        setOpportunities(clientExtractedOpportunities);
      }

      if (roiRes.ok) {
        const roiData = await roiRes.json();
        setRoiSummary(roiData);
      }
    } catch (err) {
      console.error('Failed to load treatment pipeline:', err);
      if (clientExtractedOpportunities.length > 0) {
        setOpportunities(clientExtractedOpportunities);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [authToken, activeClinic?.clinicId]);

  // Update status handler
  const handleUpdateStatus = async (
    id: string,
    newStatus: TreatmentStatus,
    notes?: string,
    pmsMeta?: { pmsType?: PmsType; pmsAppointmentId?: string }
  ) => {
    try {
      const res = await fetch(`/api/pipeline/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          status: newStatus,
          notes,
          pmsType: pmsMeta?.pmsType,
          pmsAppointmentId: pmsMeta?.pmsAppointmentId
        })
      });

      if (res.ok) {
        const data = await res.json();
        setOpportunities(prev =>
          prev.map(opp => (opp.id === id ? { ...opp, ...data.opportunity } : opp))
        );
        // Refresh ROI summary to update live production numbers
        fetchRoi();
        showNotification(
          pmsMeta?.pmsAppointmentId
            ? `Verified in PMS (${(pmsMeta.pmsType || 'PMS').toUpperCase()} #${pmsMeta.pmsAppointmentId})! Production locked.`
            : newStatus === 'booked'
            ? 'Treatment marked as Booked! Practice production updated.'
            : newStatus === 'contacted'
            ? 'Outreach logged! Status set to Contacted.'
            : `Status updated to ${newStatus}.`
        );
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const fetchRoi = async () => {
    try {
      const clinicParam = activeClinic?.clinicId ? `?clinicId=${encodeURIComponent(activeClinic.clinicId)}` : '';
      const roiRes = await fetch(`/api/pipeline/roi${clinicParam}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (roiRes.ok) {
        setRoiSummary(await roiRes.json());
      }
    } catch (err) {
      console.error('Failed to fetch updated ROI:', err);
    }
  };

  const showNotification = (msg: string) => {
    setActionSuccessMessage(msg);
    setTimeout(() => setActionSuccessMessage(null), 4000);
  };

  // Filtered opportunities
  const filtered = useMemo(() => {
    return opportunities.filter(opp => {
      const term = searchQuery.toLowerCase();
      const patientMatch = (opp.patientName || '').toLowerCase().includes(term);
      const procMatch = (opp.procedureName || '').toLowerCase().includes(term);
      const adaMatch = (opp.adaCode || '').includes(term);
      const toothMatch = (opp.tooth || '').includes(term);
      const matchesSearch = patientMatch || procMatch || adaMatch || toothMatch;

      const matchesStatus = selectedStatus === 'all' || opp.status === selectedStatus;

      let matchesCat = true;
      if (selectedCategory === 'crowns') {
        matchesCat = (opp.adaCode || '').startsWith('6') || (opp.procedureName || '').toLowerCase().includes('crown');
      } else if (selectedCategory === 'restorative') {
        matchesCat = (opp.adaCode || '').startsWith('5') || (opp.procedureName || '').toLowerCase().includes('composite');
      } else if (selectedCategory === 'perio') {
        matchesCat = (opp.adaCode || '').startsWith('2') || (opp.procedureName || '').toLowerCase().includes('root planing');
      } else if (selectedCategory === 'endo') {
        matchesCat = (opp.adaCode || '').startsWith('4') || (opp.procedureName || '').toLowerCase().includes('canal');
      }

      const matchesVerified = !showVerifiedOnly || Boolean(opp.pmsAppointmentId || opp.pmsSyncStatus === 'verified' || opp.pmsSyncStatus === 'auto_synced');

      return matchesSearch && matchesStatus && matchesCat && matchesVerified;
    });
  }, [opportunities, searchQuery, selectedStatus, selectedCategory, showVerifiedOnly]);

  // Reset page whenever search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus, selectedCategory, showVerifiedOnly]);

  // Aggregate metrics
  const totalUnscheduledValue = useMemo(() => {
    return opportunities
      .filter(o => o.status === 'unscheduled')
      .reduce((acc, curr) => acc + (curr.estimatedFee || 0), 0);
  }, [opportunities]);

  const totalBookedValue = useMemo(() => {
    return opportunities
      .filter(o => o.status === 'booked' || o.status === 'completed')
      .reduce((acc, curr) => acc + (curr.estimatedFee || 0), 0);
  }, [opportunities]);

  const totalDeclinedValue = useMemo(() => {
    return opportunities
      .filter(o => o.status === 'declined')
      .reduce((acc, curr) => acc + (curr.estimatedFee || 0), 0);
  }, [opportunities]);

  const totalIdentifiedValue = useMemo(() => {
    return opportunities.reduce((acc, curr) => acc + (curr.estimatedFee || 0), 0);
  }, [opportunities]);

  const roiMultiple = roiSummary?.netRoiMultiple ?? (totalBookedValue > 0 ? (totalBookedValue / 149).toFixed(1) : 0);

  // Pagination for high-scale performance
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  // Generate personalized outreach message
  const getOutreachMessage = (opp: TreatmentOpportunity) => {
    const firstName = opp.patientName.split(' ')[0] || 'there';
    const toothText = opp.tooth ? `tooth ${opp.tooth}` : 'your recommended treatment';
    return `Hi ${firstName}, following up on your consultation with ${dentistName}. Dr. ${dentistName.replace(/^Dr\.\s*/i, '')} noted that ${toothText} requires ${opp.procedureName.toLowerCase()} (${opp.clinicalReason.toLowerCase()}). We have reserved priority appointments with Dr. ${dentistName.replace(/^Dr\.\s*/i, '')} next week. Would morning or afternoon suit you best to reserve your chair time?`;
  };

  const handleCopyOutreach = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  const handleConfirmDecline = () => {
    if (!declineModalOpp) return;
    const preset = DECLINE_PRESETS.find(p => p.id === selectedDeclineReason);
    const finalReason = selectedDeclineReason === 'other'
      ? (customDeclineNote.trim() || 'Patient declined')
      : (customDeclineNote.trim() ? `${preset?.label}: ${customDeclineNote.trim()}` : (preset?.label || 'Patient declined'));

    handleUpdateStatus(declineModalOpp.id, 'declined', finalReason);
    setDeclineModalOpp(null);
  };

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModalOpp(null);
        setDeclineModalOpp(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="space-y-6 pb-16">
      {/* Toast Notification */}
      <AnimatePresence>
        {actionSuccessMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl border border-slate-700 flex items-center gap-3 text-xs font-semibold"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccessMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-3xl p-6 shadow-sm border border-slate-200/80">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-full px-3 py-1 bg-indigo-50 border border-indigo-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] text-primary font-extrabold tracking-widest uppercase">
                Practice Revenue & Treatment Pipeline
              </span>
            </div>
            {activeClinic?.role === 'owner' && (
              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full font-bold">
                Owner Scorecard Active
              </span>
            )}
          </div>
          <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">
            Unscheduled Treatment & Recall Engine
          </h2>
          <p className="text-slate-500 text-xs mt-1 max-w-xl leading-relaxed">
            Chairside treatment plans and deferred procedures extracted directly from ambient records.
            Equip your coordinator with 1-click patient follow-ups to fill empty chair production.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto">
          <button
            onClick={fetchData}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
          >
            Refresh Pipeline
          </button>
        </div>
      </div>

      {/* Executive Scorecard Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Unscheduled Opportunity Value */}
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Unscheduled Opportunity</span>
            <div className="w-9 h-9 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-slate-800 tracking-tight">
              ${totalUnscheduledValue.toLocaleString()}
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 font-medium">
              <span>{opportunities.filter(o => o.status === 'unscheduled').length} pending treatments</span>
            </div>
          </div>
        </div>

        {/* Card 2: Booked Production (Verified Recovered Revenue) */}
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Verified Recovered Production</span>
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-emerald-600 tracking-tight">
              ${(roiSummary?.verifiedBookedValue ?? totalBookedValue).toLocaleString()}
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 font-medium">
              <span>{roiSummary?.verifiedBookedCount ?? opportunities.filter(o => o.pmsAppointmentId || o.status === 'booked' || o.status === 'completed').length} PMS-verified appointments</span>
            </div>
          </div>
        </div>

        {/* Card 3: Closed-Loop ROI Multiple */}
        <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-3xl p-5 shadow-md flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between relative z-10">
            <span className="text-xs font-bold text-indigo-200">Practice ROI Multiple</span>
            <div className="w-9 h-9 rounded-2xl bg-white/10 text-indigo-300 flex items-center justify-center border border-white/10">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 relative z-10">
            <span className="text-3xl font-black text-white tracking-tight">
              {Number(roiMultiple) > 0 ? `${roiMultiple}x` : '0x'}
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-indigo-200/80 font-medium">
              <span>{roiSummary?.conversionRatePct ?? (totalIdentifiedValue > 0 ? ((totalBookedValue / totalIdentifiedValue) * 100).toFixed(1) : 0)}% conversion rate</span>
            </div>
          </div>
        </div>

        {/* Card 4: Total Identified Care */}
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Total Lifetime Identified</span>
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-primary flex items-center justify-center border border-indigo-100">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-slate-800 tracking-tight">
              ${totalIdentifiedValue.toLocaleString()}
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 font-medium">
              <span>{opportunities.length} total mapped ({opportunities.filter(o => o.status === 'declined').length} declined)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-200/80 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search patient, tooth (e.g. 16), procedure, or ADA code..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            />
          </div>

          {/* Status Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
            {[
              { id: 'all', label: `All (${opportunities.length})` },
              { id: 'unscheduled', label: `Unscheduled (${opportunities.filter(o => o.status === 'unscheduled').length})` },
              { id: 'contacted', label: `Contacted (${opportunities.filter(o => o.status === 'contacted').length})` },
              { id: 'booked', label: `Booked (${opportunities.filter(o => o.status === 'booked' || o.status === 'completed').length})` },
              { id: 'declined', label: `Declined (${opportunities.filter(o => o.status === 'declined').length})` }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSelectedStatus(tab.id)}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  selectedStatus === tab.id
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category & PMS Verified Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-bold text-slate-500">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span>Focus Area:</span>
            {[
              { id: 'all', label: 'All Procedures' },
              { id: 'crowns', label: '👑 Crowns & Bridges ($1,650+)' },
              { id: 'restorative', label: '🦷 Composites & Fillings' },
              { id: 'perio', label: '🩺 Periodontal Root Planing' },
              { id: 'endo', label: '⚡ Root Canal Treatment' }
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* PMS Verified Filter Toggle */}
          <button
            onClick={() => setShowVerifiedOnly(prev => !prev)}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
              showVerifiedOnly
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>PMS-Verified Only ({opportunities.filter(o => o.pmsAppointmentId || o.pmsSyncStatus === 'verified' || o.pmsSyncStatus === 'auto_synced').length})</span>
          </button>
        </div>
      </div>

      {/* Actionable Treatment Cards List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="bg-white rounded-3xl p-12 text-center text-slate-400 border border-slate-200/80">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <span className="text-xs font-bold">Scanning clinical charts for treatment opportunities...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center text-slate-400 border border-slate-200/80">
            <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <h4 className="text-sm font-bold text-slate-700">No matching treatment opportunities found</h4>
            <p className="text-xs mt-1 max-w-sm mx-auto">
              Whenever dentists mention proposed procedures (crowns, fillings, perio scaling) during consultations,
              they will automatically populate this revenue pipeline.
            </p>
          </div>
        ) : (
          paginatedList.map(opp => (
            <motion.div
              key={opp.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 hover:border-slate-300 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              {/* Left Details */}
              <div className="space-y-2 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold text-slate-800 text-sm">{opp.patientName}</span>
                  {opp.tooth && (
                    <span className="px-2.5 py-0.5 bg-indigo-50 text-primary border border-indigo-100 rounded-lg text-[10px] font-extrabold tracking-wider uppercase">
                      FDI {opp.tooth}
                      {opp.surfaces ? ` (${opp.surfaces})` : ''}
                    </span>
                  )}
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold">
                    ADA {opp.adaCode}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                      opp.status === 'booked'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : opp.status === 'contacted'
                        ? 'bg-sky-50 text-sky-700 border border-sky-200'
                        : opp.status === 'declined'
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {opp.status}
                  </span>
                  {opp.pmsAppointmentId && (
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg text-[10px] font-extrabold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>{opp.pmsType ? opp.pmsType.toUpperCase() : 'PMS'} #{opp.pmsAppointmentId}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-2">
                  <h4 className="text-base font-extrabold text-slate-900 tracking-tight">
                    {opp.procedureName}
                  </h4>
                  <span className="text-sm font-black text-emerald-600">
                    ${(opp.estimatedFee || 0).toLocaleString()}
                  </span>
                </div>

                <p className="text-xs text-slate-600 font-medium leading-relaxed">
                  <span className="font-bold text-slate-700">Clinical Indication:</span> {opp.clinicalReason}
                </p>

                {opp.status === 'declined' && opp.patientBarrier && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200/70 rounded-xl px-3 py-1.5 flex items-center gap-2 font-semibold">
                    <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span><b>Decline Reason:</b> {opp.patientBarrier}</span>
                  </div>
                )}

                {opp.status !== 'declined' && opp.patientBarrier && (
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span className="font-bold text-slate-500">Patient Note:</span> {opp.patientBarrier}
                  </div>
                )}
              </div>

              {/* Right Action Buttons */}
              <div className="flex flex-wrap md:flex-col items-end gap-2 shrink-0">
                {opp.status === 'declined' ? (
                  <button
                    onClick={() => handleUpdateStatus(opp.id, 'unscheduled', 'Re-opened into active pipeline')}
                    className="px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-primary border border-indigo-200 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                    title="Restore into active treatment pipeline"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Re-open Treatment</span>
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => {
                        setEstimateModalOpp(opp);
                        setOutreachChannel('sms');
                      }}
                      className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-hover shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                      title="Generate patient-friendly estimate with ADA item code for health fund rebates"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Patient Estimate</span>
                    </button>

                    <button
                      onClick={() => {
                        setPmsVerifyModalOpp(opp);
                        setPmsTypeInput(opp.pmsType || 'd4w');
                        setPmsAppointmentIdInput(opp.pmsAppointmentId || '');
                        setPmsCopySuccess(false);
                      }}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                        opp.pmsAppointmentId
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300 shadow-sm'
                          : 'bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border-slate-200/80 hover:border-emerald-200'
                      }`}
                      title="Verify or update PMS Appointment ID"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{opp.pmsAppointmentId ? 'PMS Linked' : 'Verify in PMS'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setDeclineModalOpp(opp);
                        setSelectedDeclineReason('cost');
                        setCustomDeclineNote('');
                      }}
                      className="px-2.5 py-2 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-200/80 hover:border-rose-200 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                      title="Mark treatment as declined by patient"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Decline</span>
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white rounded-2xl p-4 border border-slate-200/80 text-xs font-bold text-slate-600 shadow-sm">
            <span className="text-slate-500">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} treatments
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <span className="px-2 text-slate-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Patient Treatment Estimate & Health Fund Rebate Modal */}
      <AnimatePresence>
        {estimateModalOpp && (() => {
          const estimate = generateTreatmentEstimate(estimateModalOpp, activeClinic?.clinicName, dentistName);
          const activeText = outreachChannel === 'whatsapp'
            ? estimate.whatsappMessage
            : outreachChannel === 'email'
            ? estimate.emailBody
            : estimate.smsMessage;

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setEstimateModalOpp(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                onClick={e => e.stopPropagation()}
                className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 max-w-xl w-full p-6 relative overflow-hidden max-h-[90vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-1.5 text-primary text-[10px] font-extrabold uppercase tracking-widest">
                      <Sparkles className="w-3.5 h-3.5" /> High-Conversion Patient Dispatch
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 mt-0.5">
                      Patient Treatment Estimate & Health Fund Breakdown
                    </h3>
                  </div>
                  <button
                    onClick={() => setEstimateModalOpp(null)}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  {/* Summary Banner */}
                  <div className="p-4 rounded-2xl bg-[#faf9f7] border border-slate-200/80 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-extrabold text-slate-800">{estimateModalOpp.patientName}</span>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <span className="font-bold text-slate-700">{estimateModalOpp.procedureName}</span>
                        {estimateModalOpp.tooth && (
                          <span className="px-2 py-0.5 bg-indigo-50 text-primary rounded-md font-extrabold text-[10px]">
                            Tooth {estimateModalOpp.tooth}
                          </span>
                        )}
                        <span className="px-2 py-0.5 bg-slate-200/70 text-slate-700 rounded-md font-bold text-[10px]">
                          ADA {estimateModalOpp.adaCode}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-black text-emerald-600 block">
                        ${(estimateModalOpp.estimatedFee || 0).toLocaleString()}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">Estimated Fee</span>
                    </div>
                  </div>

                  {/* Clinical Explanation & Health Fund Rebate Alert */}
                  <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-900 leading-relaxed">
                        <span className="font-bold text-amber-950">Patient Overview: </span>
                        {estimate.plainEnglishDiagnosis}
                      </div>
                    </div>
                    <div className="text-[11px] text-amber-800 bg-amber-100/60 p-2.5 rounded-xl font-medium border border-amber-200/50">
                      <b>Health Fund Tip:</b> Patient can quote ADA Item Code <b>{estimateModalOpp.adaCode}</b> in their Bupa, Medibank, or HCF app for immediate rebate estimation.
                    </div>
                    <div className="text-[11px] text-rose-800 font-semibold flex items-center gap-1.5">
                      <span>⚠️ <b>Why timing matters:</b> {estimate.urgencyWarning}</span>
                    </div>
                  </div>

                  {/* Channel Selector */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                      Outreach Channel Template
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'sms', label: 'SMS Text', icon: MessageSquare },
                        { id: 'whatsapp', label: 'WhatsApp', icon: Phone },
                        { id: 'email', label: 'Email', icon: Mail }
                      ].map(ch => {
                        const Icon = ch.icon;
                        return (
                          <button
                            key={ch.id}
                            onClick={() => setOutreachChannel(ch.id as any)}
                            className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                              outreachChannel === ch.id
                                ? 'bg-primary text-white border-primary shadow-sm'
                                : 'bg-slate-50 text-slate-600 border-slate-200/70 hover:bg-slate-100'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{ch.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pre-Formatted Contextual Message Box */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-500">
                        Personalized Patient Message
                      </label>
                      <button
                        onClick={() => handleCopyOutreach(activeText)}
                        className="text-[10px] text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {copiedText ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-600">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Text</span>
                          </>
                        )}
                      </button>
                    </div>
                    <textarea
                      rows={outreachChannel === 'email' ? 7 : 5}
                      value={activeText}
                      readOnly
                      className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary leading-relaxed"
                    />
                  </div>

                  {/* Dispatch Actions */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => {
                        handleCopyOutreach(activeText);
                        handleUpdateStatus(estimateModalOpp.id, 'contacted');
                        setEstimateModalOpp(null);
                      }}
                      className="flex-1 py-3 bg-primary hover:bg-primary-hover text-white rounded-2xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Copy & Mark Contacted</span>
                    </button>

                    {outreachChannel === 'whatsapp' && (
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(activeText)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          handleUpdateStatus(estimateModalOpp.id, 'contacted');
                          setEstimateModalOpp(null);
                        }}
                        className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>Open WhatsApp</span>
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* PMS Appointment Verification Modal */}
      <AnimatePresence>
        {pmsVerifyModalOpp && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setPmsVerifyModalOpp(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 max-w-md w-full p-6 relative overflow-hidden"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center">
                    <ClipboardCheck className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900">
                      PMS Appointment Verification
                    </h3>
                    <p className="text-[11px] text-slate-400">Lock verified revenue onto practice ledger</p>
                  </div>
                </div>
                <button
                  onClick={() => setPmsVerifyModalOpp(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {/* Treatment summary */}
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>{pmsVerifyModalOpp.patientName}</span>
                    <span className="text-emerald-600 font-black">${(pmsVerifyModalOpp.estimatedFee || 0).toLocaleString()}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {pmsVerifyModalOpp.procedureName} {pmsVerifyModalOpp.tooth ? `(Tooth ${pmsVerifyModalOpp.tooth})` : ''} · ADA {pmsVerifyModalOpp.adaCode}
                  </div>
                </div>

                {/* 1-Click Copy for Legacy Desktop PMS (D4W / EXACT) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold text-slate-600">
                      Quick Note for PMS Appointment Book
                    </label>
                    <button
                      onClick={() => {
                        const note = `[DentAI] ${pmsVerifyModalOpp.procedureName} (Tooth ${pmsVerifyModalOpp.tooth || 'N/A'}) · ADA ${pmsVerifyModalOpp.adaCode} · Est: $${pmsVerifyModalOpp.estimatedFee} · Note: ${pmsVerifyModalOpp.clinicalReason}`;
                        navigator.clipboard.writeText(note);
                        setPmsCopySuccess(true);
                        setTimeout(() => setPmsCopySuccess(false), 2000);
                      }}
                      className="text-[10px] text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {pmsCopySuccess ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-600">Copied to Clipboard!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy for D4W/EXACT Memo</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-2.5 bg-slate-100/70 border border-slate-200 rounded-xl text-[11px] text-slate-700 font-mono select-all">
                    {`[DentAI] ${pmsVerifyModalOpp.procedureName} (Tooth ${pmsVerifyModalOpp.tooth || 'N/A'}) · ADA ${pmsVerifyModalOpp.adaCode} · Est: $${pmsVerifyModalOpp.estimatedFee}`}
                  </div>
                </div>

                {/* PMS System & Appointment ID inputs */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      PMS System
                    </label>
                    <select
                      value={pmsTypeInput}
                      onChange={e => setPmsTypeInput(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="d4w">Dental4Windows (D4W)</option>
                      <option value="exact">EXACT (SoE)</option>
                      <option value="cliniko">Cliniko</option>
                      <option value="corepractice">Core Practice</option>
                      <option value="dentrix">Dentrix</option>
                      <option value="other">Other PMS</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      Appointment / Ledger ID
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 8491, APP-209"
                      value={pmsAppointmentIdInput}
                      onChange={e => setPmsAppointmentIdInput(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setPmsVerifyModalOpp(null)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      handleUpdateStatus(pmsVerifyModalOpp.id, 'booked', undefined, {
                        pmsType: pmsTypeInput,
                        pmsAppointmentId: pmsAppointmentIdInput.trim() || 'VERIFIED'
                      });
                      setPmsVerifyModalOpp(null);
                    }}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm & Lock Revenue</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Decline Reason Modal */}
      <AnimatePresence>
        {declineModalOpp && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setDeclineModalOpp(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 max-w-md w-full p-6 relative overflow-hidden"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-rose-600">
                  <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center">
                    <XCircle className="w-4 h-4 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">Mark Treatment as Declined</h3>
                    <p className="text-[11px] text-slate-400">Capture reason for practice analytics</p>
                  </div>
                </div>
                <button
                  onClick={() => setDeclineModalOpp(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Treatment summary */}
              <div className="mt-4 p-3 bg-slate-50 rounded-2xl border border-slate-200/70 text-xs">
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span>{declineModalOpp.patientName}</span>
                  <span className="text-emerald-600">${(declineModalOpp.estimatedFee || 0).toLocaleString()}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {declineModalOpp.procedureName} {declineModalOpp.tooth ? `(Tooth ${declineModalOpp.tooth})` : ''} · ADA {declineModalOpp.adaCode}
                </div>
              </div>

              {/* Reason presets */}
              <div className="mt-4 space-y-2">
                <label className="block text-[11px] font-bold text-slate-500">
                  Why is the patient declining or deferring?
                </label>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {DECLINE_PRESETS.map(preset => (
                    <label
                      key={preset.id}
                      onClick={() => setSelectedDeclineReason(preset.id)}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
                        selectedDeclineReason === preset.id
                          ? 'border-rose-300 bg-rose-50/60 text-slate-900 shadow-sm'
                          : 'border-slate-200/80 bg-white hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="declineReason"
                        checked={selectedDeclineReason === preset.id}
                        onChange={() => setSelectedDeclineReason(preset.id)}
                        className="mt-1 text-rose-600 focus:ring-rose-500"
                      />
                      <div className="text-xs">
                        <div className="font-bold text-slate-800">{preset.label}</div>
                        <div className="text-[10px] text-slate-400">{preset.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Optional custom note */}
              <div className="mt-3">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
                  Additional Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder={selectedDeclineReason === 'other' ? "e.g. Moving interstate next month..." : "e.g. Waiting for insurance refresh in January..."}
                  value={customDeclineNote}
                  onChange={e => setCustomDeclineNote(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
                />
              </div>

              {/* Modal Actions */}
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => setDeclineModalOpp(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-600 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDecline}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Confirm Decline</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
