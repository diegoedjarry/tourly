-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Tournaments table
create table public.tournaments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  country text,
  city text,
  surface text check (surface in ('clay', 'hard', 'grass')),
  category text,
  start_date date not null,
  end_date date,
  sign_up_deadline date,
  withdrawal_deadline date,
  freeze_deadline date,
  is_registered boolean default false,
  is_withdrawn boolean default false,
  is_in_my_list boolean default true,
  prize_money numeric default 0,
  singles_prize_money numeric default 0,
  doubles_prize_money numeric default 0,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Expenses table
create table public.expenses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  tournament_id uuid references public.tournaments(id) on delete set null,
  category text not null,
  amount numeric not null,
  date date not null,
  note text,
  is_coach_expense boolean default false,
  created_at timestamptz default now()
);

-- Row Level Security
alter table public.tournaments enable row level security;
alter table public.expenses enable row level security;

-- Policies: users can only see and modify their own data
create policy "tournaments_own" on public.tournaments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "expenses_own" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tournaments_updated_at
  before update on public.tournaments
  for each row execute function update_updated_at();
