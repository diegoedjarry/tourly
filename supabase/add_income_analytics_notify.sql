-- Record of migrations applied directly to the live project (July 2026).
-- Kept here so the repo's SQL reflects the real schema; running this file
-- against a fresh database recreates the same state (all statements idempotent).

-- ── Income ledger (sponsors / federation / stipends / other) ─────────────────
create table if not exists public.income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text,
  type text not null check (type in ('sponsor','federation','stipend','other')),
  amount numeric not null,
  currency text not null default 'USD',
  amount_usd numeric,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.income enable row level security;
do $$ begin
  create policy "own income select" on public.income for select to authenticated using (auth.uid() = user_id);
  create policy "own income insert" on public.income for insert to authenticated with check (auth.uid() = user_id);
  create policy "own income update" on public.income for update to authenticated using (auth.uid() = user_id);
  create policy "own income delete" on public.income for delete to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists income_user_date_idx on public.income (user_id, date desc);

-- ── Profile-matched new-tournament notifications opt-in ──────────────────────
alter table public.profiles
  add column if not exists notify_new_tournaments boolean not null default false;

-- ── First-party usage analytics ──────────────────────────────────────────────
-- Insert-only from clients; no read policy — events are queried by the owner
-- from the Supabase SQL editor only.
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event text not null,
  screen text,
  props jsonb,
  app_version text,
  platform text,
  created_at timestamptz not null default now()
);
alter table public.analytics_events enable row level security;
do $$ begin
  create policy "analytics_insert_own" on public.analytics_events
    for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists analytics_events_created_idx on public.analytics_events (created_at desc);
create index if not exists analytics_events_event_idx on public.analytics_events (event, created_at desc);

-- ── Security hardening (also applied live) ───────────────────────────────────
-- shared_tournaments / shared_expenses views were recreated with
-- `and (sa.shared_with_id = auth.uid() or sa.owner_id = auth.uid())`;
-- delete_user_account() now also wipes income, trip_estimates,
-- coaching_messages, reflections, training_blocks and shared_access.
-- See .claude/security-audit-2026-07.md for the full statement list.
