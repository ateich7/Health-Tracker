// Regression tests for the "workout shows a stale past session" bug, which has
// recurred several times (lexicographic date sorts, a never-updated localStorage
// plan tag, one-workout-for-all-exercises lookups). Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newestFirst, lastWorkoutForPlan, lastSetsByExercise } = require('../workout-history.js');

const MON_PLAN = [{ name: 'Pushups' }, { name: 'Situps' }, { name: 'Wall Angels' }];

const row = (date, exercises, plan_key = null) => ({ date, exercises, plan_key });
const ex = (name, ...sets) => ({ name, sets });

const logs = [
  row('6/22/2026', [ex('Pushups', [10]), ex('Situps', [20]), ex('Wall Angels', [8])]),          // untagged, old
  row('9/30/2026', [ex('Pushups', [15]), ex('Situps', [25])], 'mon'),
  row('10/27/2026', [ex('Pushups', [18]), ex('Situps', [0]), ex('Wall Angels', [12])], 'mon'), // situps skipped
  row('10/28/2026', [ex('Run', [3.5, 30, 0]), ex('Goblet Squats', [10, 35])], 'wed'),
  row('11/12/2026', [ex('Pushups', [99])], 'mon'),                                               // "today"
];
const TODAY = '11/12/2026';

test('sorts by real date, not string (10/28 is newer than 9/30)', () => {
  const dates = newestFirst(logs, TODAY).map(r => r.date);
  assert.deepEqual(dates, ['10/28/2026', '10/27/2026', '9/30/2026', '6/22/2026']);
});

test('plan template is the most recent session of that plan', () => {
  assert.equal(lastWorkoutForPlan(logs, 'mon', MON_PLAN, TODAY).date, '10/27/2026');
  assert.equal(lastWorkoutForPlan(logs, 'wed', [{ name: 'Run' }], TODAY).date, '10/28/2026');
});

test('untagged legacy rows still match a plan by exercise overlap', () => {
  const legacyOnly = [logs[0]];
  assert.equal(lastWorkoutForPlan(legacyOnly, 'mon', MON_PLAN, TODAY).date, '6/22/2026');
  assert.equal(lastWorkoutForPlan(legacyOnly, 'fri', [{ name: 'Chest Press' }], TODAY), null);
});

test("today's session is never its own 'last'", () => {
  assert.notEqual(lastWorkoutForPlan(logs, 'mon', MON_PLAN, TODAY).date, TODAY);
  assert.deepEqual(lastSetsByExercise(logs, TODAY).get('pushups'), [[18]]);
});

test('last sets are looked up per exercise, newest performed session each', () => {
  const last = lastSetsByExercise(logs, TODAY);
  assert.deepEqual(last.get('wall angels'), [[12]]);   // 10/27
  assert.deepEqual(last.get('situps'), [[25]]);        // 10/27 was skipped (zeros) → 9/30
  assert.deepEqual(last.get('run'), [[3.5, 30, 0]]);   // from a different plan's session
  assert.equal(last.get('chest press'), undefined);
});

test('a newly logged session immediately becomes "last"', () => {
  const next = [...logs, row('11/14/2026', [ex('Pushups', [20])], 'mon')];
  assert.deepEqual(lastSetsByExercise(next, '11/16/2026').get('pushups'), [[20]]);
  assert.equal(lastWorkoutForPlan(next, 'mon', MON_PLAN, '11/16/2026').date, '11/14/2026');
});
