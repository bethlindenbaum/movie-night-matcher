-- MovieMatch Supabase schema
-- Run this entire file in the Supabase SQL Editor on a new project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  streaming_services text[] not null default '{}',
  genre_preferences text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friendships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.movie_selections (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  movie_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id, movie_id)
);

create table if not exists public.my_list (
  user_id uuid not null references public.profiles(id) on delete cascade,
  movie_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

-- Create a profile automatically after Supabase Auth creates a user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  desired_username text;
begin
  desired_username := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  insert into public.profiles (id, username, streaming_services, genre_preferences)
  values (new.id, desired_username, array['Netflix']::text[], array['Comedy','Drama']::text[]);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Helper used by RLS. SECURITY DEFINER avoids recursive membership-policy checks.
create or replace function public.is_group_member(target_group uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = target_group and gm.user_id = target_user
  );
$$;

-- Add a friendship in both directions by username.
create or replace function public.add_friend_by_username(friend_username text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  select id into target from public.profiles where username = lower(friend_username);
  if target is null then raise exception 'No user with that username'; end if;
  if target = me then raise exception 'You cannot add yourself'; end if;
  insert into public.friendships(user_id, friend_id) values (me, target) on conflict do nothing;
  insert into public.friendships(user_id, friend_id) values (target, me) on conflict do nothing;
  return target;
end;
$$;

create or replace function public.get_my_friends()
returns table(id uuid, username text, streaming_services text[], genre_preferences text[])
language sql
stable
security definer set search_path = ''
as $$
  select p.id, p.username, p.streaming_services, p.genre_preferences
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
  order by p.username;
$$;

create or replace function public.create_group_with_members(group_name text, member_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_group uuid;
  member uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  insert into public.groups(name, created_by) values (group_name, me) returning id into new_group;
  insert into public.group_members(group_id, user_id) values (new_group, me);

  foreach member in array coalesce(member_ids, '{}'::uuid[]) loop
    if member <> me and exists (
      select 1 from public.friendships where user_id = me and friend_id = member
    ) then
      insert into public.group_members(group_id, user_id) values (new_group, member) on conflict do nothing;
    end if;
  end loop;
  return new_group;
end;
$$;

create or replace function public.get_my_groups()
returns table(
  group_id uuid,
  group_name text,
  created_by uuid,
  created_at timestamptz,
  members jsonb,
  selections jsonb
)
language sql
stable
security definer set search_path = ''
as $$
  select
    g.id,
    g.name,
    g.created_by,
    g.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'streaming_services', p.streaming_services,
        'genre_preferences', p.genre_preferences
      ) order by p.username)
      from public.group_members gm
      join public.profiles p on p.id = gm.user_id
      where gm.group_id = g.id
    ), '[]'::jsonb) as members,
    coalesce((
      select jsonb_object_agg(username, movies)
      from (
        select p.username, coalesce(jsonb_agg(ms.movie_id order by ms.created_at) filter (where ms.movie_id is not null), '[]'::jsonb) as movies
        from public.group_members gm
        join public.profiles p on p.id = gm.user_id
        left join public.movie_selections ms on ms.group_id = gm.group_id and ms.user_id = gm.user_id
        where gm.group_id = g.id
        group by p.username
      ) s
    ), '{}'::jsonb) as selections
  from public.groups g
  where public.is_group_member(g.id, auth.uid())
  order by g.created_at desc;
$$;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.movie_selections enable row level security;
alter table public.my_list enable row level security;

-- Profiles: authenticated users can find usernames; only owners can modify their profile.
drop policy if exists "authenticated can read profiles" on public.profiles;
create policy "authenticated can read profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Friendships are read directly only by the owner. Inserts happen through the RPC above.
drop policy if exists "users read own friendships" on public.friendships;
create policy "users read own friendships" on public.friendships for select to authenticated using (user_id = auth.uid());

-- Group data is visible only to members.
drop policy if exists "members read groups" on public.groups;
create policy "members read groups" on public.groups for select to authenticated using (public.is_group_member(id));
drop policy if exists "members read group members" on public.group_members;
create policy "members read group members" on public.group_members for select to authenticated using (public.is_group_member(group_id));

-- Users can read selections in their groups, but only insert/delete their own picks.
drop policy if exists "members read selections" on public.movie_selections;
create policy "members read selections" on public.movie_selections for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "users add own selections" on public.movie_selections;
create policy "users add own selections" on public.movie_selections for insert to authenticated with check (user_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists "users delete own selections" on public.movie_selections;
create policy "users delete own selections" on public.movie_selections for delete to authenticated using (user_id = auth.uid() and public.is_group_member(group_id));

-- Personal list is private.
drop policy if exists "users read own list" on public.my_list;
create policy "users read own list" on public.my_list for select to authenticated using (user_id = auth.uid());
drop policy if exists "users add own list" on public.my_list;
create policy "users add own list" on public.my_list for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users delete own list" on public.my_list;
create policy "users delete own list" on public.my_list for delete to authenticated using (user_id = auth.uid());

-- Allow live movie-selection updates for group members.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movie_selections'
  ) then
    alter publication supabase_realtime add table public.movie_selections;
  end if;
end $$;
