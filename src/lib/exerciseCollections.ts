import { AppLanguage } from '../types/models';

/**
 * Short courses: a handful of lifts, in the order they are easiest to learn.
 *
 * A collection is an ORDER, not a filter — that is the whole reason to have
 * one. The library can already show you every squat; what it cannot tell you
 * is which lift to learn before which, and that is the only thing this adds.
 *
 * NOTHING IS LOCKED. Teaching that withholds the next lesson until you tick
 * the last one is a game, not a library. The order is a recommendation and
 * every row opens, learned or not.
 *
 * ONE COURSE, for now. The index says why: a course with no written lessons in
 * it is just a title, and the teaching layer covers three lifts today (user
 * decision 2026-08-31 — write for the ones people meet first, then grow). A
 * second collection ships when its lessons do, not before.
 */

interface ExerciseCollectionEntry {
  /**
   * The movement pattern this lift stands for. The reason it is in the list —
   * "Barbell Squat" is the example; "Squat" is the lesson.
   */
  pattern: string;
  /** The library name, so the row opens that lift's own screen. */
  exerciseName: string;
}

export interface ExerciseCollection {
  id: string;
  title: string;
  /** One line, saying what the course is for rather than how long it is. */
  blurb: string;
  /** The longer why, on the collection's own screen. */
  intro: string;
  entries: ExerciseCollectionEntry[];
  /** Two hex stops for the cover wash. */
  cover: [string, string];
}

const SIX_LIFTS_EN: ExerciseCollection = {
  id: 'six_lifts',
  title: 'The six lifts',
  // The lifts by the names the library prints, not the patterns: "hinge"
  // and "brace" are coach's words a beginner cannot picture (owner,
  // 2026-10-13). The patterns stay on the course's own rows.
  blurb: 'Barbell squat, deadlift, overhead press and more',
  intro:
    'Six patterns, in the order they are easiest to learn. Every programme in the catalog is built out of these — learn them once and the rest of the library stops being a list of strangers.',
  cover: ['#7699FB', '#2D48C0'],
  entries: [
    { pattern: 'Squat', exerciseName: 'Barbell Squat' },
    { pattern: 'Hinge', exerciseName: 'Barbell Deadlift' },
    { pattern: 'Horizontal press', exerciseName: 'Barbell Bench Press - Medium Grip' },
    // The library's own names, not the catalog's shorthand: a row here opens a
    // page directly, so it cannot lean on the name matcher the way a
    // programme's exercise list does.
    { pattern: 'Vertical press', exerciseName: 'Standing Military Press' },
    { pattern: 'Horizontal pull', exerciseName: 'Bent Over Barbell Row' },
    { pattern: 'Carry & brace', exerciseName: "Farmer's Walk" },
  ],
};

const SIX_LIFTS_FI: ExerciseCollection = {
  ...SIX_LIFTS_EN,
  title: 'Kuusi liikettä',
  blurb: 'Takakyykky, maastaveto, pystypunnerrus ja muut',
  intro:
    'Kuusi liikemallia siinä järjestyksessä kuin ne on helpointa oppia. Jokainen katalogin ohjelma on rakennettu näistä — opettele ne kerran, eikä loppu kirjastosta ole enää pelkkä lista tuntemattomia.',
  entries: [
    { pattern: 'Kyykky', exerciseName: 'Barbell Squat' },
    { pattern: 'Sarana', exerciseName: 'Barbell Deadlift' },
    { pattern: 'Vaakapunnerrus', exerciseName: 'Barbell Bench Press - Medium Grip' },
    { pattern: 'Pystypunnerrus', exerciseName: 'Standing Military Press' },
    { pattern: 'Vaakaveto', exerciseName: 'Bent Over Barbell Row' },
    { pattern: 'Kanto ja tuenta', exerciseName: "Farmer's Walk" },
  ],
};

const COLLECTIONS_EN: ExerciseCollection[] = [SIX_LIFTS_EN];
const COLLECTIONS_FI: ExerciseCollection[] = [SIX_LIFTS_FI];

export function getExerciseCollections(language: AppLanguage = 'en'): ExerciseCollection[] {
  return language === 'fi' ? COLLECTIONS_FI : COLLECTIONS_EN;
}

export function getExerciseCollection(
  id: string,
  language: AppLanguage = 'en',
): ExerciseCollection | null {
  return getExerciseCollections(language).find((collection) => collection.id === id) ?? null;
}

interface CollectionProgress {
  done: number;
  total: number;
  /** The first entry not yet learned — what the screen marks NEXT. */
  nextExerciseName: string | null;
  /**
   * 0–100, for a progress bar's width.
   *
   * Computed here so no screen divides by `total` on its own: a course with
   * no entries would make that NaN, and `width: 'NaN%'` is a style React
   * Native cannot lay out. An empty course is also refused by the suite —
   * this is the belt to that pair of braces.
   */
  percent: number;
}

/**
 * How far through a collection this reader is.
 *
 * Learned is stored by library item id and a collection lists library names,
 * so the caller resolves names to ids and passes the set. Doing the lookup
 * here would drag the library into a pure module for no gain.
 */
export function resolveCollectionProgress(
  collection: ExerciseCollection,
  isLearned: (exerciseName: string) => boolean,
): CollectionProgress {
  let done = 0;
  let nextExerciseName: string | null = null;

  for (const entry of collection.entries) {
    if (isLearned(entry.exerciseName)) {
      done += 1;
    } else if (nextExerciseName === null) {
      nextExerciseName = entry.exerciseName;
    }
  }

  const total = collection.entries.length;
  return { done, total, nextExerciseName, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** Which of the three a library card is showing. */
export type LibraryCollectionState = 'inProgress' | 'notStarted' | 'done';

interface PickedLibraryCollection {
  collection: ExerciseCollection;
  progress: CollectionProgress;
  state: LibraryCollectionState;
}

/**
 * The course the library offers, and which of the three states it is in.
 *
 * This used to be `findCollectionInProgress`, which returned a collection only
 * while `0 < done < total` — and the library nested the "All courses" link
 * inside the block that rendered on it. So the only door into Learn was open
 * exclusively to a reader already part-way through a course: not a fresh
 * install, where nothing is learned and the whole feature was invisible, and
 * not a reader who finished one, where the door closed again behind them.
 *
 * So a course always comes back when there is one, and the caller says
 * different words over it. Started-but-unfinished still wins — that is the one
 * you meant to come back to — then untouched, and a finished course last,
 * because "learn this" beats "you already did".
 */
export function pickLibraryCollection(
  collections: ExerciseCollection[],
  isLearned: (exerciseName: string) => boolean,
): PickedLibraryCollection | null {
  const scored = collections.map((collection) => {
    const progress = resolveCollectionProgress(collection, isLearned);
    const state: LibraryCollectionState =
      progress.total > 0 && progress.done >= progress.total
        ? 'done'
        : progress.done > 0
          ? 'inProgress'
          : 'notStarted';
    return { collection, progress, state };
  });

  const ORDER: LibraryCollectionState[] = ['inProgress', 'notStarted', 'done'];
  for (const state of ORDER) {
    const hit = scored.find((entry) => entry.state === state);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** Exported for the sweep that keeps every entry pointing at a real lift. */
export const EXERCISE_COLLECTION_TABLES = { en: COLLECTIONS_EN, fi: COLLECTIONS_FI };
