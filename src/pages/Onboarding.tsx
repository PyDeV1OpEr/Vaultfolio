import { Loader2, Vault, ShieldCheck, CloudUpload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useData } from '../store/dataStore';
import { Button, Card, Field, Input, Select } from '../components/ui';

/**
 * First-run screen: create the local encrypted profile that owns this
 * device's vault. Cloud sync (Supabase) stays available as an explicit
 * alternative for web builds, but the offline-first local vault is the
 * primary path and requires no network at all.
 */
export function OnboardingScreen() {
  const { mode, createProfile } = useData();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currency, setCurrency] = useState<'LKR' | 'USD'>('LKR');
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (mode === 'loading') return null;
  if (mode !== 'onboarding') return <Navigate to="/" replace />;

  const strength = (() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][strength] ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setErr('Application PIN must be exactly 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setErr('6-digit PINs do not match.');
      return;
    }
    setPending(true);
    const res = await createProfile({
      username: username.trim(),
      password,
      displayName: displayName.trim() || null,
      currency,
      pin,
    });
    setPending(false);
    if (res) setErr(res);
  };

  const pwStrengthColors = ['bg-ink-700', 'bg-rose-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'];

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 justify-center mb-2">
          <span className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center">
            <Vault size={20} className="text-accent" />
          </span>
          <span className="text-xl font-semibold">Vaultfolio</span>
        </div>
        <p className="text-[12px] text-txt-dim text-center mb-6">
          Private physical-asset wealth tracking. Everything you add is encrypted locally and never
          published.
        </p>

        <Card className="p-5">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-1">
            <ShieldCheck size={15} className="text-accent" /> Create your private vault
          </h2>
          <p className="text-[11px] text-txt-dim mb-4">
            The password unlocks this vault on this device only. It cannot be recovered —{' '}
            <strong>lost password means lost vault</strong>. Use a strong, memorable master password.
          </p>

          <form onSubmit={submit} className="space-y-3">
            <Field label="Username" required hint="Used for PIN recovery. At least 3 characters.">
              <Input
                required
                minLength={3}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. unais"
                autoComplete="off"
              />
            </Field>
            <Field label="Display name (optional)">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. M. Unais" />
            </Field>
            <Field label="Master password" required>
              <Input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            {password && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded overflow-hidden bg-ink-800 flex gap-0.5">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`flex-1 rounded-sm ${i < strength ? pwStrengthColors[strength] : 'bg-ink-700'}`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-txt-dim w-12">{strengthLabel}</span>
              </div>
            )}
            <Field label="Confirm password" required>
              <Input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>

            <div className="pt-1 border-t border-ink-800">
              <p className="text-[12px] font-medium text-txt mb-2">Quick 6-Digit PIN</p>
              <p className="text-[11px] text-txt-dim mb-3">
                Used to unlock your vault quickly at launch. Kept secure on this device with rate-limiting.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="6-digit PIN" required>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    className="text-center tracking-widest"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Confirm PIN" required>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    className="text-center tracking-widest"
                    autoComplete="off"
                  />
                </Field>
              </div>
            </div>

            <Field label="Base currency" hint="Records are kept in LKR; USD display converts live.">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value as 'LKR' | 'USD')}>
                <option value="LKR">LKR — Sri Lankan Rupees (base)</option>
                <option value="USD">USD — show US Dollars</option>
              </Select>
            </Field>

            {err && <p className="text-xs text-rose-400">{err}</p>}

            <Button
              variant="primary"
              className="w-full"
              type="submit"
              disabled={pending || !username || password.length < 8 || pin.length !== 6 || pin !== confirmPin}
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Create vault
            </Button>
          </form>

          {import.meta.env.VITE_SUPABASE_URL && (
            <div className="mt-3 pt-3 border-t border-ink-700/60 text-center">
              <span className="text-[11px] text-txt-dim flex items-center justify-center gap-1.5">
                <CloudUpload size={12} />
                Prefer cloud sync?{' '}
                <Link to="/auth" className="text-accent underline underline-offset-2">
                  Sign in with Supabase instead
                </Link>
              </span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
