const assert = require('node:assert/strict');

const {
  CARDIO_ACTIVITIES,
  getCardioActivity,
  formatCardioDuration,
  parseCardioDistanceKm,
  getCardioAvgPaceSecPerKm,
  formatCardioPace,
  buildCardioStatsLine,
  getWeekCardioMinutes,
  getWeekCardioMinutesWithRun,
  startCardioSession,
  getCardioElapsedMs,
  pauseCardioSession,
  resumeCardioSession,
  normalizeActiveCardioSession,
} = require('../../.test-dist/lib/cardio.js');

module.exports = [
  {
    name: 'cardio catalog has the six v1 activities with equipment labels',
    run() {
      assert.deepEqual(
        CARDIO_ACTIVITIES.map((activity) => activity.id),
        ['run', 'tread-run', 'tread-walk', 'cycle-in', 'cycle-out', 'row'],
      );
      assert.equal(getCardioActivity('tread-walk').name, 'Treadmill walk');
      assert.equal(getCardioActivity('cycle-in').equipmentLabel, 'Exercise bike');
      // Unknown type falls back to the run instead of crashing.
      assert.equal(getCardioActivity('swim').id, 'run');

      // No name begins with the word every one of them shared. "Free" carried
      // no information — all six are free — and it pushed the word that says
      // WHICH activity to the end, where the clip lands: "Vapaa kävely matolla"
      // read as "Vapaa kävely ma…" and the walking disappeared (#bugs
      // 2026-08-26).
      for (const activity of CARDIO_ACTIVITIES) {
        assert.doesNotMatch(activity.name, /^Free\b/, `${activity.id} still leads with "Free"`);
      }
      const fi = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../../src/lib/i18n.ts'),
        'utf8',
      );
      const labels = fi.match(/'cardio\.activity\.[a-z-]+': '[^']*'/g) ?? [];
      assert.equal(labels.length, 12, 'six activities, two languages');
      for (const label of labels) {
        assert.doesNotMatch(label, /: '(?:Free|Vapaa) /, `${label} still leads with the shared word`);
      }
    },
  },
  {
    name: 'duration formats MM:SS under an hour, H:MM:SS past it',
    run() {
      assert.equal(formatCardioDuration(0), '0:00');
      assert.equal(formatCardioDuration(1471), '24:31');
      assert.equal(formatCardioDuration(3600), '1:00:00');
      assert.equal(formatCardioDuration(3727.9), '1:02:07');
      assert.equal(formatCardioDuration(-5), '0:00');
    },
  },
  {
    name: 'distance input parsing accepts decimals and commas, rejects junk',
    run() {
      assert.equal(parseCardioDistanceKm('4.2'), 4.2);
      assert.equal(parseCardioDistanceKm('4,2'), 4.2);
      assert.equal(parseCardioDistanceKm(' 10 '), 10);
      assert.equal(parseCardioDistanceKm(''), null);
      assert.equal(parseCardioDistanceKm('0'), null);
      assert.equal(parseCardioDistanceKm('-3'), null);
      assert.equal(parseCardioDistanceKm('abc'), null);
      assert.equal(parseCardioDistanceKm('1234'), null);
      // Rounded to two decimals.
      assert.equal(parseCardioDistanceKm('4.239'), 4.24);
    },
  },
  {
    name: 'avg pace is derived and formats as M:SS /km',
    run() {
      // 24:31 over 4.2 km ≈ 5:50 /km.
      const pace = getCardioAvgPaceSecPerKm(1471, 4.2);
      assert.equal(formatCardioPace(pace), '5:50 /km');
      assert.equal(getCardioAvgPaceSecPerKm(1471, null), null);
      assert.equal(getCardioAvgPaceSecPerKm(1471, 0), null);
      assert.equal(getCardioAvgPaceSecPerKm(0, 4.2), null);
    },
  },
  {
    name: 'history stats line includes distance and pace only when entered',
    run() {
      assert.equal(buildCardioStatsLine(1471, 4.2), '24:31 · 4.2 km · 5:50 /km');
      assert.equal(buildCardioStatsLine(1471, null), '24:31');
      assert.equal(buildCardioStatsLine(1471), '24:31');
    },
  },
  {
    name: 'weekly cardio minutes count only the current calendar week',
    run() {
      const now = new Date('2026-07-19T18:00:00'); // Sunday
      const monday = new Date('2026-07-13T07:00:00');
      const lastWeek = new Date('2026-07-12T07:00:00'); // previous Sunday
      const sessions = [
        { performedAt: now.toISOString(), durationSec: 1471 },
        { performedAt: monday.toISOString(), durationSec: 1800 },
        { performedAt: lastWeek.toISOString(), durationSec: 3600 },
      ];
      // 1471s + 1800s = 3271s ≈ 55 min; last week's hour excluded.
      assert.equal(getWeekCardioMinutes(sessions, now), 55);
      assert.equal(getWeekCardioMinutes([], now), 0);
    },
  },
  {
    name: 'live session elapsed survives pause/resume via timestamps',
    run() {
      const t0 = new Date('2026-07-19T10:00:00').getTime();
      let session = startCardioSession('run', t0);
      assert.equal(session.activityType, 'run');
      assert.equal(getCardioElapsedMs(session, t0 + 60_000), 60_000);

      // Pause at +90s: accumulated freezes even as clock time passes.
      session = pauseCardioSession(session, t0 + 90_000);
      assert.equal(session.resumedAt, null);
      assert.equal(getCardioElapsedMs(session, t0 + 300_000), 90_000);
      // Pausing again is a no-op.
      assert.equal(pauseCardioSession(session, t0 + 300_000), session);

      // Resume at +5 min, check at +6 min → 90s + 60s.
      session = resumeCardioSession(session, t0 + 300_000);
      assert.equal(getCardioElapsedMs(session, t0 + 360_000), 150_000);
      // Resuming while running is a no-op.
      assert.equal(resumeCardioSession(session, t0 + 360_000), session);
    },
  },
  {
    name: 'normalizeActiveCardioSession rescues valid blobs, rejects junk',
    run() {
      const valid = normalizeActiveCardioSession({
        activityType: 'cycle-in',
        startedAt: '2026-07-19T10:00:00.000Z',
        accumulatedMs: 5000,
        resumedAt: '2026-07-19T10:05:00.000Z',
      });
      assert.equal(valid.activityType, 'cycle-in');
      assert.equal(valid.accumulatedMs, 5000);
      // Unknown activity coerces to run; bad numbers clamp to 0.
      const coerced = normalizeActiveCardioSession({
        activityType: 'swim',
        startedAt: '2026-07-19T10:00:00.000Z',
        accumulatedMs: -50,
        resumedAt: 'garbage',
      });
      assert.equal(coerced.activityType, 'run');
      assert.equal(coerced.accumulatedMs, 0);
      assert.equal(coerced.resumedAt, null);
      assert.equal(normalizeActiveCardioSession(null), null);
      assert.equal(normalizeActiveCardioSession({ startedAt: 'nope' }), null);
      assert.equal(normalizeActiveCardioSession('string'), null);
    },
  },
  {
    name: 'finish card week total counts a run already stored once, not twice',
    run() {
      const t0 = Date.parse('2026-10-07T07:00:00Z');
      const end = new Date(t0 + 1800e3).toISOString();
      const stored = { id: 'c1', activityType: 'run', startedAt: new Date(t0).toISOString(), performedAt: end, durationSec: 1800 };
      const run = { activityType: 'run', startedAt: stored.startedAt, performedAt: end, durationSec: 1800 };
      assert.equal(getWeekCardioMinutesWithRun([stored], run), 30);
      // A different run with the same start (other activity) is another row.
      assert.equal(getWeekCardioMinutesWithRun([{ ...stored, activityType: 'walk' }], run), 60);
      // A new run adds to the week as before.
      const other = { ...stored, id: 'c2', startedAt: new Date(t0 - 7200e3).toISOString(), performedAt: new Date(t0 - 5400e3).toISOString() };
      assert.equal(getWeekCardioMinutesWithRun([other], run), 60);
      // The carried-on run replaces its row with the longer reading.
      assert.equal(getWeekCardioMinutesWithRun([stored], { ...run, durationSec: 2400 }), 40);
    },
  },
];
