import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, Lock, Vault } from 'lucide-react';
import { useData } from '../store/dataStore';
import { Button, Card, Field, Input } from '../components/ui';

/**
 * Lock screen: restores the session DEK from the master password or (when
 * registered) the device PIN. Failed attempts are persisted across restarts;
 * after five failures the vault locks for five minutes. PIN recovery uses
 * username + master password to re-register a new PIN.
 */
export function UnlockScreen() {
  const { mode, unlockWithPassword, unlockWithPin, pinCooldownRemaining, hasPin, pinLength, recoverPin, recoveryCooldownRemaining } =
    useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'main' | 'recovery'>(hasPin() ? 'main' : 'main');
  const [method, setMethod] = useState<'pin' | 'password'>(hasPin() ? 'pin' : 'password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(pinCooldownRemaining());

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

  if (mode === 'loading') return null;
  if (mode !== 'locked') return <Navigate to="/" replace />;

  const submitPin = async (e: FormEvent) => {
    e.preventDefault();
    if (cooldown > 0) return;
    setErr(null);
    setPending(true);
    const res = await unlockWithPin(pin);
    setPending(false);
    setPin('');
    if (res) {
      setErr(res);
      setCooldown(pinCooldownRemaining());
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (cooldown > 0) return;
    setErr(null);
    setPending(true);
    const res = await unlockWithPassword(password);
    setPending(false);
    setPassword('');
    if (res) {
      setErr(res);
      setCooldown(pinCooldownRemaining());
    }
  };

  const submitRecovery = async (e: FormEvent) => {
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

  const digits = pinLength() ?? 6;

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <span className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center">
            <Vault size={20} className="text-accent" />
          </span>
          <span className="text-xl font-semibold">Vaultfolio</span>
        </div>

        <Card className="p-5">
          {tab === 'main' ? (
            <>
              <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
                <Lock size={15} className="text-accent" /> Your vault is locked
                {hasPin() && (
                  <button
                    className="ml-auto text-[11px] text-accent underline underline-offset-2"
                    onClick={() => setMethod(method === 'pin' ? 'password' : 'pin')}
                    type="button"
                  >
                    {method === 'pin' ? 'Use password' : 'Use PIN'}
                  </button>
                )}
              </h2>

              {cooldown > 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-amber-400">Too many failed attempts.</p>
                  <p className="text-xs text-txt-muted mt-1">
                    Try again in <span className="tnum font-medium">{cooldown}s</span>. This timer
                    persists across app restarts.
                  </p>
                </div>
              ) : method === 'pin' ? (
                <form onSubmit={submitPin} className="space-y-3">
                  <Field label={`Enter your ${digits}-digit PIN`}>
                    <Input
                      type="password"
                      inputMode="numeric"
                      pattern={new RegExp(`^\\d{${digits}}$`).source}
                      maxLength={digits}
                      required
                      autoFocus
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, digits))}
                      className="text-center tracking-[0.5em] text-lg"
                      autoComplete="off"
                    />
                  </Field>
                  {err && <p className="text-xs text-rose-400">{err}</p>}
                  <Button variant="primary" className="w-full" type="submit" disabled={pending || pin.length !== digits}>
                    {pending && <Loader2 size={14} className="animate-spin" />}
                    Unlock
                  </Button>
                  <button type="button" onClick={() => setTab('recovery')} className="w-full text-[11px] text-txt-dim hover:text-txt text-center">
                    Forgot your PIN?
                  </button>
                </form>
              ) : (
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
                    <button type="button" onClick={() => setTab('recovery')} className="w-full text-[11px] text-txt-dim hover:text-txt text-center">
                      Forgot your PIN?
                    </button>
                  )}
                </form>
              )}
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
                <button type="button" onClick={() => setTab('main')} className="w-full text-[11px] text-txt-dim hover:text-txt text-center">
                  Back to unlock
                </button>
              </form>
            </>
          )}
        </Card>

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
