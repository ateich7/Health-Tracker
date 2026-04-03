let weightData = [];
let sleepData = [];
let psychData = [];
let weightChart = null;
let exerciseChart = null;
let sleepChart = null;
let signalsChart = null;
let signalsReleaseChart = null;
let currentUser = null;
let editingWorkoutDate = null; // set when editing an existing workout so logWorkout saves to the right date
let workoutTimerStart = null;  // timestamp (ms) when the user first entered a value during the current session
let workoutLogs = [];          // full rows from workout_logs including duration_minutes

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

// Formats Date to English
function formatDate() {
  const date = new Date();
  const day = date.toLocaleDateString("en-US", { day: "numeric" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const suffix = ["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : (day % 100 - day % 10 != 10) * day % 10];
  document.getElementById('dateToday').textContent = `${month} ${day}${suffix}`;
}

// Called by supabase-client.js once a valid session exists
async function initApp() {
  const { data: { user } } = await db.auth.getUser();
  currentUser = user;

  formatDate();
  renderWorkoutForDay();

  const savedPage = localStorage.getItem('activePage') || 'home';
  activatePage(savedPage);

  await loadData();
  document.getElementById('weightInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') logWeight();
  });
}

// Switch visible page
function showPage(name) {
  activatePage(name);
  localStorage.setItem('activePage', name);

  // Refresh the chart(s) that just became visible
  if (name === 'weight') updateWeightChart();
  else if (name === 'sleep') updateSleepChart();
  else if (name === 'workout') updateExerciseChart();
  else if (name === 'signals') updateSignalsChart();
}

// DOM-only page switch (no chart refresh, no storage write)
function activatePage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll(`.nav-item[data-page="${name}"], .bottom-nav-item[data-page="${name}"]`)
    .forEach(n => n.classList.add('active'));
}

// Delete a workout entry by date from Supabase and localStorage
async function deleteWorkoutEntry(date) {
  await db.from('workout_logs').delete().eq('user_id', currentUser.id).eq('date', date);
  const allWorkouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  delete allWorkouts[date];
  localStorage.setItem('workouts', JSON.stringify(allWorkouts));
}

// Load all data from Supabase
async function loadData() {
  const [weightsRes, sleepsRes, workoutsRes, customExRes, psychRes] = await Promise.all([
    db.from('weight_logs').select('*').eq('user_id', currentUser.id).order('timestamp'),
    db.from('sleep_logs').select('*').eq('user_id', currentUser.id).order('timestamp'),
    db.from('workout_logs').select('*').eq('user_id', currentUser.id),
    db.from('custom_exercises').select('*').eq('user_id', currentUser.id),
    db.from('psych_logs').select('*').eq('user_id', currentUser.id).order('timestamp')
  ]);

  weightData = weightsRes.data || [];
  sleepData  = sleepsRes.data  || [];
  psychData  = psychRes.data   || [];

  workoutLogs = workoutsRes.data || [];

  // Rebuild workouts object in localStorage so chart functions can read it
  const workoutsObj = {};
  workoutLogs.forEach(row => { workoutsObj[row.date] = row.exercises; });
  localStorage.setItem('workouts', JSON.stringify(workoutsObj));

  // One-time cleanup: remove the duplicate today entry created by the edit-saves-wrong-date bug
  const dupCleanupKey = 'dupCleanup_3/17/2026';
  if (!localStorage.getItem(dupCleanupKey) && workoutsObj['3/17/2026']) {
    await deleteWorkoutEntry('3/17/2026');
    delete workoutsObj['3/17/2026'];
    localStorage.setItem('workouts', JSON.stringify(workoutsObj));
    localStorage.setItem(dupCleanupKey, '1');
  }

  // Cache custom exercises locally
  const customList = (customExRes.data || []).map(e => ({
    name: e.name, isLift: e.is_lift, isRun: e.is_run
  }));
  localStorage.setItem('customExercises', JSON.stringify(customList));

  // Derive chip completion states from fetched data
  const today     = getToday();
  const yesterday = getYesterday();

  if (weightData.some(e => e.date === today)) {
    const chip = document.getElementById('weightChip');
    if (!chip.classList.contains('completed')) toggleTask(chip);
  }
  if (sleepData.some(e => e.date === today)) {
    const chip = document.getElementById('sleepChip');
    if (!chip.classList.contains('completed')) toggleTask(chip);
  }
  if (psychData.some(e => e.date === today)) {
    const chip = document.getElementById('signalsChip');
    if (!chip.classList.contains('completed')) toggleTask(chip);
  }
  checkChipState('codesChip', 'codesLoggedDate');

  // Derive workoutLoggedDate for checkWorkoutLogState
  const sortedDates   = Object.keys(workoutsObj).sort();
  const lastWorkout   = sortedDates[sortedDates.length - 1];
  if (lastWorkout === today || lastWorkout === yesterday) {
    localStorage.setItem('workoutLoggedDate', lastWorkout);
  } else {
    localStorage.removeItem('workoutLoggedDate');
  }

  checkWorkoutLogState();
  populateExerciseSelect();
  renderWorkoutHistory();
  getQuote();
  updateUI();

  setTimeout(() => {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('mainContent').classList.add('loaded');
  }, 100);
}

