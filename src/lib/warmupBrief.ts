/**
 * What today's session is about to load — for the reader warming up their own
 * way (design: workout session flow, screen 4).
 *
 * A deliberate distinction from what this screen used to hold. It once listed
 * the drills the app would have run, and that was removed on 2026-08-26
 * because it is the app arguing with a choice it had just offered. This is the
 * opposite claim: not "here is what you skipped" but "here is what you are
 * about to lift", which is the one thing that makes a self-run warm-up better
 * rather than merely faster. It never names a drill.
 */
import { libraryLabel } from './libraryLabel';
import { buildOverviewScheme } from './sessionOverviewRows';
import { AppLanguage, UnitPreference } from '../types/models';

export interface WarmupBriefExercise {
  /** The library name, untranslated — the caution matcher reads English. */
  exerciseName: string;
  /** From the library row; null when the lift is not in it. */
  bodyPart: string | null;
  setCount: number;
  repsLabel: string;
  timed: boolean;
  minutes?: boolean;
  loadKg: number | null;
}

export interface WarmupBriefFirstLift {
  /** Untranslated; the screen puts it through its own name label. */
  exerciseName: string;
  /** "4 × 7 · 62,5 kg". */
  scheme: string;
}

export interface WarmupBrief {
  /** Localized body-part labels, deduped, in the order the session meets them. */
  areas: string[];
  firstLift: WarmupBriefFirstLift | null;
}

export function buildWarmupBrief(
  exercises: ReadonlyArray<WarmupBriefExercise>,
  language: AppLanguage,
  unitPreference: UnitPreference = 'kg',
): WarmupBrief {
  const areas: string[] = [];

  exercises.forEach((exercise) => {
    if (exercise.bodyPart) {
      const label = libraryLabel(exercise.bodyPart, language);
      if (label && !areas.includes(label)) {
        areas.push(label);
      }
    }
  });

  const first = exercises[0] ?? null;

  return {
    areas,
    firstLift: first
      ? {
          exerciseName: first.exerciseName,
          scheme: buildOverviewScheme(
            {
              exerciseName: first.exerciseName,
              setCount: first.setCount,
              repsLabel: first.repsLabel,
              timed: first.timed,
              minutes: first.minutes,
              loadKg: first.loadKg,
            },
            language,
            unitPreference,
          ),
        }
      : null,
  };
}
