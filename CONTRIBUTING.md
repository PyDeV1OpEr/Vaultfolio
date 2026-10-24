# Contributing to Vaultfolio

Thanks for helping make Vaultfolio a serious, honest tool for tracking physical wealth. This document covers what you need to know to contribute well.

## Quick setup

```bash
git clone https://github.com/PyDeV1OpEr/Vaultfolio.git
cd Vaultfolio
npm ci                # project uses npm + package-lock.json only
cp .env.example .env  # optional — everything works in demo mode without it
npm run dev           # http://localhost:5173
```

Verify your environment before starting work:

```bash
npm run typecheck && npm run test
```

All 14 unit tests should pass on a fresh clone. If they don't, open an issue rather than patching around it.

## Pull-request process

1. **Branch from `main`** with a descriptive name:
   * `feat/<short-description>` for features
   * `fix/<short-description>` for fixes
   * `docs/<short-description>` for documentation
   * `chore/<short-description>` for tooling/housekeeping
2. Keep one logical change per PR. A two-line evaluation fix and its test belong together; a global rename does not.
3. **Run everything before pushing**: `npm run typecheck && npm run test && npm run build` (there is no separate lint script; strict `tsc` plus coding review catches style issues).
4. Fill in the PR description: what changes, why, what was verified. Attach a screenshot if the UI changed.
5. Wait for CI (typecheck + tests + web build on every PR) before requesting review.

## Code conventions

* **TypeScript strict mode**, no non-null assertions unless provably safe.
* Domain logic belongs in `src/lib/` as pure functions with no React imports — this is what makes it testable. See `valuation.ts` for the pattern (explicit priority ladder, explicit labels, honest fallback state, no fabricated values).
* UI code stays in `src/pages/` and `src/components/`, reads state via the Zustand store hooks, and never talks to Supabase or `localStorage` directly — that's the `DataAdapter` boundary in `src/lib/storage.ts`.
* Persistence changes must be mirrored in both adapters and in `supabase/schema.sql` (and the project README/ARCHITECTURE docs if the flow changes).
* No new runtime dependencies without a stated reason in the PR description.

## Testing expectations

* Every behavior change in `src/lib/` ships with or updates a test in `src/lib/*.test.ts`.
* Valuation math changes especially: the ladder's rules — user-authoritative values always win, no silent substitution, unavailable stays null — are the product's core contract. If your change touches them, add a test that proves the boundary.

## Documentation expectations

If a change affects setup, env vars, the schema, the valuation methodology, or the desktop build, update the corresponding doc (README, `docs/ARCHITECTURE.md`, DESKTOP.md, `supabase/schema.sql`) in the same PR. Docs that drift are worse than docs that are absent.

## Secret handling

* Never commit real credentials — no `.env` containing real values in any PR, ever. The `.env.example` file must contain placeholders only.
* The Supabase **anon key is public by design**, but paste it nowhere except a real Supabase project's own Settings/API page for safety.
* Never point `VITE_METALS_API_URL` at an endpoint whose URL embeds a secret API key — everything `VITE_*` is compiled into the shipped bundle.
* If you find a credential that has already been committed, follow [SECURITY.md](SECURITY.md) — do not post secrets in public issues.

## Where to ask

* Feature ideas / general discussion: open a normal GitHub issue describing the use case.
* Bug reports: include steps to reproduce, the browser/OS, and (if relevant) whether you were in demo or cloud mode and what the UI's own valuation labels said.
* Security/vulnerability reports: see [SECURITY.md](SECURITY.md).
