import { useRef, useState } from 'react';

import { createTourTargetRegistry } from '../features/tour/tourTargets';
import type { TourBarStop, TourTargetId, WorkoutTourStep } from '../lib/firstRunTour';

/**
 * The first-run tour's state, moved out of App.tsx verbatim (app-split step 8).
 * `createTourTargetRegistry()` still runs on every render as the useRef
 * argument, exactly as before.
 */
export function useTourState() {
  // The first-run tour's wiring: where its targets are, and which bar item
  // its sweep is resting on. The registry is one object for the app's life.
  const tourRegistry = useRef(createTourTargetRegistry()).current;
  const [tourSweep, setTourSweep] = useState<TourBarStop | null>(null);
  /**
   * Which section the tour is pointing at. Home reads it to shut its folds
   * before the beat that rings one — the layer cannot reach into a screen's
   * state, and should not, so it says where it is and the screen decides.
   */
  const [tourFocus, setTourFocus] = useState<TourTargetId | null>(null);
  /**
   * The guided player's plain set or rest, as the player reports it, for the
   * workout tour. The route says only "the player"; which step it is on is the
   * player's own state. Null on every other screen and every other step.
   */
  const [workoutTourStep, setWorkoutTourStep] = useState<WorkoutTourStep | null>(null);

  return { tourRegistry, tourSweep, setTourSweep, tourFocus, setTourFocus, workoutTourStep, setWorkoutTourStep };
}
