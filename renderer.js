let weightData = [];
let weightChart = null;
let exerciseChart = null;

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

// Initialize on load
function init() {
  formatDate();
  loadData();
  document.getElementById('weightInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') logWeight();
  });
}

// Load data on startup
function loadData() {
  const savedWeight = localStorage.getItem('weightData');
  if (savedWeight) weightData = JSON.parse(savedWeight);

  checkChipState('weightChip', 'weightLoggedDate');
  checkChipState('codesChip', 'codesLoggedDate');
  checkChipState('workoutChip', 'workoutLoggedDate');
  checkWorkoutLogState();
  getQuote();
  updateUI();

  setTimeout(() => {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('mainContent').classList.add('loaded');
  }, 100);
}

// Log weight
function logWeight() {
  const input = document.getElementById('weightInput');
  const weight = parseFloat(input.value);

  if (!weight || weight <= 100 || weight >= 250) return;

  const today = getToday();

  // Remove today's entry if exists and add new one
  weightData = weightData.filter(e => e.date !== today);
  weightData.push({
    date: today,
    weight: weight,
    timestamp: Date.now()
  });
  weightData.sort((a, b) => a.timestamp - b.timestamp);

  input.value = '';
  localStorage.setItem('weightLoggedDate', today);
  localStorage.setItem('weightData', JSON.stringify(weightData));

  toggleTask(document.getElementById('weightChip'));
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

// Update all UI elements
function updateUI() {
  updateStats();
  updateWeightChart();
  updateExerciseChart()
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

  const chartData = weightData.slice(-30).map(e => ({
    date: e.date.split('/').slice(0, 2).join('/'),
    weight: e.weight
  }));

  if (chartData.length === 0) return;

  const ctx = document.getElementById('weightChart').getContext('2d');
  weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.map(d => d.date),
      datasets: [{
        label: 'Weight (lbs)',
        data: chartData.map(d => d.weight),
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
        legend: { display: false }
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
  const allExercises = [...monWorkout, ...wedWorkout, ...friWorkout];
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
        const totalTime = exercise.sets.reduce((sum, set) => sum + (set[1] + (set[2]/100) || 0), 0);
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

// Toggle task completion
function toggleTask(chip) {
  const button = chip.querySelector('.chip-btn');
  const check = chip.querySelector('.chip-check');

  chip.classList.toggle('completed');

  if (chip.classList.contains('completed')) {
    button.style.display = 'none';
    check.style.display = 'inline';
  } else {
    button.style.display = 'inline';
    check.style.display = 'none';
  }
}

// Toggle chip on button click
function toggleOnClick(element) {
  toggleTask(element.parentElement);
}

// Toggle codes chip
function toggleCodes(chip) {
  const today = getToday();
  const loggedToday = localStorage.getItem('codesLoggedDate') === today;

  if (!loggedToday) {
    localStorage.setItem('codesLoggedDate', today);
  } else {
    localStorage.setItem('codesLoggedDate', null);
  }
  toggleTask(chip);
}

// Open codes link
function openTaskLink(element) {
  window.open(
    'https://docs.google.com/document/d/16lPD_vvbuhUpa0yR5gFKQDGuDJHWc8wQhCI39g5GDTM/edit',
    '_blank',
    `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`
  );
  toggleCodes(element.parentElement);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);


function createSet(exercise, setIndex) {
  if (exercise.isRun) {
    return `
      <div class="set">
        <input type="number" placeholder="Distance">
        <input type="number" placeholder="Minutes" min="0">
        <input type="number" placeholder="Seconds" min="0" max="59">
      </div>
    `;
  }

  if (exercise.isLift) {
    return `
     <div class="set">
        <input type="number" placeholder="Reps">
        <input type="number" placeholder="Weight">
      </div>
    `;
  }

  return `
    <div class="set">
      <input type="number" step="0.1" placeholder="Reps">
    </div>
  `;
}

function createExercise(exercise) {
  let html = `<div class="exercise input-group">`
  html += `<div id="exNameForm"><p>${exercise.name}</p></div>`;

  for (let i = 0; i < exercise.sets; i++) {
    html += createSet(exercise, i);
  }

  html += `</div>`;
  return html;
}

const container = document.getElementById("workout");

let day = getDay();

if (day === "Mon" || day === "Tue") {
  monWorkout.forEach(exercise => {
    container.innerHTML += createExercise(exercise);
  });
} else if (day === "Wed" || day === "Thu") {
  wedWorkout.forEach(exercise => {
    container.innerHTML += createExercise(exercise)
  });
} else {
  friWorkout.forEach(exercise => {
    container.innerHTML += createExercise(exercise)
  });
}

container.innerHTML += `<button class="btn-primary" onclick="logWorkout()">Log</button>`;


function logWorkout() {
  const today = getToday();
  const exercises = document.querySelectorAll('.exercise');
  const workoutData = [];

  exercises.forEach(ex => {
    const name = ex.querySelector('p').textContent;
    const sets = [];

    ex.querySelectorAll('.set').forEach(setDiv => {
      const inputs = setDiv.querySelectorAll('input');
      const setEntry = Array.from(inputs).map(input => parseFloat(input.value) || 0);
      sets.push(setEntry);
    });

    workoutData.push({
      name,
      sets
    });
  });

  // Save all exercises for today
  const allWorkouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  allWorkouts[today] = workoutData;
  localStorage.setItem('workouts', JSON.stringify(allWorkouts));

  // Clear inputs
  exercises.forEach(ex => ex.querySelectorAll('input').forEach(input => input.value = ''));

  localStorage.setItem('workoutLoggedDate', today);
  toggleTask(document.getElementById('workoutChip'));

  document.getElementById('workoutCard').style.display = 'none';

  updateUI();
}

function checkWorkoutLogState() {
  const day = getDay();
  const today = getToday();
  const yesterday = getYesterday();
  const loggedDate = localStorage.getItem('workoutLoggedDate');
  if(day === 'Mon' || day === 'Wed' || day === 'Fri' ) {
    if (loggedDate === today) {
      document.getElementById('workoutCard').style.display = 'none';
    }
  } else if(day === 'Tue' || day === 'Thu' || day === 'Sat') {
    document.getElementById('workoutChip').style.display = 'none';
    if (loggedDate === today || loggedDate === yesterday ) {
      document.getElementById('workoutCard').style.display = 'none';
    }
  } else {
    document.getElementById('workoutChip').style.display = 'none';
    document.getElementById('workoutCard').style.display = 'none';
  }
}

function getYesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1); // go back 1 day
  return date.toLocaleDateString();  // same format as getToday()
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

console.log("poop");

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
  let qNum = randomInt(1,quotes.length);
  document.getElementById("quote").textContent = quotes[qNum-1].quote;
  document.getElementById("author").textContent = "- " + quotes[qNum-1].author;

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
  { id: 56, quote: "Pain is temporary, quitting lasts forever.", author: "Lance Armstrong" }  
];