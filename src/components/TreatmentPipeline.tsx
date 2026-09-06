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
  User,
  ShieldCheck,
  ExternalLink,
  Calendar,
  X
} from 'lucide-react';
import { TreatmentOpportunity, TreatmentStatus, PracticeRoiSummary, Consultation } from '../types';
import { ClinicMembership } from '../lib/clinics';
import { extractProposedTreatmentsFromFindings } from '../lib/adaFees';

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
  // Extract treatment opportunities from client-side consultations (for immediate offline & pre-existing data resilience)
  const clientExtractedOpportunities = useMemo(() => {
    if (!consultations || consultations.length === 0) return [];
    const list: TreatmentOpportunity[] = [];
    for (const c of consultations) {
      const pName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Patient';
      let items: TreatmentOpportunity[] = [];
      if (Array.isArray(c.findings?.proposedTreatments) && c.findings.proposedTreatments.length > 0) {
        items = c.findings.proposedTreatments;
      } else {
        items = extractProposedTreatmentsFromFindings({
          findings: c.findings,
          patientName: pName,
          dentistId: c.dentistId || currentDentistId,
          clinicId: c.clinicId || activeClinic?.clinicId,
          consultationId: c.id
        });
      }
      for (const opp of items) {
        list.push({
          ...opp,
          patientName: opp.patientName || pName,
          consultationId: opp.consultationId || c.id,
          dentistId: opp.dentistId || c.dentistId || currentDentistId,
          clinicId: opp.clinicId || c.clinicId || activeClinic?.clinicId
        });
      }
    }
    return list;
  }, [consultations, currentDentistId, activeClinic?.clinicId]);

  const [opportunities, setOpportunities] = useState<TreatmentOpportunity[]>(() => clientExtractedOpportunities);
  const [roiSummary, setRoiSummary] = useState<PracticeRoiSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeModalOpp, setActiveModalOpp] = useState<TreatmentOpportunity | null>(null);
  const [outreachChannel, setOutreachChannel] = useState<'sms' | 'whatsapp' | 'email'>('sms');
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

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
  const handleUpdateStatus = async (id: string, newStatus: TreatmentStatus, notes?: string) => {
    try {
      const res = await fetch(`/api/pipeline/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ status: newStatus, notes })
      });

      if (res.ok) {
        const data = await res.json();
        setOpportunities(prev =>
          prev.map(opp => (opp.id === id ? { ...opp, ...data.opportunity } : opp))
        );
        // Refresh ROI summary to update live production numbers
        fetchRoi();
        showNotification(
          newStatus === 'booked'
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

      return matchesSearch && matchesStatus && matchesCat;
    });
  }, [opportunities, searchQuery, selectedStatus, selectedCategory]);

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

  const totalIdentifiedValue = useMemo(() => {
    return opportunities.reduce((acc, curr) => acc + (curr.estimatedFee || 0), 0);
  }, [opportunities]);

  const roiMultiple = roiSummary?.netRoiMultiple ?? (totalBookedValue > 0 ? (totalBookedValue / 149).toFixed(1) : 0);

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

        {/* Card 2: Booked Production (Direct Revenue) */}
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Booked Chair Production</span>
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-3xl font-black text-emerald-600 tracking-tight">
              ${totalBookedValue.toLocaleString()}
            </span>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400 font-medium">
              <span>{opportunities.filter(o => o.status === 'booked' || o.status === 'completed').length} converted appointments</span>
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
              <span>vs. $149/mo Practice Tier</span>
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
              <span>{opportunities.length} total procedures mapped</span>
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
              { id: 'all', label: 'All' },
              { id: 'unscheduled', label: 'Unscheduled' },
              { id: 'contacted', label: 'Contacted' },
              { id: 'booked', label: 'Booked' },
              { id: 'declined', label: 'Declined' }
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

        {/* Category Filter Pills */}
        <div className="flex items-center gap-2 pt-1 text-[11px] font-bold text-slate-500 overflow-x-auto">
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
          filtered.map(opp => (
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

                {opp.patientBarrier && (
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span className="font-bold text-slate-500">Patient Note:</span> {opp.patientBarrier}
                  </div>
                )}
              </div>

              {/* Right Action Buttons */}
              <div className="flex flex-wrap md:flex-col items-end gap-2 shrink-0">
                <button
                  onClick={() => setActiveModalOpp(opp)}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-hover shadow-sm transition-all flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>1-Click Patient Follow-up</span>
                </button>

                {opp.status !== 'booked' ? (
                  <button
                    onClick={() => handleUpdateStatus(opp.id, 'booked')}
                    className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold transition-all flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Mark as Booked</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-emerald-600 font-extrabold flex items-center gap-1 px-2 py-1">
                    <Check className="w-3.5 h-3.5" /> Booked & Realized
                  </span>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* 1-Click Outreach Modal */}
      <AnimatePresence>
        {activeModalOpp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 max-w-lg w-full p-6 relative overflow-hidden"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-1.5 text-primary text-[10px] font-extrabold uppercase tracking-widest">
                    <Sparkles className="w-3.5 h-3.5" /> Practice Coordinator Dispatch
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-800 mt-0.5">
                    1-Click Patient Treatment Outreach
                  </h3>
                </div>
                <button
                  onClick={() => setActiveModalOpp(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {/* Patient / Procedure Summary Banner */}
                <div className="p-3.5 rounded-2xl bg-[#faf9f7] border border-slate-200/70 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-extrabold text-slate-800">{activeModalOpp.patientName}</span>
                    <div className="text-[11px] text-slate-500">
                      {activeModalOpp.procedureName} {activeModalOpp.tooth ? `(Tooth ${activeModalOpp.tooth})` : ''}
                    </div>
                  </div>
                  <span className="text-sm font-black text-emerald-600">
                    ${(activeModalOpp.estimatedFee || 0).toLocaleString()}
                  </span>
                </div>

                {/* Channel Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                    Communication Channel
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
                          className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all ${
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
                      Personalized Message Body
                    </label>
                    <button
                      onClick={() => handleCopyOutreach(getOutreachMessage(activeModalOpp))}
                      className="text-[10px] text-primary font-bold hover:underline flex items-center gap-1"
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
                    rows={5}
                    defaultValue={getOutreachMessage(activeModalOpp)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary leading-relaxed"
                  />
                </div>

                {/* Dispatch Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => {
                      handleCopyOutreach(getOutreachMessage(activeModalOpp));
                      handleUpdateStatus(activeModalOpp.id, 'contacted');
                      setActiveModalOpp(null);
                    }}
                    className="flex-1 py-3 bg-primary hover:bg-primary-hover text-white rounded-2xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>Copy & Mark Contacted</span>
                  </button>

                  {outreachChannel === 'whatsapp' && (
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(getOutreachMessage(activeModalOpp))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        handleUpdateStatus(activeModalOpp.id, 'contacted');
                        setActiveModalOpp(null);
                      }}
                      className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Open WhatsApp</span>
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
