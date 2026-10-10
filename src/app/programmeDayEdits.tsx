import { t } from '../lib/i18n';
import { createId } from '../lib/ids';
import { reorderPlanWeek } from '../lib/planSessionOrder';
import type { PlanRotationSession } from '../lib/planRotation';
import { syncPlanEntriesToTemplate } from '../lib/planTemplateSync';
import { toDraftExercise } from '../lib/programSessionEdit';
import { newProgramSessionName, removeProgramSession } from '../lib/programSessionList';
import { reorderProgramSessions } from '../lib/programSessionOrder';
import { clampProgrammeName } from '../lib/templateBuilderSteps';
import { planLabelsForProgramme } from '../lib/trainingWeekSync';
import type {
  PreferencesPatch,
  WorkoutTemplateSessionsEdit,
  WorkoutTemplateSessionsEditResult,
} from '../state/AppProvider';
import type { AppDatabase, AppPreferences, WorkoutPlan, WorkoutTemplateSessionWithExercises } from '../types/models';
import { haptics } from '../utils/haptics';

/**
 * A custom programme's days: renaming one, renaming the programme, moving,
 * adding and removing a day, and bringing the running plan's week into step
 * with the template afterwards.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30),
 * each handler with its doc. A per-render factory, not a hook: it holds no
 * state and calls no hook. VinhaApp calls it on every render, exactly where
 * the declarations stood (after handlePickTodaySession), so each handler is
 * still a fresh closure over that render's values, as the declarations were;
 * every use of them in App.tsx sits below the call. syncPlanAfterDayEdit
 * stays in here. What stayed in App.tsx: handlePickTodaySession, the orphaned
 * doc about adopting a programme of the reader's own above it, and the one
 * about taking a lift out below the call.
 *
 * .tsx only because the edit types and PreferencesPatch are exported by
 * src/state/AppProvider.tsx; no .ts module imports this file, and the test
 * build does not compile it. "Above" and "beside" in the moved docs still
 * point inside this file: the reorder sits above syncPlanToTemplate here too.
 */
export interface ProgrammeDayEditsDeps {
  database: AppDatabase;
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  editWorkoutTemplateSessions: (
    workoutTemplateId: string,
    edit: (sessions: WorkoutTemplateSessionWithExercises[]) => WorkoutTemplateSessionsEdit,
  ) => Promise<WorkoutTemplateSessionsEditResult>;
  renameWorkoutTemplate: (workoutTemplateId: string, nextName: string) => Promise<void>;
  getWorkoutTemplateSessionsFresh: (workoutTemplateId: string) => Promise<WorkoutTemplateSessionWithExercises[]>;
  upsertWorkoutPlan: (plan: WorkoutPlan) => Promise<void>;
  /** VinhaApp's hoisted helper: the completed sessions a programme's week turns on. */
  completedSessionsForTemplate: (workoutTemplateId: string) => readonly PlanRotationSession[];
  /** VinhaApp's hoisted showToast. */
  showToast: (message: string) => void;
}

