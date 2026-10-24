# Security Policy

## Reporting a vulnerability

Vaultfolio is an open-source client-side application backed by users' own Supabase projects — there is no Vaultfolio-owned production instance holding customer data. If you believe you've found a security vulnerability in Vaultfolio itself, please report it privately and responsibly.

**Preferred route:** use GitHub's private vulnerability reporting on this repository (Security tab → "Report a vulnerability"). This creates a private conversation visible only to the maintainer, and lets us discuss impact, fixes, and disclosure timing before the issue becomes public.

**If you don't have a GitHub account** or the advisory route is unavailable, email the address listed on the maintainer's GitHub profile (Mohammed Unais, [@PyDeV1OpEr](https://github.com/PyDeV1OpEr)) with `[Vaultfolio security]` in the subject line.

Please **do not** open a public issue for anything you believe is exploitable, and please don't post secrets, session tokens, or live Supabase URLs in public channels.

Give us a reasonable window (aim for 90 days) before any public disclosure; we'll keep you updated on the fix timeline and credit you in the release notes if you'd like.

## What's in scope

* The web app code in this repository (bundle behavior, XSS vectors, injection into exported files).
* The Tauri wrapper configuration (CSP, window settings, bundled `dist/` behavior) in `src-tauri/`.
* The schema, RLS policies, and setup instructions in `supabase/schema.sql` and the docs.
* Workflow files under `.github/workflows/` (permission handling, token use).

## What's out of scope

* Your own Supabase project's misconfiguration (this app cannot force hardening on a project the user owns — but we **will** fix wording/setup instructions that invite misconfiguration).
* The Supabase platform, the Tauri framework, Vite, React, or other dependencies — report upstream, unless the vulnerability is triggered *by* Vaultfolio's usage.
* Automated scanner noise against the static deployment — the app is a client bundle with no server-side attack surface of its own.

## Current security posture (honest statement)

* All persisted data goes through Supabase Auth + **Row Level Security** (`auth.uid() = user_id`); there are no service-role bypasses in this repository.
* The Supabase anon key is public by design; Row Level Security is the perimeter, not the key.
* All `VITE_*` build-time variables end up **inside** the shipped bundle — documented in the README and ARCHITECTURE, but worth restating in every contribution review that touches env vars.
* No telemetry, no third-party analytics, no cookies beyond essential auth sessions.
* There is **no end-to-end encryption**, no formally audited dependency tree, and no signed builds yet (no Apple notarization / Windows Authenticode certificate is configured).

## Backup/restore & data safety

* Demo-mode data lives only in browser `localStorage` and is lost when a browser profile is cleared — clear, labelled, and intentional.
* Cloud-mode backups are the user's own Supabase responsibility. The app ships CSV + JSON export in Settings as a secondary escape hatch.
