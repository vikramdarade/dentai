import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  Sparkles,
  Clock,
  ArrowRight,
  ChevronRight,
  Calendar,
  DollarSign,
  AlertCircle,
  Award,
  Smartphone,
  Stethoscope,
  TrendingUp,
  X,
  Lock,
  Check,
  CheckCircle2,
  FileText,
  HeartPulse,
  Share2,
  MessageSquare,
  Building2,
  User,
  Info
} from 'lucide-react';

interface PatientRoadmapPrototypeProps {
  onClose?: () => void;
  dentistName?: string;
  clinicName?: string;
}

type PrototypeTab = 'dentist-oversight' | 'patient-mobile' | 'practice-roi';

export default function PatientRoadmapPrototype({
  onClose,
  dentistName = 'Dr. Sarah Chen',
  clinicName = 'Bright Smile Dental'
}: PatientRoadmapPrototypeProps) {
  const [activeTab, setActiveTab] = useState<PrototypeTab>('dentist-oversight');
  const [isSignedOff, setIsSignedOff] = useState<boolean>(false);
  const [selectedIncentive, setSelectedIncentive] = useState<'warranty' | 'fluoride' | 'priority'>('warranty');
  const [patientFeedbackSubmitted, setPatientFeedbackSubmitted] = useState<boolean>(false);
  const [feedbackRating, setFeedbackRating] = useState<number>(5);

  // Mock patient dataset
  const patient = {
    name: 'Priya Sharma',
    dob: '14/05/1988',
    lastSeen: '24 Aug 2026',
    insurance: 'Bupa Dental Gold (Annual Limit: $1,200 Major, $800 General)',
    totalBacklogValue: 3450,
    chapters: [
      {
        id: 'ch-1',
        number: 1,
        title: 'Priority Relief & Caries Halt',
        urgency: 'high',
        timing: 'Immediate (Next 7–14 days)',
        procedures: [
          {
            tooth: 'FDI 24',
            surface: 'Mesial-Occlusal',
            name: 'Composite Resin Restoration (2 surfaces)',
            code: 'ADA 532',
            cost: 380,
            estimatedRebate: 240,
            clinicalReason: 'Active cavitated dentinal decay encroaching on pulp. Requires immediate excavation to prevent root canal therapy.',
          },
          {
            tooth: 'Full Mouth',
            surface: 'Periodontal',
            name: 'Subgingival Calculus Removal & Prophylaxis',
            code: 'ADA 114',
            cost: 210,
            estimatedRebate: 160,
            clinicalReason: 'Localised 4mm periodontal pocketing and bleeding on probing in sextant 5.',
          }
        ],
        subtotal: 590,
        estimatedNet: 190,
        status: 'recommended-now',
      },
      {
        id: 'ch-2',
        number: 2,
        title: 'Structural Tooth Preservation',
        urgency: 'medium',
        timing: 'Stage 2: 3–4 Months (Post-stabilization)',
        procedures: [
          {
            tooth: 'FDI 16',
            surface: 'Cusp Protection',
            name: 'Full Porcelain / Ceramic Crown',
            code: 'ADA 611',
            cost: 1650,
            estimatedRebate: 850,
            clinicalReason: 'Propagating micro-crack across mesio-palatal cusp. Risk of vertical root split if left un-crowned.',
          }
        ],
        subtotal: 1650,
        estimatedNet: 800,
        status: 'scheduled-recall',
      },
      {
        id: 'ch-3',
        number: 3,
        title: 'Preventive Enamel & Long-Term Health',
        urgency: 'maintenance',
        timing: 'Stage 3: 6-Month Recall Routine',
        procedures: [
          {
            tooth: 'Full Mouth',
            surface: 'Enamel Coating',
            name: 'Topical Enamel Remineralization Varnish',
            code: 'ADA 121',
            cost: 85,
            estimatedRebate: 85,
            clinicalReason: 'Acid erosion demineralization on lower anterior labial surfaces.',
          },
          {
            tooth: 'Full Mouth',
            surface: 'Occlusal',
            name: 'Preventive Periodic Examination',
            code: 'ADA 012',
            cost: 95,
            estimatedRebate: 95,
            clinicalReason: 'Routine 6-month longitudinal health tracking.',
          }
        ],
        subtotal: 180,
        estimatedNet: 0,
        status: 'future-maintenance',
      }
    ]
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]"
      >
        {/* Top Header Banner */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center text-indigo-300 shadow-inner">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-white tracking-tight">Interactive Concept Prototype</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-[10px] font-bold">
                  Dentist &amp; Practice Owner Review
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Patient Treatment Roadmap &amp; Progressive Recall Engine with AHPRA Clinical Governance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Tab switchers */}
            <div className="hidden sm:flex items-center gap-1 p-1 bg-slate-800/90 rounded-xl border border-slate-700/60 shadow-inner">
              <button
                onClick={() => setActiveTab('dentist-oversight')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-[0.98] ${
                  activeTab === 'dentist-oversight'
                    ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500/50'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <Stethoscope className="w-3.5 h-3.5" />
                <span>1. Dentist Oversight</span>
              </button>

              <button
                onClick={() => setActiveTab('patient-mobile')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-[0.98] ${
                  activeTab === 'patient-mobile'
                    ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500/50'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>2. Patient Phone Screen</span>
              </button>

              <button
                onClick={() => setActiveTab('practice-roi')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-[0.98] ${
                  activeTab === 'practice-roi'
                    ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500/50'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>3. Practice Economics</span>
              </button>
            </div>

            {onClose && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile Tab bar */}
        <div className="sm:hidden bg-slate-800/90 px-3 py-1.5 flex items-center justify-around border-b border-slate-700">
          <button
            onClick={() => setActiveTab('dentist-oversight')}
            className={`text-xs font-bold py-1.5 px-2.5 rounded-lg transition-all active:scale-95 ${
              activeTab === 'dentist-oversight' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400'
            }`}
          >
            Dentist View
          </button>
          <button
            onClick={() => setActiveTab('patient-mobile')}
            className={`text-xs font-bold py-1.5 px-2.5 rounded-lg transition-all active:scale-95 ${
              activeTab === 'patient-mobile' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400'
            }`}
          >
            Patient Phone
          </button>
          <button
            onClick={() => setActiveTab('practice-roi')}
            className={`text-xs font-bold py-1.5 px-2.5 rounded-lg transition-all active:scale-95 ${
              activeTab === 'practice-roi' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400'
            }`}
          >
            Owner ROI
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {/* TAB 1: DENTIST OVERSIGHT VIEW */}
          {activeTab === 'dentist-oversight' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* Clinical Context Bar */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50/80 border border-indigo-100 flex items-center justify-center text-indigo-700 font-black text-sm shadow-xs">
                    PS
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-bold text-slate-800">{patient.name}</span>
                      <span className="text-xs text-slate-400 font-medium">DOB: {patient.dob}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200">
                        Consolidated Record (2 visits)
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {patient.insurance} &middot; Last Exam: {patient.lastSeen}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Backlog</div>
                    <div className="text-lg font-mono font-black text-slate-800 tracking-tight">${patient.totalBacklogValue.toLocaleString()}</div>
                  </div>
                  <div className="h-8 w-px bg-slate-200" />
                  <div>
                    {isSignedOff ? (
                      <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 shadow-xs">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Signed-Off by {dentistName}</span>
                      </span>
                    ) : (
                      <span className="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold flex items-center gap-1.5 shadow-xs animate-pulse">
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        <span>Awaiting Doctor Review</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Pathology Sequencing Explanation */}
              <div className="bg-gradient-to-r from-indigo-50/90 to-blue-50/60 rounded-2xl p-4 border border-indigo-100 flex items-start gap-3 shadow-xs">
                <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-xs text-indigo-950 leading-relaxed">
                  <span className="font-bold text-indigo-900">AI Clinical Sequencing Logic: </span>
                  DentAI grouped Priya's 3 procedures into clinical chapters. Rather than quoting $3,450 all at once, 
                  active decay on tooth 24 is isolated into <b>Chapter 1</b> to halt pulpal involvement immediately, 
                  while the tooth 16 crown is queued into <b>Chapter 2</b> to align with her 2027 health fund benefit reset.
                </div>
              </div>

              {/* Chapters List */}
              <div className="space-y-4">
                {patient.chapters.map((chapter) => (
                  <div
                    key={chapter.id}
                    className={`bg-white rounded-2xl p-5 border transition-all ${
                      chapter.number === 1
                        ? 'border-indigo-300 shadow-sm ring-2 ring-indigo-500/10'
                        : 'border-slate-200/90 opacity-95'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-3">
                        <span className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shadow-xs ${
                          chapter.number === 1
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {chapter.number}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-800">{chapter.title}</h4>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                              chapter.urgency === 'high'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : chapter.urgency === 'medium'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}>
                              {chapter.timing}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-xs text-slate-400 font-medium">Chapter Investment: </span>
                        <span className="text-sm font-mono font-black text-slate-800">${chapter.subtotal}</span>
                        <span className="text-xs font-mono text-emerald-600 font-bold ml-1.5">(Est. Gap: ~${chapter.estimatedNet})</span>
                      </div>
                    </div>

                    {/* Procedures within this chapter */}
                    <div className="mt-3.5 space-y-2.5">
                      {chapter.procedures.map((proc, pIdx) => (
                        <div key={pIdx} className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800">{proc.tooth} &middot; {proc.name}</span>
                              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-mono font-bold border border-indigo-100/60">
                                {proc.code}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-snug">
                              <b>Pathology:</b> {proc.clinicalReason}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-mono font-bold text-slate-700">${proc.cost}</div>
                            <div className="text-[10px] font-mono text-emerald-600 font-semibold">Rebate: ~${proc.estimatedRebate}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Quick stage toggle */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-400 text-[11px]">
                        {chapter.number === 1
                          ? 'Included in immediate patient outreach dispatch'
                          : 'Queued in smart recall engine for scheduled activation'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button className="text-[11px] font-bold text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer active:scale-95">
                          Reorder Procedures
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* AHPRA-Compliant Patient Milestone Incentive Selector */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-indigo-600" />
                    <span className="text-xs font-bold text-slate-800">Compliance &amp; Adherence Milestone Perk</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    AHPRA Section 133 Compliant
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Encourages patient follow-through without offering prohibited commercial discounts. 
                  Select the clinical incentive attached to completing Chapters 1 &amp; 2 on schedule:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  <div
                    onClick={() => setSelectedIncentive('warranty')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all active:scale-[0.98] ${
                      selectedIncentive === 'warranty'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">5-Yr Restoration Warranty</span>
                      {selectedIncentive === 'warranty' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Practice guarantees restorations against failure when scheduled maintenance visits are kept.
                    </p>
                  </div>

                  <div
                    onClick={() => setSelectedIncentive('fluoride')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all active:scale-[0.98] ${
                      selectedIncentive === 'fluoride'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">Complimentary ADA 121</span>
                      {selectedIncentive === 'fluoride' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Enamel remineralization varnish provided at 6-month checkup at zero out-of-pocket cost.
                    </p>
                  </div>

                  <div
                    onClick={() => setSelectedIncentive('priority')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all active:scale-[0.98] ${
                      selectedIncentive === 'priority'
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">Priority Chair Access</span>
                      {selectedIncentive === 'priority' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Emergency same-day triage reservation for patients active on their roadmap.
                    </p>
                  </div>
                </div>
              </div>

              {/* Dentist Action Bar */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {isSignedOff
                    ? 'Roadmap signed off. Front-desk team is authorized to dispatch Chapter 1 to Priya.'
                    : 'Requires dentist review & authorization before dispatching to patient.'}
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  <button
                    onClick={() => setIsSignedOff(!isSignedOff)}
                    className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap ${
                      isSignedOff
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-500/20'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isSignedOff ? 'Revoke Sign-Off' : `Approve & Sign-Off as ${dentistName}`}</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('patient-mobile')}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap"
                  >
                    <span>Preview Patient Phone Screen</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PATIENT MOBILE EXPERIENCE */}
          {activeTab === 'patient-mobile' && (
            <div className="flex flex-col items-center justify-center py-4">
              <div className="text-center mb-4 max-w-md">
                <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-200">
                  Interactive Patient View
                </span>
                <h3 className="text-base font-bold text-slate-800 mt-2">What Priya Sees on Her Phone</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Sent via SMS/WhatsApp with personalized secure token. Designed to build clinical trust and eliminate financial panic.
                </p>
              </div>

              {/* iPhone Frame Simulator */}
              <div className="w-full max-w-sm bg-slate-900 rounded-[44px] p-3 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] border-4 border-slate-800 ring-1 ring-slate-700/60 relative">
                {/* Dynamic Island / Speaker Pill */}
                <div className="w-24 h-4 bg-slate-950 rounded-full mx-auto mb-2 flex items-center justify-center gap-1.5 px-2">
                  <div className="w-2 h-2 rounded-full bg-slate-800" />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/40" />
                </div>

                {/* Inner Screen */}
                <div className="bg-[#FAF9F6] rounded-[32px] overflow-hidden text-slate-800 p-4 space-y-3.5 text-xs max-h-[640px] overflow-y-auto shadow-inner">
                  {/* Status Bar */}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono font-bold px-1">
                    <span>9:41</span>
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span>5G</span>
                      <span className="w-4 h-2 border border-slate-400 rounded-xs flex items-center px-0.5">
                        <span className="w-full h-1 bg-slate-700 rounded-2xs" />
                      </span>
                    </div>
                  </div>

                  {/* Clinic Branding */}
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
                    <div>
                      <h4 className="font-black text-slate-900 text-xs">{clinicName}</h4>
                      <p className="text-[10px] text-slate-400">Dr. Sarah Chen &middot; Clinical Care Plan</p>
                    </div>
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px] flex items-center justify-center">
                      ✓
                    </span>
                  </div>

                  {/* Patient Greeting & Roadmap Philosophy */}
                  <div className="bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-slate-900 text-xs">Hi Priya,</span>
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                        Phased Care Journey
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Rather than asking you to do everything at once, Dr. Sarah Chen has sequenced your treatment into 
                      <b> 3 chapters</b>. This halts active tooth decay immediately while keeping your appointments and out-of-pocket costs manageable.
                    </p>
                  </div>

                  {/* Roadmap Stepper */}
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="p-2 rounded-xl bg-indigo-600 text-white font-bold text-[10px] shadow-xs">
                      <div className="text-[9px] opacity-80">Next Step</div>
                      <div>Chapter 1</div>
                    </div>
                    <div className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 font-bold text-[10px]">
                      <div className="text-[9px] text-slate-400">Month 3</div>
                      <div>Chapter 2</div>
                    </div>
                    <div className="p-2 rounded-xl bg-white border border-slate-200 text-slate-400 font-bold text-[10px]">
                      <div className="text-[9px] text-slate-400">Month 6</div>
                      <div>Chapter 3</div>
                    </div>
                  </div>

                  {/* ACTIVE CHAPTER CARD: Chapter 1 */}
                  <div className="bg-white rounded-2xl p-3.5 border-2 border-indigo-600 shadow-sm space-y-2.5 relative">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-black text-[9px] uppercase tracking-wider">
                        Active Chapter 1: Priority Visit
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">Next 7–14 days</span>
                    </div>

                    <div>
                      <h5 className="font-extrabold text-slate-900 text-xs">Halting Tooth 24 Decay &amp; Gum Care</h5>
                      <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                        Tooth 24 has deep decay advancing toward the nerve. Treating this now prevents painful infection and root canal surgery.
                      </p>
                    </div>

                    {/* Financial clarity */}
                    <div className="p-2.5 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-500">Treatment Fee:</span>
                        <span className="font-mono font-bold text-slate-800">$590</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-emerald-600 font-semibold">
                        <span>Est. Health Fund Rebate:</span>
                        <span className="font-mono font-bold">-$400</span>
                      </div>
                      <div className="pt-1 border-t border-slate-200 flex justify-between font-extrabold text-xs text-slate-900">
                        <span>Your Estimated Gap:</span>
                        <span className="font-mono text-indigo-600">~$190</span>
                      </div>
                      <p className="text-[9px] text-slate-400 pt-0.5">
                        Quote item codes <b>ADA 532</b> &amp; <b>114</b> to your Bupa app to verify.
                      </p>
                    </div>

                    <button className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Book Chapter 1 Appointment</span>
                    </button>
                  </div>

                  {/* FUTURE CHAPTER 2 CARD (Locked / Planned) */}
                  <div className="bg-slate-100/90 rounded-2xl p-3 border border-slate-200/80 space-y-1.5 opacity-80">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                        <Lock className="w-3 h-3 text-slate-400" />
                        <span>Chapter 2: Structural Tooth 16 Crown</span>
                      </span>
                      <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                        Planned for 2027
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Tooth 16 has a hairline crack. We will protect this tooth during your next recall when your annual major dental benefit resets!
                    </p>
                  </div>

                  {/* Milestone Incentive Card */}
                  <div className="bg-emerald-50/80 rounded-2xl p-3 border border-emerald-200 flex items-start gap-2.5">
                    <Award className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-extrabold text-emerald-900 text-[11px] block">
                        Your Care Milestone Reward
                      </span>
                      <p className="text-[10px] text-emerald-700 mt-0.5 leading-snug">
                        Keeping your scheduled checkup visits unlocks {clinicName}'s <b>5-Year Restoration Warranty</b> and complimentary enamel protection.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PRACTICE OWNER ECONOMICS */}
          {activeTab === 'practice-roi' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-300">
                      Practice Financial Modeling
                    </span>
                    <h3 className="text-xl font-black text-white mt-1">
                      The "Lump Sum vs. Phased Roadmap" Yield Model
                    </h3>
                    <p className="text-xs text-indigo-200/80 mt-1 max-w-xl">
                      Why breaking treatment into accessible chapters converts 2.8x more revenue over 12 months than traditional all-at-once quotes.
                    </p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cohort Size</span>
                    <span className="text-2xl font-black text-emerald-400">100 Unbooked Patients</span>
                  </div>
                </div>

                {/* Head-to-Head Comparison */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                  {/* Traditional Quoting */}
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-300">Traditional All-At-Once Quote</span>
                      <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded">High Friction</span>
                    </div>
                    <div className="space-y-1.5 text-xs text-slate-300">
                      <div className="flex justify-between">
                        <span>Average Quote Presented:</span>
                        <span className="font-mono font-bold text-white">$3,200</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Immediate Rejection / Ghost Rate:</span>
                        <span className="font-mono font-bold text-rose-300">76%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Patients Converting:</span>
                        <span className="font-mono font-bold text-white">24 patients</span>
                      </div>
                    </div>
                    <div className="pt-2.5 border-t border-white/10 flex justify-between items-center text-sm font-black">
                      <span className="text-slate-300">Total Practice Production:</span>
                      <span className="font-mono font-black text-white">$76,800</span>
                    </div>
                  </div>

                  {/* Phased Roadmap Quoting */}
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5 ring-1 ring-emerald-500/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300">DentAI Phased Roadmap Engine</span>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded">High Conversion</span>
                    </div>
                    <div className="space-y-1.5 text-xs text-slate-200">
                      <div className="flex justify-between">
                        <span>Phase 1 Acceptance ($590 entry):</span>
                        <span className="font-mono font-bold text-emerald-300">68% (68 patients)</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Phase 2 Recall Conversion ($1,650):</span>
                        <span className="font-mono font-bold text-emerald-300">54% (54 patients)</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Phase 3 Routine Retention ($180):</span>
                        <span className="font-mono font-bold text-emerald-300">48% (48 patients)</span>
                      </div>
                    </div>
                    <div className="pt-2.5 border-t border-emerald-500/20 flex justify-between items-center text-sm font-black">
                      <span className="text-emerald-200">Total Practice Production:</span>
                      <span className="font-mono font-black text-emerald-400">$137,860 (+79.5%)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3 Core Economic Levers */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs space-y-1.5 hover:border-slate-300 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2 shadow-2xs">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-800">1. Maximizes Private Health Limits</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    By straddling treatment across two recall intervals or calendar years, patients utilize both 2026 and 2027 private health allowances, cutting their out-of-pocket gap in half.
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs space-y-1.5 hover:border-slate-300 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2 shadow-2xs">
                    <Award className="w-4 h-4" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-800">2. Replaces Paid Google Ad CAC</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Acquiring a new patient via Google Ads costs $300. Re-converting existing patients through their clinical roadmap costs $0 and fills chair gaps with high-margin crowns.
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs space-y-1.5 hover:border-slate-300 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-2 shadow-2xs">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-800">3. Zero Malpractice Inducement Risk</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Restoration warranties and preventive remineralization rewards are clinically justifiable under AHPRA Section 133, protecting the practice against regulatory scrutiny.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Feedback Bar for Reviewers */}
        <div className="bg-white border-t border-slate-200 p-4 px-6 shrink-0">
          {patientFeedbackSubmitted ? (
            <div className="flex items-center justify-between text-xs font-bold text-emerald-700 bg-emerald-50 p-3 rounded-xl border border-emerald-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Thank you! Your feedback has been recorded for the DentAI engineering roadmap.</span>
              </div>
              <button
                onClick={() => setPatientFeedbackSubmitted(false)}
                className="text-emerald-800 hover:underline text-[11px] cursor-pointer"
              >
                Submit another note
              </button>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">Clinician &amp; Owner Reality Rating:</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setFeedbackRating(star)}
                      className={`text-sm cursor-pointer ${star <= feedbackRating ? 'text-amber-400' : 'text-slate-200'} transition-transform active:scale-90 hover:scale-110`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-400 font-medium ml-1">
                  ({feedbackRating === 5 ? 'Exceptional Fit' : feedbackRating >= 4 ? 'Strong Fit' : 'Needs Modification'})
                </span>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <button
                  onClick={() => setPatientFeedbackSubmitted(true)}
                  className="w-full md:w-auto px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap"
                >
                  Confirm Concept Validation
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
