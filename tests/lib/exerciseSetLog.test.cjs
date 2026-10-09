const assert = require('node:assert/strict');

const {
  SET_LOG_SESSIONS,
  buildExerciseSetLog,
  formatSetLogSet,
} = require('../../.test-dist/lib/exerciseSetLog.js');
const { isSetLogLocked } = require('../../.test-dist/lib/historyWindow.js');
const { PRO_LIVE_BENEFITS } = require('../../.test-dist/lib/proBenefits.js');

function at(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

const NOW = new Date(2026, 7, 6, 12, 0, 0, 0);

const BENCH = {
  key: 'bench',
  name: 'Penkkipunnerrus',
  bodyPart: 'chest',
  entries: [
    { performedAt: at(2026, 7, 8), sets: [{ weight: 70, reps: 8 }, { weight: 70, reps: 6 }] },
    { performedAt: at(2026, 7, 15), sets: [{ weight: 70, reps: 10 }, { weight: 70, reps: 8 }] },
    { performedAt: at(2026, 7, 29), sets: [{ weight: 82.5, reps: 3 }, { weight: 77.5, reps: 5 }] },
    { performedAt: at(2026, 8, 4), sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }] },
  ],
};

module.exports = [
  {
    name: 'the log reads newest first and totals each session',
    run() {
      const log = buildExerciseSetLog(BENCH, { now: NOW });
      assert.deepEqual(
        log.sessions.map((session) => session.performedAt.slice(0, 10)),
        ['2026-08-04', '2026-07-29', '2026-07-15', '2026-07-08'],
      );
      assert.equal(log.sessions[0].volumeKg, 800, '80x5 twice');
      assert.equal(log.totalSessions, 4);
    },
  },
  {
    name: 'the record set is marked once, on the session that set it',
    run() {
      const log = buildExerciseSetLog(BENCH, { now: NOW });
      const marked = log.sessions.flatMap((session) =>
        session.sets.filter((set) => set.isRecord).map(() => session.performedAt.slice(0, 10)),
      );
      // 82.5 on 29 July is the heaviest set. Nothing else carries the badge —
      // a lift that matches its best repeatedly must not look like it beat it.
      assert.deepEqual(marked, ['2026-07-29']);
      assert.equal(log.bestWeight.value, 82.5);
      assert.equal(log.bestReps.value, 10, 'most reps in a set');
      assert.equal(log.bestVolume.value, 1260, 'the 15 July session did the most work');
    },
  },
  {
    name: 'the sheet shows five sessions but says how many there are',
    run() {
      const many = {
        key: 'squat',
        name: 'Takakyykky',
        entries: Array.from({ length: 9 }, (unused, index) => ({
          performedAt: at(2026, 6, index + 1),
          sets: [{ weight: 100 + index, reps: 5 }],
        })),
      };
      const log = buildExerciseSetLog(many, { now: NOW });
      assert.equal(log.sessions.length, SET_LOG_SESSIONS);
      assert.equal(log.totalSessions, 9, 'so the header cannot claim there are only five');
      // The curve covers everything, not just the listed sessions: it is the
      // free half of the feature and narrowing it would be a second paywall.
      assert.equal(log.curve.length, 9);
      assert.deepEqual(log.curve.slice(0, 2), [100, 101], 'oldest first');
    },
  },
  {
    name: 'a bodyweight lift draws its curve from reps',
    run() {
      const pullups = {
        key: 'pullup',
        name: 'Leuanveto',
        entries: [
          { performedAt: at(2026, 7, 1), sets: [{ weight: 0, reps: 8 }] },
          { performedAt: at(2026, 8, 1), sets: [{ weight: 0, reps: 12 }] },
        ],
      };
      const log = buildExerciseSetLog(pullups, { now: NOW });
      assert.deepEqual(log.curve, [8, 12], 'kilos would draw a flat line at zero');
      assert.equal(log.bestWeight, null);
    },
  },
  {
    name: 'a lift never logged is an empty log, not a missing one',
    run() {
      const log = buildExerciseSetLog({ key: 'x', name: 'X', entries: [] }, { now: NOW });
      assert.deepEqual(log.sessions, []);
      assert.equal(log.totalSessions, 0);
      assert.deepEqual(log.curve, []);
      assert.equal(log.bestWeight, null);
    },
  },
  {
    name: 'the set log is Pro, and the Pro page names the gate that enforces it',
    run() {
      assert.equal(isSetLogLocked(false), true);
      assert.equal(isSetLogLocked(true), false);

      const claim = PRO_LIVE_BENEFITS.find(
        (benefit) => benefit.titleKey === 'pro.v2.read.setlog.t',
      );
      assert.ok(claim, 'sold on the Pro page');
      assert.equal(claim.gate, 'isSetLogLocked');
    },
  },
  {
    name: 'the PR chip follows the record to the better set on the same weight, once',
    run() {
      const sumo = {
        key: 'sumo',
        name: 'Sumomaastaveto',
        bodyPart: 'legs',
        entries: [
          { performedAt: at(2026, 9, 4), sets: [{ weight: 55, reps: 8 }, { weight: 60, reps: 6 }, { weight: 60, reps: 5 }] },
          { performedAt: at(2026, 9, 9), sets: [{ weight: 55, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }] },
        ],
      };
      const log = buildExerciseSetLog(sumo, { now: new Date(2026, 8, 20, 12, 0, 0, 0) });
      const marked = log.sessions.flatMap((session) =>
        session.sets.map((set, index) => (set.isRecord ? `${session.performedAt.slice(0, 10)}#${index}` : null)).filter(Boolean),
      );
      // The first 8 × 60 of 9 September, and only it: the two that matched it
      // after it are matches, not records.
      assert.deepEqual(marked, ['2026-09-09#1']);
      assert.equal(log.bestWeight.companion, 8);
      assert.equal(log.bestReps.companion, 60, 'most reps, and at the heavier bar');
    },
  },
  {
    // Hunt 2026-10-09: dips done weighted and then plain dropped to 0 kg in a
    // line that measures kilos, and a plank's 60 s read as "60 × 0".
    name: 'a lift done both loaded and plain draws its weight only where it carried one',
    run() {
      const log = buildExerciseSetLog(
        {
          key: 'dips',
          name: 'Dips',
          entries: [
            { performedAt: at(2026, 7, 20), sets: [{ weight: 10, reps: 8 }] },
            { performedAt: at(2026, 7, 27), sets: [{ weight: 0, reps: 15 }] },
            { performedAt: at(2026, 8, 3), sets: [{ weight: 12.5, reps: 8 }] },
          ],
        },
        { now: NOW },
      );
      assert.deepEqual(log.curve, [10, 12.5], 'no fall to zero on the plain session');
      assert.equal(log.timed, false);
    },
  },
  {
    name: 'a set reads as its count, in seconds for a hold, with the weight only when there was one',
    run() {
      require('../../.test-dist/lib/format.js').setNumberLanguage('en');
      const plank = buildExerciseSetLog(
        { key: 'plank', name: 'Plank', entries: [{ performedAt: at(2026, 8, 1), sets: [{ weight: 0, reps: 60 }] }] },
        { now: NOW },
      );
      assert.equal(plank.timed, true);
      assert.equal(formatSetLogSet(plank.sessions[0].sets[0], plank.timed, 'en'), '60 s');
      assert.equal(formatSetLogSet({ weightKg: 0, reps: 15 }, false, 'en'), '15');
      assert.equal(formatSetLogSet({ weightKg: 82.5, reps: 3 }, false, 'en'), '3 × 82.5');
      assert.equal(formatSetLogSet({ weightKg: 10, reps: 45 }, true, 'en'), '45 s × 10');

      const fs = require('node:fs');
      const path = require('node:path');
      const sheet = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'SetLogSheet.tsx'), 'utf8');
      assert.match(sheet, /\{formatSetLogSet\(set, timed, language\)\}/, 'the chips say it through the one formatter');
      assert.match(sheet, /\{session\.volumeKg > 0 \? \(/, 'and a session that moved no kilos shows no "0 kg"');
    },
  },
];
