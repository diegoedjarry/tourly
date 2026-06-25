-- Match results table — stores per-round results for each tournament
create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  round text not null,            -- R1, R2, R3, QF, SF, F, W
  opponent text,
  score text,
  points integer default 0,
  created_at timestamptz default now()
);

alter table public.match_results enable row level security;

create policy "match_results_own" on public.match_results
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Add ranking columns to tournaments
alter table public.tournaments
  add column if not exists ranking_before integer,
  add column if not exists ranking_after integer,
  add column if not exists points_earned integer default 0,
  add column if not exists traveled_with_coach boolean default false;
