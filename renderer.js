// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE
// All data arrays are loaded once on sign-in and kept in sync with Supabase.
// localStorage is used as a lightweight cache so chart functions can read
// workout data without re-fetching on every render.
// ─────────────────────────────────────────────────────────────────────────────
let weightData  = [];   // rows from weight_logs
let sleepData   = [];   // rows from sleep_logs
let psychData   = [];   // rows from psych_logs
let workoutLogs = [];   // rows from workout_logs (includes duration_minutes)
let socialData  = [];   // rows from social_logs

// Read-only: written by the separate HealthyPi Move Python sync tool, never by this app
let deviceSleepData    = []; // rows from device_sleep_logs
let deviceStressData   = []; // rows from device_stress_logs
let deviceActivityData = []; // rows from device_activity_logs
let deviceVitalsData   = []; // rows from device_vitals_logs (HR, SpO2, skin temp, BP, ECG HR, HRV, EDA)

// 'week' plots deviceVitalsData's daily rollup (already loaded above); the
// finer ranges query device_hr_samples (~1/min HR epochs) on demand instead of
// loading it eagerly, since a week of 1-minute samples is ~10k rows and the
// other three ranges only ever need a slice of the last day.
let deviceHrRange = 'week';

// Same pattern as deviceHrRange, backed by device_skin_temp_samples instead.
let deviceSkinTempRange = 'week';

const SOCIAL_CATEGORIES = ['no_stakes', 'low_stakes', 'med_stakes', 'high_stakes', 'extreme_stakes', 'real_stakes'];

let weightPeriodDays = 30; // how many days the weight chart shows; 0 = all time
let sleepPeriodDays  = window.innerWidth <= 768 ? 7 : 14;
const sleepLineToggles = {
  hours: true, hoursAvg: true,
  timeInBed: true, timeInBedAvg: true,
  rested: true, restedAvg: true,
  efficiency: true, efficiencyAvg: true
};
let signalsPeriodDays = window.innerWidth <= 768 ? 7 : 14;
const signalLineToggles = { confidence: true, stress: true, low: true };
let socialDays = 7;
let exercisePeriodDays = 30; // how many logged entries the exercise chart shows; 0 = all time
// value1/value2 are generic since their meaning depends on exercise type (see
// updateExerciseChart): reps/weight for lifts, distance/time for runs
const exerciseLineToggles = { value1: true, value2: true };

let weightChart         = null; // Chart.js instances — destroyed & rebuilt on each render
let exerciseChart       = null;
let sleepChart          = null;
let signalsChart        = null;
let socialChart         = null;
let deviceSleepChart    = null;
let deviceStressChart   = null;
let deviceActivityChart = null;
let deviceHrChart       = null;
let deviceSpo2Chart     = null;
let deviceSkinTempChart = null;
let deviceHrvChart      = null;
let deviceEdaChart      = null;
let deviceBpChart       = null;

let currentUser        = null; // Supabase user object, set after sign-in
let editingWorkoutDate = null; // non-null while editing a past workout; logWorkout() saves to this date
let workoutTimerStart  = null; // ms timestamp of first input during a workout session

// ─────────────────────────────────────────────────────────────────────────────
// WORKOUT PLANS
// Three fixed weekly plans. Custom exercises added by the user are stored in
// Supabase (custom_exercises table) and cached in localStorage under "customExercises".
// Exercise types:
//   isLift: true  → inputs are [reps, lbs] per set
//   isRun:  true  → inputs are [miles, minutes, seconds] per set
//   both false    → bodyweight, input is [reps] per set
// ─────────────────────────────────────────────────────────────────────────────
const monWorkout = [
  { name: "Pushups", sets: 4, isLift: false, isRun: false },
  { name: "Pullup & Chinup", sets: 4, isLift: false, isRun: false },
  { name: "Situps", sets: 4, isLift: false, isRun: false },
  { name: "Handstand Pushups", sets: 4, isLift: false, isRun: false },
  { name: "Wall Angels", sets: 4, isLift: false, isRun: false },
];

const wedWorkout = [
  { name: "Run", sets: 1, isLift: false, isRun: true },
  { name: "Hip Abductors", sets: 4, isLift: true, isRun: false },
  { name: "Goblet Squats", sets: 4, isLift: true, isRun: false },
  { name: "Back Extensions", sets: 4, isLift: true, isRun: false }
];

