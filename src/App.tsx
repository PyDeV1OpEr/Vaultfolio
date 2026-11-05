import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Route, Routes, Link as RouterLink } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from './components/ui';
import { AppLayout } from './components/AppLayout';
import { Overview } from './pages/Overview';
import { Portfolio } from './pages/Portfolio';
import { AddAsset } from './pages/AddAsset';
import { AssetDetail } from './pages/AssetDetail';
import { MarketPage } from './pages/Market';
import { MarketWatchPage } from './pages/MarketWatch';
import { Insights } from './pages/Insights';
import { AiInsights } from './pages/AiInsights';
import { ReportsScreen } from './pages/Reports';
import { Documents } from './pages/Documents';
import { Settings } from './pages/Settings';
import { AuthScreen } from './pages/Auth';
import { OnboardingScreen } from './pages/Onboarding';
import { UnlockScreen } from './pages/Unlock';
import { useData as useStore } from './store/dataStore';
import { EmptyState } from './components/ui';
import { Link } from 'react-router-dom';

import { Navigate } from 'react-router-dom';
import { Intelligence } from './pages/Intelligence/Workspace';
import { IntelImport, IntelDatasets, IntelDatasetDetail, IntelSamples } from './pages/Intelligence/Datasets';
import { IntelTrain } from './pages/Intelligence/Train';
import { IntelModels, IntelModelDetail } from './pages/Intelligence/Models';
import { IntelPredict } from './pages/Intelligence/Predict';
import { IntelHistory } from './pages/Intelligence/History';
import { IntelDocs } from './pages/Intelligence/Docs';

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Production error boundary. Without this, any render crash unmounts the
 * whole React tree and leaves the packaged app staring at an empty window —
 * the exact "opens to a completely blank screen" release defect. Instead, the
 * user gets an honest explanation, a Retry action and diagnosable detail.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console keeps it debuggable under devtools; the UI keeps it humane.
    console.error('[Vaultfolio] startup/render failure:', error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
    // Full reload re-runs boot() so the app initialises from a clean state.
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen bg-ink-950 text-txt flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-4 text-rose-400">
            <AlertTriangle size={24} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Vaultfolio hit an unexpected error</h1>
          <p className="text-sm text-txt-muted mt-2">
            Your data is safe — it stays encrypted on this device. The app hit a
            problem while rendering this screen.
          </p>
          <Button variant="primary" className="mt-5" onClick={this.retry}>
            Retry
          </Button>
          <details className="mt-6 text-left">
            <summary className="text-xs text-txt-dim cursor-pointer select-none">
              Show diagnostic information
            </summary>
            <pre className="mt-2 text-2xs leading-5 text-txt-dim bg-ink-900 border border-ink-700 rounded-xl p-3 overflow-auto max-h-56 whitespace-pre-wrap break-words">
              {error.message}
              {typeof window !== 'undefined'
                ? `\nroute: ${window.location.pathname}\nbuild: ${import.meta.env.VITE_APP_VERSION ?? 'dev'}`
                : ''}
            </pre>
          </details>
          <RouterLink to="/" className="inline-block mt-4 text-xs text-txt-muted hover:text-txt underline underline-offset-2">
            Back to the vault
          </RouterLink>
        </div>
      </div>
    );
  }
}

export default function App() {
  const boot = useStore((s) => s.boot);
  const mode = useStore((s) => s.mode);
  const lock = useStore((s) => s.lock);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Inactivity auto-lock: locks vault after 15 minutes of inactivity in local mode
  useEffect(() => {
    if (mode !== 'local') return;
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        lock();
      }, INACTIVITY_TIMEOUT_MS);
    };

    resetTimer();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [mode, lock]);

  return (
    <ErrorBoundary>
      <Routes>
      <Route path="/auth" element={<AuthScreen />} />
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route path="/unlock" element={<UnlockScreen />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/portfolio/:assetId" element={<AssetDetail />} />
        <Route path="/add" element={<AddAsset />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/market-watch" element={<MarketWatchPage />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/ai-insights" element={<AiInsights />} />
        <Route path="/reports" element={<ReportsScreen />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/intelligence" element={<Intelligence />} />
        <Route path="/intelligence/import" element={<IntelImport />} />
        <Route path="/intelligence/datasets" element={<IntelDatasets />} />
        <Route path="/intelligence/datasets/:id" element={<IntelDatasetDetail />} />
        <Route path="/intelligence/samples" element={<IntelSamples />} />
        <Route path="/intelligence/train" element={<IntelTrain />} />
        <Route path="/intelligence/models" element={<IntelModels />} />
        <Route path="/intelligence/models/:id" element={<IntelModelDetail />} />
        <Route path="/intelligence/predict" element={<IntelPredict />} />
        <Route path="/intelligence/history" element={<IntelHistory />} />
        <Route path="/intelligence/docs/*" element={<IntelDocs />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <EmptyState
              icon={<span className="text-2xl">404</span>}
              title="Page not found"
              body="That page doesn’t exist. Head back to your vault."
              action={
                <Link to="/" className="text-accent underline underline-offset-2 text-sm">
                  Overview
                </Link>
              }
            />
          }
        />
      </Route>
      </Routes>
    </ErrorBoundary>
  );
}
