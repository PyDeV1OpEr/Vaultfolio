import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { Overview } from './pages/Overview';
import { Portfolio } from './pages/Portfolio';
import { AddAsset } from './pages/AddAsset';
import { AssetDetail } from './pages/AssetDetail';
import { MarketPage } from './pages/Market';
import { Insights } from './pages/Insights';
import { Settings } from './pages/Settings';
import { AuthScreen } from './pages/Auth';
import { OnboardingScreen } from './pages/Onboarding';
import { UnlockScreen } from './pages/Unlock';
import { useData as useStore } from './store/dataStore';
import { EmptyState } from './components/ui';
import { Link } from 'react-router-dom';

import { Navigate } from 'react-router-dom';

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

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
    <Routes>
      <Route path="/auth" element={<AuthScreen />} />
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route path="/unlock" element={<UnlockScreen />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/portfolio/:assetId" element={<AssetDetail />} />
        <Route path="/add" element={<AddAsset />} />
        <Route path="/market" element={<Navigate to="/portfolio" replace />} />
        <Route path="/insights" element={<Insights />} />
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
  );
}
