/**
 * Every ready programme, every session, every slot — read the way a coach and
 * a tester would read them (catalog audit, 2026-10-06).
 *
 * Each suite walks the whole catalog and lists offenders as
 * "programme / session / slot". A list that must be empty is asserted empty;
 * a list that holds known content gaps or coaching calls left to the user is
 * pinned exactly, so a new offender fails instead of joining it quietly.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const dist = (p) => require(path.join(__dirname, '..', '..', '.test-dist', p));
const { WORKOUT_TEMPLATES_V1 } = dist('features/workout/workoutCatalog.js');
const { RECOMMENDATION_PROGRAMS } = dist('lib/recommendationCatalog.js');
const { createSeedExerciseLibrary } = dist('data/seed.js');
const { findGuidedLibraryIndex, GUIDED_LIBRARY_ALIASES } = dist('lib/guidedPlayer.js');
const { isSpecialtyExercise } = dist('lib/exerciseClassification.js');
const { resolveProgramEquipment, resolveProgramEquipmentBucket } = dist('lib/programEquipment.js');
const { isHoldExerciseName } = dist('lib/holdExercises.js');
const { readyTemplateCardMinutes, estimateProgrammeSessionMinutesList } = dist('lib/programmeMinutes.js');
const { getReadyProgramBlockWeeks, READY_PROGRAM_MIN_BLOCK_WEEKS, READY_PROGRAM_MAX_BLOCK_WEEKS } = dist('lib/readyProgramDuration.js');

const LIBRARY = createSeedExerciseLibrary();
const LIBRARY_NAMES = LIBRARY.map((item) => item.name);
const LOWER_NAMES = LIBRARY_NAMES.map((name) => name.trim().toLowerCase());

const recommendationOf = (templateId) => RECOMMENDATION_PROGRAMS.find((entry) => entry.programId === templateId) ?? null;

function slots() {
  const out = [];
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      session.exercises.forEach((exercise, index) => out.push({ template, session, exercise, index }));
    }
  }
  return out;
}

const where = ({ template, session, exercise }) => `${template.id} / ${session.id} / ${exercise.id} (${exercise.exerciseName})`;

// The guided player's own matcher, minus its last resort. Exact name, the
// alias table, then the same two on the name without a coaching qualifier —
// never "the shortest library name that contains this one", which is how
// "Barbell Bench Press" opened the decline bench and "Leg Curl" the
// stability-ball curl.
const PRESCRIPTION_QUALIFIER = /\d|each (side|leg|arm)|per side/i;
function exactOrAlias(lower) {
  const exact = LOWER_NAMES.indexOf(lower);
  if (exact >= 0) return exact;
  const alias = GUIDED_LIBRARY_ALIASES[lower];
  const aliasIndex = alias ? LOWER_NAMES.indexOf(alias) : -1;
  return aliasIndex >= 0 ? aliasIndex : null;
}
function resolveWithoutGuessing(name) {
  const lower = name.trim().toLowerCase();
  const direct = exactOrAlias(lower);
  if (direct !== null) return direct;
  const match = lower.match(/^(.*?)\s*\(([^)]*)\)$/);
  if (!match || PRESCRIPTION_QUALIFIER.test(match[2])) return null;
  return exactOrAlias(match[1].trim());
}

// ── movement families, read off the swap pools ─────────────────────────────
const UPPER = new Set(['horizontal_press', 'horizontal_pull', 'vertical_press', 'vertical_pull', 'accessory_arms', 'accessory_delts', 'bodyweight_press', 'bodyweight_pull', 'chest_fly', 'barbell_curl', 'overhead_triceps', 'triceps_cable', 'forearms', 'cable_machine_row']);
const LOWER = new Set(['squat_pattern', 'hinge_pattern', 'single_leg', 'accessory_hamstrings', 'calves', 'bodyweight_squat_pattern', 'bodyweight_hinge', 'deadlift_pattern', 'glute_isolation', 'hip_thrust_bridge']);
const setsIn = (exercises, groups) => exercises.filter((exercise) => groups.has(exercise.substitutionGroup)).reduce((sum, exercise) => sum + exercise.sets, 0);

function sessionShape(session) {
  const upper = setsIn(session.exercises, UPPER);
  const lower = setsIn(session.exercises, LOWER);
  if (upper + lower === 0) return 'none';
  const share = upper / (upper + lower);
  if (share >= 2 / 3) return 'upper';
  if (share <= 1 / 3) return 'lower';
  return 'full';
}

module.exports = [
  {
    name: 'ready programme audit: no programme prescribes a specialty (strongman) movement',
    run() {
      // "Missään ohjelmassa ei saa olla erikoisliikkeitä" (user, 2026-10-06).
      // Asked of the prescribed name and of the library row the player opens
      // for it, so an alias cannot smuggle a yoke walk in under another name.
      const offenders = slots()
        .filter(({ exercise }) => {
          const index = findGuidedLibraryIndex(exercise.exerciseName, LIBRARY_NAMES);
          return isSpecialtyExercise({ name: exercise.exerciseName }) || (index !== null && isSpecialtyExercise(LIBRARY[index]));
        })
        .map(where);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: every slot opens its own lift, never the nearest name that contains it',
    run() {
      // Containment is the guided player's last resort. It placed 180 slots of
      // the ready programmes, and about half of them on another lift: a
      // decline bench for "Barbell Bench Press", a stability-ball curl for
      // "Leg Curl", a push-up for "Side Plank", a sled for "Overhead Triceps
      // Extension" and a box squat for a no-equipment "Squat".
      const offenders = slots()
        .filter(({ exercise }) => findGuidedLibraryIndex(exercise.exerciseName, LIBRARY_NAMES) !== null && resolveWithoutGuessing(exercise.exerciseName) === null)
        .map((slot) => `${where(slot)} -> ${LIBRARY_NAMES[findGuidedLibraryIndex(slot.exercise.exerciseName, LIBRARY_NAMES)]}`);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: every name the programmes prescribe has a library row, reached by its own name or an alias',
    run() {
      // Until 2026-10-06 this pinned 79 names with no row at all: the bird
      // dog, the hollow hold, the yoga poses, the run blocks. "Tehdään kaikki
      // 79" (user): each got a row of its own in extraExerciseLibrary, with
      // steps in both languages, or an alias to the row that is the same
      // movement with the same equipment. The list stays empty.
      const unresolved = [...new Set(slots().map(({ exercise }) => exercise.exerciseName))]
        .filter((name) => findGuidedLibraryIndex(name, LIBRARY_NAMES) === null)
        .sort();
      assert.deepEqual(unresolved, []);
      // And every slot gets there without the containment guess.
      const guessed = slots().filter(({ exercise }) => resolveWithoutGuessing(exercise.exerciseName) === null).map(where);
      assert.deepEqual(guessed, []);
    },
  },
  {
    name: 'ready programme audit: a lift that opens steps but no photo opens one of the app\'s own extras',
    run() {
      // extraExerciseLibrary rows carry their own instructions and no image by
      // design (the user photographs them later); the player shows the
      // initials panel for them. A generated row reached without a photo
      // would be a prescribed lift that lost its photo unnoticed.
      const reached = [...new Set(
        slots()
          .map(({ exercise }) => findGuidedLibraryIndex(exercise.exerciseName, LIBRARY_NAMES))
          .filter((index) => index !== null),
      )].map((index) => LIBRARY[index]);
      const photolessGenerated = reached
        .filter((item) => !item.imageKey && !item.id.startsWith('extra_'))
        .map((item) => item.name);
      assert.deepEqual(photolessGenerated, []);
      // Every extra the library carries is one a programme prescribes, except
      // the ones that exist for swaps and fallbacks (Landmine Press is the
      // careful-shoulders swap for an overhead press; the walk and bike blocks
      // stand in for a run block when the knees or ankles are avoided).
      const reachedIds = new Set(reached.map((item) => item.id));
      const unprescribedExtras = LIBRARY.filter((item) => item.id.startsWith('extra_') && !reachedIds.has(item.id)).map((item) => item.name).sort();
      assert.deepEqual(unprescribedExtras, [
        'Band Curl',
        'Brisk Walk Blocks',
        'Incline Walk Blocks',
        'Landmine Press',
        'Machine Hip Thrust',
        'Stationary Bike Blocks',
      ]);
    },
  },
  {
    name: 'ready programme audit: no session lists the same lift twice, and two names for one row are a deliberate variation',
    run() {
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          const byName = new Map();
          const byRow = new Map();
          for (const exercise of session.exercises) {
            const name = exercise.exerciseName.trim().toLowerCase();
            if (byName.has(name)) offenders.push(`${template.id} / ${session.id}: ${exercise.exerciseName} twice`);
            byName.set(name, exercise);
            const index = findGuidedLibraryIndex(exercise.exerciseName, LIBRARY_NAMES);
            if (index === null) continue;
            const other = byRow.get(index);
            // A paused squat or bench beside the competition lift is the
            // variation powerlifting programmes are built on.
            if (other && other.exerciseName !== exercise.exerciseName && !/\bpaus/i.test(`${other.exerciseName} ${exercise.exerciseName}`)) {
              offenders.push(`${template.id} / ${session.id}: ${other.exerciseName} and ${exercise.exerciseName} are one row`);
            }
            byRow.set(index, exercise);
          }
        }
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: holds are prescribed in seconds and lifts in reps, with sane sets, reps and rest',
    run() {
      const offenders = [];
      for (const slot of slots()) {
        const { exercise: e } = slot;
        const hold = isHoldExerciseName(e.exerciseName);
        if (hold !== (e.trackingMode === 'hold')) offenders.push(`${where(slot)}: hold=${hold} but ${e.trackingMode}`);
        if (e.trackingMode === 'hold' && (e.repsMax < 10 || e.repsMax > 300)) offenders.push(`${where(slot)}: ${e.repsMax} s`);
        if (e.repsMin > e.repsMax || e.restSecondsMin > e.restSecondsMax) offenders.push(`${where(slot)}: range upside down`);
        if (e.sets < 1 || e.sets > 10) offenders.push(`${where(slot)}: ${e.sets} sets`);
        if (e.restSecondsMin < 0 || e.restSecondsMax > 330) offenders.push(`${where(slot)}: rest ${e.restSecondsMin}-${e.restSecondsMax}`);
        // A loaded set of six or fewer is a strength set; it gets the rest one needs.
        if (e.trackingMode === 'load_and_reps' && e.repsMax <= 6 && e.restSecondsMin < 90) offenders.push(`${where(slot)}: ${e.repsMax} reps on ${e.restSecondsMin} s`);
        // An interval rests like one.
        if (/hiit|\(\d+s/i.test(e.exerciseName) && e.restSecondsMin > 60) offenders.push(`${where(slot)}: interval rest ${e.restSecondsMin}`);
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: a strength programme is built on heavy sets, and every goal tag is one the recommender serves',
    run() {
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        const primaries = template.sessions.flatMap((session) =>
          session.exercises.filter((e) => e.role === 'primary' && (e.trackingMode === 'load_and_reps' || e.trackingMode === 'bodyweight')),
        );
        const heavy = primaries.filter((e) => e.repsMax <= 6);
        // "Postpartum Recovery" was filed under Strength (the generator read
        // "strong" in its sheet), so the Strength shelf offered breathing,
        // Kegels and a light goblet squat, none of it below twelve reps.
        if (template.goalType === 'strength' && heavy.length * 2 < primaries.length) {
          offenders.push(`${template.id}: strength with ${heavy.length}/${primaries.length} heavy anchors`);
        }
        const recommendation = recommendationOf(template.id);
        if (!recommendation) continue;
        const goals = recommendation.supportedGoals;
        const served = template.goalType === 'strength'
          ? goals.includes('strength')
          : template.goalType === 'hypertrophy'
            ? goals.includes('muscle')
            : goals.some((goal) => goal !== 'strength' && goal !== 'muscle');
        // Joint-Friendly Strength wore the muscle tag while the recommender
        // offers it for general fitness only.
        if (!served) offenders.push(`${template.id}: ${template.goalType} but recommended for ${goals.join(', ')}`);
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: the split tag says what the sessions are',
    run() {
      // The card prints the split ("Full body", "Upper/lower"). Glute
      // Foundations has no upper-body lift in any session and said full body;
      // Bro Split is one muscle group a day and said upper/lower.
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        const shapes = template.sessions.map(sessionShape);
        const lifting = template.sessions.filter((_, index) => shapes[index] !== 'none');
        if (template.splitType === 'full_body') {
          const full = lifting.filter((session) => setsIn(session.exercises, UPPER) > 0 && setsIn(session.exercises, LOWER) > 0);
          if (full.length * 2 <= lifting.length) offenders.push(`${template.id}: full_body, ${full.length}/${lifting.length} sessions train both halves (${shapes.join(' ')})`);
        }
        if (template.splitType === 'upper_lower') {
          const named = (session, index) => shapes[index] === 'upper' || shapes[index] === 'lower' || /full body/i.test(session.name);
          const upper = shapes.filter((shape) => shape === 'upper').length;
          const lower = shapes.filter((shape) => shape === 'lower').length;
          if (!template.sessions.every(named) || upper * 3 < template.sessions.length || lower * 3 < template.sessions.length) {
            offenders.push(`${template.id}: upper_lower but ${shapes.join(' ')}`);
          }
        }
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: every focus area a programme is recommended for gets six working sets a week',
    run() {
      const AREA = {
        chest: ['horizontal_press', 'chest_fly', 'bodyweight_press'],
        back: ['horizontal_pull', 'vertical_pull', 'bodyweight_pull', 'cable_machine_row'],
        shoulders: ['vertical_press', 'accessory_delts', 'calisthenics_skills'],
        arms: ['accessory_arms', 'barbell_curl', 'overhead_triceps', 'triceps_cable', 'forearms'],
        core: ['accessory_core', 'bodyweight_core', 'plank_variations', 'core_activation', 'calisthenics_skills'],
        quads: ['squat_pattern', 'single_leg', 'bodyweight_squat_pattern'],
        glutes: ['hip_thrust_bridge', 'glute_isolation', 'hinge_pattern', 'bodyweight_hinge', 'single_leg'],
        hamstrings: ['hinge_pattern', 'deadlift_pattern', 'accessory_hamstrings', 'bodyweight_hinge'],
        calves: ['calves'],
        legs: ['squat_pattern', 'single_leg', 'bodyweight_squat_pattern', 'hinge_pattern', 'deadlift_pattern', 'accessory_hamstrings', 'hip_thrust_bridge', 'bodyweight_hinge'],
        mobility: ['mobility_flow', 'yoga_flow', 'spine_mobility', 'hip_mobility', 'shoulder_mobility'],
        conditioning: ['cardio_intervals', 'steady_cardio', 'conditioning_circuit', 'running_blocks', 'jump_plyo', 'explosive_power', 'agility_drills'],
      };
      // A promised focus area gets at least six working sets a week (user,
      // 2026-10-06). One exercise of it is not a focus: POWERBUILD promised
      // arms on four sets of pushdowns and curls, FIT Elite core on three
      // planks. Where a session had room under the card's minutes the sets
      // went in; where it had none, the tag went (STRONG Starter chest, FIT
      // Elite core, Calisthenics Mastery arms).
      const MIN_WEEKLY_SETS = 6;
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        const recommendation = recommendationOf(template.id);
        if (!recommendation) continue;
        const exercises = template.sessions.flatMap((session) => session.exercises);
        for (const area of recommendation.focusAreaTags) {
          if (area === 'bodyweight') {
            const gear = resolveProgramEquipment(exercises.map((e) => e.exerciseName)).filter((chip) => chip !== 'Pull-up bar' && chip !== 'Yoga mat');
            if (gear.length > 0) offenders.push(`${template.id}: bodyweight, needs ${gear.join(', ')}`);
            continue;
          }
          // A pike push-up is a shoulder press with the floor for a bar.
          const sets = exercises
            .filter((e) => AREA[area].includes(e.substitutionGroup) || (area === 'shoulders' && /pike push-up/i.test(e.exerciseName)))
            .reduce((sum, e) => sum + e.sets, 0);
          if (sets === 0) offenders.push(`${template.id}: tagged ${area}, trains none`);
          else if (sets < MIN_WEEKLY_SETS) offenders.push(`${template.id}: tagged ${area}, ${sets} sets a week`);
        }
      }
      // Mobility Flow was tagged conditioning, Joint-Friendly Strength core;
      // neither has a single exercise of either.
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: the metadata agrees with the content (days, block, gear, level, gender)',
    run() {
      const LEVEL = { beginner: 'beginner', intermediate: 'advanced', advanced: 'pro' };
      const HOME_GEAR = new Set(['Dumbbells', 'Kettlebells', 'Resistance bands', 'Yoga mat', 'Pull-up bar']);
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        if (template.daysPerWeek !== template.sessions.length) offenders.push(`${template.id}: ${template.daysPerWeek} days, ${template.sessions.length} sessions`);
        const weeks = getReadyProgramBlockWeeks(template);
        if (weeks < READY_PROGRAM_MIN_BLOCK_WEEKS || weeks > READY_PROGRAM_MAX_BLOCK_WEEKS) offenders.push(`${template.id}: ${weeks}-week block`);
        const names = template.sessions.flatMap((session) => session.exercises.map((e) => e.exerciseName));
        const gear = resolveProgramEquipment(names);
        if (/home|no equipment|bodyweight|calisthenics/i.test(template.name) && !gear.every((chip) => HOME_GEAR.has(chip))) {
          offenders.push(`${template.id}: "${template.name}" needs ${gear.join(', ')}`);
        }
        if (/dumbbell/i.test(template.name) && !gear.every((chip) => chip === 'Dumbbells' || chip === 'Yoga mat')) offenders.push(`${template.id}: dumbbell programme needs ${gear.join(', ')}`);
        if (/no equipment|bodyweight/i.test(template.name) && !gear.every((chip) => chip === 'Pull-up bar')) offenders.push(`${template.id}: bodyweight programme needs ${gear.join(', ')}`);
        const recommendation = recommendationOf(template.id);
        if (!recommendation) continue;
        if (recommendation.equipmentTier !== resolveProgramEquipmentBucket(names)) offenders.push(`${template.id}: tier ${recommendation.equipmentTier}, content ${resolveProgramEquipmentBucket(names)}`);
        if (!recommendation.supportedLevels.includes(LEVEL[template.level])) offenders.push(`${template.id}: ${template.level} not offered at ${LEVEL[template.level]}`);
        const named = /female|woman|women/i.test(template.name) ? 'female' : /\b(man|male|men)\b/i.test(template.name) ? 'male' : null;
        if (named && recommendation.targetGender !== named) offenders.push(`${template.id}: named ${named}, targets ${recommendation.targetGender}`);
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: advanced-only skills stay out of beginner programmes, elite skills out of intermediate ones',
    run() {
      const ADVANCED_ONLY = /power clean|snatch|\bjerk\b|clean and|depth jump|muscle-up|planche|front lever|handstand|dragon flag|pistol|shrimp squat|l-sit|toes-to-bar|nordic|deficit deadlift|weighted (pull-up|dips)|competition|pause squat|paused bench/i;
      const ELITE = /power clean|snatch|\bjerk\b|muscle-up|planche hold|front lever|handstand|dragon flag|l-sit|pistol|shrimp squat/i;
      const offenders = slots()
        .filter(({ template, exercise }) => (template.level === 'beginner' && ADVANCED_ONLY.test(exercise.exerciseName)) || (template.level === 'intermediate' && ELITE.test(exercise.exerciseName)))
        .map(where);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: a beginner programme starts on beginner-friendly movements, never one it needs a regression of',
    run() {
      // "Aloittelijaohjelmissa aloittelijaystävällisiä liikkeitä" (user,
      // 2026-10-06). Not the skills above, but movements a first-timer should
      // reach by way of an easier one of the same pattern: the front-rack
      // squat after the goblet squat, the renegade row after the row and the
      // plank, single-leg and box landings after two-footed ones, the push-up
      // burpee after the burpee, the pike after the plank. STRONG and Fat Burn
      // HIIT had five of them; each was swapped for its regression.
      const NOT_A_FIRST_MOVEMENT = new RegExp([
        'front squat', 'overhead squat', 'zercher', 'good morning', 'push press', '\\bclean\\b', 'kipping',
        'renegade row', 'plank to pike', 'burpee with push-up', 'archer', 'one-arm', 'sissy squat', 'nordic',
        'box jump', 'depth jump', 'skater jump', 'lateral bound', '\\(jumping\\)', 'pogo', 'tuck jump', 'single-leg (hop|jump)',
      ].join('|'), 'i');
      const offenders = slots()
        .filter(({ template, exercise }) => template.level === 'beginner' && NOT_A_FIRST_MOVEMENT.test(exercise.exerciseName))
        .map(where);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: weekly push/pull balance stays within 2:1 and squat/hinge within 2.5:1, bar the 5x5\'s one deadlift',
    run() {
      const PUSH = new Set(['horizontal_press', 'vertical_press', 'bodyweight_press']);
      const PULL = new Set(['horizontal_pull', 'vertical_pull', 'bodyweight_pull', 'cable_machine_row']);
      const QUAD = new Set(['squat_pattern', 'single_leg', 'bodyweight_squat_pattern']);
      const HINGE = new Set(['hinge_pattern', 'deadlift_pattern', 'bodyweight_hinge', 'hip_thrust_bridge', 'accessory_hamstrings']);
      const count = (exercises, groups, extra) => exercises
        .filter((e) => groups.has(e.substitutionGroup) || extra.test(e.exerciseName))
        .reduce((sum, e) => sum + e.sets, 0);
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        // A single-muscle programme is unbalanced on purpose.
        if (template.id.startsWith('tpl_focus_')) continue;
        const exercises = template.sessions.flatMap((session) => session.exercises);
        const push = count(exercises, PUSH, /\bdips?\b|planche push/i);
        const pull = count(exercises, PULL, /renegade row/i);
        const quad = count(exercises, QUAD, /^$/);
        const hinge = count(exercises, HINGE, /kettlebell swing/i);
        // Twelve sets a week is where a ratio starts to mean something: a
        // mobility week's one Cossack squat is not a squat bias.
        const lopsided = (a, b, ratio) => a + b >= 12 && (a > ratio * b || b > ratio * a);
        // Pressing outran pulling 3:1 to 4:1 in the no-equipment, HIIT and
        // athletic weeks, which pulled with one table row or a renegade row
        // and pushed with every push-up variation ("lisätään vetoliikkeitä",
        // user 2026-10-06). Rows were added and push variations traded for
        // them, and the bound came down from 2.5:1 to 2:1 so the dumbbell and
        // bodyweight upper/lower and PPL weeks (2.1–2.4:1) came along.
        if (lopsided(push, pull, 2)) offenders.push(`${template.id}: push ${push} / pull ${pull}`);
        // Squat/hinge keeps 2.5:1: the glute specialisations hinge twice as
        // much as they squat on purpose.
        if (lopsided(quad, hinge, 2.5)) offenders.push(`${template.id}: squat ${quad} / hinge ${hinge}`);
      }
      // The 5x5 is Starting Strength's single deadlift after three days of
      // squats, by design; adding hinge work would make it another programme.
      assert.deepEqual(offenders.sort(), [
        'tpl_gainer_strength_5x5_v1: squat 15 / hinge 1',
      ]);
    },
  },
  {
    name: 'ready programme audit: a split built to rest a half never trains it three days running',
    run() {
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        // Three days a week leave a rest day between any two of them.
        if (template.daysPerWeek < 4) continue;
        const shapes = template.sessions.map(sessionShape);
        for (let index = 2; index < shapes.length; index += 1) {
          const run = shapes.slice(index - 2, index + 1);
          if (run.every((shape) => shape === run[0]) && (run[0] === 'upper' || run[0] === 'lower')) {
            offenders.push(`${template.id}: ${template.sessions.slice(index - 2, index + 1).map((session) => session.id).join(' > ')}`);
          }
        }
      }
      // Advanced Glutes ran heavy glutes, upper, then three lower days in a
      // row; its four lower days in five now go two, upper, two — heavy then
      // light either side ("voi muuttaa järjestystä", user 2026-10-06).
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programme audit: a reader part-way through Advanced Glutes keeps their next session through the reorder',
    run() {
      // A plan stores its week as entries that name each session BY ID, in
      // the order the programme had on the day it was adopted, and the
      // rotation offers the entry after the last one logged. So the reorder
      // keeps every id: a plan adopted on the old order resolves every day
      // and goes on in the order it already had — no session skipped, none
      // twice. Only a new adoption takes the new order.
      const { buildProgramWorkoutPlan, buildReadyProgramPlanId } = dist('lib/programAdoption.js');
      const { resolveNextPlanEntryIndex } = dist('lib/planRotation.js');
      const id = 'tpl_gainer_advanced_glutes_v1';
      const template = WORKOUT_TEMPLATES_V1.find((candidate) => candidate.id === id);
      const OLD_ORDER = ['heavy_glutes_strength', 'upper_body_sculpt', 'glute_volume_pump', 'quads_hamstrings', 'glute_finisher'];
      const ids = template.sessions.map((session) => session.id);
      assert.deepEqual([...ids].sort(), [...OLD_ORDER].sort());
      assert.deepEqual(template.sessions.map((session) => session.orderIndex), ids.map((_, index) => index + 1));

      const plan = buildProgramWorkoutPlan({
        planId: buildReadyProgramPlanId(id),
        workoutTemplateId: id,
        programName: template.name,
        sessionIds: OLD_ORDER,
        dayLabels: ['mon', 'tue', 'wed', 'thu', 'fri'],
        now: '2026-09-28T08:00:00.000Z',
      });
      OLD_ORDER.forEach((lastLogged, index) => {
        const completed = [{ workoutTemplateId: id, workoutTemplateSessionId: lastLogged, performedAt: `2026-10-0${index + 1}T17:00:00.000Z` }];
        const next = plan.entries[resolveNextPlanEntryIndex(plan.entries, completed)].workoutTemplateSessionId;
        assert.equal(next, OLD_ORDER[(index + 1) % OLD_ORDER.length], `after ${lastLogged}`);
        assert.ok(ids.includes(next), `${next} is still a session of the programme`);
      });
    },
  },
  {
    name: 'ready programme audit: no session runs far from the minutes its card quotes, and an express programme is short',
    run() {
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        const card = readyTemplateCardMinutes(template);
        const sessions = estimateProgrammeSessionMinutesList(template.sessions);
        sessions.forEach((minutes, index) => {
          if (Math.abs(minutes - card) > 20) offenders.push(`${template.id} / ${template.sessions[index].id}: ${minutes} min, card ${card}`);
        });
        const recommendation = recommendationOf(template.id);
        if (recommendation?.styleTags.includes('express') && card > 45) offenders.push(`${template.id}: express at ${card} min`);
      }
      assert.deepEqual(offenders, []);
    },
  },
];
