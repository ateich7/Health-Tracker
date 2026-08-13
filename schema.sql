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
  id           uuid    default gen_random_uuid() primary key,
  user_id      uuid    references auth.users not null,
  date         text    not null,
  hours        numeric not null,
  rested       numeric,
  time_in_bed  numeric,
  timestamp    bigint  not null,
  unique (user_id, date)
);

create table if not exists workout_logs (
  id               uuid    default gen_random_uuid() primary key,
  user_id          uuid    references auth.users not null,
  date             text    not null,
  exercises        jsonb   not null,
  duration_minutes integer,
  plan_key         text,
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

create table if not exists social_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  date text not null,
  no_stakes integer default 0,
  low_stakes integer default 0,
  med_stakes integer default 0,
  high_stakes integer default 0,
  extreme_stakes integer default 0,
  real_stakes integer default 0,
  unique (user_id, date)
);

alter table social_logs enable row level security;
create policy "Own social logs" on social_logs for all using (auth.uid() = user_id);

-- Migrations for existing workout_logs tables
-- alter table workout_logs add column if not exists duration_minutes integer;
-- alter table workout_logs add column if not exists plan_key text;

-- Migration for existing sleep_logs tables (CBT-I: time in bed, for sleep efficiency)
-- alter table sleep_logs add column if not exists time_in_bed numeric;

-- Migration for existing social_logs tables (added tiers 5 & 6: extreme/real stakes)
-- alter table social_logs add column if not exists extreme_stakes integer default 0;
-- alter table social_logs add column if not exists real_stakes integer default 0;

-- Device sync tables (HealthyPi Move)
-- These are populated by a separate Python sync tool that talks to the HealthyPi
-- Move watch over Bluetooth, computes nightly sleep scores/stages, daily stress
-- summaries, and daily activity rollups, and pushes them here. This app only
-- reads from these tables (Device page) — there is no logging UI for them here.
create table if not exists device_sleep_logs (
  id                uuid    default gen_random_uuid() primary key,
  user_id           uuid    references auth.users not null,
  date              text    not null,
  date_ts           bigint  not null,  -- local-midnight epoch seconds for `date`; sort/order by this, not `date` (text "M/D/YYYY" sorts lexicographically, not chronologically)
  start_ts          bigint  not null,
  end_ts            bigint  not null,
  duration_minutes  numeric not null,
  efficiency        numeric not null,
  light_minutes     numeric not null,
  deep_minutes      numeric not null,
  rem_minutes       numeric not null,
  wake_minutes      numeric not null,
  score             numeric not null,
  duration_score    numeric,
  efficiency_score  numeric,
  restorative_score numeric,
  consistency_score numeric,
  disturbance_score numeric,
  source            text default 'healthypi_move',
  unique (user_id, date)
);

create table if not exists device_stress_logs (
  id            uuid    default gen_random_uuid() primary key,
  user_id       uuid    references auth.users not null,
  date          text    not null,
  date_ts       bigint  not null,  -- see device_sleep_logs.date_ts comment
  avg_stress    numeric,
  max_stress    numeric,
  avg_hrv_rmssd numeric,
  avg_hrv_sdnn  numeric,
  resting_hr    numeric,
  sample_count  integer,
  source        text default 'healthypi_move',
  unique (user_id, date)
);

create table if not exists device_activity_logs (
  id            uuid    default gen_random_uuid() primary key,
  user_id       uuid    references auth.users not null,
  date          text    not null,
  date_ts       bigint  not null,  -- see device_sleep_logs.date_ts comment
  steps         integer,
  active_energy numeric,
  source        text default 'healthypi_move',
  unique (user_id, date)
);

alter table device_sleep_logs    enable row level security;
alter table device_stress_logs   enable row level security;
alter table device_activity_logs enable row level security;

create policy "Own device sleep logs"    on device_sleep_logs    for all using (auth.uid() = user_id);
create policy "Own device stress logs"   on device_stress_logs   for all using (auth.uid() = user_id);
create policy "Own device activity logs" on device_activity_logs for all using (auth.uid() = user_id);

-- Daily vitals rollup: everything the watch measures that isn't already covered
-- above (sleep, stress index/HRV/resting-HR, steps/energy). Same source/pattern
-- as the other device_* tables -- written by the healthypi-track sync tool only.
create table if not exists device_vitals_logs (
  id                uuid    default gen_random_uuid() primary key,
  user_id           uuid    references auth.users not null,
  date              text    not null,
  date_ts           bigint  not null,
  hr_avg            numeric,
  hr_min            numeric,
  hr_max            numeric,
  spo2_avg          numeric,
  spo2_min          numeric,
  skin_temp_avg     numeric,
  skin_temp_min     numeric,
  skin_temp_max     numeric,
  skin_temp_dev_avg numeric,
  bp_systolic_avg   numeric,
  bp_diastolic_avg  numeric,
  bp_reading_count  integer,
  ecg_hr_avg        numeric,
  hrv_lfhf_avg      numeric,
  hrv_mean_rr_avg   numeric,
  hrv_coverage_avg  numeric,
  eda_scl_avg       numeric,
  eda_scr_rate_avg  numeric,
  source            text default 'healthypi_move',
  unique (user_id, date)
);

alter table device_vitals_logs enable row level security;
create policy "Own device vitals logs" on device_vitals_logs for all using (auth.uid() = user_id);
