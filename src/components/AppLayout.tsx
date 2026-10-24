import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Coins,
  Info,
  LayoutDashboard,
  Loader2,
  Menu,
  Settings,
  Vault,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useData } from '../store/dataStore';
import { Button } from './ui';
import { DEMO_MARKET } from '../lib/market';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/portfolio', label: 'My Portfolio', icon: Wallet },
  { to: '/market', label: 'Market & Valuations', icon: Coins },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  const { mode, boot, market, toasts, dismissToast } = useData();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  if (mode === 'loading') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-txt-muted">
        <Loader2 className="animate-spin" size={28} />
        <p className="text-sm">Opening your vault…</p>
      </div>
    );
  }
  if (mode === 'signedOut') return <Navigate to="/auth" replace state={{ from: location }} />;

  const isDemo = market?.isDemo ?? mode === 'demo';

  return (
    <div className="min-h-screen flex bg-ink-950">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-ink-700 bg-ink-900/50 fixed inset-y-0">
        <SidebarContent mode={mode} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 inset-y-0 w-64 bg-ink-900 border-r border-ink-700 flex flex-col animate-fadeUp">
            <button
              className="absolute top-3 right-3 p-1.5 text-txt-muted hover:text-txt"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
            <SidebarContent mode={mode} />
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-60 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 bg-ink-950/90 backdrop-blur border-b border-ink-700 px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 text-txt-muted hover:text-txt"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Vault size={17} className="text-accent" /> Vaultfolio
          </div>
          <NavLink to="/portfolio" className="p-2 -mr-2 text-txt-muted hover:text-txt" aria-label="Portfolio">
            <Wallet size={18} />
          </NavLink>
        </header>

        {/* Demo banner */}
        {isDemo && (
          <div className="flex items-center gap-2 px-4 lg:px-8 py-2 bg-violet-500/10 border-b border-violet-500/20 text-[12px] text-violet-200">
            <Info size={13} className="shrink-0" />
            <span>
              <strong>Demo mode</strong> — sample data &amp; placeholder prices, stored only in this
              browser. Not live market or portfolio data.
            </span>
            <NavLink to="/market" className="underline underline-offset-2 hover:text-violet-100 shrink-0">
              Review pricing
            </NavLink>
          </div>
        )}

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 w-full max-w-6xl mx-auto">
          <Outlet />
        </main>

        <footer className="px-4 lg:px-8 py-4 border-t border-ink-800 text-[11px] text-txt-dim flex flex-wrap gap-x-4 gap-y-1 justify-between max-w-6xl mx-auto w-full">
          <span>Vaultfolio · private physical-asset tracking</span>
          <span>
            Values are owner estimates and transparent calculations — not appraisals or dealer
            quotes.
          </span>
        </footer>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(92vw,340px)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-fadeUp rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur bg-ink-850/95 ${
              t.kind === 'success'
                ? 'border-emerald-500/30'
                : t.kind === 'error'
                  ? 'border-rose-500/40'
                  : 'border-ink-600'
            }`}
            role="status"
          >
            <div className="flex justify-between gap-3">
              <div>
                <p
                  className={`font-medium ${
                    t.kind === 'success'
                      ? 'text-emerald-400'
                      : t.kind === 'error'
                        ? 'text-rose-400'
                        : 'text-txt'
                  }`}
                >
                  {t.title}
                </p>
                {t.body && <p className="text-[12px] text-txt-muted mt-0.5">{t.body}</p>}
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
  const { settings, signOut } = useData();
  return (
    <>
      <div className="px-6 pt-6 pb-2 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center">
          <Vault size={17} className="text-accent" />
        </span>
        <div>
          <p className="font-semibold text-[15px] leading-none">Vaultfolio</p>
          <p className="text-[10px] text-txt-dim mt-1 uppercase tracking-wider">Private vault</p>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1" aria-label="Primary">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-accent font-medium'
                    : 'text-txt-muted hover:text-txt hover:bg-ink-800/60'
                }`
              }
            >
              <Icon size={17} />
              {n.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="px-4 pb-5">
        {mode === 'demo' ? (
          <div className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2.5 text-[11px] text-violet-200">
            <span className="block font-medium mb-0.5">Demo data active</span>
            Sample records stored locally in this browser only.
          </div>
        ) : (
          <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-[11px] text-txt-muted">
            <span className="block font-medium text-txt mb-1 truncate">{settings.ownerName || 'Signed in'}</span>
            Cloud-synced &amp; protected by Supabase rows
          </div>
        )}
        {mode === 'cloud' && (
          <Button variant="ghost" className="w-full mt-2 text-xs" onClick={() => void signOut()}>
            Sign out
          </Button>
        )}
      </div>
    </>
  );
}

export function DemoPriceNote() {
  const { market } = useData();
  if (!market || !market.isDemo) return null;
  return (
    <div className="flex items-start gap-2 text-[11px] text-amber-400/90 mt-3">
      <Zap size={12} className="mt-0.5 shrink-0" />
      <span>
        Metal prices shown are <strong>demo placeholders</strong> ({DEMO_MARKET.sourceLabel}) — not
        live market rates. Enter real prices under Market &amp; Valuations → manual override.
      </span>
    </div>
  );
}
