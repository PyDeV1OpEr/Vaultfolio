-- Vaultfolio — Supabase schema (PostgreSQL, Supabase-flavored)
--
-- This file documents the schema actually deployed on the Vaultfolio
-- Supabase project. It was extracted from the live database
-- (information_schema + pg_catalog) — not invented, and it is mirrored by
-- src/lib/storage.ts row mappings. Apply it to a fresh Supabase project
-- with the SQL editor or supabase db push, after Auth is enabled.

-- ============================================================
-- 1. Profiles — one row per authenticated user
-- ============================================================
create table if not exists public.vaultfolio_profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 2. Assets — one physical asset row; attributes are category-specific
-- ============================================================
create table if not exists public.vaultfolio_assets (
  id                       uuid primary key,
  user_id                  uuid not null references auth.users (id) on delete cascade,
  category                 text not null
                             check (category in
                               ('gold_silver','gems_jewelry','watches',
                                'land_property','cars','motorcycles','other')),
  name                     text not null check (length(name) between 1 and 140),
  status                   text not null default 'active'
                             check (status in ('active','sold','archived')),
  attributes_json          jsonb not null default '{}',
  purchase_price_lkr       numeric,
  purchase_currency        text not null default 'LKR',
  purchase_date            date,
  purchase_extra_costs_lkr numeric,
  valuation_value_lkr      numeric,
  valuation_method         text not null default 'unavailable'
                             check (valuation_method in
                               ('live_market','recent_market','calculated','user','indicative','unavailable')),
  valuation_source         text not null default '',
  valuation_confidence     text not null default 'medium'
                             check (valuation_confidence in ('high','medium','low')),
  valuation_note           text,
  valuation_updated_at     timestamptz,
  resale_value_lkr         numeric,
  notes                    text,
  image_url                text,
  sold_date                date,
  sale_proceeds_lkr        numeric,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ============================================================
-- 3. Valuations — append-only turnover history per asset
-- ============================================================
create table if not exists public.vaultfolio_valuations (
  id           uuid primary key,
  asset_id     uuid not null references public.vaultfolio_assets (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  value_lkr    numeric,
  method       text not null
                 check (method in
                   ('live_market','recent_market','calculated','user','indicative','unavailable')),
  source_label text not null default '',
  confidence   text not null default 'medium'
                 check (confidence in ('high','medium','low')),
  note         text,
  recorded_at  timestamptz not null default now()
);
-- Note: deleting an asset cascades to its valuation history.

-- ============================================================
-- 4. Market overrides — one row per user (user-set gold/silver/FX prices)
-- ============================================================
create table if not exists public.vaultfolio_market_overrides (
  id              uuid primary key,
  user_id         uuid not null unique references auth.users (id) on delete cascade,
  gold_per_gram   numeric,
  silver_per_gram numeric,
  usd_lkr         numeric,
  note            text,
  set_at          timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- 5. Row Level Security — every user owns exactly their rows
-- ============================================================
alter table public.vaultfolio_assets          enable row level security;
alter table public.vaultfolio_valuations      enable row level security;
alter table public.vaultfolio_profiles        enable row level security;
alter table public.vaultfolio_market_overrides enable row level security;

create policy "own assets all"
  on public.vaultfolio_assets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own valuations all"
  on public.vaultfolio_valuations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own profile"
  on public.vaultfolio_profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "own overrides all"
  on public.vaultfolio_market_overrides for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 6. Asset-file storage bucket (images)
-- ============================================================
-- A public bucket named 'asset-files' holds asset photos at paths
-- {user_id}/{asset_id}/{filename}; the client uploads with upsert:true.
-- The RLS policies above do NOT apply to storage — configure the bucket's
-- storage policies in Supabase separately (public read, owner-scoped write).

-- ============================================================
-- 7. Self-service setup order
-- ============================================================
-- 1) Create the project on supabase.com (any region with LKR audience in mind).
-- 2) Run this file in the SQL editor.
-- 3) Create the 'asset-files' storage bucket on Dashboard → Storage.
-- 4) Set Site URL / redirect URLs for the deployed web origin when using
--    confirm-email flows.
-- 5) Populate VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in the host env
--    (public-by-design keys; Supabase RLS, not a shared secret, is the fence).
