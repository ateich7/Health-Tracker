-- Intraday skin temperature samples (~5-minute epochs, the finest grain the
-- watch itself produces), same rationale and pattern as device_hr_samples --
-- powers the Device page's Skin Temperature chart sub-day filters. No
-- min/max columns here (unlike device_hr_samples): the firmware only emits
-- one skin_temp value per epoch, not a per-epoch min/max pair. Same
-- source/pattern as the other device_* tables -- written by the
-- healthypi-track sync tool only.
create table if not exists device_skin_temp_samples (
  id         uuid    default gen_random_uuid() primary key,
  user_id    uuid    references auth.users not null,
  ts         bigint  not null,
  skin_temp  numeric not null,
  source     text default 'healthypi_move',
  unique (user_id, ts)
);

alter table device_skin_temp_samples enable row level security;
create policy "Own device skin temp samples" on device_skin_temp_samples for all using (auth.uid() = user_id);

create index if not exists device_skin_temp_samples_user_ts_idx on device_skin_temp_samples (user_id, ts desc);
