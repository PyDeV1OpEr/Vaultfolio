# Vaultfolio Desktop

Vaultfolio is packaged as a native desktop app with **Tauri v2**. The web app is
untouched and remains fully functional on its own (`npm run dev`); `src-tauri/`
adds a thin native window shell around the same Vite bundle.

## Why Tauri (not Electron)

- The frontend is a regular Vite + React SPA. Authentication is email + password
  through the `@supabase/supabase-js` client (HTTPS, no OAuth browser redirects,
  no deep-link handlers needed), so nothing in the app depends on a real browser
  environment.
- Persistent data is plain `localStorage` (demo mode + Supabase sessions),
  which is supported inside the Tauri WebView on both platforms.
- Result: ~10 MB installers instead of ~200 MB Electron ones, and no Node
  runtime shipped to end users.

## What runs where

| Concern            | Desktop behavior |
| ------------------ | ---------------- |
| Frontend bundle    | Same `dist/` as the web build, served from the app binary (no localhost server, works offline) |
| Authentication     | Unchanged — Supabase email/password over HTTPS; sessions auto-refresh in the WebView |
| API calls          | Supabase (env vars baked into the bundle at build time) and optional metals market API |
| Database           | Supabase Postgres over HTTPS (RLS enforces privacy); uses no local server |
| Local persistence  | `localStorage` inside the system WebView: macOS `~/Library/WebKit/com.vaultfolio.desktop/`, Windows `%APPDATA%\com.vaultfolio.desktop\EBWebView` — survives launches and app updates |
| API keys           | Only the public-by-design Supabase anon key is embedded (safe by definition, RLS enforces privacy). **Do not** point `VITE_METALS_API_URL` at a provider whose key is embedded in the URL — that would end up in the shipped bundle. Use a provider that authenticates server-side or name-based. |
| Secrets            | No secrets exist in this project. `.env.local` is git-ignored; CI builds use repo secrets if/when needed |

CSP is configured in `src-tauri/tauri.conf.json` (`app.security.csp`) and allows
only the app itself, Google Fonts, and `*.supabase.co`/HTTPS for market APIs.

## Project layout

```
src-tauri/
  tauri.conf.json      # shared config: window, security, bundle metadata
  tauri.macos.json     # overlay: bundles .app + .dmg
  tauri.windows.json   # overlay: bundles NSIS .exe
  icons/               # generated from icons-src/app-icon.svg (see script)
  src/{main,lib}.rs    # minimal window shell; no custom IPC
.github/workflows/release.yml        # tag-triggered native builds for both platforms
```

## Prerequisites

- Node 20+
- Rust 1.77+ (`rustup`)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: WebView2 runtime is auto-installed by the bootstrapper
  (`webviewInstallMode: embedBootstrapper`); no extra setup

## Build commands

```bash
# Daily development in a native window (hot reload)
npm run desktop:dev

# macOS: .app + .dmg
npm run desktop:build:macos
# → src-tauri/target/release/bundle/dmg/Vaultfolio_1.0.0_aarch64.dmg

# Windows (must be run on Windows — see note below)
npm run desktop:build:windows
# → src-tauri/target/release/bundle/nsis/Vaultfolio_1.0.0_x64-setup.exe

# Regenerate icons after editing icons-src/app-icon.svg
node icons-src/render.mjs && npx tauri icon icons-src/app-icon.png --output src-tauri/icons
```

## Platform notes

### macOS
- `npm run desktop:build:macos` produces an **unsigned** `.app` and `.dmg` by
  default. Gatekeeping is not a problem for building, only for distribution.
- To distribute to non-technical users, sign + notarize:
  ```bash
  export APPLE_SIGNING_IDENTITY="Developer ID Application: YOUR NAME (TEAMID)"
  export APPLE_ID="..." APPLE_PASSWORD="..." APPLE_TEAM_ID="..."   # notarytool
  npm run desktop:build:macos
  ```
- Universal (Intel + Apple Silicon) binary: add
  `--target universal-apple-darwin` and install both Rust targets
  (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

### Windows
- **Installers cannot be cross-compiled from macOS.** Produce the `.exe` by
  either (a) running `npm run desktop:build:windows` on a Windows machine, or
  (b) pushing a version tag `v*` and letting `.github/workflows/release.yml`
  build it natively on `windows-latest` (the macOS arm64/x64 jobs run in the
  same workflow; installers upload as artifacts and then publish to a draft
  GitHub Release).
- NSIS is bundled inside Tauri; no extra tools are needed.
- Optional code-signing: set `TAURI_SIGNING_PRIVATE_KEY` (and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) to sign the NSIS installer.

## Verification checklist

- [x] `npm run typecheck`, `npm test`, `npm run build` all pass
- [x] macOS `.dmg` builds locally (see release notes for the artifact path)
- [x] Demo mode, Supabase login, and RLS-protected cloud mode tested in the
      same bundle served through a browser before packaging
- [ ] Windows `.exe` — requires a Windows machine or the CI workflow (above)