const friWorkout = [
  { name: "Shoulder Press", sets: 4, isLift: true, isRun: false },
  { name: "Shoulder Raise", sets: 4, isLift: true, isRun: false },
  { name: "Chest Press", sets: 4, isLift: true, isRun: false },
  { name: "Dumbbell Row", sets: 4, isLift: true, isRun: false },
  { name: "Dead Bug & Starfish", sets: 4, isLift: false, isRun: false },
  { name: "Rowing Machine", sets: 1, isLift: false, isRun: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// APP INIT
// ─────────────────────────────────────────────────────────────────────────────

// Writes today's date (e.g. "May 21st") into the header
function formatDate() {
  const date = new Date();
  const day = date.toLocaleDateString("en-US", { day: "numeric" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const suffix = ["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : (day % 100 - day % 10 != 10) * day % 10];
  document.getElementById('dateToday').textContent = `${month} ${day}${suffix}`;
}

// Called by the auth handler once a valid session exists; bootstraps the whole UI
async function initApp() {
  const { data: { user } } = await db.auth.getUser();
  currentUser = user;

  formatDate();
  renderWorkoutSelector(); // show the plan picker immediately (before data loads)

  activatePage('home');

  // Mark the correct sleep filter button active based on screen size
  document.querySelectorAll('.sleep-filter-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.days) === sleepPeriodDays);
  });
  document.querySelectorAll('.signals-filter-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.days) === signalsPeriodDays);
  });

  await loadData();

  // Allow pressing Enter to submit the weight field
  document.getElementById('weightInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') logWeight();
  });
}

// Switches the visible page AND refreshes the chart that just became visible,
// then persists the selection to localStorage
function showPage(name) {
  activatePage(name);
  localStorage.setItem('activePage', name);

  // Refresh the chart(s) that just became visible
  if (name === 'data') { updateWeightChart(); updateSleepChart(); updateSignalsChart(); updateExerciseChart(); updateSocialChart(); }
  else if (name === 'device') updateDeviceCharts();
  // #workoutHistory is 0-height while the page is hidden, so the fit-to-height
  // pass renderWorkoutHistory() ran while loading data (before any page was
  // switched to) measured nothing — ResizeObserver doesn't reliably catch an
  // ancestor's display:none→flex transition, so re-run it explicitly now that
  // activatePage() above has made the page's real height measurable.
  else if (name === 'workout') fitWorkoutHistoryRows();
}

// Pure DOM page-switch: shows the right .page div and highlights the nav item.
// Called by showPage (which also handles charts/storage) and by initApp (no chart refresh needed yet).
function activatePage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll(`.nav-item[data-page="${name}"], .bottom-nav-item[data-page="${name}"]`)
    .forEach(n => n.classList.add('active'));
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA LOADING
// All five tables are fetched in parallel on init and cached locally.
// ─────────────────────────────────────────────────────────────────────────────

// Deletes a workout entry from Supabase and the localStorage cache
async function deleteWorkoutEntry(date) {
  await db.from('workout_logs').delete().eq('user_id', currentUser.id).eq('date', date);
  const allWorkouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  delete allWorkouts[date];
  localStorage.setItem('workouts', JSON.stringify(allWorkouts));
}

// Fetches all data from Supabase, rebuilds the localStorage workout cache,
// marks today's chips complete, and triggers the initial UI render
async function loadData() {
  const [weightsRes, sleepsRes, workoutsRes, customExRes, psychRes, socialRes,
         deviceSleepRes, deviceStressRes, deviceActivityRes, deviceVitalsRes] = await Promise.all([
    db.from('weight_logs').select('*').eq('user_id', currentUser.id).order('timestamp'),
    db.from('sleep_logs').select('*').eq('user_id', currentUser.id).order('timestamp'),
    db.from('workout_logs').select('*').eq('user_id', currentUser.id),
    db.from('custom_exercises').select('*').eq('user_id', currentUser.id),
    db.from('psych_logs').select('*').eq('user_id', currentUser.id).order('timestamp'),
    db.from('social_logs').select('*').eq('user_id', currentUser.id),
    // Read-only: populated by the separate HealthyPi Move sync tool, not by this app
    db.from('device_sleep_logs').select('*').eq('user_id', currentUser.id).order('date_ts'),
    db.from('device_stress_logs').select('*').eq('user_id', currentUser.id).order('date_ts'),
    db.from('device_activity_logs').select('*').eq('user_id', currentUser.id).order('date_ts'),
    db.from('device_vitals_logs').select('*').eq('user_id', currentUser.id).order('date_ts')
  ]);

  weightData = weightsRes.data || [];
  sleepData  = sleepsRes.data  || [];
  psychData  = psychRes.data   || [];
  socialData = socialRes.data  || [];

  deviceSleepData    = deviceSleepRes.data    || [];
  deviceStressData   = deviceStressRes.data   || [];
  deviceActivityData = deviceActivityRes.data || [];
  deviceVitalsData   = deviceVitalsRes.data   || [];

  workoutLogs = workoutsRes.data || [];

  // Rebuild the workout localStorage cache so chart functions can read it
  // without making additional Supabase calls
  const workoutsObj = {};
  workoutLogs.forEach(row => { workoutsObj[row.date] = row.exercises; });
  localStorage.setItem('workouts', JSON.stringify(workoutsObj));

  // Cache custom exercise definitions locally (used by the add-exercise form)
  const customList = (customExRes.data || []).map(e => ({
    name: e.name, isLift: e.is_lift, isRun: e.is_run
  }));
  localStorage.setItem('customExercises', JSON.stringify(customList));

  // Mark nav chips as complete for activities already logged today
  const today = getToday();

  if (weightData.some(e => e.date === today)) {
    const chip = document.getElementById('weightChip');
    if (!chip.classList.contains('completed')) toggleTask(chip);
  }
  if (sleepData.some(e => e.date === today)) {
    const chip = document.getElementById('sleepChip');
    if (!chip.classList.contains('completed')) toggleTask(chip);
  }
  // Codes is stored only in localStorage (no Supabase table)
  checkChipState('codesChip', 'codesLoggedDate');

  updateMeditationCard();
  updateSignalsChipState();

  const todaySocial = socialData.find(e => e.date === today);
  if (todaySocial && SOCIAL_CATEGORIES.some(cat => todaySocial[cat] > 0)) {
    const chip = document.getElementById('socialChip');
    if (chip && !chip.classList.contains('completed')) toggleTask(chip);
  }

  // Workout is only scheduled on Mon/Wed/Fri, so its task-dot only shows those days
  if (!['Mon', 'Wed', 'Fri'].includes(getDay())) {
    document.getElementById('workoutChip').classList.add('no-task-today');
    document.querySelector('.bottom-nav-item[data-page="workout"]').classList.add('no-task-today');
  }
  if (workoutLogs.some(e => e.date === today)) {
    const chip = document.getElementById('workoutChip');
    if (!chip.classList.contains('completed')) toggleTask(chip);
  }

  // Remember the most recent workout date so the edit button knows what to reload
  const sortedDates = Object.keys(workoutsObj).sort();
  const lastWorkout = sortedDates[sortedDates.length - 1];
  if (lastWorkout) localStorage.setItem('workoutLoggedDate', lastWorkout);
  else             localStorage.removeItem('workoutLoggedDate');
  populateExerciseSelect();
  renderWorkoutHistory();
  getQuote();
  updateSocialUI();
  updateUI();

  setTimeout(() => {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('mainContent').classList.add('loaded');
  }, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING  (weight, sleep, psych/signals)
// Each logger upserts to Supabase, updates the in-memory array, clears the
// input, marks the chip complete, and refreshes the UI.
// ─────────────────────────────────────────────────────────────────────────────

async function logWeight() {
  const input  = document.getElementById('weightInput');
  const weight = parseFloat(input.value);
  if (!weight || weight <= 100 || weight >= 250) return;

  const today = getToday();
  const entry = { date: today, weight, timestamp: Date.now() };

  await db.from('weight_logs').upsert(
    { user_id: currentUser.id, ...entry },
    { onConflict: 'user_id,date' } // one entry per day per user
  );

  // Update the in-memory array (replace today's entry if it exists)
  weightData = weightData.filter(e => e.date !== today);
  weightData.push(entry);
  weightData.sort((a, b) => a.timestamp - b.timestamp);

  input.value = '';
  const chip = document.getElementById('weightChip');
  if (!chip.classList.contains('completed')) toggleTask(chip);
  updateUI();
}

async function logSleep() {
  const hoursInput      = document.getElementById('sleepHoursInput');
  const timeInBedInput  = document.getElementById('sleepTimeInBedInput');
  const restedInput     = document.getElementById('sleepRestedInput');
  const hours      = parseFloat(hoursInput.value);
  const timeInBed  = parseFloat(timeInBedInput.value);
  const rested     = parseFloat(restedInput.value);
  if (!hours || hours < 0 || hours > 24) return;

  const today = getToday();
  const entry = { date: today, hours, time_in_bed: timeInBed || null, rested, timestamp: Date.now() };

  await db.from('sleep_logs').upsert(
    { user_id: currentUser.id, ...entry },
    { onConflict: 'user_id,date' }
  );

  sleepData = sleepData.filter(e => e.date !== today);
  sleepData.push(entry);
  sleepData.sort((a, b) => a.timestamp - b.timestamp);

  hoursInput.value     = '';
  timeInBedInput.value = '';
  restedInput.value    = '';
  const chip = document.getElementById('sleepChip');
  if (!chip.classList.contains('completed')) toggleTask(chip);
  updateUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// CHIP / TASK STATE
// Nav items (Workout, Social) and home log cards (Weight, Sleep, Codes, Signals,
// Meditation) both double as completion chips. toggleTask() flips the completed
// class, which syncs the matching bottom-nav dot (nav items) and, for home log
// cards, sinks the card to the bottom of #page-home .home-log-list via CSS order.
// ─────────────────────────────────────────────────────────────────────────────

// If localStorage records that this chip was already logged today, mark it complete
function checkChipState(chipId, storageKey) {
  if (localStorage.getItem(storageKey) === getToday()) {
    toggleTask(document.getElementById(chipId));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE UTILITIES
// Dates are stored as locale strings (e.g. "5/21/2026") to match Supabase date columns.
// ─────────────────────────────────────────────────────────────────────────────

function getToday() {
  return new Date().toLocaleDateString();
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString();
}

function getDay() {
  return new Date().toLocaleDateString('en-US', { weekday: 'short' });
}

// Returns an array of the last 30 days as locale strings, oldest first
function getLast30Days() {
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return date.toLocaleDateString();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI REFRESH
// updateUI is called after any data change. It only redraws the chart for the
// currently visible page to avoid wasted work.
// ─────────────────────────────────────────────────────────────────────────────

function updateUI() {
  updateStats();
  updateStreaks();
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (activePage === 'data') { updateWeightChart(); updateSleepChart(); updateSignalsChart(); updateExerciseChart(); }
  else if (activePage === 'social') updateSocialChart();
  else if (activePage === 'device') updateDeviceCharts();
}

// Updates the two weight stat boxes. Uses the same period slice as the chart so
// "Change Since Beginning" reflects the start of the currently selected time frame.
function updateStats() {
  const sliced = weightPeriodDays === 0 ? weightData : weightData.slice(-weightPeriodDays);

  const recentWeights = weightData.slice(-7);
  const avgWeight = recentWeights.length > 0
    ? (recentWeights.reduce((sum, e) => sum + e.weight, 0) / recentWeights.length).toFixed(1)
    : null;

  const weightChange = sliced.length > 0 && avgWeight
    ? (avgWeight - sliced[0].weight).toFixed(1)
    : null;

  document.getElementById('weightChange').textContent =
    weightChange ? `${weightChange > 0 ? '+' : ''}${weightChange} lbs` : '--';
  document.getElementById('avgWeight').textContent =
    avgWeight ? `${avgWeight} lbs` : '--';
}

function setWeightPeriod(days, btn) {
  weightPeriodDays = days;
  document.querySelectorAll('.weight-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateWeightChart();
  updateStats();
}

function setDeviceHrRange(range, btn) {
  deviceHrRange = range;
  document.querySelectorAll('.hr-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateDeviceHrChart();
}

function setDeviceSkinTempRange(range, btn) {
  deviceSkinTempRange = range;
  document.querySelectorAll('.skin-temp-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateDeviceSkinTempChart();
}

function setSleepPeriod(days, btn) {
  sleepPeriodDays = days;
  document.querySelectorAll('.sleep-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateSleepChart();
}

function setExercisePeriod(days, btn) {
  exercisePeriodDays = days;
  document.querySelectorAll('.exercise-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateExerciseChart();
}

function toggleExerciseLine(key, btn) {
  exerciseLineToggles[key] = !exerciseLineToggles[key];
  btn.classList.toggle('active', exerciseLineToggles[key]);
  updateExerciseChart();
}

// The two toggleable lines mean different things depending on exercise type
// (reps/weight for lifts, distance/time for runs), so the row is rebuilt with
// the right labels on every render instead of being static HTML like Sleep's.
// Bodyweight exercises have only one line (nothing to toggle), so the filter
// button hides entirely rather than offering a toggle that could zero out the
// only line on the chart.
function renderExerciseToggleRow(exerciseInfo) {
  const row = document.getElementById('exerciseToggleRow');
  const btn = document.getElementById('exerciseFilterBtn');
  if (!row || !btn) return;

  if (!exerciseInfo?.isRun && !exerciseInfo?.isLift) {
    row.innerHTML = '';
    row.classList.remove('open');
    btn.style.display = 'none';
    return;
  }

  btn.style.display = '';
  const label1 = exerciseInfo.isRun ? 'Distance' : 'Total Reps';
  const label2 = exerciseInfo.isRun ? 'Time' : 'Avg Weight';
  row.innerHTML = `
    <button class="sleep-toggle-btn${exerciseLineToggles.value1 ? ' active' : ''}" onclick="toggleExerciseLine('value1', this)">
      <span class="sleep-toggle-dot" style="background:#0088FF"></span>${label1}
    </button>
    <button class="sleep-toggle-btn${exerciseLineToggles.value2 ? ' active' : ''}" onclick="toggleExerciseLine('value2', this)">
      <span class="sleep-toggle-dot" style="background:#34C759"></span>${label2}
    </button>
  `;
}

function toggleSleepLine(key, btn) {
  sleepLineToggles[key] = !sleepLineToggles[key];
  btn.classList.toggle('active', sleepLineToggles[key]);
  updateSleepChart();
}

function setSignalsPeriod(days, btn) {
  signalsPeriodDays = days;
  document.querySelectorAll('.signals-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateSignalsChart();
}

function toggleSignalLine(key, btn) {
  signalLineToggles[key] = !signalLineToggles[key];
  btn.classList.toggle('active', signalLineToggles[key]);
  updateSignalsChart();
}

// Mobile only: the line-toggle row (which lines a chart plots) is always
// visible on desktop, but doesn't fit on a phone screen — the "tune" button
// in the card header expands/collapses it in place instead of a modal.
function toggleChartFilterPanel(rowId) {
  document.getElementById(rowId).classList.toggle('open');
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARTS
// Each chart function destroys any existing Chart.js instance before building
// a new one, so calling them repeatedly is safe.
// ─────────────────────────────────────────────────────────────────────────────

// Weight: line chart with actual weight + 7-day moving average overlay
// weightPeriodDays controls how many past days are shown (0 = all time)
function updateWeightChart() {
  if (weightChart) weightChart.destroy();

  const sliced = weightPeriodDays === 0 ? weightData : weightData.slice(-weightPeriodDays);
  const chartData = sliced.map(e => {
    const dateObj = new Date(e.date);

    return {
      x: e.date.split('/').slice(0, 2).join('/'),
      day: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      y: e.weight
    };
  });

  if (chartData.length === 0) return;

  // 7-day moving average
  const windowSize = 7;
  const maData = chartData.map((d, i) => {
    const slice = chartData.slice(Math.max(0, i - windowSize + 1), i + 1);
    const avg = slice.reduce((sum, p) => sum + p.y, 0) / slice.length;
    return { x: d.x, day: d.day, y: parseFloat(avg.toFixed(1)) };
  });

  const ctx = document.getElementById('weightChart').getContext('2d');
  weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      //labels: chartData.map(d => d.date),
      datasets: [
        {
          label: 'Weight (lbs)',
          data: chartData,
          borderColor: '#0088FF',
          backgroundColor: 'rgba(59, 130, 246, 0.25)',
          tension: 0.3,
          fill: true,
          pointRadius: 3
        },
        {
          label: '7-day avg',
          data: maData,
          borderColor: '#FF9500',
          backgroundColor: 'transparent',
          tension: 0.4,
          fill: false,
          pointRadius: 0,
          borderWidth: 2,
          borderDash: [5, 3]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#FFFFFF', boxWidth: 20 }
        },
        tooltip: {
          callbacks: {
            title: (e) => {
              const d = e[0].raw;
              return ` ${d.day} ${d.x}`;
            },
            label: (context) => {
              const label = context.dataset.label === '7-day avg' ? ' 7-day avg' : ' Weight';
              return `${label}: ${context.raw.y} lbs`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: { color: '#FFFFFF' },
          grid: { color: 'rgba(250,250,250,0.4)' }
        },
        x: {
          ticks: { color: '#FFFFFF' },
          grid: { color: 'rgba(250,250,250,0.4)' }
        }
      }
    }
  });
}

// Exercise progress chart — adapts its axes to the exercise type:
//   run      → dual-axis: distance (left) + time (right)
//   lift     → dual-axis: total reps (left) + avg weight (right)
//   bodyweight → single axis: total reps
function updateExerciseChart() {
  if (exerciseChart) exerciseChart.destroy();

  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const selectedExercise = document.getElementById('exerciseSelect')?.value || 'pushups';

  // Find the exercise type
  const allExercises = getAllExercises();
  const exerciseInfo = allExercises.find(ex => ex.name.toLowerCase() === selectedExercise.toLowerCase());

  const chartData = Object.entries(workouts)
    .map(([date, workout]) => {
      const exercise = workout.find(
        ex => ex.name.toLowerCase() === selectedExercise.toLowerCase()
      );

      if (!exercise) return null;

      const [month, day] = date.split('/');
      // workout_logs has no timestamp column (only the M/D/YYYY date string), so
      // fullDate is kept around purely to sort chronologically below
      const entry = { date: `${month}/${day}`, fullDate: new Date(date) };

      if (exerciseInfo?.isRun) {
        // For runs: distance and time
        entry.value1 = exercise.sets.reduce((sum, set) => sum + (set[0] || 0), 0);
        entry.value2 = exercise.sets.reduce((sum, set) => sum + (set[1] + (set[2] / 100) || 0), 0);
      } else if (exerciseInfo?.isLift) {
        // For lifts: reps and weight
        entry.value1 = exercise.sets.reduce((sum, set) => sum + (set[0] || 0), 0);
        const weightSets = exercise.sets.filter(set => set[1] != null);
        entry.value2 = weightSets.length > 0
          ? weightSets.reduce((sum, set) => sum + (set[1] || 0), 0) / weightSets.length
          : 0;
      } else {
        // For bodyweight: just reps
        entry.value1 = exercise.sets.reduce((sum, set) => sum + (set[0] || 0), 0);
        entry.value2 = null;
      }
      return entry;
    })
    .filter(Boolean)
    .sort((a, b) => a.fullDate - b.fullDate);

  const slicedData = exercisePeriodDays === 0 ? chartData : chartData.slice(-exercisePeriodDays);

  if (slicedData.length === 0) return;

  const ctx = document.getElementById('exerciseChart').getContext('2d');
  renderExerciseToggleRow(exerciseInfo);

  const datasets = [];
  const scales = {
    x: {
      ticks: { color: '#FFFFFF' },
      grid: { color: 'rgba(250,250,250,0.4)' }
    }
  };

  if (exerciseInfo?.isRun) {
    // Distance and Time
    if (exerciseLineToggles.value1) {
      datasets.push({
        label: 'Distance (miles)',
        data: slicedData.map(d => d.value1),
        borderColor: '#0088FF',
        backgroundColor: 'rgba(0, 136, 255, 0.2)',
        tension: 0.3,
        fill: true,
        yAxisID: 'y1'
      });
      scales.y1 = {
        type: 'linear',
        position: 'left',
        beginAtZero: true,
        ticks: { color: '#0088FF' },
        grid: { color: 'rgba(250,250,250,0.4)' },
        title: { display: true, text: 'Distance (miles)', color: '#0088FF' }
      };
    }
    if (exerciseLineToggles.value2) {
      datasets.push({
        label: 'Time (min.sec)',
        data: slicedData.map(d => d.value2),
        borderColor: '#34C759',
        backgroundColor: 'rgba(52, 199, 89, 0.2)',
        tension: 0.3,
        fill: true,
        yAxisID: 'y2'
      });
      scales.y2 = {
        type: 'linear',
        position: 'right',
        min: 0,
        max: Math.max(...slicedData.map(d => d.value2)) * 1.2,
        ticks: { color: '#34C759' },
        grid: { display: false },
        title: { display: true, text: 'Time (min.sec)', color: '#34C759' }
      };
    }
  } else if (exerciseInfo?.isLift) {
    // Reps and Weight
    if (exerciseLineToggles.value1) {
      datasets.push({
        label: 'Total Reps',
        data: slicedData.map(d => d.value1),
        borderColor: '#0088FF',
        backgroundColor: 'rgba(0, 136, 255, 0.2)',
        tension: 0.3,
        fill: true,
        yAxisID: 'y1'
      });
      scales.y1 = {
        type: 'linear',
        position: 'left',
        beginAtZero: true,
        ticks: { color: '#0088FF' },
        grid: { color: 'rgba(250,250,250,0.4)' },
        title: { display: true, text: 'Total Reps', color: '#0088FF' }
      };
    }
    if (exerciseLineToggles.value2) {
      datasets.push({
        label: 'Avg Weight (lbs)',
        data: slicedData.map(d => d.value2),
        borderColor: '#34C759',
        backgroundColor: 'rgba(52, 199, 89, 0.2)',
        tension: 0.3,
        fill: true,
        yAxisID: 'y2'
      });
      scales.y2 = {
        type: 'linear',
        position: 'right',
        min: 0,
        max: Math.max(...slicedData.map(d => d.value2)) * 1.2,
        ticks: { color: '#34C759' },
        grid: { display: false },
        title: { display: true, text: 'Avg Weight (lbs)', color: '#34C759' }
      };
    }
  } else {
    // Bodyweight only - single axis, no toggle (renderExerciseToggleRow hides the button)
    datasets.push({
      label: 'Total Reps',
      data: slicedData.map(d => d.value1),
      borderColor: '#0088FF',
      backgroundColor: 'rgba(0, 136, 255, 0.2)',
      tension: 0.3,
      fill: true
    });
    scales.y = {
      beginAtZero: true,
      ticks: { color: '#c4cad4' },
      grid: { color: 'rgba(250,250,250,0.4)' }
    };
  }

  exerciseChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: slicedData.map(d => d.date),
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: exerciseInfo?.isRun || exerciseInfo?.isLift,
          labels: { color: '#c4cad4' }
        }
      },
      scales: scales
    }
  });
}

// Sleep: multi-axis chart — hours slept + time in bed (left, hours), restedness
// score (right, 1-10), and sleep efficiency % (right, 0-100 — the CBT-I ratio of
// hours slept to time in bed), each with a 7-day moving average overlay
function updateSleepChart() {
  if (sleepChart) sleepChart.destroy();

  const chartData = sleepData.slice(-sleepPeriodDays).map(e => {
    const dateObj = new Date(e.date);
    const timeInBed = e.time_in_bed;
    const efficiency = (e.hours != null && timeInBed)
      ? parseFloat(((e.hours / timeInBed) * 100).toFixed(1))
      : null;

    return {
      x: e.date.split('/').slice(0, 2).join('/'),
      day: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      y: e.hours,
      z: e.rested,
      w: timeInBed,
      v: efficiency
    };
  });

  if (chartData.length === 0) return;

  // 7-day moving averages (filter nulls so absent values don't drag the average toward 0)
  const windowSize = 7;
  const movingAverage = key => chartData.map((_, i) => {
    const slice = chartData.slice(Math.max(0, i - windowSize + 1), i + 1).filter(p => p[key] != null);
    if (!slice.length) return null;
    return parseFloat((slice.reduce((s, p) => s + p[key], 0) / slice.length).toFixed(2));
  });
  const maHours      = movingAverage('y');
  const maRested     = movingAverage('z');
  const maTimeInBed  = movingAverage('w');
  const maEfficiency = movingAverage('v');

  const hasRestedData     = chartData.some(d => d.z != null);
  const hasTimeInBedData  = chartData.some(d => d.w != null);
  const hasEfficiencyData = chartData.some(d => d.v != null);

  const ctx = document.getElementById('sleepChart').getContext('2d');
  const datasets = [];
  const scales = {
    x: {
      ticks: { color: '#FFFFFF' },
      grid: { color: 'rgba(250,250,250,0.4)' }
    }
  };

  // Fills rendered first (underneath), trend lines last (on top)
  if (sleepLineToggles.hours) {
    datasets.push({
      label: 'Hours Slept',
      data: chartData.map(d => d.y),
      borderColor: '#0088FF',
      backgroundColor: 'rgba(0, 136, 255, 0.2)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y1'
    });
  }
  if (hasTimeInBedData && sleepLineToggles.timeInBed) {
    datasets.push({
      label: 'Time in Bed',
      data: chartData.map(d => d.w),
      borderColor: '#5E5CE6',
      backgroundColor: 'rgba(94, 92, 230, 0.15)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y1'
    });
  }
  if (hasRestedData && sleepLineToggles.rested) {
    datasets.push({
      label: 'Restedness Score',
      data: chartData.map(d => d.z),
      borderColor: '#34C759',
      backgroundColor: 'rgba(52, 199, 89, 0.2)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y2'
    });
  }
  if (hasEfficiencyData && sleepLineToggles.efficiency) {
    datasets.push({
      label: 'Sleep Efficiency %',
      data: chartData.map(d => d.v),
      borderColor: '#64D2FF',
      backgroundColor: 'rgba(100, 210, 255, 0.15)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y3'
    });
  }
  if (sleepLineToggles.hoursAvg) {
    datasets.push({
      label: 'Hours (7-day avg)',
      data: maHours,
      borderColor: '#FF9500',
      backgroundColor: 'transparent',
      tension: 0.4,
      fill: false,
      pointRadius: 0,
      borderWidth: 3,
      borderDash: [6, 4],
      segment: { borderDash: () => [6, 4] },
      clip: false,
      yAxisID: 'y1'
    });
  }
  if (hasRestedData && sleepLineToggles.restedAvg) {
    datasets.push({
      label: 'Restedness (7-day avg)',
      data: maRested,
      borderColor: '#FFD60A',
      backgroundColor: 'transparent',
      tension: 0.4,
      fill: false,
      pointRadius: 0,
      borderWidth: 3,
      borderDash: [6, 4],
      segment: { borderDash: () => [6, 4] },
      clip: false,
      yAxisID: 'y2'
    });
  }
  if (hasTimeInBedData && sleepLineToggles.timeInBedAvg) {
    datasets.push({
      label: 'Time in Bed (7-day avg)',
      data: maTimeInBed,
      borderColor: '#BF5AF2',
      backgroundColor: 'transparent',
      tension: 0.4,
      fill: false,
      pointRadius: 0,
      borderWidth: 3,
      borderDash: [6, 4],
      segment: { borderDash: () => [6, 4] },
      clip: false,
      yAxisID: 'y1'
    });
  }
  if (hasEfficiencyData && sleepLineToggles.efficiencyAvg) {
    datasets.push({
      label: 'Efficiency (7-day avg)',
      data: maEfficiency,
      borderColor: '#30B0C7',
      backgroundColor: 'transparent',
      tension: 0.4,
      fill: false,
      pointRadius: 0,
      borderWidth: 3,
      borderDash: [6, 4],
      segment: { borderDash: () => [6, 4] },
      clip: false,
      yAxisID: 'y3'
    });
  }
  const isMobile = window.innerWidth <= 768;

  scales.y1 = {
    type: 'linear',
    position: 'left',
    beginAtZero: true,
    ticks: { color: '#0088FF', display: !isMobile },
    grid: { color: 'rgba(250,250,250,0.4)' },
    title: { display: false }
  };
  if (hasRestedData && (sleepLineToggles.rested || sleepLineToggles.restedAvg)) {
    scales.y2 = {
      type: 'linear',
      position: 'right',
      ticks: { color: '#34C759', display: !isMobile },
      grid: { display: false },
      title: { display: false }
    };
  }
  if (hasEfficiencyData && (sleepLineToggles.efficiency || sleepLineToggles.efficiencyAvg)) {
    scales.y3 = {
      type: 'linear',
      position: 'right',
      min: 0,
      max: 100,
      ticks: { color: '#64D2FF', display: !isMobile },
      grid: { display: false },
      title: { display: false }
    };
  }
  if (isMobile) {
    scales.x.ticks = { ...scales.x.ticks, display: false };
  }

  sleepChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.map(d => d.x),
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: !isMobile, labels: { color: '#c4cad4' } }
      },
      scales: scales
    }
  });
}

// Logs the psychological signals (confidence, stress, low mood, release/sick toggles)
async function logPsych() {
  const confidence = parseInt(document.getElementById('psychConfidence').value);
  const stress     = parseInt(document.getElementById('psychStress').value);
  const low        = parseInt(document.getElementById('psychLow').value);
  const released   = document.getElementById('psychRelease').classList.contains('active');
  const sick       = document.getElementById('psychSick').classList.contains('active');

  const today = getToday();
  const entry = { date: today, confidence, stress, low, released, sick, timestamp: Date.now() };

  await db.from('psych_logs').upsert(
    { user_id: currentUser.id, ...entry },
    { onConflict: 'user_id,date' }
  );

  psychData = psychData.filter(e => e.date !== today);
  psychData.push(entry);
  psychData.sort((a, b) => a.timestamp - b.timestamp);

  updateSignalsChipState();
  updateUI();
}

// Meditation: an icon in the Home icons row (shared with Codes), separate from
// the psych-log form. Marking it done today toggles it to "completed" (same
// chip pattern as the other home log cards/icons).
function logMeditation() {
  const today = getToday();
  localStorage.setItem('meditationLoggedDate', today);
  const dates = getMeditationDates();
  if (!dates.includes(today)) {
    dates.push(today);
    localStorage.setItem('meditationDates', JSON.stringify(dates));
  }
  updateMeditationCard();
  updateStreaks();
}

function updateMeditationCard() {
  const card = document.getElementById('meditationCard');
  if (!card) return;
  const done = localStorage.getItem('meditationLoggedDate') === getToday();
  if (card.classList.contains('completed') !== done) toggleTask(card);
  syncHomeIconsRow();
}

// All dates the user has ever meditated on, used to compute the home page streak
function getMeditationDates() {
  return JSON.parse(localStorage.getItem('meditationDates') || '[]');
}

// Signals chip completes once today's psych log (confidence/stress/low) is
// logged; it un-completes if it isn't (e.g. on a fresh day).
function updateSignalsChipState() {
  const chip = document.getElementById('signalsChip');
  const today = getToday();
  const psychDone = psychData.some(e => e.date === today);
  if (chip.classList.contains('completed') !== psychDone) toggleTask(chip);
}

// Toggles the "Released yesterday?" switch between Yes/No
function togglePsychRelease() {
  const btn = document.getElementById('psychRelease');
  const nowActive = !btn.classList.contains('active');
  btn.classList.toggle('active', nowActive);
  btn.classList.toggle('inactive', !nowActive);
}

// Toggles the "Sick yesterday?" switch between Yes/No
function togglePsychSick() {
  const btn = document.getElementById('psychSick');
  const nowActive = !btn.classList.contains('active');
  btn.classList.toggle('active', nowActive);
  btn.classList.toggle('inactive', !nowActive);
}

// Signals: a line chart for confidence/stress/low with 7-day MAs, plus a
// left-to-right row of release-day dots (see renderReleaseDots)
function updateSignalsChart() {
  if (signalsChart) signalsChart.destroy();

  const chartData = psychData.slice(-signalsPeriodDays).map(e => ({
    x: e.date.split('/').slice(0, 2).join('/'),
    confidence: e.confidence,
    stress: e.stress,
    low: e.low,
    released: e.released ? 1 : 0
  }));

  if (chartData.length === 0) return;

  const labels = chartData.map(d => d.x);
  const scales = {
    x: { ticks: { color: '#FFFFFF' }, grid: { color: 'rgba(250,250,250,0.4)' } },
    y: {
      min: 1, max: 10,
      ticks: { color: '#c4cad4', stepSize: 1 },
      grid: { color: 'rgba(250,250,250,0.4)' }
    }
  };

  // 7-day moving averages
  const maWindow = 7;
  function movingAvg(key) {
    return chartData.map((d, i) => {
      const slice = chartData.slice(Math.max(0, i - maWindow + 1), i + 1);
      return parseFloat((slice.reduce((s, p) => s + p[key], 0) / slice.length).toFixed(1));
    });
  }
  const maConfi = movingAvg('confidence');
  const maStress = movingAvg('stress');
  const maLow = movingAvg('low');

  const datasets = [];
  if (signalLineToggles.confidence) {
    datasets.push({
      label: 'Confidence',
      data: chartData.map(d => d.confidence),
      borderColor: '#0088FF',
      backgroundColor: 'rgba(0,136,255,0.15)',
      tension: 0.3,
      fill: true
    });
    datasets.push({
      label: 'Confi MA',
      data: maConfi,
      borderColor: '#0088FF',
      borderDash: [5, 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false
    });
  }
  if (signalLineToggles.stress) {
    datasets.push({
      label: 'Stress',
      data: chartData.map(d => d.stress),
      borderColor: '#FF6B6B',
      backgroundColor: 'rgba(255,107,107,0.15)',
      tension: 0.3,
      fill: true
    });
    datasets.push({
      label: 'Stress MA',
      data: maStress,
      borderColor: '#FF6B6B',
      borderDash: [5, 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false
    });
  }
  if (signalLineToggles.low) {
    datasets.push({
      label: 'Low',
      data: chartData.map(d => d.low),
      borderColor: '#A78BFA',
      backgroundColor: 'rgba(167,139,250,0.15)',
      tension: 0.3,
      fill: true
    });
    datasets.push({
      label: 'Low MA',
      data: maLow,
      borderColor: '#A78BFA',
      borderDash: [5, 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false
    });
  }

  const ctx1 = document.getElementById('signalsChart').getContext('2d');
  signalsChart = new Chart(ctx1, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#c4cad4' } } },
      scales
    }
  });

  renderReleaseDots();
}

// Release days as a compact left-to-right row of dots instead of a chart —
// filled green = no release that day, hollow red outline = released. Runs in
// the same chronological (oldest→newest) order as every other chart's x-axis.
// Deliberately independent of the Scores chart's period filter (signalsPeriodDays)
// — dots are cheap, so instead it fills however many fit across the card's
// actual width, recomputing whenever that width changes (ResizeObserver).
const RELEASE_DOT_SPACING = 18; // .release-dot width (12px) + .release-dot-row gap (6px)
let releaseDotsResizeObserver = null;

function renderReleaseDots() {
  const row = document.getElementById('releaseDotRow');
  if (!row) return;

  if (!releaseDotsResizeObserver) {
    releaseDotsResizeObserver = new ResizeObserver(() => renderReleaseDots());
    releaseDotsResizeObserver.observe(row);
  }

  const maxDots = Math.max(1, Math.floor(row.clientWidth / RELEASE_DOT_SPACING));
  const entries = psychData.slice(-maxDots);
  row.innerHTML = entries.map(e => {
    const x = e.date.split('/').slice(0, 2).join('/');
    const status = e.released ? 'Released' : 'No release';
    return `<span class="release-dot${e.released ? ' released' : ''}" title="${x}: ${status}"></span>`;
  }).join('');
}

// Marks a chip element (nav-item or home log card) as completed (or toggles it back)
function toggleTask(chip) {
  const check = chip.querySelector('.chip-check');
  chip.classList.toggle('completed');
  const isCompleted = chip.classList.contains('completed');
  if (check) check.style.display = isCompleted ? 'inline' : 'none';

  // Sync the green dot to the matching bottom-nav item (mobile nav)
  const page   = chip.dataset.page;
  const id     = chip.id;
  const bnItem = page
    ? document.querySelector(`.bottom-nav-item[data-page="${page}"]`)
    : id ? document.querySelector(`.bottom-nav-item[data-chip="${id}"]`) : null;
  if (bnItem) bnItem.classList.toggle('completed', isCompleted);
}

// Called by chip buttons — delegates to the parent chip element
function toggleOnClick(element) {
  toggleTask(element.parentElement);
}

// Codes and Meditation share one icon-only row on Home (#homeIconsRow) to save
// vertical space. Each icon shows its own completed state, but the row only
// sinks to the bottom of the home log list once BOTH are done today.
function syncHomeIconsRow() {
  const row = document.getElementById('homeIconsRow');
  const codes = document.getElementById('codesChip');
  const meditation = document.getElementById('meditationCard');
  if (!row || !codes || !meditation) return;
  const bothDone = codes.classList.contains('completed') && meditation.classList.contains('completed');
  row.classList.toggle('completed', bothDone);
}

// Codes chip is one-way: once marked done today it can't be undone until tomorrow
function toggleCodes(chip) {
  const today = getToday();
  const loggedToday = localStorage.getItem('codesLoggedDate') === today;

  if (loggedToday) return; // already logged today, ignore clicks

  const codesLog = JSON.parse(localStorage.getItem('codesLog') || '[]');
  localStorage.setItem('codesLoggedDate', today);
  if (!codesLog.includes(today)) {
    codesLog.push(today);
    localStorage.setItem('codesLog', JSON.stringify(codesLog));
  }
  toggleTask(chip);
  syncHomeIconsRow();
  updateStreaks();
}

// Opens the Codes Google Doc in a new window and marks the chip done
function openTaskLink(element) {
  window.open(
    'https://docs.google.com/document/d/16lPD_vvbuhUpa0yR5gFKQDGuDJHWc8wQhCI39g5GDTM/edit',
    '_blank',
    `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`
  );
  toggleCodes(element);
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER MENU (Migrate Data / Sign Out) — hamburger dropdown, top-right of header
// ─────────────────────────────────────────────────────────────────────────────

function toggleHeaderMenu() {
  document.getElementById('headerMenuDropdown').classList.toggle('open');
}

function closeHeaderMenu() {
  document.getElementById('headerMenuDropdown').classList.remove('open');
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP — runs after DOM is ready
// ─────────────────────────────────────────────────────────────────────────────

let appInitialized = false; // guard against double-init from onAuthStateChange + getSession

document.addEventListener('DOMContentLoaded', async () => {
  // Listen for sign-in / sign-out events that happen after initial page load
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && !appInitialized) {
      appInitialized = true;
      document.getElementById('authScreen').style.display = 'none';
      initApp();
    } else if (event === 'SIGNED_OUT') {
      window.location.reload(); // simplest way to reset all state
    }
  });

  // If there's already a session (e.g. returning user), skip the auth screen immediately
  const { data: { session } } = await db.auth.getSession();
  if (session && !appInitialized) {
    appInitialized = true;
    initApp();
  } else if (!session) {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('authScreen').style.display = 'flex';
  }

  // Close the header menu on any click outside of it
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('headerMenuDropdown');
    if (menu.classList.contains('open') && !e.target.closest('.header-menu')) {
      menu.classList.remove('open');
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// WORKOUT FORM
// Flow: renderWorkoutSelector → startWorkout → renderWorkoutForm → logWorkout
// Drafts are auto-saved to localStorage on every input so the user doesn't
// lose progress if they accidentally navigate away.
// ─────────────────────────────────────────────────────────────────────────────

// Builds the HTML for one set row — input fields vary by exercise type
function createSet(exercise, setIndex) {
  const label = `<span class="set-label">Set ${setIndex + 1}</span>`;

  if (exercise.isRun) {
    return `
      <div class="set">
        ${label}
        <input type="number" inputmode="decimal" placeholder="Miles">
        <input type="number" inputmode="numeric" placeholder="Min" min="0">
        <input type="number" inputmode="numeric" placeholder="Sec" min="0" max="59">
      </div>
    `;
  }

  if (exercise.isLift) {
    return `
      <div class="set">
        ${label}
        <input type="number" inputmode="numeric" placeholder="Reps">
        <input type="number" inputmode="decimal" placeholder="Lbs">
      </div>
    `;
  }

  return `
    <div class="set">
      ${label}
      <input type="number" inputmode="numeric" step="0.1" placeholder="Reps">
    </div>
  `;
}

// Formats a set array for display (e.g. "10×25, 8×25" for lifts, "1.5mi 28:30" for runs)
function formatPrevSets(sets, isLift, isRun) {
  if (!sets || sets.length === 0) return '';
  if (isRun) {
    return sets.map(s => {
      const miles = s[0] || 0;
      const min = s[1] || 0;
      const sec = String(s[2] || 0).padStart(2, '0');
      return `${miles}mi ${min}:${sec}`;
    }).join(', ');
  }
  if (isLift) return sets.map(s => `${s[0] || 0}×${s[1] || 0}`).join(', ');
  return sets.map(s => s[0] || 0).join(', ');
}

// Finds the most recent past workout that shares exercises with the given list
// (used to show "Last: …" reference values for each set)
function getPreviousWorkout(exercises) {
  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const today = getToday();
  const nameSet = new Set(exercises.map(e => e.name.toLowerCase()));
  // Sort by actual date value (not locale string) so single- vs double-digit months sort correctly
  const sorted = Object.keys(workouts).filter(d => d !== today).sort((a, b) => new Date(b) - new Date(a));
  for (const date of sorted) {
    if (workouts[date].some(ex => nameSet.has(ex.name.toLowerCase()))) {
      return { date, exercises: workouts[date] };
    }
  }
  return null;
}

// Returns the set data for a named exercise from the most recent workout that included it
function getPrevSetsForExercise(name) {
  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const today = getToday();
  // Sort by actual date value (not locale string) so single- vs double-digit months sort correctly
  const sorted = Object.keys(workouts).filter(d => d !== today).sort((a, b) => new Date(b) - new Date(a));
  for (const date of sorted) {
    const found = workouts[date].find(e => e.name.toLowerCase() === name.toLowerCase());
    if (found) return found.sets;
  }
  return null;
}

// Builds the HTML for one exercise block (header + collapsible set inputs)
function createExercise(exercise, prevSets) {
  const prev = prevSets ?? null;
  const prevText = prev ? formatPrevSets(prev, exercise.isLift, exercise.isRun) : '';
  const prevHtml = prevText
    ? `<span class="ex-prev">Last: ${prevText}</span>`
    : '';

  let html = `<div class="exercise" draggable="true">`;
  html += `<div class="exNameForm" onclick="toggleExerciseCollapse(this.closest('.exercise'))">
    <div class="ex-left-col">
      <span class="btn-drag-ex material-icons" title="Drag to reorder" onclick="event.stopPropagation()">drag_indicator</span>
      <div class="ex-name-col">
        <p>${exercise.name}</p>
        ${prevHtml}
      </div>
    </div>
    <div class="ex-right-col">
      <span class="material-icons ex-check-icon" title="All sets logged">check_circle</span>
      <span class="material-icons ex-chevron">expand_more</span>
      <button class="btn-remove-ex" onclick="event.stopPropagation(); this.closest('.exercise').remove()" title="Remove exercise">
        <span class="material-icons">close</span>
      </button>
    </div>
  </div>`;

  html += `<div class="ex-sets-body">`;
  for (let i = 0; i < exercise.sets; i++) {
    html += createSet(exercise, i);
  }
  html += `</div>`;

  html += `</div>`;
  return html;
}

// Expands or collapses an exercise block.
// Enforces a max of 2 open at a time to reduce scroll length on mobile.
function toggleExerciseCollapse(exEl) {
  const container = exEl.closest('#workout');
  if (exEl.classList.contains('ex-collapsed')) {
    const openEls = [...container.querySelectorAll('.exercise:not(.ex-collapsed)')];
    if (openEls.length >= 2) openEls[0].classList.add('ex-collapsed');
    exEl.classList.remove('ex-collapsed');
  } else {
    exEl.classList.add('ex-collapsed');
  }
}

// Reads the current input values for one exercise, grouped by set.
// Set width (1/2/3 inputs) tells us the exercise type, per the same
// convention used when saving/loading workouts (bodyweight/lift/run).
function getExerciseSetValues(exEl) {
  return [...exEl.querySelectorAll('.ex-sets-body .set')].map(setEl =>
    [...setEl.querySelectorAll('input')].map(i => i.value)
  );
}

function isExerciseComplete(exEl) {
  const sets = getExerciseSetValues(exEl);
  return sets.length > 0 && sets.every(set => set.every(v => v.trim() !== ''));
}

// Shows/hides the green "Logged: …" line under the exercise name once every
// set is filled in, so a collapsed, finished exercise still shows what was entered.
function updateExerciseSummary(exEl, complete) {
  const nameCol = exEl.querySelector('.ex-name-col');
  let summaryEl = nameCol.querySelector('.ex-logged-summary');
  if (!complete) {
    if (summaryEl) summaryEl.remove();
    return;
  }
  const sets = getExerciseSetValues(exEl);
  const width = sets[0].length;
  const text = formatPrevSets(sets, width === 2, width === 3);
  if (!summaryEl) {
    summaryEl = document.createElement('span');
    summaryEl.className = 'ex-logged-summary';
    nameCol.appendChild(summaryEl);
  }
  summaryEl.textContent = `Logged: ${text}`;
}

// Fires on every keystroke. Only handles the "un-completing" direction (user
// clears a field they'd already filled) so a stale "complete" state doesn't
// linger. The auto-collapse itself waits for focusout (see below) so we never
// yank an exercise closed while the user is still mid-keystroke on a value.
function handleExerciseInput(e) {
  const exEl = e.target.closest('.exercise');
  if (!exEl || !exEl.classList.contains('ex-complete')) return;
  if (!isExerciseComplete(exEl)) {
    exEl.classList.remove('ex-complete');
    updateExerciseSummary(exEl, false);
  }
}

// Fires when a field loses focus (tab, tap elsewhere, keyboard dismissed).
// Marks an exercise complete once all its sets are filled, and auto-collapses
// it so the gym-goer isn't stuck scrolling past exercises they've already
// finished. Opens the next unfinished exercise below it, keeping the flow
// moving top-to-bottom.
function handleExerciseFieldBlur(e) {
  if (!e.target.matches('input')) return;
  const exEl = e.target.closest('.exercise');
  if (!exEl) return;

  const complete = isExerciseComplete(exEl);
  if (!complete) return;
  const wasComplete = exEl.classList.contains('ex-complete');
  exEl.classList.add('ex-complete');
  updateExerciseSummary(exEl, true);

  if (!wasComplete && !exEl.classList.contains('ex-collapsed')) {
    exEl.classList.add('ex-collapsed');
    advanceToNextExercise(exEl);
  }
}

// Opens the next exercise below the one just finished that isn't already
// complete, so exactly one exercise stays expanded and ready to log.
function advanceToNextExercise(currentEl) {
  const container = currentEl.closest('#workout');
  const exercises = [...container.querySelectorAll('.exercise')];
  const next = exercises.slice(exercises.indexOf(currentEl) + 1)
    .find(el => !el.classList.contains('ex-complete'));
  if (next) next.classList.remove('ex-collapsed');
}

// Runs after the form is built (and any saved/prefilled values are applied):
// collapses every already-complete exercise with its logged summary, and
// expands only the first unfinished one so the user always sees what's next.
function initExerciseCollapseState(container) {
  let opened = false;
  container.querySelectorAll('.exercise').forEach(exEl => {
    const complete = isExerciseComplete(exEl);
    exEl.classList.toggle('ex-complete', complete);
    updateExerciseSummary(exEl, complete);
    if (!complete && !opened) {
      exEl.classList.remove('ex-collapsed');
      opened = true;
    } else {
      exEl.classList.add('ex-collapsed');
    }
  });
}



// Saves the current in-progress form to localStorage so it survives navigation
function saveWorkoutDraft() {
  const exercises = document.querySelectorAll('.exercise');
  if (!exercises.length) return;

  const allEx = getAllExercises();
  const exerciseDefs = [];
  const values = [];

  exercises.forEach(ex => {
    const name = ex.querySelector('p').textContent;
    const info = allEx.find(e => e.name.toLowerCase() === name.toLowerCase());
    const setEls = ex.querySelectorAll('.set');

    exerciseDefs.push({ name, isLift: info?.isLift || false, isRun: info?.isRun || false, sets: setEls.length });

    const setValues = [];
    setEls.forEach(setDiv => {
      setValues.push(Array.from(setDiv.querySelectorAll('input')).map(i => i.value));
    });
    values.push({ name, sets: setValues });
  });

  localStorage.setItem('workoutDraft', JSON.stringify({ date: getToday(), exerciseDefs, values, timerStart: workoutTimerStart }));
}

// Returns today's draft if one is stored, otherwise null
function getWorkoutDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('workoutDraft') || 'null');
    if (draft && draft.date === getToday()) return draft;
  } catch {}
  return null;
}

// Saves the workout to Supabase; uses editingWorkoutDate if editing a past entry
async function logWorkout() {
  const isEditing = !!editingWorkoutDate;
  const date      = editingWorkoutDate || getToday();
  editingWorkoutDate = null;

  // Collect all exercise names and set values from the DOM
  const workoutData = [...document.querySelectorAll('.exercise')].map(ex => ({
    name: ex.querySelector('p').textContent,
    sets: [...ex.querySelectorAll('.set')].map(setDiv =>
      [...setDiv.querySelectorAll('input')].map(input => parseFloat(input.value) || 0)
    )
  }));

  // Add 15 minutes to account for warm-up time before the first logged input
  const durationMinutes = workoutTimerStart
    ? Math.round((Date.now() - workoutTimerStart) / 60000) + 15 : 15;
  workoutTimerStart = null;

  const activePlanKey = !isEditing ? (localStorage.getItem('activePlanKey') || null) : null;

  await db.from('workout_logs').upsert(
    { user_id: currentUser.id, date, exercises: workoutData, duration_minutes: durationMinutes, plan_key: activePlanKey },
    { onConflict: 'user_id,date' }
  );

  // Keep localStorage cache and in-memory workoutLogs in sync
  const allWorkouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  allWorkouts[date] = workoutData;
  localStorage.setItem('workouts', JSON.stringify(allWorkouts));
  localStorage.setItem('workoutLoggedDate', date);
  localStorage.removeItem('workoutDraft');
  localStorage.removeItem('activePlanKey');

  // Keep workoutLogs in memory in sync
  const logIdx = workoutLogs.findIndex(r => r.date === date);
  const newRow = { user_id: currentUser.id, date, exercises: workoutData, duration_minutes: durationMinutes, plan_key: activePlanKey };
  if (logIdx >= 0) workoutLogs[logIdx] = newRow;
  else workoutLogs.push(newRow);
  renderWorkoutHistory();

  const chip = document.getElementById('workoutChip');
  if (!chip.classList.contains('completed')) toggleTask(chip);

  renderWorkoutSelector();
  populateExerciseSelect();
  updateUI();
}

// Re-opens the most recently logged workout pre-filled for editing
function editWorkout() {
  const allWorkouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const loggedDate = localStorage.getItem('workoutLoggedDate');
  const savedWorkout = loggedDate ? allWorkouts[loggedDate] : null;

  if (savedWorkout) {
    editingWorkoutDate = loggedDate;
    const allEx = getAllExercises();
    const exercises = savedWorkout.map(saved => {
      const info = allEx.find(e => e.name.toLowerCase() === saved.name.toLowerCase());
      return {
        name: saved.name,
        sets: saved.sets.length,
        isLift: info?.isLift || false,
        isRun: info?.isRun || false
      };
    });
    renderWorkoutForm(exercises, savedWorkout);
  }
}

// Wires up drag-to-reorder on .exercise elements (desktop drag events + touch fallback)
function setupExerciseDragDrop(container) {
  let dragEl = null;

  container.addEventListener('dragstart', e => {
    const ex = e.target.closest('.exercise');
    if (!ex) return;
    dragEl = ex;
    requestAnimationFrame(() => ex.classList.add('dragging'));
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', () => {
    if (dragEl) {
      dragEl.classList.remove('dragging');
      dragEl = null;
    }
    container.querySelectorAll('.exercise').forEach(el => el.classList.remove('drag-over'));
    saveWorkoutDraft();
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragEl) return;
    const ex = e.target.closest('.exercise');
    if (!ex || ex === dragEl) return;
    const rect = ex.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      container.insertBefore(dragEl, ex);
    } else {
      container.insertBefore(dragEl, ex.nextElementSibling);
    }
  });

  container.addEventListener('drop', e => e.preventDefault());

  // ── Touch / mobile drag ──
  // Touch drag — starts only when the user grabs the drag handle icon
  container.addEventListener('touchstart', e => {
    const handle = e.target.closest('.btn-drag-ex');
    if (!handle) return;
    dragEl = handle.closest('.exercise');
    if (!dragEl) return;
    dragEl.classList.add('dragging');
    e.preventDefault(); // prevent scrolling while dragging
  }, { passive: false });

  container.addEventListener('touchmove', e => {
    if (!dragEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    // Temporarily hide the dragged element so elementFromPoint can find what's beneath it
    dragEl.style.visibility = 'hidden';
    const below = document.elementFromPoint(touch.clientX, touch.clientY);
    dragEl.style.visibility = '';
    if (!below) return;
    const target = below.closest('.exercise');
    if (!target || target === dragEl) return;
    const rect = target.getBoundingClientRect();
    if (touch.clientY < rect.top + rect.height / 2) {
      container.insertBefore(dragEl, target);
    } else {
      container.insertBefore(dragEl, target.nextElementSibling);
    }
  }, { passive: false });

  container.addEventListener('touchend', () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl = null;
    saveWorkoutDraft();
  });
}

// Builds and injects the exercise input form into #workout
// exercises: array of { name, sets (count), isLift, isRun }
// savedData: optional array to pre-fill inputs (used when editing a past workout)
function renderWorkoutForm(exercises, savedData) {
  document.getElementById('page-workout').classList.remove('workout-logged');
  document.getElementById('page-workout').classList.remove('workout-selecting');
  const container = document.getElementById('workout');
  container.innerHTML = '';
  container.removeEventListener('input', saveWorkoutDraft);
  container.addEventListener('input', saveWorkoutDraft);
  container.removeEventListener('input', handleExerciseInput);
  container.addEventListener('input', handleExerciseInput);
  container.removeEventListener('focusout', handleExerciseFieldBlur);
  container.addEventListener('focusout', handleExerciseFieldBlur);
  setupExerciseDragDrop(container);
  // Start the session timer when the user first touches an input
  workoutTimerStart = null;
  container.addEventListener('input', function startTimer(e) {
    if (workoutTimerStart === null && e.target.closest('.exercise')) {
      workoutTimerStart = Date.now();
      container.removeEventListener('input', startTimer); // one-shot
    }
  });

  // Find the most recent past workout that shares exercises with this list
  // (used to show "Last: …" reference values in each exercise header)
  const prevWorkout = getPreviousWorkout(exercises);
  exercises.forEach(exercise => {
    const prevSets = prevWorkout?.exercises.find(
      e => e.name.toLowerCase() === exercise.name.toLowerCase()
    )?.sets ?? null;
    container.innerHTML += createExercise(exercise, prevSets);
  });

  const allExNames = getAllExercises().map(e => e.name);
  const exListOptions = allExNames.map(n => `<option value="${n}">`).join('');
  container.innerHTML += `
    <datalist id="exerciseOptions">${exListOptions}</datalist>
    <div class="input-group" id="addExerciseForm" style="margin-top: 4px;">
      <input type="text" id="newExName" placeholder="Choose or type exercise" list="exerciseOptions" autocomplete="off" oninput="onExerciseNameInput()">
      <select id="newExType" class="exercise-select" style="flex: 0.7; min-width: 110px;">
        <option value="bodyweight">Bodyweight</option>
        <option value="lift">Lift</option>
        <option value="run">Run</option>
      </select>
      <input type="number" id="newExSets" placeholder="Sets" min="1" max="20" value="4" style="flex: 0.3; min-width: 60px;">
      <button class="btn-primary" onclick="addExercise()">Add</button>
    </div>
  `;
  container.innerHTML += `<button class="btn-primary" id="logWorkoutBtn" onclick="logWorkout()">Log Workout</button>`;

  if (savedData) {
    prefillWorkout(savedData);
  }

  // Collapse any exercise that's already fully filled in (e.g. editing a past
  // workout) and expand only the first one still needing input.
  initExerciseCollapseState(container);
}

// Pre-fills all set inputs from saved exercise data (used by editWorkout)
function prefillWorkout(savedExercises) {
  const exerciseEls = document.querySelectorAll('.exercise');
  savedExercises.forEach((savedEx, i) => {
    if (i >= exerciseEls.length) return;
    const sets = exerciseEls[i].querySelectorAll('.set');
    savedEx.sets.forEach((setData, j) => {
      if (j >= sets.length) return;
      const inputs = sets[j].querySelectorAll('input');
      setData.forEach((val, k) => {
        if (inputs[k] && val) inputs[k].value = val;
      });
    });
  });
}

// When the user picks an existing exercise from the datalist, auto-fill its type and set count
function onExerciseNameInput() {
  const name = document.getElementById('newExName').value.trim();
  const match = getAllExercises().find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!match) return;
  document.getElementById('newExType').value = match.isRun ? 'run' : match.isLift ? 'lift' : 'bodyweight';
  if (match.sets) document.getElementById('newExSets').value = match.sets;
}

