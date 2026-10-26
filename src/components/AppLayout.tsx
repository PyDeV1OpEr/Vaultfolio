import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  LayoutDashboard,
  Loader2,
  Lock,
  Menu,
  Settings as SettingsIcon,
  Shield,
  Vault,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../store/dataStore';
import { Button } from './ui';
import { statsFor } from '../lib/valuation';
import { formatMoney } from '../lib/money';

const PORTFOLIO_NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/portfolio', label: 'Assets', icon: Wallet },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
];

const SYSTEM_NAV = [
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppLayout() {
  const { mode, boot, toasts, dismissToast } = useData();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  if (mode === 'loading') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-txt-muted bg-ink-950">
        <Loader2 className="animate-spin text-accent" size={28} />
        <p className="text-sm">Opening your vault…</p>
      </div>
    );
  }
  if (mode === 'signedOut') return <Navigate to="/auth" replace state={{ from: location }} />;
  if (mode === 'locked') return <Navigate to="/unlock" replace state={{ from: location }} />;
  if (mode === 'onboarding') return <Navigate to="/onboarding" replace state={{ from: location }} />;

  return (
    <div className="min-h-screen flex bg-ink-950 text-txt">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-ink-700/80 bg-ink-900/60 backdrop-blur fixed inset-y-0 z-20">
        <SidebarContent mode={mode} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 inset-y-0 w-72 bg-ink-900 border-r border-ink-700 flex flex-col animate-fadeUp z-50">
            <button
              className="absolute top-4 right-4 p-1.5 text-txt-muted hover:text-txt rounded-lg hover:bg-ink-800"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
            <SidebarContent mode={mode} />
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 bg-ink-950/95 backdrop-blur border-b border-ink-700/80 px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 text-txt-muted hover:text-txt rounded-lg hover:bg-ink-850"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Vault size={18} className="text-accent" /> Vaultfolio
          </div>
          <NavLink to="/portfolio" className="p-2 -mr-2 text-txt-muted hover:text-txt" aria-label="Assets">
            <Wallet size={18} />
          </NavLink>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 w-full max-w-6xl mx-auto">
          <Outlet />
        </main>

        <footer className="px-4 lg:px-8 py-4 border-t border-ink-800/80 text-[11px] text-txt-dim flex flex-wrap gap-x-4 gap-y-1 justify-between max-w-6xl mx-auto w-full">
          <span>Vaultfolio · Private Physical Wealth Tracking</span>
          <span>Offline-first · Encrypted locally with AES-256-GCM</span>
        </footer>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(92vw,340px)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-fadeUp rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur bg-ink-850/95 ${
              t.kind === 'success'
                ? 'border-emerald-500/40 text-emerald-300'
                : t.kind === 'error'
                  ? 'border-rose-500/50 text-rose-300'
                  : 'border-ink-600 text-txt'
            }`}
            role="status"
          >
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-medium text-xs tracking-wide uppercase opacity-80">{t.title}</p>
                {t.body && <p className="text-xs text-txt-muted mt-0.5">{t.body}</p>}
              </div>
              <button
                onClick={() => dismissToast(t.id)}
                className="text-txt-dim hover:text-txt"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SidebarContent({ mode }: { mode: string }) {
  const { assets, market, settings, signOut, lock, profileName } = useData();
  const stats = useMemo(() => statsFor(assets, market), [assets, market]);
  const usdLkr = market?.usdLkr ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="p-5 pb-4 flex items-center gap-3 border-b border-ink-800/70">
        <span className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
          <Vault size={19} className="text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-sm leading-none tracking-tight">Vaultfolio</p>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-ink-800 text-txt-dim border border-ink-700">v1.0</span>
          </div>
          <p className="text-[10px] text-txt-dim mt-1 flex items-center gap-1">
            <Shield size={10} className="text-emerald-400" /> Local Encrypted Vault
          </p>
        </div>
      </div>

      {/* Mini Portfolio Summary */}
      <div className="px-4 py-3.5 border-b border-ink-800/70 bg-ink-950/40">
        <p className="text-[10px] uppercase tracking-wider text-txt-dim font-medium">Portfolio Value</p>
        <p className="text-base font-semibold tnum text-txt mt-0.5">
          {stats.activeCount === 0 ? (
            <span className="text-xs font-normal text-txt-dim">No assets added</span>
          ) : (
            formatMoney(stats.totalValueLkr, settings.displayCurrency, usdLkr)
          )}
        </p>
        <div className="flex items-center justify-between text-[11px] text-txt-muted mt-1">
          <span>{stats.activeCount} active asset{stats.activeCount === 1 ? '' : 's'}</span>
          {stats.gainLkr !== 0 && (
            <span className={stats.gainLkr >= 0 ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>
              {stats.gainLkr >= 0 ? '+' : ''}{formatMoney(stats.gainLkr, settings.displayCurrency, usdLkr)}
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 px-3 py-4 overflow-y-auto space-y-5" aria-label="Primary navigation">
        <div>
          <p className="px-3 text-[10px] uppercase tracking-wider text-txt-dim font-semibold mb-1.5">
            Portfolio
          </p>
          <nav className="flex flex-col gap-1">
            {PORTFOLIO_NAV.map((n) => {
              const Icon = n.icon;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                      isActive
                        ? 'bg-accent/15 text-accent font-medium border border-accent/25 shadow-sm'
                        : 'text-txt-muted hover:text-txt hover:bg-ink-800/60'
                    }`
                  }
                >
                  <Icon size={16} />
                  <span>{n.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div>
          <p className="px-3 text-[10px] uppercase tracking-wider text-txt-dim font-semibold mb-1.5">
            Preferences
          </p>
          <nav className="flex flex-col gap-1">
            {SYSTEM_NAV.map((n) => {
              const Icon = n.icon;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                      isActive
                        ? 'bg-accent/15 text-accent font-medium border border-accent/25 shadow-sm'
                        : 'text-txt-muted hover:text-txt hover:bg-ink-800/60'
                    }`
                  }
                >
                  <Icon size={16} />
                  <span>{n.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>

      {/* User / Lock footer */}
      <div className="p-3 border-t border-ink-800/80 bg-ink-950/30">
        <div className="rounded-lg border border-ink-700/80 bg-ink-900/80 p-2.5 text-[11px]">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-txt truncate max-w-[120px]">
              {settings.ownerName || profileName || 'Vault Owner'}
            </span>
            <span className="text-[10px] text-emerald-400 font-mono">AES-256</span>
          </div>
          <p className="text-[10px] text-txt-dim">Decrypted in-memory only</p>
        </div>
        {mode === 'local' && (
          <Button variant="ghost" className="w-full mt-2 text-xs py-1.5" onClick={() => lock()}>
            <Lock size={12} className="mr-1.5" /> Lock vault
          </Button>
        )}
        {mode === 'cloud' && (
          <Button variant="ghost" className="w-full mt-2 text-xs py-1.5" onClick={() => void signOut()}>
            Sign out
          </Button>
        )}
      </div>
    </div>
  );
}
