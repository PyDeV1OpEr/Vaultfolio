import { Loader2, Vault } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useData } from '../store/dataStore';
import { Button, Card, Field, Input } from '../components/ui';
import { Navigate } from 'react-router-dom';

export function AuthScreen() {
  const { mode, signIn, signUp, continueDemo } = useData();
  const [tab, setTab] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (mode === 'loading') return null;
  if (mode === 'cloud' || mode === 'demo') return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setPending(true);
    const res = tab === 'in' ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    setPending(false);
    if (res) errOrMsg(res);
  };

  const errOrMsg = (res: string) => {
    if (/confirm/i.test(res)) setMsg(res);
    else setErr(res);
  };

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
          <div className="flex gap-1 p-1 bg-ink-800 rounded-lg mb-4">
            {(['in', 'up'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  tab === t ? 'bg-ink-700 text-txt' : 'text-txt-muted hover:text-txt'
                }`}
              >
                {t === 'in' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email" required>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </Field>
            <Field label="Password" required hint={tab === 'up' ? 'At least 8 characters.' : undefined}>
              <Input type="password" required minLength={tab === 'up' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'in' ? 'current-password' : 'new-password'} />
            </Field>
            {err && <p className="text-xs text-rose-400">{err}</p>}
            {msg && <p className="text-xs text-emerald-400">{msg}</p>}
            <Button variant="primary" className="w-full" type="submit" disabled={pending}>
              {pending && <Loader2 size={14} className="animate-spin" />}
              {tab === 'in' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
          <p className="text-[11px] text-txt-dim mt-3 text-center">
            Your vault is private: every record is row-secured to your account.
          </p>
          <Button
            variant="ghost"
            className="w-full mt-1 text-xs"
            onClick={() => void continueDemo()}
          >
            Explore in demo mode →
          </Button>
        </Card>
      </div>
    </div>
  );
}
