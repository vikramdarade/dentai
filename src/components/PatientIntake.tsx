import React, { useState } from 'react';
import { X, User, ArrowLeft, ArrowRight, Mic, Info, Hammer, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { maskDobInput, isValidDob, parseDobToIso } from '../utils/date';
import { getSavedTemplates, getActiveTemplateId, setActiveTemplateId, NoteTemplate } from '../utils/templates';
import { APPOINTMENT_TYPES, AppointmentType, getDefaultTemplateIdForType, getTemplateById, getAppointmentTypeLabel } from '../lib/dentalLibrary';

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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(getActiveTemplateId());
  const [templates] = useState<NoteTemplate[]>(getSavedTemplates());

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
    <div id="patient-intake-container" className="h-screen w-full relative flex flex-col bg-white overflow-hidden text-on-surface">
      {/* Top Header App Bar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 h-16 bg-white border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors opacity-80 active:scale-95 cursor-pointer"
          >
            <X className="text-primary h-6 w-6" />
          </button>
          <h1 className="font-headline-md text-headline-md font-bold text-primary">DentAI</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end mr-2">
            <span className="font-label-md text-[11px] text-slate-400 uppercase tracking-widest leading-none font-bold">Step</span>
            <span id="step-counter" className="font-label-md text-primary font-bold text-sm">
              {currentStep} of {totalSteps}
            </span>
          </div>
          <button className="p-2 rounded-full hover:bg-slate-50 transition-colors">
            <User className="text-primary w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Main Content Form */}
      <main className="flex-grow pt-24 pb-28 overflow-y-auto w-full max-w-xl mx-auto px-4">
        {/* Double-Bezel Card Outer Shell */}
        <div className="p-2 bg-[#1a1a2e]/5 rounded-[2.5rem] border border-slate-200/30 shadow-xl">
          <div className="bg-white rounded-[calc(2.5rem-0.5rem)] p-6 md:p-8 shadow-inner flex flex-col">
            <form onSubmit={handleNext} className="flex flex-col gap-6">
              {/* Progress Timeline Header */}
              <div className="flex justify-between items-center mb-1">
                {[1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-1.5">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs border transition-all duration-300 ${
                        currentStep === step
                          ? 'bg-primary border-primary text-white shadow-sm'
                          : currentStep > step
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                          : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}
                    >
                      {currentStep > step ? '✓' : step}
                    </div>
                    <span
                      className={`text-[10px] font-extrabold uppercase tracking-wider hidden sm:inline ${
                        currentStep === step ? 'text-primary' : 'text-slate-400'
                      }`}
                    >
                      {step === 1 ? 'Identity' : step === 2 ? 'Context' : 'Consent'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Progress Line */}
              <div id="intake-progress-container" className="w-full h-1 bg-[#efecff] rounded-full overflow-hidden mb-2">
                <motion.div
                  layout
                  className="h-full bg-primary-container"
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
                  <h2 className="font-headline-lg text-2xl font-bold text-on-surface">Patient Identity</h2>
                  <p className="text-secondary text-slate-500 font-body-md mt-1">
                    Enter the patient's legal identification details before commencing transcription.
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-label-md text-xs font-bold text-slate-500 uppercase tracking-wider">
                      First Name
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="e.g. Jonathan"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="h-12 px-4 bg-[#fcf8ff] border border-outline-variant rounded-lg text-lg focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all text-on-surface"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="font-label-md text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Last Name
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="e.g. Miller"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="h-12 px-4 bg-[#fcf8ff] border border-outline-variant rounded-lg text-lg focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all text-on-surface"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="font-label-md text-xs font-bold text-slate-500 uppercase tracking-wider">
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
                      className={`h-12 px-4 bg-[#fcf8ff] border rounded-lg text-lg focus:ring-1 outline-none transition-all text-on-surface ${
                        dob.length === 10
                          ? isValidDob(dob)
                            ? 'border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500/20'
                            : 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                          : 'border-outline-variant focus:border-primary-container focus:ring-primary-container'
                      }`}
                    />
                    {dob.length === 10 && !isValidDob(dob) && (
                      <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider mt-0.5 ml-1">
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
                  <h2 className="font-headline-lg text-2xl font-bold text-on-surface">Session Context</h2>
                  <p className="text-secondary text-slate-500 font-body-md mt-1">
                    Select the primary reason for today's clinical visit.
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-label-md text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Treatment / Appointment Type
                    </label>
                    <div className="relative">
                      <select
                        required
                        value={appointmentType}
                        onChange={(e) => {
                          const value = e.target.value as AppointmentType;
                          setAppointmentType(value);
                          // Auto-select the built-in note template recommended for
                          // this treatment type (dentist can still override below).
                          setSelectedTemplateId(getDefaultTemplateIdForType(value));
                        }}
                        className="w-full h-12 px-4 bg-[#fcf8ff] border border-outline-variant rounded-lg text-lg focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all text-on-surface appearance-none pr-10"
                      >
                        <option value="" disabled>Select a treatment type</option>
                        {APPOINTMENT_TYPES.map((info) => (
                          <option key={info.value} value={info.value}>
                            {info.label}
                          </option>
                        ))}
                      </select>
                      <div className="absolute top-1/2 right-4 -translate-y-1/2 pointer-events-none text-slate-400">
                        ▼
                      </div>
                    </div>
                    {appointmentType && (
                      <span className="text-[10px] text-slate-400 leading-relaxed">
                        {APPOINTMENT_TYPES.find((t) => t.value === appointmentType)?.description}
                      </span>
                    )}
                  </div>

                  {/* Note template — pre-selected to match the treatment type */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-label-md text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Note Template
                      </label>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Recommended</span>
                    </div>
                    <div className="relative">
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                        className="w-full h-12 px-4 bg-[#fcf8ff] border border-outline-variant rounded-lg text-sm font-medium focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all text-slate-700 appearance-none pr-10"
                      >
                        {templates.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.tagline})
                          </option>
                        ))}
                      </select>
                      <div className="absolute top-1/2 right-4 -translate-y-1/2 pointer-events-none text-slate-400">
                        ▼
                      </div>
                    </div>
                    {appointmentType && selectedTemplateId && (
                      <span className="text-[10px] text-indigo-500 font-semibold leading-relaxed">
                        {selectedTemplateId === getDefaultTemplateIdForType(appointmentType)
                          ? `DentAI will extract this template's sections (${getTemplateById(selectedTemplateId).name}) from the transcript.`
                          : `Optional: overriding the recommended template for ${getAppointmentTypeLabel(appointmentType)}.`}
                      </span>
                    )}
                  </div>

                  {/* Informational Box */}
                  <div className="p-4 bg-indigo-50/70 rounded-xl border border-indigo-100 flex items-start gap-3">
                    <Info className="text-primary w-5 h-5 flex-shrink-0 mt-0.5" />
                    <p className="text-slate-600 font-body-md text-sm leading-relaxed">
                      DentAI preconfigures a note template for each treatment type (exam, hygiene, emergency, restorative, endo, surgical, crown &amp; bridge, paediatric). The template decides which sections the AI fills from the transcript — and how they are formatted for your PMS.
                    </p>
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
                  <h2 className="font-headline-lg text-2xl font-bold text-on-surface">Clinical Consent</h2>
                  <p className="text-secondary text-slate-500 font-body-md mt-1">
                    Review disclosures and confirm consent before beginning the recording session.
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  {/* Disclosure Statement Box */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-red-600">
                      <Hammer className="w-5 h-5 rotate-45" />
                      <span className="font-bold text-xs uppercase tracking-wider">Legal Disclosure</span>
                    </div>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      By initiating this recording, you confirm that the patient has been informed that DentAI uses artificial intelligence to assist in dental charting and note-taking. All data is processed securely and in accordance with Australian privacy law (Privacy Act 1988) and the clinic's confidentiality obligations. The practitioner remains solely responsible for findings.
                    </p>
                  </div>

                  {/* Consent Checkbox */}
                  <label
                    className={`flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                      consent
                        ? 'bg-emerald-50/60 border-emerald-300'
                        : 'bg-white border-outline-variant hover:bg-slate-50'
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
                      className={`h-5 w-5 rounded border flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors ${
                        consent
                          ? 'bg-emerald-600 border-transparent text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {consent && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-800 text-base">Verbal Consent Obtained</span>
                      <span className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                        I have verbally informed the patient and received their explicit consent to record this session for medical charting purposes.
                      </span>
                    </div>
                  </label>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Bottom Action bar */}
          <div className="fixed bottom-0 left-0 w-full z-40 bg-white border-t border-outline-variant px-4 py-5 flex items-center justify-between shadow-lg">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStep === 1}
              className={`flex items-center gap-2 text-slate-500 font-semibold px-4 h-12 transition-all ${
                currentStep === 1 ? 'opacity-0 pointer-events-none' : 'hover:text-primary'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              type="submit"
              disabled={!canGoNext()}
              className={`px-8 h-12 rounded-full flex items-center gap-2 font-bold shadow-lg transition-all transform active:scale-95 ${
                !canGoNext()
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : currentStep === totalSteps
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-primary-container hover:bg-opacity-95 text-white'
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
