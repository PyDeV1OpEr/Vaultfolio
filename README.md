# Vaultfolio

> A private, offline-first desktop app for recording, valuing, and understanding tangible wealth.

Vaultfolio tracks physical assets—precious metals, jewelry and gemstones, watches, property, vehicles, and other collectibles—without requiring an account or sending a local vault to a server. Local vault data is encrypted at rest with AES-256-GCM and scrypt.

## Download the Latest Version

**Truthful builds from current source.** Do not use v1.0.2, v1.0.3, or v1.0.4: v1.0.2 has a stale frontend, v1.0.3's macOS bundle has an invalid signature, and v1.0.4 was built before the AI Market Reports feature merged. **v1.0.6 is the current source**: it adds automatic market valuations for supported metal assets, automatic keyless USD→LKR conversion with timestamps, and the new AI Insights section, and was rebuilt for all three platforms from the tagged commit.

| Platform | Download |
| --- | --- |
| macOS Apple Silicon (arm64) | [Vaultfolio-macOS-arm64.dmg](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest/download/Vaultfolio-macOS-arm64.dmg) |
| macOS Intel (x64) | [Vaultfolio-macOS-x64.dmg](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest/download/Vaultfolio-macOS-x64.dmg) |
| Windows 10/11 (x64) | [Vaultfolio-Windows-x64-setup.exe](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest/download/Vaultfolio-Windows-x64-setup.exe) |

