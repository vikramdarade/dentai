import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Lock, Plus, ArrowLeft, AlertCircle, Sparkles, UserPlus, CirclePlay, ShieldCheck, KeyRound, Check } from 'lucide-react';

interface DentistProfile {
  id: string;
  name: string;
  specialty: string;
  mfaEnabled?: boolean;
}

interface LoginProps {
  onLoginSuccess: (token: string, dentist: DentistProfile) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  // Private Credentials
  const [identifier, setIdentifier] = useState(() => {
    try {
      return localStorage.getItem('dentai_last_practitioner_name') || '';
    } catch {
      return '';
    }
  });
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Two-factor step. When the account has a confirmed authenticator, the PIN
  // alone does not issue a session: the server answers 401 { mfaRequired } and
  // this second step collects the code (or a recovery code) instead.
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [pendingPin, setPendingPin] = useState('');
  const [shakeTrigger, setShakeTrigger] = useState(false);

  // Register States
  const [isRegistering, setIsRegistering] = useState(false);
  const [regName, setRegName] = useState('');
  const [regSpecialty, setRegSpecialty] = useState('');
  const [regInviteCode, setRegInviteCode] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regConfirmPin, setRegConfirmPin] = useState('');
  const [regError, setRegError] = useState<string | null>(null);

  const identifierInputRef = useRef<HTMLInputElement>(null);
  const mfaInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus logic
  useEffect(() => {
    if (!isRegistering && !mfaRequired && identifierInputRef.current) {
      if (!identifier) {
        identifierInputRef.current.focus();
      }
    }
  }, [isRegistering, mfaRequired]);

  // Move focus to the code field as soon as the PIN is accepted and the second
  // factor is requested, so the dentist is not left hunting for it.
  useEffect(() => {
    if (mfaRequired && mfaInputRef.current) {
      mfaInputRef.current.focus();
    }
  }, [mfaRequired]);

  // Keypad & keyboard handlers for PIN
  const handlePinPress = (num: string) => {
    if (pin.length < 4) {
      const nextPin = pin + num;
      setPin(nextPin);
      if (nextPin.length === 4) {
        submitLogin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  // Keyboard support for typing PIN
  useEffect(() => {
    if (isRegistering || mfaRequired) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // If user is currently typing in the name text input, let them type normally
      if (document.activeElement === identifierInputRef.current) {
        if (e.key === 'Enter') {
          identifierInputRef.current.blur();
        }
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        handlePinPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, identifier, isRegistering, mfaRequired]);

  const submitLogin = async (completedPin: string, secondFactor?: { code: string; recovery: boolean }) => {
    // Sign-in is by exact practitioner name or clinician ID. A partial match is
    // deliberately refused server-side: resolving "Jen" to whichever account
    // matches first would authenticate the wrong clinician into a patient record.
    const trimmedId = identifier.trim();
    if (!trimmedId) {
      setLoginError('Please enter your practitioner name or clinician ID.');
      setPin('');
      identifierInputRef.current?.focus();
      return;
    }
    setIsSubmitting(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: trimmedId,
          pin: completedPin,
          ...(secondFactor?.code
            ? secondFactor.recovery
              ? { recoveryCode: secondFactor.code.trim().toUpperCase() }
              : { mfaCode: secondFactor.code.replace(/\s+/g, '') }
            : {})
        })
      });

      const data = await res.json();

      // A correct PIN with a second factor outstanding: ask for the code rather
      // than reporting a failure. The PIN is kept only in memory for this step.
      if (!res.ok && data.mfaRequired) {
        setPendingPin(completedPin);
        setMfaRequired(true);
        setMfaCode('');
        setLoginError(secondFactor?.code ? data.error || 'That code was not accepted.' : null);
        return;
      }

      if (res.ok) {
        setMfaRequired(false);
        setPendingPin('');
        setMfaCode('');
        try {
          localStorage.setItem('dentai_last_practitioner_name', data.dentist.name);
        } catch {}

        onLoginSuccess(data.token, data.dentist);
      } else {
        setLoginError(data.error || 'Invalid credentials. Please verify your practitioner name and PIN.');
        setPin('');
        setShakeTrigger(true);
        setTimeout(() => setShakeTrigger(false), 500);
      }
    } catch (err) {
      setLoginError('Server connection error. Please verify network connectivity.');
      setPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    if (!regName.trim() || !regSpecialty.trim()) {
      setRegError('All fields are required.');
      return;
    }
    if (!/^\d{4}$/.test(regPin)) {
      setRegError('PIN must be exactly 4 numeric digits.');
      return;
    }
    if (regPin !== regConfirmPin) {
      setRegError('PIN codes do not match.');
      return;
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          specialty: regSpecialty.trim(),
          pin: regPin,
          inviteCode: regInviteCode.trim() || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        try {
          localStorage.setItem('dentai_last_practitioner_name', data.dentist.name);
        } catch {}
        onLoginSuccess(data.token, data.dentist);
      } else {
        setRegError(data.error || 'Failed to register account.');
      }
    } catch (err) {
      setRegError('Server connection error. Please try again.');
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F8F7F5] px-4 py-12 font-sans relative overflow-hidden">
      {/* Subtle background ambient glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-50/50 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-emerald-50/30 blur-[130px] pointer-events-none" />

      {/* Second-factor step: PIN accepted, code required. */}
      <AnimatePresence>
        {mfaRequired && (
          <motion.div
            key="mfa"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-[#F8F7F5]/95 backdrop-blur-sm px-4"
          >
            <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl p-7">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-800 tracking-tight">Two-factor code</h2>
                  <p className="text-slate-500 text-xs">
                    {useRecoveryCode
                      ? 'Enter one of your saved recovery codes.'
                      : 'Enter the 6-digit code from your authenticator app.'}
                  </p>
                </div>
              </div>

              {loginError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {loginError}
                </div>
              )}

              <form
                className="mt-5 flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitLogin(pendingPin, { code: mfaCode, recovery: useRecoveryCode });
                }}
              >
                <input
                  autoFocus
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  inputMode={useRecoveryCode ? 'text' : 'numeric'}
                  placeholder={useRecoveryCode ? 'XXXXX-XXXXX' : '000000'}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg font-mono tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || mfaCode.trim().length < 6}
                  className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Verifying…' : 'Verify and sign in'}
                </button>
              </form>

              <div className="mt-4 flex flex-col gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => { setUseRecoveryCode(!useRecoveryCode); setMfaCode(''); setLoginError(null); }}
                  className="text-indigo-600 font-semibold hover:underline"
                >
                  {useRecoveryCode ? 'Use my authenticator app instead' : 'Lost your phone? Use a recovery code'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaRequired(false); setPendingPin(''); setMfaCode(''); setLoginError(null); }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  Cancel and choose another profile
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* VIEW 1: STRICT PRIVATE SIGN-IN (Zero profile cards shown) */}
        {!isRegistering && !mfaRequired && (
          <motion.div
            key="private-login"
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            className="w-full max-w-md p-2 bg-[#1a1a2e]/5 rounded-[2.5rem] ring-1 ring-slate-200/40 shadow-xl"
          >
            <div className="bg-white rounded-[calc(2.5rem-0.5rem)] p-7 sm:p-9 shadow-inner flex flex-col items-center">
              {/* Private Pill Badge */}
              <div className="rounded-full px-3.5 py-1.5 bg-indigo-50 border border-indigo-100 flex items-center gap-1.5 mb-5">
                <Lock className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] text-primary font-extrabold tracking-[0.15em] uppercase">
                  Private Practice Sign-In
                </span>
              </div>

              <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight text-center">
                Clinician Access
              </h2>
              <p className="text-slate-400 text-xs mt-1 text-center max-w-xs leading-relaxed">
                Enter your registered practitioner name or ID and four-digit PIN to unlock your charts.
              </p>

              {/* Practitioner Identifier Input */}
              <div className="w-full mt-6 flex flex-col gap-1.5">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                  <span>Practitioner Name or ID</span>
                  {identifier && (
                    <button
                      type="button"
                      onClick={() => {
                        setIdentifier('');
                        identifierInputRef.current?.focus();
                      }}
                      className="text-[9px] text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </label>
                <div className="flex items-center gap-2.5 h-12 px-3.5 rounded-xl bg-[#faf9f7] border border-slate-200 focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                  <User className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    ref={identifierInputRef}
                    type="text"
                    placeholder="e.g. Dr. Sarah Jenkins"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      setLoginError(null);
                    }}
                    className="w-full bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-350"
                  />
                </div>
              </div>

              {/* 4-Digit PIN Section */}
              <div className="w-full mt-5 flex flex-col items-center">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-2.5">
                  4-Digit Passcode
                </label>

                {/* PIN Dots Indicator */}
                <motion.div
                  animate={shakeTrigger ? { x: [-10, 10, -10, 10, 0] } : {}}
                  transition={{ duration: 0.4 }}
                  className="flex justify-center gap-3.5 my-2"
                >
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200 ${
                        pin.length > idx
                          ? 'bg-primary border-primary scale-110 shadow-[0_0_8px_rgba(0,74,198,0.4)]'
                          : loginError
                          ? 'border-red-400 bg-red-50'
                          : 'border-slate-300 bg-white'
                      }`}
                    />
                  ))}
                </motion.div>

                {/* Error Banner */}
                <AnimatePresence>
                  {loginError && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-2 text-xs font-semibold text-red-600 flex items-center gap-1.5 text-center"
                    >
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{loginError}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Keypad Digits Grid */}
                <div className="grid grid-cols-3 gap-y-3 gap-x-5 w-full max-w-[240px] mt-4">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handlePinPress(num)}
                      className="w-13 h-13 rounded-2xl bg-[#faf9f7] hover:bg-indigo-50 text-slate-700 hover:text-primary font-bold text-base border border-slate-200 hover:border-indigo-200 flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-sm"
                    >
                      {num}
                    </button>
                  ))}

                  {/* Backspace */}
                  <button
                    type="button"
                    onClick={handleBackspace}
                    className="w-13 h-13 rounded-2xl hover:bg-red-50 text-slate-400 hover:text-red-650 font-bold text-xs flex items-center justify-center cursor-pointer transition-all active:scale-95"
                    title="Backspace"
                  >
                    ⌫
                  </button>

                  {/* Zero */}
                  <button
                    type="button"
                    onClick={() => handlePinPress('0')}
                    className="w-13 h-13 rounded-2xl bg-[#faf9f7] hover:bg-indigo-50 text-slate-700 hover:text-primary font-bold text-base border border-slate-200 hover:border-indigo-200 flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-sm"
                  >
                    0
                  </button>

                  {/* Lock icon */}
                  <div className="w-13 h-13 flex items-center justify-center text-slate-300">
                    <KeyRound className="w-4 h-4" />
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="button"
                  disabled={!identifier.trim() || pin.length !== 4 || isSubmitting}
                  onClick={() => submitLogin(pin)}
                  className="w-full mt-6 h-12 rounded-xl bg-primary hover:bg-primary-dark text-white font-bold text-xs shadow-md shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Verifying Credentials…</span>
                    </>
                  ) : (
                    <span>Sign In to Practice</span>
                  )}
                </button>
              </div>

              {/* Add New Clinician Row */}
              <div className="w-full mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium">New clinician joining?</span>
                <button
                  type="button"
                  onClick={() => {
                    setIsRegistering(true);
                    setRegError(null);
                  }}
                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-none p-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Register Profile</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* VIEW 3: REGISTRATION SCREEN */}
        {isRegistering && (
          <motion.div
            key="register"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            className="w-full max-w-md p-2 bg-[#1a1a2e]/5 rounded-[2.5rem] ring-1 ring-slate-200/40 shadow-xl"
          >
            <div className="bg-white rounded-[calc(2.5rem-0.5rem)] p-7 sm:p-9 shadow-inner flex flex-col">
              <button
                type="button"
                onClick={() => setIsRegistering(false)}
                className="self-start -ml-2 p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <div className="flex items-center gap-3 mt-4">
                <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 text-primary flex items-center justify-center">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                  <h2 className="text-xl font-extrabold text-slate-800">Add Dentist Profile</h2>
                  <p className="text-xs text-slate-400 mt-0.5 font-medium">Onboard a provider to the clinic pilot.</p>
                </div>
              </div>

              <form onSubmit={handleRegister} className="mt-5 flex flex-col gap-3.5">
                {regError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{regError}</span>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    Full Legal Name
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Dr. Sarah Jenkins"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="h-11 px-3.5 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:border-primary focus:bg-white text-slate-800 transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    Specialty / Role
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. General Dentistry, Orthodontics"
                    value={regSpecialty}
                    onChange={(e) => setRegSpecialty(e.target.value)}
                    className="h-11 px-3.5 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:border-primary focus:bg-white text-slate-800 transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                    <span>Clinic Invite Code</span>
                    <span className="text-[9px] font-semibold text-slate-400 lowercase">optional</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 6-character code"
                    value={regInviteCode}
                    onChange={(e) => setRegInviteCode(e.target.value.toUpperCase())}
                    className="h-11 px-3.5 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm font-mono font-bold uppercase tracking-widest outline-none focus:border-primary focus:bg-white text-slate-800 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      4-Digit PIN
                    </label>
                    <input
                      required
                      type="password"
                      maxLength={4}
                      inputMode="numeric"
                      placeholder="••••"
                      value={regPin}
                      onChange={(e) => setRegPin(e.target.value.replace(/\D/g, ''))}
                      className="h-11 px-3.5 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm font-mono tracking-widest text-center outline-none focus:border-primary focus:bg-white text-slate-800 transition-all"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      Confirm PIN
                    </label>
                    <input
                      required
                      type="password"
                      maxLength={4}
                      inputMode="numeric"
                      placeholder="••••"
                      value={regConfirmPin}
                      onChange={(e) => setRegConfirmPin(e.target.value.replace(/\D/g, ''))}
                      className="h-11 px-3.5 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm font-mono tracking-widest text-center outline-none focus:border-primary focus:bg-white text-slate-800 transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="mt-3 h-11 rounded-xl bg-primary hover:bg-primary-dark text-white font-bold text-xs shadow-md shadow-primary/20 transition-all cursor-pointer"
                >
                  Create Practitioner Account
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        Legal + access links. A clinic cannot lawfully be onboarded without a
        reachable privacy notice, so these must be one tap from the sign-in
        screen the dentist actually sees — not buried on the marketing page.
      */}
      <div className="relative mt-4 mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-semibold text-slate-400">
        <a href="#/privacy" className="transition-colors hover:text-primary">
          Privacy notice
        </a>
        <span aria-hidden className="text-slate-300">·</span>
        <a href="#/terms" className="transition-colors hover:text-primary">
          Terms
        </a>
        <span aria-hidden className="text-slate-300">·</span>
        <a href="#/credential" className="transition-colors hover:text-primary">
          Change PIN or recover access
        </a>
      </div>
      <p className="relative mt-2 mx-auto max-w-sm text-center text-[10px] leading-relaxed text-slate-400">
        DentAI drafts clinical documentation with AI assistance. The treating practitioner reviews and is responsible
        for every record.
      </p>

      {/* Public Footer Pills: Product overview & narrated demo */}
      <div className="relative mt-7 mx-auto flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            window.location.hash = '#/landing';
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/75 hover:bg-white border border-slate-200 text-slate-700 text-xs font-bold shadow-sm hover:shadow-md transition-all cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span>Product overview & features</span>
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.hash = '#/demo';
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/75 hover:bg-white border border-slate-200 text-primary text-xs font-bold shadow-sm hover:shadow-md transition-all cursor-pointer"
        >
          <CirclePlay className="w-4 h-4" />
          <span>Watch narrated demo</span>
          <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">3 min</span>
        </button>
      </div>
    </div>
  );
}
