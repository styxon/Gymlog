const assert = require('node:assert/strict');

const {
  getSessionFocusTitle,
  getSessionBodyFocusLabel,
  getPlanWeekPhase,
  buildSessionEquipmentLabel,
  inferEquipmentFromExerciseName,
  getDefaultWarmup,
  getDefaultCooldown,
} = require('../../src/lib/homeSessionHero');

module.exports = [
  {
    name: 'session focus title strips A/B/C and day-number suffixes',
    run() {
      assert.equal(getSessionFocusTitle('Strength A'), 'Strength');
      assert.equal(getSessionFocusTitle('Strength B', null), 'Strength');
      assert.equal(getSessionFocusTitle('Push A: Chest Focus'), 'Push');
      assert.equal(getSessionFocusTitle('Upper 2'), 'Upper');
      assert.equal(getSessionFocusTitle('Lower Focus'), 'Lower Focus');
      // Falls back to the plan title when the session has no name.
      assert.equal(getSessionFocusTitle(null, '3-Day Strength Base'), '3-Day Strength Base');
      assert.equal(getSessionFocusTitle('', ''), 'Workout');
    },
  },
  {
    name: 'the ordinal is read in both languages, so no name loses its number',
    run() {
      // A duplicated or composed custom programme saves its session names in
      // Finnish by design, so this spelling is the one a real reader's own
      // programme carries. English-only, the head was not recognised as an
      // ordinal and the A/B/number strip below it removed the "4" — the Home
      // hero read the bare word "Päivä" (user 2026-08-26).
      assert.equal(getSessionFocusTitle('Päivä 4: Ylävartalo + HIIT'), 'Ylävartalo + HIIT');
      assert.equal(getSessionFocusTitle('Day 2: Back & Biceps'), 'Back & Biceps');
      // An ordinal with no focus after it keeps the ordinal whole: half of it
      // names nothing at all.
      assert.equal(getSessionFocusTitle('Päivä 4'), 'Päivä 4');
      assert.equal(getSessionFocusTitle('Päivä 4:'), 'Päivä 4');
      assert.equal(getSessionFocusTitle('Day 3'), 'Day 3');
    },
  },
  {
    name: 'body focus label humanizes split types',
    run() {
      assert.equal(getSessionBodyFocusLabel('full_body'), 'Full body');
      assert.equal(getSessionBodyFocusLabel('upper_lower'), 'Upper / lower');
      assert.equal(getSessionBodyFocusLabel('push_pull_legs'), 'Push / pull / legs');
      assert.equal(getSessionBodyFocusLabel(undefined), 'Full body');
      assert.equal(getSessionBodyFocusLabel(''), 'Full body');
    },
  },
  {
    name: 'plan week phase moves building -> progressing -> peaking',
    run() {
      assert.equal(getPlanWeekPhase(1, 8), 'building');
      assert.equal(getPlanWeekPhase(2, 8), 'building');
      assert.equal(getPlanWeekPhase(4, 8), 'progressing');
      assert.equal(getPlanWeekPhase(7, 8), 'peaking');
      assert.equal(getPlanWeekPhase(8, 8), 'peaking');
      // Clamped inputs stay sane.
      assert.equal(getPlanWeekPhase(0, 8), 'building');
      assert.equal(getPlanWeekPhase(12, 8), 'peaking');
      assert.equal(getPlanWeekPhase(1, 0), 'peaking');
    },
  },
  {
    name: 'equipment label joins unique equipment and hides bodyweight-only sessions',
    run() {
      const library = [
        { name: 'Back Squat', equipment: 'barbell' },
        { name: 'Bench Press', equipment: 'barbell' },
        { name: 'Incline Dumbbell Press', equipment: 'dumbbell' },
        { name: 'Cable Crunch', equipment: 'cable' },
        { name: 'Plank', equipment: 'bodyweight' },
      ];

      assert.equal(
        buildSessionEquipmentLabel(['Back Squat', 'Bench Press', 'Plank'], library),
        'Barbell',
      );
      assert.equal(
        buildSessionEquipmentLabel(['Back Squat', 'Incline Dumbbell Press', 'Cable Crunch'], library),
        'Barbell, Dumbbells & Cables',
      );
      // Case-insensitive name matching.
      assert.equal(buildSessionEquipmentLabel(['back squat'], library), 'Barbell');
      // Bodyweight-only or unknown names -> null (row hidden).
      assert.equal(buildSessionEquipmentLabel(['Plank'], library), null);
      assert.equal(buildSessionEquipmentLabel(['Mystery Move'], library), null);
      assert.equal(buildSessionEquipmentLabel([], library), null);
    },
  },
  {
    name: 'equipment inference covers plan names the library does not know verbatim',
    run() {
      // The generated library has "Barbell Squat" etc., not "Back Squat" —
      // name inference must fill the gap so the equipment row stays truthful.
      assert.equal(inferEquipmentFromExerciseName('Back Squat'), 'barbell');
      assert.equal(inferEquipmentFromExerciseName('Bench Press'), 'barbell');
      assert.equal(inferEquipmentFromExerciseName('Romanian Deadlift'), 'barbell');
      assert.equal(inferEquipmentFromExerciseName('Incline Dumbbell Press'), 'dumbbell');
      assert.equal(inferEquipmentFromExerciseName('Cable Crunch'), 'cable');
      assert.equal(inferEquipmentFromExerciseName('Lat Pulldown'), 'cable');
      assert.equal(inferEquipmentFromExerciseName('Leg Press'), 'machine');
      assert.equal(inferEquipmentFromExerciseName('Plank'), 'bodyweight');
      assert.equal(inferEquipmentFromExerciseName('Push-Up'), 'bodyweight');
      // Ambiguous rows stay unknown rather than guessing.
      assert.equal(inferEquipmentFromExerciseName('Chest-Supported Row'), null);

      // Full fallback path with an empty library.
      assert.equal(
        buildSessionEquipmentLabel(['Back Squat', 'Bench Press', 'Chest-Supported Row', 'Cable Crunch'], []),
        'Barbell & Cables',
      );
      assert.equal(buildSessionEquipmentLabel(['Plank', 'Push-Up'], []), null);
      // Exact library data still wins over inference.
      assert.equal(
        buildSessionEquipmentLabel(['Back Squat'], [{ name: 'Back Squat', equipment: 'machine' }]),
        'Machines',
      );
    },
  },
  {
    name: 'default warmup and cooldown blocks vary by focus and stay well-formed',
    run() {
      const focuses = ['general', 'push', 'pull', 'upper', 'lower'];
      for (const focus of focuses) {
        const warmup = getDefaultWarmup(focus);
        const cooldown = getDefaultCooldown(focus);
        assert.ok(warmup.drills.length >= 2, `${focus} warmup has drills`);
        assert.ok(cooldown.drills.length >= 2, `${focus} cooldown has drills`);
        assert.ok(warmup.minutes > 0 && cooldown.minutes > 0);
        for (const drill of [...warmup.drills, ...cooldown.drills]) {
          assert.ok(drill.name.length > 0);
          assert.ok(drill.schemeLabel.length > 0);
        }
      }
      // Focus-specific content actually differs.
      assert.notDeepEqual(getDefaultWarmup('push').drills, getDefaultWarmup('pull').drills);
      assert.notDeepEqual(getDefaultCooldown('push').drills, getDefaultCooldown('general').drills);
      // A leg day does not end by stretching the chest. This is the drill the
      // tester actually saw after "Pakarat & Jalat", and it was in the block
      // even when the classification was right.
      assert.deepEqual(
        getDefaultCooldown('lower', 'en').drills.map((drill) => drill.name),
        ['Couch stretch', 'Seated hamstring stretch'],
      );
    },
  },
  {
    name: 'a block says how long its own drills take, not a constant',
    run() {
      // Seen on a phone: Home said "Palautuminen · 4 min" over two stretches
      // (90 s + 60 s) while the player's entry screen said ~3 for the same
      // block. The minutes were the literals 6 and 4. Now they come from the
      // drills through the same estimate the player uses.
      const { estimateRoutineBlockSeconds } = require('../../src/lib/guidedPlayer');
      for (const focus of ['general', 'push', 'pull', 'upper', 'lower']) {
        for (const block of [getDefaultWarmup(focus), getDefaultCooldown(focus)]) {
          const expected = Math.max(1, Math.round(estimateRoutineBlockSeconds(block) / 60));
          assert.equal(block.minutes, expected, `${focus}: minutes disagree with the block's own drills`);
        }
      }
      // And the number is not the same for every block — a warm-up with a
      // 3-minute row is longer than a cool-down of two stretches.
      const minutes = new Set(
        ['general', 'push', 'lower'].flatMap((focus) => [getDefaultWarmup(focus).minutes, getDefaultCooldown(focus).minutes]),
      );
      assert.ok(minutes.size > 1, 'every block reports the same minutes — is it a constant again?');
    },
  },
  {
    name: 'drills respect the equipment the user actually has',
    run() {
      // A bodyweight-only setup ([] = "I have nothing") must never be told to
      // warm up on a rowing machine or grab an empty bar / band / pull-up bar.
      const gated = ['Rowing machine', 'Empty-bar squats', 'Band pull-aparts', 'Scapular pull-ups', 'Band face pulls', 'Lat stretch on rack', 'Dead hang'];
      for (const focus of ['general', 'push', 'pull', 'upper', 'lower']) {
        const names = [
          ...getDefaultWarmup(focus, 'en', []).drills,
          ...getDefaultCooldown(focus, 'en', []).drills,
        ].map((drill) => drill.name);
        for (const banned of gated) {
          assert.ok(!names.includes(banned), `${focus}: "${banned}" offered to a no-equipment user`);
        }
      }

      // Fallbacks swap in without shrinking the block.
      const bodyweightPull = getDefaultWarmup('pull', 'en', []);
      assert.equal(bodyweightPull.drills.length, getDefaultWarmup('pull', 'en', null).drills.length);
      assert.deepEqual(
        bodyweightPull.drills.map((drill) => drill.name),
        ['Jumping jacks', 'Wall slides', 'Wall slides'].slice(0, bodyweightPull.drills.length),
      );

      // Partial gear keeps what it can: bands allow band work, no rower still
      // means no rowing machine.
      const bandsOnly = getDefaultWarmup('push', 'en', ['Resistance bands']).drills.map((drill) => drill.name);
      assert.ok(bandsOnly.includes('Band pull-aparts'));
      assert.ok(!bandsOnly.includes('Rowing machine'));

      // null = the setup never said → the original full-gym defaults stand.
      assert.ok(
        getDefaultWarmup('lower', 'en', null).drills.some((drill) => drill.name === 'Rowing machine'),
      );
    },
  },
];
