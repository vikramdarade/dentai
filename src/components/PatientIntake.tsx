import React, { useState } from 'react';
import { X, User, ArrowLeft, ArrowRight, Mic, Info, Hammer, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { maskDobInput, isValidDob, parseDobToIso } from '../utils/date';
import { getSavedTemplates, getActiveTemplateId, setActiveTemplateId, NoteTemplate } from '../utils/templates';
import { APPOINTMENT_TYPES, AppointmentType, CORE_FORMAT_TEMPLATES, getTemplateById, getAppointmentTypeLabel } from '../lib/dentalLibrary';

interface PatientIntakeProps {
  onCancel: () => void;
  onSubmit: (data: {
    firstName: string;
    lastName: string;
    dob: string;
    appointmentType: AppointmentType;
    templateId?: string;
  }) => void;
}

export default function PatientIntake({ onCancel, onSubmit }: PatientIntakeProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [appointmentType, setAppointmentType] = useState<AppointmentType | ''>('');
  const [consent, setConsent] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => {
    const active = getActiveTemplateId();
    if (active === 'soap' || active === 'concise' || active === 'standard') return active;
    return 'standard';
  });

  // Simple validation for current step
  const canGoNext = () => {
    if (currentStep === 1) {
      return firstName.trim() !== '' && lastName.trim() !== '' && isValidDob(dob);
    }
    if (currentStep === 2) {
      return appointmentType !== '';
    }
    if (currentStep === 3) {
      return consent;
    }
    return false;
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGoNext()) return;

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete & Start Session
      if (appointmentType) {
        setActiveTemplateId(selectedTemplateId);
        onSubmit({
          firstName,
          lastName,
          dob: parseDobToIso(dob),
          appointmentType,
          templateId: selectedTemplateId
        });
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div id="patient-intake-container" className="h-screen w-full relative flex flex-col bg-[#070B11] overflow-hidden text-slate-100">
      {/* Top Header App Bar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 md:px-8 h-16 bg-[#0A1018]/90 backdrop-blur-md border-b border-[#1E3048]">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="p-2 -ml-2 rounded-xl hover:bg-[#152338] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
              Dent<span className="text-cyan-400">AI</span>
            </h1>
            <span className="hidden sm:inline text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300">
              Intake
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end mr-1">
            <span className="font-mono text-[10px] text-slate-400 uppercase tracking-widest leading-none font-bold">Phase</span>
            <span id="step-counter" className="font-mono text-cyan-400 font-bold text-xs tracking-wider">
              {currentStep} / {totalSteps}
            </span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-[#0E1724] border border-[#1E3048] flex items-center justify-center text-slate-400">
            <User className="w-4 h-4 text-cyan-400" />
          </div>
        </div>
      </header>

      {/* Main Content Form */}
      <main className="flex-grow pt-24 pb-28 overflow-y-auto w-full max-w-xl mx-auto px-4 custom-scrollbar">
        {/* Double-Bezel Card Outer Shell */}
        <div className="p-2 bg-[#0E1724]/70 rounded-[2.25rem] border border-[#1E3048] shadow-2xl backdrop-blur-sm">
          <div className="bg-[#0A1018] rounded-[calc(2.25rem-0.5rem)] p-6 md:p-8 border border-[#1E3048]/60 shadow-inner flex flex-col">
            <form onSubmit={handleNext} className="flex flex-col gap-6">
              {/* Progress Timeline Header */}
              <div className="flex justify-between items-center mb-1">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center font-mono font-bold text-xs border transition-all duration-300 ${
                        currentStep === step
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                          : currentStep > step
                          ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                          : 'bg-[#0E1724] border-[#1E3048] text-slate-500'
                      }`}
                    >
                      {currentStep > step ? '✓' : step}
                    </div>
                    <span
                      className={`text-[11px] font-mono font-bold uppercase tracking-wider hidden sm:inline ${
                        currentStep === step
                          ? 'text-cyan-400'
                          : currentStep > step
                          ? 'text-emerald-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {step === 1 ? 'Identity' : step === 2 ? 'Context' : 'Consent'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Progress Line */}
              <div id="intake-progress-container" className="w-full h-1 bg-[#121E2E] rounded-full overflow-hidden mb-2">
                <motion.div
                  layout
                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                  style={{ width: `${(currentStep / totalSteps) * 100}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>

              <AnimatePresence mode="wait">
                {currentStep === 1 && (
                  <motion.section
                    key="step-1"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col gap-5"
                  >
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight">Patient Identity</h2>
                      <p className="text-slate-400 text-xs mt-1">
                        Enter legal identification details before commencing operatory transcription.
                      </p>
                    </div>

                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          First Name
                        </label>
                        <input
                          required
                          type="text"
                          placeholder="e.g. Jonathan"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className="h-12 px-4 bg-[#0E1724] border border-[#1E3048] rounded-xl text-base text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 outline-none transition-all font-medium"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Last Name
                        </label>
                        <input
                          required
                          type="text"
                          placeholder="e.g. Miller"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className="h-12 px-4 bg-[#0E1724] border border-[#1E3048] rounded-xl text-base text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 outline-none transition-all font-medium"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Date of Birth
                        </label>
                        <input
                          required
                          type="text"
                          inputMode="numeric"
                          placeholder="DD/MM/YYYY"
                          maxLength={10}
                          value={dob}
                          onChange={(e) => {
                            const masked = maskDobInput(e.target.value);
                            setDob(masked);
                          }}
                          className={`h-12 px-4 bg-[#0E1724] border rounded-xl text-base font-mono text-slate-100 placeholder:text-slate-600 outline-none transition-all ${
                            dob.length === 10
                              ? isValidDob(dob)
                                ? 'border-emerald-500/60 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30 text-emerald-300'
                                : 'border-rose-500/60 focus:border-rose-400 focus:ring-1 focus:ring-rose-400/30 text-rose-300'
                              : 'border-[#1E3048] focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30'
                          }`}
                        />
                        {dob.length === 10 && !isValidDob(dob) && (
                          <span className="text-[10px] font-mono text-rose-400 uppercase tracking-wider mt-0.5 ml-1">
                            Please enter a valid past date (DD/MM/YYYY)
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.section>
                )}

                {currentStep === 2 && (
                  <motion.section
                    key="step-2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col gap-5"
                  >
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight">Session Context</h2>
                      <p className="text-slate-400 text-xs mt-1">
                        Select clinical appointment type and statutory documentation format.
                      </p>
                    </div>

                    <div className="flex flex-col gap-5">
                      {/* Appointment Type Selector */}
                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Treatment / Appointment Type
                        </label>
                        <div className="relative">
                          <select
                            required
                            value={appointmentType}
                            onChange={(e) => {
                              const value = e.target.value as AppointmentType;
                              setAppointmentType(value);
                            }}
                            className="w-full h-12 px-4 bg-[#0E1724] border border-[#1E3048] rounded-xl text-sm font-semibold focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 outline-none transition-all text-slate-100 appearance-none pr-10 cursor-pointer"
                          >
                            <option value="" disabled className="bg-[#0A1018] text-slate-500">
                              Select appointment category
                            </option>
                            {APPOINTMENT_TYPES.map((info) => (
                              <option key={info.value} value={info.value} className="bg-[#0A1018] text-slate-200">
                                {info.label}
                              </option>
                            ))}
                          </select>
                          <div className="absolute top-1/2 right-4 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                            ▼
                          </div>
                        </div>
                        {appointmentType && (
                          <span className="text-[11px] text-cyan-300 font-mono mt-0.5 leading-relaxed">
                            {APPOINTMENT_TYPES.find((t) => t.value === appointmentType)?.description}
                          </span>
                        )}
                      </div>

                      {/* Note Format Selection - Exactly 3 Core Formats */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <label className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Documentation Format
                          </label>
                          <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider">3 Core Styles</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {CORE_FORMAT_TEMPLATES.map((tmpl) => {
                            const isSelected = selectedTemplateId === tmpl.id;
                            return (
                              <button
                                key={tmpl.id}
                                type="button"
                                onClick={() => {
                                  setSelectedTemplateId(tmpl.id);
                                  setActiveTemplateId(tmpl.id);
                                }}
                                className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between cursor-pointer relative ${
                                  isSelected
                                    ? 'border-cyan-400 bg-cyan-950/30 shadow-[0_0_16px_rgba(34,211,238,0.15)] ring-1 ring-cyan-400/40'
                                    : 'border-[#1E3048] bg-[#0E1724] hover:bg-[#121E2E]'
                                }`}
                              >
                                <div className="flex items-start justify-between w-full mb-1">
                                  <span className="font-bold text-xs text-white leading-tight">
                                    {tmpl.name}
                                  </span>
                                  <div
                                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ml-1.5 transition-colors ${
                                      isSelected
                                        ? 'border-cyan-400 bg-cyan-400 text-slate-950'
                                        : 'border-slate-600 bg-transparent'
                                    }`}
                                  >
                                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                  </div>
                                </div>
                                <span className="text-[10px] font-mono font-bold text-cyan-400 mb-1">
                                  {tmpl.tagline}
                                </span>
                                <p className="text-[10px] text-slate-400 leading-snug">
                                  {tmpl.id === 'standard'
                                    ? 'Statutory 8-point board format covering exam, perio, diagnosis & recall.'
                                    : tmpl.id === 'soap'
                                    ? 'Subjective, Objective, Assessment & Plan medical standard.'
                                    : 'Fast 4-point summary: Complaint, Findings, Treatment & Next Steps.'}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Informational Box */}
                      <div className="p-3.5 bg-[#0E1724] rounded-xl border border-[#1E3048] flex items-start gap-3">
                        <Info className="text-cyan-400 w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div className="text-slate-400 font-body-md text-xs leading-relaxed space-y-1">
                          <p>
                            <b className="text-slate-200">Clinical Focus:</b> The appointment category calibrates the AI listener for Australian dental terminology (ADA/FDI 2-digit notation).
                          </p>
                          <p>
                            <b className="text-slate-200">Recovery Pipeline:</b> Identified crowns, endodontic care, or delayed restorations automatically route to your <span className="text-cyan-400 font-semibold">Treatment Pipeline</span>.
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.section>
                )}

                {currentStep === 3 && (
                  <motion.section
                    key="step-3"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col gap-5"
                  >
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight">Clinical Consent</h2>
                      <p className="text-slate-400 text-xs mt-1">
                        Review disclosures and confirm consent before beginning the recording session.
                      </p>
                    </div>

                    <div className="flex flex-col gap-4">
                      {/* Disclosure Statement Box */}
                      <div className="p-4 bg-[#0E1724] border border-[#1E3048] rounded-xl flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 text-amber-400">
                          <Hammer className="w-4 h-4 rotate-45" />
                          <span className="font-mono font-bold text-xs uppercase tracking-wider">Statutory Privacy Disclosure</span>
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed">
                          By initiating this recording, you confirm that the patient has been informed that DentAI uses artificial intelligence to assist in dental charting and note-taking. All data is processed securely and in accordance with Australian privacy law (Privacy Act 1988) and the clinic's confidentiality obligations. The practitioner remains solely responsible for findings.
                        </p>
                      </div>

                      {/* Consent Checkbox */}
                      <label
                        className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                          consent
                            ? 'bg-emerald-950/20 border-emerald-500/50 shadow-[0_0_15px_rgba(52,211,153,0.1)]'
                            : 'bg-[#0E1724] border-[#1E3048] hover:bg-[#121E2E]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          id="consent-checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          className="hidden"
                        />
                        <div
                          className={`h-5 w-5 rounded-lg border flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors ${
                            consent
                              ? 'bg-emerald-500 border-transparent text-slate-950'
                              : 'border-slate-600 bg-[#0A1018]'
                          }`}
                        >
                          {consent && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-100 text-sm">Verbal Consent Obtained</span>
                          <span className="text-slate-400 text-xs mt-0.5 leading-relaxed">
                            I have verbally informed the patient and received their explicit consent to record this session for medical charting purposes.
                          </span>
                        </div>
                      </label>
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>

              {/* Bottom Action bar */}
              <div className="fixed bottom-0 left-0 w-full z-40 bg-[#0A1018]/95 backdrop-blur-md border-t border-[#1E3048] px-4 md:px-8 py-4 flex items-center justify-between shadow-2xl">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={currentStep === 1}
                  className={`flex items-center gap-2 text-slate-400 font-mono text-xs uppercase tracking-wider font-bold px-4 h-11 rounded-xl transition-all cursor-pointer ${
                    currentStep === 1 ? 'opacity-0 pointer-events-none' : 'hover:text-white hover:bg-[#152338]'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>

                <button
                  type="submit"
                  disabled={!canGoNext()}
                  className={`px-6 h-11 rounded-xl flex items-center gap-2 font-mono text-xs uppercase tracking-wider font-bold shadow-lg transition-all transform active:scale-95 cursor-pointer ${
                    !canGoNext()
                      ? 'bg-[#121E2E] text-slate-600 border border-[#1E3048] cursor-not-allowed'
                      : currentStep === totalSteps
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-[0_0_20px_rgba(52,211,153,0.35)]'
                      : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.35)]'
                  }`}
                >
                  <span>{currentStep === totalSteps ? 'Start Session' : 'Continue'}</span>
                  {currentStep === totalSteps ? (
                    <Mic className="w-4 h-4" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
