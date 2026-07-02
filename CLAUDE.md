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

## Supabase schema (5 tables, all with RLS — users see only their own rows)
| Table | Key columns |
|---|---|
| `weight_logs` | `user_id, date, weight, timestamp` — unique on `(user_id, date)` |
| `sleep_logs` | `user_id, date, hours, rested, timestamp` — unique on `(user_id, date)` |
| `workout_logs` | `user_id, date, exercises` (JSONB array) — unique on `(user_id, date)` |
| `custom_exercises` | `user_id, name, is_lift, is_run` — unique on `(user_id, name)` |
| `psych_logs` | `user_id, date, confidence, stress, low, release` — unique on `(user_id, date)` |

All upserts use `onConflict: 'user_id,date'` (or `user_id,name`) so re-logging a day overwrites rather than duplicates.

## Key architectural patterns

### Page routing
`showPage(name)` toggles `.active` on `.page` divs and `.nav-item` / `.bottom-nav-item` elements. No router library.

### Data flow
1. `initApp()` is called once (guarded by `appInitialized` flag) when Supabase auth state confirms a session
2. `loadData()` fetches all tables from Supabase and stores results in module-level arrays (`weightData`, `sleepData`, `workoutData`, `psychData`, `customExercises`)
3. `refreshUI()` re-renders all charts and chips from those cached arrays — called after every log operation

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
