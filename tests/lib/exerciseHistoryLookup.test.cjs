const assert = require('node:assert/strict');

const {
  findLatestEntryForExerciseName,
  findHistoricalSetForIndex,
  entryMatchesRepWindow,
  selectLatestUsableEntry,
  resolveLastTimeEntry,
} = require('../../src/lib/exerciseHistoryLookup');

function entry(overrides = {}) {
  return {
    slotId: 'tpl_a:day_1:primary_squat',
    templateId: 'tpl_a',
    templateName: 'Strong Starter',
    exerciseName: 'Back Squat',
    substitutionGroup: 'squat_pattern',
    performedAt: '2026-07-20T10:00:00.000Z',
    sessionId: 'session_1',
    sets: [
      { setIndex: 0, loadKg: 60, reps: 8, completedAt: '2026-07-20T10:05:00.000Z' },
      { setIndex: 1, loadKg: 62.5, reps: 7, completedAt: '2026-07-20T10:10:00.000Z' },
    ],
    skipped: false,
    ...overrides,
  };
}

module.exports = [
  {
    name: 'a lift is found by name across slots, newest session wins',
    run() {
      // The same lift in three places: another program, another day of this
      // program, and an empty workout. Slot-keyed history cannot see any of
      // them from a fresh slot — that is the whole point of this lookup.
      const slotHistory = {
        'tpl_a:day_1:primary_squat': [entry({ performedAt: '2026-07-10T10:00:00.000Z' })],
        'tpl_b:day_3:legs_1': [
          entry({
            slotId: 'tpl_b:day_3:legs_1',
            performedAt: '2026-07-24T10:00:00.000Z',
            sets: [{ setIndex: 0, loadKg: 70, reps: 6, completedAt: '2026-07-24T10:05:00.000Z' }],
          }),
        ],
        empty_workout_slot: [
          entry({ slotId: 'empty_workout_slot', performedAt: '2026-07-18T10:00:00.000Z' }),
        ],
      };

      const found = findLatestEntryForExerciseName(slotHistory, 'Back Squat');
      assert.equal(found.performedAt, '2026-07-24T10:00:00.000Z');
      assert.equal(found.sets[0].loadKg, 70);

      // Matching ignores case and stray whitespace, like every other name
      // comparison in the app.
      assert.equal(findLatestEntryForExerciseName(slotHistory, '  back squat ').sets[0].loadKg, 70);

      // A lift never done is null, not a guess.
      assert.equal(findLatestEntryForExerciseName(slotHistory, 'Hip Thrust'), null);
      assert.equal(findLatestEntryForExerciseName(slotHistory, '   '), null);
      assert.equal(findLatestEntryForExerciseName({}, 'Back Squat'), null);
    },
  },
  {
    name: 'skipped, empty and all-zero entries are not a weight',
    run() {
      const slotHistory = {
        skipped_slot: [entry({ slotId: 'skipped_slot', performedAt: '2026-07-30T10:00:00.000Z', skipped: true })],
        no_sets: [entry({ slotId: 'no_sets', performedAt: '2026-07-29T10:00:00.000Z', sets: [] })],
        zero_slot: [
          entry({
            slotId: 'zero_slot',
            performedAt: '2026-07-28T10:00:00.000Z',
            sets: [{ setIndex: 0, loadKg: 0, reps: 6, completedAt: '2026-07-28T10:05:00.000Z' }],
          }),
        ],
        real_slot: [entry({ slotId: 'real_slot', performedAt: '2026-07-01T10:00:00.000Z' })],
      };

      // These zeroes are real data: the guided player used to hide the weight
      // field, so sets went in at 0 kg. Prefilling one is worse than
      // prefilling nothing — it looks like an answer.
      const loaded = findLatestEntryForExerciseName(slotHistory, 'Back Squat', { requireLoaded: true });
      assert.equal(loaded.slotId, 'real_slot');

      // Bodyweight work must not pass requireLoaded: there 0 kg is the truth,
      // and the zero entry is the most recent thing that happened.
      const bodyweight = findLatestEntryForExerciseName(slotHistory, 'Back Squat');
      assert.equal(bodyweight.slotId, 'zero_slot');
    },
  },
  {
    name: 'the set for an index is the logged one, else the one in that position',
    run() {
      const source = entry({
        sets: [
          { setIndex: 2, loadKg: 80, reps: 5, completedAt: '2026-07-20T10:05:00.000Z' },
          { setIndex: 3, loadKg: 85, reps: 4, completedAt: '2026-07-20T10:10:00.000Z' },
        ],
      });

      // Exact setIndex wins…
      assert.equal(findHistoricalSetForIndex(source, 2).loadKg, 80);
      // …and positional fallback covers a session that logged fewer sets.
      assert.equal(findHistoricalSetForIndex(source, 0).loadKg, 80);
      assert.equal(findHistoricalSetForIndex(source, 9), null);
      assert.equal(findHistoricalSetForIndex(null, 0), null);
    },
  },
  {
    /**
     * #bugs 2026-08-29: "2 eri päivää tekee samaa liikettä, toinen avg 8
     * toistoo isot painot, toinen 15-20 toistoo pienet painot, nyt
     * automaattisesti laitetaan 10 kg joka on se maksimivoimatreeni."
     *
     * A weight is only an answer together with the reps it was lifted for.
     */
    name: 'a weight is not borrowed across a different rep prescription',
    run() {
      const heavy = {
        'tpl:day_a:lat_raise': [
          entry({
            slotId: 'tpl:day_a:lat_raise',
            exerciseName: 'Dumbbell Lateral Raise',
            performedAt: '2026-08-27T09:00:00.000Z',
            sets: [
              { setIndex: 0, loadKg: 10, reps: 8, completedAt: '2026-08-27T09:05:00.000Z' },
              { setIndex: 1, loadKg: 10, reps: 8, completedAt: '2026-08-27T09:10:00.000Z' },
              { setIndex: 2, loadKg: 10, reps: 7, completedAt: '2026-08-27T09:15:00.000Z' },
            ],
          }),
        ],
      };

      // The pump day asks for 15-20. The heavy day does not answer it.
      assert.equal(
        findLatestEntryForExerciseName(heavy, 'Dumbbell Lateral Raise', {
          repWindow: { min: 15, max: 20 },
        }),
        null,
      );

      // Another heavy day does — and so does one two reps out, which is the
      // same load written differently.
      assert.equal(
        findLatestEntryForExerciseName(heavy, 'Dumbbell Lateral Raise', {
          repWindow: { min: 6, max: 8 },
        }).sets[0].loadKg,
        10,
      );
      assert.equal(
        findLatestEntryForExerciseName(heavy, 'Dumbbell Lateral Raise', {
          repWindow: { min: 9, max: 10 },
        }).sets[0].loadKg,
        10,
      );

      // No window at all is the old behaviour, still available.
      assert.equal(
        findLatestEntryForExerciseName(heavy, 'Dumbbell Lateral Raise').sets[0].loadKg,
        10,
      );
    },
  },
  {
    /**
     * The median, not the span: a heavy day with one long back-off set would
     * otherwise claim to cover everything between them.
     */
    name: 'the rep window reads the typical set of a session, not its extremes',
    run() {
      const backOff = entry({
        sets: [
          { setIndex: 0, loadKg: 100, reps: 5, completedAt: '2026-07-20T10:05:00.000Z' },
          { setIndex: 1, loadKg: 100, reps: 5, completedAt: '2026-07-20T10:10:00.000Z' },
          { setIndex: 2, loadKg: 60, reps: 15, completedAt: '2026-07-20T10:15:00.000Z' },
        ],
      });

      assert.equal(entryMatchesRepWindow(backOff, { min: 4, max: 6 }), true);
      assert.equal(entryMatchesRepWindow(backOff, { min: 15, max: 20 }), false);
      // No window, or nothing to compare, is never a mismatch.
      assert.equal(entryMatchesRepWindow(backOff, null), true);
      assert.equal(entryMatchesRepWindow(entry({ sets: [] }), { min: 15, max: 20 }), true);
    },
  },
  {
    name: 'the latest usable entry skips skipped and empty sessions',
    run() {
      const entries = [
        entry({ performedAt: '2026-08-01T10:00:00.000Z', skipped: true }),
        entry({ performedAt: '2026-07-25T10:00:00.000Z', sets: [] }),
        entry({ performedAt: '2026-07-20T10:00:00.000Z' }),
      ];
      assert.equal(selectLatestUsableEntry(entries).performedAt, '2026-07-20T10:00:00.000Z');
      assert.equal(selectLatestUsableEntry([]), null);
      assert.equal(selectLatestUsableEntry(undefined), null);
    },
  },
  {
    /**
     * #bugs 2026-08-29: "Alla näkyy viimeksi tehty 27.8 mutta ei näy ylhäällä
     * olevassa taulukossa mitään." The badge and the table asked the same
     * question of two different sources. This is the one source.
     */
    name: 'last time resolves own slot first, then the unscoped key, then by name',
    run() {
      const own = entry({ slotId: 'tpl:day_b:squat', performedAt: '2026-08-20T10:00:00.000Z' });
      const legacy = entry({ slotId: 'primary_squat', performedAt: '2026-08-10T10:00:00.000Z' });
      const elsewhere = entry({ slotId: 'tpl:day_a:squat', performedAt: '2026-08-27T10:00:00.000Z' });

      const query = (slotHistory) =>
        resolveLastTimeEntry({
          slotHistory,
          slotId: 'tpl:day_b:squat',
          templateSlotId: 'primary_squat',
          exerciseName: 'Back Squat',
          requireLoaded: true,
        });

      // Its own history wins even when a newer session sits in another slot.
      const ownFirst = query({
        'tpl:day_b:squat': [own],
        primary_squat: [legacy],
        'tpl:day_a:squat': [elsewhere],
      });
      assert.equal(ownFirst.borrowed, false);
      assert.equal(ownFirst.performedAt ?? ownFirst.entry.performedAt, '2026-08-20T10:00:00.000Z');

      // Nothing scoped: the unscoped key an older install wrote under.
      const viaLegacy = query({ primary_squat: [legacy], 'tpl:day_a:squat': [elsewhere] });
      assert.equal(viaLegacy.borrowed, false);
      assert.equal(viaLegacy.entry.performedAt, '2026-08-10T10:00:00.000Z');

      // Neither: the lift itself, from wherever it was last done — and said
      // to be borrowed, so the screen can label it.
      const borrowed = query({ 'tpl:day_a:squat': [elsewhere] });
      assert.equal(borrowed.borrowed, true);
      assert.equal(borrowed.entry.performedAt, '2026-08-27T10:00:00.000Z');

      assert.equal(query({}), null);
    },
  },
  {
    name: 'the borrowed last time is gated on the same reps the prefill is',
    run() {
      const slotHistory = {
        'tpl:day_a:lat_raise': [
          entry({
            slotId: 'tpl:day_a:lat_raise',
            exerciseName: 'Dumbbell Lateral Raise',
            sets: [{ setIndex: 0, loadKg: 10, reps: 8, completedAt: '2026-08-27T09:05:00.000Z' }],
          }),
        ],
      };

      const resolved = resolveLastTimeEntry({
        slotHistory,
        slotId: 'tpl:day_b:lat_raise',
        exerciseName: 'Dumbbell Lateral Raise',
        requireLoaded: true,
        repWindow: { min: 15, max: 20 },
      });

      // Nothing to show and nothing to prefill — the table and the badge agree
      // on saying nothing, which is the point.
      assert.equal(resolved, null);
    },
  },
];
