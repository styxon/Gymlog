const assert = require('node:assert/strict');

const {
  availableLadderSorts,
  formatWeeklyLoad,
  partitionByReaderWeek,
  sortProgramLadder,
  shouldShowLevelBadge,
} = require('../../src/lib/programLadder');

/**
 * A family of programmes read as a ladder.
 *
 * The changes this covers come from a review of the live sheet (2026-08-31):
 * a group that fits the reader's week, a meta line saying what differs, a
 * level badge only where it adds something, and a sort, because twenty-one
 * rows one step apart are not a list you scan.
 */

const row = (id, days, minutes, weeks, level = 'advanced') => ({ id, days, minutes, weeks, level });

const FAMILY = [
  row('huge_builder', 3, 50, 8, 'beginner'),
  row('huge', 3, 55, 8),
  row('huge_pro', 4, 55, 8),
  row('huge_pro_plus', 5, 55, 12),
  row('huge_advanced', 6, 55, 8),
];

const FAMILY_IDS = ['huge_builder', 'huge', 'huge_pro', 'huge_pro_plus', 'huge_advanced'];

module.exports = [
  {
    name: 'ladder: the meta line multiplies so the reader does not have to',
    run() {
      // "≈", not "=": the per-session number is an estimate, and multiplying
      // an estimate does not make it a measurement.
      assert.equal(formatWeeklyLoad(4, 55, 'en'), '4 × 55 min ≈ 3 h 40 min / wk');
      assert.equal(formatWeeklyLoad(3, 50, 'en'), '3 × 50 min ≈ 2 h 30 min / wk');
      // An exact hour drops the minutes rather than printing "3 h 0 min".
      assert.equal(formatWeeklyLoad(4, 60, 'en'), '4 × 60 min ≈ 4 h / wk');
      // Under an hour reads as minutes: "0 h 45" is arithmetic, not an amount
      // of training.
      assert.equal(formatWeeklyLoad(1, 45, 'en'), '1 × 45 min ≈ 45 min / wk');
      assert.equal(formatWeeklyLoad(3, 50, 'fi'), '3 × 50 min ≈ 2 h 30 min / vk');

      // Through the same helper History, Progress, the celebration screen and
      // the widget use, so a duration reads the same everywhere in the app.
      const { formatDurationMinutes } = require('../../src/lib/format');
      assert.ok(formatWeeklyLoad(4, 55, 'en').includes(formatDurationMinutes(220)));
      assert.ok(formatWeeklyLoad(4, 60, 'en').includes(formatDurationMinutes(240)));
    },
  },
  {
    name: 'ladder: a missing or nonsense number does not print NaN at the reader',
    run() {
      for (const [days, minutes] of [[0, 55], [3, 0], [NaN, 55], [3, NaN], [-2, 55]]) {
        const text = formatWeeklyLoad(days, minutes, 'en');
        assert.doesNotMatch(text, /NaN|Infinity|undefined/, `${days} × ${minutes} → ${text}`);
      }
    },
  },
  {
    /**
     * Every row that fits, not one row called best.
     *
     * The single "recommended" row this replaced could not be justified from
     * the catalog: 17 category × day-count combinations have two or more rows
     * matching the reader's week equally, twelve of them in Beginner at three
     * days. "These fit your week" is true of every row it marks; "this one is
     * recommended" was true of none of them.
     */
    name: 'ladder: the fitting rows are the whole of the reader week, not a pick',
    run() {
      const three = partitionByReaderWeek(FAMILY, 3);
      assert.deepEqual(three.fits.map((entry) => entry.id), ['huge_builder', 'huge']);
      assert.deepEqual(
        three.rest.map((entry) => entry.id),
        ['huge_pro', 'huge_pro_plus', 'huge_advanced'],
      );

      // Nothing fits: an empty group, and the whole list still shown.
      const two = partitionByReaderWeek(FAMILY, 2);
      assert.deepEqual(two.fits, []);
      assert.equal(two.rest.length, FAMILY.length);

      // Nothing known about the reader: no group at all.
      for (const unknown of [null, undefined, 0, NaN]) {
        const none = partitionByReaderWeek(FAMILY, unknown);
        assert.deepEqual(none.fits, [], `${String(unknown)} produced a group`);
        assert.equal(none.rest.length, FAMILY.length);
      }

      // Nothing lost or duplicated across the split, and the input untouched.
      assert.deepEqual(
        [...three.fits, ...three.rest].map((entry) => entry.id).sort(),
        [...FAMILY_IDS].sort(),
      );
      assert.deepEqual(FAMILY.map((entry) => entry.id), FAMILY_IDS);
    },
  },
  {
    /**
     * The reader's level orders the group; it does not filter it. Requiring
     * both an exact week and an exact level leaves 47 of 87 reader situations
     * with nothing to show, so a beginner sees the beginner plan first and the
     * advanced one still on the list.
     */
    name: 'ladder: the reader level sorts the fitting group, never shortens it',
    run() {
      const asBeginner = partitionByReaderWeek(FAMILY, 3, 'beginner');
      assert.deepEqual(asBeginner.fits.map((entry) => entry.id), ['huge_builder', 'huge']);

      // 'huge' is advanced and second in catalog order — asking as an advanced
      // reader lifts it without dropping the beginner row.
      const asAdvanced = partitionByReaderWeek(FAMILY, 3, 'advanced');
      assert.deepEqual(asAdvanced.fits.map((entry) => entry.id), ['huge', 'huge_builder']);
      assert.equal(asAdvanced.fits.length, 2, 'the level filtered the group instead of ordering it');

      // A level no row in the group has changes nothing.
      const unmatched = partitionByReaderWeek(FAMILY, 3, 'intermediate');
      assert.deepEqual(unmatched.fits.map((entry) => entry.id), ['huge_builder', 'huge']);

      // And a level every row shares changes nothing either.
      const allSame = partitionByReaderWeek(
        FAMILY.map((entry) => ({ ...entry, level: 'beginner' })),
        3,
        'beginner',
      );
      assert.deepEqual(allSame.fits.map((entry) => entry.id), ['huge_builder', 'huge']);
    },
  },
  {
    name: 'ladder: the default order is the catalog one, the others are the reader one',
    run() {
      // 'recommended' does not reorder: the fitting group is lifted out by the
      // caller, and the catalog order under it IS the ladder.
      assert.deepEqual(sortProgramLadder(FAMILY, 'recommended').map((entry) => entry.id), FAMILY_IDS);

      assert.deepEqual(sortProgramLadder(FAMILY, 'days').map((entry) => entry.days), [3, 3, 4, 5, 6]);
      assert.deepEqual(sortProgramLadder(FAMILY, 'length').map((entry) => entry.weeks), [8, 8, 8, 8, 12]);

      // Ties break on id, so the same family never shuffles between renders.
      assert.deepEqual(
        sortProgramLadder(FAMILY, 'days').slice(0, 2).map((entry) => entry.id),
        ['huge', 'huge_builder'],
      );

      // The input is never mutated.
      assert.deepEqual(FAMILY.map((entry) => entry.id), FAMILY_IDS);
    },
  },
  {
    /**
     * With "Advanced" selected, an ADVANCED badge on every row is the reader's
     * own choice read back to them eleven times.
     */
    name: 'ladder: the level badge appears only where it adds something',
    run() {
      assert.equal(shouldShowLevelBadge('beginner', null), true, 'no filter: every level is news');
      assert.equal(shouldShowLevelBadge('advanced', null), true);
      assert.equal(shouldShowLevelBadge('advanced', 'advanced'), false, 'the filter already said it');
      assert.equal(shouldShowLevelBadge('beginner', 'advanced'), true, 'this row differs from the ask');
    },
  },
  {
    /**
     * A chip that visibly does nothing when tapped is worse than no chip: the
     * reader taps it, the list does not move, and now they distrust the other
     * two as well.
     */
    name: 'ladder: a sort is only offered when it can reorder what is shown',
    run() {
      assert.deepEqual(availableLadderSorts(FAMILY), ['recommended', 'days', 'length']);

      // Every row the same length — Focus is exactly this, all eleven rows.
      const sameLength = FAMILY.map((entry) => ({ ...entry, weeks: 8 }));
      assert.deepEqual(availableLadderSorts(sameLength), ['recommended', 'days']);

      const sameDays = FAMILY.map((entry) => ({ ...entry, days: 3 }));
      assert.deepEqual(availableLadderSorts(sameDays), ['recommended', 'length']);

      // 'recommended' survives even when it moves nothing: it is the default,
      // and the way back from either of the others.
      assert.deepEqual(availableLadderSorts([FAMILY[0]]), ['recommended']);
      assert.deepEqual(availableLadderSorts([]), ['recommended']);

      // A missing number is not a second value that makes a sort meaningful.
      const broken = [
        { id: 'a', days: 3, minutes: 50, weeks: 8, level: 'beginner' },
        { id: 'b', days: 3, minutes: 50, weeks: 0, level: 'beginner' },
        { id: 'c', days: 3, minutes: 50, weeks: NaN, level: 'beginner' },
      ];
      assert.deepEqual(availableLadderSorts(broken), ['recommended']);
    },
  },
  {
    /**
     * The real catalog, asked through the same helpers the sheet uses.
     *
     * Reading a source file with a regex produced three wrong numbers in this
     * repo in one evening, so this measures the shipped modules: every
     * category × level view the sheet can show, built from the same templates.
     *
     * The assertions are the ways this dies quietly. A chip row with nothing
     * in it; a guard that never hides anything and is therefore decoration; a
     * group that swallows the whole list. All of them have to be observed on
     * real data, because a guard that only ever fires one way is one I have
     * shipped twice this week.
     */
    name: 'ladder: chips and the fitting group both appear and hide across the catalog',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
      const { getReadyProgramBlockWeeks } = require('../../src/lib/readyProgramDuration');
      const { PROGRAM_CATEGORIES, filterByCategory } = require('../../src/lib/programCategories');
      const { catalogLevelForSetup } = require('../../src/lib/goalProgramme');

      let views = 0;
      let lengthOffered = 0;
      let lengthHidden = 0;
      let groupShown = 0;
      let groupEmpty = 0;

      for (const category of PROGRAM_CATEGORIES) {
        for (const level of [null, 'beginner', 'intermediate', 'advanced']) {
          const templates = filterByCategory(WORKOUT_TEMPLATES_V1, category.key)
            .filter((template) => (level ? template.level === level : true));
          if (templates.length === 0) {
            continue;
          }
          views += 1;

          const rows = templates.map((template) => ({
            id: template.id,
            days: template.daysPerWeek ?? (template.sessions || []).length,
            minutes: template.estimatedSessionDuration ?? 0,
            weeks: getReadyProgramBlockWeeks(template),
            level: template.level,
          }));

          const where = `${category.key}/${level ?? 'all'}`;
          const offered = availableLadderSorts(rows);
          assert.ok(offered.includes('recommended'), `${where}: an empty chip row`);
          if (offered.includes('length')) {
            lengthOffered += 1;
          } else {
            lengthHidden += 1;
            assert.equal(
              new Set(rows.map((row) => row.weeks)).size,
              1,
              `${where}: Length hidden while lengths differ`,
            );
          }

          // Sorting is a permutation: 57 templates is enough real data to
          // catch a comparator that drops or duplicates a row.
          for (const sort of offered) {
            const after = sortProgramLadder(rows, sort);
            assert.deepEqual(
              after.map((row) => row.id).sort(),
              rows.map((row) => row.id).sort(),
              `${where}/${sort}: not a permutation of the rows`,
            );
          }

          // The reader's week, every setup value of it, against every view.
          for (const days of [2, 3, 4, 5, 6]) {
            for (const setupLevel of [null, 'beginner', 'advanced', 'pro']) {
              const readerLevel = catalogLevelForSetup(setupLevel) ?? null;
              const { fits, rest } = partitionByReaderWeek(rows, days, readerLevel);

              assert.deepEqual(
                [...fits, ...rest].map((row) => row.id).sort(),
                rows.map((row) => row.id).sort(),
                `${where} @ ${days}d/${setupLevel}: the split lost or duplicated a row`,
              );
              for (const row of fits) {
                assert.equal(
                  row.days,
                  days,
                  `${where} @ ${days}d/${setupLevel}: ${row.id} is in the group at ${row.days} days`,
                );
              }
              if (fits.length > 0 && rest.length > 0) {
                groupShown += 1;
              } else {
                groupEmpty += 1;
              }
            }
          }
        }
      }

      assert.ok(views > 20, `only ${views} views measured — the catalog moved`);
      assert.ok(lengthOffered > 0, 'Length is never offered — the chip is gone, not guarded');
      assert.ok(lengthHidden > 0, 'Length is never hidden — the guard is decoration');
      assert.ok(groupShown > 0, 'no view ever shows a fitting group');
      assert.ok(groupEmpty > 0, 'every view shows a group — the header marks the normal');
    },
  },
];
