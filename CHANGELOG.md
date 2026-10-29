# Changelog

All notable changes to Vaultfolio are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [SemVer](https://semver.org/spec/v2.0.0.html) — MAJOR.MINOR.PATCH, with PATCH reserved for fixes that don't change persisted data or user-visible flows.

# Changelog

All notable changes to Vaultfolio are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [SemVer](https://semver.org/spec/v2.0.0.html) — MAJOR.MINOR.PATCH, with PATCH reserved for fixes that don't change persisted data or user-visible flows.

## [1.0.6] — 2026-10-29

### Added
- **AI Insights** — a dedicated Gemini-powered analysis section, separate from both Reports and the existing local Insights analytics page. It reasons over (1) Market Watch's on-device provider observations and (2) portfolio aggregates computed locally by the valuation engine, and returns a structured, zod-validated analysis (market overview, per-metal direction with confidence, portfolio allocation/concentration commentary, risks, opportunities, tips, limitations). Direction wording is interpretation; confidence scales down when observations are thin. No prices, exchange rates, or balances are ever taken from the model; insufficient data is stated as insufficient; no guaranteed returns.
- **Settings → Gemini AI extensions**: a controlled model selector (gemini-2.5-flash / -lite / pro), and a zero-quota **Test connection** probe using the keyless-cost `Models.list` endpoint which reports configured/connected/over-quota/invalid-key status.
- Insights prompt and UI include the data basis: observation counts, providers, FX rate with source timestamp, active/valued asset counts.
## [1.0.5] — 2026-10-29

### Changed
- **Market data provider repair**: the Goldsafe.io fallback (dead domain — the API host no longer completes a TLS handshake) has been replaced with a verified, documented, **keyless** gold-api.com fallback. Market Watch live fetching now works with zero configuration and covers all five metals, including copper (quoted as COMEX HG, USD per pound, mapped to XCU). `VITE_GOLDSAFE_KEY` is no longer read; GoldAPI.io remains an optional primary source via `VITE_GOLDAPI_KEY`.
- **AI Market Reports** (merged from `feat/gemini-market-reports`): optional report generation with a user-configured Gemini key (`gemini-2.5-flash`, native structured-output `responseSchema`, zod re-validation on arrival). Reports are assembled strictly from on-device provider observations — the model never supplies prices; missing windows render as incomplete/insufficient-data rather than fabricated. Reports history is stored locally; the key is sealed with AES-256-GCM envelope encryption under the vault DEK (Settings → Gemini AI).
- Market Watch header change stat is now computed from the selected window's real stored observations (1 h/12 h/24 h/7 d/30 d/90 d), falling back to the provider's session change only when a window holds fewer than two points.

## [1.0.4] — 2026-10-26

### Added
- **Market Watch**: optional GoldAPI.io primary and Goldsafe.io fallback spot-price providers for gold, silver, platinum, and palladium; copper is shown as unsupported until a configured provider supports it.
- **On-device market history**: validated observations, retrieval/provider timestamps, freshness states, bounded local persistence (500 observations per metal), and interactive 24-hour through all-time price timelines. This is collected forward from use; it is not provider backfill.
- **Market data controls**: manual refresh, low-frequency automatic fetching (two runs/day by default), provider status, request estimates, and clear separation between international USD reference quotes and Sri Lankan dealer prices.

### Changed
- Desktop package metadata is aligned at version 1.0.3 for the Market Watch release.
- The release workflow publishes a native Windows x64 NSIS installer from a Windows runner and native macOS arm64/x64 DMGs from macOS runners.
- Desktop packaging now invalidates the embedded frontend assets before every release build, preventing a stale UI bundle from being shipped.
- macOS release bundles are re-signed after assembly and the DMGs are rebuilt from the verified apps, fixing the invalid embedded signature that caused macOS to report prior builds as damaged.

### Known limitations
- Market Watch needs the user's own optional GoldAPI.io and/or Goldsafe.io credential. A client-side `VITE_*` value is bundled into a desktop build, so use an individually scoped, low-privilege key and never treat it as a secret.
- Gemini-powered functionality is not configured or required by the current application; an exhausted Gemini quota does not affect local vault, portfolio, charts, or Market Watch UI. No Gemini feature is advertised as available.
- Tauri v2 desktop packaging: macOS Apple Silicon **and** Intel `.dmg` (both verified locally), plus a Windows x64 NSIS `.exe` target (builds on Windows or via CI; not cross-compilable from macOS).
- Tag-triggered release workflow (`.github/workflows/release.yml`) that builds unsigned macOS and Windows installers and publishes them to GitHub Releases on a pushed `v*` tag.
- Windows build path documented and wired into CI — WebView2 bootstrapper is embedded, NSIS tooling ships with the Tauri CLI.
- Comprehensive project documentation: README, `docs/ARCHITECTURE.md` (system and data-flow diagrams traced through the source), `CONTRIBUTING.md`, this `CHANGELOG.md`, `.env.example` (placeholders only, matching actual key names), organized genuine screenshots under `docs/screenshots/`.
- `supabase/schema.sql` — full schema of the live data model (`vaultfolio_assets`, `vaultfolio_valuations`, `vaultfolio_profiles`, `vaultfolio_market_overrides`) including Row Level Security policies and CHECK constraints, extracted from the deployed project rather than written from memory.

## [1.0.0] — initial application

### Added
- **Asset management** across seven categories (gold & silver, gems & jewelry, watches, land & property, cars, motorcycles, other) with category-specific physical attribute forms (purity, tola/ozt/gram units, perches/sqft, engine mileage, watch reference/serial marked private, etc.).
- **Transparent valuation engine** with an explicit method ladder (`live_market → recent_market → calculated → user → indicative → unavailable`), user-authoritative values, appended per-edit turnover history, and clearly-labelled demo data. Includes per-asset unrealized and net-of-dealer-spread resale gain metrics.
- **Market data service**: demo dataset by default, optional generic HTTP price provider configured `VITE_METALS_API_URL`, per-user manual price overrides (gold, silver, USD/LKR) that always win, timestamped cached snapshots with 6-hour staleness tagging.
- **Portfolio dashboard**: total value, cost basis, valued vs unvalued counts, allocation by category, timeline reconstruction from the append-only valuation log.
- **Insights** and **Settings** screens incl. CSV/JSON export (serials, registrations, and addresses deliberately excluded by default).
- **Supabase integration** (auth, Postgres + RLS, sessions auto-refresh) — optional, with everything failing gracefully to a clearly-labelled demo mode when credentials are absent.
- **CI** (`.github/workflows/ci.yml`): typecheck, unit tests (14), and web build on every PR.

### Security
- Row Level Security on all `vaultfolio_*` tables with `auth.uid()-scoped` policies, scoped-only Supabase anon key exposure, and environment-variable secret-handling policy documented in README + SECURITY.md.
