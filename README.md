# Vaultfolio

**A private, physical-asset wealth tracker — record, value, and understand what you actually own.**

Vaultfolio is a personal wealth-tracking web and desktop application (wrapped into native desktop apps with Tauri v2) for tracking physical wealth: **precious metals (gold, silver, copper, platinum, palladium), gemstones & jewelry, luxury watches, land & property (with Sri Lankan perches), cars, motorcycles, and other physical assets**. It organizes each asset's physical attributes, records honest manual valuations with an explicit methodology, and rolls everything up into a portfolio overview with deep analytics and historical snapshots.

> Values are your own verified estimates — **never fabricated market quotes, synthetic appraisals, or financial advice.** Vaultfolio is strictly offline-first with zero demo wealth.

```sh
# quickstart (web, local — no account or keys needed)
git clone https://github.com/PyDeV1OpEr/Vaultfolio.git
cd Vaultfolio
npm ci
npm run dev            # → http://localhost:5173 — create your private vault
```

<p align="center">
  <img src="docs/screenshots/overview-dashboard.png" alt="Vaultfolio overview dashboard" width="760" />
</p>
*Overview dashboard: truthful portfolio totals, invested cost, unrealized gain/loss, and compact category distribution.*

## 🖥 Download Vaultfolio

Vaultfolio runs unchanged in any modern browser — the desktop apps are a native Tauri v2 wrapper around the same secure build:

| Platform | Package | Arch | Download |
|---|---|---|---|
| macOS | `.dmg` | Apple Silicon | [Releases → latest](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest) |
| macOS | `.dmg` | Intel | [Releases → latest](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest) |
| Windows | `.exe` setup installer | x64 | [Releases → latest](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest) |

Installing from a `.dmg`: open the file and drag **Vaultfolio.app** into `Applications`. Installing from the `.exe`: download, run the setup, and follow the NSIS wizard.

> **Release builds & installers**: The release workflow (`.github/workflows/release.yml`) builds and publishes native packages on every `v*` tag. Apple Silicon `.dmg` has been built and verified locally (`Vaultfolio_1.0.0_aarch64.dmg`, 2.8 MB).

### Unsigned-build security warnings

Release installers are currently **unsigned** (no Apple Developer ID / Windows Authenticode certificate configured). That is standard for open-source releases:

* **macOS**: on first launch, right-click the app and choose **Open** → **Open** to confirm. `xattr -cr /Applications/Vaultfolio.app` clears Gatekeeper for your local installation.
* **Windows**: Microsoft Defender SmartScreen will show "Windows protected your PC" — click **More info** → **Run anyway**.

## ✨ Features

