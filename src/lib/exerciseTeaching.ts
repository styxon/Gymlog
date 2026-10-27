import { SetupCautionArea } from '../types/models';
import { AppLanguage } from '../types/models';

/**
 * What the app can TEACH about a lift, as opposed to what it can list.
 *
 * `exerciseInstructions.ts` carries the steps: do this, then this, then this.
 * Steps tell you the order and nothing else — they cannot tell you which three
 * things matter, what people get wrong, where the work should be felt, or what
 * to reach for when the lift is not the one for you today. That is a different
 * kind of writing and it lives here.
 *
 * COVERAGE. Deliberately small and deliberately grown (user decision,
 * 2026-08-31): the lifts people actually meet first, then outward. A lift with
 * nothing written here still opens — it shows the library's own steps, the
 * same fallback the instruction layer uses. An empty teaching section is never
 * rendered, so the screen is shorter rather than emptier.
 *
 * KEYED BY THE ENGLISH LIBRARY NAME, like every other overlay in this app
 * (`EXERCISE_NAME_FI`, `EXERCISE_INSTRUCTIONS_FI`), because that name is the
 * id everywhere else and it survives `npm run exercise:sync`.
 */

interface ExerciseTeachingMistake {
  /** What people do. Named as the reader would recognise it, not as a rule. */
  mistake: string;
  /** What to do instead. A mistake without a fix is a scolding. */
  fix: string;
}

interface ExerciseTeachingSwap {
  direction: 'easier' | 'harder';
  /** The library name, so the row can open that lift's own screen. */
  exerciseName: string;
  /** Why it is easier or harder — the reason is the useful half. */
  why: string;
}

/**
 * A warning that only some readers should see.
 *
 * Shown when the reader flagged this body area in onboarding, and not
 * otherwise: a caution on every screen is furniture, and furniture with an
 * alarm on it is what the day-count warning was before it was removed.
 */
interface ExerciseTeachingCaution {
  area: SetupCautionArea;
  text: string;
}

interface ExerciseTeaching {
  /** Three. Five would be the steps again, and the steps are already there. */
  cues: string[];
  mistakes: ExerciseTeachingMistake[];
  /** Where the work belongs — and, always, that effort is not pain. */
  feel: string;
  /** Short phrases: "2 s down", "1 s up". Rendered as chips beside the feel. */
  tempo: string[];
  swaps: ExerciseTeachingSwap[];
  /**
   * Four statements the reader answers about their own set. Not a quiz with a
   * right answer — the ones you cannot tick honestly are the ones to film.
   */
  check: string[];
  caution?: ExerciseTeachingCaution;
}

