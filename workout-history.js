// ─────────────────────────────────────────────────────────────────────────────
// WORKOUT HISTORY LOOKUPS
// Pure functions over `workout_logs` rows ({ date: 'M/D/YYYY', exercises, plan_key }).
// No DOM, no localStorage: callers always pass the freshly loaded rows, so there
// is no cache that can go stale. Shared by renderer.js and tests/ (run `npm test`).
// ─────────────────────────────────────────────────────────────────────────────
const WorkoutHistory = (() => {
  // `date` is M/D/YYYY text, which sorts wrong as a string ("9/30" > "10/28"),
  // so always compare the parsed timestamp.
  const dateValue = row => new Date(row.date).getTime();
  const key = name => name.trim().toLowerCase();

  // A saved exercise whose inputs were all left blank is stored as zeros —
  // that's a skipped exercise, not a performance worth showing as "Last".
  const wasPerformed = ex => Array.isArray(ex.sets) && ex.sets.some(set => set.some(v => v > 0));

  // Logged workouts newest → oldest, excluding `excludeDate` (today's session).
  function newestFirst(logs, excludeDate) {
    return logs
      .filter(r => r.date !== excludeDate && Array.isArray(r.exercises) && r.exercises.length)
      .sort((a, b) => dateValue(b) - dateValue(a));
  }

  // Most recent workout done from `planKey`. Rows tagged with plan_key match on
  // the tag; older untagged rows match when they share ≥ half the plan's exercises.
  function lastWorkoutForPlan(logs, planKey, planExercises, excludeDate) {
    const planNames = new Set(planExercises.map(e => key(e.name)));
    const needed = Math.ceil(planNames.size / 2);
    return newestFirst(logs, excludeDate).find(row => row.plan_key
      ? row.plan_key === planKey
      : row.exercises.filter(e => planNames.has(key(e.name))).length >= needed
    ) ?? null;
  }

  // Map of exercise name (lowercased) → sets from the most recent workout in
  // which that exercise was actually performed. Looked up per exercise, so an
  // exercise missing from the latest session still shows its own last result.
  function lastSetsByExercise(logs, excludeDate) {
    const last = new Map();
    for (const row of newestFirst(logs, excludeDate)) {
      for (const ex of row.exercises) {
        if (!last.has(key(ex.name)) && wasPerformed(ex)) last.set(key(ex.name), ex.sets);
      }
    }
    return last;
  }

  return { newestFirst, lastWorkoutForPlan, lastSetsByExercise, exerciseKey: key };
})();

if (typeof module !== 'undefined') module.exports = WorkoutHistory;