| Area | Feature | Status |
|---|---|---|
| Assets | Create, edit, search, filter, sort, and delete assets across 7 physical categories | ✅ Implemented |
| Assets | Physical categories: Precious Metals (gold, silver, copper, platinum, palladium), Gems & Jewelry, Luxury Watches, Land & Property (perches), Cars & Motorcycles, Other | ✅ Implemented |
| Assets | Category-specific fields (karat/fineness, weight, quantity, perches, mileage, VIN, valuation date) | ✅ Implemented |
| Assets | Sold / restore-from-sold lifecycle with sale proceeds and realized gain | ✅ Implemented |
| Valuation | Honest manual-first valuation engine — zero fake wealth, zero synthetic demo prices | ✅ Implemented |
| Valuation | Truthful gain/loss and return % calculated strictly from assets with both purchase price and current valuation | ✅ Implemented |
| Valuation | User-entered valuations are authoritative and never auto-overwritten | ✅ Implemented |
| Valuation | Append-only valuation history per asset with valuation date tracking | ✅ Implemented |
| Insights | **Category Value Bar Chart**: distribution across physical categories | ✅ Implemented |
| Insights | **Portfolio Allocation Donut**: percentage breakdown by category | ✅ Implemented |
| Insights | **Top Holdings Horizontal Bar Chart**: highest-value physical holdings | ✅ Implemented |
| Insights | **Cost vs Value Grouped Comparison**: invested cost vs current valuation | ✅ Implemented |
| Insights | **Valuation History Timeline**: net portfolio value over time from genuine snapshots | ✅ Implemented |
| Insights | **Concentration Risk & Resale Analysis**: portfolio risk callouts & fine metal liquidation estimates | ✅ Implemented |
| Data | CSV + JSON export of your records from Settings | ✅ Implemented |
| Data | **Backup & restore**: versioned portable manifest, optional AES-256-GCM + scrypt encryption, integrity validation, and explicit confirmation modal before restore | ✅ Implemented |
| Security | **Offline-first local vault**: portfolio encrypted at rest (AES-256-GCM), password-only unlock | ✅ Implemented |
| Security | **6-digit PIN unlock**: required at launch, window lock, and 15-minute inactivity auto-lock | ✅ Implemented |
| Security | Persisted brute-force prevention — 5 wrong PIN attempts trigger a 5-minute lockout surviving app restarts | ✅ Implemented |
| Security | **In-app PIN recovery** via account username + master password verification | ✅ Implemented |
| Auth | Optional email/password sign-in via Supabase Auth | ✅ Implemented (Requires Configuration) |
| Sync | Optional cloud sync of assets + valuation records | ✅ Implemented (Requires Configuration) |
| Persistence | Offline vault stored encrypted in browser storage / Tauri WebView storage | ✅ Implemented |
| Desktop | Tauri v2 packaging for macOS (Apple Silicon + Intel) and Windows x64 | ✅ Implemented |
| Desktop signing | Apple notarization / Windows Authenticode | 🔜 Planned (needs certs) |
| Images | Asset photos to Supabase Storage | 🔜 Planned |

## 🧱 Tech stack

