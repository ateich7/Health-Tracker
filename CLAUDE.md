# Health Tracker — CLAUDE.md

## What this app is
A personal health tracking desktop + web app. Tracks weight, sleep, workouts, and psychological signals (confidence, stress, low mood, release days). Built as an Electron desktop app (macOS) and deployed to Vercel as a static web app from the same codebase.

## Tech stack
- **Electron** (`main.js`) — macOS desktop wrapper, no Node APIs exposed to renderer
- **Vanilla JS / HTML / CSS** — no frontend framework; `renderer.js` is the entire app logic
- **Supabase** — PostgreSQL database + auth (email/password). `supabase-client.js` initializes the client and exposes `signIn`, `signUp`, `signOut`, `migrateLocalData`
- **Chart.js 3.9.1** — all charts (weight trend, sleep, signals scores, exercise progress)
- **localStorage** — used as a write-through cache and offline draft store for workout sessions

## File structure
```
index.html          — app shell; all pages are in the DOM, shown/hidden via CSS classes
renderer.js         — all app logic (~1700 lines); organized into labeled sections
styles.css          — all styles; organized into labeled sections
supabase-client.js  — Supabase initialization and auth functions
main.js             — Electron main process (window creation, geolocation permission)
package.json        — scripts for building and deploying
assets/             — app icons
```

## Supabase schema (12 tables, all with RLS — users see only their own rows)
| Table | Key columns |
|---|---|
| `weight_logs` | `user_id, date, weight, timestamp` — unique on `(user_id, date)` |
| `sleep_logs` | `user_id, date, hours, rested, timestamp` — unique on `(user_id, date)` |
| `workout_logs` | `user_id, date, exercises` (JSONB array) — unique on `(user_id, date)` |
| `custom_exercises` | `user_id, name, is_lift, is_run` — unique on `(user_id, name)` |
| `psych_logs` | `user_id, date, confidence, stress, low, released, sick` — unique on `(user_id, date)` |
| `social_logs` | `user_id, date`, one integer column per stakes tier — unique on `(user_id, date)` |
| `device_sleep_logs` | `user_id, date, date_ts, start_ts, end_ts`, stage minutes, `score` + sub-scores — unique on `(user_id, date)` |
| `device_stress_logs` | `user_id, date, date_ts, avg_stress, max_stress, avg_hrv_rmssd, avg_hrv_sdnn, resting_hr` — unique on `(user_id, date)` |
| `device_activity_logs` | `user_id, date, date_ts, steps, active_energy` — unique on `(user_id, date)` |
| `device_vitals_logs` | `user_id, date, date_ts`, HR range, SpO2, skin temp, BP, ECG HR, HRV extras, EDA (all nullable) — unique on `(user_id, date)` |
| `device_hr_samples` | `user_id, ts, hr, hr_min, hr_max` — intraday (~1/min) HR epochs, not a daily rollup — unique on `(user_id, ts)`; powers the Device page HR chart's past-hour/5-hour/today/24-hour filters |
| `device_skin_temp_samples` | `user_id, ts, skin_temp` — intraday (~5/min) skin temp epochs, no min/max pair (one value per epoch) — unique on `(user_id, ts)`; same purpose as `device_hr_samples`, for the Skin Temperature chart |

All upserts use `onConflict: 'user_id,date'` (or `user_id,name`) so re-logging a day overwrites rather than duplicates.

The `device_*` tables are **read-only from this app's perspective** — they're written by a separate Python BLE sync tool ([`healthypi-track`](../healthypi-track), for the ProtoCentral HealthyPi Move watch), not by any UI here. The four daily-rollup tables' `date` column matches every other table's `M/D/YYYY` (`toLocaleDateString()`) text format, but ordering/sorting must use the numeric `date_ts` column instead — `date` sorts lexicographically, not chronologically, and none of these tables has the `timestamp` bigint column other tables use for that purpose. `device_hr_samples` and `device_skin_temp_samples` are the exceptions to the daily-rollup pattern: both are intraday (`ts`, raw epoch seconds, no `date`/`date_ts` at all), fetched on demand by their respective Device page charts rather than eagerly in `loadData()`.

