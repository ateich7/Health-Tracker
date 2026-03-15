const SUPABASE_URL = 'https://eewgjegdxtaqvdlnagny.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qox_jEnHQF7ZIHenHqlHeg_YmkjlCy5';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function signIn() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const msg      = document.getElementById('authMessage');
  msg.textContent = '';

  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    msg.style.color = 'var(--binactive)';
    msg.textContent = error.message;
  }
}

async function signUp() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const msg      = document.getElementById('authMessage');
  msg.textContent = '';

  if (password.length < 6) {
    msg.style.color = 'var(--binactive)';
    msg.textContent = 'Password must be at least 6 characters.';
    return;
  }

  const { error } = await db.auth.signUp({ email, password });
  if (error) {
    msg.style.color = 'var(--binactive)';
    msg.textContent = error.message;
  } else {
    msg.style.color = 'var(--s600)';
    msg.textContent = 'Account created! Signing you in...';
  }
}

async function signOut() {
  await db.auth.signOut();
}

// One-time migration: pushes all localStorage data up to Supabase
async function migrateLocalData() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  const btn = document.querySelector('.nav-migrate');
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';

  const uploads = [];

  const weightData = JSON.parse(localStorage.getItem('weightData') || '[]');
  if (weightData.length) {
    uploads.push(db.from('weight_logs').upsert(
      weightData.map(e => ({ user_id: user.id, date: e.date, weight: e.weight, timestamp: e.timestamp || Date.now() })),
      { onConflict: 'user_id,date' }
    ));
  }

  const sleepData = JSON.parse(localStorage.getItem('sleepData') || '[]');
  if (sleepData.length) {
    uploads.push(db.from('sleep_logs').upsert(
      sleepData.map(e => ({ user_id: user.id, date: e.date, hours: e.hours, rested: e.rested, timestamp: e.timestamp || Date.now() })),
      { onConflict: 'user_id,date' }
    ));
  }

  const workouts = JSON.parse(localStorage.getItem('workouts') || '{}');
  const workoutEntries = Object.entries(workouts);
  if (workoutEntries.length) {
    uploads.push(db.from('workout_logs').upsert(
      workoutEntries.map(([date, exercises]) => ({ user_id: user.id, date, exercises })),
      { onConflict: 'user_id,date' }
    ));
  }

  const customEx = JSON.parse(localStorage.getItem('customExercises') || '[]');
  if (customEx.length) {
    uploads.push(db.from('custom_exercises').upsert(
      customEx.map(e => ({ user_id: user.id, name: e.name, is_lift: e.isLift, is_run: e.isRun })),
      { onConflict: 'user_id,name' }
    ));
  }

  const results = await Promise.all(uploads);
  const errors  = results.filter(r => r.error).map(r => r.error.message);

  if (errors.length === 0) {
    btn.querySelector('span:last-child').textContent = 'Migrated ✓';
    await loadData();
  } else {
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    alert('Migration errors:\n' + errors.join('\n'));
  }
}
