# Vaultfolio

<p align="center">
  <strong>A private, offline-first physical wealth tracking platform — record, value, and understand what you actually own.</strong>
</p>

<p align="center">
  <a href="https://github.com/PyDeV1OpEr/Vaultfolio/actions/workflows/ci.yml"><img src="https://github.com/PyDeV1OpEr/Vaultfolio/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="https://github.com/PyDeV1OpEr/Vaultfolio/actions/workflows/release.yml"><img src="https://github.com/PyDeV1OpEr/Vaultfolio/actions/workflows/release.yml/badge.svg" alt="Release Workflow" /></a>
  <a href="https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest"><img src="https://img.shields.io/github/v/release/PyDeV1OpEr/Vaultfolio?color=2563eb&label=latest%20release" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/security-AES--256--GCM%20%2B%20scrypt-10b981.svg" alt="Security: AES-256-GCM" />
  <img src="https://img.shields.io/badge/architecture-offline--first-8b5cf6.svg" alt="Architecture: Offline First" />
  <img src="https://img.shields.io/badge/desktop-Tauri%20v2-f97316.svg" alt="Desktop: Tauri v2" />
</p>

---

Vaultfolio is a high-performance desktop and web application engineered specifically for tracking **tangible physical wealth**: precious metals (gold, silver, copper, platinum, palladium), gemstones & jewelry, luxury timepieces, land & property (including Sri Lankan perches), vehicles (cars, motorcycles), and custom physical assets.

Built on an **offline-first, zero-knowledge architecture**, Vaultfolio stores your sensitive financial records encrypted locally at rest with **AES-256-GCM** and **scrypt**. Your holdings never leave your device unless you explicitly configure private cloud sync.

<p align="center">
  <img src="docs/screenshots/overview-dashboard.png" alt="Vaultfolio Overview Dashboard" width="840" />
</p>
<p align="center"><em>Vaultfolio Overview: truthful portfolio metrics, asset category distribution, and recent valuation activity.</em></p>

---

## 📥 Verified Downloads

Native desktop installers are generated automatically on release tags via GitHub Actions and verified before distribution.

