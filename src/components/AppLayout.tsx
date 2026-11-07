import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BrainCircuit,
  Sparkles,
  ChartCandlestick,
  ChartNoAxesCombined,
  CheckCircle2,
  FileText,
  Files,
  Info,
  LayoutDashboard,
  Loader2,
  Lock,
  Menu,
  Plus,
  Search,
  Settings as SettingsIcon,
  Shield,
  Vault,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../store/dataStore';
import { Button, IconButton } from './ui';
import { statsFor } from '../lib/valuation';
import { formatMoney } from '../lib/money';

const PORTFOLIO_NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/portfolio', label: 'My Assets', icon: Wallet },
  { to: '/market-watch', label: 'Market Watch', icon: ChartCandlestick },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/insights', label: 'Insights', icon: ChartNoAxesCombined },
  { to: '/ai-insights', label: 'AI Insights', icon: Sparkles },
  { to: '/documents', label: 'Documents', icon: Files },
];

const INTELLIGENCE_NAV = [
  { to: '/intelligence', label: 'Intelligence', icon: BrainCircuit },
];

const PREFERENCES_NAV = [
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppLayout() {
  const { mode, boot, toasts, dismissToast, market, settings, profileName, lock } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  if (mode === 'loading') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-txt-muted bg-ink-950">
        <div className="w-12 h-12 rounded-2xl bg-ink-900 border border-ink-700 flex items-center justify-center shadow-elev-2">
          <Loader2 className="animate-spin text-accent" size={24} />
        </div>
        <p className="text-sm font-medium text-txt tracking-tight mt-1">Opening your vault…</p>
        <p className="text-2xs text-txt-dim">Decrypting local credentials</p>
      </div>
    );
  }
  if (mode === 'signedOut') return <Navigate to="/auth" replace state={{ from: location }} />;
  if (mode === 'locked') return <Navigate to="/unlock" replace state={{ from: location }} />;
  if (mode === 'onboarding') return <Navigate to="/onboarding" replace state={{ from: location }} />;

  return (
    <div className="min-h-screen flex bg-ink-950 text-txt selection:bg-accent/25 selection:text-white">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-ink-700 bg-ink-900 fixed inset-y-0 z-20 shadow-elev-1">
        <SidebarContent mode={mode} onNavClick={() => {}} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fadeIn"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 inset-y-0 w-72 bg-ink-900 border-r border-ink-700 flex flex-col animate-slideInLeft z-50 shadow-elev-4">
            <div className="absolute top-4 right-4 z-10">
              <IconButton
                icon={<X size={18} />}
                label="Close navigation"
                size="sm"
                onClick={() => setMobileOpen(false)}
              />
            </div>
            <SidebarContent mode={mode} onNavClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main page content */}
      <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
        {/* Desktop top header bar (Quantix style) */}
        <header className="hidden lg:flex sticky top-0 z-10 bg-ink-950/85 backdrop-blur-md border-b border-ink-700 px-6 lg:px-8 h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 max-w-sm">
            <div className="relative w-full">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-txt-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search assets, valuations…"
                onClick={() => navigate('/portfolio')}
                readOnly
                className="w-full bg-ink-900 border border-ink-700 hover:border-ink-650 rounded-full pl-9 pr-4 py-1.5 text-xs text-txt placeholder:text-txt-dim focus:outline-none focus:border-accent cursor-pointer transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Real-time metal reference tickers */}
            <div className="hidden xl:flex items-center gap-2 text-2xs font-mono">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-900 border border-ink-700 text-txt-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>Gold</span>
                <span className="text-txt font-medium">{market?.goldPerGramLkr ? `LKR ${Math.round(market.goldPerGramLkr).toLocaleString()}/g` : 'XAU'}</span>
                <span className="text-positive text-[10px] font-semibold">+0.6%</span>
              </span>
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-900 border border-ink-700 text-txt-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                <span>Silver</span>
                <span className="text-txt font-medium">{market?.silverPerGramLkr ? `LKR ${Math.round(market.silverPerGramLkr).toLocaleString()}/g` : 'XAG'}</span>
                <span className="text-positive text-[10px] font-semibold">+1.2%</span>
              </span>
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/add')}
              className="rounded-full shadow-btn-primary"
            >
              <Plus size={14} /> Add Asset
            </Button>

            <button
              onClick={() => lock()}
              className="w-8 h-8 rounded-full bg-ink-900 border border-ink-700 hover:border-ink-650 flex items-center justify-center text-txt-muted hover:text-accent transition-colors"
              title="Lock Vault"
            >
              <Lock size={13} />
            </button>

            <div className="flex items-center gap-2 pl-2 border-l border-ink-700/60">
              <div className="w-7 h-7 rounded-full bg-accent/20 border border-accent/40 text-accent font-semibold text-xs flex items-center justify-center">
                {(settings.ownerName || profileName || 'V').slice(0, 1).toUpperCase()}
              </div>
              <span className="text-xs font-medium text-txt truncate max-w-[100px]">
                {settings.ownerName || profileName || 'Owner'}
              </span>
            </div>
          </div>
        </header>

        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 bg-ink-950/90 backdrop-blur-md border-b border-ink-700 px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 text-txt-muted hover:text-txt rounded-lg hover:bg-ink-850 transition-colors"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-txt">
            <span className="w-7 h-7 rounded-lg bg-accent/20 border border-accent/35 flex items-center justify-center text-accent">
              <Vault size={15} />
            </span>
            Vaultfolio
          </div>
          <NavLink
            to="/add"
            className="p-2 -mr-2 text-accent hover:text-accent-hover rounded-lg hover:bg-ink-850 transition-colors"
            aria-label="Add Asset"
          >
            <Plus size={20} />
          </NavLink>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 w-full max-w-6xl mx-auto">
          {/* Keyed by route so each navigation replays the fade-up entrance;
              honours prefers-reduced-motion via the global media query. */}
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-[70] flex flex-col gap-2.5 w-[min(92vw,360px)] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`
              pointer-events-auto animate-fadeUp rounded-xl border p-3.5 shadow-elev-3 backdrop-blur-md bg-ink-850/95
              flex items-start gap-3 transition-all duration-150
              ${
                t.kind === 'success'
                  ? 'border-emerald-500/35 text-emerald-300'
                  : t.kind === 'error'
                  ? 'border-rose-500/40 text-rose-300'
                  : 'border-ink-650 text-txt'
              }
            `}
            role="status"
          >
            <span className="shrink-0 mt-0.5">
              {t.kind === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-400" />
              ) : t.kind === 'error' ? (
                <AlertCircle size={16} className="text-rose-400" />
              ) : (
                <Info size={16} className="text-accent" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold leading-tight text-txt">{t.title}</p>
              {t.body && (
                <p className="text-2xs text-txt-muted mt-0.5 leading-relaxed">{t.body}</p>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-txt-dim hover:text-txt p-0.5 rounded transition-colors"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SidebarContent({ mode, onNavClick }: { mode: string; onNavClick: () => void }) {
  const { assets, market, settings, signOut, lock, profileName } = useData();
  const navigate = useNavigate();
  const stats = useMemo(() => statsFor(assets, market), [assets, market]);
  const usdLkr = market?.usdLkr ?? null;

  return (
    <div className="flex flex-col h-full select-none">
      {/* Brand Header */}
      <div className="p-4 sm:p-5 pb-4 flex items-center gap-3 border-b border-ink-700">
        <span className="w-9 h-9 rounded-xl bg-ink-800 border border-ink-650 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(169,155,255,0.15)]">
          <Vault size={17} className="text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm tracking-tight text-txt">Vaultfolio</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink-800 text-txt-dim border border-ink-700">
              v1.2.0
            </span>
          </div>
          <p className="text-2xs text-txt-dim mt-0.5 flex items-center gap-1">
            <Shield size={10} className="text-accent" />
            <span>Encrypted Local Vault</span>
          </p>
        </div>
      </div>

      {/* Mini Portfolio Summary Card (Quantix style) */}
      <div className="p-3.5 mx-3 my-3 rounded-2xl border border-accent/25 bg-gradient-to-br from-[#1E1938] via-[#141522] to-[#0E0F16] shadow-card-purple">
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs font-medium uppercase tracking-wider text-txt-muted">
            Total Estimated
          </span>
          <span className="text-[10px] font-mono text-txt-dim">
            {stats.activeCount} asset{stats.activeCount === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-base font-bold tnum text-txt value-display truncate">
          {stats.activeCount === 0 ? (
            <span className="text-xs font-normal text-txt-dim">0 Assets</span>
          ) : (
            formatMoney(stats.totalValueLkr, settings.displayCurrency, usdLkr)
          )}
        </p>
        {stats.gainLkr !== 0 && (
          <div className="mt-1 flex items-center gap-1.5 text-2xs">
            <span
              className={`font-semibold px-1.5 py-0.2 rounded-full tnum text-[10px] ${
                stats.gainLkr >= 0 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {stats.gainLkr >= 0 ? '+' : ''}
              {formatMoney(stats.gainLkr, settings.displayCurrency, usdLkr)}
            </span>
            <span className="text-txt-dim">est. gain</span>
          </div>
        )}

        <Button
          variant="primary"
          size="sm"
          className="w-full mt-3 text-xs rounded-xl shadow-btn-primary"
          onClick={() => {
            onNavClick();
            navigate('/add');
          }}
        >
          <Plus size={14} /> Add Asset
        </Button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 px-3 py-1 overflow-y-auto space-y-3" aria-label="Primary navigation">
        <div>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-txt-dim mb-1">
            Portfolio
          </p>
          <nav className="flex flex-col gap-0.5">
            {PORTFOLIO_NAV.map((n) => {
              const Icon = n.icon;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  onClick={onNavClick}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-[#7047EB]/20 text-txt border border-accent/35 shadow-[0_0_15px_rgba(169,155,255,0.12)]'
                        : 'text-txt-muted hover:text-txt hover:bg-ink-800/60'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={16} className={`shrink-0 transition-colors ${isActive ? 'text-accent' : 'text-txt-muted group-hover:text-accent'}`} />
                      <span className="truncate">{n.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="border-t border-ink-700/60 my-2 mx-2" />

        <div>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-txt-dim mb-1">
            Intelligence
          </p>
          <nav className="flex flex-col gap-0.5">
            {INTELLIGENCE_NAV.map((n) => {
              const Icon = n.icon;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={onNavClick}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-[#7047EB]/20 text-txt border border-accent/35 shadow-[0_0_15px_rgba(169,155,255,0.12)]'
                        : 'text-txt-muted hover:text-txt hover:bg-ink-800/60'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={16} className={`shrink-0 transition-colors ${isActive ? 'text-accent' : 'text-txt-muted group-hover:text-accent'}`} />
                      <span className="truncate">{n.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="border-t border-ink-700/60 my-2 mx-2" />

        <div>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-txt-dim mb-1">
            Preferences
          </p>
          <nav className="flex flex-col gap-0.5">
            {PREFERENCES_NAV.map((n) => {
              const Icon = n.icon;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={onNavClick}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-[#7047EB]/20 text-txt border border-accent/35 shadow-[0_0_15px_rgba(169,155,255,0.12)]'
                        : 'text-txt-muted hover:text-txt hover:bg-ink-800/60'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={16} className={`shrink-0 transition-colors ${isActive ? 'text-accent' : 'text-txt-muted group-hover:text-accent'}`} />
                      <span className="truncate">{n.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Vault Security / Account Footer */}
      <div className="p-3 border-t border-ink-700 bg-ink-950/40">
        <div className="rounded-xl border border-ink-700 bg-ink-900/90 p-2.5 text-xs">
          <div className="flex items-center justify-between mb-0.5">
            <span className="font-medium text-txt truncate max-w-[130px]">
              {settings.ownerName || profileName || 'Vault Owner'}
            </span>
            <span className="text-[10px] text-accent font-mono font-semibold">AES-GCM</span>
          </div>
          <p className="text-2xs text-txt-dim">Decrypted in-memory only</p>
        </div>
        {mode === 'local' && (
          <Button
            variant="ghost"
            size="xs"
            className="w-full mt-2 text-2xs text-txt-muted hover:text-txt rounded-lg"
            onClick={() => lock()}
          >
            <Lock size={12} className="mr-1.5 text-txt-dim" /> Lock vault
          </Button>
        )}
        {mode === 'cloud' && (
          <Button
            variant="ghost"
            size="xs"
            className="w-full mt-2 text-2xs text-txt-muted hover:text-txt rounded-lg"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        )}
      </div>
    </div>
  );
}
