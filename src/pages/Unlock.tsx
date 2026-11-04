import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Check, Delete, KeyRound, Loader2, Lock, ShieldCheck, Vault } from 'lucide-react';
import { useData } from '../store/dataStore';
import { Button, Card, Field, Input } from '../components/ui';

/**
 * Lock screen: restores the session DEK from the master password or (when
 * registered) the device PIN. Failed attempts are persisted across restarts;
 * after five failures the vault locks for five minutes. PIN recovery uses
 * username + master password to re-register a new PIN.
 *
 * Presentation (v2): PIN unlocking uses a dedicated numeric-keypad screen
 * with animated PIN dots, keyboard- and mouse-synchronised digit entry, an
 * animated unlock gate and a shake on failure. Password fallback and the
 * recovery flow keep their existing secure mechanics unchanged.
 */

/* Self-contained keyframes so the tailwind config stays untouched. */
const UNLOCK_CSS = `
@keyframes vf-dot-pop {
  0%   { transform: scale(0.4); opacity: 0; }
  60%  { transform: scale(1.25); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes vf-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-9px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(4px); }
}
@keyframes vf-gate-open {
  0%   { transform: translateX(-4px); opacity: 0.55; }
  70%  { transform: translateX(3px); opacity: 1; }
  100% { transform: translateX(0); opacity: 1; }
}
@keyframes vf-rise {
  0%   { transform: translateY(10px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
.vf-dot-pop   { animation: vf-dot-pop 180ms ease-out both; }
.vf-shake     { animation: vf-shake 420ms ease-in-out both; }
.vf-gate-open { animation: vf-gate-open 500ms ease-out both; }
.vf-rise      { animation: vf-rise 450ms ease-out both; }
.vf-key {
  user-select: none; -webkit-tap-highlight-color: transparent;
  transition: transform 90ms ease, background-color 120ms ease, border-color 120ms ease;
}
.vf-key:active { transform: scale(0.93); }
.vf-key:hover { background-color: rgba(255,255,255,0.06); }
`;

const greet = (owner: string): string => {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return owner ? `${part}, ${owner}` : part;
};

