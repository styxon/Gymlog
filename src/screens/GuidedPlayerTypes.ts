import type { LiftHistoryEntry } from '../lib/progression';
import type { OwnBlockPhase, OwnBlockStats } from '../lib/ownBlockHistory';
import type { PlateauDetection } from '../lib/proInsights';
import type { RestAlertAskOutcome } from '../lib/restAlertAnswer';
import type { TailoringPreferencesInput } from '../lib/tailoringFit';
import type { TourTargetId, WorkoutTourStep } from '../lib/firstRunTour';
import type { TourTargetRegistry } from '../features/tour/tourTargets';
import type { AppLanguage, ExerciseLibraryItem, SetupCautionFlag, UnitPreference } from '../types/models';

export interface GuidedWeekProgress {
  weekLabel: string;
  done: number;
  target: number;
}

export interface GuidedNextUp {
  name: string;
  weekday: string;
}

export interface GuidedPlayerScreenProps {
  unitPreference: UnitPreference;
  language?: AppLanguage;
  /** Equipment chips the user actually has; null when the setup never said. */
  availableEquipment?: string[] | null;
  /**
   * The reader's caution flags: an `avoid` area keeps its drills out of the
   * warm-up and cool-down, the way it keeps its lifts out of the week.
   */
  cautionFlags?: readonly SetupCautionFlag[];
  /**
   * The reader's own warm-up / cool-down picks.
   *
   * Without these the player coached the drill they replaced: the swap showed
   * on Home and in the day editor and never reached the one screen that
   * actually runs it (found in review, 2026-08-31).
   */
  routineDrillOverrides?: Record<string, string>;
  /** Ranks the swap list the same way the list logger does. */
  tailoringPreferences?: TailoringPreferencesInput | null;
  exerciseLibrary: ExerciseLibraryItem[];
  /**
   * The lift's whole logged history by name — every programme and free
   * session, the rows the records tab reads. The sheet's History tab read
   * only this slot's entries, so a bench pressed on 28.8. in another
   * programme was "no entries yet" here while the records tab showed its
   * 7 × 60 (#bugs 2026-09-20). The slot's own rows are added where the lift
   * does not already have them — never replaced: the lift's list is every
   * log by name, and a session whose database write failed, or one this
   * install only has in slot history, is still this slot's past.
   */
  liftHistory?: (exerciseName: string) => readonly LiftHistoryEntry[] | null;
  /**
   * Whether the reader has Pro. The exercise sheet's History tab is the
   * per-lift set log and carries records, so Free reads it through the same
   * locks as Progress; without the flag the sheet is the Free one.
   */
  proUnlocked?: boolean;
  /** The lock's way out: the Pro page. */
  onOpenPro?: () => void;
  /**
   * Automated progression is on and paid for (lib/proEntitlement
   * resolveProgressionOptions). Today's weight on the set card gets its arrow
   * only then (#bugs 2026-10-10).
   */
  progressionOn?: boolean;
  /**
   * The plateau reminder for the lift being walked to, or null when it is
   * not currently stalled. Same detection Home's card shows (lib/proInsights
   * findPlateauDetection) — shown once here, on the beat where the lift is
   * introduced, so the finding survives dismissing Home's card without a
   * second rule to keep in sync (user 2026-09-29, "muistutus kun
   * seuraavalla kerralla on sumo").
   */
  plateauNotice?: (exerciseName: string) => PlateauDetection | null;
  soundCuesEnabled: boolean;
  /** Keep the display on for the whole guided session. */
  keepScreenAwake?: boolean;
  /** The reader's default rest, for a lift added mid-session with no rest to inherit. */
  defaultRestSeconds?: number;
  onToggleSoundCues: (next: boolean) => void;
  entryEyebrow: string;
  /**
   * Every finished session, so the overview can find the last run of this same
   * day. Which one that is depends on the live session's template ids, which
   * this screen holds and the caller does not.
   */
  /** How the reader's own warm-ups have gone — see lib/ownBlockHistory.ts. */
  ownBlockStats?: OwnBlockStats;
  /** One finished self-run block, for the "last time you took" line. */
  onRecordOwnBlock?: (phase: OwnBlockPhase, seconds: number) => void;
  /** The Learn section's own two facts, so the sheet can show and change them. */
  learnedExerciseIds?: string[];
  techniqueChecks?: Record<string, number[]>;
  onToggleTechniqueStatement?: (libraryItemId: string, index: number) => void;
  onToggleExerciseLearned?: (libraryItemId: string) => void;
  weekProgress: GuidedWeekProgress | null;
  nextUp: GuidedNextUp | null;
  onLeave: () => void;
  onEndSession: () => void;
  onFinishSession: () => void;
  isSavingWorkout: boolean;
  /**
   * The finish's save was refused. The finish step says so and offers the
   * save again; it used to be an empty screen with the bar hidden and a toast
   * that was gone in three seconds.
   */
  saveFailed?: boolean;
  /** Rest & alerts settings (design: Background Timer). */
  restAlerts?: { alerts: boolean; warning: boolean; ongoing: boolean; asked: boolean };
  /** The first-rest permission sheet was answered — see restAlertsAnswered. */
  onRestAlertsAnswered?: (outcome: RestAlertAskOutcome) => void;
  /** The rest banner's "Turn on": the settings page that fixes the silence. */
  onOpenSystemSettings?: () => void;
  /**
   * The reader asked to CONTINUE, not to open the session.
   *
   * Set by the paths whose own button already said "Resume workout" — Home's
   * hero, the lock-screen card. Opening the overview after that is the app
   * asking a question the reader has already answered.
   */
  autoResume?: boolean;
  /** The first-run tour's target registry: the set and rest screens register what the tour rings. */
  tourTargets?: TourTargetRegistry;
  /** Where the player reports its plain set / rest to the shell, for the workout tour. */
  onTourStep?: (step: WorkoutTourStep | null) => void;
  /**
   * A workout tour is up over the player. The step clock holds for it, so a
   * rest cannot run out under the tour that is explaining it (#bugs
   * 2026-10-17, "lepo ajastin ei voi kulua kun on opastus käynnissä").
   */
  tourRunning?: boolean;
  /** What the tour's current beat is about (FirstRunTour onBeatChange). */
  tourFocus?: TourTargetId | null;
}
