import { ExerciseLibraryItem } from '../types/models';

/**
 * Exercises the upstream database does not carry, but real gyms do.
 *
 * `generatedExerciseLibrary.ts` is rewritten wholesale by `npm run
 * exercise:sync`, so nothing added there survives. This file is the layer that
 * does — the same arrangement as `EXERCISE_NAME_FI` in exerciseNameLabel.ts and
 * the Finnish steps in exerciseInstructions.ts.
 *
 * The bar for adding one is a reader who looked for it and did not find it, not
 * a gap in a list. An entry here has no photo, and a row without a photo is
 * worse than one with — so it earns its place by being a machine or a variation
 * people actually train, and it is written with its own instructions rather
 * than pointed at a near neighbour whose steps describe different equipment.
 */
export const EXTRA_EXERCISE_LIBRARY: ExerciseLibraryItem[] = [
  {
    // The hip thrust machine. The swap list under "Lantionnosto tangolla"
    // offered the banded, bodyweight and single-leg versions but not the one
    // sitting in the gym (user 2026-08-26).
    //
    // Not an alias to Barbell Hip Thrust: the position is the same, but the
    // barbell entry's steps are three sentences about rolling a loaded bar
    // over your hips and padding it — instructions for equipment this reader
    // is deliberately not using.
    id: 'extra_machine_hip_thrust',
    name: 'Machine Hip Thrust',
    category: 'compound',
    bodyPart: 'glutes',
    equipment: 'machine',
    primaryMuscles: ['glutes'],
    secondaryMuscles: ['hamstrings'],
    instructions: [
      'Sit into the machine with your back against the pad and the lap belt or bar across your hips, just below the hip bones.',
      'Set the seat so your shins are vertical at the top of the movement, and drive through your heels to extend your hips.',
      'Squeeze the glutes at the top without arching your lower back, then lower under control until the weight is almost resting.',
    ],
  },
  {
    // The two-handed swing. Four ready programmes prescribe "Kettlebell Swing"
    // and the only thing upstream carries is "One-Arm Kettlebell Swings" —
    // which the matcher reached, and which ships with an EMPTY instruction
    // list. So the reader was sent to a one-arm variation and then shown
    // nothing at all about how to do it.
    //
    // Not an alias: one arm and two is a different hinge, a different load
    // path and a different rep count, and the programmes ask for twenty.
    id: 'extra_kettlebell_swing',
    name: 'Kettlebell Swing',
    category: 'compound',
    bodyPart: 'full body',
    // The upstream library maps all 45 of its kettlebell movements to
    // 'dumbbell' and keeps "kettlebells" in sourceEquipment; the enum has no
    // kettlebell. Matching that keeps the equipment filter honest.
    equipment: 'dumbbell',
    sourceEquipment: 'kettlebells',
    primaryMuscles: ['glutes', 'hamstrings'],
    secondaryMuscles: ['lower back', 'shoulders'],
    instructions: [
      'Stand with the kettlebell on the floor about a foot in front of you, feet a little wider than your hips. Hinge at the hips with a flat back and take the handle with both hands.',
      'Hike the bell back between your legs, then snap the hips forward to swing it up. The arms only steer — the hips do the work, and the bell floats to chest height on its own.',
      'Let it fall back between the legs as the hips hinge again, and go straight into the next rep. The back stays flat from the first rep to the last.',
    ],
  },
  {
    // Prescribed by three ready programmes and absent from the library
    // entirely, so it resolved to nothing: no photo, no steps, no swap list.
    // The upstream database has burpee variations under other names but no
    // plain burpee, which is the one the programmes actually ask for.
    id: 'extra_burpee',
    name: 'Burpee',
    category: 'compound',
    bodyPart: 'full body',
    equipment: 'bodyweight',
    primaryMuscles: ['quadriceps', 'chest'],
    secondaryMuscles: ['shoulders', 'abdominals'],
    instructions: [
      'From standing, drop into a squat and plant both hands on the floor just outside your feet.',
      'Jump or step the feet back into a push-up position, lower the chest to the floor, then press back up.',
      'Jump the feet back under you and stand up into a jump with the arms overhead. Land soft and go straight into the next rep.',
    ],
  },
  {
    // The curl a resistance band gives. A bands-only reader's arm work had no
    // curl to land on: a hammer curl needs dumbbells, and the fallback chain
    // ended in a plate curl with no plate, so the lift was simply dropped
    // (2026-09-26). No band biceps curl exists upstream.
    //
    // Filed under bodyweight, as the library files every band movement ("Band
    // Pull Apart"): the app has no band equipment class, and a band has no
    // kilograms to log — reps only.
    id: 'extra_band_curl',
    name: 'Band Curl',
    category: 'compound',
    bodyPart: 'biceps',
    equipment: 'bodyweight',
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    instructions: [
      'Stand on the middle of the band with your feet about hip-width apart and hold an end in each hand, arms straight and palms facing forward.',
      'Keep your elbows close to your sides and curl your hands up towards your shoulders, squeezing the biceps at the top.',
      'Lower slowly against the band until your arms are straight again. Stand further apart on the band for more resistance, closer for less.',
    ],
  },
  {
    // The calf raise that needs nothing. The "seated calf raise" fallback and
    // the bodyweight calves pool pointed at "Donkey Calf Raises", whose own
    // steps open with "you will need access to a donkey calf raise machine" -
    // a reader without Machines was handed a machine (bug hunt, 2026-10-04).
    // Upstream carries no floor-level calf raise.
    id: 'extra_bodyweight_calf_raise',
    name: 'Bodyweight Calf Raise',
    category: 'isolation',
    bodyPart: 'legs',
    equipment: 'bodyweight',
    primaryMuscles: ['calves'],
    secondaryMuscles: [],
    instructions: [
      'Stand tall with your feet hip-width apart, toes pointing forward. Hold a wall or a rail for balance if you need it.',
      'Rise onto the balls of your feet as high as you can, keeping your knees straight but not locked, and pause for a second at the top.',
      'Lower your heels slowly until they are level with the floor, or a little below if you stand on a step, and go straight into the next rep.',
    ],
  },
];
