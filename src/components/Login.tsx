import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Lock, Plus, ArrowLeft, AlertCircle, Sparkles, UserPlus, Trash2, X, CirclePlay } from 'lucide-react';

interface DentistProfile {
  id: string;
  name: string;
  specialty: string;
  pinHash?: string;
  salt?: string;
}

interface LoginProps {
  onLoginSuccess: (token: string, dentist: DentistProfile) => void;
}

const OBSOLETE_DEMO_IDS = new Set([
  'fa4f0084-25e4-4ffc-a3cf-e48f72a6b251',
  'fb2a8f09-1a05-4c07-ba21-bf99a9a3b610',
  'fc3b9d08-2b06-4d08-cb32-cf00b0b4c721',
  'aab15e16-5f95-45a0-b2b2-0dba09bd6651'
]);

export default function Login({ onLoginSuccess }: LoginProps) {
  const [profiles, setProfiles] = useState<DentistProfile[]>(() => {
    try {
      const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
      if (localProfilesStr) {
        const parsed: DentistProfile[] = JSON.parse(localProfilesStr);
        return parsed.filter(p => !OBSOLETE_DEMO_IDS.has(p.id));
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(false);
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
  const [regInviteCode, setRegInviteCode] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regConfirmPin, setRegConfirmPin] = useState('');
  const [regError, setRegError] = useState<string | null>(null);

  // Delete profile states
  const [profileToDelete, setProfileToDelete] = useState<DentistProfile | null>(null);
  const [deletePin, setDeletePin] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch profiles on mount
  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/auth/profiles');
      let serverProfiles: DentistProfile[] = [];
      if (res.ok) {
        serverProfiles = await res.json();
      }

      const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
      const localProfiles: DentistProfile[] = localProfilesStr ? JSON.parse(localProfilesStr) : [];

      const profileMap = new Map<string, DentistProfile>();

      // 1. Keep custom local profiles (excluding legacy hardcoded demo IDs)
      localProfiles.forEach(p => {
        if (!OBSOLETE_DEMO_IDS.has(p.id)) {
          profileMap.set(p.id, p);
        }
      });

      // 2. Merge server profiles (excluding legacy hardcoded demo IDs)
      serverProfiles.forEach(p => {
        if (!OBSOLETE_DEMO_IDS.has(p.id)) {
          const existing = profileMap.get(p.id);
          profileMap.set(p.id, {
            ...p,
            pinHash: existing?.pinHash,
            salt: existing?.salt
          });
        }
      });

      const merged = Array.from(profileMap.values());
      setProfiles(merged);
      localStorage.setItem('dentai_saved_profiles', JSON.stringify(merged));
    } catch (err) {
      console.error('Failed to load profiles from server, using local cache:', err);
      const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
      if (localProfilesStr) {
        try {
          const parsed: DentistProfile[] = JSON.parse(localProfilesStr);
          const filtered = parsed.filter(p => !OBSOLETE_DEMO_IDS.has(p.id));
          setProfiles(filtered);
          localStorage.setItem('dentai_saved_profiles', JSON.stringify(filtered));
        } catch {}
      }
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
    if (!selectedProfile || isRegistering || profileToDelete) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, selectedProfile, isRegistering, profileToDelete]);

  const submitLogin = async (completedPin: string) => {
    if (!selectedProfile) return;
    setIsSubmitting(true);
    setLoginError(null);

    const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
    const localProfiles: DentistProfile[] = localProfilesStr ? JSON.parse(localProfilesStr) : [];

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dentistId: selectedProfile.id,
          pin: completedPin
        })
      });

      const data = await res.json();
      if (res.ok) {
        try {
          const updatedLocal = localProfiles.map(p => p.id === data.dentist.id ? { ...p, ...data.dentist } : p);
          if (!updatedLocal.some(p => p.id === data.dentist.id)) {
            updatedLocal.push(data.dentist);
          }
          localStorage.setItem('dentai_saved_profiles', JSON.stringify(updatedLocal));
        } catch {}
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
        body: JSON.stringify({
          name: regName,
          specialty: regSpecialty,
          pin: regPin,
          inviteCode: regInviteCode.trim() || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        // Save new profile to local saved profiles with pinHash and salt
        try {
          const localProfilesStr = localStorage.getItem('dentai_saved_profiles');
          const localProfiles: DentistProfile[] = localProfilesStr ? JSON.parse(localProfilesStr) : [];
          const profileWithCreds = {
            id: data.dentist.id,
            name: data.dentist.name,
            specialty: data.dentist.specialty
          };
          const filtered = localProfiles.filter(p => p.id !== data.dentist.id);
          filtered.push(profileWithCreds);
          localStorage.setItem('dentai_saved_profiles', JSON.stringify(filtered));
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

  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileToDelete) return;
    if (!/^\d{4}$/.test(deletePin)) {
      setDeleteError('PIN must be exactly 4 digits.');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/auth/profiles/${profileToDelete.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: deletePin })
      });

      const data = await res.json();
      if (res.ok) {
        // Remove from local profiles
        const updated = profiles.filter(p => p.id !== profileToDelete.id);
        setProfiles(updated);
        localStorage.setItem('dentai_saved_profiles', JSON.stringify(updated));
        setProfileToDelete(null);
        setDeletePin('');
      } else {
        setDeleteError(data.error || 'Incorrect PIN. Profile deletion cancelled.');
        setDeletePin('');
      }
    } catch (err) {
      setDeleteError('Server connection error. Please try again.');
    } finally {
      setIsDeleting(false);
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
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F8F7F5] px-4 py-16 font-sans relative overflow-hidden">
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
              ) : profiles.length === 0 ? (
                <div className="w-full mt-8 flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-center">
                  <div className="w-12 h-12 rounded-full bg-indigo-50 text-primary flex items-center justify-center mb-3">
                    <UserPlus className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">No Clinic Profiles Registered</h3>
                  <p className="text-xs text-slate-500 max-w-xs mt-1 mb-5 leading-relaxed">
                    Welcome to DentAI. Register your clinic's first dental practitioner profile to begin ambient charting.
                  </p>
                  <button
                    onClick={() => {
                      setIsRegistering(true);
                      setRegError(null);
                    }}
                    className="px-5 py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-dark shadow-md shadow-primary/20 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Register First Dentist</span>
                  </button>
                </div>
              ) : (
                <div className="w-full mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[320px] overflow-y-auto pr-1">
                  {profiles.map(p => {
                    const initials = getInitials(p.name);
                    return (
                      <div key={p.id} className="relative group/card">
                        <motion.button
                          whileHover={{ y: -3, scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleSelectProfile(p)}
                          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#faf9f7] border border-slate-200 hover:border-indigo-200 hover:bg-white text-left cursor-pointer transition-all duration-300 hover:shadow-md pr-10"
                        >
                          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-primary flex items-center justify-center font-bold text-base border border-indigo-100 group-hover/card:bg-primary group-hover/card:text-white transition-colors duration-300 shadow-sm">
                            {initials}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-slate-800 text-sm truncate">{p.name}</span>
                            <span className="text-slate-400 text-xs truncate mt-0.5">{p.specialty}</span>
                          </div>
                        </motion.button>
                        
                        <button
                          type="button"
                          title="Remove profile from this workstation"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProfileToDelete(p);
                            setDeletePin('');
                            setDeleteError(null);
                          }}
                          className="absolute top-2.5 right-2.5 p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 bg-slate-100/70 sm:bg-transparent sm:opacity-0 sm:group-hover/card:opacity-100 focus:opacity-100 transition-all cursor-pointer z-10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Clinic Invite Code (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. SMILE42"
                    value={regInviteCode}
                    onChange={e => setRegInviteCode(e.target.value.toUpperCase())}
                    className="h-11 px-4 bg-[#faf9f7] border border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none font-mono font-bold tracking-widest text-on-surface placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                  />
                  <p className="text-[10px] text-slate-400 ml-1 leading-relaxed">
                    Joining a practice? Enter the code a colleague shared and the clinic owner will approve you.
                  </p>
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

      {/* Narrated product demo — opens the public #/demo theater (no auth needed) */}
      <button
        onClick={() => {
          window.location.hash = '#/demo';
        }}
        className="relative mt-6 mx-auto flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 hover:bg-white border border-slate-200 text-primary text-xs font-bold shadow-sm hover:shadow-md transition-all cursor-pointer"
      >
        <CirclePlay className="w-4 h-4" />
        <span>Watch the narrated product demo</span>
        <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">3 min</span>
      </button>

      {/* PIN-Protected Profile Deletion Modal */}
      <AnimatePresence>
        {profileToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl border border-slate-100 font-sans"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                  <Trash2 className="w-5 h-5" />
                </div>
                <button
                  type="button"
                  onClick={() => setProfileToDelete(null)}
                  className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <h3 className="text-lg font-bold text-slate-800">
                Remove Profile?
              </h3>
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                Enter the 4-digit PIN for <span className="font-bold text-slate-700">{profileToDelete.name}</span> to confirm removing this profile from this workstation.
              </p>

              <form onSubmit={handleConfirmDelete} className="mt-5">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoFocus
                  value={deletePin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setDeletePin(val);
                    setDeleteError(null);
                  }}
                  placeholder="••••"
                  className="w-full text-center tracking-[0.5em] font-mono text-2xl py-2.5 px-4 rounded-xl border border-slate-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 outline-none transition-all"
                />

                {deleteError && (
                  <p className="text-xs text-red-600 font-medium mt-2 flex items-center justify-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{deleteError}</span>
                  </p>
                )}

                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setProfileToDelete(null)}
                    className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-semibold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deletePin.length !== 4 || isDeleting}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 text-white font-semibold text-xs hover:bg-red-700 disabled:opacity-50 transition-colors shadow-md shadow-red-600/20 cursor-pointer"
                  >
                    {isDeleting ? 'Removing...' : 'Confirm Remove'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
