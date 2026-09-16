import React, { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck, LogOut, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AuthUser } from '../utils/storage';

interface CredentialScreenProps {
  authToken: string | null;
  onExit: () => void;
  onAuthenticated: (token: string, user: AuthUser) => void;
}

type Mode = 'overview' | 'change' | 'recover' | 'devices' | 'mfa';

/** Shared input styling for the code and PIN fields on this screen. */
const CODE_INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-mono text-base tracking-[0.25em] text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

const PIN_PATTERN = /^\d{4}$/;

/**
 * Credential self-service: change your PIN, sign out every device, or redeem an
 * operator-issued recovery token.
 *
 * This screen exists because the alternative — a universal "master PIN" or a
 * support person deleting a profile — either exposes every patient record on
 * the platform or destroys records the clinic must keep. Recovery here is
 * scoped to one account, single-use, expiring, and audited.
 */
export default function CredentialScreen({ authToken, onExit, onAuthenticated }: CredentialScreenProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Two-factor state. The control is real TOTP (src/lib/totp.ts) and is
  // enforced at sign-in, so this screen is the only way to turn it on.
  const [mfa, setMfa] = useState<{ enabled: boolean; recoveryCodesRemaining: number } | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaPin, setMfaPin] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Status is read once on entry so the overview can tell a clinician whether
  // their account is actually protected.
  useEffect(() => {
    void loadMfa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const loadMfa = async () => {
    if (!authToken) return;
    try {
      const res = await fetch('/api/auth/mfa', { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) setMfa(await res.json());
    } catch {
      // Status is informational here; other screens still work without it.
    }
  };

  const startMfaEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/enroll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start enrolment.');
      setMfaEnrollment({ secret: data.secret, otpauthUrl: data.otpauthUrl });
      setMfaCode('');
      setMode('mfa');
    } catch (err: any) {
      setError(err.message || 'Could not start two-factor enrolment.');
    } finally {
      setBusy(false);
    }
  };

  const confirmMfaEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ code: mfaCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'That code did not match.');
      setRecoveryCodes(data.recoveryCodes || []);
      setMfaEnrollment(null);
      await loadMfa();
      setSuccess('Two-factor authentication is on.');
    } catch (err: any) {
      setError(err.message || 'Could not confirm two-factor enrolment.');
    } finally {
      setBusy(false);
    }
  };

  const changeMfa = async (action: 'disable' | 'regenerate') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/mfa/${action === 'disable' ? 'disable' : 'recovery-codes'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ pin: mfaPin, code: mfaCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'That combination was not accepted.');
      if (action === 'disable') {
        setSuccess('Two-factor authentication is off. We recommend turning it back on.');
        setRecoveryCodes(null);
      } else {
        setRecoveryCodes(data.recoveryCodes || []);
        setSuccess('New recovery codes issued. The old ones no longer work.');
      }
      setMfaPin('');
      setMfaCode('');
      await loadMfa();
    } catch (err: any) {
      setError(err.message || 'Could not update two-factor settings.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setRecoveryToken('');
    setError(null);
  };

  const validationError = (): string | null => {
    if (!PIN_PATTERN.test(newPin)) return 'Choose a new 4-digit PIN.';
    if (newPin !== confirmPin) return 'The two new PINs do not match.';
    if (mode === 'change' && !PIN_PATTERN.test(currentPin)) return 'Enter your current 4-digit PIN.';
    return null;
  };

  const loadUser = async (token: string): Promise<AuthUser | null> => {
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return (await res.json()) as AuthUser;
    } catch {
      return null;
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validationError();
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not change your PIN.');
      const user = await loadUser(body.token);
      if (user) {
        onAuthenticated(body.token, user);
        return;
      }
      setSuccess(body.message || 'PIN updated.');
      reset();
      setMode('overview');
    } catch (err: any) {
      setError(err.message || 'Could not change your PIN.');
    } finally {
      setBusy(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validationError();
    if (invalid) return setError(invalid);
    if (recoveryToken.trim().length < 20) return setError('Paste the full recovery token from your administrator.');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/recovery/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: recoveryToken.trim(), newPin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not complete recovery.');
      onAuthenticated(body.token, body.dentist as AuthUser);
    } catch (err: any) {
      setError(err.message || 'Could not complete recovery.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeDevices = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/sessions/revoke-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not sign other devices out.');
      const user = await loadUser(body.token);
      if (user) onAuthenticated(body.token, user);
      setSuccess(body.message || 'Other devices signed out.');
      setMode('overview');
    } catch (err: any) {
      setError(err.message || 'Could not sign other devices out.');
    } finally {
      setBusy(false);
    }
  };

  const pinField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    autoFocus = false
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg tracking-[0.4em] text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        placeholder="••••"
      />
    </label>
  );

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F8F7F5] px-4 py-16 font-sans">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-7">
        <button
          onClick={onExit}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
        </button>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">Account access</h1>
            <p className="text-slate-500 text-xs">Change your PIN, sign out devices, or recover access.</p>
          </div>
        </div>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {mode === 'overview' && (
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => { reset(); setSuccess(null); setMode('change'); }}
              disabled={!authToken}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Change my PIN
              <span className="block text-xs font-normal text-slate-500">
                {authToken ? 'Other devices are signed out when you do.' : 'Available once you are signed in.'}
              </span>
            </button>
            <button
              onClick={() => { reset(); setSuccess(null); setMode('mfa'); loadMfa(); }}
              disabled={!authToken}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Two-factor authentication</span>
              <span className="block text-xs font-normal text-slate-500">
                {authToken
                  ? (mfa?.enabled
                      ? `On — ${mfa.recoveryCodesRemaining} recovery code(s) left.`
                      : 'Recommended. A 4-digit PIN is only safe with a second factor.')
                  : 'Available once you are signed in.'}
              </span>
            </button>
            <button
              onClick={() => { reset(); setSuccess(null); setMode('devices'); }}
              disabled={!authToken}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className="flex items-center gap-2"><LogOut className="w-4 h-4" /> Sign out my other devices</span>
              <span className="block text-xs font-normal text-slate-500">
                Use this if you left a session open on a clinic workstation.
              </span>
            </button>
            <button
              onClick={() => { reset(); setSuccess(null); setMode('recover'); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Recover access with a recovery code
              <span className="block text-xs font-normal text-slate-500">
                Your administrator issues a single-use code when you are locked out.
              </span>
            </button>
          </div>
        )}

        {mode === 'change' && (
          <form onSubmit={handleChangePin} className="mt-6 flex flex-col gap-4">
            {pinField('Current PIN', currentPin, setCurrentPin, true)}
            {pinField('New PIN', newPin, setNewPin)}
            {pinField('Confirm new PIN', confirmPin, setConfirmPin)}
            <p className="text-xs text-slate-500">
              Avoid repeated digits, runs like 1234, and anything a colleague could guess. A clinic work-station PIN
              is the last barrier in front of a patient record.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode('overview')} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
                {busy ? 'Saving…' : 'Change PIN'}
              </button>
            </div>
          </form>
        )}

        {mode === 'recover' && (
          <form onSubmit={handleRecover} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Recovery code</span>
              <textarea
                value={recoveryToken}
                onChange={(e) => setRecoveryToken(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-mono text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                placeholder="Paste the code your administrator gave you"
              />
            </label>
            {pinField('New PIN', newPin, setNewPin)}
            {pinField('Confirm new PIN', confirmPin, setConfirmPin)}
            <p className="text-xs text-slate-500">
              Recovery codes are single-use and expire within an hour. Redeeming one signs out every other device on
              your account and is recorded in the access log.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode('overview')} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
                {busy ? 'Recovering…' : 'Recover access'}
              </button>
            </div>
          </form>
        )}

        {mode === 'mfa' && (
          <div className="mt-6 flex flex-col gap-4">
            {recoveryCodes && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Save these recovery codes now
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900">
                  Each code works once. They are the only way in if you lose your phone, and this is the only
                  time they are shown.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-sm text-amber-900">
                  {recoveryCodes.map((code) => (
                    <span key={code}>{code}</span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}
                  className="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  Copy all
                </button>
              </div>
            )}

            {!mfa?.enabled && !mfaEnrollment && (
              <>
                <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
                  <span>
                    Add your profile to an authenticator app (Google Authenticator, 1Password, Microsoft
                    Authenticator). After that a PIN alone will not sign anyone in — including someone who has
                    watched you type it at the chair.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={startMfaEnrollment}
                  disabled={busy || !authToken}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {busy ? 'Starting…' : 'Set up two-factor authentication'}
                </button>
              </>
            )}

            {mfaEnrollment && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmMfaEnrollment();
                }}
                className="flex flex-col gap-4"
              >
                <p className="text-sm text-slate-600">
                  Add this key to your authenticator app, then enter the 6-digit code it displays.
                </p>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Setup key</p>
                  <p className="mt-1 break-all font-mono text-sm text-slate-800">{mfaEnrollment.secret}</p>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(mfaEnrollment.secret)}
                    className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-white"
                  >
                    Copy key
                  </button>
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Or open this link on the phone
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-600">{mfaEnrollment.otpauthUrl}</p>
                </div>
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  className={CODE_INPUT}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMfaEnrollment(null);
                      setMfaCode('');
                    }}
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || mfaCode.trim().length !== 6}
                    className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {busy ? 'Confirming…' : 'Confirm and turn on'}
                  </button>
                </div>
              </form>
            )}

            {mfa?.enabled && !mfaEnrollment && (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    Two-factor authentication is on. {mfa.recoveryCodesRemaining} recovery code(s) unused.
                    {mfa.recoveryCodesRemaining <= 2
                      ? ' Generate a new set before you run out.'
                      : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Changing this requires your PIN and a current code from your authenticator.
                </p>
                <input
                  value={mfaPin}
                  onChange={(e) => setMfaPin(e.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Your PIN"
                  className={CODE_INPUT}
                />
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  className={CODE_INPUT}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => changeMfa('regenerate')}
                    disabled={busy || mfaPin.length !== 4 || mfaCode.length !== 6}
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    New recovery codes
                  </button>
                  <button
                    type="button"
                    onClick={() => changeMfa('disable')}
                    disabled={busy || mfaPin.length !== 4 || mfaCode.length !== 6}
                    className="flex-1 rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    Turn off
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                reset();
                setRecoveryCodes(null);
                setMfaEnrollment(null);
                setMfaPin('');
                setMfaCode('');
                setMode('overview');
              }}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              Back
            </button>
          </div>
        )}

        {mode === 'devices' && (
          <div className="mt-6 flex flex-col gap-4">
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
              <span>
                This signs out every other device using your profile and keeps this one signed in. Any session that was
                left open on a shared workstation stops working immediately.
              </span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode('overview')} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevokeDevices}
                disabled={busy || !authToken}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'Signing out…' : 'Sign out other devices'}
              </button>
            </div>
          </div>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          DentAI never uses a shared or universal PIN. Every credential change and recovery is written to the clinic's
          access log. Policies:{' '}
          <a href="#/privacy" className="underline hover:text-slate-600">Privacy</a> ·{' '}
          <a href="#/terms" className="underline hover:text-slate-600">Terms</a>
        </p>
      </div>
    </div>
  );
}
