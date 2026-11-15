import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCREENSHOTS_DIR = join(process.cwd(), 'docs', 'screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPort(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}`);
      if (res.ok || res.status < 500) return true;
    } catch {
      // not ready yet
    }
    await sleep(300);
  }
  throw new Error(`Port ${port} did not become available in ${timeoutMs}ms`);
}

async function runCdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (err) {
        // ignore other messages
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  try {
    execSync('pkill -f "vite preview" || true');
    execSync('pkill -f "remote-debugging-port=9222" || true');
  } catch {}
  await sleep(1000);

  console.log('Starting preview server on port 4173...');
  const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'pipe' });
  await waitForPort(4173);
  console.log('Preview server ready.');

  console.log('Launching Headless Chrome on port 9222...');
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--window-size=1440,900',
      '--hide-scrollbars',
      '--user-data-dir=/tmp/vf_chrome_ss_' + Date.now(),
      'http://127.0.0.1:4173',
    ],
    { stdio: 'pipe' }
  );

  await waitForPort(9222, 15000);
  console.log('Chrome remote debugging ready.');

  const targetRes = await fetch('http://127.0.0.1:9222/json');
  const targets = await targetRes.json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error('No page WebSocket URL found from Chrome');
  }

  console.log('Connecting to Chrome CDP...');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));

  await runCdpCommand(ws, 'Page.enable');
  await runCdpCommand(ws, 'Runtime.enable');
  await runCdpCommand(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2, // Retina 2x high resolution
    mobile: false,
  });

  // Seed user vault
  console.log('Seeding portfolio in browser session...');
  const seedRes = await runCdpCommand(ws, 'Runtime.evaluate', {
    expression: `(async () => {
      while (!window.useData) await new Promise(r => setTimeout(r, 100));
      const s = window.useData.getState();
      if (s.mode === 'onboarding') {
        await s.createProfile({
          username: 'investor',
          displayName: 'Private Wealth Vault',
          password: 'Password123!',
          pin: '123456',
          currency: 'LKR',
        });
      } else if (s.mode === 'locked') {
        await s.unlockWithPin('123456');
      }
      await s.loadSampleData();
      return 'Unlocked with ' + window.useData.getState().assets.length + ' assets';
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Seed status:', seedRes?.result?.value);

  await sleep(2000);

  const targetsToCapture = [
    { path: '/', file: 'overview-dashboard.png', wait: 2000 },
    { path: '/portfolio', file: 'portfolio-grid.png', wait: 1500 },
    { path: '/portfolio/demo-gold-1', file: 'asset-detail.png', wait: 1500 },
    { path: '/market-watch', file: 'market-valuations.png', wait: 1500 },
    { path: '/insights', file: 'insights.png', wait: 1500 },
    {
      path: '/intelligence',
      file: 'intelligence.png',
      wait: 2500,
      action: async () => {
        await runCdpCommand(ws, 'Runtime.evaluate', {
          expression: `(async () => {
            const btns = Array.from(document.querySelectorAll('button'));
            const getCsvBtn = btns.find(b => b.textContent && b.textContent.includes('Get Current CSV'));
            if (getCsvBtn) {
              getCsvBtn.click();
              await new Promise(r => setTimeout(r, 1200));
            }
          })()`,
          awaitPromise: true,
        });
      },
    },
    { path: '/settings', file: 'settings.png', wait: 1200 },
  ];

  for (const t of targetsToCapture) {
    console.log(`Navigating to ${t.path} for ${t.file}...`);
    await runCdpCommand(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        window.history.pushState({}, '', '${t.path}');
        window.dispatchEvent(new PopStateEvent('popstate'));
        if (window.useData && window.useData.getState().mode === 'locked') {
          await window.useData.getState().unlockWithPin('123456');
        }
      })()`,
      awaitPromise: true,
    });
    await sleep(t.wait);

    if (t.action) {
      await t.action();
      await sleep(1200);
    }

    const { data } = await runCdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(data, 'base64');
    const outPath = join(SCREENSHOTS_DIR, t.file);
    writeFileSync(outPath, buffer);
    console.log(`✓ Saved ${t.file} (${(buffer.length / 1024).toFixed(0)} KB)`);
  }

  // Mobile screenshots
  console.log('Configuring mobile viewport...');
  await runCdpCommand(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  console.log('Navigating to mobile overview...');
  await runCdpCommand(ws, 'Runtime.evaluate', {
    expression: `window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));`,
  });
  await sleep(1500);
  const mobOverview = await runCdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCREENSHOTS_DIR, 'mobile-overview.png'), Buffer.from(mobOverview.data, 'base64'));
  console.log('✓ Saved mobile-overview.png');

  console.log('Navigating to mobile portfolio...');
  await runCdpCommand(ws, 'Runtime.evaluate', {
    expression: `window.history.pushState({}, '', '/portfolio'); window.dispatchEvent(new PopStateEvent('popstate'));`,
  });
  await sleep(1500);
  const mobNav = await runCdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SCREENSHOTS_DIR, 'mobile-navigation.png'), Buffer.from(mobNav.data, 'base64'));
  console.log('✓ Saved mobile-navigation.png');

  console.log('Closing sessions...');
  ws.close();
  chrome.kill();
  preview.kill();
  console.log('All fresh screenshots successfully captured!');
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});

