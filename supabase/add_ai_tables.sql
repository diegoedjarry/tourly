create table public.coaching_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  message text not null,
  created_at timestamptz default now()
);

alter table public.coaching_messages enable row level security;
create policy "coaching_own" on public.coaching_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.reflections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  period_type text not null,
  period_label text not null,
  summary text not null,
  created_at timestamptz default now()
);

alter table public.reflections enable row level security;
create policy "reflections_own" on public.reflections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