// Adds a custom exercise to the current form and persists its type to Supabase
async function addExercise() {
  const nameInput = document.getElementById('newExName');
  const name = nameInput.value.trim();
  const type = document.getElementById('newExType').value;
  const sets = parseInt(document.getElementById('newExSets').value) || 4;

  if (!name) return;

  const exercise = { name, sets, isLift: type === 'lift', isRun: type === 'run' };

  // Save the exercise type definition if it hasn't been seen before
  const allEx = getAllExercises();
  if (!allEx.find(e => e.name.toLowerCase() === name.toLowerCase())) {
    await db.from('custom_exercises').upsert(
      { user_id: currentUser.id, name, is_lift: exercise.isLift, is_run: exercise.isRun },
      { onConflict: 'user_id,name' }
    );
    const custom = JSON.parse(localStorage.getItem('customExercises') || '[]');
    custom.push({ name, isLift: exercise.isLift, isRun: exercise.isRun });
    localStorage.setItem('customExercises', JSON.stringify(custom));
  }

  const prevSets = getPrevSetsForExercise(name);
  document.getElementById('addExerciseForm').insertAdjacentHTML('beforebegin', createExercise(exercise, prevSets));
  nameInput.value = '';
  saveWorkoutDraft();
}

// Converts history-format exercise data [{name, sets:[[…],…]}]
// to definition format [{name, sets:N, isLift, isRun}].
// Type is inferred from set array length when the exercise is not in the known list:
//   3 values → run (miles, min, sec), 2 → lift (reps, lbs), 1 → bodyweight (reps)
function exerciseDefsFromHistory(historyExercises) {
  const allKnown = getAllExercises();
  return historyExercises.map(histEx => {
    const known = allKnown.find(e => e.name.toLowerCase() === histEx.name.toLowerCase());
    if (known) {
      return { name: histEx.name, sets: histEx.sets.length, isLift: known.isLift, isRun: known.isRun };
    }
    // Infer type from set data: run=[miles,min,sec] (3), lift=[reps,lbs] (2), bodyweight=[reps] (1)
    const setLen = histEx.sets?.[0]?.length ?? 1;
    const isRun = setLen === 3;
    const isLift = !isRun && setLen === 2;
    return { name: histEx.name, sets: histEx.sets.length, isLift, isRun };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKOUT HISTORY
// ─────────────────────────────────────────────────────────────────────────────

let workoutHistoryResizeObserver = null;

// Renders the collapsible workout history list below the form
function renderWorkoutHistory() {
  const container = document.getElementById('workoutHistory');
  if (!container) return;

  const sorted = [...workoutLogs].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!sorted.length) {
    container.innerHTML = '<p class="empty-state">No workouts logged yet.</p>';
    return;
  }

  const allEx = getAllExercises();

  function renderRow(row) {
    const dur  = row.duration_minutes ? `${row.duration_minutes} min` : '—';
    const d    = new Date(row.date);
    const date = isNaN(d) ? row.date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const name = isNaN(d) ? 'Workout' : d.toLocaleDateString('en-US', { weekday: 'long' });
    const exerciseLines = (row.exercises || []).map(ex => {
      const info    = allEx.find(e => e.name.toLowerCase() === ex.name.toLowerCase());
      const summary = formatPrevSets(ex.sets, info?.isLift || false, info?.isRun || false);
      return `<div class="wh-ex"><span class="wh-exname">${ex.name}</span><span class="wh-exsets">${summary}</span></div>`;
    }).join('');
    return `
      <div class="wh-row" onclick="this.classList.toggle('wh-open')">
        <div class="wh-header">
          <span class="wh-date">${name}, ${date}</span>
          <span class="wh-dur">${dur}</span>
          <span class="material-icons wh-delete" onclick="event.stopPropagation(); deleteWorkoutRow('${row.date}')">delete</span>
          <span class="material-icons wh-arrow">expand_more</span>
        </div>
        <div class="wh-detail">${exerciseLines}</div>
      </div>`;
  }

  const isDesktop = window.innerWidth > 768;

  if (isDesktop) {
    // Desktop: the card has a real flex-bound height (fills the row next to
    // the workout form), so render every row and then measure how many
    // actually fit — rather than either scrolling immediately (all rows) or
    // leaving blank space below a short list. Whatever doesn't fit hides
    // behind "Show More" instead.
    container.innerHTML = sorted.map(renderRow).join('');
    if (!workoutHistoryResizeObserver) {
      workoutHistoryResizeObserver = new ResizeObserver(() => fitWorkoutHistoryRows());
      workoutHistoryResizeObserver.observe(container);
    }
    fitWorkoutHistoryRows();
  } else {
    // Mobile: the card is auto-height (the whole page scrolls, not the
    // card), so "fill the available height" isn't a meaningful measurement
    // here — keep the simple fixed preview-count pagination instead.
    const LIMIT   = 5;
    const preview = sorted.slice(0, LIMIT);
    const rest    = sorted.slice(LIMIT);
    let html = preview.map(renderRow).join('');
    if (rest.length) {
      html += `<div id="whExtra" style="display:none;">${rest.map(renderRow).join('')}</div>`;
      html += `<button class="btn-primary wh-see-all-btn" onclick="toggleWorkoutHistoryAll(this)">See All</button>`;
    }
    container.innerHTML = html;
  }
}

// Hides whichever trailing .wh-row elements don't fit #workoutHistory's
// actual (flex-bound) height and appends a "Show More" button reserving
// space for itself — so the card fills with rows instead of scrolling or
// sitting with blank space below a short list. Re-run by a ResizeObserver
// whenever the container's size changes (window resize, layout reflow).
function fitWorkoutHistoryRows() {
  if (window.innerWidth <= 768) return; // mobile uses its own fixed-preview pagination
  const container = document.getElementById('workoutHistory');
  if (!container) return;

  const oldBtn = container.querySelector('.wh-see-all-btn');
  if (oldBtn) oldBtn.remove();

  const rows = [...container.querySelectorAll(':scope > .wh-row')];
  if (!rows.length) return;
  rows.forEach(r => { r.style.display = ''; });

  const available   = container.clientHeight;
  const totalHeight = rows.reduce((sum, r) => sum + r.offsetHeight, 0);
  if (totalHeight <= available) return; // everything already fits

  // Add the button before measuring so its real rendered height (not a
  // guess) is what gets reserved against the available space.
  const btn = document.createElement('button');
  btn.className = 'btn-primary wh-see-all-btn';
  btn.textContent = 'Show More';
  container.appendChild(btn);
  const btnStyle  = getComputedStyle(btn);
  const btnHeight = btn.offsetHeight + parseFloat(btnStyle.marginTop || 0);

  let used = 0;
  let fitCount = 0;
  for (const row of rows) {
    if (used + row.offsetHeight + btnHeight > available) break;
    used += row.offsetHeight;
    fitCount++;
  }
  fitCount = Math.max(fitCount, 1); // always show at least one row

  rows.slice(fitCount).forEach(r => { r.style.display = 'none'; });

  btn.onclick = () => {
    rows.slice(fitCount).forEach(r => { r.style.display = ''; });
    btn.remove();
  };
}

// Deletes a logged workout from history after confirmation, then syncs
// in-memory state, the chip, and every view that reads workout data
async function deleteWorkoutRow(date) {
  if (!confirm(`Delete the workout logged on ${date}?`)) return;

  await deleteWorkoutEntry(date);
  workoutLogs = workoutLogs.filter(r => r.date !== date);

  if (date === getToday()) {
    const chip = document.getElementById('workoutChip');
    if (chip.classList.contains('completed')) toggleTask(chip);
  }

  // Point the edit button at whatever workout is now most recent (if any)
  const remainingDates = workoutLogs.map(r => r.date).sort((a, b) => new Date(a) - new Date(b));
  const lastWorkout = remainingDates[remainingDates.length - 1];
  if (lastWorkout) localStorage.setItem('workoutLoggedDate', lastWorkout);
  else             localStorage.removeItem('workoutLoggedDate');

  renderWorkoutHistory();
  populateExerciseSelect();
  updateUI();
}

function toggleWorkoutHistoryAll(btn) {
  const extra    = document.getElementById('whExtra');
  const expanded = extra.style.display !== 'none';
  extra.style.display = expanded ? 'none' : 'block';
  btn.textContent     = expanded ? 'See All' : 'Show Less';
}

// Show the Mon/Wed/Fri plan picker (initial state of the workout page)
function renderWorkoutSelector() {
  document.getElementById('page-workout').classList.remove('workout-logged');
  document.getElementById('page-workout').classList.add('workout-selecting');
  const container = document.getElementById('workout');

  const plans = [
    { key: 'mon', label: 'Monday', icon: 'accessibility_new' },
    { key: 'wed', label: 'Wednesday', icon: 'directions_run' },
    { key: 'fri', label: 'Friday', icon: 'fitness_center' },
  ];

  container.innerHTML = `
    <div class="workout-selector-row">
      ${plans.map(p => `
        <label class="workout-plan-option" onclick="selectWorkoutPlan('${p.key}')">
          <input type="radio" name="workoutPlan" value="${p.key}" style="display:none">
          <span class="material-icons plan-icon">${p.icon}</span>
          <div class="plan-name">${p.label}</div>
        </label>
      `).join('')}
      <button class="btn-primary workout-start-btn" onclick="startWorkout()">
        <span class="material-icons">play_arrow</span>
        Start Workout
      </button>
    </div>
  `;
}

// Highlights the clicked plan option
function selectWorkoutPlan(key) {
  document.querySelectorAll('.workout-plan-option').forEach(el => el.classList.remove('selected'));
  const radio = document.querySelector(`.workout-plan-option input[value="${key}"]`);
  if (radio) {
    radio.checked = true;
    radio.closest('.workout-plan-option').classList.add('selected');
  }
}

// Loads the form for the selected plan, pre-populated from the last time that plan was done
function startWorkout() {
  const selected = document.querySelector('input[name="workoutPlan"]:checked');
  if (!selected) return;
  const planKey = selected.value;

  // Track which plan this workout session belongs to so logWorkout can tag it
  localStorage.setItem('activePlanKey', planKey);

  const planMap = { mon: monWorkout, wed: wedWorkout, fri: friWorkout };
  const lastWorkout = getLastWorkoutForPlan(planKey);

  if (lastWorkout) {
    renderWorkoutForm(exerciseDefsFromHistory(lastWorkout));
  } else {
    renderWorkoutForm(planMap[planKey]);
  }
}

// Finds the most recent logged workout matching a given plan key (mon/wed/fri).
// Prefers an exact tagged date; falls back to >50% exercise overlap.
function getLastWorkoutForPlan(planKey) {
  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const today = getToday();

  // Prefer the exact date tagged when a workout was previously logged via this plan
  const planWorkoutDates = JSON.parse(localStorage.getItem('planWorkoutDates') || '{}');
  const taggedDate = planWorkoutDates[planKey];
  if (taggedDate && taggedDate !== today && workouts[taggedDate]) {
    return workouts[taggedDate];
  }

  // Fallback: overlap matching against the hardcoded plan (for workouts logged before tagging)
  const planMap = { mon: monWorkout, wed: wedWorkout, fri: friWorkout };
  const plan = planMap[planKey];
  if (!plan) return null;
  const planNames = new Set(plan.map(e => e.name.toLowerCase()));
  // Sort by actual date value (not locale string) so single- vs double-digit months sort correctly
  const sorted = Object.keys(workouts)
    .filter(d => d !== today)
    .sort((a, b) => new Date(a) - new Date(b))
    .reverse();
  for (const date of sorted) {
    const w = workouts[date];
    if (!Array.isArray(w) || w.length === 0) continue;
    const matches = w.filter(e => planNames.has(e.name.toLowerCase())).length;
    if (matches >= Math.ceil(planNames.size / 2)) return w;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXERCISE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Returns all known exercises (three fixed plans + user-added custom ones)
function getAllExercises() {
  const custom = JSON.parse(localStorage.getItem('customExercises') || '[]');
  return [...monWorkout, ...wedWorkout, ...friWorkout, ...custom];
}

// Populates the exercise chart dropdown with every exercise ever logged
function populateExerciseSelect() {
  const select = document.getElementById('exerciseSelect');
  if (!select) return;

  const currentValue = select.value;
  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const nameSet = new Set();

  Object.values(workouts).forEach(workout => workout.forEach(ex => nameSet.add(ex.name)));

  const names = [...nameSet].sort((a, b) => a.localeCompare(b));
  select.innerHTML = names.map(name =>
    `<option value="${name.toLowerCase()}">${name}</option>`
  ).join('');

  if (currentValue && names.some(n => n.toLowerCase() === currentValue)) {
    select.value = currentValue;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// STREAKS
// ─────────────────────────────────────────────────────────────────────────────

// Averages sleep efficiency (% of time in bed actually asleep) over the most
// recent 7 logged nights. Entries without both hours and time_in_bed are skipped.
function calcSleepEfficiencyAvg(entries) {
  const recent = entries.slice(-7);
  const values = recent
    .filter(e => e.hours != null && e.time_in_bed)
    .map(e => (e.hours / e.time_in_bed) * 100);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

// Counts consecutive calendar days with a log entry. No days are skipped.
// Today is not penalized if unlogged (the day may not be over yet).
function calcDailyStreak(loggedDateStrings) {
  const dateSet = new Set(loggedDateStrings);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const todayStr = now.toLocaleDateString();
  let streak = 0;
  let d = new Date(now);
  for (let i = 0; i < 500; i++) {
    const dateStr = d.toLocaleDateString();
    const isLogged = dateSet.has(dateStr);
    if (dateStr === todayStr && !isLogged) {
      d.setDate(d.getDate() - 1);
      continue;
    }
    if (isLogged) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// Counts consecutive expected days where the user logged an entry.
// Rules:
//   - Saturdays are always skipped (not expected)
//   - workoutMode = true: only Mon/Wed/Fri are expected
//   - Today is never penalized for having no entry yet (the day may not be
//     over yet) — but this is distinct from today having an entry that
//     simply doesn't qualify (e.g. released=true), which DOES break the
//     streak same as any other day. loggedDateStrings is the qualifying set
//     (e.g. "no release" days); allLoggedDateStrings (defaults to the same
//     set when the two coincide, as for callers with no such distinction) is
//     every date that has ANY entry at all, used only to tell those two
//     "today" cases apart.
function calcStreak(loggedDateStrings, workoutMode = false, allLoggedDateStrings = loggedDateStrings) {
  const dateSet = new Set(loggedDateStrings);
  const allSet = new Set(allLoggedDateStrings);

  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const todayStr = now.toLocaleDateString();

  let streak = 0;
  let d = new Date(now);

  for (let i = 0; i < 500; i++) {
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dateStr = d.toLocaleDateString();

    const isExpected = dayName !== 'Sat' &&
      (!workoutMode || dayName === 'Mon' || dayName === 'Wed' || dayName === 'Fri');

    if (!isExpected) {
      d.setDate(d.getDate() - 1);
      continue;
    }

    const isLogged = dateSet.has(dateStr);

    // Don't penalize today for having no entry at all yet. If today DOES
    // have an entry but it's not in the qualifying set (e.g. released=true),
    // fall through to the normal break below instead of skipping it.
    if (dateStr === todayStr && !isLogged && !allSet.has(dateStr)) {
      d.setDate(d.getDate() - 1);
      continue;
    }

    if (isLogged) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// Rebuilds the streak grid on the home page
function updateStreaks() {
  const container = document.getElementById('streaksGrid');
  if (!container) return;

  const meditationDates    = getMeditationDates();
  const sleepEfficiencyAvg = calcSleepEfficiencyAvg(sleepData);
  const releaseDates       = psychData.filter(e => !e.released).map(e => e.date);
  const allPsychDates      = psychData.map(e => e.date);
  const socialDates        = socialData.map(e => e.date);

  const streaks = [
    { label: 'meditation',       count: calcDailyStreak(meditationDates), icon: 'self_improvement',      unit: ['day', 'days'] },
    { label: 'sleep efficiency', count: sleepEfficiencyAvg,               icon: 'bedtime',                unit: ['%', '%'], inlineUnit: true },
    { label: 'no release',       count: calcStreak(releaseDates, false, allPsychDates), icon: 'local_fire_department',  unit: ['day', 'days'] },
    { label: 'any interaction',  count: calcDailyStreak(socialDates),     icon: 'people',                 unit: ['day', 'days'] },
  ];

  container.innerHTML = streaks.map(s => {
    const hasValue = s.count != null;
    const unit = s.count === 1 ? s.unit[0] : s.unit[1];
    const countText = hasValue ? (s.inlineUnit ? `${s.count}${unit}` : s.count) : '–';
    return `
    <div class="streak-item">
      <span class="material-icons streak-icon">${s.icon}</span>
      <div class="streak-count${hasValue && s.count > 0 ? ' active' : ''}">${countText}</div>
      <div class="streak-unit">${s.inlineUnit ? '' : unit}</div>
      <div class="streak-label">${s.label}</div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// WEATHER
// Currently hardcoded to NYC coordinates. Uncomment the getLocation() call in
// loadWeather() to use the device's actual location instead.
// ─────────────────────────────────────────────────────────────────────────────

function getLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude
      }),
      err => reject(err)
    );
  });
}

const WEATHER_API_KEY = "1856f6602a8285d123677bb2359f0e65";
const LAT = 40.8075; // NYC
const LON = -73.9626;

async function fetchWeather(lat, lon) {
  const res = await fetch(
    `https://api.openweathermap.org/data/3.0/onecall` +
    `?lat=${lat}&lon=${lon}&exclude=minutely,hourly,daily,alerts&units=imperial&appid=${WEATHER_API_KEY}`
  );
  if (!res.ok) throw new Error("Weather fetch failed");
  return res.json();
}

async function loadWeather() {
  // const { lat, lon } = await getLocation(); // uncomment to use device location
  const data = await fetchWeather(LAT, LON);
  document.getElementById("location").textContent = data.timezone;
  document.getElementById("temp").textContent     = `${Math.round(data.current.temp)}°F`;
  document.getElementById("desc").textContent     = data.current.weather[0].description;
}

loadWeather(); // runs immediately on page load

// ─────────────────────────────────────────────────────────────────────────────
// QUOTES
// ─────────────────────────────────────────────────────────────────────────────

function getQuote() {
  const q = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById("quote").textContent  = q.quote;
  document.getElementById("author").textContent = "- " + q.author;
}

const quotes = [
  { quote:"After all, the future is built by ruthless pragmatists; not the armchair theorizers who meander the forest of their own words.", author: "Anonymous" },
  { quote: "One man with courage is the majority.", author: "Thomas Jefferson" },
  { quote: "Better to do something imperfectly than to do nothing flawlessly.", author: "Harriet Braiker" },
  { quote: "Striving for excellence motivates you; striving for perfection is demoralizing.", author: "Robert Shuller" },
  { quote: "The soul becomes dyed with the colour of its thoughts.", author: "Marcus Aurelius" },
  { quote: "What doesn't transmit light creates its own darkness.", author: "Unknown" },
  { quote: "Do every act of your life as though it were the very last act of your life.", author: "Marcus Aurelius" },
  { quote: "Perfection of character is this: to live each day as if it were your last, without frenzy, without apathy, without pretence.", author: "Marcus Aurelius" },
  { quote: "No longer wander at hazard; for neither wilt thou read thy own memoirs, nor the acts of the ancient Romans and Hellenes, and the selections from books which thou wast reserving for thy old age. Hasten then to the end which thou hast before thee, and throwing away idle hopes, come to thy own aid, if thou carest at all for thyself, while it is in thy power.", author: "Marcus Aurelius" },
  { quote: "Every moment think steadily as a Roman and a man to do what thou hast in hand with perfect and simple dignity, and feeling of affection, and freedom, and justice; and to give thyself relief from all other thoughts. And thou wilt give thyself relief, if thou doest every act of thy life as if it were the last, laying aside all carelessness and passionate aversion from the commands of reason, and all hypocrisy, and self-love, and discontent with the portion which has been given to thee. Thou seest how few the things are, the which if a man lays hold of, he is able to live a life which flows in quiet, and is like the existence of the gods; for the gods on their part will require nothing more from him who observes these things.", author: "Marcus Aurelius" },
  { quote: "Pass then through this little space of time conformably to nature, and end thy journey in content, just as an olive falls off when it is ripe, blessing nature who produced it, and thanking the tree on which it grew.", author: "Marcus Aurelius" },
  { quote: "Not that this is a misfortune, but that to bear it nobly is good fortune.", author: "Marcus Aurelius" },
  { quote: "We lose ourselves when we compromise the very ideals that we fight to defend. And we honor those ideals by upholding them not when it's easy, but when it is hard.", author: "Barack Obama" },
  { quote: "It's not the load that breaks you down – it's the way you carry it.", author: "Lou Holtz" },
  { quote: "You'll never get ahead of anyone as long as you try to get even with him.", author: "Lou Holtz" },
  { quote: "Thou art an old man; no longer let this be a slave, no longer be pulled by the strings like a puppet to unsocial movements, no longer either be dissatisfied with thy present lot, or shrink from the future.", author: "Marcus Aurelius" },
  { quote: "Art is never finished, only abandoned.", author: "Leonardo da Vinci" },
  { quote: "Wisdom is the daughter of experience.", author: "Leonardo da Vinci" },
  { quote: "Men of lofty genius sometimes accomplish the most when they work least, for their minds are occupied with their ideas and the perfection of their conceptions, to which they afterwards give form.", author: "Leonardo da Vinci" },
  { quote: "Do not wish for an easy life. Wish for the strength to endure a difficult one.", author: "Bruce Lee" },
  { quote: "If you think you’re boring your audience, go slower not faster.", author: "Gustav Mahler" },
  { quote: "Saying no frees you up to saying yes when it matters most.", author: "Adam Grant" },
  { quote: "You are what you do, not what you say you'll do.", author: "Carl Jung" },
  { quote: "My powers are ordinary. Only my application brings me success.", author: "Isaac Newton" },
  { quote: "My life has always been my music, it’s always come first, but the music ain’t worth nothing if you can’t lay it on the public. The main thing is to live for that audience, ’cause what you’re there for is to please the people.", author: "Louis Armstrong" },
  { quote: "Learn from the mistakes of others. You can never live long enough to make them all yourself.", author: "Groucho Marx" },
  { quote: "In times of change, learners inherit the earth, while the learned find themselves beautifully equipped to deal with a world that no longer exists.", author: "Eric Hoffer" },
  { quote: "Beware the barrenness of a busy life.", author: "Socrates" },
  { quote: "As you think, so shall you become.", author: "Bruce Lee" },
  { quote: "We won't be distracted by comparison if we are captivated with purpose.", author: "Bob Goff" },
  { quote: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { quote: "You often feel tired, not because you've done too much, but because you've done too little of what sparks a light in you.", author: "Unknown" },
  { quote: "But we are entitled only to the moment, and owe nothing to the future except that we follow our convictions.", author: "Lysander au Lune" },
  { quote: "If you can imagine it, you can achieve it. If you can dream it, you can become it.", author: "William Arthur Ward" },
  { quote: "The fear of death follows from the fear of life. One who lives life fully is prepared to die at any time.", author: "Edward Abbey" },
  { quote: "It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.", author: "Seneca" },
  { quote: "The universe is full of magical things patiently waiting for our wits to grow sharper.", author: "Eden Phillpotts" },
  { quote: "Our dreams can come true if we have the courage to pursue them.", author: "Walt Disney" },
  { quote: "Those who have a 'why' to live, can bear with almost any 'how'.", author: "Viktor E. Frankl" },
  { quote: "Sometimes it is not enough to do our best; we must do what is required.", author: "Winston Churchill" },
  { quote: "The cave you fear to enter holds the treasure that you seek.", author: "Joseph Campbell" },
  { quote: "As is a tale, so is life: not how long it is, but how good it is, is what matters.", author: "Seneca" },
  { quote: "If a man knows not to which port he sails, no wind is favorable.", author: "Seneca" },
  { quote: "It is not that we have so little time but that we lose so much. The life we receive is not short but we make it so; we are not ill provided but use what we have wastefully.", author: "Seneca" },
  { quote: "He who is brave is free.", author: "Seneca" },
  { quote: "Often a very old man has no other proof of his long life than his age.", author: "Seneca" },
  { quote: "Tomorrow becomes never. No matter how small the task, take the first step now.", author: "Tim Ferriss" },
  { quote: "If you cannot do great things, do small things in a great way.", author: "Napoleon Hill" },
  { quote: "The time is always right to do what is right.", author: "Martin Luther King Jr." },
  { quote: "Besides the noble art of getting things done, there is the noble art of leaving things undone. The wisdom of life consists in the elimination of non-essentials.", author: "Lin Yutang" },
  { quote: "You can, you should, and if you’re brave enough to start, you will.", author: "Stephen King" },
  { quote: "We awaken in others the same attitude of mind we hold toward them.", author: "Elbert Hubbard" },
  { quote: "Our greatest weakness lies in giving up. The most certain way to succeed is always to try just one more time.", author: "Thomas Edison" },
  { quote: "You can feel sore tomorrow or you can feel sorry tomorrow. You choose.", author: "Unknown" },
  { quote: "Nothing diminishes anxiety faster than action.", author: "Walter Anderson" },
  { quote: "Pain is temporary, quitting lasts forever.", author: "Lance Armstrong" },
  { quote: "What gets measured gets managed.", author: "Peter Drucker" },
  { quote: "Too many of us are not living our dreams because we are living our fears.", author: "Les Brown" },
  { quote: "In a world where information is abundant and easy to access, the real advantage is knowing where to focus.", author: "James Clear" },
  { quote: "The greatest discovery of all time is that a person can change their future by merely changing their attitude.", author: "Oprah Winfrey" },
  { quote: "Adventure is worthwhile in itself.", author: "Amelia Earhart" },
  { quote: "The inspiration you seek is already within you. Be silent and listen.", author: "Rumi" }
];

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL TRACKER
// ─────────────────────────────────────────────────────────────────────────────

function updateSocialUI() {
  const today = getToday();
  const row   = socialData.find(r => r.date === today) || {};
  SOCIAL_CATEGORIES.forEach(cat => {
    const el = document.getElementById(`socialCount_${cat}`);
    if (el) el.textContent = row[cat] || 0;
  });
}

function socialCounts(row) {
  const counts = {};
  SOCIAL_CATEGORIES.forEach(cat => counts[cat] = (row && row[cat]) || 0);
  return counts;
}

async function logSocial(category) {
  const today    = getToday();
  const existing = socialData.find(e => e.date === today);
  const updated  = socialCounts(existing);
  updated[category]++;

  await db.from('social_logs').upsert(
    { user_id: currentUser.id, date: today, ...updated },
    { onConflict: 'user_id,date' }
  );

  const wasFirst = !existing || SOCIAL_CATEGORIES.every(cat => !existing[cat]);
  socialData = socialData.filter(e => e.date !== today);
  socialData.push({ user_id: currentUser.id, date: today, ...updated });

  if (wasFirst) {
    const chip = document.getElementById('socialChip');
    if (chip && !chip.classList.contains('completed')) toggleTask(chip);
  }
  updateSocialUI();
  updateSocialChart();
}

async function unlogSocial(category) {
  const today    = getToday();
  const existing = socialData.find(e => e.date === today);
  if (!existing || !existing[category]) return;
  const updated = socialCounts(existing);
  updated[category] = Math.max(0, updated[category] - 1);

  await db.from('social_logs').upsert(
    { user_id: currentUser.id, date: today, ...updated },
    { onConflict: 'user_id,date' }
  );

  socialData = socialData.filter(e => e.date !== today);
  socialData.push({ user_id: currentUser.id, date: today, ...updated });
  updateSocialUI();
  updateSocialChart();
}

function setSocialPeriod(days, btn) {
  socialDays = days;
  document.querySelectorAll('.social-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateSocialChart();
}

const socialIconPlugin = {
  id: 'socialIcons',
  afterDraw(chart) {
    const ctx = chart.ctx;
    // Material Icons Unicode codepoints: chat, mood, bolt, whatshot, favorite, send
    const glyphs = ['', '', '', '', '', ''];
    chart.data.datasets.forEach((dataset, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      meta.data.forEach((bar, j) => {
        if (!dataset.data[j]) return;
        const props = bar.getProps(['x', 'y', 'base', 'width'], true);
        const segH = props.base - props.y;
        if (segH < 14) return;
        const size = Math.min(segH - 4, 14);
        ctx.save();
        ctx.font = `${size}px "Material Icons"`;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyphs[i], props.x, props.y + segH / 2);
        ctx.restore();
      });
    });
  }
};

function updateSocialChart() {
  if (socialChart) socialChart.destroy();
  const canvas = document.getElementById('socialChart');
  if (!canvas) return;

  const labels = [];
  const series = SOCIAL_CATEGORIES.map(() => []);

  for (let i = socialDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString();
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const row = socialData.find(r => r.date === dateStr) || {};
    SOCIAL_CATEGORIES.forEach((cat, catIdx) => series[catIdx].push(row[cat] || 0));
  }

  const SOCIAL_DATASET_META = [
    { label: 'No Stakes',    color: 'rgba(99,  102, 241, 0.60)' },
    { label: 'Low Stakes',   color: 'rgba(56,  189, 248, 0.75)' },
    { label: 'Mod Stakes',   color: 'rgba(251, 146, 60,  0.85)' },
    { label: 'High Stakes',  color: 'rgba(250, 204, 21,  1.00)' },
    { label: 'Extreme Stakes', color: 'rgba(244, 63,  94,  0.90)' },
    { label: 'Real Stakes',  color: 'rgba(225, 29,  72,  1.00)' },
  ];

  socialChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: SOCIAL_DATASET_META.map((meta, i) => ({
        label: meta.label, data: series[i], backgroundColor: meta.color, stack: 'a'
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { stacked: true, ticks: { color: 'rgba(255,255,255,0.45)', maxRotation: 45, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: { stacked: true, beginAtZero: true, ticks: { color: 'rgba(255,255,255,0.45)', stepSize: 1, precision: 0 }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    },
    plugins: [socialIconPlugin]
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE (HealthyPi Move)
// Read-only dashboard for device_sleep_logs / device_stress_logs / device_activity_logs,
// which are written by a separate Python sync tool over Bluetooth — never by this app.
// Each chart shows a small "no device data synced yet" message instead of an
// empty canvas when its table has no rows for this user.
// ─────────────────────────────────────────────────────────────────────────────

// Shared helper: toggles the canvas/empty-state pair for a Device chart, then
// (if there's data) hands off to buildFn to actually construct the Chart.js instance.
function renderDeviceChart(dataArr, canvasId, emptyId, buildFn) {
  const canvas  = document.getElementById(canvasId);
  const emptyEl = document.getElementById(emptyId);
  if (!canvas) return null;

  if (!dataArr || dataArr.length === 0) {
    canvas.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return null;
  }

  canvas.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';
  return buildFn();
}

function updateDeviceCharts() {
  updateDeviceSleepChart();
  updateDeviceStressChart();
  updateDeviceActivityChart();
  updateDeviceHrChart();
  updateDeviceSpo2Chart();
  updateDeviceSkinTempChart();
  updateDeviceHrvChart();
  updateDeviceEdaChart();
  updateDeviceBpChart();
}

// Stacked bar of sleep stage minutes (light/deep/rem/wake) with the 0-100 sleep
// score overlaid as a line on a secondary axis.
function updateDeviceSleepChart() {
  if (deviceSleepChart) { deviceSleepChart.destroy(); deviceSleepChart = null; }

  deviceSleepChart = renderDeviceChart(deviceSleepData, 'deviceSleepChart', 'deviceSleepEmpty', () => {
    const isMobile = window.innerWidth <= 768;
    const chartData = [...deviceSleepData]
      .sort((a, b) => a.date_ts - b.date_ts)
      .map(e => ({ x: e.date.split('/').slice(0, 2).join('/'), ...e }));

    const ctx = document.getElementById('deviceSleepChart').getContext('2d');
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartData.map(d => d.x),
        datasets: [
          {
            label: 'Light', data: chartData.map(d => d.light_minutes),
            backgroundColor: 'rgba(100, 210, 255, 0.75)', stack: 'sleep', yAxisID: 'y1'
          },
          {
            label: 'Deep', data: chartData.map(d => d.deep_minutes),
            backgroundColor: 'rgba(94, 92, 230, 0.85)', stack: 'sleep', yAxisID: 'y1'
          },
          {
            label: 'REM', data: chartData.map(d => d.rem_minutes),
            backgroundColor: 'rgba(52, 199, 89, 0.75)', stack: 'sleep', yAxisID: 'y1'
          },
          {
            label: 'Wake', data: chartData.map(d => d.wake_minutes),
            backgroundColor: 'rgba(255, 107, 107, 0.75)', stack: 'sleep', yAxisID: 'y1'
          },
          {
            type: 'line',
            label: 'Sleep Score',
            data: chartData.map(d => d.score),
            borderColor: '#FF9500',
            backgroundColor: 'transparent',
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            borderWidth: 2,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#FFFFFF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y1: {
            type: 'linear',
            position: 'left',
            stacked: true,
            beginAtZero: true,
            ticks: { color: '#c4cad4', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' },
            title: { display: !isMobile, text: 'Minutes', color: '#c4cad4' }
          },
          y2: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#FF9500', display: !isMobile },
            grid: { display: false },
            title: { display: !isMobile, text: 'Score', color: '#FF9500' }
          }
        }
      }
    });
  });
}

// Line chart of average (solid) and max (dashed, lighter) stress over time.
function updateDeviceStressChart() {
  if (deviceStressChart) { deviceStressChart.destroy(); deviceStressChart = null; }

  deviceStressChart = renderDeviceChart(deviceStressData, 'deviceStressChart', 'deviceStressEmpty', () => {
    const isMobile = window.innerWidth <= 768;
    const chartData = [...deviceStressData]
      .sort((a, b) => a.date_ts - b.date_ts)
      .map(e => ({ x: e.date.split('/').slice(0, 2).join('/'), ...e }));

    const hasMax = chartData.some(d => d.max_stress != null);
    const datasets = [{
      label: 'Avg Stress',
      data: chartData.map(d => d.avg_stress),
      borderColor: '#FF6B6B',
      backgroundColor: 'rgba(255, 107, 107, 0.15)',
      tension: 0.3,
      fill: true
    }];
    if (hasMax) {
      datasets.push({
        label: 'Max Stress',
        data: chartData.map(d => d.max_stress),
        borderColor: 'rgba(255, 107, 107, 0.5)',
        backgroundColor: 'transparent',
        borderDash: [5, 4],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: false
      });
    }

    const ctx = document.getElementById('deviceStressChart').getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: { labels: chartData.map(d => d.x), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#c4cad4' },
            grid: { color: 'rgba(250,250,250,0.4)' }
          }
        }
      }
    });
  });
}

// Bar chart of daily steps with a 7-day moving average overlay (same convention
// used for weight/sleep/signals elsewhere in the app).
function updateDeviceActivityChart() {
  if (deviceActivityChart) { deviceActivityChart.destroy(); deviceActivityChart = null; }

  deviceActivityChart = renderDeviceChart(deviceActivityData, 'deviceActivityChart', 'deviceActivityEmpty', () => {
    const isMobile = window.innerWidth <= 768;
    const chartData = [...deviceActivityData]
      .sort((a, b) => a.date_ts - b.date_ts)
      .map(e => ({ x: e.date.split('/').slice(0, 2).join('/'), steps: e.steps }));

    const windowSize = 7;
    const maSteps = chartData.map((_, i) => {
      const slice = chartData.slice(Math.max(0, i - windowSize + 1), i + 1).filter(p => p.steps != null);
      if (!slice.length) return null;
      return Math.round(slice.reduce((s, p) => s + p.steps, 0) / slice.length);
    });

    const ctx = document.getElementById('deviceActivityChart').getContext('2d');
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartData.map(d => d.x),
        datasets: [
          {
            label: 'Steps',
            data: chartData.map(d => d.steps),
            backgroundColor: 'rgba(0, 136, 255, 0.6)'
          },
          {
            type: 'line',
            label: 'Steps (7-day avg)',
            data: maSteps,
            borderColor: '#FF9500',
            backgroundColor: 'transparent',
            tension: 0.4,
            fill: false,
            pointRadius: 0,
            borderWidth: 3,
            borderDash: [6, 4],
            clip: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#c4cad4' },
            grid: { color: 'rgba(250,250,250,0.4)' }
          }
        }
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE VITALS (device_vitals_logs)
// Spot-check / event-based readings (SpO2, blood pressure, ECG-derived HR, HRV,
// EDA) plus continuous heart rate & skin temp, all in one daily rollup row.
// Every field besides user_id/date/date_ts/source is nullable — most days will
// be missing most columns, since only heart rate & skin temp are continuously
// monitored; the rest are user-triggered spot checks. Null values are left as
// null (not coerced to 0) so Chart.js draws a gap for that day instead of a
// misleading zero.
// ─────────────────────────────────────────────────────────────────────────────

// Shared x-axis mapper used by all six vitals charts below.
function deviceVitalsChartData() {
  return [...deviceVitalsData]
    .sort((a, b) => a.date_ts - b.date_ts)
    .map(e => ({ x: e.date.split('/').slice(0, 2).join('/'), ...e }));
}

// Epoch-seconds cutoff for the Device page's intraday range filters (HR, skin
// temp); 'week' doesn't call this -- it stays on deviceVitalsData's daily
// rollup, already loaded.
function deviceIntradayRangeCutoff(range) {
  const now = new Date();
  if (range === 'hour') return Math.floor(now.getTime() / 1000) - 3600;
  if (range === '5h')   return Math.floor(now.getTime() / 1000) - 5 * 3600;
  if (range === '24h')  return Math.floor(now.getTime() / 1000) - 24 * 3600;
  if (range === 'today') {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return Math.floor(midnight.getTime() / 1000);
  }
  return null;
}

// The intraday sample tables (device_hr_samples, device_skin_temp_samples)
// aren't in the eager loadData() fetch (a week of samples is thousands of
// rows, and only these two charts need them) -- fetched on demand each time a
// sub-day range is selected.
async function fetchDeviceIntradaySamples(table, cutoffTs) {
  const { data, error } = await db.from(table)
    .select('*')
    .eq('user_id', currentUser.id)
    .gte('ts', cutoffTs)
    .order('ts');
  if (error) {
    console.error(`${table} fetch failed:`, error);
    return [];
  }
  return data || [];
}

// Line chart of avg heart rate with a shaded min–max band (same "band + solid
// avg line on top" treatment used for skin temp below). 'week' plots
// deviceVitalsData's daily rollup (one point/day, matching every other Device
// chart); the finer ranges plot intraday device_hr_samples instead, since a
// day only has one rollup point to show.
async function updateDeviceHrChart() {
  if (deviceHrChart) { deviceHrChart.destroy(); deviceHrChart = null; }

  const isIntraday = deviceHrRange !== 'week';
  const emptyEl = document.getElementById('deviceHrEmpty');

  let chartData;
  if (isIntraday) {
    const rows = await fetchDeviceIntradaySamples('device_hr_samples', deviceIntradayRangeCutoff(deviceHrRange));
    chartData = [...rows]
      .sort((a, b) => a.ts - b.ts)
      .map(e => ({
        x: new Date(e.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        hr_avg: e.hr, hr_min: e.hr_min, hr_max: e.hr_max
      }));
    if (emptyEl) {
      emptyEl.textContent = deviceVitalsData.length > 0
        ? 'No heart rate samples in this window yet.'
        : 'No device data synced yet.';
    }
  } else {
    chartData = deviceVitalsChartData();
    if (emptyEl) emptyEl.textContent = 'No device data synced yet.';
  }

  deviceHrChart = renderDeviceChart(chartData, 'deviceHrChart', 'deviceHrEmpty', () => {
    const isMobile = window.innerWidth <= 768;

    const hasRange = chartData.some(d => d.hr_min != null || d.hr_max != null);
    const datasets = [];
    if (hasRange) {
      datasets.push({
        label: 'Max HR', data: chartData.map(d => d.hr_max),
        borderColor: 'transparent', backgroundColor: 'transparent',
        pointRadius: 0, fill: false, tension: 0.3
      });
      datasets.push({
        label: 'Min–Max Range', data: chartData.map(d => d.hr_min),
        borderColor: 'transparent', backgroundColor: 'rgba(255, 107, 107, 0.15)',
        pointRadius: 0, fill: '-1', tension: 0.3
      });
    }
    datasets.push({
      label: 'Avg HR', data: chartData.map(d => d.hr_avg),
      borderColor: '#FF6B6B', backgroundColor: 'transparent',
      tension: 0.3, fill: false,
      pointRadius: isIntraday ? 0 : 3,
      borderWidth: 2
    });

    const ctx = document.getElementById('deviceHrChart').getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: { labels: chartData.map(d => d.x), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile, maxRotation: 0, autoSkip: true },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y: {
            ticks: { color: '#c4cad4' },
            grid: { color: 'rgba(250,250,250,0.4)' },
            title: { display: !isMobile, text: 'BPM', color: '#c4cad4' }
          }
        }
      }
    });
  });
}

// Line chart of avg SpO2 (solid) with min SpO2 as a lighter dashed line — same
// avg/max treatment as the Device Stress chart above, mirrored for the min side.
function updateDeviceSpo2Chart() {
  if (deviceSpo2Chart) { deviceSpo2Chart.destroy(); deviceSpo2Chart = null; }

  deviceSpo2Chart = renderDeviceChart(deviceVitalsData, 'deviceSpo2Chart', 'deviceSpo2Empty', () => {
    const isMobile = window.innerWidth <= 768;
    const chartData = deviceVitalsChartData();

    const hasMin = chartData.some(d => d.spo2_min != null);
    const datasets = [{
      label: 'Avg SpO2',
      data: chartData.map(d => d.spo2_avg),
      borderColor: '#64D2FF',
      backgroundColor: 'rgba(100, 210, 255, 0.15)',
      tension: 0.3,
      fill: true,
      pointRadius: 3
    }];
    if (hasMin) {
      datasets.push({
        label: 'Min SpO2',
        data: chartData.map(d => d.spo2_min),
        borderColor: 'rgba(100, 210, 255, 0.5)',
        backgroundColor: 'transparent',
        borderDash: [5, 4],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: false
      });
    }

    const ctx = document.getElementById('deviceSpo2Chart').getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: { labels: chartData.map(d => d.x), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y: {
            ticks: { color: '#c4cad4' },
            grid: { color: 'rgba(250,250,250,0.4)' },
            title: { display: !isMobile, text: '%', color: '#c4cad4' }
          }
        }
      }
    });
  });
}

// Line chart of avg skin temp with a shaded min–max band, same treatment as
// the Heart Rate chart above. 'week' plots deviceVitalsData's daily rollup
// (min/max band included); the finer ranges plot intraday
// device_skin_temp_samples instead, which only has one value per epoch (no
// min/max pair), so the band is naturally absent there -- hasRange below
// only turns on when min/max fields actually exist in chartData.
async function updateDeviceSkinTempChart() {
  if (deviceSkinTempChart) { deviceSkinTempChart.destroy(); deviceSkinTempChart = null; }

  const isIntraday = deviceSkinTempRange !== 'week';
  const emptyEl = document.getElementById('deviceSkinTempEmpty');

  let chartData;
  if (isIntraday) {
    const rows = await fetchDeviceIntradaySamples('device_skin_temp_samples', deviceIntradayRangeCutoff(deviceSkinTempRange));
    chartData = [...rows]
      .sort((a, b) => a.ts - b.ts)
      .map(e => ({
        x: new Date(e.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        skin_temp_avg: e.skin_temp
      }));
    if (emptyEl) {
      emptyEl.textContent = deviceVitalsData.length > 0
        ? 'No skin temperature samples in this window yet.'
        : 'No device data synced yet.';
    }
  } else {
    chartData = deviceVitalsChartData();
    if (emptyEl) emptyEl.textContent = 'No device data synced yet.';
  }

  deviceSkinTempChart = renderDeviceChart(chartData, 'deviceSkinTempChart', 'deviceSkinTempEmpty', () => {
    const isMobile = window.innerWidth <= 768;

    const hasRange = chartData.some(d => d.skin_temp_min != null || d.skin_temp_max != null);
    const datasets = [];
    if (hasRange) {
      datasets.push({
        label: 'Max Temp', data: chartData.map(d => d.skin_temp_max),
        borderColor: 'transparent', backgroundColor: 'transparent',
        pointRadius: 0, fill: false, tension: 0.3
      });
      datasets.push({
        label: 'Min–Max Range', data: chartData.map(d => d.skin_temp_min),
        borderColor: 'transparent', backgroundColor: 'rgba(255, 149, 0, 0.15)',
        pointRadius: 0, fill: '-1', tension: 0.3
      });
    }
    datasets.push({
      label: 'Avg Temp', data: chartData.map(d => d.skin_temp_avg),
      borderColor: '#FF9500', backgroundColor: 'transparent',
      tension: 0.3, fill: false,
      pointRadius: isIntraday ? 0 : 3,
      borderWidth: 2
    });

    const ctx = document.getElementById('deviceSkinTempChart').getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: { labels: chartData.map(d => d.x), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile, maxRotation: 0, autoSkip: true },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y: {
            ticks: { color: '#c4cad4' },
            grid: { color: 'rgba(250,250,250,0.4)' },
            title: { display: !isMobile, text: '°', color: '#c4cad4' }
          }
        }
      }
    });
  });
}

// Dual-axis line chart: LF/HF ratio (small, ~0.5-3.0) on the left axis and
// mean RR interval in ms (~600-1200) on the right — same y1/y2 dual-axis
// pattern as the Device Sleep chart's stage-minutes/score overlay, needed
// here because the two series are on wildly different scales.
function updateDeviceHrvChart() {
  if (deviceHrvChart) { deviceHrvChart.destroy(); deviceHrvChart = null; }

  deviceHrvChart = renderDeviceChart(deviceVitalsData, 'deviceHrvChart', 'deviceHrvEmpty', () => {
    const isMobile = window.innerWidth <= 768;
    const chartData = deviceVitalsChartData();

    const ctx = document.getElementById('deviceHrvChart').getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.map(d => d.x),
        datasets: [
          {
            label: 'LF/HF',
            data: chartData.map(d => d.hrv_lfhf_avg),
            borderColor: '#BF5AF2',
            backgroundColor: 'transparent',
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            borderWidth: 2,
            yAxisID: 'y1'
          },
          {
            label: 'Mean RR (ms)',
            data: chartData.map(d => d.hrv_mean_rr_avg),
            borderColor: '#30B0C7',
            backgroundColor: 'transparent',
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            borderWidth: 2,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y1: {
            type: 'linear',
            position: 'left',
            ticks: { color: '#BF5AF2', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' },
            title: { display: !isMobile, text: 'LF/HF', color: '#BF5AF2' }
          },
          y2: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#30B0C7', display: !isMobile },
            grid: { display: false },
            title: { display: !isMobile, text: 'Mean RR (ms)', color: '#30B0C7' }
          }
        }
      }
    });
  });
}

// Dual-axis line chart: skin conductance level (left) and SCR rate (right) —
// same dual-axis approach as the HRV chart above, since SCL (µS) and SCR
// rate (events/min) aren't on comparable scales either.
function updateDeviceEdaChart() {
  if (deviceEdaChart) { deviceEdaChart.destroy(); deviceEdaChart = null; }

  deviceEdaChart = renderDeviceChart(deviceVitalsData, 'deviceEdaChart', 'deviceEdaEmpty', () => {
    const isMobile = window.innerWidth <= 768;
    const chartData = deviceVitalsChartData();

    const ctx = document.getElementById('deviceEdaChart').getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.map(d => d.x),
        datasets: [
          {
            label: 'SCL',
            data: chartData.map(d => d.eda_scl_avg),
            borderColor: '#0088FF',
            backgroundColor: 'rgba(0, 136, 255, 0.15)',
            tension: 0.3,
            fill: true,
            pointRadius: 3,
            yAxisID: 'y1'
          },
          {
            label: 'SCR Rate',
            data: chartData.map(d => d.eda_scr_rate_avg),
            borderColor: '#34C759',
            backgroundColor: 'transparent',
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            borderWidth: 2,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y1: {
            type: 'linear',
            position: 'left',
            ticks: { color: '#0088FF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' },
            title: { display: !isMobile, text: 'SCL (µS)', color: '#0088FF' }
          },
          y2: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#34C759', display: !isMobile },
            grid: { display: false },
            title: { display: !isMobile, text: 'SCR Rate (/min)', color: '#34C759' }
          }
        }
      }
    });
  });
}

// Grouped bar chart of systolic/diastolic averages. Sparse by nature — most
// days have no BP reading at all, since it's a manual spot check, not
// continuous monitoring. Null values are passed straight through (not
// coerced to 0) so Chart.js simply omits the bar for that day rather than
// drawing a misleading zero-height reading.
function updateDeviceBpChart() {
  if (deviceBpChart) { deviceBpChart.destroy(); deviceBpChart = null; }

  deviceBpChart = renderDeviceChart(deviceVitalsData, 'deviceBpChart', 'deviceBpEmpty', () => {
    const isMobile = window.innerWidth <= 768;
    const chartData = deviceVitalsChartData();

    const ctx = document.getElementById('deviceBpChart').getContext('2d');
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartData.map(d => d.x),
        datasets: [
          {
            label: 'Systolic',
            data: chartData.map(d => d.bp_systolic_avg),
            backgroundColor: 'rgba(255, 107, 107, 0.75)'
          },
          {
            label: 'Diastolic',
            data: chartData.map(d => d.bp_diastolic_avg),
            backgroundColor: 'rgba(0, 136, 255, 0.75)'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isMobile, labels: { color: '#c4cad4' } }
        },
        scales: {
          x: {
            ticks: { color: '#FFFFFF', display: !isMobile },
            grid: { color: 'rgba(250,250,250,0.4)' }
          },
          y: {
            ticks: { color: '#c4cad4' },
            grid: { color: 'rgba(250,250,250,0.4)' },
            title: { display: !isMobile, text: 'mmHg', color: '#c4cad4' }
          }
        }
      }
    });
  });
}
