const assert = require('node:assert/strict');

const {
  MILESTONE_FAMILIES,
  SESSION_RUNGS,
  countAllMilestones,
  ladderFor,
  tierFor,
  buildUpcomingMilestones,
} = require('../../.test-dist/lib/profileMilestones.js');
const { buildMilestoneLedger, getMilestoneFacts, totalsFromFacts } = require('../../.test-dist/lib/milestoneFacts.js');
const { buildMilestoneLedgerRows, milestoneCardFooter, milestoneCardRows } = require(
  '../../.test-dist/lib/profileMilestoneRows.js',
);
const { getLifetimeTrainingSummary } = require('../../.test-dist/lib/lifetimeSummary.js');
const { setNumberLanguage } = require('../../.test-dist/lib/format.js');

/**
 * The milestone ladder (user 2026-09-03): enough rungs to last, in three
 * tiers, each one advancing to the next the moment it falls, and the fallen
 * ones kept on their own page with the day they fell.
 */

// Three sessions across two consecutive weeks, then a gap, then one more.
// Helsinki is UTC+3 in August/September; noon UTC is mid-afternoon local.
const SESSION_DATES = [
  '2026-08-03T12:00:00.000Z', // Mon, week 1
  '2026-08-05T12:00:00.000Z', // Wed, week 1
  '2026-08-11T12:00:00.000Z', // Tue, week 2
  '2026-08-25T12:00:00.000Z', // Tue, week 4 (week 3 skipped)
];

function setRow(weight, reps, orderIndex) {
  return { orderIndex, weight, reps, kind: 'working', outcome: 'completed', status: 'completed' };
}

function fixtureDatabase() {
  const workoutSessions = SESSION_DATES.map((performedAt, index) => ({
    id: `s${index + 1}`,
    workoutTemplateId: 'tpl',
    workoutNameSnapshot: 'Day',
    performedAt,
    durationMinutes: 45,
    totalVolumeKg: 400,
  }));
  // Two exercises per session, three sets of ten each: 60 reps, 6 sets a session.
  const exerciseLogs = workoutSessions.flatMap((session, index) =>
    ['Squat', index % 2 === 0 ? 'Bench Press' : 'Deadlift'].map((name, order) => ({
      id: `${session.id}-${order}`,
      sessionId: session.id,
      exerciseTemplateId: null,
      exerciseNameSnapshot: name,
      weight: 60,
      repsPerSet: [10, 10, 10],
      sets: [setRow(60, 10, 0), setRow(60, 10, 1), setRow(60, 10, 2)],
      tracked: true,
      orderIndex: order,
    })),
  );
  return {
    workoutTemplates: [],
    exerciseTemplates: [],
    workoutPlans: [],
    exerciseLibrary: [],
    workoutSessions,
    cardioSessions: [
      { id: 'c1', activityType: 'run', startedAt: '2026-08-04T06:00:00.000Z', performedAt: '2026-08-04T06:40:00.000Z', durationSec: 2400, distanceKm: 6.2 },
    ],
    exerciseLogs,
    bodyweightEntries: [
      { id: 'b1', recordedAt: '2026-08-03T06:00:00.000Z', weight: 80 },
      { id: 'b2', recordedAt: '2026-08-10T06:00:00.000Z', weight: 79.5 },
    ],
    measurementEntries: [],
    exerciseNameBook: [],
    preferences: {},
  };
}

const NOW = new Date('2026-08-26T12:00:00.000Z');

