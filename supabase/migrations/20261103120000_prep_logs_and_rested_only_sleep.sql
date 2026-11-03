-- Interview prep hours, one row per day (Home "Prep" card upserts today's total).
create table if not exists prep_logs (
  id         uuid    default gen_random_uuid() primary key,
  user_id    uuid    references auth.users not null,
  date       text    not null,
  hours      numeric not null,
  timestamp  bigint  not null,
  unique (user_id, date)
);

alter table prep_logs enable row level security;
create policy "Own prep logs" on prep_logs for all using (auth.uid() = user_id);

-- The Home sleep card now logs only restedness, so hours slept is optional.
alter table sleep_logs alter column hours drop not null;
