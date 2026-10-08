const assert = require('node:assert/strict');

const {
  classifySessionFocus,
  getDefaultCooldown,
  getDefaultWarmup,
  listRoutineDrillOptions,
  routineDrillSlotKey,
} = require('../../.test-dist/lib/homeSessionHero');
const { avoidedCautionAreas, exerciseHitsCautionArea } = require('../../.test-dist/lib/cautionAreaMatching');
const { estimateRoutineBlockSeconds } = require('../../.test-dist/lib/guidedPlayer');
const { getDrillLibraryName } = require('../../.test-dist/lib/drillMedia');
const { estimateProgrammeSessionMinutesList } = require('../../.test-dist/lib/programmeMinutes');
const { applyCautionFlagsToExercises } = require('../../.test-dist/lib/cautionExerciseFilter');
const { WORKOUT_TEMPLATES_V1, getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog');
const { Vinha_WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/gainerProgramCatalog');
const { t } = require('../../.test-dist/lib/i18n');

const FOCUS_KINDS = ['lower', 'push', 'pull', 'upper', 'general', 'easy'];
const AREAS = ['shoulders', 'lower_back', 'knees', 'elbows', 'wrists', 'hips', 'neck', 'ankles'];
// Every kind of reader's gear the blocks resolve against: unknown, none at all,
// and a full gym (which swaps the bodyweight fallbacks for machines and bars).
const GEARS = [
  null,
  [],
  ['Barbells', 'Barbell & plates', 'Cardio machines', 'Resistance bands', 'Pull-up bar', 'Squat rack'],
];

const ALL_TEMPLATES = [...WORKOUT_TEMPLATES_V1, ...Vinha_WORKOUT_TEMPLATES_V1];
const CATALOG_SESSIONS = ALL_TEMPLATES.flatMap((template) =>
  template.sessions.map((session) => ({
    templateId: template.id,
    sessionName: session.name,
    names: session.exercises.map((exercise) => exercise.exerciseName),
  })),
);

const avoid = (area) => [{ area, level: 'avoid' }];

function blockKeys(block) {
  return block.drills.map((drill) => drill.key);
}

module.exports = [
  {
    name: 'an avoid flag keeps every drill on that area out of the warm-up and cool-down',
    run() {
      for (const area of AREAS) {
        for (const focus of FOCUS_KINDS) {
          for (const gear of GEARS) {
            for (const block of [
              getDefaultWarmup(focus, 'en', gear, null, avoid(area)),
              getDefaultCooldown(focus, 'en', gear, null, avoid(area)),
            ]) {
              for (const drill of block.drills) {
                assert.equal(
                  exerciseHitsCautionArea(drill.name, area),
                  false,
                  `${area} avoid: "${drill.name}" is still in the ${focus} block (gear ${JSON.stringify(gear)})`,
                );
              }
            }
          }
        }
      }
    },
  },
  {
    name: 'an avoided knee does not open the day with jumping jacks or squats, and the block costs the same',
    run() {
      const flags = avoid('knees');
      // The failing persona: home, no machines, knees avoid, on a lower day.
      const warmup = getDefaultWarmup('lower', 'en', [], null, flags);
      const names = warmup.drills.map((drill) => drill.name);
      assert.ok(!names.includes('Jumping jacks') && !names.includes('Bodyweight squats'), names.join(', '));
      assert.ok(names.includes('March in place') && names.includes('Glute bridges'), names.join(', '));

      // Same seconds block by block, so no minutes estimate drifts.
      for (const focus of FOCUS_KINDS) {
        for (const gear of GEARS) {
          const plain = getDefaultWarmup(focus, 'en', gear);
          const guarded = getDefaultWarmup(focus, 'en', gear, null, flags);
          assert.equal(guarded.drills.length, plain.drills.length);
          assert.equal(estimateRoutineBlockSeconds(guarded), estimateRoutineBlockSeconds(plain), `${focus} warm-up`);
          assert.equal(guarded.minutes, plain.minutes);
          // The stand-ins add no repeat the plain block did not already have.
          assert.equal(
            guarded.drills.length - new Set(blockKeys(guarded)).size,
            plain.drills.length - new Set(blockKeys(plain)).size,
            `${focus} warm-up repeats a drill`,
          );
        }
      }
    },
  },
  {
    name: 'a wrists avoid takes push-ups out and a careful flag, no flag or an info flag changes nothing',
    run() {
      const pushUps = (block) => block.drills.some((drill) => drill.name === 'Push-ups');
      assert.equal(pushUps(getDefaultWarmup('push', 'en', null)), true);
      assert.equal(pushUps(getDefaultWarmup('push', 'en', null, null, avoid('wrists'))), false);
      assert.equal(pushUps(getDefaultWarmup('general', 'en', null, null, avoid('wrists'))), false);

      // `careful` swaps heavier lifts for gentler ones and promises no absence.
      for (const flags of [[{ area: 'wrists', level: 'careful' }], [{ area: 'knees', level: 'info' }], [], null]) {
        for (const focus of FOCUS_KINDS) {
          assert.deepEqual(getDefaultWarmup(focus, 'en', [], null, flags), getDefaultWarmup(focus, 'en', []));
          assert.deepEqual(getDefaultCooldown(focus, 'en', [], null, flags), getDefaultCooldown(focus, 'en', []));
        }
      }
      assert.deepEqual(
        avoidedCautionAreas([
          { area: 'knees', level: 'avoid' },
          { area: 'wrists', level: 'careful' },
          { area: 'neck', level: 'info' },
          { area: 'knees', level: 'avoid' },
        ]),
        ['knees'],
      );
    },
  },
  {
    name: 'the swap picker does not offer a flagged drill, and a stored pick of one is dropped',
    run() {
      const flags = avoid('wrists');
      const options = listRoutineDrillOptions('warmup', 'en', null, flags).map((drill) => drill.name);
      assert.ok(!options.includes('Push-ups'));
      assert.ok(listRoutineDrillOptions('warmup', 'en', null).some((drill) => drill.name === 'Push-ups'));

      // A pick made before the flag existed does not bring the drill back.
      const overrides = { [routineDrillSlotKey('warmup', 'push', 2)]: 'home.drill.pushUps' };
      const withPick = getDefaultWarmup('push', 'en', null, overrides, flags);
      assert.deepEqual(withPick, getDefaultWarmup('push', 'en', null, null, flags));
      // Without the flag the pick still applies.
      assert.equal(getDefaultWarmup('push', 'en', null, overrides).drills[2].key, 'home.drill.pushUps');
    },
  },
  {
    name: 'in Finnish the flagged blocks carry real names and every stand-in has a photo',
    run() {
      for (const area of ['knees', 'wrists', 'elbows']) {
        for (const focus of FOCUS_KINDS) {
          for (const gear of GEARS) {
            const flags = avoid(area);
            for (const block of [
              getDefaultWarmup(focus, 'fi', gear, null, flags),
              getDefaultCooldown(focus, 'fi', gear, null, flags),
            ]) {
              for (const drill of block.drills) {
                assert.notEqual(drill.name, drill.key, 'a raw key reached the screen');
                assert.ok(getDrillLibraryName(drill.name), `no library photo for "${drill.name}"`);
              }
            }
          }
        }
      }
      assert.equal(t('fi', 'home.drill.marchInPlace'), 'Marssi paikallaan');
      assert.equal(t('en', 'home.drill.gluteBridges'), 'Glute bridges');
    },
  },
  {
    name: 'minutes estimated for a programme card use the flagged block, at the same length',
    run() {
      const template = getWorkoutTemplateById('tpl_home_dumbbell_strength_v1');
      const plain = estimateProgrammeSessionMinutesList(template.sessions, { availableEquipment: [] });
      const flagged = estimateProgrammeSessionMinutesList(template.sessions, {
        availableEquipment: [],
        cautionFlags: [...avoid('knees'), ...avoid('wrists')],
      });
      assert.deepEqual(flagged, plain);
    },
  },
  {
    name: 'a day of stretches, flows and runs is easy, and does not get push-ups or a chest stretch',
    run() {
      assert.equal(classifySessionFocus(['Sun Salutation Flow', 'Breath Reset']), 'easy');
      assert.equal(classifySessionFocus(['Kneeling Hip Flexor', 'Seated Floor Hamstring Stretch', "Child's Pose"]), 'easy');
      assert.equal(classifySessionFocus(['Tempo Run Blocks', 'Stride Finishers', 'Standing Hamstring and Calf Stretch']), 'easy');
      // The knee-avoid stand-ins of a run day are just as easy.
      assert.equal(classifySessionFocus(['Brisk Walk Blocks', 'Standing Hamstring and Calf Stretch']), 'easy');
      // Core and skill work also casts no pattern vote and is NOT easy.
      assert.equal(
        classifySessionFocus(['Handstand Wall Walk', 'L-Sit Hold', 'Dragon Flag', 'Hollow Body Hold']),
        'general',
      );
      // One lift in the list is a lifting day.
      assert.notEqual(classifySessionFocus(['Back Squat', 'Child\'s Pose', 'Cat Stretch']), 'easy');
      assert.equal(classifySessionFocus([]), 'general');

      for (const gear of GEARS) {
        const names = [
          ...getDefaultWarmup('easy', 'en', gear).drills,
          ...getDefaultCooldown('easy', 'en', gear).drills,
        ].map((drill) => drill.name);
        assert.ok(!names.includes('Push-ups') && !names.includes('Chest doorway stretch'), names.join(', '));
        assert.ok(!names.includes('Jumping jacks'), names.join(', '));
      }
      // Short: the warm-up of a 25-minute yoga day is not five minutes of strength prep.
      assert.ok(getDefaultWarmup('easy', 'en').minutes <= 4);
      assert.ok(getDefaultCooldown('easy', 'en').minutes <= 3);
    },
  },
  {
    name: 'no catalog day made only of stretches or runs gets the strength-day block',
    run() {
      const gentleTemplates = new Set(['tpl_2_day_mobility_reset_v1', 'tpl_2_day_yoga_recovery_v1']);
      const gentleSessions = new Set(['Spinal Flexibility', 'Deep Recovery Stretch', 'Day 3: Recovery & Mobility']);
      let easyDays = 0;
      for (const session of CATALOG_SESSIONS) {
        const focus = classifySessionFocus(session.names);
        if (gentleTemplates.has(session.templateId) || gentleSessions.has(session.sessionName)) {
          assert.equal(focus, 'easy', `${session.templateId} / ${session.sessionName}`);
        }
        if (focus === 'easy') {
          easyDays += 1;
        }
      }
      assert.equal(classifySessionFocus(
        getWorkoutTemplateById('tpl_3_day_run_mobility_v1').sessions.find((s) => /Tempo Run/.test(s.name)).exercises.map((e) => e.exerciseName),
      ), 'easy');
      assert.ok(easyDays >= 8, `only ${easyDays} easy days in the catalog`);
    },
  },
  {
    name: 'a day that opens on a squat or a hinge and then presses and rows is not an upper day',
    run() {
      // The two home dumbbell days, the huge starter's hinge day and the
      // bodyweight single-leg RDL day: one lift in four is outvoted by the rest.
      assert.equal(
        classifySessionFocus(['Goblet Squat', 'Dumbbell Floor Press', 'Single-Arm Dumbbell Row', 'Rear Delt Fly', 'Plank']),
        'general',
      );
      assert.equal(
        classifySessionFocus(['Stiff-Legged Dumbbell Deadlift', 'Dumbbell Shoulder Press', 'Bent Over Two-Dumbbell Row', 'Hammer Curl', 'Dead Bug']),
        'general',
      );
      assert.equal(
        classifySessionFocus(['Single-Leg RDL', 'Push-Up', 'Dumbbell Row', 'Dumbbell Shoulder Press', 'Plank']),
        'general',
      );
      // A real pull day that happens to open with a deadlift stays a pull day,
      // and a day that opens upper stays upper.
      assert.equal(
        classifySessionFocus(['Deadlift', 'Lat Pulldown', 'Seated Cable Row', 'Face Pull', 'Barbell Curl', 'Hammer Curl']),
        'pull',
      );
      assert.equal(
        classifySessionFocus(['Bench Press', 'Lat Pulldown', 'Overhead Press', 'Seated Cable Row']),
        'upper',
      );
    },
  },
  {
    name: 'no catalog day that opens on a squat or a hinge is classified as an upper day',
    run() {
      const lowerOpener = /squat|deadlift|\brdl\b|lunge|hip thrust/i;
      for (const session of CATALOG_SESSIONS) {
        if (session.names.length > 0 && lowerOpener.test(session.names[0])) {
          assert.notEqual(
            classifySessionFocus(session.names),
            'upper',
            `${session.templateId} / ${session.sessionName} opens on ${session.names[0]}`,
          );
        }
      }
    },
  },
  {
    name: 'a thruster is a squat and a press: a knee or shoulder avoid removes it',
    run() {
      assert.equal(exerciseHitsCautionArea('Dumbbell Thruster', 'knees'), true);
      assert.equal(exerciseHitsCautionArea('Dumbbell Thruster', 'shoulders'), true);
      assert.equal(exerciseHitsCautionArea('Dumbbell Thruster', 'wrists'), false);

      for (const area of ['knees', 'shoulders']) {
        const day = [
          { exerciseName: 'Dumbbell Thruster', sets: 4, repsMin: 12, repsMax: 12 },
          { exerciseName: 'Plank', sets: 3, repsMin: 30, repsMax: 30 },
        ];
        const result = applyCautionFlagsToExercises(
          day.map((exercise, index) => ({
            id: `ex_${index}`,
            exerciseId: `lib_${index}`,
            orderIndex: index,
            role: 'accessory',
            substitutionGroupId: null,
            trackingMode: 'weight_reps',
            restSecondsMin: 60,
            restSecondsMax: 90,
            ...exercise,
          })),
          avoid(area),
        );
        const left = result.exercises.map((exercise) => exercise.exerciseName);
        assert.ok(!left.some((name) => /thruster/i.test(name)), `${area}: ${left.join(', ')}`);
      }
    },
  },
];