// Log weight
async function logWeight() {
  const input  = document.getElementById('weightInput');
  const weight = parseFloat(input.value);
  if (!weight || weight <= 100 || weight >= 250) return;

  const today = getToday();
  const entry = { date: today, weight, timestamp: Date.now() };

  await db.from('weight_logs').upsert(
    { user_id: currentUser.id, ...entry },
    { onConflict: 'user_id,date' }
  );

  weightData = weightData.filter(e => e.date !== today);
  weightData.push(entry);
  weightData.sort((a, b) => a.timestamp - b.timestamp);

  input.value = '';
  const chip = document.getElementById('weightChip');
  if (!chip.classList.contains('completed')) toggleTask(chip);
  updateUI();
}

// Log sleep
async function logSleep() {
  const hoursInput  = document.getElementById('sleepHoursInput');
  const restedInput = document.getElementById('sleepRestedInput');
  const hours  = parseFloat(hoursInput.value);
  const rested = parseFloat(restedInput.value);
  if (!hours || hours < 0 || hours > 24) return;

  const today = getToday();
  const entry = { date: today, hours, rested, timestamp: Date.now() };

  await db.from('sleep_logs').upsert(
    { user_id: currentUser.id, ...entry },
    { onConflict: 'user_id,date' }
  );

  sleepData = sleepData.filter(e => e.date !== today);
  sleepData.push(entry);
  sleepData.sort((a, b) => a.timestamp - b.timestamp);

  hoursInput.value  = '';
  restedInput.value = '';
  const chip = document.getElementById('sleepChip');
  if (!chip.classList.contains('completed')) toggleTask(chip);
  updateUI();
}

// Check if chip should be marked complete
function checkChipState(chipId, storageKey) {
  if (localStorage.getItem(storageKey) === getToday()) {
    toggleTask(document.getElementById(chipId));
  }
}

// Get today's date
function getToday() {
  return new Date().toLocaleDateString();
}

// Get the day
function getDay() {
  return new Date().toLocaleDateString('en-US', { weekday: 'short' });
}


// Get last 30 days
function getLast30Days() {
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return date.toLocaleDateString();
  });
}

// Update all UI elements (only refreshes the chart for the active page)
function updateUI() {
  updateStats();
  updateStreaks();
  const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (activePage === 'weight') updateWeightChart();
  else if (activePage === 'sleep') updateSleepChart();
  else if (activePage === 'workout') updateExerciseChart();
  else if (activePage === 'signals') updateSignalsChart();
}

// Update stats
function updateStats() {
  const recentWeights = weightData.slice(-7);
  const avgWeight = recentWeights.length > 0
    ? (recentWeights.reduce((sum, e) => sum + e.weight, 0) / recentWeights.length).toFixed(1)
    : null;

  const weightChange = weightData.length > 0 && avgWeight
    ? (avgWeight - weightData[0].weight).toFixed(1)
    : null;

  document.getElementById('weightChange').textContent =
    weightChange ? `${weightChange > 0 ? '+' : ''}${weightChange} lbs` : '--';
  document.getElementById('avgWeight').textContent =
    avgWeight ? `${avgWeight} lbs` : '--';
}

