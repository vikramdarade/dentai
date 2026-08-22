import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Lock, Plus, ArrowLeft, AlertCircle, Sparkles, UserPlus } from 'lucide-react';

interface DentistProfile {
  id: string;
  name: string;
  specialty: string;
}

interface LoginProps {
  onLoginSuccess: (token: string, dentist: DentistProfile) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [profiles, setProfiles] = useState<DentistProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfile, setSelectedProfile] = useState<DentistProfile | null>(null);
  
  // Login states
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shakeTrigger, setShakeTrigger] = useState(false);

  // Register states
  const [isRegistering, setIsRegistering] = useState(false);
  const [regName, setRegName] = useState('');
  const [regSpecialty, setRegSpecialty] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regConfirmPin, setRegConfirmPin] = useState('');
  const [regError, setRegError] = useState<string | null>(null);

  // Fetch profiles on mount
  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/profiles');
      let serverProfiles: DentistProfile[] = [];
      if (res.ok) {
        serverProfiles = await res.json();
      }

      // Merge server profiles with any locally saved registered profiles
      const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
      const localProfiles: DentistProfile[] = localProfilesStr ? JSON.parse(localProfilesStr) : [];
      
      const profileMap = new Map<string, DentistProfile>();
      serverProfiles.forEach(p => profileMap.set(p.id, p));
      localProfiles.forEach(p => {
        if (!profileMap.has(p.id)) {
          profileMap.set(p.id, p);
        }
      });

      const merged = Array.from(profileMap.values());
      setProfiles(merged);
      localStorage.setItem('dentai_saved_profiles', JSON.stringify(merged));
    } catch (err) {
      console.error('Failed to load profiles:', err);
      const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
      if (localProfilesStr) {
        try {
          setProfiles(JSON.parse(localProfilesStr));
        } catch {
          // Ignore parse errors
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProfile = (profile: DentistProfile) => {
    setSelectedProfile(profile);
    setPin('');
    setLoginError(null);
  };

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      if (newPin.length === 4) {
        submitLogin(newPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  // Keyboard support for typing PIN
  useEffect(() => {
    if (!selectedProfile || isRegistering) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, selectedProfile, isRegistering]);

  const submitLogin = async (completedPin: string) => {
    if (!selectedProfile) return;
    setIsSubmitting(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dentistId: selectedProfile.id, pin: completedPin })
      });

      const data = await res.json();
      if (res.ok) {
        onLoginSuccess(data.token, data.dentist);
      } else {
        setLoginError(data.error || 'Invalid passcode. Please try again.');
        setPin('');
        setShakeTrigger(true);
        setTimeout(() => setShakeTrigger(false), 500);
      }
    } catch (err) {
      setLoginError('Server connection error. Please try again.');
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
        body: JSON.stringify({ name: regName, specialty: regSpecialty, pin: regPin })
      });

      const data = await res.json();
      if (res.ok) {
        // Save new profile to local saved profiles
        try {
          const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
          const localProfiles: DentistProfile[] = localProfilesStr ? JSON.parse(localProfilesStr) : [];
          if (!localProfiles.some(p => p.id === data.dentist.id)) {
            localProfiles.push(data.dentist);
            localStorage.setItem('dentai_saved_profiles', JSON.stringify(localProfiles));
          }
        } catch {
          // Ignore cache errors
        }
        onLoginSuccess(data.token, data.dentist);
      } else {
        setRegError(data.error || 'Failed to register account.');
      }
    } catch (err) {
      setRegError('Server connection error. Please try again.');
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(n => n.toLowerCase() !== 'dr.')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F8F7F5] px-4 py-16 font-sans relative overflow-hidden">
      {/* Cinematic subtle mesh orbs in background */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-50/50 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-emerald-50/30 blur-[130px] pointer-events-none"></div>

      <AnimatePresence mode="wait">
        {/* Step 1: Profile Selector Screen */}
        {!selectedProfile && !isRegistering && (
          <motion.div
            key="profiles"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
            className="w-full max-w-xl p-2 bg-[#1a1a2e]/5 rounded-[2.5rem] ring-1 ring-slate-200/40 shadow-xl"
          >
            <div className="bg-white rounded-[calc(2.5rem-0.5rem)] p-8 md:p-10 shadow-inner flex flex-col items-center">
              {/* Eye-catching badge */}
              <div className="rounded-full px-4 py-1.5 bg-indigo-50 border border-indigo-100 flex items-center gap-1.5 mb-6">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] text-primary font-extrabold tracking-[0.15em] uppercase">DentAI Practice Hub</span>
              </div>

              <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight text-center">
                Select Your Profile
              </h2>
              <p className="text-slate-500 text-sm mt-2 text-center max-w-sm">
                Access your cases and clinical scribe workflow from any workstation in the clinic.
              </p>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                  <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Syncing profiles...</span>
                </div>
              ) : (
                <div className="w-full mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[320px] overflow-y-auto pr-1">
                  {profiles.map(p => {
                    const initials = getInitials(p.name);
                    return (
                      <motion.button
                        key={p.id}
                        whileHover={{ y: -3, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleSelectProfile(p)}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-[#faf9f7] border border-slate-200 hover:border-indigo-200 hover:bg-white text-left cursor-pointer group transition-all duration-300 hover:shadow-md"
                      >
                        <div className="w-12 h-12 rounded-xl bg-indigo-50 text-primary flex items-center justify-center font-bold text-base border border-indigo-100 group-hover:bg-primary group-hover:text-white transition-colors duration-300 shadow-sm">
                          {initials}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-slate-800 text-sm truncate">{p.name}</span>
                          <span className="text-slate-400 text-xs truncate mt-0.5">{p.specialty}</span>
                        </div>
                      </motion.button>
                    );
                  })}

                  {/* Add Profile button */}
                  <motion.button
                    whileHover={{ y: -3, scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setIsRegistering(true);
                      setRegError(null);
                    }}
                    className="flex items-center gap-4 p-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20 text-left cursor-pointer transition-all duration-300 group"
                  >
                    <div className="w-12 h-12 rounded-xl border border-dashed border-slate-350 text-slate-400 flex items-center justify-center group-hover:text-indigo-600 group-hover:border-indigo-300 transition-colors duration-300">
                      <Plus className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-500 group-hover:text-indigo-700 text-sm">Add Profile</span>
                      <span className="text-slate-450 text-xs mt-0.5">Onboard a dentist</span>
                    </div>
                  </motion.button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Step 2: PIN Pad screen */}
        {selectedProfile && !isRegistering && (
          <motion.div
            key="pinpad"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
            className="w-full max-w-md p-2 bg-[#1a1a2e]/5 rounded-[2.5rem] ring-1 ring-slate-200/40 shadow-xl"
          >
            <div className="bg-white rounded-[calc(2.5rem-0.5rem)] p-8 md:p-10 shadow-inner flex flex-col items-center">
              {/* Back button */}
              <button
                onClick={() => setSelectedProfile(null)}
                className="self-start -ml-2 p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-primary flex items-center justify-center font-bold text-xl border border-indigo-100 mt-4 shadow-sm">
                {getInitials(selectedProfile.name)}
              </div>

              <h2 className="text-2xl font-extrabold text-slate-850 tracking-tight text-center mt-4">
                {selectedProfile.name}
              </h2>
              <span className="text-xs text-slate-400 font-medium tracking-wide mt-0.5">
                {selectedProfile.specialty}
              </span>

              {/* Secure PIN Dots Container */}
              <motion.div
                animate={shakeTrigger ? { x: [-10, 10, -10, 10, 0] } : {}}
                transition={{ duration: 0.4 }}
                className="flex justify-center gap-4.5 my-7"
              >
                {[0, 1, 2, 3].map(index => (
                  <div
                    key={index}
                    className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                      pin.length > index
                        ? 'bg-primary border-primary scale-110 shadow-[0_0_8px_rgba(0,74,198,0.4)]'
                        : loginError
                        ? 'border-red-400 bg-red-50'
                        : 'border-slate-300'
                    }`}
                  ></div>
                ))}
              </motion.div>

              {/* Error messages */}
              <AnimatePresence>
                {loginError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mb-4 text-xs font-semibold text-red-600 flex items-center gap-1.5"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{loginError}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Pad digits grid */}
              <div className="grid grid-cols-3 gap-y-4 gap-x-6 w-full max-w-[280px]">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                  <button
                    key={num}
                    onClick={() => handleKeyPress(num)}
                    className="w-14 h-14 rounded-full bg-[#faf9f7] hover:bg-[#efecff] text-slate-700 hover:text-primary font-bold text-lg border border-slate-200 hover:border-indigo-200 flex items-center justify-center cursor-pointer transition-all active:scale-90 shadow-sm"
                  >
                    {num}
                  </button>
                ))}
                
                {/* Backspace */}
                <button
                  onClick={handleBackspace}
                  className="w-14 h-14 rounded-full hover:bg-red-50 text-slate-400 hover:text-red-650 font-bold text-xs flex items-center justify-center cursor-pointer transition-all active:scale-90"
                  title="Delete"
                >
                  ⌫
                </button>
                
                {/* Zero */}
                <button
                  onClick={() => handleKeyPress('0')}
                  className="w-14 h-14 rounded-full bg-[#faf9f7] hover:bg-[#efecff] text-slate-700 hover:text-primary font-bold text-lg border border-slate-200 hover:border-indigo-200 flex items-center justify-center cursor-pointer transition-all active:scale-90 shadow-sm"
                >
                  0
                </button>
                
                {/* Placeholder/Lock */}
                <div className="w-14 h-14 flex items-center justify-center text-slate-300">
                  <Lock className="w-4 h-4" />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 3: Registration Screen */}
        {isRegistering && (
          <motion.div
            key="register"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
            className="w-full max-w-md p-2 bg-[#1a1a2e]/5 rounded-[2.5rem] ring-1 ring-slate-200/40 shadow-xl"
          >
            <div className="bg-white rounded-[calc(2.5rem-0.5rem)] p-8 md:p-10 shadow-inner flex flex-col">
              {/* Back button */}
              <button
                onClick={() => {
                  setIsRegistering(false);
                  fetchProfiles();
                }}
                className="self-start -ml-2 p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <div className="flex items-center gap-3 mt-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 text-primary flex items-center justify-center">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                  <h2 className="text-xl font-extrabold text-slate-800">Add Dentist Profile</h2>
                  <p className="text-xs text-slate-400 mt-0.5 font-medium">Onboard a provider to the clinic pilot.</p>
                </div>
              </div>

              <form onSubmit={handleRegister} className="mt-6 flex flex-col gap-4">
                {regError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-650 flex-shrink-0" />
                    <span>{regError}</span>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Full Name</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Dr. Emily Carter"
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    className="h-11 px-4 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-on-surface"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Specialty</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Cosmetic Dentistry"
                    value={regSpecialty}
                    onChange={e => setRegSpecialty(e.target.value)}
                    className="h-11 px-4 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-on-surface"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">4-Digit PIN</label>
                    <input
                      required
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="PIN"
                      value={regPin}
                      onChange={e => setRegPin(e.target.value.replace(/\D/g, ''))}
                      className="h-11 px-4 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-center font-bold tracking-widest text-on-surface"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Confirm PIN</label>
                    <input
                      required
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="Confirm"
                      value={regConfirmPin}
                      onChange={e => setRegConfirmPin(e.target.value.replace(/\D/g, ''))}
                      className="h-11 px-4 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-center font-bold tracking-widest text-on-surface"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="mt-4 w-full h-12 bg-primary hover:bg-opacity-95 text-white font-bold rounded-xl shadow-lg active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>Onboard & Start Scribing</span>
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
