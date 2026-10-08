const assert = require('node:assert/strict');

const { WORKOUT_TEMPLATES_V1, WORKOUT_SUBSTITUTION_GROUPS } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { estimateProgrammeSessionMinutesList } = require('../../.test-dist/lib/programmeMinutes.js');

// Catalogue content found by the third persona sweep (2026-10-08). Each guard
// is scoped to the defect it came from: the catalogue is not balanced
// press-for-pull by design (a chest-focus or powerbuilding programme leans on
// purpose), so none of these is a catalogue-wide ratio.

const library = createSeedExerciseLibrary();
const libraryNames = library.map((item) => item.name);
const rowOf = (name) => {
  const index = findGuidedLibraryIndex(name, libraryNames);
  return index === null ? null : library[index];
};
const allExercises = (template) => template.sessions.flatMap((session) => session.exercises);
const template = (id) => {
  const found = WORKOUT_TEMPLATES_V1.find((item) => item.id === id);
  assert.ok(found, `template ${id} exists`);
  return found;
};
const sumSets = (exercises, test) => exercises.filter(test).reduce((sum, exercise) => sum + exercise.sets, 0);
const isPress = (exercise) => /press|push/.test(exercise.substitutionGroup) && !/leg press/i.test(exercise.exerciseName);
const isPull = (exercise) => /pull|row/.test(exercise.substitutionGroup) || /rear delt|face pull/i.test(exercise.exerciseName);

