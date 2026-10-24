# Changelog

All notable changes to Vaultfolio are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [SemVer](https://semver.org/spec/v2.0.0.html) — MAJOR.MINOR.PATCH, with PATCH reserved for fixes that don't change persisted data or user-visible flows.

## [Unreleased]

### Added
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