| Purpose | Technology |
|---|---|
| Frontend | [React 18](https://react.dev) + [TypeScript 5](https://www.typescriptlang.org) (strict) |
| Build | [Vite 5](https://vite.dev) |
| Routing | [React Router 6](https://reactrouter.com) |
| State | [Zustand 5](https://zustand.docs.pmnd.rs) |
| Styling | [Tailwind CSS 3](https://tailwindcss.com) with a custom dark-first palette |
| Charts | [Recharts 2](https://recharts.org) |
| Icons | [lucide-react](https://lucide.dev) |
| Validation | [Zod 3](https://zod.dev) |
| Testing | [Vitest 2](https://vitest.dev) (valuation, money, units) |
| Backend / DB | [Supabase](https://supabase.com) — Auth (email/password), Postgres with Row Level Security, Storage |
| Desktop | [Tauri v2](https://v2.tauri.app) wrapping the Vite build (no Electron) |
| CI/CD | GitHub Actions — build macOS + Windows installers on `v*` tags |

## 📸 More screenshots

| | |
|---|---|
| ![Portfolio](docs/screenshots/portfolio-grid.png) | ![Asset detail](docs/screenshots/asset-detail.png) |
| *My Portfolio — allocation and per-asset rows* | *Asset detail — provenance, valuation method ladder, resale view* |
| ![Market](docs/screenshots/market-valuations.png) | ![Insights](docs/screenshots/insights.png) |
| *Market & Valuations — prices, overrides, staleness labels* | *Insights — timeline and trends* |
| ![Mobile](docs/screenshots/mobile-overview.png) | ![Mobile nav](docs/screenshots/mobile-navigation.png) |
| *Mobile overview* | *Mobile navigation drawer* |

## 🚀 Getting started

### Prerequisites

* **Node.js 18+** (tested on Node 20) and **npm** — the only package manager used; `package-lock.json` is committed.
* No database, no API keys, no account needed to run Vaultfolio in demo mode.
* To enable cloud sync: a free [Supabase](https://supabase.com) project (setup below).
* To build/installers/stream desktop packages: [Rust](https://www.rust-lang.org) and platform prerequisites — see [DESKTOP.md](DESKTOP.md).

### Setup

```bash
git clone https://github.com/PyDeV1OpEr/Vaultfolio.git
cd Vaultfolio
npm ci
# optional: configure one env var for cloud sync (otherwise leave as-is)
cp .env.example .env
npm run dev
```

You're done when the app opens at **http://localhost:5173** — Vaultfolio shows its **onboarding** screen: choose a username, master password, and a 6-digit PIN. Your private, offline-first vault is created on this device. Everything you add is stored **AES-256-GCM encrypted** under that password and never leaves the machine. On any restart, lock event, or after 15 minutes of inactivity, the vault opens on the **6-digit PIN unlock screen** with rate-limiting and in-app PIN recovery.

> The master password cannot be recovered — lost password means lost vault. Export an encrypted backup (Settings → Backup & restore) for safety.

### Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server at http://localhost:5173 |
| `npm run build` | Production build (strict `tsc` typecheck + Vite bundle → `dist/`) |
| `npm run test` | Run the unit test suite (Vitest) |
| `npm run typecheck` | Typecheck with strict TS |
| `npm run desktop:dev` | Run inside the native Tauri window (auto-reload) |
| `npm run desktop:build:macos` | Build the macOS `.app` + `.dmg` (Apple Silicon + Intel both verified) |
| `npm run desktop:build:windows` | Build the Windows NSIS `.exe` (verified path: CI; local requires a Windows machine or CI, not macOS) |

### Cloud sync (optional)

1. Create a project on [supabase.com](https://supabase.com) and keep it to a single region.
2. Enable **Auth → email/password** and allow sign-ups.
3. Run `supabase/schema.sql` (in this repo) in the SQL editor — creates the 4 `vaultfolio_*` tables with Row-Level Security.
4. Create a **public** storage bucket named **`asset-files`** in Storage.
5. Copy **Settings → API** URL and anon key into a `.env`:

    ```sh
    VITE_SUPABASE_URL=https://<project>.supabase.co
    VITE_SUPABASE_ANON_KEY=<anon-key>
    ```

6. Restart `npm run dev` — the onboarding screen now offers **“Sign in with Supabase instead”**; sign in with email + password and everything else works identically. Cloud mode and an offline local vault can coexist on the same device; cloud sign-in is remembered across restarts.

The **anon key is public by design** — it appears inside the bundled app and it's safe. Row-Level Security on the database is the real perimeter, confining each account to its own rows.

### Market-data provider (optional)

Without `VITE_METALS_API_URL` the chart reverts to an clearly labelled demo dataset. To wire up live prices, expose an endpoint (e.g. a serverless function) returning:

```json
{ "goldPerGramLkr": 32000, "silverPerGramLkr": 42, "usdLkr": 300, "asOf": "2026-03-01T09:00:00Z" }
```

and set `VITE_METALS_API_URL` (+ optional `VITE_METALS_API_LABEL` for the display name). Never embed a provider API key in the URL — it travels to every client. The project ships intentionally without a secrets backend; a future iteration adds a serverless price proxy.

## 🗂 Codebase structure

```
src/
├── lib/            # domain logic — no React, fully unit-testable
│   ├── types.ts        # domain model (Asset, ValuationMethod, category attrs)
│   ├── valuation.ts    # transparent valuation engine + portfolio math
│   ├── units.ts        # weight/purity/currency unit conversions
│   ├── money.ts        # LKR/USD formatting, currency facts
│   ├── market.ts       # market-data service: demo + HTTP provider, cache, overrides
│   ├── crypto.ts       # scrypt KEKs, AES-256-GCM AEAD, password verifiers (@noble)
│   ├── profile.ts      # local profile: DEK wraps, PIN lifecycle, attempt counters
│   ├── storage.ts      # adapters: EncryptedLocalAdapter + SupabaseAdapter
│   ├── backup.ts       # versioned backup manifest (optional passphrase encryption)
│   ├── demo.ts         # sample portfolio (dev-only seeding)
│   └── supabase.ts     # optional Supabase client (mode-less, lazy)
├── store/
│   └── dataStore.ts    # Zustand store: boot → onboarding/locked/unlocked, CRUD, toasts
├── components/       # presentational + layout components, shared UI
├── pages/            # route screens (Onboarding, Unlock, Overview, Portfolio, Market,
│                     #   Insights, Settings, Auth)
├── *.test.ts         # unit tests (crypto, profile, backup, valuation, money, units)
├── App.tsx           # router + boot + providers
└── main.tsx          # entry
supabase/
└── schema.sql        # live schema (tables + RLS), extracted from the real project
docs/
├── ARCHITECTURE.md   # system + data flow, security, choices
└── screenshots/      # genuine screenshots of the running app
.github/
└── workflows/
    └── release.yml   # tag-triggered macOS + Windows installer builds
src-tauri/           # Tauri v2 shell (config, icons, Rust entrypoint)
```

**Where to look to change things:** adding an asset category → `src/lib/types.ts` + `AddAsset` + `dataStore`; changing valuation math → `src/lib/valuation.ts` (pure functions, tested); changing market data → `src/lib/market.ts`; **vault/security behavior → `src/lib/profile.ts` + `src/lib/crypto.ts` (tested)**; **backup format → `src/lib/backup.ts` (tested)**; persisting new fields → `src/lib/storage.ts` + `supabase/schema.sql`; new screens → `src/pages` + router in `App.tsx`; desktop builds → `src-tauri`.

## 📈 Frequently asked questions

**Is Vaultfolio free?** Yes, and the code is open source (MIT).

**Does the app run offline?** Yes — the offline-first local vault needs no network at all (no account, no keys, no prices feed). Cloud sync obviously needs a connection. Live prices need a connection as well.

**Where is my data?** Offline mode: encrypted inside your browser's/local app's storage (localStorage in web; the Tauri WebView profile on desktop), keyed to this device only. Cloud: your own Supabase project under Supabase's policies, scoped per account by RLS. Vaultfolio ships no analytics, no cookies, no third-party trackers.

**Is my financial data private?** In offline mode the vault is AES-256-GCM encrypted at rest and only decrypts with your master password or device PIN — the app holds no keys at rest. Cloud mode works against your own Supabase project; the app talks directly to Supabase (auth URL + anon key are compiled into the client). Encrypted backups are not readable without their passphrase.

**Can I use it as a day-trader tool?** No — Vaultfolio is explicitly a wealth-organising and valuation-honesty tool for long-held assets; it is not a market-timing, trading, or financial-ad vise platform.

## 🔒 Security & privacy

* **Offline-first vault**: your portfolio is AES-256-GCM encrypted at rest with a random 256-bit key (DEK). The DEK is never stored in plaintext: it is wrapped under an scrypt-derived master-password key and (optionally) a separately-wrapped PIN key — so changing the password re-wraps only the key, not the data. Passwords/PINs are stored only as salted scrypt verifiers. Failed-attempt counters persist across restarts. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).
* **Encrypted backups** (`Settings → Backup & restore`) are ciphertext-bound to their passphrase; unencrypted backups are portable JSON for your own storage.
* **Cloud perimeter**: Supabase Auth (email/password) + Postgres **Row Level Security** — every table policy reads `auth.uid() = user_id`, so a user can only ever touch their own rows. Extracted schema in [`supabase/schema.sql`](supabase/schema.sql).
* **Secrets**: the Supabase anon key is a *public* client-side key. There are no Vaultfolio-held secrets, no telemetry, and the `VITE_*` variables are plain client-side configuration.
* **Reporting**: see [SECURITY.md](SECURITY.md) — please don't report a suspected credential leak by opening a public issue.
* **Honest limits**: the local vault protects against casual data-at-rest snooping on an unattended machine — not against malware running as your user or an attacker with disk-forensics tooling; there is no end-to-end encryption in cloud mode, no audit log — see the limitations in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 🧪 Testing & quality

```bash
npm run typecheck   # strict TypeScript, no loose any
npm run test        # 40 unit tests (crypto, profile/PIN, backups, valuation math, money, units)
npm run build       # production build must typecheck first (tsc && vite build)
```

CI runs typecheck, unit tests, and builds the web bundle on every PR (`.github/workflows/ci.yml`), with extra per-platform installers on `v*` tags (`.github/workflows/release.yml`). PRs must pass all checks before merge; the valuation domain is intentionally protected by pure-function unit tests.

## 🤝 Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) — covers setup, conventions, and what a good PR looks like. In brief: TypeScript strict, `npm run typecheck && npm run test` must pass, keep components small, and don't add dependencies without a reason.

## 📄 License

[MIT](LICENSE) © 2026 Mohammed Unais