// Update weight chart
function updateWeightChart() {
  if (weightChart) weightChart.destroy();

  const chartData = weightData.slice(-30).map(e => {
    const dateObj = new Date(e.date);

    return {
      x: e.date.split('/').slice(0, 2).join('/'),
      day: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      y: e.weight
    };
  });

  if (chartData.length === 0) return;

  const ctx = document.getElementById('weightChart').getContext('2d');
  weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      //labels: chartData.map(d => d.date),
      datasets: [{
        label: 'Weight (lbs)',
        data: chartData,
        borderColor: '#0088FF',
        backgroundColor: 'rgba(59, 130, 246, 0.25)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (e) => {
              const d = e[0].raw;
              return ` ${d.day} ${d.x}`;
            },
            label: (context) => { return ` ${context.raw.y} lbs`; }
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

// Update exercise chart
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

      if (exerciseInfo?.isRun) {
        // For runs: distance and time
        const totalDistance = exercise.sets.reduce((sum, set) => sum + (set[0] || 0), 0);
        const totalTime = exercise.sets.reduce((sum, set) => sum + (set[1] + (set[2] / 100) || 0), 0);
        return { date: `${month}/${day}`, value1: totalDistance, value2: totalTime };
      } else if (exerciseInfo?.isLift) {
        // For lifts: reps and weight
        const totalReps = exercise.sets.reduce((sum, set) => sum + (set[0] || 0), 0);
        const weightSets = exercise.sets.filter(set => set[1] != null);
        const avgWeight = weightSets.length > 0
          ? weightSets.reduce((sum, set) => sum + (set[1] || 0), 0) / weightSets.length
          : 0;
        return { date: `${month}/${day}`, value1: totalReps, value2: avgWeight };
      } else {
        // For bodyweight: just reps
        const totalReps = exercise.sets.reduce((sum, set) => sum + (set[0] || 0), 0);
        return { date: `${month}/${day}`, value1: totalReps, value2: null };
      }
    })
    .filter(Boolean)
    .slice(-30);

  if (chartData.length === 0) return;

  const ctx = document.getElementById('exerciseChart').getContext('2d');
  const exerciseName = selectedExercise.charAt(0).toUpperCase() + selectedExercise.slice(1);
  document.getElementById('exName').innerText = exerciseName;

  const datasets = [];
  const scales = {
    x: {
      ticks: { color: '#FFFFFF' },
      grid: { color: 'rgba(250,250,250,0.4)' }
    }
  };

  if (exerciseInfo?.isRun) {
    // Distance and Time
    datasets.push({
      label: 'Distance (miles)',
      data: chartData.map(d => d.value1),
      borderColor: '#0088FF',
      backgroundColor: 'rgba(0, 136, 255, 0.2)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y1'
    });
    datasets.push({
      label: 'Time (min.sec)',
      data: chartData.map(d => d.value2),
      borderColor: '#34C759',
      backgroundColor: 'rgba(52, 199, 89, 0.2)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y2'
    });
    scales.y1 = {
      type: 'linear',
      position: 'left',
      beginAtZero: true,
      ticks: { color: '#0088FF' },
      grid: { color: 'rgba(250,250,250,0.4)' },
      title: { display: true, text: 'Distance (miles)', color: '#0088FF' }
    };
    scales.y2 = {
      type: 'linear',
      position: 'right',
      min: 0,
      max: Math.max(...chartData.map(d => d.value2)) * 1.2,
      ticks: { color: '#34C759' },
      grid: { display: false },
      title: { display: true, text: 'Time (min.sec)', color: '#34C759' }
    };
  } else if (exerciseInfo?.isLift) {
    // Reps and Weight
    datasets.push({
      label: 'Total Reps',
      data: chartData.map(d => d.value1),
      borderColor: '#0088FF',
      backgroundColor: 'rgba(0, 136, 255, 0.2)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y1'
    });
    datasets.push({
      label: 'Avg Weight (lbs)',
      data: chartData.map(d => d.value2),
      borderColor: '#34C759',
      backgroundColor: 'rgba(52, 199, 89, 0.2)',
      tension: 0.3,
      fill: true,
      yAxisID: 'y2'
    });
    scales.y1 = {
      type: 'linear',
      position: 'left',
      beginAtZero: true,
      ticks: { color: '#0088FF' },
      grid: { color: 'rgba(250,250,250,0.4)' },
      title: { display: true, text: 'Total Reps', color: '#0088FF' }
    };
    scales.y2 = {
      type: 'linear',
      position: 'right',
      min: 0,
      max: Math.max(...chartData.map(d => d.value2)) * 1.2,
      ticks: { color: '#34C759' },
      grid: { display: false },
      title: { display: true, text: 'Avg Weight (lbs)', color: '#34C759' }
    };
  } else {
    // Bodyweight only - single axis
    datasets.push({
      label: 'Total Reps',
      data: chartData.map(d => d.value1),
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
      labels: chartData.map(d => d.date),
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

// Update sleep chart
function updateSleepChart() {
  if (sleepChart) sleepChart.destroy();

  const chartData = sleepData.slice(-30).map(e => {
    const dateObj = new Date(e.date);

    return {
      x: e.date.split('/').slice(0, 2).join('/'),
      day: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      y: e.hours,
      z: e.rested
    };
  });

  if (chartData.length === 0) return;

  const ctx = document.getElementById('sleepChart').getContext('2d');
  const datasets = [];
  const scales = {
    x: {
      ticks: { color: '#FFFFFF' },
      grid: { color: 'rgba(250,250,250,0.4)' }
    }
  };
  datasets.push({
    label: 'Hours Slept',
    data: chartData.map(d => d.y),
    borderColor: '#0088FF',
    backgroundColor: 'rgba(0, 136, 255, 0.2)',
    tension: 0.3,
    fill: true,
    yAxisID: 'y1'
  });
  datasets.push({
    label: 'Restedness Score',
    data: chartData.map(d => d.z),
    borderColor: '#34C759',
    backgroundColor: 'rgba(52, 199, 89, 0.2)',
    tension: 0.3,
    fill: true,
    yAxisID: 'y2'
  });
  scales.y1 = {
    type: 'linear',
    position: 'left',
    beginAtZero: true,
    ticks: { color: '#0088FF' },
    grid: { color: 'rgba(250,250,250,0.4)' },
    title: { display: true, text: 'Hours Slept', color: '#0088FF' }
  };
  scales.y2 = {
    type: 'linear',
    position: 'right',
    ticks: { color: '#34C759' },
    grid: { display: false },
    title: { display: true, text: 'Restedness Score', color: '#34C759' }
  };

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
        legend: {
          labels: { color: '#c4cad4' },
        }
      },
      scales: scales
    }
  });
}

// Log psych / signals entry
async function logPsych() {
  const confidence = parseInt(document.getElementById('psychConfidence').value);
  const stress     = parseInt(document.getElementById('psychStress').value);
  const low        = parseInt(document.getElementById('psychLow').value);
  const released   = document.getElementById('psychRelease').classList.contains('active');

  const today = getToday();
  const entry = { date: today, confidence, stress, low, released, timestamp: Date.now() };

  await db.from('psych_logs').upsert(
    { user_id: currentUser.id, ...entry },
    { onConflict: 'user_id,date' }
  );

  psychData = psychData.filter(e => e.date !== today);
  psychData.push(entry);
  psychData.sort((a, b) => a.timestamp - b.timestamp);

  const chip = document.getElementById('signalsChip');
  if (!chip.classList.contains('completed')) toggleTask(chip);
  updateSignalsChart();
}