const TEACHING_EN: Record<string, ExerciseTeaching> = {
  'Barbell Bench Press - Medium Grip': {
    cues: [
      'Feet flat, whole shoe on the floor.',
      'Shoulder blades back and down before the bar moves.',
      'Bar touches mid-chest, then straight back up.',
    ],
    mistakes: [
      {
        mistake: 'Elbows flared straight out to the sides',
        fix: 'Keep them at roughly 45° — the bar stays over the wrist.',
      },
      {
        mistake: 'Bouncing the bar off the chest',
        fix: 'Pause a beat on the chest. If you cannot, the weight is the problem.',
      },
    ],
    feel: 'Work across the chest and the back of the arm. Effort, not pain.',
    tempo: ['2 s down', '1 s up', 'Breathe in at the top'],
    swaps: [
      {
        direction: 'easier',
        exerciseName: 'Dumbbell Bench Press',
        why: 'Each arm finds its own path — kinder on the shoulder.',
      },
      {
        direction: 'harder',
        exerciseName: 'Close-Grip Barbell Bench Press',
        why: 'The narrow grip hands more of the press to the triceps.',
      },
    ],
    check: [
      'The bar touched my chest every rep',
      'My feet never moved',
      'I pressed without arching off the bench',
      'The last rep looked like the first',
    ],
    caution: {
      area: 'shoulders',
      text: 'A pinch at the front of the shoulder means narrow the grip or stop the set. You flagged shoulders in setup.',
    },
  },
  'Barbell Squat': {
    cues: [
      'Bar on the shelf of muscle, not on bone.',
      'Big breath before you drop, hold it all the way down.',
      'Knees track over the middle of the foot.',
    ],
    mistakes: [
      {
        mistake: 'Heels lifting off the floor',
        fix: 'Push the floor apart with the whole foot. If the ankle will not allow it, raise the heel.',
      },
      {
        mistake: 'Chest folding forward out of the hole',
        fix: 'Stay braced and drive the upper back into the bar as you stand.',
      },
    ],
    feel: 'Quads and glutes doing the work, brace holding the middle. Effort, not pain.',
    tempo: ['2 s down', 'Drive up', 'Breath held through the rep'],
    swaps: [
      {
        direction: 'easier',
        exerciseName: 'Goblet Squat',
        why: 'The weight in front keeps you upright and asks less of the back.',
      },
      {
        direction: 'harder',
        exerciseName: 'Front Squat (Clean Grip)',
        why: 'Nowhere to hide — the position keeps you honest.',
      },
    ],
    check: [
      'Hips went below the knee',
      'Both heels stayed down',
      'Knees never fell inwards',
      'The bar stayed over mid-foot',
    ],
    caution: {
      area: 'lower_back',
      text: 'Any pinch in the lower back means rack it. You flagged the lower back in setup, so this lift starts lighter than the others.',
    },
  },
  'Barbell Deadlift': {
    cues: [
      'Bar over the middle of the foot before you touch it.',
      'Take the slack out of the bar, then push the floor away.',
      'Lock hips and knees at the same time.',
    ],
    mistakes: [
      {
        mistake: 'Yanking the bar off the floor',
        fix: 'Pull the slack out first — you should hear the plates settle, not clang.',
      },
      {
        mistake: 'Hips rising before the bar does',
        fix: 'Start with the shoulders just in front of the bar and push with the legs.',
      },
    ],
    feel: 'Hamstrings, glutes and the whole back holding position. Effort, not pain.',
    tempo: ['Pull, then lower', '1 s reset on the floor', 'Breathe between reps'],
    swaps: [
      {
        direction: 'easier',
        exerciseName: 'Romanian Deadlift',
        why: 'Shorter range, no floor reset — the hinge without the heavy start.',
      },
      {
        direction: 'harder',
        exerciseName: 'Deficit Deadlift',
        why: 'Standing on a plate makes the first inch the hardest one.',
      },
    ],
    check: [
      'The bar stayed against my legs',
      'My back kept the same shape start to finish',
      'Hips and shoulders rose together',
      'I set it down instead of dropping it',
    ],
    caution: {
      area: 'lower_back',
      text: 'Sharp or one-sided pain in the lower back means the set is over. You flagged the lower back in setup.',
    },
  },
};

