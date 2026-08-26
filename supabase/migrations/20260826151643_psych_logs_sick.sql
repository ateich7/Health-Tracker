-- Adds a "sick" flag to psych_logs, alongside the existing "released" flag,
-- so the Signals log card can record whether the user was sick yesterday.
alter table psych_logs add column if not exists sick boolean;
