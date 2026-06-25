create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  onboarding_complete boolean default false,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
