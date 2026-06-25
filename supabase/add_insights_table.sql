create table public.insights (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  insight_type text not null,
  insight_label text not null,
  content text not null,
  trigger_event text not null default 'daily',
  generated_at timestamptz default now()
);

alter table public.insights enable row level security;
create policy "insights_own" on public.insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