const TEACHING_FI: Record<string, ExerciseTeaching> = {
  'Barbell Bench Press - Medium Grip': {
    cues: [
      'Jalkapohjat kokonaan lattiassa.',
      'Lavat taakse ja alas ennen kuin tanko liikkuu.',
      'Tanko koskettaa rinnan keskiosaa ja nousee suoraan takaisin ylös.',
    ],
    mistakes: [
      {
        mistake: 'Kyynärpäät levällään suoraan sivuille',
        fix: 'Pidä ne noin 45 asteessa — tanko pysyy ranteen päällä.',
      },
      {
        mistake: 'Tangon pomputtaminen rinnasta',
        fix: 'Pysähdy hetkeksi rintaan. Jos et pysty, paino on liian suuri.',
      },
    ],
    feel: 'Työ tuntuu rinnassa ja olkavarren takaosassa. Rasitusta, ei kipua.',
    tempo: ['2 s alas', '1 s ylös', 'Hengitä sisään yläasennossa'],
    swaps: [
      {
        direction: 'easier',
        exerciseName: 'Dumbbell Bench Press',
        why: 'Kumpikin käsi löytää oman ratansa — hellävaraisempi olkapäille.',
      },
      {
        direction: 'harder',
        exerciseName: 'Close-Grip Barbell Bench Press',
        why: 'Kapea ote siirtää työtä ojentajille.',
      },
    ],
    check: [
      'Tanko kosketti rintaa joka toistolla',
      'Jalkani eivät liikkuneet',
      'Punnersin ilman että selkä irtosi penkistä',
      'Viimeinen toisto näytti samalta kuin ensimmäinen',
    ],
    caution: {
      area: 'shoulders',
      text: 'Pistely olkapään etuosassa tarkoittaa kapeampaa otetta tai sarjan lopettamista. Merkitsit olkapäät alkukartoituksessa.',
    },
  },
  'Barbell Squat': {
    cues: [
      'Tanko lihaksen päälle, ei luun päälle.',
      'Iso hengitys ennen alastuloa, pidä se koko matkan.',
      'Polvet kulkevat jalkaterän keskilinjan yli.',
    ],
    mistakes: [
      {
        mistake: 'Kantapäät nousevat lattiasta',
        fix: 'Työnnä lattiaa auki koko jalkapohjalla. Jos nilkka ei anna periksi, korota kantapäätä.',
      },
      {
        mistake: 'Rintakehä kaatuu eteen ala-asennosta noustessa',
        fix: 'Pidä keskivartalo jännitettynä ja työnnä yläselkää tankoa vasten kun nouset.',
      },
    ],
    feel: 'Etureidet ja pakarat tekevät työn, keskivartalo pitää asennon. Rasitusta, ei kipua.',
    tempo: ['2 s alas', 'Nouse räjähtävästi', 'Hengitys pidätettynä toiston ajan'],
    swaps: [
      {
        direction: 'easier',
        exerciseName: 'Goblet Squat',
        why: 'Paino edessä pitää ryhdin pystyssä ja vaatii selältä vähemmän.',
      },
      {
        direction: 'harder',
        exerciseName: 'Front Squat (Clean Grip)',
        why: 'Ei paikkaa piiloutua — asento pitää sinut rehellisenä.',
      },
    ],
    check: [
      'Lantio kävi polvitason alapuolella',
      'Molemmat kantapäät pysyivät maassa',
      'Polvet eivät kaatuneet sisäänpäin',
      'Tanko pysyi jalkaterän keskilinjan päällä',
    ],
    caution: {
      area: 'lower_back',
      text: 'Mikä tahansa pistely alaselässä tarkoittaa että tanko menee telineeseen. Merkitsit alaselän alkukartoituksessa, joten tämä liike aloitetaan muita kevyemmin.',
    },
  },
  'Barbell Deadlift': {
    cues: [
      'Tanko jalkaterän keskilinjan päällä ennen kuin kosket siihen.',
      'Ota löysät pois tangosta ja työnnä sitten lattiaa alaspäin.',
      'Lukitse lantio ja polvet samaan aikaan.',
    ],
    mistakes: [
      {
        mistake: 'Tangon nykäisy irti lattiasta',
        fix: 'Ota löysät ensin pois — levyjen pitäisi asettua äänettömästi, ei kolahtaa.',
      },
      {
        mistake: 'Lantio nousee ennen tankoa',
        fix: 'Aloita hartiat hieman tangon etupuolella ja työnnä jaloilla.',
      },
    ],
    feel: 'Takareidet, pakarat ja koko selkä pitämässä asentoa. Rasitusta, ei kipua.',
    tempo: ['Vedä, sitten laske', '1 s tauko lattiassa', 'Hengitä toistojen välissä'],
    swaps: [
      {
        direction: 'easier',
        exerciseName: 'Romanian Deadlift',
        why: 'Lyhyempi liikerata eikä lattiasta aloitusta — sarana ilman raskasta lähtöä.',
      },
      {
        direction: 'harder',
        exerciseName: 'Deficit Deadlift',
        why: 'Levyn päällä seisominen tekee ensimmäisestä sentistä vaikeimman.',
      },
    ],
    check: [
      'Tanko pysyi kiinni jaloissa',
      'Selkä piti saman muodon alusta loppuun',
      'Lantio ja hartiat nousivat yhtä aikaa',
      'Laskin tangon alas enkä pudottanut sitä',
    ],
    caution: {
      area: 'lower_back',
      text: 'Terävä tai toispuoleinen kipu alaselässä tarkoittaa että sarja on ohi. Merkitsit alaselän alkukartoituksessa.',
    },
  },
};

/**
 * What is written about this lift, in the reader's language.
 *
 * Falls back to English rather than to nothing, the same rule
 * `getExerciseInstructions` follows: an honest English cue beats a missing
 * one. Returns null when nothing is written at all, which the screen reads as
 * "render the steps and skip the rest".
 */
export function getExerciseTeaching(
  name: string | null | undefined,
  language: AppLanguage = 'en',
): ExerciseTeaching | null {
  const key = (name ?? '').trim();
  if (!key) {
    return null;
  }
  if (language === 'fi') {
    return TEACHING_FI[key] ?? TEACHING_EN[key] ?? null;
  }
  return TEACHING_EN[key] ?? null;
}

/**
 * Whether this reader should see this lift's caution.
 *
 * Only when they flagged the area, and only when they flagged it as something
 * to be careful about — an 'info' note in setup is not a reason to put a
 * warning on a lift they are about to do.
 */
export function shouldShowTeachingCaution(
  caution: ExerciseTeachingCaution | undefined,
  cautionFlags: ReadonlyArray<{ area: SetupCautionArea; level: string }> | null | undefined,
): boolean {
  if (!caution) {
    return false;
  }
  return (cautionFlags ?? []).some(
    (flag) => flag.area === caution.area && (flag.level === 'careful' || flag.level === 'avoid'),
  );
}

/** Exported for the test that keeps this table paired with the library. */
export const EXERCISE_TEACHING_TABLES = { en: TEACHING_EN, fi: TEACHING_FI };
