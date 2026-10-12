const assert = require('node:assert/strict');

const {
  buildUpcomingMilestones,
  MAX_PROFILE_MILESTONES,
  VOLUME_RUNGS_LB,
} = require('../../.test-dist/lib/profileMilestones.js');
const { formatMilestoneVolume, milestoneCardRows } = require('../../.test-dist/lib/profileMilestoneRows.js');
const { setNumberLanguage } = require('../../.test-dist/lib/format.js');

const lifetime = (overrides = {}) => ({
  sessionCount: 4,
  totalVolumeKg: 994,
  weeksActive: 2,
  weeksSinceStart: 3,
  bestWeekStreak: 2,
  currentWeekStreak: 1,
  firstSessionAt: '2026-08-15T10:00:00.000Z',
  ...overrides,
});


/**
 * The Profile card's rows, built the way the app builds them: from the
 * ledger. There is no second path any more, so the test takes the same one.
 */
function cardRows({ lifetime, recordCount = 0, unitPreference = 'kg', language = 'en', totals }) {
  const upcoming = buildUpcomingMilestones({ lifetime, recordCount, unitPreference, totals });
  return milestoneCardRows({
    ledger: { reached: [], upcoming, reachedCount: 0, totalCount: 0 },
    lifetime,
    unitPreference,
    language,
  });
}

module.exports = [
  {
    name: 'profileMilestones: a rung is the first one not reached, and a hit rung advances',
    run() {
      const at994 = buildUpcomingMilestones({ lifetime: lifetime({ totalVolumeKg: 994 }), recordCount: 0, unitPreference: 'kg' });
      const volume = at994.find((item) => item.family === 'volume');
      assert.equal(volume.target, 1000);
      assert.equal(volume.remaining, 6);
      assert.equal(volume.current, 994);

      // Exactly on the rung: it is reached, so the next one is the target and
      // "0 to go" never appears.
      // (At 1 000 kg the volume family is 40 % along and no longer in the card's
      // top three, so the whole front row is read.)
      const at1000 = buildUpcomingMilestones({ lifetime: lifetime({ totalVolumeKg: 1000 }), recordCount: 0, unitPreference: 'kg' });
      assert.equal(at1000.find((item) => item.family === 'volume').target, 2500);
      assert.ok(at1000.every((item) => item.remaining >= 1));

      // Fractions round up: 999.2 kg is 1 kg to go, not 0.8.
      const frac = buildUpcomingMilestones({ lifetime: lifetime({ totalVolumeKg: 999.2 }), recordCount: 0, unitPreference: 'kg' });
      assert.equal(frac.find((item) => item.family === 'volume').remaining, 1);
    },
  },
  {
    name: 'profileMilestones: at most three rows, nearest first',
    run() {
      // 994/1000 kg (99 %), 4/5 sessions (80 %), 1/2 weeks (50 %), 8/10 PRs (80 %).
      const rows = buildUpcomingMilestones({
        lifetime: lifetime({ totalVolumeKg: 994, sessionCount: 4, currentWeekStreak: 1 }),
        recordCount: 8,
        unitPreference: 'kg',
      }).slice(0, MAX_PROFILE_MILESTONES);
      assert.equal(rows.length, MAX_PROFILE_MILESTONES);
      assert.deepEqual(rows.map((item) => item.family), ['volume', 'sessions', 'records']);
      assert.ok(rows[0].progress >= rows[1].progress && rows[1].progress >= rows[2].progress);
      // Records ranks below sessions on a tie by family order, so the streak
      // (50 %) is the one that drops.
      assert.ok(!rows.some((item) => item.family === 'streak'));
    },
  },
  {
    name: 'profileMilestones: imperial rungs are the round pounds, and the figure is converted',
    run() {
      const rows = buildUpcomingMilestones({ lifetime: lifetime({ totalVolumeKg: 1000 }), recordCount: 0, unitPreference: 'lb' });
      const volume = rows.find((item) => item.family === 'volume');
      // 1 000 kg ≈ 2 204.6 lb: below the 2 500 rung, 296 lb to go.
      assert.equal(volume.target, VOLUME_RUNGS_LB[0]);
      assert.equal(volume.remaining, 296);
      // Thousands grouped as everywhere in the app: a comma in English, a
      // no-break space in Finnish (dup sweep 13, D3-7; it was a thin space).
      assert.equal(formatMilestoneVolume(volume.target, 'lb'), '2,500 lb');
      assert.equal(formatMilestoneVolume(1000, 'kg'), '1,000 kg');
      setNumberLanguage('fi');
      try {
        assert.equal(formatMilestoneVolume(1000, 'kg'), '1\u00a0000 kg');
      } finally {
        setNumberLanguage('en');
      }
    },
  },
  {
    name: 'profileMilestones: no sessions yet is one row with an empty bar, never a hidden section',
    run() {
      // Nothing logged at all — weeksActive included, or the weeks family
      // has progress and the card is right to show real rungs.
      const empty = lifetime({
        sessionCount: 0,
        totalVolumeKg: 0,
        weeksActive: 0,
        currentWeekStreak: 0,
        weeksSinceStart: 0,
        bestWeekStreak: 0,
      });
      const rows = cardRows({ lifetime: empty, recordCount: 0, unitPreference: 'kg', language: 'en' });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].title, 'First session logged');
      assert.equal(rows[0].remainder, '');
      assert.equal(rows[0].fillPercent, 0);
      assert.equal(rows[0].meta, 'Log a workout to start the count.');
    },
  },
  {
    name: 'profileMilestones: the rows say distances, in both languages, with a bar that is never invisible',
    run() {
      const en = cardRows({ lifetime: lifetime(), recordCount: 8, unitPreference: 'kg', language: 'en' });
      assert.equal(en[0].title, '1,000 kg lifted');
      assert.equal(en[0].remainder, '6 kg to go');
      assert.equal(en[0].meta, '994 kg of 1,000 kg');
      assert.equal(en[0].fillPercent, 99);
      const sessions = en.find((row) => row.key === 'sessions-5');
      assert.equal(sessions.meta, '4 of 5 · you started 2 weeks ago');
      assert.equal(sessions.remainder, '1 to go');

      // The app sets its number language with its language; so does this.
      setNumberLanguage('fi');
      let fi;
      try {
        fi = cardRows({ lifetime: lifetime(), recordCount: 8, unitPreference: 'kg', language: 'fi' });
      } finally {
        setNumberLanguage('en');
      }
      assert.equal(fi[0].title, '1\u00a0000 kg nostettu');
      assert.equal(fi[0].remainder, '6 kg jäljellä');

      // A tiny fraction still draws a visible sliver.
      const sliver = cardRows({
        lifetime: lifetime({ totalVolumeKg: 10, sessionCount: 1, currentWeekStreak: 1, weeksSinceStart: 1 }),
        recordCount: 0,
        unitPreference: 'kg',
        language: 'en',
      });
      assert.ok(sliver.every((row) => row.fillPercent >= 4 && row.fillPercent <= 100));
      // One session in: the first rung (1) fell with it, and 3 is next.
      assert.equal(sliver.find((row) => row.key === 'sessions-3').meta, '1 of 3 · you started this week');
      // No projections anywhere in the copy.
      for (const row of [...en, ...fi, ...sliver]) {
        assert.doesNotMatch(`${row.title} ${row.meta} ${row.remainder}`, /will|you'll|gain|saat|tulet/i);
      }
    },
  },
];