function togglePsychRelease() {
  const btn = document.getElementById('psychRelease');
  const nowActive = !btn.classList.contains('active');
  btn.classList.toggle('active', nowActive);
  btn.classList.toggle('inactive', !nowActive);
  btn.textContent = nowActive ? 'Yes' : 'No';
}

// Update signals charts
function updateSignalsChart() {
  if (signalsChart) signalsChart.destroy();
  if (signalsReleaseChart) signalsReleaseChart.destroy();

  const chartData = psychData.slice(-30).map(e => ({
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

  const ctx1 = document.getElementById('signalsChart').getContext('2d');
  signalsChart = new Chart(ctx1, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Confidence',
          data: chartData.map(d => d.confidence),
          borderColor: '#0088FF',
          backgroundColor: 'rgba(0,136,255,0.15)',
          tension: 0.3,
          fill: true
        },
        {
          label: 'Stress',
          data: chartData.map(d => d.stress),
          borderColor: '#FF6B6B',
          backgroundColor: 'rgba(255,107,107,0.15)',
          tension: 0.3,
          fill: true
        },
        {
          label: 'Low',
          data: chartData.map(d => d.low),
          borderColor: '#A78BFA',
          backgroundColor: 'rgba(167,139,250,0.15)',
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#c4cad4' } } },
      scales
    }
  });

  const ctx2 = document.getElementById('signalsReleaseChart').getContext('2d');
  signalsReleaseChart = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Release',
        data: chartData.map(d => d.released),
        backgroundColor: chartData.map(d => d.released ? 'rgba(52,199,89,0.6)' : 'rgba(250,250,250,0.1)'),
        borderColor: chartData.map(d => d.released ? '#34C759' : 'rgba(250,250,250,0.2)'),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#FFFFFF' }, grid: { color: 'rgba(250,250,250,0.4)' } },
        y: {
          min: 0, max: 1,
          ticks: { color: '#c4cad4', stepSize: 1, callback: v => v === 1 ? 'Yes' : 'No' },
          grid: { color: 'rgba(250,250,250,0.4)' }
        }
      }
    }
  });
}

// Toggle task completion
function toggleTask(chip) {
  const check = chip.querySelector('.chip-check');
  chip.classList.toggle('completed');
  const isCompleted = chip.classList.contains('completed');
  if (check) check.style.display = isCompleted ? 'inline' : 'none';

  // Sync completion dot to the matching bottom nav item
  const page   = chip.dataset.page;
  const id     = chip.id;
  const bnItem = page
    ? document.querySelector(`.bottom-nav-item[data-page="${page}"]`)
    : id ? document.querySelector(`.bottom-nav-item[data-chip="${id}"]`) : null;
  if (bnItem) bnItem.classList.toggle('completed', isCompleted);
}

// Toggle chip on button click
function toggleOnClick(element) {
  toggleTask(element.parentElement);
}

// Toggle codes chip
function toggleCodes(chip) {
  const today = getToday();
  const loggedToday = localStorage.getItem('codesLoggedDate') === today;
  const codesLog = JSON.parse(localStorage.getItem('codesLog') || '[]');

  if (!loggedToday) {
    localStorage.setItem('codesLoggedDate', today);
    if (!codesLog.includes(today)) {
      codesLog.push(today);
      localStorage.setItem('codesLog', JSON.stringify(codesLog));
    }
  } else {
    localStorage.setItem('codesLoggedDate', null);
    localStorage.setItem('codesLog', JSON.stringify(codesLog.filter(d => d !== today)));
  }
  toggleTask(chip);
  updateStreaks();
}

// Open codes link
function openTaskLink(element) {
  window.open(
    'https://docs.google.com/document/d/16lPD_vvbuhUpa0yR5gFKQDGuDJHWc8wQhCI39g5GDTM/edit',
    '_blank',
    `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`
  );
  toggleCodes(element);
}

// Initialize when DOM is ready
// Bootstrap: runs after all scripts are loaded and DOM is ready
let appInitialized = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Listen for sign-in (magic link / password) and sign-out after initial load
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && !appInitialized) {
      appInitialized = true;
      document.getElementById('authScreen').style.display = 'none';
      initApp();
    } else if (event === 'SIGNED_OUT') {
      window.location.reload();
    }
  });

  // Check for an existing session immediately
  const { data: { session } } = await db.auth.getSession();
  if (session && !appInitialized) {
    appInitialized = true;
    initApp();
  } else if (!session) {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('authScreen').style.display = 'flex';
  }
});


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

// Find most recent past workout that shares exercises with the given list
function getPreviousWorkout(exercises) {
  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const today = getToday();
  const nameSet = new Set(exercises.map(e => e.name.toLowerCase()));
  const sorted = Object.keys(workouts).filter(d => d !== today).sort().reverse();
  for (const date of sorted) {
    if (workouts[date].some(ex => nameSet.has(ex.name.toLowerCase()))) {
      return { date, exercises: workouts[date] };
    }
  }
  return null;
}

// Look up previous sets for a single exercise name across all history
function getPrevSetsForExercise(name) {
  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const today = getToday();
  const sorted = Object.keys(workouts).filter(d => d !== today).sort().reverse();
  for (const date of sorted) {
    const found = workouts[date].find(e => e.name.toLowerCase() === name.toLowerCase());
    if (found) return found.sets;
  }
  return null;
}

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

