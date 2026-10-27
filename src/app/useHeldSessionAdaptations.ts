import { useState } from 'react';

import {
  type AdaptedSessionRef,
  heldAdaptationFor,
  type HeldSessionAdaptations,
  NO_HELD_SESSION_ADAPTATIONS,
  type SessionAdaptation,
  updateHeldAdaptation,
} from '../lib/sessionAdaptation';

/**
 * Today's swaps and left-out slots, moved out of App.tsx verbatim (app-split
 * step 4a). VinhaApp calls it at the slot the state stood in.
 *
 * Chosen on Home or a programme's day page before the session exists — each
 * held for the session it was made on, on the day it was made
 * (lib/sessionAdaptation). Deliberately not persisted: it is an answer to
 * "what am I doing today", and it is spent when that session starts.
 *
 * `sessionAdaptationFor` and `adaptSession` stay plain functions, a new one
 * every render, as they were.
 */
export function useHeldSessionAdaptations(todayStartMs: number) {
  const [heldSessionAdaptations, setHeldSessionAdaptations] =
    useState<HeldSessionAdaptations>(NO_HELD_SESSION_ADAPTATIONS);
  /** What is held for this session today — read by every screen that shows or starts it. */
  const sessionAdaptationFor = (ref: AdaptedSessionRef | null | undefined): SessionAdaptation =>
    heldAdaptationFor(heldSessionAdaptations, ref, todayStartMs);
  const adaptSession = (ref: AdaptedSessionRef, change: (current: SessionAdaptation) => SessionAdaptation) =>
    setHeldSessionAdaptations((held) => updateHeldAdaptation(held, ref, todayStartMs, change));

  return { heldSessionAdaptations, setHeldSessionAdaptations, sessionAdaptationFor, adaptSession };
}
