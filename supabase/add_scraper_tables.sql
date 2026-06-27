-- ============================================================
-- Tourly Scraper Tables
-- Run this migration once in your Supabase SQL editor.
-- ============================================================

-- Global ITF tournament catalog (scraper writes here, no user_id)
create table if not exists public.itf_tournaments (
  id                  uuid primary key default gen_random_uuid(),
  itf_id              text unique,
  name                text not null,
  city                text,
  country             text,
  surface             text check (surface in ('clay', 'hard', 'grass')),
  category            text,
  start_date          date not null,
  end_date            date,
  prize_money_total   numeric,
  is_auto_populated   boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists itf_tournaments_start_date_idx on public.itf_tournaments (start_date);
create index if not exists itf_tournaments_country_idx    on public.itf_tournaments (country);

-- Trigger: keep updated_at current
create or replace function update_itf_tournaments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists itf_tournaments_updated_at on public.itf_tournaments;
create trigger itf_tournaments_updated_at
  before update on public.itf_tournaments
  for each row execute function update_itf_tournaments_updated_at();

-- RLS: public read, no writes from client (service role only)
alter table public.itf_tournaments enable row level security;

drop policy if exists "itf_tournaments_public_read" on public.itf_tournaments;
create policy "itf_tournaments_public_read" on public.itf_tournaments
  for select using (true);


-- Player performance profiles (scraper writes via service role key)
create table if not exists public.player_profiles (
  id                  uuid primary key default gen_random_uuid(),
  ipin                text unique not null,
  player_name         text,
  current_ranking     integer,
  ranking_evolution   jsonb,    -- [{date: "YYYY-MM-DD", ranking: int}]
  win_loss_by_surface jsonb,    -- {clay:{wins,losses}, hard:{wins,losses}, grass:{wins,losses}}
  match_history       jsonb,    -- [{tournamentName, date, roundReached, pointsEarned, opponent, score, surface}]
  points_defending    jsonb,    -- [{weekOf:"YYYY-MM-DD", points:int, tournamentName}]
  last_updated        timestamptz,
  created_at          timestamptz not null default now()
);

-- RLS: each user owns their own profile row (matched by ipin stored in profiles.ipin_number)
alter table public.player_profiles enable row level security;

drop policy if exists "player_profiles_own_read" on public.player_profiles;
create policy "player_profiles_own_read" on public.player_profiles
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.ipin_number = player_profiles.ipin
    )
  );


-- Scraper run log
create table if not exists public.scraper_runs (
  id                   uuid primary key default gen_random_uuid(),
  ran_at               timestamptz not null,
  tournaments_found    integer not null default 0,
  tournaments_added    integer not null default 0,
  tournaments_updated  integer not null default 0,
  status               text not null check (status in ('success', 'failed', 'partial')),
  error_message        text,
  created_at           timestamptz not null default now()
);

-- RLS: readable by all authenticated users (powers home screen indicator)
alter table public.scraper_runs enable row level security;

drop policy if exists "scraper_runs_authenticated_read" on public.scraper_runs;
create policy "scraper_runs_authenticated_read" on public.scraper_runs
  for select using (auth.role() = 'authenticated');