Each link points at the **latest** release; the same filenames appear on the [release page](https://github.com/PyDeV1OpEr/Vaultfolio/releases/latest) with SHA-256 checksums in the notes. See [DESKTOP.md](DESKTOP.md) for the installer-verification steps.

## What’s in Vaultfolio

- Physical-asset portfolio tracking across precious metals, jewelry and gemstones, watches, property (including Sri Lankan perches), vehicles, and custom assets.
- Market Watch for international USD reference quotes with a provider adapter: GoldAPI.io (optional primary, user key) plus a keyless gold-api.com fallback covering gold (XAU), silver (XAG), platinum (XPT), palladium (XPD), and copper (XCU, quoted via the COMEX HG continuous contract). Live fetching works without any configuration.
- Interactive price timelines across 1 h, 12 h, 24 hours, 7 days, 30 days, 90 days, and all collected observations, with window changes computed from real stored observations.
- **AI Insights** — a separate Gemini-powered section that turns your stored Market Watch observations and locally computed portfolio aggregates into a structured brief (market overview, per-metal direction with confidence, allocation and concentration commentary, risks, opportunities). In Settings → Gemini AI you can paste/save/replace/remove your key, pick from the current Gemini model list, and run a zero-quota connection test.
- Optional AI Market Reports powered by *your* Gemini API key: structured, model-generated analysis grounded only in your locally stored provider data, with per-metal evidence, risks, and conditional (never guaranteed) conclusions. No prices or claims come from the model itself.
- Local on-device market-price history, capped at 500 observations per metal. History starts when observations are collected; the app does not invent or claim provider backfill.
- Provider, timestamp, freshness, error, and credential-status indicators; manual refresh plus low-frequency automatic collection (two runs per day by default). Rate-limit responses respect Retry-After.
- Portfolio analytics with allocation, cost-versus-value, top-holding, and portfolio valuation-history charts, based on the user’s records.
- Manual valuations and optional configured metal/FX reference data. International reference prices and calculated LKR conversions are not presented as Sri Lankan dealer quotes.
- Local encrypted vault, PIN unlock, rate limiting, encrypted backup/restore, user-configured Gemini key sealed under the vault key, and optional Supabase cloud mode.

## Install

### macOS

1. Download the DMG matching your Mac’s architecture (Apple menu → About This Mac).
2. Open the DMG and drag `Vaultfolio.app` to Applications.
3. Builds are **ad-hoc signed** (notarized builds require Apple Developer ID credentials — see [DESKTOP.md](DESKTOP.md)). If Gatekeeper blocks the first launch, Control-click the app, choose **Open**, then confirm. No system security settings need to change.

### Windows

1. Download the x64 NSIS setup `.exe`.
2. Run it and follow the installer.
3. Builds are currently unsigned. If SmartScreen appears, use **More info → Run anyway** only after verifying the release asset checksum.

## Market data and API configuration

The core local vault, asset tracking, valuations, portfolio charts, and saved Market Watch history work without Gemini or any market API key. Market Watch live fetching is optional.

Copy `.env.example` to `.env.local` for development and configure only the services you use:

```bash
# Optional: only needed to add GoldAPI.io as a primary source
VITE_GOLDAPI_KEY=your_personal_low_privilege_key
```

gold-api.com is a keyless fallback and is always available: it supports all five metals, with copper served under its COMEX HG code (USD per pound, mapped to XCU). GoldAPI.io is an optional primary for XAU, XAG, XPT, and XPD with a free tier (~300 requests/month). It no longer uses a fallback key — the former Goldsafe.io provider is defunct and was retired in this release. API keys prefixed `VITE_` are compiled into a client bundle: do not ship a shared, privileged, or secret key. Use a personal, read-only, revocable key, or configure no key at all.

`VITE_METALS_API_URL` can optionally point to a separately managed endpoint returning gold/silver and USD/LKR values; this is distinct from Market Watch. Any LKR conversion remains a reference calculation, not a verified local dealer price.

Gemini is not integrated or required by the current app for tracking. The optional **AI Market Reports** section uses *your* Gemini API key, configured in-app under Settings → Gemini AI:

- Reports call `gemini-2.5-flash` via Google's REST API with native structured-output (`responseSchema`), so analysis arrives as validated JSON, not free text.
- The app never accepts numeric prices from the model. Reports are assembled from provider observations stored on your device; missing windows are labelled incomplete rather than filled in. Period options: 24 h / 7 d / 30 d / 90 d.
- The key is stored encrypted at rest (AES-256-GCM envelope, sealed with the vault DEK or a passphrase) and is sent only to Google. Because Vaultfolio runs locally, this is client-side storage: never use a production-critical key here.
- If no key is configured, Reports show setup guidance and nothing else — the rest of the app is unaffected.

To create a free key: [aistudio.google.com](https://aistudio.google.com) → "Get API key".

## Privacy, storage, and backup

- Vault records are encrypted locally. Market Watch settings and observations are stored locally in the browser/webview storage on that device.
- Clearing app/site data removes local history and settings. Use the in-app backup feature before moving devices, reinstalling, or clearing data.
- Optional Supabase mode requires your own project and public anon credentials; it is not required for an offline vault.
- No embedded `.env` file, Gemini credential, or provider key belongs in a release build.

## Development

Prerequisites: Node.js 20+ (CI uses Node 22), npm, and Rust/Cargo for desktop builds.

```bash
git clone https://github.com/PyDeV1OpEr/Vaultfolio.git
cd Vaultfolio
npm ci
npm run typecheck
npm test
npm run build
```

Run the web app with `npm run dev`, or the desktop app with `npm run desktop:dev`.

### Installer builds

```bash
# Native macOS DMG on macOS
npm run desktop:build:macos

# Native Windows NSIS setup installer on Windows
npm run desktop:build:windows
```

The tag-triggered [release workflow](.github/workflows/release.yml) builds macOS arm64/x64 DMGs and the Windows x64 installer on their native GitHub-hosted runners, uploads them to the same draft release, and publishes only after both jobs succeed.

## Troubleshooting

- **No Market Watch prices:** Refresh fetches from the keyless gold-api.com fallback without any key; provider errors and unsupported metals are shown in the UI. A `VITE_GOLDAPI_KEY` is only needed if you want GoldAPI.io as an additional primary source.
- **No chart history:** observations are recorded only after successful collection on this device; choose a wider range or collect additional observations.
- **Values look unlike a Sri Lankan shop quote:** Market Watch quotes are international USD references. Enter a manual valuation or configure an appropriate source for your use case.
- **Cannot unlock the vault:** use the in-app PIN recovery flow with the vault master password. Restore a backup only if you have verified it belongs to that vault.
- **"API key not valid" in Reports:** re-check the pasted key (Google AI Studio keys are 39 characters starting `AIza`) or press Remove key in Settings → Gemini AI and add a fresh one. Quota errors show Google's suggested wait time.
- **Report says "incomplete":** the selected window has fewer than two stored observations for that metal; collect more Market Watch history or pick a longer period. Gaps are never filled with invented data.

## Security and release verification

See [SECURITY.md](SECURITY.md) for the threat model and [DESKTOP.md](DESKTOP.md) for desktop-build details. Verify every published installer with SHA-256 before launch:

```bash
# macOS / Linux
shasum -a 256 <installer>

# Windows PowerShell
Get-FileHash -Algorithm SHA256 <installer>
```

## License

Released under the [MIT License](LICENSE). Contributions are welcome through [issues](https://github.com/PyDeV1OpEr/Vaultfolio/issues) and [pull requests](https://github.com/PyDeV1OpEr/Vaultfolio/pulls).