module.exports = [
  {
    // HOME Starter's second day had no pull at all: the week's only row sat on
    // Day 1, so the beginner who gets this plan for 12 weeks pressed twice as
    // often as she pulled, and Mountain Climbers closed a day for a reader
    // who is told to be careful with the lower back.
    name: 'catalogue content: a two-day full-body week pulls on both days, and a full-body week is not pull-light',
    run() {
      const starter = template('tpl_2_day_minimal_full_body_v1');
      for (const session of starter.sessions) {
        assert.ok(
          session.exercises.some((exercise) => /pull|row/.test(exercise.substitutionGroup)),
          `${session.id} has a pull`,
        );
      }
      assert.ok(!allExercises(starter).some((exercise) => exercise.exerciseName === 'Mountain Climbers'));

      // Every other full-body programme of two or more days keeps the pulls at
      // 0.65 of the presses or better. Prenatal care and 5x5 are programmes of
      // their own design (0.67 today); named so a new offender is a decision.
      const EXEMPT = new Set(['tpl_gainer_prenatal_fitness_v1', 'tpl_gainer_postpartum_recovery_v1', 'tpl_gainer_strength_5x5_v1']);
      const offenders = [];
      for (const item of WORKOUT_TEMPLATES_V1) {
        if (item.splitType !== 'full_body' || item.sessions.length < 2 || EXEMPT.has(item.id)) continue;
        const exercises = allExercises(item);
        const press = sumSets(exercises, isPress);
        const pull = sumSets(exercises, (exercise) => /pull|row/.test(exercise.substitutionGroup));
        if (press > 0 && pull < 0.65 * press) offenders.push(`${item.id}: ${pull} pull sets against ${press} press sets`);
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    // FIT Elite's Upper Volume day held 8 lifting sets against Upper Power's
    // 11, and the week pulled 7 sets to its 10 pressing sets. The conditioning
    // finishers are the programme's identity and stay.
    name: 'catalogue content: the elite trio pulls at 0.8 of its presses, and a Volume day is not lighter than its Power day',
    run() {
      const offenders = [];
      for (const id of ['tpl_strong_elite_v1', 'tpl_fit_elite_v1', 'tpl_shred_elite_v1']) {
        const exercises = allExercises(template(id));
        const press = sumSets(exercises, isPress);
        const pull = sumSets(exercises, isPull);
        // Strong Elite is a strength programme that presses on purpose and
        // stands at 0.73 today; the bar for it is its own level.
        const bar = id === 'tpl_strong_elite_v1' ? 0.7 : 0.8;
        if (pull < bar * press) offenders.push(`${id}: ${pull} pull sets against ${press} press sets`);
      }
      assert.deepEqual(offenders, []);

      const fit = template('tpl_fit_elite_v1');
      const lifting = (session) => sumSets(session.exercises, (exercise) => exercise.substitutionGroup !== 'conditioning_circuit' && exercise.substitutionGroup !== 'explosive_power');
      const upperA = fit.sessions.find((session) => session.id === 'fit_elite_upper_a');
      const upperB = fit.sessions.find((session) => session.id === 'fit_elite_upper_b');
      assert.ok(lifting(upperB) >= lifting(upperA), `Upper Volume lifts ${lifting(upperB)} sets, Upper Power ${lifting(upperA)}`);
    },
  },
  {
    // "Day 3: Upper (Pull)" of the dumbbell strength split pressed 8 sets and
    // rowed 5. A day that is named for a pull trains at least as many pull
    // sets as press sets, wherever it is in the catalogue.
    name: 'catalogue content: a session named Pull pulls at least as many sets as it presses',
    run() {
      const offenders = [];
      for (const item of WORKOUT_TEMPLATES_V1) {
        for (const session of item.sessions) {
          if (!/\bpull\b/i.test(session.name)) continue;
          const press = sumSets(session.exercises, isPress);
          const pull = sumSets(session.exercises, isPull);
          if (pull < press) offenders.push(`${item.id} / ${session.name}: ${pull} pull sets, ${press} press sets`);
        }
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    // The cable pullover is a lat lift. A hand-written alias sent it to the
    // dumbbell pullover (a chest row with a dumbbell demo) and its swap group
    // was the chest flies, so a pull day's lat accessory offered pec decks.
    name: 'catalogue content: the cable pullover is a cable lat lift, and swaps with lat work, not chest flies',
    run() {
      const row = rowOf('Cable Pullover');
      assert.ok(row, 'Cable Pullover resolves');
      assert.equal(row.equipment, 'cable');
      assert.ok(row.primaryMuscles.includes('lats'), `primary muscles ${row.primaryMuscles.join('/')}`);

      const groups = new Map(WORKOUT_SUBSTITUTION_GROUPS.map((group) => [group.id, group.allowedExerciseNames]));
      assert.ok(!groups.get('chest_fly').includes('Cable Pullover'), 'chest_fly no longer lists the pullover');
      assert.ok(groups.get('lat_isolation').includes('Cable Pullover'));
      assert.ok(groups.get('lat_isolation').includes('Straight-Arm Pulldown'));

      // Every row that still files under the group, in the catalogue, is a
      // fly: none of the pull days' lat accessories is left in chest_fly.
      for (const item of WORKOUT_TEMPLATES_V1) {
        for (const exercise of allExercises(item)) {
          if (exercise.exerciseName === 'Cable Pullover') {
            assert.equal(exercise.substitutionGroup, 'lat_isolation', `${item.id} / ${exercise.id}`);
          }
          if (exercise.substitutionGroup === 'chest_fly') {
            assert.ok(groups.get('chest_fly').includes(exercise.exerciseName), `${exercise.exerciseName} is a chest fly`);
          }
        }
      }
    },
  },
  {
    // The No Equipment programme's lunge opened a demo that begins "hold a
    // dumbbell in each hand". One entry, loaded or not, as on the Bulgarian
    // split squat.
    name: 'catalogue content: the reverse lunge demo works with and without dumbbells',
    run() {
      for (const name of ['Reverse Lunge', 'Bodyweight Reverse Lunge']) {
        const row = rowOf(name);
        assert.ok(row, name);
        assert.equal(row.name, 'Reverse Lunge', `${name} opens the app's own entry`);
        const steps = row.instructions.join(' ');
        assert.match(steps, /otherwise/, `${name}: the steps allow an unloaded lunge`);
        assert.notEqual(row.bodyPart, 'back', `${name} is not filed under the back`);
      }
    },
  },
  {
    // The beginner circuit day was 24 sets over six exercises against 16 and
    // 16 on its siblings: 55 minutes beside two days of 35 and 40. Only the
    // fat-burn HIIT programme is allowed beginner sessions that large.
    name: 'catalogue content: no beginner session outgrows its siblings or the 20-set mark, except fat-burn HIIT',
    run() {
      const offenders = [];
      for (const item of WORKOUT_TEMPLATES_V1) {
        if (item.level !== 'beginner' || item.id === 'tpl_gainer_fat_burn_hiit_v1') continue;
        for (const session of item.sessions) {
          const total = sumSets(session.exercises, () => true);
          if (total > 20) offenders.push(`${item.id} / ${session.id}: ${total} sets`);
        }
      }
      assert.deepEqual(offenders, []);

      const home = template('tpl_gainer_at_home_beginner_v1');
      for (const rest of ['min', 'max']) {
        const minutes = estimateProgrammeSessionMinutesList(home.sessions, { rest });
        assert.ok(Math.max(...minutes) - Math.min(...minutes) <= 10, `${rest}-rest days run ${minutes.join('/')} minutes`);
      }
    },
  },
];
