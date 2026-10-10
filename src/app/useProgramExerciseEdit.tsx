import { useRef } from 'react';
import { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import type { WorkoutFeatureState } from '../features/workout/workoutState';
import { planTrainingCycle } from '../lib/planTrainingCycle';
import { addActiveProgram, removeActiveProgram } from '../lib/activeProgramSet';
import { carryCompletionDismissal } from '../lib/programCompletion';
import { buildDuplicatedCustomProgramDraft } from '../lib/customProgramDuplication';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { getExerciseTemplateDefaults } from '../lib/exerciseSuggestions';
import { findGuidedLibraryIndex } from '../lib/guidedPlayer';
import { t } from '../lib/i18n';
import { createId } from '../lib/ids';
import { buildCustomProgramPlanId, buildProgramWorkoutPlan, buildReadyProgramPlanId } from '../lib/programAdoption';
import { liveSessionBlocksProgrammeDelete } from '../lib/programmeDeletion';
import { applyProgramSessionEdit, ProgramPrescription } from '../lib/programSessionEdit';
import { ProgramLimitReachedError, type ProgramSlots } from '../lib/programSlots';
import {
  type AdaptedSessionRef,
  type HeldSessionMove,
  type SessionAdaptation,
  planHeldMovesToCopy,
  withoutSessionSwapsTo,
} from '../lib/sessionAdaptation';
import { doseAfterSwap, isSameLiftName } from '../lib/swapDose';
import { movePickToCopy } from '../lib/todaySessionPick';
import { isSupersetLinked, setSupersetLink, supersetGroupIndexes, supersetSetTargets } from '../lib/supersetGrouping';
import { planLabelsForProgramme } from '../lib/trainingWeekSync';
import type { AppRoute } from '../navigation/routes';
import type {
  PreferencesPatch,
  WorkoutTemplateSessionsEdit,
  WorkoutTemplateSessionsEditResult,
} from '../state/AppProvider';
import type {
  AppDatabase,
  AppPreferences,
  WorkoutPlan,
  WorkoutTemplateDraft,
  WorkoutTemplateSessionWithExercises,
} from '../types/models';
import { haptics } from '../utils/haptics';
import { reportPlanSaveFailed } from './planSaveFailure';

/**
 * Editing one lift of a programme from wherever the reader is looking at it:
 * remove, replace, add, re-dose, reorder and superset-link, one at a time in
 * the order they were pressed, and on a ready programme the copy that editing
 * one means.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30),
 * docs and comments with it and in the order it stood there: the
 * ProgramExerciseEdit type, buildAddedProgramExercises,
 * resolveLibraryItemIdForName, the programEditQueue, pendingProgramEdits and
 * copiedInThisEditBurst refs, handleEditProgramExercise and
 * runProgramExerciseEdit. A hook because the queue and the burst are refs, and
 * VinhaApp calls it exactly where the block stood (after programCapLine's
 * memo), so the three refs keep their slots. There are no effects and no
 * memos: handleEditProgramExercise and the rest are still plain functions made
 * on every render, so a queued edit still runs with the closure of the render
 * that pressed it, as it did in VinhaApp. Every use of
 * handleEditProgramExercise in App.tsx sits below the call.
 *
 * .tsx only because the edit types and PreferencesPatch are exported by
 * src/state/AppProvider.tsx; no .ts module imports this file, and the test
 * build does not compile it. "Above", "below" and "here" in the moved
 * comments point inside this file, where they always pointed: every one of
 * them is about code that moved with it. What stayed in App.tsx:
 * programCapLine, the orphaned "Take one lift out" doc above it, and the
 * orphaned adoption doc below the call.
 */
export interface ProgramExerciseEditDeps {
  /** The library a lift added or swapped in is looked up in, for its id and its defaults. */
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  preferences: AppPreferences;
  /** Only the plan records are read: whether the reader holds the ready programme, and its block. */
  database: AppDatabase;
  /** Only the running session: a held programme is not forgotten under a workout of it. */
  workout: Pick<WorkoutFeatureState, 'activeSession'>;
  /** Only the names are read, so the copy's name does not clash with one the reader has. */
  workoutTemplates: AppDatabase['workoutTemplates'];
  /** Whether the copy fits under the free cap, asked before anything is built. */
  programSlots: ProgramSlots;
  editWorkoutTemplateSessions: (
    workoutTemplateId: string,
    edit: (sessions: WorkoutTemplateSessionWithExercises[]) => WorkoutTemplateSessionsEdit,
  ) => Promise<WorkoutTemplateSessionsEditResult>;
  findWorkoutTemplateIdBySource: (sourceTemplateId: string) => Promise<string | null>;
  upsertWorkoutTemplate: (draft: WorkoutTemplateDraft) => Promise<string>;
  getWorkoutTemplateSessionsFresh: (workoutTemplateId: string) => Promise<WorkoutTemplateSessionWithExercises[]>;
  upsertWorkoutPlan: (plan: WorkoutPlan) => Promise<void>;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  forgetHeldProgramme: (workoutTemplateId: string) => Promise<void>;
  /** Takes back a copy whose follow-up writes failed (it stops the programme too). */
  deleteWorkoutTemplate: (workoutTemplateId: string) => Promise<void>;
  /** VinhaApp's hoisted navigate. */
  navigate: (route: AppRoute) => void;
  /** VinhaApp's hoisted showToast. */
  showToast: (message: string) => void;
  /** VinhaApp's writer for today's held swaps and drops. */
  adaptSession: (ref: AdaptedSessionRef, change: (current: SessionAdaptation) => SessionAdaptation) => void;
  /** VinhaApp's mover for today's holds: a ready programme's copy takes them along. */
  moveHeldAdaptations: (moves: HeldSessionMove[]) => void;
  /** Opens the programme-limit sheet. */
  setProgramLimitVisible: (visible: boolean) => void;
}

export function useProgramExerciseEdit(deps: ProgramExerciseEditDeps) {
  const {
    exerciseLibrary,
    preferences,
    database,
    workout,
    workoutTemplates,
    programSlots,
    editWorkoutTemplateSessions,
    findWorkoutTemplateIdBySource,
    upsertWorkoutTemplate,
    getWorkoutTemplateSessionsFresh,
    upsertWorkoutPlan,
    updatePreferences,
    forgetHeldProgramme,
    deleteWorkoutTemplate,
    navigate,
    showToast,
    adaptSession,
    moveHeldAdaptations,
    setProgramLimitVisible,
  } = deps;

  /**
   * What one edit to a programme's exercise does. Both reach the template the
   * same way — copying a ready programme first when there is no template to
   * write to — so they share a path rather than two near-identical ones.
   */
  type ProgramExerciseEdit =
    | { kind: 'remove' }
    | { kind: 'replace'; exerciseName: string }
    | { kind: 'add'; exerciseNames: string[] }
    | { kind: 'prescribe'; prescription: ProgramPrescription }
    | { kind: 'reorder'; toIndex: number }
    | { kind: 'supersetLink'; linked: boolean };

  /**
   * The prescription a lift added from the library starts on.
   *
   * The day screen adds a name, not a dose — the library has no opinion about
   * how many sets of it you do. These are the same defaults the template
   * editor writes, so a lift added from either place looks the same afterwards.
   */
  function buildAddedProgramExercises(exerciseNames: string[], sessionId: string) {
    return exerciseNames.map((name) => {
      const libraryItemId = resolveLibraryItemIdForName(name);
      const defaults = getExerciseTemplateDefaults(
        exerciseLibrary.find((item) => item.id === libraryItemId),
        preferences.defaultRestSeconds,
      );
      return {
        id: createId(`${sessionId}_add`),
        name,
        libraryItemId,
        ...defaults,
        // A lift added from the library starts unpaired. Stated rather than
        // left off, so every row in a day carries the same fields and the
        // adjacency rule has something to read on all of them.
        supersetGroup: null as string | null,
      };
    });
  }

  /**
   * The library entry a name belongs to, so a swapped-in lift keeps its photo,
   * its instructions and its history. Writing the name alone leaves the row
   * pointing at the exercise it used to be.
   */
  function resolveLibraryItemIdForName(name: string): string | null {
    const index = findGuidedLibraryIndex(
      name,
      exerciseLibrary.map((item) => item.name),
    );
    return index === null || index < 0 ? null : exerciseLibrary[index]?.id ?? null;
  }

  /**
   * Programme edits run one at a time, in the order they were pressed.
   *
   * Not for the writes themselves — the provider already serialises those. It
   * is for the decision in front of them: editing a ready programme first asks
   * whether a copy of it exists and then makes one if it does not, and two
   * edits overlapping across that gap both answer "no". A stepper turns that
   * from a theoretical race into the normal case, because the second tap
   * arrives while the first copy is still being written.
   */
  const programEditQueue = useRef<Promise<void>>(Promise.resolve());
  /**
   * Ready programmes a queued edit has copied, while the queue is still busy.
   *
   * The first edit on a catalogue day copies the programme and carries the
   * reader to the copy's day. An edit pressed on the catalogue day before that
   * landed — a second tap on the bin, a stepper's next "+" — then finds the
   * copy and took the "you already have your own version" branch: a toast,
   * and a push to the copy's programme page on top of the day they had just
   * been carried to (double-tap audit, 2026-09-21). Those edits were aimed at
   * rows that are gone from the screen, so they are dropped quietly. Cleared
   * when the queue drains, so a reader who comes back to the catalogue day
   * later is still told and taken to their version.
   */
  const pendingProgramEdits = useRef(0);
  const copiedInThisEditBurst = useRef(new Set<string>());

  function handleEditProgramExercise(
    programType: 'ready' | 'custom',
    programId: string,
    sessionId: string,
    exerciseId: string,
    edit: ProgramExerciseEdit,
  ): Promise<boolean> {
    pendingProgramEdits.current += 1;
    const next = programEditQueue.current.then(() =>
      runProgramExerciseEdit(programType, programId, sessionId, exerciseId, edit),
    );
    // A failed edit must not wedge every edit queued behind it.
    programEditQueue.current = next.then(() => undefined).catch(() => undefined);
    const settle = () => {
      pendingProgramEdits.current -= 1;
      if (pendingProgramEdits.current === 0) {
        copiedInThisEditBurst.current.clear();
      }
    };
    void next.then(settle, settle);
    // Every caller presses it as `void`: a write the disk refused was an edit
    // that sprang back with no word.
    return next.catch((error) => {
      reportPlanSaveFailed('Failed to edit the programme', error, preferences.appLanguage, showToast);
      return false;
    });
  }

  /** Resolves true when the programme actually changed. */
  async function runProgramExerciseEdit(
    programType: 'ready' | 'custom',
    programId: string,
    sessionId: string,
    exerciseId: string,
    edit: ProgramExerciseEdit,
  ): Promise<boolean> {
    if (programType === 'custom') {
      // The day is read inside the write, not before it: an add that lands
      // while the previous add is still being saved must build on it rather
      // than on the screen's copy of how the programme looked a render ago.
      const added =
        edit.kind === 'add' ? buildAddedProgramExercises(edit.exerciseNames, sessionId) : [];
      const result = await editWorkoutTemplateSessions(programId, (sessions) =>
        applyProgramSessionEdit(
          sessions,
          sessionId,
          edit.kind === 'remove'
            ? { kind: 'remove', exerciseId }
            : edit.kind === 'replace'
              ? {
                  kind: 'replace',
                  exerciseId,
                  exerciseName: edit.exerciseName,
                  libraryItemId: resolveLibraryItemIdForName(edit.exerciseName),
                }
              : edit.kind === 'prescribe'
                ? { kind: 'prescribe', exerciseId, prescription: edit.prescription }
                : edit.kind === 'reorder'
                  ? { kind: 'reorder', exerciseId, toIndex: edit.toIndex }
                  : edit.kind === 'supersetLink'
                    ? { kind: 'supersetLink', exerciseId, linked: edit.linked }
                    : { kind: 'add', exercises: added },
        ),
      );
      if (result.reason === 'lastExerciseInDay') {
        showToast(t(preferences.appLanguage, 'toast.lastExerciseInDay'));
        return false;
      }
      if (!result.saved) {
        return false;
      }
      void haptics.success();
      if (edit.kind === 'replace') {
        // Today's swap has been spent by the programme itself. Leaving it in
        // place would keep an override on a slot that now already says this.
        adaptSession({ programId, sessionId }, (current) => withoutSessionSwapsTo(current, edit.exerciseName));
        // No "it is in your programme now" popup: the row behind the sheet
        // already says the new lift, and it stops being marked as today's
        // override. A toast that repeats the screen is the thing the reader
        // keeps asking to be rid of (user 2026-08-26).
      }
      return true;
    }

    const template = WORKOUT_TEMPLATES_V1.find((item) => item.id === programId);
    if (!template) {
      return false;
    }

    /**
     * A drop that changes nothing, checked before anything is written.
     *
     * Everything below this line copies the catalog programme into a custom
     * one — that is what editing a ready programme means. Pressing "up" on the
     * top row is not an edit, and letting it through would hand the reader a
     * copy of the whole programme, and one fewer free slot, in exchange for a
     * list that looks exactly as it did.
     */
    if (edit.kind === 'reorder') {
      const day = template.sessions.find((session) => session.id === sessionId);
      const from = day?.exercises.findIndex((exercise) => exercise.id === exerciseId) ?? -1;
      const to = day
        ? Math.max(0, Math.min(day.exercises.length - 1, Math.round(edit.toIndex)))
        : -1;
      if (!day || from === -1 || to === from) {
        return false;
      }
    }

    // Same argument for the chain: the bottom row has nothing to run into, and
    // a link already in the state being asked for is not an edit. Either would
    // otherwise buy the reader a whole copy of the programme.
    if (edit.kind === 'supersetLink') {
      const day = template.sessions.find((session) => session.id === sessionId);
      const from = day?.exercises.findIndex((exercise) => exercise.id === exerciseId) ?? -1;
      if (!day || from === -1 || from >= day.exercises.length - 1) {
        return false;
      }
      if (isSupersetLinked(day.exercises, from) === edit.linked) {
        return false;
      }
    }

    // And a lift swapped for itself: "Keep in programme" on a row whose held
    // swap names the programme's own lift copied the whole catalogue
    // programme, and spent a slot, for X → X (swap hunt, 2026-10-07).
    if (edit.kind === 'replace') {
      const row = template.sessions
        .find((session) => session.id === sessionId)
        ?.exercises.find((exercise) => exercise.id === exerciseId);
      if (!row || isSameLiftName(row.exerciseName, edit.exerciseName)) {
        return false;
      }
    }

    /**
     * Already have a version of this one? Edit it.
     *
     * This branch used to build a fresh copy from the catalog every time, so
     * editing the same ready programme three times left the reader with THREE
     * programmes — the third arriving as "(kopio 2)", and the free cap filling
     * up with the same programme (#bugs 2026-08-26). The catalog original is
     * immutable and keeps its id forever; the copy now records which one it
     * came from, and a second edit finds it and goes down the custom path.
     *
     * Asked of the database rather than of `workoutTemplates`, which is the
     * screen's copy and one render behind: three stepper taps inside a single
     * render all read "no copy yet" and all three made one. Serialising the
     * handler (see programEditQueue) is the other half — the lookup has to run
     * after the previous edit's write, not merely against fresh data.
     */
    const existingCopyId = await findWorkoutTemplateIdBySource(programId);
    if (existingCopyId && copiedInThisEditBurst.current.has(programId)) {
      // Made by an edit queued ahead of this one; see copiedInThisEditBurst.
      return false;
    }
    if (existingCopyId) {
      /**
       * The reader already has their own version of this programme, and this
       * page is not it.
       *
       * The catalog original stays untouched behind the copy — that is the
       * whole point of it — so the rows in front of the reader are not the
       * rows any edit would change. The edit used to be applied to the copy
       * with the ids in hand, which the copy has never heard of: it landed on
       * nothing, was written back unchanged, and the screen buzzed as if it
       * had worked.
       *
       * Translating the ids is not the fix either. A copy can have days
       * reordered and lifts dropped, so the same position means a different
       * day and the same name a different row — and reorder and superset
       * links ARE positions. An edit that lands on the row next to the one
       * the reader dragged, and says it worked, is worse than no edit.
       *
       * So no edit is made here. The reader is taken to their own version,
       * where the rows on screen are the rows that change.
       */
      showToast(t(preferences.appLanguage, 'toast.ownProgrammeVersion'));
      navigate({
        tab: 'workout',
        screen: 'program',
        programType: 'custom',
        workoutTemplateId: existingCopyId,
      });
      return false;
    }

    // The copy is a programme of the reader's own, whether or not it replaces
    // the ready one they run, so it takes a slot like any other: at the limit
    // the edit opens the limit sheet here, before anything is built. Running
    // ones used to be waved through, and one round of edit → adopt the next →
    // edit per ready programme put a free reader past the cap (audit
    // 2026-09-16). The provider checks the same thing again at the write.
    const readyPlanId = buildReadyProgramPlanId(programId);
    const wasRunning = preferences.activePlanIds.includes(readyPlanId);
    // Held is not running, and both of them are "this reader trains this
    // programme". Stopping a programme rewrites the active set and leaves
    // its plan record standing, block and all; only the running set says
    // whether the copy takes a slot, and everything else about it — the
    // block it inherits, the record it replaces — follows the record
    // (CI review of #161).
    const wasHeld = database.workoutPlans.some((item) => item.id === readyPlanId);
    // The copy replaces a held programme's record below (forgetHeldProgramme),
    // and that is a delete like the other two: not while a workout of it is
    // running. It freed the running slot mid-workout and the player's week
    // line went with it (recheck of #222, 2026-09-28).
    if (wasHeld && liveSessionBlocksProgrammeDelete(workout.activeSession, programId)) {
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.programEditWorkoutRunning'));
      return false;
    }
    if (!programSlots.canCreate) {
      setProgramLimitVisible(true);
      return false;
    }
    // Which catalogue row each row of the copy came from, by day and position:
    // the copy's stored ids are new, and today's holds are keyed by the old.
    const draftRowOrigins: string[][] = [];
    const draft = buildDuplicatedCustomProgramDraft(
      template.name,
      template.sessions.map((session, sessionIndex) => {
        const exercises = [
          ...session.exercises
          .filter(
            (exercise) =>
              edit.kind !== 'remove' || !(session.id === sessionId && exercise.id === exerciseId),
          )
          .map((exercise, exerciseIndex) => {
            const target = session.id === sessionId && exercise.id === exerciseId;
            const name =
              target && edit.kind === 'replace' ? edit.exerciseName : exercise.exerciseName;
            // The catalog's dose unless this row is the one being re-dosed,
            // or a lift swapped in across units, whose reps are its own as
            // the custom path's swap makes them (lib/swapDose).
            // Rest rides along on the same rule the custom path uses
            // (applyProgramSessionEdit): a number overrides, null leaves the
            // catalog's own value alone.
            const swapped =
              target && edit.kind === 'replace'
                ? doseAfterSwap(
                    {
                      trackingMode: exercise.trackingMode,
                      sets: exercise.sets,
                      repsMin: exercise.repsMin,
                      repsMax: exercise.repsMax,
                    },
                    edit.exerciseName,
                  )
                : null;
            const dose =
              target && edit.kind === 'prescribe'
                ? edit.prescription
                : swapped
                  ? { targetSets: swapped.sets, repMin: swapped.repsMin, repMax: swapped.repsMax, restSeconds: null }
                  : {
                      targetSets: exercise.sets,
                      repMin: exercise.repsMin,
                      repMax: exercise.repsMax,
                      restSeconds: null,
                    };
            return {
              id: exercise.id,
              workoutTemplateId: template.id,
              workoutTemplateSessionId: session.id,
              name,
              targetSets: dose.targetSets,
              repMin: dose.repMin,
              repMax: dose.repMax,
              // Reading only the catalog value here dropped a rest-time edit
              // in silence — and it had already cost the reader one of three
              // custom-programme slots to make the copy (PR #33 review).
              restSeconds:
                typeof dose.restSeconds === 'number' ? dose.restSeconds : exercise.restSecondsMin,
              // The catalogue's own answer to "is this lift in the trend". A
              // flat false left it to the library's category, which called
              // every curl compound; with the category corrected to the
              // source mechanic (2026-10-06) a programme's primary curl would
              // have dropped out of the progression the moment it was copied.
              trackedDefault: exercise.progressionPriority !== 'low',
              orderIndex: exerciseIndex,
              libraryItemId: target && edit.kind === 'replace' ? resolveLibraryItemIdForName(name) : null,
              // The catalogue row's own mode survives the copy, except for a
              // lift swapped in, which the library describes.
              trackingMode: target && edit.kind === 'replace' ? null : exercise.trackingMode,
              // The catalog's own pairing, which since 2026-09-11 is 83 real
              // supersets rather than none. It has to survive the copy: this
              // is the fork a reader's first edit to a ready programme takes.
              supersetGroup: exercise.supersetGroup ?? null,
            };
          }),
          // A ready programme is copied to be edited, so adding to one of its
          // days works exactly as removing from one already does.
          ...(edit.kind === 'add' && session.id === sessionId
            ? buildAddedProgramExercises(edit.exerciseNames, session.id).map((exercise, index) => ({
                ...exercise,
                workoutTemplateId: template.id,
                workoutTemplateSessionId: session.id,
                orderIndex: session.exercises.length + index,
              }))
            : []),
        ];

        if (edit.kind === 'reorder' && session.id === sessionId) {
          const from = exercises.findIndex((exercise) => exercise.id === exerciseId);
          const to = Math.max(0, Math.min(exercises.length - 1, Math.round(edit.toIndex)));
          const [moved] = exercises.splice(from, 1);
          exercises.splice(to, 0, moved);
        }

        // A block's set count is one number here too. This fork runs on the
        // FIRST edit of a ready programme, before a custom copy exists — so
        // without this, re-dosing one half of a catalog superset wrote the
        // copy with the two halves disagreeing, and nothing downstream repairs
        // that (PR #93 review). The custom path does the same a few files
        // over, in applyProgramSessionEdit.
        if (edit.kind === 'prescribe' && session.id === sessionId) {
          const index = exercises.findIndex((item) => item.id === exerciseId);
          if (index !== -1) {
            supersetGroupIndexes(exercises, index).forEach((position) => {
              exercises[position] = {
                ...exercises[position],
                targetSets: edit.prescription.targetSets,
                ...(typeof edit.prescription.restSeconds === 'number'
                  ? { restSeconds: edit.prescription.restSeconds }
                  : {}),
              };
            });
          }
        }

        if (edit.kind === 'supersetLink' && session.id === sessionId) {
          const index = exercises.findIndex((exercise) => exercise.id === exerciseId);
          if (index !== -1) {
            exercises.splice(0, exercises.length, ...setSupersetLink(exercises, index, edit.linked));
            // Same rule the custom path applies: a block counted in rounds
            // cannot hold two lifts that disagree about how many sets they do.
            if (edit.linked) {
              supersetSetTargets(exercises, (position) => exercises[position].targetSets).forEach(
                (targetSets, position) => {
                  exercises[position] = { ...exercises[position], targetSets };
                },
              );
            }
          }
        }

        draftRowOrigins[sessionIndex] = exercises.map((exercise) => exercise.id);
        return {
          id: session.id,
          workoutTemplateId: template.id,
          name: session.name,
          orderIndex: sessionIndex,
          exerciseIds: session.exercises.map((exercise) => exercise.id),
          // Re-numbered from where the rows now sit: the position in this
          // array is what the reader sees, and orderIndex is what is stored.
          exercises: exercises.map((exercise, orderIndex) => ({ ...exercise, orderIndex })),
        };
      }),
      workoutTemplates.map((item) => item.name),
      preferences.appLanguage,
    );
    // The link the next edit will look for.
    draft.sourceTemplateId = programId;

    /**
     * The copy, once written, until the reader's programme points at it.
     *
     * A failure between the two used to leave the copy behind under a toast
     * saying the copy failed — and the next edit found it by its source and
     * went to it (#bugs 2026-10-01, phase-B list). Until the preferences
     * land, a failure takes it back; after that the copy IS the programme,
     * and only the held record's cleanup is left.
     */
    let uncommittedCopyId: string | null = null;
    /** Past the commit: the copy is the programme, whatever happens after. */
    let committed = false;
    try {
      const workoutTemplateId = await upsertWorkoutTemplate(draft);
      uncommittedCopyId = workoutTemplateId;
      const planId = buildCustomProgramPlanId(workoutTemplateId);
      // Read the ids back rather than trusting the draft's: the repository
      // assigns them, and a plan pointing at ids that were never stored is a
      // programme whose days resolve to nothing.
      // Fresh, not rendered: this line runs inside the closure that created
      // the copy, and that closure's `database` predates it.
      const copiedSessions = await getWorkoutTemplateSessionsFresh(workoutTemplateId);
      const sessionIds = copiedSessions
        .filter((session) => session.exercises.length > 0)
        .map((session) => session.id);
      /**
       * The copy keeps the block the reader was already in.
       *
       * `now` is the plan record's own boundary: every session count on Home
       * is measured from it. Stamping it with today turned "week 3, 7 of 24"
       * into "week 1, 0 of 24" because the reader changed one lift — the
       * programme is the same programme, and the block it is in is the same
       * block. Only when it replaces a plan the reader HELD: a copy of a
       * programme they were merely browsing has no block to inherit, and a
       * programme switched off has one — its weeks did not stop being
       * trained because it is not the one Home leads with today.
       */
      const replacedPlan = wasHeld
        ? database.workoutPlans.find((item) => item.id === readyPlanId) ?? null
        : null;
      const plan = buildProgramWorkoutPlan({
        planId,
        workoutTemplateId,
        programName: formatWorkoutDisplayLabel(draft.name),
        sessionIds,
        dayLabels: planLabelsForProgramme(sessionIds.length, preferences.setupAvailableDays, new Date()),
        now: replacedPlan?.updatedAt ?? new Date().toISOString(),
      });
      // And its rhythm: a new id, so the plan write cannot carry it over.
      await upsertWorkoutPlan({ ...plan, trainingCycle: planTrainingCycle(replacedPlan) });
      // The copy takes the ready programme's place rather than joining it —
      // the reader had one programme before this and must have one after. Only
      // when the ready one was actually running: editing a day of a programme
      // they are merely browsing must not adopt anything.
      await updatePreferences({
        ...(wasRunning
          ? {
              activePlanIds: addActiveProgram(
                removeActiveProgram(preferences.activePlanIds, readyPlanId),
                plan.id,
              ),
              // The copy takes the ready programme's PLACE, which is not the
              // same as the lead. Editing a lift in a programme the reader
              // holds but does not lead with used to promote it over the one
              // Home was running — a change of programme nobody asked for.
              activePlanId:
                preferences.activePlanId === readyPlanId ? plan.id : preferences.activePlanId ?? plan.id,
            }
          : {}),
        // The copy inherits the finished block, and the card the reader had
        // already answered for it: a new plan id asked the same question again.
        // Running or not, in the same write as the copy's place in the set.
        ...(wasHeld && preferences.dismissedCompletionPlanIds.includes(readyPlanId)
          ? {
              dismissedCompletionPlanIds: carryCompletionDismissal(
                preferences.dismissedCompletionPlanIds,
                readyPlanId,
                plan.id,
              ),
            }
          : {}),
      });
      uncommittedCopyId = null;
      committed = true;
      if (wasHeld) {
        // The record the copy replaced goes with it, whether or not it was
        // the one running. Left behind, it listed
        // the programme twice — the copy running, the catalog version
        // "switched off" — and that row's Active switch re-adopted the
        // untouched original beside the copy, two slots for one programme
        // (audit round 4, 2026-09-20). The block boundary was read off it
        // above, before this.
        // Cleanup by now: the copy is the reader's programme and the edit is
        // in, so a failure here is logged, not reported as a failed copy.
        await forgetHeldProgramme(template.id).catch((error) => {
          console.error('Failed to forget the held ready programme after copying it', error);
        });
      }
      copiedInThisEditBurst.current.add(programId);
      void haptics.success();
      /**
       * Today's choices go where the programme went.
       *
       * The pick ("today is legs") and the swaps and drops held for the day
       * are keyed by the catalogue programme's ids, and the copy has none of
       * them. Left behind, they sat on a programme Home no longer reads: the
       * first edit of a ready programme threw away everything else the reader
       * had decided for today (hunt 9, 2026-10-09).
       */
      const dayIndex = template.sessions.findIndex((session) => session.id === sessionId);
      const { moves, sessionIds: copiedDayIds } = planHeldMovesToCopy({
        programId,
        copyId: workoutTemplateId,
        days: template.sessions,
        copiedDays: copiedSessions.map((copied, index) => ({
          id: copied.id,
          exercises: copied.exercises
            .slice()
            .sort((left, right) => left.orderIndex - right.orderIndex)
            .map((row, position) => ({ id: row.id, fromExerciseId: draftRowOrigins[index]?.[position] ?? null })),
        })),
      });
      moveHeldAdaptations(moves);
      await updatePreferences((current) => {
        const pick = movePickToCopy(current.todaySession, programId, workoutTemplateId, copiedDayIds);
        return pick === current.todaySession ? {} : { todaySession: pick };
      }).catch((error) => {
        // Cleanup like the forget above: the copy is in, so a failed write
        // here is logged rather than turning the edit into a failure.
        console.error("Failed to move today's pick onto the copy", error);
      });
      if (edit.kind === 'replace' && dayIndex > -1 && copiedSessions[dayIndex]) {
        // The programme took the swap; what is held for this day is now the
        // copy's, and an override on a slot that already says it is a mark.
        adaptSession({ programId: workoutTemplateId, sessionId: copiedSessions[dayIndex].id }, (current) =>
          withoutSessionSwapsTo(current, edit.exerciseName),
        );
      }
      /**
       * Onto the copy's version of the day the reader is standing on.
       *
       * This used to land on the programme page, which was survivable when
       * every edit here was a one-shot press in a sheet that closed anyway.
       * With a stepper it is not: the first "+" copied the programme and then
       * moved the reader to a different screen, with the sheet they were still
       * using floating over it. The days are copied in order, so the day at
       * the same position is the same day.
       */
      // Read off the unfiltered list: the plan drops a day with nothing in it,
      // but the days are still stored in their original order, and indexing
      // the filtered list would walk one day forward past a dropped one.
      const copiedSessionId = dayIndex > -1 ? copiedSessions[dayIndex]?.id : undefined;
      navigate(
        copiedSessionId
          ? {
              tab: 'workout',
              screen: 'programDay',
              programType: 'custom',
              workoutTemplateId,
              sessionId: copiedSessionId,
            }
          : { tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId },
      );
      return true;
    } catch (error) {
      if (committed) {
        // The copy and the reader's programme are in; what failed is the
        // landing (a held swap, the route). Saying "copy failed" here would
        // claim the opposite of what is stored (review of #bugs 2026-10-01).
        console.error('Copied the ready programme, then failed to land on it', error);
        return true;
      }
      if (uncommittedCopyId) {
        // Best effort, plan first while the copy still names it, then the
        // copy itself: written before the preferences failed, the plan would
        // stay behind as an empty record on every retry (review of #bugs
        // 2026-10-01). The failure the reader hears about is the copy's.
        const copyId = uncommittedCopyId;
        await forgetHeldProgramme(copyId).catch(() => undefined);
        await deleteWorkoutTemplate(copyId).catch(() => undefined);
      }
      if (error instanceof ProgramLimitReachedError) {
        setProgramLimitVisible(true);
        return false;
      }
      console.error('Failed to remove exercise from ready program', error);
      showToast(t(preferences.appLanguage, 'toast.programCopyFailed'));
      return false;
    }
  }

  return { handleEditProgramExercise };
}