function toggleExerciseCollapse(exEl) {
  const container = exEl.closest('#workout');
  if (exEl.classList.contains('ex-collapsed')) {
    // Expanding: if 2 are already open, close the first open one
    const openEls = [...container.querySelectorAll('.exercise:not(.ex-collapsed)')];
    if (openEls.length >= 2) openEls[0].classList.add('ex-collapsed');
    exEl.classList.remove('ex-collapsed');
  } else {
    exEl.classList.add('ex-collapsed');
  }
}



// Save in-progress workout form to localStorage so it survives accidental navigation
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

// Return today's draft if one exists, otherwise null
function getWorkoutDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('workoutDraft') || 'null');
    if (draft && draft.date === getToday()) return draft;
  } catch {}
  return null;
}

async function logWorkout() {
  const date = editingWorkoutDate || getToday();
  editingWorkoutDate = null;

  const exercises = document.querySelectorAll('.exercise');
  const workoutData = [];

  exercises.forEach(ex => {
    const name = ex.querySelector('p').textContent;
    const sets = [];
    ex.querySelectorAll('.set').forEach(setDiv => {
      const inputs   = setDiv.querySelectorAll('input');
      const setEntry = Array.from(inputs).map(input => parseFloat(input.value) || 0);
      sets.push(setEntry);
    });
    workoutData.push({ name, sets });
  });

  const durationMinutes = workoutTimerStart
    ? Math.round((Date.now() - workoutTimerStart) / 60000) + 15
    : 15;
  workoutTimerStart = null;

  await db.from('workout_logs').upsert(
    { user_id: currentUser.id, date, exercises: workoutData, duration_minutes: durationMinutes },
    { onConflict: 'user_id,date' }
  );

  // Keep localStorage cache in sync for chart functions
  const allWorkouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  allWorkouts[date] = workoutData;
  localStorage.setItem('workouts', JSON.stringify(allWorkouts));
  localStorage.setItem('workoutLoggedDate', date);
  localStorage.removeItem('workoutDraft');

  // Keep workoutLogs in memory in sync
  const logIdx = workoutLogs.findIndex(r => r.date === date);
  const newRow = { user_id: currentUser.id, date, exercises: workoutData, duration_minutes: durationMinutes };
  if (logIdx >= 0) workoutLogs[logIdx] = newRow;
  else workoutLogs.push(newRow);
  renderWorkoutHistory();

  const chip = document.getElementById('workoutChip');
  if (!chip.classList.contains('completed')) toggleTask(chip);

  showWorkoutComplete();
  populateExerciseSelect();
  updateUI();
}

function checkWorkoutLogState() {
  const day = getDay();
  const today = getToday();
  const yesterday = getYesterday();
  const loggedDate = localStorage.getItem('workoutLoggedDate');

  if (day === 'Mon' || day === 'Wed' || day === 'Fri') {
    if (loggedDate === today) {
      showWorkoutComplete();
    }
  } else if (day === 'Tue' || day === 'Thu' || day === 'Sat') {
    if (loggedDate === today || loggedDate === yesterday) {
      showWorkoutComplete();
    } else {
      document.getElementById('workoutCard').style.display = 'none';
    }
  } else {
    document.getElementById('workoutCard').style.display = 'none';
  }
}