export function createProgrammeDayEdits(deps: ProgrammeDayEditsDeps) {
  const {
    database,
    preferences,
    updatePreferences,
    editWorkoutTemplateSessions,
    renameWorkoutTemplate,
    getWorkoutTemplateSessionsFresh,
    upsertWorkoutPlan,
    completedSessionsForTemplate,
    showToast,
  } = deps;

  /**
   * Renaming one day of a custom programme — from Home's plan sheet and from
   * the day's own page.
   *
   * Only a program of the reader's own can be renamed: the catalog's templates
   * are immutable at runtime, and a rename that silently did nothing would be
   * worse than no button. Both surfaces ask whether they were handed this
   * before they draw the pencil.
   */
  async function handleRenameProgramSession(templateId: string, sessionId: string, name: string) {
    // Capped as the inputs are: Home's field had no limit, and a pasted
    // paragraph was saved as a day's name.
    const trimmed = clampProgrammeName(name);
    if (!trimmed) {
      return;
    }
    // Caught here, not by each caller: Home's sheet voided this and a failed
    // write left the old name standing with nothing said.
    try {
      const result = await editWorkoutTemplateSessions(templateId, (sessions) => ({
        kind: 'save',
        sessions: sessions.map((session) => ({
          id: session.id,
          // Every other field is copied because upsert replaces the record; only
          // the one session the reader named changes.
          name: session.id === sessionId ? trimmed : session.name,
          exercises: session.exercises.map(toDraftExercise),
        })),
      }));
      if (!result.saved) {
        return;
      }
    } catch (error) {
      console.error('Failed to rename a day of the programme', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
      return;
    }
    // Remembered once the name is stored, so the display rule shows it as
    // typed rather than reading "Päivä 2" as a placeholder of its own. Its own
    // write: the name is saved by now, and a failure here must not be told as
    // a failed rename — the day would only read by the usual rule.
    try {
      await updatePreferences((current) => ({
        readerSessionNames: { ...current.readerSessionNames, [sessionId]: trimmed },
      }));
    } catch (error) {
      console.error('Failed to remember a typed day name', error);
    }
  }

  /**
   * A custom programme's own name, from the page that shows it.
   *
   * The provider has done the work all along — trim, refuse a blank, commit —
   * and nothing called it. What made it worth wiring up: a copy's name is
   * written once at creation and never re-derived, so "(kopio 2)" outlives
   * every later change to the naming rules. The only cure is a reader who can
   * type over it (user 2026-09-08).
   */
  async function handleRenameCustomProgram(workoutTemplateId: string, name: string) {
    try {
      await renameWorkoutTemplate(workoutTemplateId, name);
    } catch (error) {
      console.error('Failed to rename the programme', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
    }
  }

  /**
   * Move a whole day inside the programme (user 2026-08-31).
   *
   * The rotation reads the session list positionally, so this is the edit that
   * decides which session lands on which weekday - the same list the day rows
   * print in. Custom programmes only: reordering a catalog programme would
   * mean copying it, and the reader has not asked for a copy by dragging.
   */
  async function handleReorderProgramSession(
    workoutTemplateId: string,
    sessionId: string,
    toIndex: number,
  ) {
    try {
      await writeSessionReorder(workoutTemplateId, sessionId, toIndex);
    } catch (error) {
      console.error('Failed to reorder the days of the programme', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
    }
  }

  async function writeSessionReorder(
    workoutTemplateId: string,
    sessionId: string,
    toIndex: number,
  ) {
    await editWorkoutTemplateSessions(workoutTemplateId, (sessions) => {
      const result = reorderProgramSessions(sessions, sessionId, toIndex);
      if (result.kind === 'skip') {
        return { kind: 'skip', reason: result.reason };
      }
      return {
        kind: 'save',
        // Position in this array is the stored order; every other field is
        // copied because upsert replaces the record.
        sessions: result.sessions.map((session) => ({
          id: session.id,
          name: session.name,
          exercises: session.exercises.map(toDraftExercise),
        })),
      };
    });

    // The template is only half the record. Each plan entry pins a weekday to
    // a session BY ID, and Home, the calendar and the rotation read the
    // assignment from there — so a reorder that stopped at the template moved
    // the list on one screen and changed nothing about what gets trained.
    // Read the order back rather than trusting the draft: the repository is
    // what decided it.
    const plan = database.workoutPlans.find(
      (item) => item.entries[0]?.workoutTemplateId === workoutTemplateId,
    );
    if (!plan) {
      return;
    }
    const saved = await getWorkoutTemplateSessionsFresh(workoutTemplateId);
    // And the week turns with it, like every other writer of the labels: the
    // session that comes next takes the first training day not yet gone.
    const repointed = reorderPlanWeek(
      plan.entries,
      saved.map((session) => session.id),
      completedSessionsForTemplate(workoutTemplateId),
      new Date(),
    );
    if (repointed.kind === 'skip') {
      return;
    }
    await upsertWorkoutPlan({ ...plan, entries: repointed.entries, updatedAt: plan.updatedAt });
  }

  /**
   * A new day at the end of a custom programme, under the name the reader gave
   * it, empty (#bugs 2026-09-24; named-first since 2026-09-26: "tähän tulee
   * ensiksi nimeä päivä … se menee tyhjänä"). The reader fills it on its own
   * page, which opens next. An empty day is never offered as the next session
   * and cannot be started — see nextStartableSessionIndex and the start
   * handler. The id is minted here so the caller can open the new day without
   * guessing which one it was. A blank name takes the editor's placeholder.
   *
   * Resolves the new day's id once the programme is saved, with whether its
   * week followed; null when nothing was written. A week that failed to
   * follow does not make the day unsaved — reporting it as a failed save
   * would tell the reader to try again and add the day twice (CI review of
   * #183, the same split the editor makes since #146).
   */
  async function handleAddProgramSession(
    workoutTemplateId: string,
    name: string,
  ): Promise<{ sessionId: string; weekSynced: boolean } | null> {
    const newSessionId = createId('workout_template_session');
    const result = await editWorkoutTemplateSessions(workoutTemplateId, (sessions) => ({
      kind: 'save',
      sessions: [
        ...[...sessions]
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map((session) => ({
            id: session.id,
            name: session.name,
            exercises: session.exercises.map(toDraftExercise),
          })),
        {
          id: newSessionId,
          name: name.trim() || newProgramSessionName(sessions.length, preferences.appLanguage),
          exercises: [],
        },
      ],
    }));
    if (!result.saved) {
      return null;
    }
    // The week gets the new day on one of the reader's training days.
    return { sessionId: newSessionId, weekSynced: await syncPlanAfterDayEdit(workoutTemplateId) };
  }

  /** The plan's week after a day was added or removed; false if it could not follow. */
  async function syncPlanAfterDayEdit(workoutTemplateId: string): Promise<boolean> {
    try {
      await syncPlanToTemplate(workoutTemplateId);
      return true;
    } catch (error) {
      console.error('Failed to bring the plan into step with the template', error);
      return false;
    }
  }

  /**
   * One day out of a custom programme, the rest kept as they are (#bugs
   * 2026-09-24: "tai poistaa päivä").
   *
   * The plan follows, like it does after the editor changes the count: an
   * entry left pointing at a deleted day would keep a weekday for a session
   * that no longer exists. The last day is refused — that is deleting the
   * programme, which has its own button and its own question.
   *
   * Resolves once the programme is saved, with whether its week followed;
   * null when nothing was written.
   */
  async function handleRemoveProgramSession(
    workoutTemplateId: string,
    sessionId: string,
  ): Promise<{ weekSynced: boolean } | null> {
    const result = await editWorkoutTemplateSessions(workoutTemplateId, (sessions) => {
      const outcome = removeProgramSession(sessions, sessionId);
      if (outcome.kind === 'skip') {
        return { kind: 'skip', reason: outcome.reason };
      }
      return {
        kind: 'save',
        sessions: outcome.sessions.map((session) => ({
          id: session.id,
          name: session.name,
          exercises: session.exercises.map(toDraftExercise),
        })),
      };
    });
    if (!result.saved) {
      return null;
    }
    return { weekSynced: await syncPlanAfterDayEdit(workoutTemplateId) };
  }

  /**
   * The running plan's week, after the template editor changed its days.
   *
   * `reorderPlanWeek` above deliberately refuses a changed COUNT — a drag must
   * not invent or drop a training day. The editor's day chips are the case
   * where the count is the thing that changed, and nothing followed it: a day
   * added was never offered, a day removed left an entry pointing at a session
   * that no longer existed, and Home went on counting the old number (audit 3,
   * 2026-09-19).
   *
   * Read back from the repository rather than from the draft, like the reorder
   * beside it: the ids are the repository's to assign.
   */
  async function syncPlanToTemplate(workoutTemplateId: string) {
    const plan = database.workoutPlans.find(
      (item) => item.entries[0]?.workoutTemplateId === workoutTemplateId,
    );
    if (!plan) {
      return;
    }
    const saved = await getWorkoutTemplateSessionsFresh(workoutTemplateId);
    const entries = syncPlanEntriesToTemplate({
      entries: plan.entries,
      sessionIds: saved.map((session) => session.id),
      planId: plan.id,
      workoutTemplateId,
      // A new day lands on the reader's own training days, laid out for the
      // new count the way every other adoption lays them out.
      dayLabels: planLabelsForProgramme(saved.length, preferences.setupAvailableDays, new Date()),
    });
    if (!entries) {
      return;
    }
    // `updatedAt` is NOT touched, exactly as the reorder above and the rename
    // refuse to touch it: on a plan it is the block boundary, not a
    // modification stamp. Home counts the week from it, so stamping it here
    // would have reset a reader mid-block to "week 1, 0 of 24" for adding a
    // day — with every completed session still in the database (CI review
    // of #146).
    await upsertWorkoutPlan({ ...plan, entries, updatedAt: plan.updatedAt });
  }

  return {
    handleRenameProgramSession,
    handleRenameCustomProgram,
    handleReorderProgramSession,
    handleAddProgramSession,
    handleRemoveProgramSession,
    syncPlanToTemplate,
  };
}
