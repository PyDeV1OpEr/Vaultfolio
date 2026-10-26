# Vaultfolio

> A private, offline-first desktop app for recording, valuing, and understanding tangible wealth.

Vaultfolio tracks physical assets—precious metals, jewelry and gemstones, watches, property, vehicles, and other collectibles—without requiring an account or sending a local vault to a server. Local vault data is encrypted at rest with AES-256-GCM and scrypt.

## Download the Latest Version

**Latest release: v1.0.2 — 26 October 2026.** This is the first release containing the completed Market Watch implementation. The prior v1.0.1 installers predate that commit.

| Platform | Download | Status |
| --- | --- | --- |
| macOS Apple Silicon (arm64) | [Download DMG (2.72 MiB)](https://github.com/PyDeV1OpEr/Vaultfolio/releases/download/v1.0.2/Vaultfolio-macOS-arm64.dmg) | Verified published asset |
| macOS Intel (x64) | [Download DMG (2.86 MiB)](https://github.com/PyDeV1OpEr/Vaultfolio/releases/download/v1.0.2/Vaultfolio-macOS-x64.dmg) | Verified published asset |
| Windows 10/11 (x64) | [Download setup EXE (3.72 MiB)](https://github.com/PyDeV1OpEr/Vaultfolio/releases/download/v1.0.2/Vaultfolio-Windows-x64-setup.exe) | Verified published asset |

The macOS Apple Silicon and Windows x64 assets were built from tag `v1.0.2`; Intel macOS is also available. See the [full v1.0.2 release notes and SHA-256 digests](https://github.com/PyDeV1OpEr/Vaultfolio/releases/tag/v1.0.2).

## What’s in v1.0.2

- Physical-asset portfolio tracking across precious metals, jewelry and gemstones, watches, property (including Sri Lankan perches), vehicles, and custom assets.
- Market Watch for international USD reference quotes of gold, silver, platinum, and palladium when a supported provider is configured. Copper is visible but currently marked unsupported by the bundled providers rather than estimated.
- Interactive price timelines across 24 hours, 7 days, 30 days, 90 days, and all collected observations.
- Local on-device market-price history, capped at 500 observations per metal. History starts when observations are collected; the app does not invent or claim provider backfill.
- Provider, timestamp, freshness, error, and credential-status indicators; manual refresh plus low-frequency automatic collection (two runs per day by default).
- Portfolio analytics with allocation, cost-versus-value, top-holding, and portfolio valuation-history charts, based on the user’s records.
- Manual valuations and optional configured metal/FX reference data. International reference prices and calculated LKR conversions are not presented as Sri Lankan dealer quotes.
- Local encrypted vault, PIN unlock, rate limiting, encrypted backup/restore, and optional Supabase cloud mode.

## Install

### macOS

1. Download the DMG matching your Mac’s architecture (Apple menu → About This Mac).
2. Open the DMG and drag `Vaultfolio.app` to Applications.
3. Builds are currently unsigned. If Gatekeeper blocks the first launch, Control-click the app, choose **Open**, then confirm.

### Windows

1. Download the x64 NSIS setup `.exe`.
2. Run it and follow the installer.
3. Builds are currently unsigned. If SmartScreen appears, use **More info → Run anyway** only after verifying the release asset checksum.

## Market data and API configuration

The core local vault, asset tracking, valuations, portfolio charts, and saved Market Watch history work without Gemini or any market API key. Market Watch live fetching is optional.

Copy `.env.example` to `.env.local` for development and configure only the services you use:

```bash
VITE_GOLDAPI_KEY=your_personal_low_privilege_key
VITE_GOLDSAFE_KEY=your_personal_low_privilege_key
```

GoldAPI.io is the primary provider and Goldsafe.io is the fallback. Both bundled adapters support XAU, XAG, XPT, and XPD. They do not currently support copper. API keys prefixed `VITE_` are compiled into a client bundle: do not ship a shared, privileged, or secret key. Use a personal, read-only, revocable key, or configure no key.

`VITE_METALS_API_URL` can optionally point to a separately managed endpoint returning gold/silver and USD/LKR values; this is distinct from Market Watch. Any LKR conversion remains a reference calculation, not a verified local dealer price.

Gemini is not integrated or required by the current app. If a prior Gemini quota has been exhausted, it does not block the functionality listed above; no Gemini-dependent feature is claimed in this release.

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

- **No Market Watch prices:** configure at least one supported provider key, then use Refresh. Provider errors and unsupported metals are shown in the UI.
- **No chart history:** observations are recorded only after successful collection on this device; choose a wider range or collect additional observations.
- **Values look unlike a Sri Lankan shop quote:** Market Watch quotes are international USD references. Enter a manual valuation or configure an appropriate source for your use case.
- **Cannot unlock the vault:** use the in-app PIN recovery flow with the vault master password. Restore a backup only if you have verified it belongs to that vault.

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
