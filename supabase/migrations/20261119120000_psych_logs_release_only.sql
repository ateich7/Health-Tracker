-- The Home "Release" card logs only psych_logs.released, so the Signals
-- score columns must be optional for days with no Signals entry.
alter table psych_logs alter column confidence drop not null;
alter table psych_logs alter column stress drop not null;
alter table psych_logs alter column low drop not null;