| Platform | Architecture | Package | File Size | Direct Download | SHA-256 Digest |
|---|---|---|---|---|---|
| **macOS** | Apple Silicon (arm64) | `.dmg` | ~2.71 MiB | [**Download for Apple Silicon**](https://github.com/PyDeV1OpEr/Vaultfolio/releases/download/v1.0.1/Vaultfolio-macOS-arm64.dmg) | `ead3b093d2df2e1ef59397b891010f98b38b594c070dc8b1a807f7e85ea3f1a1` |
| **macOS** | Intel (x64) | `.dmg` | ~2.84 MiB | [**Download for Intel Mac**](https://github.com/PyDeV1OpEr/Vaultfolio/releases/download/v1.0.1/Vaultfolio-macOS-x64.dmg) | `9049e10095e8008d0dc69f67eda9c5fe183dfcb6988c116e3b5e6e402a79bb1a` |
| **Windows** | x64 (10 / 11) | Setup `.exe` | ~3.70 MiB | [**Download for Windows**](https://github.com/PyDeV1OpEr/Vaultfolio/releases/download/v1.0.1/Vaultfolio-Windows-x64-setup.exe) | `ddb4b0b3845f3549be44a73f44e45ed3bc92ac622ed5e38f0010f817b91ece08` |
| **macOS** *(alt)* | Apple Silicon (aarch64) | `.dmg` | ~2.77 MiB | [**Download aarch64 DMG**](https://github.com/PyDeV1OpEr/Vaultfolio/releases/download/v1.0.1/Vaultfolio_1.0.1_aarch64.dmg) | `d7d7eaf627e1ceb1ab87ee3c25a3fafa416ac3d111fa996e4499f7d6428e52cc` |
| **Linux** | x64 | — | — | *Not packaged yet (Web / Docker ready)* | — |

> 🔗 You can also inspect all release tags and assets on the [**GitHub Releases Page**](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest).

---

### 🛡️ Installing Unsigned Open-Source Builds

Because Vaultfolio is an independent open-source project without expensive corporate code-signing certificates (Apple Developer Program ID / Microsoft Authenticode), standard OS security prompts may appear on first launch:

#### On macOS (Apple Silicon & Intel)
1. Double-click the downloaded `.dmg` and drag **Vaultfolio.app** into your `/Applications` folder.
2. If macOS displays *"Apple cannot check it for malicious software"* or *"Vaultfolio is damaged"*:
   - **GUI Method:** Right-click (or Control-click) **Vaultfolio.app** in `Finder` > `Applications` and select **Open**, then click **Open** in the confirmation dialog.
   - **Terminal Method:** Run the standard Gatekeeper attribute clearing command:
     ```bash
     xattr -cr /Applications/Vaultfolio.app
     ```
3. Enter your 6-digit PIN on the unlock screen to access your local vault.

#### On Windows (10 / 11)
1. Run `Vaultfolio-Windows-x64-setup.exe` and follow the setup wizard.
2. If **Windows Defender SmartScreen** displays *"Windows protected your PC"*:
   - Click **More info**.
   - Click **Run anyway**.

---

## 💎 Honest Valuation Philosophy: Zero Fake Wealth

Unlike templates or mock apps that pre-populate fictional bullion or fictitious stock charts:
- **Zero Synthetic Demo Wealth**: Newly created accounts start with an empty portfolio, 0 holdings, and honest empty states.
- **Manual-First Valuations**: Live commodity-price ticker APIs are intentionally deferred. Physical assets are valued based on explicit, user-entered figures (purchase price, appraised value, certified replacement cost, or known liquidation value).
- **Authoritative History**: User valuations are never silently overwritten or estimated by algorithms. Every adjustment appends a dated historical record.
- **Truthful Gain & Loss**: Profit/loss calculations require both an invested acquisition cost and a verified current valuation. If either is missing, Vaultfolio marks the metric as pending rather than inventing false returns.

---

## 🌟 Key Capabilities

### 1. Multi-Category Physical Asset Management
Vaultfolio is purpose-built for physical property, not abstract securities:
- **Precious Metals**: Gold, Silver, Copper, Platinum, Palladium with purity grades (24K, 22K, 18K, 14K, 10K, .999, .925, .900) and weights in grams, troy ounces, or kilograms.
- **Gemstones & Jewelry**: Diamonds, Rubies, Emeralds, Sapphires, Pearls, Fine Jewelry with carat weight, cut, clarity, color, and metal mounting attributes.
- **Luxury Timepieces**: Watches with brand, model, reference number, serial number, box & papers status, movement type, and condition grade.
- **Real Estate & Land**: Residential, Commercial, Agricultural, Land plots with custom land units including **Sri Lankan perches** ($1\text{ perch} \approx 25.29\,\text{m}^2$), square feet, square meters, acres, and hectares.
- **Vehicles & Motorcycles**: Collector cars, daily drivers, and motorbikes with make, model, year, VIN, mileage, and registration details.
- **Other Physical Assets**: Fine art, antiques, collectibles, equipment, and tangible stores of value.

### 2. Comprehensive Portfolio Insights & Visual Analytics
- **Category Allocation**: Recharts interactive breakdown of holdings across physical categories.
- **Cost vs. Value Grouped Comparison**: Direct side-by-side evaluation of acquisition cost against current estimated value.
- **Top Holdings Visualizer**: Quick identification of high-value positions driving total net worth.
- **Valuation History Timeline**: Historical tracking of total net portfolio value based on genuine logged valuation events.
- **Concentration Risk & Fine Metal Liquidation**: Automated risk warnings for asset concentration and calculated pure metal content summaries.

### 3. Fortified Offline-First Security
- **Local Key Wrapping**: Uses **scrypt** ($N=32768, r=8, p=1$) for password-based key derivation.
- **AES-256-GCM AEAD**: Local database payloads are encrypted at rest with an ephemeral 256-bit Data Encryption Key (DEK).
- **Fast 6-Digit PIN Unlock**: Convenient day-to-day access protected by salt-hashed PIN verification.
- **Brute-Force Rate Limiting**: 5 consecutive incorrect PIN attempts trigger a mandatory 5-minute lockout that persists across application restarts.
- **In-App PIN Recovery**: Forgotten PINs can be safely reset directly within the application by proving knowledge of the vault's master password.
- **Optional Encrypted Backups**: Export full portfolio backups as standard JSON or AES-256-GCM encrypted manifests with SHA-256 integrity checks.

---

## 🎨 UI / UX Redesign Highlights

Vaultfolio features an interface inspired by high-end financial instruments and native Apple design principles:

- **OLED Ink Surface System**: Deep dark aesthetic (`#000000`, `#09090b`, `#121215`, `#18181b`) eliminating visual noise and glare.
- **Controlled Elevation & Lighting**: Subtle micro-borders (`rgba(255, 255, 255, 0.08)`) and calibrated elevation shadows (`elev-1` through `elev-4`).
- **Precision Typography & Tabular Numerals**: High-legibility sans-serif with `tabular-nums` ensuring currency amounts and weights stay perfectly aligned.
- **Purposeful Motion & Transitions**: Smooth route transitions, micro-interactions, responsive button loading states, and card-lift hover dynamics.
- **Reduced Motion Respect**: Built-in CSS queries disable motion for users with vestibular sensitivities (`prefers-reduced-motion: reduce`).
- **Unified Dialogs & Toasts**: Non-blocking toast notifications and explicit confirmation modals for irreversible operations (deleting assets, restoring backups).

---

## 📸 Interface Preview

| | |
|---|---|
| ![Portfolio Grid](docs/screenshots/portfolio-grid.png) | ![Asset Detail](docs/screenshots/asset-detail.png) |
| *Portfolio Grid: Asset cards with category tokens, valuation methodology, and quick actions.* | *Asset Detail: Provenance metadata, purchase price, category-specific attributes, and valuation history.* |
| ![Insights](docs/screenshots/insights.png) | ![Market & Valuation](docs/screenshots/market-valuations.png) |
| *Insights: Dynamic category allocation donut, cost comparison, and net worth trajectory.* | *Valuations: Manual valuation entry, historical records, and asset resale estimates.* |
| ![Mobile Overview](docs/screenshots/mobile-overview.png) | ![Mobile Navigation](docs/screenshots/mobile-navigation.png) |
| *Mobile Responsive: Adaptive metrics and cards on compact viewports.* | *Mobile Navigation: Touch-friendly slide-over drawer navigation.* |

---

## 🛠️ Architecture & Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Desktop Shell** | [Tauri v2](https://v2.tauri.app) | Secure, lightweight native wrapper (~2.8 MB binaries) using OS WebViews instead of heavyweight Chromium |
| **Frontend Framework** | [React 18](https://react.dev) + [TypeScript 5](https://www.typescriptlang.org) | Strict type safety, clean component architecture, zero `any` types in domain logic |
| **Bundler & Tooling** | [Vite 5](https://vite.dev) | Lightning-fast development server with ESBuild and optimized Rollup production bundling |
| **Routing** | [React Router 6](https://reactrouter.com) | Declarative client-side routing with route guards for lock/unlock states |
| **State Management** | [Zustand 5](https://zustand.docs.pmnd.rs) | Minimal, subscription-based reactive state for vault operations, toasts, and session state |
| **Styling & Design System** | [Tailwind CSS 3](https://tailwindcss.com) | Utility-first CSS configured with custom ink palette, micro-elevations, and animations |
| **Data Visualization** | [Recharts 2](https://recharts.org) | Declarative SVG charting with customized tooltips, dark palette, and responsive containers |
| **Iconography** | [Lucide React](https://lucide.dev) | Crisp, modern, consistent vector icons |
| **Cryptography** | `@noble/hashes` & `@noble/ciphers` | Audited, pure-JS cryptographic primitives for scrypt and AES-256-GCM AEAD |
| **Schema Validation** | [Zod 3](https://zod.dev) | Runtime validation for backup manifest schemas and user inputs |
| **Unit Testing** | [Vitest 2](https://vitest.dev) | Blazing-fast test runner validating cryptography, profile lifecycle, backups, and valuation math |
| **Cloud Sync (Optional)** | [Supabase](https://supabase.com) | Optional backend using PostgreSQL with strict Row Level Security (`auth.uid() = user_id`) |

---

## 🚀 Getting Started & Local Development

### Prerequisites
- **Node.js**: Version 18+ (Node 20 recommended)
- **npm**: Version 9+
- **Rust & Cargo** *(only required if compiling desktop binaries)*: [Install Rust](https://www.rust-lang.org/tools/install)

### 1. Clone & Install
```bash
# Clone the repository
git clone https://github.com/PyDeV1OpEr/Vaultfolio.git
cd Vaultfolio

# Install exact dependencies
npm ci
```

### 2. Run the Development Server
```bash
npm run dev
```
Open **http://localhost:5173** in your browser. Vaultfolio will launch with the initial onboarding screen where you can initialize your local master password and 6-digit PIN.

### 3. Run Inside the Native Tauri Desktop Window
```bash
npm run desktop:dev
```
*Launches the application inside a native macOS/Windows window with live Hot Module Replacement (HMR).*

---

## 🧪 Test Suite & Code Quality

The domain logic (cryptography, key derivation, backup integrity, valuation math, and unit conversions) is protected by a 100% passing automated test suite:

```bash
# Run strict TypeScript compiler verification
npm run typecheck

# Run the Vitest unit test suite
npm run test

# Run a full production build
npm run build
```

---

## 📦 Building Desktop Installers

### macOS (.app and .dmg)
To build universal or native macOS application bundles and disk images:
```bash
# Builds native macOS .app and .dmg into src-tauri/target/release/bundle/dmg/
npm run desktop:build:macos
```

### Windows (.exe NSIS Installer)
To build the Windows setup installer on a Windows development machine or CI runner:
```bash
# Builds Windows NSIS installer into src-tauri/target/release/bundle/nsis/
npm run desktop:build:windows
```

---

## 🔐 Release Verification & Integrity Checksums

Always verify the cryptographic hash of your downloaded installer before executing:

```bash
# On macOS / Linux
shasum -a 256 <filename>

# On Windows (PowerShell)
Get-FileHash -Algorithm SHA256 <filename>
```

### Official Release `v1.0.1` Checksums:
```text
ead3b093d2df2e1ef59397b891010f98b38b594c070dc8b1a807f7e85ea3f1a1  Vaultfolio-macOS-arm64.dmg
9049e10095e8008d0dc69f67eda9c5fe183dfcb6988c116e3b5e6e402a79bb1a  Vaultfolio-macOS-x64.dmg
ddb4b0b3845f3549be44a73f44e45ed3bc92ac622ed5e38f0010f817b91ece08  Vaultfolio-Windows-x64-setup.exe
d7d7eaf627e1ceb1ab87ee3c25a3fafa416ac3d111fa996e4499f7d6428e52cc  Vaultfolio_1.0.1_aarch64.dmg
```

---

## 📄 License & Credits

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for detailed terms.

Developed by **Mohammed Unais** ([@PyDeV1OpEr](https://github.com/PyDeV1OpEr)).
Contributions and issues are welcome via [GitHub Discussions](https://github.com/PyDeV1OpEr/Vaultfolio/discussions) and [Pull Requests](https://github.com/PyDeV1OpEr/Vaultfolio/pulls).