function facts() {
  const database = fixtureDatabase();
  const lifetime = getLifetimeTrainingSummary(database, NOW);
  return { database, lifetime, facts: getMilestoneFacts(database, lifetime, ['2026-08-05T12:00:00.000Z', '2026-08-11T12:00:00.000Z']) };
}


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
    name: 'milestoneLedger: the ladder is long, dense at the bottom, and every family has all three tiers',
    run() {
      assert.equal(MILESTONE_FAMILIES.length, 12);
      assert.ok(countAllMilestones('kg') >= 130, `only ${countAllMilestones('kg')} rungs`);
      assert.equal(countAllMilestones('kg'), countAllMilestones('lb'));
      for (const family of MILESTONE_FAMILIES) {
        const { rungs } = ladderFor(family, 'kg');
        // Strictly ascending — a repeated rung would be "reached" twice.
        for (let index = 1; index < rungs.length; index += 1) {
          assert.ok(rungs[index] > rungs[index - 1], `${family} rungs not ascending`);
        }
        const tiers = new Set(rungs.map((target) => tierFor(family, target, 'kg')));
        assert.deepEqual([...tiers].sort(), ['easy', 'hard', 'medium'], `${family} lacks a tier`);
        // Tiers never go backwards up the ladder.
        const order = { easy: 0, medium: 1, hard: 2 };
        const ranks = rungs.map((target) => order[tierFor(family, target, 'kg')]);
        for (let index = 1; index < ranks.length; index += 1) {
          assert.ok(ranks[index] >= ranks[index - 1], `${family} tier goes down`);
        }
      }
      // The first session is a rung of its own — the easiest thing there is.
      assert.equal(SESSION_RUNGS[0], 1);
      assert.equal(tierFor('sessions', 1, 'kg'), 'easy');
      assert.equal(tierFor('sessions', 1000, 'kg'), 'hard');
    },
  },
  {
    name: 'milestoneLedger: the facts read the log once — sessions, reps, sets, lifts, hours, weeks, runs, cardio, weigh-ins',
    run() {
      const { facts: f } = facts();
      assert.equal(f.current.sessions, 4);
      assert.equal(f.current.volume, 1600);
      assert.equal(f.current.reps, 240);
      assert.equal(f.current.sets, 24);
      // Squat, Bench Press, Deadlift — a name seen twice is one lift.
      assert.equal(f.current.exercises, 3);
      assert.equal(f.current.hours, 3);
      assert.equal(f.current.weeks, 3);
      // Weeks 1 and 2 were a run of two; week 4 stands alone, and "now" is the
      // week after it, so the live streak is 1 while the timeline saw 2.
      assert.equal(f.current.streak, 1);
      assert.deepEqual(f.timelines.streak.map((point) => point.total), [1, 2, 1]);
      assert.equal(f.current.records, 2);
      assert.equal(f.current.bodyweight, 2);
      assert.equal(f.current.cardio, 1);
      assert.equal(f.current.distance, 6.2);
      // Timelines are running totals, oldest first.
      assert.deepEqual(f.timelines.reps.map((point) => point.total), [60, 120, 180, 240]);
      assert.equal(f.timelines.sessions[0].at, SESSION_DATES[0]);
      assert.deepEqual(totalsFromFacts(f), { reps: 240, sets: 24, exercises: 3, hours: 3, bodyweight: 2, cardio: 1, distance: 6.2 });
    },
  },
  {
    name: 'milestoneLedger: a reached rung carries the day it fell, and the family advances to its next one',
    run() {
      const { facts: f } = facts();
      const ledger = buildMilestoneLedger(f, 'kg');
      const byKey = new Map(ledger.reached.map((item) => [`${item.family}-${item.target}`, item]));

      // Sessions: 1 fell with the first session, 3 with the third.
      assert.equal(byKey.get('sessions-1').reachedAt, SESSION_DATES[0]);
      assert.equal(byKey.get('sessions-3').reachedAt, SESSION_DATES[2]);
      assert.equal(byKey.has('sessions-5'), false);
      // Volume: 400 a session, so 1 000 kg fell on the third.
      assert.equal(byKey.get('volume-1000').reachedAt, SESSION_DATES[2]);
      // The streak of two happened in week 2 even though it is over now, so
      // the next streak rung is 3 — measured from the run alive today (1).
      // Week rungs are dated by the session that made the week count, not
      // by its Monday.
      assert.equal(byKey.get('streak-2').tier, 'easy');
      assert.equal(byKey.get('streak-2').reachedAt, SESSION_DATES[2]);
      assert.equal(byKey.has('streak-3'), false);
      const streak = ledger.upcoming.find((item) => item.family === 'streak');
      assert.equal(streak.target, 3);
      assert.equal(streak.current, 1);
      assert.equal(streak.remaining, 2);
      // Records: the first lift's record day, then the third rung is not there.
      assert.equal(byKey.get('records-1').reachedAt, '2026-08-05T12:00:00.000Z');
      assert.equal(byKey.has('records-3'), false);
      // The first weigh-in, the first cardio session, 5 km.
      assert.equal(byKey.get('bodyweight-1').reachedAt, '2026-08-03T06:00:00.000Z');
      assert.equal(byKey.get('cardio-1').reachedAt, '2026-08-04T06:40:00.000Z');
      assert.equal(byKey.get('distance-5').reachedAt, '2026-08-04T06:40:00.000Z');
      assert.equal(byKey.get('hours-1').reachedAt, SESSION_DATES[1]);

      // Newest first.
      for (let index = 1; index < ledger.reached.length; index += 1) {
        assert.ok(Date.parse(ledger.reached[index - 1].reachedAt) >= Date.parse(ledger.reached[index].reachedAt));
      }
      assert.equal(ledger.reachedCount, ledger.reached.length);
      assert.equal(ledger.totalCount, countAllMilestones('kg'));

      // Every family with a rung ahead has exactly one upcoming entry, and it
      // is the first rung not reached.
      const upcomingFamilies = ledger.upcoming.map((item) => item.family);
      assert.equal(new Set(upcomingFamilies).size, upcomingFamilies.length);
      assert.equal(ledger.upcoming.find((item) => item.family === 'sessions').target, 5);
      assert.equal(ledger.upcoming.find((item) => item.family === 'volume').target, 2500);
      assert.equal(ledger.upcoming.find((item) => item.family === 'exercises').target, 5);
      // Reached and upcoming never overlap.
      for (const item of ledger.upcoming) {
        assert.equal(byKey.has(`${item.family}-${item.target}`), false);
      }
    },
  },
  {
    name: 'milestoneLedger: pounds re-read the same kilograms, and the same day falls',
    run() {
      const { facts: f } = facts();
      const kg = buildMilestoneLedger(f, 'kg');
      const lb = buildMilestoneLedger(f, 'lb');
      // 1 600 kg ≈ 3 527 lb: past 2 500 lb, short of 5 000.
      const reached = lb.reached.find((item) => item.family === 'volume' && item.target === 2500);
      assert.ok(reached);
      // 2 500 lb ≈ 1 134 kg, which the third session's 1 200 kg crossed.
      assert.equal(reached.reachedAt, SESSION_DATES[2]);
      assert.equal(lb.upcoming.find((item) => item.family === 'volume').target, 5000);
      // Only the volume family changes between units.
      assert.equal(kg.reached.filter((item) => item.family !== 'volume').length, lb.reached.filter((item) => item.family !== 'volume').length);
    },
  },
  {
    name: 'milestoneLedger: the page rows name the day and the tier, in both languages, and the card footer counts',
    run() {
      const { facts: f, lifetime } = facts();
      const ledger = buildMilestoneLedger(f, 'kg');
      setNumberLanguage('en');
      const en = buildMilestoneLedgerRows({ ledger, lifetime, unitPreference: 'kg', language: 'en' });
      assert.match(en.summary, /^\d+ of \d+ reached$/);
      const first = en.reached.find((row) => row.key === 'sessions-1');
      assert.equal(first.title, 'First session');
      assert.match(first.meta, /^Easy · Aug 3, 2026$/);
      assert.equal(first.tier, 'easy');
      assert.equal(en.reached.find((row) => row.key === 'hours-1').title, 'One hour of training');
      assert.equal(en.reached.find((row) => row.key === 'distance-5').title, '5 km covered');
      // Upcoming rows are the card's grammar: a title, a distance, a bar.
      const hours = en.upcoming.find((row) => row.key === 'hours-5');
      assert.equal(hours.remainder, '2 h to go');
      assert.equal(hours.meta, '3 of 5 h');
      const distance = en.upcoming.find((row) => row.key === 'distance-10');
      assert.equal(distance.remainder, '3.8 km to go');
      assert.equal(distance.meta, '6.2 of 10 km');
      assert.ok(en.upcoming.every((row) => row.fillPercent >= 4 && row.fillPercent <= 100));

      // The decimal mark is format.ts's, set by the app language.
      setNumberLanguage('fi');
      let fi;
      try {
        fi = buildMilestoneLedgerRows({ ledger, lifetime, unitPreference: 'kg', language: 'fi' });
      } finally {
        setNumberLanguage('en');
      }
      assert.match(fi.summary, /^\d+ \/ \d+ saavutettu$/);
      assert.equal(fi.reached.find((row) => row.key === 'sessions-1').title, 'Ensimmäinen treeni');
      assert.match(fi.reached.find((row) => row.key === 'sessions-1').meta, /^Helppo · /);
      assert.equal(fi.upcoming.find((row) => row.key === 'distance-10').remainder, '3,8 km jäljellä');

      assert.equal(milestoneCardFooter(0, 'en'), 'See all milestones');
      assert.equal(milestoneCardFooter(1, 'en'), '1 reached · See all');
      assert.equal(milestoneCardFooter(7, 'fi'), '7 saavutettu · Näytä kaikki');

      // Fractions round up to a tenth without float noise: 4.8 of 5 h is 0.2
      // to go, not 0.3.
      const nearly = buildMilestoneLedgerRows({
        ledger: { ...ledger, upcoming: buildUpcomingMilestones({ lifetime, recordCount: 0, unitPreference: 'kg', totals: { hours: 4.8, distance: 9.7 } }) },
        lifetime,
        unitPreference: 'kg',
        language: 'en',
      });
      assert.equal(nearly.upcoming.find((row) => row.key === 'hours-5').remainder, '0.2 h to go');
      assert.equal(nearly.upcoming.find((row) => row.key === 'distance-10').remainder, '0.3 km to go');

      // No projections anywhere in the copy.
      for (const row of [...en.reached, ...en.upcoming, ...fi.reached, ...fi.upcoming]) {
        assert.doesNotMatch(`${row.title} ${row.meta} ${row.remainder ?? ''}`, /will|you'll|gain|saat|tulet/i);
      }
    },
  },
  {
    name: 'milestoneLedger: the Profile card ranks the newer families with the old ones, and says "last week" for one week',
    run() {
      const { facts: f, lifetime } = facts();
      const totals = totalsFromFacts(f);
      const rows = cardRows({ lifetime, recordCount: f.current.records, unitPreference: 'kg', language: 'en', totals });
      assert.equal(rows.length, 3);
      // 4/5 sessions (80 %) and 3/5 lifts (60 %), 3/5 h (60 %), 1 600/2 500 kg (64 %) …
      // sessions is nearest; a family without a figure never makes the cut.
      assert.equal(rows[0].key, 'sessions-5');
      assert.ok(!rows.some((row) => row.key.startsWith('reps-') && totals.reps === 0));

      // The upcoming list has the same head as the card.
      const upcoming = buildUpcomingMilestones({ lifetime, recordCount: f.current.records, unitPreference: 'kg', totals });
      assert.deepEqual(rows.map((row) => row.key), upcoming.slice(0, 3).map((item) => `${item.family}-${item.target}`));

      // "you started 1 weeks ago" was the previous card's grammar for the
      // second week; it now says last week.
      const lastWeek = cardRows({
        lifetime: { ...lifetime, weeksSinceStart: 2 },
        recordCount: 0,
        unitPreference: 'kg',
        language: 'en',
        totals,
      }).find((row) => row.key === 'sessions-5');
      assert.equal(lastWeek.meta, '4 of 5 · you started last week');
      const fiLastWeek = cardRows({
        lifetime: { ...lifetime, weeksSinceStart: 2 },
        recordCount: 0,
        unitPreference: 'kg',
        language: 'fi',
        totals,
      }).find((row) => row.key === 'sessions-5');
      assert.equal(fiLastWeek.meta, '4 / 5 · aloitit viime viikolla');
    },
  },
  {
    name: 'milestoneLedger: before the first session the page shows one sentence, and stored data it cannot read is left out rather than thrown on',
    run() {
      const empty = {
        ...fixtureDatabase(),
        workoutSessions: [],
        exerciseLogs: [],
        cardioSessions: [],
        // One onboarding weigh-in, one entry with no readable date.
        bodyweightEntries: [
          { id: 'b1', recordedAt: '2026-08-01T06:00:00.000Z', weight: 80 },
          { id: 'b2', weight: 79 },
          { id: 'b3', recordedAt: 'not a date', weight: 78 },
        ],
      };
      const lifetime = getLifetimeTrainingSummary(empty, NOW);
      const ledger = buildMilestoneLedger(getMilestoneFacts(empty, lifetime, []), 'kg');
      // The weigh-in is a rung that fell; the unreadable entries are not points.
      assert.deepEqual(ledger.reached.map((item) => `${item.family}-${item.target}`), ['bodyweight-1']);
      const rows = buildMilestoneLedgerRows({ ledger, lifetime, unitPreference: 'kg', language: 'en' });
      assert.equal(rows.reached[0].meta, 'Easy · Aug 1, 2026');
      // ONE weigh-in is what onboarding writes for you, so it does not count
      // as having started — see the seeded-weigh-in case below. The rung it
      // reached is still on the record.
      assert.deepEqual(rows.upcoming.map((row) => row.key), ['first']);

      // Truly nothing logged: the page is the card's one sentence.
      const nothing = { ...fixtureDatabase(), workoutSessions: [], exerciseLogs: [], cardioSessions: [], bodyweightEntries: [] };
      const nothingLifetime = getLifetimeTrainingSummary(nothing, NOW);
      const nothingRows = buildMilestoneLedgerRows({
        ledger: buildMilestoneLedger(getMilestoneFacts(nothing, nothingLifetime, []), 'kg'),
        lifetime: nothingLifetime,
        unitPreference: 'kg',
        language: 'en',
      });
      assert.deepEqual(nothingRows.upcoming.map((row) => row.key), ['first']);
      assert.equal(nothingRows.upcoming[0].meta, 'Log a workout to start the count.');
      assert.deepEqual(nothingRows.reached, []);
    },
  },
  {
    name: 'milestoneLedger: the weigh-in onboarding writes for you does not count as having started',
    run() {
      // AboutYouScreen's weight dial defaults to 75 kg and cannot be skipped,
      // and App seeds an entry from it — so every onboarded user reaches
      // bodyweight-1 without doing anything, which used to hide the empty
      // state from essentially everyone (review 2026-09-03).
      const base = { ...fixtureDatabase(), workoutSessions: [], exerciseLogs: [], cardioSessions: [], bodyweightEntries: [] };
      const rowsFor = (database) => {
        const lifetime = getLifetimeTrainingSummary(database, NOW);
        return buildMilestoneLedgerRows({
          ledger: buildMilestoneLedger(getMilestoneFacts(database, lifetime, []), 'kg'),
          lifetime,
          unitPreference: 'kg',
          language: 'en',
        });
      };

      const seeded = rowsFor({
        ...base,
        bodyweightEntries: [{ id: 'b1', recordedAt: '2026-08-01T06:00:00.000Z', weight: 75 }],
      });
      assert.deepEqual(seeded.upcoming.map((row) => row.key), ['first']);
      // The weigh-in still happened, so the record still names it.
      assert.equal(seeded.reached.some((row) => row.key === 'bodyweight-1'), true);

      // The SECOND weigh-in is the reader's own.
      const twice = rowsFor({
        ...base,
        bodyweightEntries: [
          { id: 'b1', recordedAt: '2026-08-01T06:00:00.000Z', weight: 75 },
          { id: 'b2', recordedAt: '2026-08-08T06:00:00.000Z', weight: 74 },
        ],
      });
      assert.equal(twice.upcoming.some((row) => row.key === 'first'), false);

      // So is anything in another family.
      const withRun = rowsFor({
        ...base,
        bodyweightEntries: [{ id: 'b1', recordedAt: '2026-08-01T06:00:00.000Z', weight: 75 }],
        cardioSessions: [
          {
            id: 'c',
            activityType: 'run',
            startedAt: '2026-08-02T06:00:00.000Z',
            performedAt: '2026-08-02T06:30:00.000Z',
            durationSec: 1800,
            distanceKm: 6,
          },
        ],
      });
      assert.equal(withRun.upcoming.some((row) => row.key === 'first'), false);
    },
  },
  {
    name: 'milestoneLedger: a reader who has never done a strength session is not told they started one',
    run() {
      // weeksSinceStart and bestWeekStreak are strength-only and read 0 for a
      // cardio- or weigh-in-only reader, which used to print "0 of 1 · you
      // started this week" and "Best run so far: 0 weeks" (review 2026-09-03).
      const cardioOnly = {
        ...fixtureDatabase(),
        workoutSessions: [],
        exerciseLogs: [],
        bodyweightEntries: [],
        cardioSessions: [
          {
            id: 'c',
            activityType: 'run',
            startedAt: '2026-08-20T06:00:00.000Z',
            performedAt: '2026-08-20T06:40:00.000Z',
            durationSec: 2400,
            distanceKm: 8,
          },
        ],
      };
      const lifetime = getLifetimeTrainingSummary(cardioOnly, NOW);
      assert.equal(lifetime.sessionCount, 0);
      const rows = buildMilestoneLedgerRows({
        ledger: buildMilestoneLedger(getMilestoneFacts(cardioOnly, lifetime, []), 'kg'),
        lifetime,
        unitPreference: 'kg',
        language: 'en',
      });
      assert.equal(rows.upcoming.find((row) => row.key === 'sessions-1').meta, '0 of 1');
      // The run is a week of activity, so the best run is one week (bug hunt, 2026-10-04).
      assert.equal(rows.upcoming.find((row) => row.key === 'streak-2').meta, 'Best run so far: one week');
      // The run they DID log is a rung that fell, and the card says so.
      assert.equal(rows.reached.some((row) => row.key === 'cardio-1'), true);
      const card = milestoneCardRows({
        ledger: buildMilestoneLedger(getMilestoneFacts(cardioOnly, lifetime, []), 'kg'),
        lifetime,
        unitPreference: 'kg',
        language: 'en',
      });
      assert.equal(card.length, 3);
      assert.equal(card.some((row) => row.key === 'first'), false);
    },
  },
  {
    name: 'milestoneLedger: a bar never reads full while the row still counts something down',
    run() {
      // 999.6 of 1 000 kg rounded to a 100 % bar beside "1 kg to go", and the
      // meta rounded the current figure onto the target (review 2026-09-03).
      const lifetime = {
        sessionCount: 5,
        totalVolumeKg: 999.6,
        weeksActive: 2,
        weeksSinceStart: 3,
        bestWeekStreak: 1,
        currentWeekStreak: 1,
        firstSessionAt: '2026-08-01T00:00:00.000Z',
      };
      const row = cardRows({ lifetime, recordCount: 0, unitPreference: 'kg', language: 'en' }).find(
        (item) => item.key === 'volume-1000',
      );
      assert.equal(row.fillPercent, 99, 'the bar claimed the rung was reached');
      assert.equal(row.remainder, '1 kg to go');
      assert.equal(row.meta, '999 kg of 1 000 kg');

      // Same class, integers: 199 of 200 sessions.
      const sessions = cardRows({
        lifetime: { ...lifetime, sessionCount: 199, totalVolumeKg: 0 },
        recordCount: 0,
        unitPreference: 'kg',
        language: 'en',
      }).find((item) => item.key === 'sessions-200');
      assert.equal(sessions.fillPercent, 99);

      // "Best run so far: 1 weeks" — every reader in their first active week.
      const firstWeek = cardRows({
        lifetime: { ...lifetime, bestWeekStreak: 1, currentWeekStreak: 1 },
        recordCount: 0,
        unitPreference: 'kg',
        language: 'en',
      }).find((item) => item.family === 'streak' || item.key.startsWith('streak'));
      if (firstWeek) {
        assert.equal(firstWeek.meta, 'Best run so far: one week');
      }
      const { t } = require('../../.test-dist/lib/i18n.js');
      assert.equal(t('en', 'profile.milestone.streak.metaOne'), 'Best run so far: one week');
      assert.equal(t('fi', 'profile.milestone.streak.metaOne'), 'Paras putki tähän asti: yksi viikko');
    },
  },
];