## Key architectural patterns

### Page routing
`showPage(name)` toggles `.active` on `.page` divs and `.nav-item` / `.bottom-nav-item` elements. No router library.

### Data flow
1. `initApp()` is called once (guarded by `appInitialized` flag) when Supabase auth state confirms a session
2. `loadData()` fetches all tables from Supabase and stores results in module-level arrays (`weightData`, `sleepData`, `workoutData`, `psychData`, `customExercises`, `deviceSleepData`, `deviceStressData`, `deviceActivityData`)
3. `refreshUI()` re-renders all charts and chips from those cached arrays — called after every log operation

### Device page
Read-only dashboard (`updateDeviceCharts()` and friends, near the end of `renderer.js`) for the `device_*` tables — no logging UI, since an external tool writes them. Each chart goes through a shared `renderDeviceChart()` helper that shows a "no device data synced yet" message instead of an empty canvas when its table has no rows. Heart Rate and Skin Temperature are the two exceptions with range filters (Past Hour / Past 5 Hours / Today / Last 24 Hours / This Week, `setDeviceHrRange()` / `setDeviceSkinTempRange()`): "This Week" plots the eagerly-loaded `deviceVitalsData` daily rollup like every other chart, but the four intraday ranges `await fetchDeviceIntradaySamples(table, cutoffTs)` (shared helper, table name + `deviceIntradayRangeCutoff()` passed in) against `device_hr_samples` / `device_skin_temp_samples` on click instead, since a day only has one rollup point to plot. SpO2/BP/ECG/HRV/EDA/stress don't get this treatment — they're manual spot-checks or (for HRV/stress) currently produce zero samples, so there's no continuous stream to filter into sub-day ranges.

### Chip / task-completion state
Each tab (sleep, signals, workout, social — both sidebar `.nav-item` and mobile `.bottom-nav-item`) has a `.task-dot` on its icon that signals the task is *not yet* done today; it disappears once `toggleTask()` adds `.completed` to the chip. Workout is only needed Mon/Wed/Fri, so `loadData()` adds `.no-task-today` to the workout chip/tab on other days to hide its dot regardless of completion. The standalone Codes button (Signals page) is unrelated to tabs and still uses the old `.chip-check` checkmark, shown when logged.

### Workout drafts
The active workout form auto-saves to `localStorage` on every input (`saveWorkoutDraft()`). On load, `restoreWorkoutDraft()` repopulates the form. Draft is cleared on successful save.

### Session timer
Starts on the first input event in a workout session (one-shot listener). Adds 15 minutes to the elapsed time to account for warm-up before the timer started.

### Exercise type inference
Exercise type is determined by the number of sets in the data array: 3 items = run (distance/pace/time), 2 items = lift (weight/reps), 1 item = bodyweight (reps only).

### Workout plan tracking (`planWorkoutDates`)
`logWorkout()` tags each saved workout with a `planDate` (the date the plan was assigned, not necessarily logged). `getLastWorkoutForPlan()` first looks for a workout with a matching `planDate` tag, then falls back to >50% exercise overlap.

### Moving averages
7-day trailing moving averages are computed and overlaid on the weight, sleep hours, restedness, and all signals charts.

## After making any changes
Always run the full build after making changes — this pushes to GitHub, deploys to Vercel, and rebuilds the Electron app:
```bash
npm run build
```

## Build & deploy
```bash
npm run build
```
This single command does everything:
1. `git add -A && git commit -m 'Deploy' && git push` — commits and pushes to GitHub
2. `npx vercel --prod` — deploys to Vercel (static web)
3. `npm run install-app` — builds the Electron `.app`, kills any running instance, copies to `/Applications`, and reopens

To only build the Electron app (no deploy):
```bash
npm run install-app
```

## Environment notes
- `SUPABASE_ANON_KEY` in `supabase-client.js` is a **public/publishable key** — safe to commit
- Weather uses the Open-Meteo API (no key required) with hardcoded coordinates; geolocation is currently disabled in `loadWeather()` but the `getLocation()` helper is there if re-enabled
- The Electron app requires macOS (`darwin`) for the dock/activate behavior; Windows/Linux just quit on window close
