const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildFatigueModel } = require('../../src/lib/fatigueModel');
const { buildRecoverySheet, recoveryWeek } = require('../../src/lib/recoverySheet');

const root = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');

/**
 * Audit 9, 2026-09-26: what the recovery row counts and what its sheet draws.
 */
module.exports = [
  {
    name: 'recovery: the row\'s session count is the sessions the sheet\'s week lights',
    run() {
      // 06:00 on a Saturday. The load's rolling window starts at 06:00 seven
      // days back, so an evening session on that eighth date was counted
      // ("2 sessions") under a strip of seven dates with one lit.
      const now = new Date(2026, 8, 26, 6, 0, 0);
      const session = (id, date) => ({ id, performedAt: date.toISOString(), totalVolumeKg: 5000 });
      const sessions = [
        session('old', new Date(2026, 8, 19, 20, 0, 0)),
        session('mid', new Date(2026, 8, 24, 18, 0, 0)),
      ];
      const fatigue = buildFatigueModel({ workoutSessions: sessions, exerciseLogs: [] }, now);
      const week = recoveryWeek(sessions.map((s) => s.performedAt), now, 'en');
      assert.equal(fatigue.sessionCount7d, week.filter((day) => day.trained).length);
      assert.equal(fatigue.sessionCount7d, 1);

      // Today and the six days before it count, from local midnight.
      const edge = [session('edge', new Date(2026, 8, 20, 0, 30, 0))];
      assert.equal(buildFatigueModel({ workoutSessions: edge, exerciseLogs: [] }, now).sessionCount7d, 1);
      assert.equal(recoveryWeek(edge.map((s) => s.performedAt), now, 'en').filter((day) => day.trained).length, 1);
    },
  },
  {
    name: 'recovery: amber advice does not name a body part the app does not know is next',
    run() {
      const fatigue = {
        confident: true,
        signal: 'elevated',
        acwr: 1.4,
        recoveryScore: 60,
        sessionCount7d: 3,
        acuteLoadKg: 14000,
        chronicLoadKg: 10000,
      };
      for (const language of ['en', 'fi']) {
        const sheet = buildRecoverySheet({
          fatigue,
          language,
          now: new Date(2026, 8, 26, 12, 0, 0),
          sessionDates: [],
          tomorrowTrains: true,
          restTomorrowMarked: false,
          nextSessionTitle: null,
          automatedProgression: true,
          proUnlocked: true,
          lightenQueued: false,
        });
        const text = JSON.stringify(sheet);
        assert.doesNotMatch(text, /legs|jalkoja/i, language);
      }
    },
  },
  {
    name: 'programme page: its week gives an empty day\'s slot to the next day with lifts, as Home does',
    run() {
      const detail = read('src', 'screens', 'ProgramDetailScreen.tsx');
      assert.match(detail, /const session = sessionForSlot\(program\.sessions, sessionSlotOn\(schedule, date\)\);/);
      assert.doesNotMatch(detail, /program\.sessions\[\(\(slot % count\) \+ count\) % count\]/);
    },
  },
];
