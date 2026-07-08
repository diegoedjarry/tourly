-- scraper_runs was originally created with a summary-only shape
-- (tournaments_found/added/updated, ran_at, status in success|failed|partial).
-- The scraper (tourly_scraper.py), the trigger-player-scrape edge function, and
-- app/settings.tsx were all built against a newer per-phase shape
-- (phase, started_at, finished_at, rows_found, rows_upserted, status in
-- ok|low_rows|error) that was never actually migrated onto the live table.
-- This backfills that shape without dropping the legacy columns/rows.
--
-- Applied directly to production via Supabase MCP on 2026-07-08.

alter table public.scraper_runs
  alter column ran_at set default now(),
  alter column ran_at drop not null,
  add column if not exists phase          text,
  add column if not exists started_at     timestamptz,
  add column if not exists finished_at    timestamptz,
  add column if not exists rows_found     integer default 0,
  add column if not exists rows_upserted  integer default 0,
  add column if not exists error          text;

alter table public.scraper_runs drop constraint if exists scraper_runs_status_check;
alter table public.scraper_runs add constraint scraper_runs_status_check
  check (status in ('success', 'failed', 'partial', 'ok', 'low_rows', 'error'));

-- Used by trigger-player-scrape's rate-limit check (phase='dispatch' AND started_at >= since)
create index if not exists scraper_runs_phase_started_at_idx
  on public.scraper_runs (phase, started_at);

-- Used by settings.tsx's "last scrape" indicator (order by finished_at desc limit 1)
create index if not exists scraper_runs_finished_at_idx
  on public.scraper_runs (finished_at desc);
