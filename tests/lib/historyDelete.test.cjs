const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { workoutSessionRepository } = require('../../.test-dist/storage/repositories.js');

const historySource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'HistoryScreen.tsx'),
  'utf8',
);
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');
const read = (...segments) => fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');

function database() {
  return {
    workoutSessions: [
      { id: 's1', workoutTemplateId: 't1', workoutNameSnapshot: 'Lower', performedAt: '2026-08-21T10:00:00.000Z' },
      { id: 's2', workoutTemplateId: 't1', workoutNameSnapshot: 'Upper', performedAt: '2026-08-20T10:00:00.000Z' },
    ],
    exerciseLogs: [
      { id: 'l1', sessionId: 's1', exerciseNameSnapshot: 'Squat', tracked: true },
      { id: 'l2', sessionId: 's1', exerciseNameSnapshot: 'Leg curl', tracked: true },
      { id: 'l3', sessionId: 's2', exerciseNameSnapshot: 'Bench', tracked: true },
    ],
  };
}

/** A free workout, saved the way finishLoggedWorkoutSave saves one. */
function withFreeWorkouts() {
  return {
    ...database(),
    workoutTemplates: [
      { id: 'free1', name: 'Vapaa treeni', origin: 'freestyle', sessions: [], exerciseIds: ['fe1'] },
      { id: 't1', name: 'Mine', origin: 'authored', sessions: [], exerciseIds: [] },
    ],
    exerciseTemplates: [
      { id: 'fe1', workoutTemplateId: 'free1', name: 'Push-up' },
      { id: 'e1', workoutTemplateId: 't1', name: 'Squat' },
    ],
    workoutPlans: [],
    workoutSessions: [
      ...database().workoutSessions,
      { id: 'f1', workoutTemplateId: 'free1', workoutNameSnapshot: 'Vapaa treeni', performedAt: '2026-08-22T10:00:00.000Z' },
    ],
  };
}

module.exports = [
  {
    // Break round, 2026-09-28: the programme a free workout is saved against
    // is shown nowhere and deletable by no one, and it stayed behind for good.
    name: 'history delete: a free workout takes its holding programme with it, and a programme of your own stays',
    run() {
      const afterFree = workoutSessionRepository.remove(withFreeWorkouts(), 'f1');
      assert.deepEqual(afterFree.workoutTemplates.map((template) => template.id), ['t1']);
      assert.deepEqual(afterFree.exerciseTemplates.map((exercise) => exercise.id), ['e1']);

      // Deleting a workout of an authored programme never deletes the programme.
      const afterOwn = workoutSessionRepository.remove(
        workoutSessionRepository.remove(withFreeWorkouts(), 's1'),
        's2',
      );
      assert.deepEqual(afterOwn.workoutTemplates.map((template) => template.id), ['free1', 't1']);

      // A holder another workout still hangs on stays.
      const shared = withFreeWorkouts();
      shared.workoutSessions.push({ id: 'f2', workoutTemplateId: 'free1', workoutNameSnapshot: 'Vapaa treeni', performedAt: '2026-08-23T10:00:00.000Z' });
      assert.deepEqual(
        workoutSessionRepository.remove(shared, 'f1').workoutTemplates.map((template) => template.id),
        ['free1', 't1'],
      );
    },
  },
  {
    name: 'history delete: the sets go with the workout',
    run() {
      // Records, trends and the coach's read are all computed from the logs.
      // Left behind, they would have the app claim a personal best from a
      // workout the reader had just deleted.
      const next = workoutSessionRepository.remove(database(), 's1');

      assert.deepEqual(next.workoutSessions.map((session) => session.id), ['s2']);
      assert.deepEqual(next.exerciseLogs.map((log) => log.id), ['l3']);
    },
  },
  {
    name: 'history delete: deleting nothing changes nothing',
    run() {
      const before = database();
      const next = workoutSessionRepository.remove(before, 'gone');

      assert.equal(next.workoutSessions.length, 2);
      assert.equal(next.exerciseLogs.length, 3);
      // And the input is not mutated on the way through.
      assert.equal(before.workoutSessions.length, 2);
      assert.equal(before.exerciseLogs.length, 3);
    },
  },
  {
    name: 'history delete: the reader is told what it costs before it happens',
    run() {
      assert.match(historySource, /<ConfirmDialog[\s\S]{0,300}visible=\{pendingDelete !== null\}/);
      assert.match(historySource, /destructive/);
      // The message names the consequence rather than only asking twice.
      assert.match(i18nSource, /'history\.delete\.body': 'Treeni ja sen sarjat poistuvat\./);
      assert.match(i18nSource, /Ennätykset ja käyrät lasketaan uudelleen ilman sitä/);
      // Absent handler means no button at all, not an inert one — and it is
      // absent unless Edit is on. A bin on every resting row of the one list a
      // session can be lost from is a delete waiting to happen (Progress v2,
      // piece 05).
      assert.match(
        historySource,
        /editing && onDeleteSession \? requestDelete : undefined/,
      );
      assert.match(historySource, /const \[editing, setEditing\] = useState\(false\);/,
        'History opens with its bins showing');
    },
  },
  {
    name: 'history chip: it speaks only when a lift is out of the trend',
    run() {
      // A chip that is on for nearly every row says nothing — and being on for
      // every row is exactly what made a reader ask what it meant.
      assert.doesNotMatch(historySource, /'history\.badge\.tracked'/);
      assert.match(historySource, /!log\.tracked && !log\.skipped \?/);
      for (const [language, expected] of [['en', 'Not tracked'], ['fi', 'Ei seurannassa']]) {
        assert.ok(
          i18nSource.includes(`'history.badge.untracked': '${expected}'`),
          `history.badge.untracked missing for ${language}`,
        );
      }
    },
  },
  {
    /**
     * Progress v2 · 04+05 — History groups by month, and the bins live behind
     * Edit.
     *
     * "The important one... the red x on every resting row was a delete
     * waiting to happen... sessions group by month... Press Edit and the
     * chevrons become red bins. Same mechanic as the plan's Workouts list, so
     * deleting a session is learned once."
     */
    name: 'history: months group the list, and Edit is what reveals a bin',
    run() {
      // One grouping rule for the whole app, not a second copy beside the one
      // Records already had — two would disagree about which month a midnight
      // session belongs to.
      const groups = read('src', 'lib', 'monthGroups.ts');
      assert.match(groups, /export function groupByMonth<T>/);
      assert.match(historySource, /groupByMonth\(filteredSessions, \(session\) => session\.performedAt\)/);
      assert.match(
        read('src', 'lib', 'personalRecords.ts'),
        /return groupByMonth\(records, \(record\) => record\.performedAt\)/,
        'Records grew its own month grouping back',
      );

      // Local months, not UTC: a session logged at half past midnight belongs
      // to the month the reader was in.
      assert.match(groups, /date\.getMonth\(\)/);
      assert.doesNotMatch(groups, /getUTCMonth/);

      // The header carries Edit once, on the newest month, and the rest carry
      // their count. Two Edit links for one mode would be two modes.
      assert.match(historySource, /groupIndex === 0 && onDeleteSession \? \(/);
      assert.match(historySource, /editing \? 'plan\.done' : 'plan\.edit'/);

      // And the cost is stated where the bins are, not only in the dialog.
      assert.match(historySource, /editing \? \(\s*<Text style=\{styles\.editNote\}/);
      assert.match(i18nSource, /'history\.editNote':/);
    },
  },
];