export function UnlockScreen() {
  const {
    mode,
    settings,
    unlockWithPassword,
    unlockWithPin,
    pinCooldownRemaining,
    hasPin,
    pinLength,
    recoverPin,
    recoveryCooldownRemaining,
  } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'unlock' | 'recovery'>('unlock');
  const [method, setMethod] = useState<'pin' | 'password'>(hasPin() ? 'pin' : 'password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(pinCooldownRemaining());
  const [shake, setShake] = useState(0); // bumped per failed attempt to retrigger the animation
  const [justUnlocked, setJustUnlocked] = useState(false);

  // recovery form
  const [recUsername, setRecUsername] = useState('');
  const [recPassword, setRecPassword] = useState('');
  const [recPin, setRecPin] = useState('');

  // Tick the cooldown display once per second while locked out.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(pinCooldownRemaining()), 1000);
    return () => clearInterval(t);
  }, [cooldown, pinCooldownRemaining]);

  const digits = pinLength() ?? 6;

  const doUnlockPin = useCallback(
    async (value: string) => {
      if (cooldown > 0 || pending || value.length !== digits) return;
      setErr(null);
      setPending(true);
      const res = await unlockWithPin(value);
      setPending(false);
      setPin('');
      if (res) {
        setErr(res);
        setShake((n) => n + 1);
        setCooldown(pinCooldownRemaining());
      }
    },
    [cooldown, pending, digits, unlockWithPin, pinCooldownRemaining],
  );

  const pressKey = (d: number) => {
    if (cooldown > 0 || pending) return;
    setPin((p) => (p.length >= digits ? p : p + String(d)));
  };
  const backspace = () => setPin((p) => p.slice(0, -1));
  const clearPin = () => setPin('');

  const onUnlockGate = () => {
    if (pin.length === digits && !pending) {
      setJustUnlocked(true);
      window.setTimeout(() => void doUnlockPin(pin), 320); // let the gate animation play
    }
  };

  // Physical keyboard stays in sync with the keypad (digits, Backspace, Enter, Clear).
  useEffect(() => {
    if (method !== 'pin' || tab !== 'unlock') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Modifier+digit shortcuts are left alone; plain typing drives the keypad.
      if (e.key >= '0' && e.key <= '9') {
        pressKey(Number(e.key));
      } else if (e.key === 'Backspace') {
        if (e.shiftKey) clearPin();
        else backspace();
      } else if (e.key === 'Enter') {
        if (pin.length === digits) onUnlockGate();
      } else if (e.key === 'Escape') {
        clearPin();
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, tab, pin, cooldown, pending, digits]);

  /*
   * Guards live AFTER every hook. They used to sit above the useCallback and
   * keyboard useEffect below (hooks were declared conditionally), which broke
   * React's hook invariant on the exact unlock-success transition: mode flips
   * from 'locked' so the early <Navigate> path rendered fewer hooks and the
   * tree crashed before AppLayout could take over — the "black screen after
   * correct password" bug. Never place hooks after these early returns.
   */
  if (mode === 'loading') return null;
  if (mode !== 'locked') return <Navigate to="/" replace />;

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldown > 0) return;
    setErr(null);
    setPending(true);
    const res = await unlockWithPassword(password);
    setPending(false);
    setPassword('');
    if (res) {
      setErr(res);
      setShake((n) => n + 1);
      setCooldown(pinCooldownRemaining());
    }
  };

  const submitRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoveryCooldownRemaining() > 0) return;
    setErr(null);
    setPending(true);
    const res = await recoverPin(recUsername, recPassword, recPin);
    setPending(false);
    if (res) {
      setErr(res);
      return;
    }
    navigate('/', { replace: true });
  };

  const dots = Array.from({ length: digits }, (_, i) => i < pin.length);
  const keypadDigits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const cooldownActive = cooldown > 0;

  const reloadUnlock = () => {
    setTab('unlock');
    setErr(null);
    setRecUsername('');
    setRecPassword('');
    setRecPin('');
  };

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-4">
      <style>{UNLOCK_CSS}</style>
      <div className="w-full max-w-sm">

        {/* ── Branding + greeting ── */}
        <div className="flex flex-col items-center mb-8 vf-rise">
          <span className="w-14 h-14 rounded-2xl bg-accent/15 border border-accent/25 flex items-center justify-center mb-3">
            <Vault size={26} className="text-accent" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Vaultfolio</span>
          <span className="text-xs text-txt-dim mt-1.5">{greet(settings.ownerName)}</span>
        </div>

        {/* ── PIN keypad screen ── */}
        {tab === 'unlock' && method === 'pin' ? (
          <div className="flex flex-col items-center">
            {cooldownActive && (
              <div className="w-full mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center">
                <p className="text-sm text-amber-400">Too many failed attempts.</p>
                <p className="text-xs text-txt-muted mt-1">
                  Try again in <span className="tnum font-medium">{cooldown}s</span>. This timer persists across app restarts.
                </p>
              </div>
            )}

            {/* PIN indicators — never show the digits themselves */}
            <div key={shake} className={`flex items-center gap-3 mb-7 h-6 ${shake > 0 ? 'vf-shake' : ''}`} role="group" aria-label="PIN progress">
              {dots.map((filled, i) => (
                <span
                  key={i}
                  className={
                    filled
                      ? `w-3.5 h-3.5 rounded-full bg-accent shadow-[0_0_10px_rgba(212,175,55,0.45)] ${i === pin.length - 1 ? 'vf-dot-pop' : ''}`
                      : 'w-3.5 h-3.5 rounded-full border border-ink-600'
                  }
                />
              ))}
            </div>

            {err && (
              <p key={`e${shake}`} className="text-xs text-rose-400 mb-4 text-center">{err}</p>
            )}

            {justUnlocked || pending ? (
              <div className="flex flex-col items-center my-8" aria-live="polite">
                <span className="vf-gate-open w-12 h-12 rounded-full bg-positive/15 border border-positive/40 flex items-center justify-center">
                  {pending ? <Loader2 size={20} className="animate-spin text-positive" /> : <Check size={22} className="text-positive" />}
                </span>
                <p className="text-xs text-txt-muted mt-3">Unlocking your vault…</p>
              </div>
            ) : (
              <>
                {/* Keypad */}
                <div className="grid grid-cols-3 gap-3 w-64" role="group" aria-label="PIN keypad">
                  {keypadDigits.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="vf-key h-16 rounded-2xl border border-ink-700 bg-ink-900 text-xl font-medium text-txt tnum focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      onClick={() => pressKey(d)}
                      disabled={cooldownActive}
                      aria-label={`Digit ${d}`}
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="vf-key h-16 rounded-2xl border border-transparent bg-transparent flex items-center justify-center text-txt-dim hover:text-txt focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    onClick={clearPin}
                    disabled={cooldownActive || pin.length === 0}
                    aria-label="Clear PIN"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="vf-key h-16 rounded-2xl border border-ink-700 bg-ink-900 text-xl font-medium text-txt tnum focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => pressKey(0)}
                    disabled={cooldownActive}
                    aria-label="Digit 0"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    className="vf-key h-16 rounded-2xl border border-ink-700 bg-ink-900 flex items-center justify-center text-txt-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    onClick={backspace}
                    disabled={cooldownActive || pin.length === 0}
                    aria-label="Backspace"
                  >
                    <Delete size={18} />
                  </button>
                </div>

                {/* Unlock gate */}
                <button
                  type="button"
                  onClick={onUnlockGate}
                  disabled={cooldownActive || pin.length !== digits}
                  className={`mt-6 w-64 h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-medium transition-all duration-200 ${
                    pin.length === digits && !cooldownActive
                      ? 'bg-accent text-ink-950 hover:brightness-110 cursor-pointer'
                      : 'bg-ink-800 text-txt-dim cursor-not-allowed border border-ink-700'
                  }`}
                  aria-label="Unlock"
                >
                  <ShieldCheck size={16} /> Unlock
                </button>
              </>
            )}

            <button
              type="button"
              className="mt-5 text-[11px] text-txt-dim hover:text-txt text-center"
              onClick={() => { setMethod('password'); setErr(null); }}
            >
              Use master password instead
            </button>
            {hasPin() && (
              <button
                type="button"
                className="mt-2 text-[11px] text-txt-dim hover:text-txt text-center"
                onClick={() => { setTab('recovery'); setMethod('password'); setErr(null); }}
              >
                Forgot your PIN?
              </button>
            )}
          </div>
        ) : (
          /* ── Password fallback + PIN recovery (original secure forms) ── */
          <Card elevated className="p-5 shadow-elev-3">
            {tab === 'unlock' ? (
              <>
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
                  <Lock size={15} className="text-accent" /> Your vault is locked
                  {hasPin() && (
                    <button
                      className="ml-auto text-[11px] text-accent underline underline-offset-2"
                      onClick={() => setMethod('pin')}
                      type="button"
                    >
                      Use PIN
                    </button>
                  )}
                </h2>
                {cooldownActive && (
                  <div className="text-center py-4 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10">
                    <p className="text-sm text-amber-400">Too many failed attempts.</p>
                    <p className="text-xs text-txt-muted mt-1">
                      Try again in <span className="tnum font-medium">{cooldown}s</span>. This timer persists across app restarts.
                    </p>
                  </div>
                )}
                <form onSubmit={submitPassword} className="space-y-3">
                  <Field label="Master password">
                    <Input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                  </Field>
                  {err && <p className="text-xs text-rose-400">{err}</p>}
                  <Button variant="primary" className="w-full" type="submit" disabled={pending}>
                    {pending && <Loader2 size={14} className="animate-spin" />}
                    Unlock
                  </Button>
                  {hasPin() && (
                    <button
                      type="button"
                      onClick={() => { setTab('recovery'); setErr(null); setShake(0); }}
                      className="w-full text-[11px] text-txt-dim hover:text-txt text-center"
                    >
                      Forgot your PIN?
                    </button>
                  )}
                </form>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-1">
                  <KeyRound size={15} className="text-accent" /> Recover your PIN
                </h2>
                <p className="text-[11px] text-txt-dim mb-4">
                  Verify your username and master password, then choose a new PIN. Wrong attempts
                  also count toward lockout.
                </p>
                <form onSubmit={submitRecovery} className="space-y-3">
                  <Field label="Username" required>
                    <Input required value={recUsername} onChange={(e) => setRecUsername(e.target.value)} autoComplete="off" />
                  </Field>
                  <Field label="Master password" required>
                    <Input type="password" required value={recPassword} onChange={(e) => setRecPassword(e.target.value)} autoComplete="current-password" />
                  </Field>
                  <Field label="New 6-digit PIN" required>
                    <Input
                      type="password"
                      inputMode="numeric"
                      pattern="^\d{6}$"
                      maxLength={6}
                      required
                      value={recPin}
                      onChange={(e) => setRecPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      className="text-center tracking-[0.5em]"
                      autoComplete="off"
                    />
                  </Field>
                  {err && <p className="text-xs text-rose-400">{err}</p>}
                  <Button variant="primary" className="w-full" type="submit" disabled={pending}>
                    {pending && <Loader2 size={14} className="animate-spin" />}
                    Set new PIN &amp; unlock
                  </Button>
                  <button
                    type="button"
                    onClick={reloadUnlock}
                    className="w-full text-[11px] text-txt-dim hover:text-txt text-center"
                  >
                    Back to unlock
                  </button>
                </form>
              </>
            )}
          </Card>
        )}

        <p className="text-[11px] text-txt-dim text-center mt-4">
          Data stays on this device, encrypted.{' '}
          {import.meta.env.VITE_SUPABASE_URL && (
            <Link to="/auth" className="text-accent underline underline-offset-2">
              Use cloud sync instead
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