// Show workout as logged with an Edit button
function showWorkoutComplete() {
  document.getElementById('workoutCard').style.display = '';
  document.getElementById('page-workout').classList.add('workout-logged');
  document.getElementById('workout').innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; padding: 4px 0;">
      <span style="color: var(--s600); font-weight:600;">&#10003; Workout logged</span>
      <button class="btn-primary" onclick="editWorkout()">Edit</button>
    </div>
  `;
}

// Re-open the most recently logged workout pre-filled for editing
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

// Set up drag-to-reorder on .exercise elements within container
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
  container.addEventListener('touchstart', e => {
    const handle = e.target.closest('.btn-drag-ex');
    if (!handle) return;
    dragEl = handle.closest('.exercise');
    if (!dragEl) return;
    dragEl.classList.add('dragging');
    e.preventDefault(); // block scroll while dragging
  }, { passive: false });

  container.addEventListener('touchmove', e => {
    if (!dragEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    // Temporarily hide dragged element so elementFromPoint finds what's beneath it
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

// Render the workout entry form, optionally pre-filled with savedData
function renderWorkoutForm(exercises, savedData) {
  document.getElementById('page-workout').classList.remove('workout-logged');
  const container = document.getElementById('workout');
  container.innerHTML = '';
  container.removeEventListener('input', saveWorkoutDraft);
  container.addEventListener('input', saveWorkoutDraft);
  setupExerciseDragDrop(container);
  workoutTimerStart = null;
  container.addEventListener('input', function startTimer(e) {
    if (workoutTimerStart === null && e.target.closest('.exercise')) {
      workoutTimerStart = Date.now();
      container.removeEventListener('input', startTimer);
    }
  });

  const prevWorkout = getPreviousWorkout(exercises);
  exercises.forEach(exercise => {
    const prevSets = prevWorkout?.exercises.find(
      e => e.name.toLowerCase() === exercise.name.toLowerCase()
    )?.sets ?? null;
    container.innerHTML += createExercise(exercise, prevSets);
  });

  // Collapse all exercises beyond the first 2
  container.querySelectorAll('.exercise').forEach((el, idx) => {
    if (idx >= 2) el.classList.add('ex-collapsed');
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
}

// Pre-fill workout inputs from saved exercise data
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

// Auto-fill type/sets when user picks an existing exercise from the datalist
function onExerciseNameInput() {
  const name = document.getElementById('newExName').value.trim();
  const match = getAllExercises().find(e => e.name.toLowerCase() === name.toLowerCase());
  if (!match) return;
  document.getElementById('newExType').value = match.isRun ? 'run' : match.isLift ? 'lift' : 'bodyweight';
  if (match.sets) document.getElementById('newExSets').value = match.sets;
}

// Add a custom exercise to the current workout form
async function addExercise() {
  const nameInput = document.getElementById('newExName');
  const name = nameInput.value.trim();
  const type = document.getElementById('newExType').value;
  const sets = parseInt(document.getElementById('newExSets').value) || 4;

  if (!name) return;

  const exercise = { name, sets, isLift: type === 'lift', isRun: type === 'run' };

  // Persist new custom exercise type to Supabase + local cache
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

// Find the most recent logged workout for the same day-group (Mon/Tue, Wed/Thu, Fri/Sat)
function getLastWeekDayGroupWorkout(day) {
  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const today = getToday();
  // JS Date.getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const dayPairs = {
    'Mon': [1, 2], 'Tue': [1, 2],
    'Wed': [3, 4], 'Thu': [3, 4],
    'Fri': [5, 6], 'Sat': [5, 6]
  };
  const validDays = dayPairs[day];
  if (!validDays) return null;
  const sorted = Object.keys(workouts).filter(d => d !== today).sort().reverse();
  for (const date of sorted) {
    const dow = new Date(date).getDay();
    if (validDays.includes(dow)) return workouts[date];
  }
  return null;
}

// Convert history exercise format [{name, sets: [[...], ...]}] to def format [{name, sets: N, isLift, isRun}]
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

function formatHistoryDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderWorkoutHistory() {
  const container = document.getElementById('workoutHistory');
  if (!container) return;

  const sorted = [...workoutLogs].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!sorted.length) {
    container.innerHTML = '<p class="empty-state">No workouts logged yet.</p>';
    return;
  }

  const allEx = getAllExercises();

  container.innerHTML = sorted.map(row => {
    const dur = row.duration_minutes ? `${row.duration_minutes} min` : '—';
    const dateLabel = formatHistoryDate(row.date);
    const exerciseLines = (row.exercises || []).map(ex => {
      const info = allEx.find(e => e.name.toLowerCase() === ex.name.toLowerCase());
      const summary = formatPrevSets(ex.sets, info?.isLift || false, info?.isRun || false);
      return `<div class="wh-ex"><span class="wh-exname">${ex.name}</span><span class="wh-exsets">${summary}</span></div>`;
    }).join('');

    return `
      <div class="wh-row" onclick="this.classList.toggle('wh-open')">
        <div class="wh-header">
          <span class="wh-date">${dateLabel}</span>
          <span class="wh-dur">${dur}</span>
          <span class="material-icons wh-arrow">expand_more</span>
        </div>
        <div class="wh-detail">${exerciseLines}</div>
      </div>`;
  }).join('');
}

// Render today's scheduled workout into the form
function renderWorkoutForDay() {
  const day = getDay();

  const draft = getWorkoutDraft();
  if (draft) {
    renderWorkoutForm(draft.exerciseDefs, draft.values);
    if (draft.timerStart) workoutTimerStart = draft.timerStart;
    return;
  }

  // Use last week's same day-group workout as defaults if available
  const lastWorkout = getLastWeekDayGroupWorkout(day);
  if (lastWorkout) {
    renderWorkoutForm(exerciseDefsFromHistory(lastWorkout));
    return;
  }

  let exercises;
  if (day === 'Mon' || day === 'Tue') {
    exercises = monWorkout;
  } else if (day === 'Wed' || day === 'Thu') {
    exercises = wedWorkout;
  } else if (day === 'Fri' || day === 'Sat') {
    exercises = friWorkout;
  } else {
    return;
  }
  renderWorkoutForm(exercises);
}

// Returns all known exercises (predefined + custom)
function getAllExercises() {
  const custom = JSON.parse(localStorage.getItem('customExercises') || '[]');
  return [...monWorkout, ...wedWorkout, ...friWorkout, ...custom];
}

// Populate the exercise chart dropdown from all logged + predefined exercises
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

function getYesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1); // go back 1 day
  return date.toLocaleDateString();  // same format as getToday()
}

// Calculate streak of consecutive expected days where loggedDateStrings contains the date.
// Saturdays are always excluded (not expected). workoutMode restricts expected days to Mon/Wed/Fri.
// Today is not penalized if not yet logged (the day may not be over).
function calcStreak(loggedDateStrings, workoutMode = false) {
  const dateSet = new Set(loggedDateStrings);

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

    // Don't penalize for today not being logged yet
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

function updateStreaks() {
  const container = document.getElementById('streaksGrid');
  if (!container) return;

  const workoutDates  = workoutLogs.map(r => r.date);
  const sleepDates    = sleepData.map(e => e.date);
  const weightDates   = weightData.map(e => e.date);
  const signalsDates  = psychData.map(e => e.date);
  const releaseDates  = psychData.filter(e => e.released).map(e => e.date);
  const codesDates    = JSON.parse(localStorage.getItem('codesLog') || '[]');

  const streaks = [
    { label: 'Workout',  count: calcStreak(workoutDates, true), icon: 'fitness_center',       workouts: true },
    { label: 'Sleep',    count: calcStreak(sleepDates),         icon: 'bedtime'           },
    { label: 'Weight',   count: calcStreak(weightDates),        icon: 'monitor_weight'    },
    { label: 'Codes',    count: calcStreak(codesDates),         icon: 'notes'             },
    { label: 'Signals',  count: calcStreak(signalsDates),       icon: 'self_improvement'  },
    { label: 'Release',  count: calcStreak(releaseDates),       icon: 'local_fire_department' },
  ];

  container.innerHTML = streaks.map(s => {
    const unit = s.workouts
      ? (s.count === 1 ? 'workout' : 'workouts')
      : (s.count === 1 ? 'day' : 'days');
    return `
    <div class="streak-item">
      <span class="material-icons streak-icon">${s.icon}</span>
      <div class="streak-count${s.count > 0 ? ' active' : ''}">${s.count}</div>
      <div class="streak-unit">${unit}</div>
      <div class="streak-label">${s.label}</div>
    </div>`;
  }).join('');
}

//Gets location for weather display
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

const API_KEY = "1856f6602a8285d123677bb2359f0e65";

const lat = 40.8075; // example: NYC
const lon = -73.9626;

async function fetchWeather(lat, lon) {
  const res = await fetch(
    `https://api.openweathermap.org/data/3.0/onecall` +
    `?lat=${lat}&lon=${lon}` +
    `&exclude=minutely,hourly,daily,alerts` +
    `&units=imperial` +
    `&appid=${API_KEY}`
  );

  if (!res.ok) throw new Error("Weather fetch failed");
  return res.json();
}

