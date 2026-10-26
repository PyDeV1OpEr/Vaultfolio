# Vaultfolio — Architecture

This document describes the system **as it is implemented**, traced through the source in `src/` and cross-checked against the deployed Supabase project (schema extracted live into [supabase/schema.sql](../supabase/schema.sql)). Nothing here is aspirational — planned or unimplemented items are marked as such.

## System overview

Vaultfolio is a single-page React application built **offline-first**, shipped in two forms:

1. **Web (browser)** — built with Vite → `dist/`, statically deployable anywhere.
2. **Desktop (macOS/Windows)** — the *same* `dist/` bundle wrapped in a [Tauri v2](https://v2.tauri.app) native window; no Electron, no bundled Node runtime.

The primary mode is the **local encrypted vault**: a per-device profile secures the portfolio with a master password (plus an optional device PIN), needs no account, no network and no API keys. Cloud sync via Supabase remains an optional, explicit alternative. A demo dataset exists as **development-only** sample data (`demoAllowed()` gates every seeding path), never as a production mode.

There is **no Vaultfolio server and no Vaultfolio API**. Optional cloud persistence and auth go directly from the client to the user's own Supabase project:

* **Auth** — Supabase Auth, email + password.
* **Data** — Postgres tables `vaultfolio_assets`, `vaultfolio_valuations`, `vaultfolio_profiles`, `vaultfolio_market_overrides`, protected by Row Level Security.
* **Files** — asset photos to the `asset-files` storage bucket (column + adapter code exist; bucket provisioning is step 4 in the schema setup).
* **Market prices** — an env-configured generic HTTP endpoint, else a clearly-labelled demo dataset.

## High-level diagram

```mermaid
flowchart LR
  subgraph client["Browser / Tauri WebView"]
    UI["React SPA — pages/, components/"]
    Store["Zustand store — dataStore.ts"]
    Val["valuation.ts · money.ts · units.ts"]
    MKT["market.ts — providers, cache, overrides"]
    Ad["storage.ts — DataAdapter"]
    UI --> Store
    Store --> Val
    Store --> MKT
    Store --> Ad
  end
  subgraph supabase["Supabase project"]
    Auth["Auth — users"]
    PG[("Postgres — vaultfolio_* tables,\nRLS: auth.uid() = user_id")]
    St[("Storage — asset-files")]
  end
  Ad -- "supabase-js over HTTPS" --> PG
  Ad -- "auth" --> Auth
  MKT -- "VITE_METALS_API_URL" --> PX["Configured price endpoint"]
  Ad -. "photo upload (code ready)" .-> St
```

## Boot, mode selection, and data flow

`src/store/dataStore.ts` is the single brain; `src/lib/storage.ts` abstracts *where* user data lives behind a `DataAdapter` interface with two implementations: `EncryptedLocalAdapter` (offline vault) and `SupabaseAdapter` (optional cloud).

Session modes: `loading → onboarding` (no profile yet) → `locked` (profile exists, vault sealed) → `local` (DEK unlocked and held in memory only). Cloud instead follows `signedOut → cloud`.

On app boot (`boot()`):

1. Restore persisted settings (currency, owner name) and market data.
2. If the user previously *chose* cloud sync (`vaultfolio.mode === 'cloud'`) and Supabase is configured, try to resume that session; any failure falls through to the local flow.
3. Local-first decision: a profile on this device → **lock screen**; otherwise → **onboarding**.
4. A mutation (add/edit/delete/mark-sold/set-override) is applied **through the adapter interface only** — pages never touch Supabase or `localStorage` directly.

```mermaid
flowchart TD
  boot["boot()"] --> pref{"user chose cloud\npreviously?"}
  pref -- "yes" --> ses{"session valid?"}
  ses -- "yes" --> cloud["SupabaseAdapter: load" ]
  ses -- "no" --> prof{"profile exists?"}
  pref -- "no" --> prof
  prof -- "no" --> onboarding["/onboarding\ncreate profile + DEK"]
  prof -- "yes" --> locked["/unlock\npassword or PIN unwrap"]
  locked -- "success" --> local["EncryptedLocalAdapter:\ndecrypt vault doc"]
  local --> api["pages read the store;\nmutations flow through the adapter"]
  cloud --> api
  local -- "lock()/restart" --> locked
```

## Valuation engine (the honest-numbers core)

[src/lib/valuation.ts](../src/lib/valuation.ts) — pure functions, unit-tested. `resolveAssetValuation(asset, market)` walks a strict priority ladder and **never silently substitutes**:

| Priority | Method | Meaning |
|---|---|---|
| 1 | `user` | Owner-entered value; authoritative and never auto-overwritten (the computed alternative is surfaced alongside for comparison). |
| 2 | `calculated` | Gold & silver only: `grams × purity × price/gram`. Demo-market prices yield `indicative` + low confidence instead. |
| 3 | `live_market` / `recent_market` | A recorded valuation with its original source label. |
| 4 | `unavailable` | Value is `null`; the UI never shows a fabricated number. |

Money mechanics (`assetMetrics` in valuation.ts): `purchaseCost = purchasePrice + extraCosts`; two distinct gain figures — `unrealizedGain = currentValuation − cost` and `resaleGain = estimated resale proceeds − cost`, where resale applies the explicitly recorded dealer spread for fine metal. `statsFor` tracks `valuedCount` vs `unvaluedCount` so an unvalued asset is never silently dropped from the totals.

**Valuation history is append-only** (`vaultfolio_valuations` / `ValuationRecord[]`): every edit carrying a valuation produces a new record. `portfolioTimeline` reconstructs each date's portfolio value by carrying each active asset's last-known value forward and summing only currently-active assets.

## Market data

[src/lib/market.ts](../src/lib/market.ts) is deliberately pluggable and honest:

* **Provider contract**: `MetalProvider.fetch()` returns `null` when it did *not* actually obtain data; the app never invents "live" figures.
* **Priority**: the env-configured HTTP provider (`VITE_METALS_API_URL`, optional display label `VITE_METALS_API_LABEL`) — whose response shape is `{ goldPerGramLkr, silverPerGramLkr, usdLkr, asOf }` — takes precedence over the demo provider.
* **Per-user overrides** (`gold_per_gram`, `silver_per_gram`, `usd_lkr` via `vaultfolio_market_overrides` in cloud mode, a store field in demo) **always win** over any fetched price and are labelled user-entered.
* **Cache & staleness**: fetched snapshots are cached with a 6-hour TTL; a stale snapshot is shown *with a stale label*, not silently hidden or reused as fresh.
* **Failure**: any provider or network error degrades gracefully — nothing breaks the dashboard, and the UI keeps telling the user exactly which source produced the numbers it shows.

## Database schema

The real, deployed schema is mirrored in [supabase/schema.sql](../supabase/schema.sql) and matches the row mappings in [storage.ts](../src/lib/storage.ts) exactly. Essentials:

* `vaultfolio_assets` — one row per physical asset. Category-specific physical facts (karat/fineness, perches/sqft, engine mileage, watch serials) live in **`attributes_json`** (a JSONB column), so adding asset attributes does not require schema churn. CHECK constraints guard `category`, `status`, `valuation_method`, and `valuation_confidence`.
* `vaultfolio_valuations` — append-only history. **FK**: `asset_id → vaultfolio_assets(id) ON DELETE CASCADE`, so deleting an asset also removes its valuation history (the adapter additionally deletes orphan records explicitly).
* `vaultfolio_profiles` — `display_name` only.
* `vaultfolio_market_overrides` — **UNIQUE `user_id`**, one override set per user.
* All `user_id` columns `REFERENCES auth.users(id) ON DELETE CASCADE` — deleting a Supabase auth user deletes their Vaultfolio data.

## Security boundaries & private-data handling

**Local vault (primary mode)**: user data is encrypted **at rest** with AES-256-GCM under the DEK; only the wrapped DEK and ciphertext live in `localStorage`. Encryption happens inside the SPA only — storage never sees a plaintext key. Brute-force damping (attempt counters + 15-minute lockout) protects both master-password and PIN unlocks. See [Local vault security architecture](#local-vault-security-architecture).

**Optional cloud mode** (Supabase):
* **Every table has RLS enabled** with `auth.uid() = user_id` (for profiles: `auth.uid() = id`). Holding the anon key alone cannot read or write another account's rows. *Exception*: the `asset-files` storage bucket is public-read by URL when photo upload is used; bucket-level policies must be configured at setup time.
* **Public-by-design credentials**: only `VITE_SUPABASE_URL` + anon key exist client-side. The app holds no secrets, sends no telemetry, and stores no analytics cookies.
* **Deliberately-not-exported fields**: watch serial, vehicle registration, and full address fields are marked private in the add/edit UI and omitted from CSV export by default.
* **Honest limits**: no end-to-end encryption on the wire to Supabase — Postgres stores row plaintext and its operators can physically read it; sessions are standard Supabase JWTs; there is no audit log.
* **Backup uploader / restore path** is local-file-only — nothing is relayed through any Vaultfolio-hosted service (there is none).

## Configuration

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Enables **optional** cloud sync; absent → local vault is the only mode (dev sample data is what `demoAllowed()` gates). |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public by design). |
| `VITE_METALS_API_URL` | Optional live-price endpoint. |
| `VITE_METALS_API_LABEL` | Display name of the configured price source. |

⚠️ All `VITE_*` values are **embedded in the shipped bundle** — see [README → market provider](../README.md#market-data-provider-optional) for the response shape, and never point `VITE_METALS_API_URL` at an endpoint that carries a secret key in its URL.

## Local vault security architecture

Implemented in [src/lib/crypto.ts](../src/lib/crypto.ts) (AES-256-GCM + scrypt via `@noble/hashes`, audited) and [src/lib/profile.ts](../src/lib/profile.ts):

* **DEK/KEK envelope.** A cryptographic key-encryption key (KEK) is derived from the master password with **scrypt** (N=2¹⁴, r=8, p=1 — tunable `KdfParams` persisted with the profile, ~32 MiB) and wraps a random 32-byte per-DEK **data-encryption key (DEK)**; user data is then encrypted with the DEK. Unlocking means unwrapping `wrappedDek` with the derived KEK.
* **No plaintext keys at rest.** The decrypted DEK lives **only in memory** (module-scoped variable, never `localStorage`, never persisted, zeroed-out intent on lock) — this is why a page reload lands on the lock screen.
* **Verifier, not password hash export.** The profile stores a random-salt verifier (`makeVerifier`) so the stored record cannot be replayed as a key; `checkVerifier` validates unlock attempts.
* **AAD everywhere.** Every AEAD blob binds a `aad` domain string (`'vaultfolio:profile'`, `'vaultfolio:vault'`, wrapped keys, backups) so ciphertext from one context cannot be replayed in another.
* **Brute-force damping.** Per-profile attempt counters (`pinFailures`, `recoveryFailures`) persist to local storage; **5 consecutive failures → 5-minute lockout** with a live countdown, spanning restarts (this counter covers *both* master-password and PIN unlock attempts; the separate PIN-recovery flow has its own counter with a 15-minute cooldown).
* **PIN quick-unlock.** Optional; stores only a **PIN-wrapped DEK copy** (`wrappedDekPin`), never the PIN itself. PIN length≥4 enforced by zod; the attempt counter applies likewise. Forgotten PINs can be reset through the recovery flow (`recoverPin`, username + master password, cooldown-damped).
* Since the current `crypto.ts` round-trips via `crypto.subtle`/`@noble` and produces stable ciphertext for the same inputs, [tests](../src/lib/crypto.test.ts) cover drift, AAD-binding, false-key rejection, verifier flows, and cross-domain tampering.

### Threat-model boundaries (documented, not aspirational)

Out-of-scope for this design: denial-of-service on the local DB, physical memory-dump attacks on the running process, OS-level keychains, biometric unlock (deliberately deferred for reliability), and egress privacy (the optional market-data fetches are the only network calls; cloud sync, if enabled, sends your data to *your own* Supabase project). See [SECURITY.md](./SECURITY.md).

## Backup & restore

[src/lib/backup.ts](../src/lib/backup.ts) produces a **versioned, human-portable manifest**: `{ format: 'vaultfolio-backup', version: 1 }` plus the decrypted asset/record set. Optionally passphrase-confidential with scrypt+AES-GCM (`manifest.encryption.scryptN/salt/nonce`, AAD-bound to `vaultfolio:backup:v1`). Restore validates format+version and schema, decodes only what it recognizes, and **requires the current unlock state** (a sealed vault cannot silently ingest). No manifest is ever trusted alone — the UI always shows a summary count before you confirm.

## Error handling & known limitations

* Store mutations wrap the adapter call in try/catch, surface the failure as a toast, and (in cloud mode) optimistically apply the local change and roll it back on failure — local mode never leaves the encrypted vault inconsistent.
* The market provider treats *no data* (`null`) as a legitimate return, not an exception path.
* A failing Supabase *load* on boot degrades to a visible error state, not a blank screen.
* Wrong password/PIN at unlock: counted; 5 consecutive failures trigger a **persisted 5-minute lockout** (covers page reloads and full app restarts); the PIN-recovery flow has its own 15-minute cooldown.

## Known limitations

* Light theme and full i18n: settings keys exist, only dark + English (LKR-first) shipped.
* Asset photos: DB column and storage code exist; the schema file does not provision the bucket (documented step).
* Backups are manual (Settings → export/import in the local vault UI); no scheduled or cloud-side backup — Supabase-side backup, for cloud users, is the user's responsibility.
* If the master password is forgotten, the vault is **unrecoverable by design** (no server, no recovery email); the documented remedy is restoring from an encrypted backup made earlier, if one exists.
* Locking and restarting always require re-entry of the master password (or PIN): DEK is intentionally never persisted to disk.
* No hosted Vaultfolio instance — optional cloud sync always points at *the user's own* Supabase project, so there is no central owner who could see user data at all.
