const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const dist = (relative) => require(path.join(DIST, relative));

/**
 * The store screenshots' reader (src/screenshots/screenshotSeed.ts).
 *
 * The three data traps the Android shots fell into showed on screen and in no
 * test (memory ref-website-screenshots, 2026-09-13): a plateau, "recovery low"
 * and a "5/4" week. Each is asserted here, against the stored rows the app
 * reads them from, along with what the seed must be for the app to open on it
 * at all: stored, normalized without loss, onboarded, Pro, today's workout
 * under way.
 */
function build(now, options = {}) {
  const { buildScreenshotSeed } = dist('screenshots/screenshotSeed.js');
  return buildScreenshotSeed({ language: options.language ?? 'fi', dark: options.dark ?? true, now });
}

const DAY = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const NOW = new Date(2026, 9, 18, 14, 0, 0);

module.exports = [
  {
    name: 'screenshot seed: six weeks of the ready programme, stored the way a finish stores them',
    run() {
      const { SCREENSHOT_PROGRAM_ID, SCREENSHOT_WEEKS } = dist('screenshots/screenshotSeed.js');
      const { database, workout } = build(NOW);
      assert.equal(database.workoutSessions.length, SCREENSHOT_WEEKS * 4);
      assert.ok(database.workoutSessions.every((row) => row.workoutTemplateId === SCREENSHOT_PROGRAM_ID));
      assert.ok(database.exerciseLogs.length > database.workoutSessions.length * 5);
      // History's list is capped at 20 like the reducer's own.
      assert.equal(workout.history.sessions.length, 20);
      assert.ok(Object.keys(workout.history.slotHistory).length >= 20);
      // Every logged set of every stored session has a load and reps.
      for (const log of database.exerciseLogs) {
        for (const set of log.sets) {
          assert.ok(set.reps > 0, `${log.exerciseNameSnapshot} has a set with no reps`);
        }
      }
      // Nothing sits in the future.
      assert.ok(database.workoutSessions.every((row) => Date.parse(row.performedAt) < NOW.getTime()));
      // A believable length, the rests included: the reducer counts a set's
      // time against the session's last stamp, and a stamp off the seed's
      // clock once turned every session into one minute.
      for (const row of database.workoutSessions) {
        assert.ok(row.durationMinutes >= 25 && row.durationMinutes <= 75, `${row.performedAt}: ${row.durationMinutes} min`);
      }
    },
  },
  {
    name: 'screenshot seed: today is under way — started earlier, sets logged, the next one pending',
    run() {
      const { database, workout } = build(NOW);
      const active = workout.activeSession;
      assert.ok(active, 'no running session');
      assert.equal(active.status, 'active');
      const minutes = (NOW.getTime() - Date.parse(active.startedAt)) / 60000;
      assert.ok(minutes >= 30 && minutes <= 60, `started ${minutes} min ago`);
      const sets = active.exercises.flatMap((exercise) => exercise.sets);
      assert.ok(sets.every((set) => !set.completedAt || Date.parse(set.completedAt) < NOW.getTime()), 'a set logged in the future');
      assert.ok(Date.parse(active.updatedAt) <= NOW.getTime());
      assert.ok(sets.filter((set) => set.status === 'completed').length >= 8);
      const current = active.exercises.find((exercise) => exercise.slotId === active.ui.activeSlotId);
      assert.ok(current, 'no current exercise');
      assert.ok(current.sets.some((set) => set.status === 'completed'), 'the current lift has nothing logged yet');
      assert.ok(current.sets.some((set) => set.status === 'pending'), 'the current lift has nothing left to log');
      // The rotation's next day: the one after the last stored session.
      const last = database.workoutSessions.slice().sort((a, b) => Date.parse(b.performedAt) - Date.parse(a.performedAt))[0];
      assert.notEqual(active.templateName, last.workoutNameSnapshot);
    },
  },
  {
    name: 'screenshot seed: no lift repeats its top set three times running (the plateau card)',
    run() {
      const { database } = build(NOW);
      const byName = new Map();
      const order = database.workoutSessions.slice().sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt));
      for (const session of order) {
        for (const log of database.exerciseLogs.filter((row) => row.sessionId === session.id)) {
          const top = Math.max(...log.sets.map((set) => set.weight ?? 0));
          if (top <= 0) continue; // bodyweight
          const list = byName.get(log.exerciseNameSnapshot) ?? [];
          list.push(top);
          byName.set(log.exerciseNameSnapshot, list);
        }
      }
      assert.ok(byName.size >= 15);
      for (const [name, tops] of byName) {
        for (let i = 1; i < tops.length; i += 1) {
          assert.ok(tops[i] > tops[i - 1], `${name} does not climb: ${tops.join(', ')}`);
        }
      }
    },
  },
  {
    name: 'screenshot seed: four sessions in any seven days, at most three before today in this week',
    run() {
      for (const now of [NOW, new Date(2026, 9, 19, 9, 0), new Date(2026, 9, 25, 20, 0), new Date(2026, 2, 29, 12, 0)]) {
        const { database } = build(now);
        const days = database.workoutSessions.map((row) => DAY(new Date(row.performedAt)));
        for (const day of days) {
          const inWindow = days.filter((other) => other <= day && other > day - 7 * 86400000 + 3600000 * 2).length;
          assert.ok(inWindow <= 4, `${new Date(day).toDateString()}: ${inWindow} in seven days`);
        }
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
        const thisWeek = days.filter((day) => day >= monday).length;
        assert.ok(thisWeek <= 3, `${now.toDateString()}: ${thisWeek} sessions already this week`);
      }
    },
  },
  {
    name: 'screenshot seed: sessions start on the hour they were set for, across a clock change',
    run() {
      // 2026-10-25 is the Helsinki change; 2026-03-29 the spring one.
      for (const now of [new Date(2026, 10, 2, 12, 0), new Date(2026, 3, 6, 12, 0)]) {
        const { database } = build(now);
        for (const row of database.workoutSessions) {
          const hour = new Date(row.startedAt ?? row.performedAt).getHours();
          assert.ok([11, 17, 18].includes(hour), `${row.startedAt} starts at ${hour}`);
        }
      }
    },
  },
  {
    name: 'screenshot seed: onboarded, terms accepted, Pro, the language and theme asked for',
    run() {
      const { resolveProEntitlement } = dist('lib/proEntitlement.js');
      const { legalAcceptanceDue } = dist('lib/legalAcceptance.js');
      const { LEGAL_VERSION } = dist('lib/legalDocuments.js');
      for (const [language, dark] of [['fi', true], ['en', false]]) {
        const { database } = build(NOW, { language, dark });
        const prefs = database.preferences;
        assert.equal(prefs.appLanguage, language);
        assert.equal(prefs.darkThemeEnabled, dark);
        assert.equal(prefs.onboardingCompleted, true);
        assert.equal(prefs.entryFlowCompleted, true);
        assert.equal(legalAcceptanceDue(prefs.legalAcceptance, LEGAL_VERSION), null);
        assert.equal(resolveProEntitlement(prefs, NOW).unlocked, true);
        assert.equal(database.workoutPlans.length, 1);
        assert.deepEqual(prefs.activePlanIds, [database.workoutPlans[0].id]);
        assert.equal(prefs.activePlanId, database.workoutPlans[0].id);
      }
    },
  },
  {
    name: 'screenshot seed: the loaders keep every row of it',
    run() {
      const seed = build(NOW);
      const storage = createFakeAsyncStorage();
      const { database, persistence } = loadAgainstFake(storage, (req) => ({
        database: req('storage/database.js'),
        persistence: req('features/workout/workoutPersistence.js'),
      }));
      const normalized = database.normalizeDatabase(JSON.parse(JSON.stringify(seed.database)));
      assert.equal(normalized.workoutSessions.length, seed.database.workoutSessions.length);
      assert.equal(normalized.exerciseLogs.length, seed.database.exerciseLogs.length);
      assert.equal(normalized.bodyweightEntries.length, 8);
      assert.equal(normalized.measurementEntries.length, 9);
      assert.equal(normalized.workoutPlans.length, 1);
      assert.equal(normalized.preferences.onboardingCompleted, true);
      const bundle = persistence.normalizeWorkoutBundle(JSON.parse(JSON.stringify(seed.workout)));
      assert.ok(bundle.activeSession, 'the running session was dropped');
      assert.equal(bundle.activeSession.status, 'active');
      assert.equal(Object.keys(bundle.history.slotHistory).length, Object.keys(seed.workout.history.slotHistory).length);
    },
  },
];
