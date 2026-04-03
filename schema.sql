-- Run this entire file in the Supabase SQL Editor (supabase.com → your project → SQL Editor)

create table if not exists weight_logs (
  id        uuid    default gen_random_uuid() primary key,
  user_id   uuid    references auth.users not null,
  date      text    not null,
  weight    numeric not null,
  timestamp bigint  not null,
  unique (user_id, date)
);

create table if not exists sleep_logs (
  id        uuid    default gen_random_uuid() primary key,
  user_id   uuid    references auth.users not null,
  date      text    not null,
  hours     numeric not null,
  rested    numeric,
  timestamp bigint  not null,
  unique (user_id, date)
);

create table if not exists workout_logs (
  id               uuid    default gen_random_uuid() primary key,
  user_id          uuid    references auth.users not null,
  date             text    not null,
  exercises        jsonb   not null,
  duration_minutes integer,
  unique (user_id, date)
);

create table if not exists custom_exercises (
  id      uuid    default gen_random_uuid() primary key,
  user_id uuid    references auth.users not null,
  name    text    not null,
  is_lift boolean default false,
  is_run  boolean default false,
  unique (user_id, name)
);

-- Row-level security: each user can only see and modify their own rows
alter table weight_logs      enable row level security;
alter table sleep_logs       enable row level security;
alter table workout_logs     enable row level security;
alter table custom_exercises enable row level security;

create policy "Own weight logs"      on weight_logs      for all using (auth.uid() = user_id);
create policy "Own sleep logs"       on sleep_logs       for all using (auth.uid() = user_id);
create policy "Own workout logs"     on workout_logs     for all using (auth.uid() = user_id);
create policy "Own custom exercises" on custom_exercises for all using (auth.uid() = user_id);

-- Migration: add duration_minutes to existing workout_logs tables
-- alter table workout_logs add column if not exists duration_minutes integer;