async function loadWeather() {
  //const { lat, lon } = await getLocation();
  const data = await fetchWeather(lat, lon);

  document.getElementById("location").textContent =
    data.timezone;

  document.getElementById("temp").textContent =
    `${Math.round(data.current.temp)}°F`;

  document.getElementById("desc").textContent =
    data.current.weather[0].description;
}

loadWeather();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getQuote() {
  let qNum = randomInt(1, quotes.length);
  document.getElementById("quote").textContent = quotes[qNum - 1].quote;
  document.getElementById("author").textContent = "- " + quotes[qNum - 1].author;

}

const quotes = [
  { id: 1, quote: "After all, the future is built by ruthless pragmatists; not the armchair theorizers who meander the forest of their own words.", author: "Anonymous" },
  { id: 2, quote: "One man with courage is the majority.", author: "Thomas Jefferson" },
  { id: 3, quote: "Better to do something imperfectly than to do nothing flawlessly.", author: "Harriet Braiker" },
  { id: 4, quote: "Striving for excellence motivates you; striving for perfection is demoralizing.", author: "Robert Shuller" },
  { id: 5, quote: "The soul becomes dyed with the colour of its thoughts.", author: "Marcus Aurelius" },
  { id: 6, quote: "What doesn't transmit light creates its own darkness.", author: "Unknown" },
  { id: 7, quote: "Do every act of your life as though it were the very last act of your life.", author: "Marcus Aurelius" },
  { id: 8, quote: "Perfection of character is this: to live each day as if it were your last, without frenzy, without apathy, without pretence.", author: "Marcus Aurelius" },
  { id: 9, quote: "No longer wander at hazard; for neither wilt thou read thy own memoirs, nor the acts of the ancient Romans and Hellenes, and the selections from books which thou wast reserving for thy old age. Hasten then to the end which thou hast before thee, and throwing away idle hopes, come to thy own aid, if thou carest at all for thyself, while it is in thy power.", author: "Marcus Aurelius" },
  { id: 10, quote: "Every moment think steadily as a Roman and a man to do what thou hast in hand with perfect and simple dignity, and feeling of affection, and freedom, and justice; and to give thyself relief from all other thoughts. And thou wilt give thyself relief, if thou doest every act of thy life as if it were the last, laying aside all carelessness and passionate aversion from the commands of reason, and all hypocrisy, and self-love, and discontent with the portion which has been given to thee. Thou seest how few the things are, the which if a man lays hold of, he is able to live a life which flows in quiet, and is like the existence of the gods; for the gods on their part will require nothing more from him who observes these things.", author: "Marcus Aurelius" },
  { id: 11, quote: "Pass then through this little space of time conformably to nature, and end thy journey in content, just as an olive falls off when it is ripe, blessing nature who produced it, and thanking the tree on which it grew.", author: "Marcus Aurelius" },
  { id: 12, quote: "Not that this is a misfortune, but that to bear it nobly is good fortune.", author: "Marcus Aurelius" },
  { id: 13, quote: "We lose ourselves when we compromise the very ideals that we fight to defend. And we honor those ideals by upholding them not when it's easy, but when it is hard.", author: "Barack Obama" },
  { id: 14, quote: "It's not the load that breaks you down – it's the way you carry it.", author: "Lou Holtz" },
  { id: 15, quote: "You'll never get ahead of anyone as long as you try to get even with him.", author: "Lou Holtz" },
  { id: 16, quote: "Thou art an old man; no longer let this be a slave, no longer be pulled by the strings like a puppet to unsocial movements, no longer either be dissatisfied with thy present lot, or shrink from the future.", author: "Marcus Aurelius" },
  { id: 17, quote: "Art is never finished, only abandoned.", author: "Leonardo da Vinci" },
  { id: 18, quote: "Wisdom is the daughter of experience.", author: "Leonardo da Vinci" },
  { id: 19, quote: "Men of lofty genius sometimes accomplish the most when they work least, for their minds are occupied with their ideas and the perfection of their conceptions, to which they afterwards give form.", author: "Leonardo da Vinci" },
  { id: 20, quote: "Do not wish for an easy life. Wish for the strength to endure a difficult one.", author: "Bruce Lee" },
  { id: 21, quote: "If you think you’re boring your audience, go slower not faster.", author: "Gustav Mahler" },
  { id: 22, quote: "Saying no frees you up to saying yes when it matters most.", author: "Adam Grant" },
  { id: 23, quote: "You are what you do, not what you say you'll do.", author: "Carl Jung" },
  { id: 24, quote: "My powers are ordinary. Only my application brings me success.", author: "Isaac Newton" },
  { id: 25, quote: "My life has always been my music, it’s always come first, but the music ain’t worth nothing if you can’t lay it on the public. The main thing is to live for that audience, ’cause what you’re there for is to please the people.", author: "Louis Armstrong" },
  { id: 26, quote: "Learn from the mistakes of others. You can never live long enough to make them all yourself.", author: "Groucho Marx" },
  { id: 27, quote: "In times of change, learners inherit the earth, while the learned find themselves beautifully equipped to deal with a world that no longer exists.", author: "Eric Hoffer" },
  { id: 28, quote: "Beware the barrenness of a busy life.", author: "Socrates" },
  { id: 29, quote: "As you think, so shall you become.", author: "Bruce Lee" },
  { id: 30, quote: "We won't be distracted by comparison if we are captivated with purpose.", author: "Bob Goff" },
  { id: 31, quote: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { id: 32, quote: "You often feel tired, not because you've done too much, but because you've done too little of what sparks a light in you.", author: "Unknown" },
  { id: 33, quote: "But we are entitled only to the moment, and owe nothing to the future except that we follow our convictions.", author: "Lysander au Lune" },
  { id: 34, quote: "If you can imagine it, you can achieve it. If you can dream it, you can become it.", author: "William Arthur Ward" },
  { id: 35, quote: "The fear of death follows from the fear of life. One who lives life fully is prepared to die at any time.", author: "Edward Abbey" },
  { id: 36, quote: "It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.", author: "Seneca" },
  { id: 37, quote: "The universe is full of magical things patiently waiting for our wits to grow sharper.", author: "Eden Phillpotts" },
  { id: 38, quote: "Our dreams can come true if we have the courage to pursue them.", author: "Walt Disney" },
  { id: 39, quote: "Those who have a 'why' to live, can bear with almost any 'how'.", author: "Viktor E. Frankl" },
  { id: 40, quote: "Sometimes it is not enough to do our best; we must do what is required.", author: "Winston Churchill" },
  { id: 41, quote: "The cave you fear to enter holds the treasure that you seek.", author: "Joseph Campbell" },
  { id: 42, quote: "As is a tale, so is life: not how long it is, but how good it is, is what matters.", author: "Seneca" },
  { id: 43, quote: "If a man knows not to which port he sails, no wind is favorable.", author: "Seneca" },
  { id: 44, quote: "It is not that we have so little time but that we lose so much. The life we receive is not short but we make it so; we are not ill provided but use what we have wastefully.", author: "Seneca" },
  { id: 45, quote: "He who is brave is free.", author: "Seneca" },
  { id: 46, quote: "Often a very old man has no other proof of his long life than his age.", author: "Seneca" },
  { id: 47, quote: "Tomorrow becomes never. No matter how small the task, take the first step now.", author: "Tim Ferriss" },
  { id: 48, quote: "If you cannot do great things, do small things in a great way.", author: "Napoleon Hill" },
  { id: 49, quote: "The time is always right to do what is right.", author: "Martin Luther King Jr." },
  { id: 50, quote: "Besides the noble art of getting things done, there is the noble art of leaving things undone. The wisdom of life consists in the elimination of non-essentials.", author: "Lin Yutang" },
  { id: 51, quote: "You can, you should, and if you’re brave enough to start, you will.", author: "Stephen King" },
  { id: 52, quote: "We awaken in others the same attitude of mind we hold toward them.", author: "Elbert Hubbard" },
  { id: 53, quote: "Our greatest weakness lies in giving up. The most certain way to succeed is always to try just one more time.", author: "Thomas Edison" },
  { id: 54, quote: "You can feel sore tomorrow or you can feel sorry tomorrow. You choose.", author: "Unknown" },
  { id: 55, quote: "Nothing diminishes anxiety faster than action.", author: "Walter Anderson" },
  { id: 56, quote: "Pain is temporary, quitting lasts forever.", author: "Lance Armstrong" },
  { id: 57, quote: "What gets measured gets managed.", author: "Peter Drucker" },
  { id: 58, quote: "Too many of us are not living our dreams because we are living our fears.", author: "Les Brown" },
  { id: 59, quote: "In a world where information is abundant and easy to access, the real advantage is knowing where to focus.", author: "James Clear" },
  { id: 60, quote: "The greatest discovery of all time is that a person can change their future by merely changing their attitude.", author: "Oprah Winfrey" },
  { id: 61, quote: "Adventure is worthwhile in itself.", author: "Amelia Earhart" }
];

