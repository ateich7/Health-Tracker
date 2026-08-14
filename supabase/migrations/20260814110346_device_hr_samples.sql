-- Intraday HR samples (~1/minute epochs, the finest grain the watch itself
-- produces), so the Device page's Heart Rate chart can offer sub-day filters
-- (past hour / past 5 hours / today so far) that a one-row-per-day table can't
-- support. `ts` is raw epoch seconds (not a date string) since these are
-- timestamped readings, not daily rollups. Same source/pattern as the other
-- device_* tables -- written by the healthypi-track sync tool only.
create table if not exists device_hr_samples (
  id      uuid    default gen_random_uuid() primary key,
  user_id uuid    references auth.users not null,
  ts      bigint  not null,
  hr      numeric not null,
  hr_min  numeric,
  hr_max  numeric,
  source  text default 'healthypi_move',
  unique (user_id, ts)
);

alter table device_hr_samples enable row level security;
create policy "Own device hr samples" on device_hr_samples for all using (auth.uid() = user_id);

create index if not exists device_hr_samples_user_ts_idx on device_hr_samples (user_id, ts desc);
