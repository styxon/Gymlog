const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { applyProgramSessionEdit } = require('../../.test-dist/lib/programSessionEdit.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { getExerciseTemplateDefaults } = require('../../.test-dist/lib/exerciseSuggestions.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { doseAfterSwap } = require('../../.test-dist/lib/swapDose.js');
const {
  applySessionAdaptation,
  EMPTY_SESSION_ADAPTATION,
  hasSessionAdaptation,
  withSessionSwap,
} = require('../../.test-dist/lib/sessionAdaptation.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { buildCustomProgramDetail, exerciseAfterSessionSwap } = require('../../.test-dist/lib/programDetails.js');
const { prescriptionUnitOf } = require('../../.test-dist/features/workout/workoutTypes.js');
const {
  effectiveSwapBodyPart,
  effectiveSwapCategory,
  resolveSwapBrowsePrefilter,
} = require('../../.test-dist/lib/swapBrowsePrefilter.js');
const { buildSwapPickerLibrary } = require('../../.test-dist/lib/swapPickerLists.js');
const { getPopularExerciseLibraryOrder } = require('../../.test-dist/lib/exerciseSuggestions.js');
const { exerciseTypeOf } = require('../../.test-dist/lib/exerciseClassification.js');
const { matchesBodyPartFilter } = require('../../.test-dist/lib/exerciseBrowseFilter.js');

/**
 * The swap-sheet hunt of 2026-10-07 (group G2): a swap across units, the
 * programme's own lift picked back, and a cardio row's swap list. Each
 * finding as the case that showed it.
 */

const library = createSeedExerciseLibrary();
const libraryNames = library.map((item) => item.name);
const itemNamed = (name) => library[findGuidedLibraryIndex(name, libraryNames)];
const addSheetDefault = (name) => getExerciseTemplateDefaults(itemNamed(name), 90);
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');

function storedRow(name, sets, repMin, repMax, trackingMode, overrides = {}) {
  return {
    id: 'ex1',
    name,
    targetSets: sets,
    repMin,
    repMax,
    restSeconds: 75,
    trackedDefault: false,
    libraryItemId: null,
    trackingMode,
    supersetGroup: null,
    ...overrides,
  };
}

/** The stored day as the session would start it. */
function runtimeOf(exercises) {
  const sessions = [
    {
      id: 's1',
      name: 'Day',
      orderIndex: 0,
      exercises: exercises.map((exercise, index) => ({
        ...exercise,
        workoutTemplateId: 't',
        workoutTemplateSessionId: 's1',
        orderIndex: index,
      })),
    },
  ];
  return adaptLegacyWorkoutTemplateToRuntimeTemplate({ id: 't', name: 'T' }, sessions, library, 90);
}

function keepForEver(row, to) {
  const outcome = applyProgramSessionEdit([{ id: 's1', name: 'Day', exercises: [row] }], 's1', {
    kind: 'replace',
    exerciseId: row.id,
    exerciseName: to,
    libraryItemId: itemNamed(to)?.id ?? null,
  });
  assert.equal(outcome.kind, 'save', `${row.name} -> ${to}`);
  return outcome.sessions[0].exercises[0];
}

const CROSS_UNIT = [
  // A 45-second plank kept as crunches asked for 45 crunches.
  { from: storedRow('Plank', 3, 45, 45, 'hold'), to: 'Crunches', unit: 'reps' },
  // A squat at 8 kept as a plank asked for an 8-second plank…
  { from: storedRow('Barbell Full Squat', 3, 8, 8, null), to: 'Plank', unit: 'seconds' },
  // …and kept as a bike, 3 × 8 minutes.
  { from: storedRow('Barbell Full Squat', 3, 8, 8, null), to: 'Bicycling, Stationary', unit: 'minutes' },
];

module.exports = [
  {
    name: 'swap hunt 10-07: a lift kept for ever in another unit starts on its own add-sheet default',
    run() {
      for (const { from, to, unit } of CROSS_UNIT) {
        const kept = keepForEver(from, to);
        const expected = addSheetDefault(to);
        assert.deepEqual(
          [kept.targetSets, kept.repMin, kept.repMax],
          [expected.targetSets, expected.repMin, expected.repMax],
          `${from.name} -> ${to}`,
        );
        // The rest is the slot's.
        assert.equal(kept.restSeconds, 75);
        // And the session reads those numbers in the incoming lift's unit.
        const started = runtimeOf([kept]).sessions[0].exercises[0];
        assert.equal(prescriptionUnitOf(started.trackingMode), unit, `${from.name} -> ${to}`);
      }
      // The three cases in plain numbers.
      assert.deepEqual(
        CROSS_UNIT.map(({ from, to }) => {
          const kept = keepForEver(from, to);
          return `${kept.targetSets}x${kept.repMin}-${kept.repMax}`;
        }),
        ['3x12-15', '3x30-45', '1x8-12'],
      );

      // Within a unit nothing moves: a squat kept as a leg press is 3 × 8.
      const press = keepForEver(storedRow('Barbell Full Squat', 3, 8, 8, null), 'Leg Press');
      assert.deepEqual([press.targetSets, press.repMin, press.repMax], [3, 8, 8]);
      // A superset counts in rounds, so the block's set count stays.
      const paired = keepForEver(storedRow('Barbell Full Squat', 4, 8, 8, null, { supersetGroup: 'g1' }), 'Bicycling, Stationary');
      assert.equal(paired.targetSets, 4);
      assert.deepEqual([paired.repMin, paired.repMax], [8, 12]);
    },
  },
  {
    name: 'swap hunt 10-07: "Just this time" and "For ever" give one prescription for the same pick',
    run() {
      // A custom programme: the held swap applied at the start, against the
      // row kept for ever and started.
      for (const { from, to } of CROSS_UNIT) {
        const today = applySessionAdaptation(runtimeOf([from]), {
          swaps: { [runtimeOf([from]).sessions[0].exercises[0].slotId]: to },
          drops: [],
        }).sessions[0].exercises[0];
        const forEver = runtimeOf([keepForEver(from, to)]).sessions[0].exercises[0];
        assert.deepEqual(
          [today.sets, today.repsMin, today.repsMax, prescriptionUnitOf(today.trackingMode)],
          [forEver.sets, forEver.repsMin, forEver.repsMax, prescriptionUnitOf(forEver.trackingMode)],
          `${from.name} -> ${to}`,
        );
      }

      // A ready programme: its copy takes the catalogue row through the same
      // rule (doseAfterSwap), so the held swap and the copy agree too.
      const template = WORKOUT_TEMPLATES_V1.find((item) =>
        item.sessions.some((session) => session.exercises.some((exercise) => exercise.exerciseName === 'Back Squat')),
      );
      const session = template.sessions.find((item) => item.exercises.some((exercise) => exercise.exerciseName === 'Back Squat'));
      const squat = session.exercises.find((exercise) => exercise.exerciseName === 'Back Squat');
      for (const to of ['Plank', 'Bicycling, Stationary', 'Leg Press']) {
        const today = applySessionAdaptation(
          { ...template, sessions: [session] },
          withSessionSwap(EMPTY_SESSION_ADAPTATION, squat.slotId, to),
        ).sessions[0].exercises.find((exercise) => exercise.slotId === squat.slotId);
        const copied = doseAfterSwap(
          { trackingMode: squat.trackingMode, sets: squat.sets, repsMin: squat.repsMin, repsMax: squat.repsMax, supersetGroup: squat.supersetGroup ?? null },
          to,
        );
        assert.deepEqual([today.sets, today.repsMin, today.repsMax, today.trackingMode], [copied.sets, copied.repsMin, copied.repsMax, copied.trackingMode], to);
      }
      const plank = applySessionAdaptation({ ...template, sessions: [session] }, withSessionSwap(EMPTY_SESSION_ADAPTATION, squat.slotId, 'Plank'))
        .sessions[0].exercises.find((exercise) => exercise.slotId === squat.slotId);
      assert.equal(plank.trackingMode, 'hold');
      assert.ok(plank.repsMin >= 20, `${plank.repsMin}-${plank.repsMax} s`);

      // And the ready copy is built that way: the swapped row's sets and
      // numbers come from doseAfterSwap, not the catalogue row.
      const edit = read('src/app/useProgramExerciseEdit.tsx');
      const copy = edit.slice(edit.indexOf('const draft = buildDuplicatedCustomProgramDraft('));
      assert.match(copy, /const swapped =\s*target && edit\.kind === 'replace'\s*\?\s*doseAfterSwap\(\s*\{\s*trackingMode: exercise\.trackingMode,\s*sets: exercise\.sets,\s*repsMin: exercise\.repsMin,\s*repsMax: exercise\.repsMax,/);
      assert.match(copy, /: swapped\s*\?\s*\{ targetSets: swapped\.sets, repMin: swapped\.repsMin, repMax: swapped\.repsMax, restSeconds: null \}/);
    },
  },
  {
    name: 'swap hunt 10-07: a row swapped for today prints the dose the session opens on',
    run() {
      // The programme day: Back Squat 3 × 8 swapped for a plank read "3 × 8"
      // while the player opened on seconds.
      const template = WORKOUT_TEMPLATES_V1.find((item) =>
        item.sessions.some((session) => session.exercises.some((exercise) => exercise.exerciseName === 'Back Squat')),
      );
      const detail = buildCustomProgramDetail(template);
      const day = detail.sessions.find((session) => session.exercises.some((exercise) => exercise.name === 'Back Squat'));
      const squat = day.exercises.find((exercise) => exercise.name === 'Back Squat');
      const runtimeSession = template.sessions.find((session) => session.id === day.id);
      for (const to of ['Plank', 'Bicycling, Stationary']) {
        const shown = exerciseAfterSessionSwap(squat, to);
        const started = applySessionAdaptation(
          { ...template, sessions: [runtimeSession] },
          withSessionSwap(EMPTY_SESSION_ADAPTATION, squat.slotId, to),
        ).sessions[0].exercises.find((exercise) => exercise.slotId === squat.slotId);
        const range = started.repsMin === started.repsMax ? `${started.repsMin}` : `${started.repsMin}–${started.repsMax}`;
        const suffix = started.trackingMode === 'hold' ? ' s' : started.trackingMode === 'duration_minutes' ? ' min' : '';
        assert.equal(shown.prescription, `${started.sets} × ${range}${suffix}`, to);
        assert.equal(shown.sets, started.sets, to);
        assert.notEqual(shown.prescription, squat.prescription, to);
      }
      // No swap, no change.
      assert.deepEqual(exerciseAfterSessionSwap(squat, undefined), { sets: squat.sets, prescription: squat.prescription });
      // A plank (seconds) swapped for a dead bug reads repetitions.
      const plankDay = buildCustomProgramDetail(WORKOUT_TEMPLATES_V1.find((item) => item.id === 'tpl_2_day_minimal_full_body_v1'));
      const plank = plankDay.sessions.flatMap((session) => session.exercises).find((exercise) => exercise.name === 'Plank');
      assert.equal(plank.prescription, '4 × 20–40 s');
      assert.doesNotMatch(exerciseAfterSessionSwap(plank, 'Dead Bug').prescription, / s$/);

      // Home's row and its set count, and the day page's chips and count,
      // print the swapped dose.
      const home = read('src/screens/HomeScreen.tsx');
      assert.match(home, /const swappedDose = swappedName && exercise\.dose \? doseAfterSwap\(exercise\.dose, swappedName\) : null;/);
      assert.match(home, /\{dropped \? t\(language, 'home\.swapSheet\.droppedToday'\) : rowScheme\}/);
      assert.match(home, /swappedName && exercise\.dose \? doseAfterSwap\(exercise\.dose, swappedName\)\.sets : exercise\.targetSets \?\? 0/);
      const plan = read('src/app/useHomeActivePlan.ts');
      assert.match(plan, /dose: \{\s*trackingMode: activeRuntimeExercises\.get\(exercise\.id\)\?\.trackingMode \?\? 'reps_first',\s*sets: exercise\.targetSets,\s*repsMin: exercise\.repMin,\s*repsMax: exercise\.repMax,/);
      const dayScreen = read('src/screens/ProgramDayScreen.tsx');
      assert.match(dayScreen, /const shownDose = exerciseAfterSessionSwap\(exercise, exercise\.slotId \? sessionSwaps\[exercise\.slotId\] : null\);/);
      assert.equal((dayScreen.match(/\{shownDose\.prescription\}/g) ?? []).length, 2);
      assert.doesNotMatch(dayScreen, /\{exercise\.prescription\}/);
      assert.match(dayScreen, /sum \+ exerciseAfterSessionSwap\(exercise, exercise\.slotId \? sessionSwaps\[exercise\.slotId\] : null\)\.sets/);
    },
  },
  {
    name: "swap hunt 10-07: picking the programme's own lift back undoes today's swap, and keeping it is no edit",
    run() {
      const swapped = withSessionSwap(EMPTY_SESSION_ADAPTATION, 'slot1', 'Incline Dumbbell Press', 'Barbell Bench Press');
      assert.deepEqual(swapped.swaps, { slot1: 'Incline Dumbbell Press' });
      // Back to the bench, however it is cased: no swap held, no mark.
      const undone = withSessionSwap(swapped, 'slot1', ' barbell bench press ', 'Barbell Bench Press');
      assert.deepEqual(undone.swaps, {});
      assert.equal(hasSessionAdaptation(undone), false);
      // Another slot's swap is left alone.
      const two = withSessionSwap(swapped, 'slot2', 'Dip', 'Push-Up');
      assert.deepEqual(withSessionSwap(two, 'slot1', 'Barbell Bench Press', 'Barbell Bench Press').swaps, { slot2: 'Dip' });

      // "For ever" to the lift the row already holds writes nothing.
      const same = applyProgramSessionEdit(
        [{ id: 's1', name: 'Day', exercises: [storedRow('Barbell Bench Press', 3, 8, 8, null)] }],
        's1',
        { kind: 'replace', exerciseId: 'ex1', exerciseName: 'barbell bench press', libraryItemId: null },
      );
      assert.deepEqual(same, { kind: 'skip', reason: 'sameExercise' });

      // A ready programme answers the same before anything is copied: ahead
      // of the slot check and the copy.
      const edit = read('src/app/useProgramExerciseEdit.tsx');
      const run = edit.slice(edit.indexOf('async function runProgramExerciseEdit('));
      const guard = run.search(/if \(edit\.kind === 'replace'\) \{\s*const row = template\.sessions[\s\S]{0,200}?if \(!row \|\| isSameLiftName\(row\.exerciseName, edit\.exerciseName\)\) \{\s*return false;/);
      assert.ok(guard > 0, 'the ready path does not refuse X -> X');
      assert.ok(guard < run.indexOf('if (!programSlots.canCreate)'));
      assert.ok(guard < run.indexOf('buildDuplicatedCustomProgramDraft('));
    },
  },
  {
    name: "swap hunt 10-07: a cardio row's swap opens on cardio over every body part",
    run() {
      const popularOrder = getPopularExerciseLibraryOrder(library);
      const list = (current, filters) =>
        buildSwapPickerLibrary(library, {
          query: '',
          filters,
          language: 'fi',
          currentName: current.name,
          currentItem: current,
          excludeNames: [],
          popularOrder,
        });
      // The ready programmes' cardio rows, as the library places them.
      for (const name of ['Easy Run Blocks', 'Tempo Run Blocks', 'Stairmaster (Moderate)', 'Stationary Bike (Easy Pace)']) {
        const current = itemNamed(name);
        assert.equal(current.category, 'cardio', name);
        const bodyPart = effectiveSwapBodyPart(null, resolveSwapBrowsePrefilter(current), '');
        const category = effectiveSwapCategory(null, current, '');
        assert.deepEqual([bodyPart, category], ['all', 'cardio'], name);
        const opened = list(current, { category, bodyPart, equipment: 'all' });
        assert.ok(opened.length >= 10, `${name}: ${opened.length}`);
        assert.ok(opened.every((item) => exerciseTypeOf(item) === 'cardio'), name);
        // "Cardio" with a leg chip lists the machines for that muscle.
        const quads = list(current, { category: 'cardio', bodyPart: 'quadriceps', equipment: 'all' });
        assert.ok(quads.length > 0, `${name}: Cardio + quadriceps is empty`);
        assert.ok(quads.every((item) => item.category === 'cardio' && item.primaryMuscles.includes('quadriceps')), name);
      }
      // Typing searches everything; a chip the reader moved is theirs.
      const stair = itemNamed('Stairmaster');
      assert.equal(effectiveSwapCategory(null, stair, 'press'), 'all');
      assert.equal(effectiveSwapCategory('compound', stair, ''), 'compound');

      // A squat still opens on its muscle, and that chip still lists no machines.
      const squat = itemNamed('Barbell Full Squat');
      assert.equal(resolveSwapBrowsePrefilter(squat), 'quadriceps');
      assert.equal(effectiveSwapCategory(null, squat, ''), 'all');
      assert.equal(matchesBodyPartFilter(stair, 'quadriceps', 'all'), false);
      assert.equal(matchesBodyPartFilter(stair, 'quadriceps', 'cardio'), true);
      assert.equal(matchesBodyPartFilter(squat, 'quadriceps', 'cardio'), false);
    },
  },
];
