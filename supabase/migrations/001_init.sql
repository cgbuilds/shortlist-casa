-- Property Matrix v1 schema. Run in the Supabase SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.matrices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  catalog_version text not null,
  payload jsonb not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query jsonb not null,
  listing_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.graded_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id text not null,
  property jsonb not null,
  scores jsonb,
  created_at timestamptz not null default now()
);

create index if not exists matrices_user_active on public.matrices (user_id, is_active);
create index if not exists graded_user_listing on public.graded_listings (user_id, listing_id);

alter table public.profiles enable row level security;
alter table public.matrices enable row level security;
alter table public.searches enable row level security;
alter table public.graded_listings enable row level security;

create policy "own profiles" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own matrices" on public.matrices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own searches" on public.searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own grades" on public.graded_listings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
