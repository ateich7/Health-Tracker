-- Daily calorie category, one row per day (Home "Diet" card upserts today's).
-- losing = at/under the weight-loss budget, maintaining = above budget but at
-- or under maintenance, gaining = over maintenance.
create table if not exists diet_logs (
  id         uuid    default gen_random_uuid() primary key,
  user_id    uuid    references auth.users not null,
  date       text    not null,
  category   text    not null check (category in ('losing', 'maintaining', 'gaining')),
  timestamp  bigint  not null,
  unique (user_id, date)
);

alter table diet_logs enable row level security;
create policy "Own diet logs" on diet_logs for all using (auth.uid() = user_id);
