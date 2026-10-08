const assert = require('node:assert/strict');

const { classifySessionFocus } = require('../../.test-dist/lib/homeSessionHero');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');
const { Vinha_WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/gainerProgramCatalog');
const { localizeSessionName } = require('../../.test-dist/lib/sessionNameLabel');

const CATALOG_SESSIONS = [...WORKOUT_TEMPLATES_V1, ...Vinha_WORKOUT_TEMPLATES_V1].flatMap((template) =>
  template.sessions.map((session) => ({
    programName: template.name,
    sessionName: session.name,
    exerciseNames: session.exercises.map((exercise) => exercise.exerciseName),
  })),
);

/**
 * What the catalog's own English name says the session is.
 *
 * A session name is a fine oracle HERE, over static catalog data that no
 * translation touches. It is not a fine input at runtime — that confusion is
 * the bug this suite exists to prevent from coming back.
 *
 * Names carrying a separator ("Squat & Bench", "Full Body + HIIT") declare two
 * things at once and get no expectation.
 */
function focusFromCatalogName(name) {
  const normalized = name.toLowerCase();
  // "Squat & Bench", "Full Body + HIIT", "Full Body (Pull)" — a name that
  // declares two things, or declares the whole body and then an emphasis,
  // makes no single claim to check against.
  if (/[&+/]/.test(normalized) || normalized.includes('full body')) {
    return null;
  }
  if (/\bupper\b/.test(normalized)) {
    return 'upper';
  }
  if (/\bpush\b|\bbench day\b|\bchest\b/.test(normalized)) {
    return 'push';
  }
  if (/\bpull\b|\bback\b/.test(normalized)) {
    return 'pull';
  }
  if (/\blegs?\b|\blower\b|\bsquat day\b|\bdeadlift day\b|\bglute/.test(normalized)) {
    return 'lower';
  }
  return null;
}

module.exports = [
  {
    name: 'session focus is classified from exercises, not from the session name',
    run() {
      // The exact case the tester hit: a Finnish session name, leg exercises.
      // The old title classifier answered 'general' here and handed out the
      // generic warmup and a chest stretch after a leg day.
      assert.equal(
        classifySessionFocus(['Barbell Hip Thrust', 'Bulgarian Split Squat', 'Romanian Deadlift', 'Leg Press']),
        'lower',
      );
      assert.equal(classifySessionFocus(['Bench Press', 'Overhead Press', 'Triceps Pushdown']), 'push');
      assert.equal(classifySessionFocus(['Lat Pulldown', 'Seated Cable Row', 'Dumbbell Curl']), 'pull');
      // Both halves trained -> neither push nor pull owns the day.
      assert.equal(
        classifySessionFocus(['Bench Press', 'Lat Pulldown', 'Overhead Press', 'Seated Cable Row']),
        'upper',
      );
      // A genuinely mixed day is 'general', which is an answer and not a
      // fallback.
      assert.equal(
        classifySessionFocus(['Back Squat', 'Bench Press', 'Chest-Supported Row', 'Romanian Deadlift']),
        'general',
      );
      // Nothing to lift (mobility, yoga, runs) is its own kind: 'general' warms
      // up with push-ups and cools down on a chest stretch.
      assert.equal(classifySessionFocus(['Sun Salutation Flow', 'Breath Reset']), 'easy');
      assert.equal(classifySessionFocus([]), 'general');

      // A stretch is not the stimulus and gets no vote — whether the library
      // knows it ("Kneeling Hip Flexor" is filed under legs) or not ("Lying
      // Quad Stretch" reads as quad work to a name matcher). Counting them
      // turned a mobility session into a leg day that opened with squats.
      assert.equal(
        classifySessionFocus(['Kneeling Hip Flexor', 'Seated Floor Hamstring Stretch', "Child's Pose"]),
        'easy',
      );
      assert.equal(classifySessionFocus(['Lying Quad Stretch', 'Standing Forward Fold', 'Cobra Pose']), 'easy');
      // ...but the library files "Split Squats" and "Crossover Reverse Lunge"
      // as stretching, and those are what "Bulgarian Split Squat" and "Curtsy
      // Lunge" resolve to. The name overrules the category, or a leg day made
      // of them would have counted as no training at all.
      assert.equal(classifySessionFocus(['Bulgarian Split Squat', 'Curtsy Lunge', 'Leg Press']), 'lower');
      // The stretches at the end of a leg day do not change what it was.
      assert.equal(
        classifySessionFocus(['Back Squat', 'Leg Press', 'Romanian Deadlift', "Child's Pose"]),
        'lower',
      );
    },
  },
  {
    name: 'renaming or translating a session cannot change its warmup',
    run() {
      // Same exercises, three different names — including the Finnish name a
      // duplicated program actually stores. The classifier never sees the name,
      // so this must hold by construction; the test is here so that a future
      // "just pass the title, it is right there" cannot pass review.
      const exercises = ['Barbell Hip Thrust', 'Bulgarian Split Squat', 'Leg Press'];
      const expected = classifySessionFocus(exercises);
      assert.equal(expected, 'lower');

      for (const session of CATALOG_SESSIONS) {
        const localized = localizeSessionName(session.sessionName, 'fi');
        // The Finnish name is different text (that was the whole failure) but
        // the classification is computed from exercises either way.
        assert.equal(
          classifySessionFocus(session.exerciseNames),
          classifySessionFocus([...session.exerciseNames]),
          `${session.programName} / ${localized}`,
        );
      }
    },
  },
  {
    name: 'every catalog session that declares a focus is classified as that focus',
    run() {
      const mismatches = [];
      let covered = 0;

      for (const session of CATALOG_SESSIONS) {
        const declared = focusFromCatalogName(session.sessionName);
        if (!declared) {
          continue;
        }
        covered += 1;
        const actual = classifySessionFocus(session.exerciseNames);
        const label = `${session.programName} / ${session.sessionName}`;

        if (declared === 'upper') {
          // An upper day may be push-heavy or pull-heavy in content, and the
          // block should follow the content. What it must never be is a leg
          // warmup or the generic block.
          if (!['upper', 'push', 'pull'].includes(actual)) {
            mismatches.push(`${label}: upper-body session classified as "${actual}"`);
          }
          continue;
        }

        if (actual !== declared) {
          mismatches.push(`${label}: expected "${declared}", got "${actual}"`);
        }
      }

      assert.ok(covered > 100, `oracle covered only ${covered} sessions — did the catalog shrink?`);
      assert.deepEqual(mismatches, []);
    },
  },
  {
    name: 'the classifier can read most of the catalog, so general stays a minority',
    run() {
      // The failure this guards is silent by nature: when the classifier goes
      // blind, every session still gets a block, it is just the same block.
      // A rename or a library drift that blinds it shows up here as a jump in
      // the share of sessions with no readable focus.
      const general = CATALOG_SESSIONS.filter(
        (session) => classifySessionFocus(session.exerciseNames) === 'general',
      );
      const share = general.length / CATALOG_SESSIONS.length;

      assert.ok(
        share <= 0.3,
        `${general.length}/${CATALOG_SESSIONS.length} catalog sessions have no readable focus ` +
          `(${Math.round(share * 100)}%). Sample: ${general.slice(0, 5).map((s) => s.sessionName).join(', ')}`,
      );
    },
  },
];
