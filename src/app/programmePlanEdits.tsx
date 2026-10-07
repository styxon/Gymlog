import { livePlanEntries } from '../lib/planResolvableEntries';
import { planForTemplate } from '../lib/planTrainingCycle';
import { planTrainedOnDay, resolveNextPlanEntryIndex } from '../lib/planRotation';
import { toDraftExercise } from '../lib/programSessionEdit';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { t } from '../lib/i18n';
import { SetCountChange, setCountChanges, setCountToastParts } from '../lib/setCountChanges';
import { WEEKDAY_KEYS } from '../lib/programTrainingDays';
import { planLabelsFromWeekdays, rotateLabelsForNextSession, weekdaysFromPlanLabels } from '../lib/trainingWeekSync';
import type { useAppContext } from '../state/AppProvider';
import { SetupDaysPerWeek, SetupWeekday } from '../types/models';
import { haptics } from '../utils/haptics';
import { templateSessionsReader } from './planTemplateSessions';
import type { createProgrammeStarts } from './programmeStarts';

type AppContextValue = ReturnType<typeof useAppContext>;

/**
 * A running plan's answers and edits: the completion card's three answers, the
 * rhythm and the training days written onto the plan, and a custom
 * programme's emphasis.
 *
 * Moved verbatim from VinhaApp in App.tsx in phase C of the split
 * (2026-10-01), each handler with its doc. A per-render factory, not a hook:
 * it holds no state and calls no hook. VinhaApp calls it on every render,
 * exactly where the declarations stood (after handleAdoptReadyProgram), so
 * each handler is still a fresh closure over that render's values; every use
 * of them in App.tsx sits below the call. The emphasis doc still stands above
 * the rhythm's, as it did in App.tsx.
 *
 * .tsx only because the context types come from src/state/AppProvider.tsx; no
 * .ts module imports this file, and the test build does not compile it.
 */
export interface ProgrammePlanEditsDeps {
  database: AppContextValue['database'];
  preferences: AppContextValue['preferences'];
  updatePreferences: AppContextValue['updatePreferences'];
  upsertWorkoutPlan: AppContextValue['upsertWorkoutPlan'];
  editWorkoutTemplateSessions: AppContextValue['editWorkoutTemplateSessions'];
  /** VinhaApp's hoisted showToast. */
  showToast: (message: string) => void;
  /** VinhaApp's hoisted adoption of a ready programme. */
  handleAdoptReadyProgram: (workoutTemplateId: string, options?: { lead?: boolean }) => Promise<boolean>;
  completedSessionsForTemplate: ReturnType<typeof createProgrammeStarts>['completedSessionsForTemplate'];
}

export function createProgrammePlanEdits(deps: ProgrammePlanEditsDeps) {
  const {
    database,
    preferences,
    updatePreferences,
    upsertWorkoutPlan,
    editWorkoutTemplateSessions,
    showToast,
    handleAdoptReadyProgram,
    completedSessionsForTemplate,
  } = deps;

  /**
   * The completion card's three answers. Each one dismisses the card for this
   * plan id — the card is a question, and every branch is an answer to it.
   */
  async function dismissCompletionCard(planId: string) {
    if (preferences.dismissedCompletionPlanIds.includes(planId)) {
      return;
    }
    await updatePreferences({
      dismissedCompletionPlanIds: [...preferences.dismissedCompletionPlanIds, planId],
    });
  }

  async function handleCompletionStartNext(planId: string, nextTemplateId: string) {
    // Adopted first, dismissed second. The card was put away before the
    // adoption was attempted, so a reader at the free programme cap saw the
    // paywall, said no — and the step-up offer was gone for good, with no way
    // back to it (2026-09-16).
    const adopted = await handleAdoptReadyProgram(nextTemplateId, { lead: true });
    if (adopted) {
      await dismissCompletionCard(planId);
    }
  }


  /**
   * Emphasis save (design screen 3): new set counts, written to the reader's
   * own template.
   *
   * Only custom programmes reach here — a catalog template is immutable at
   * runtime, so the detail screen shows no stepper for a ready programme
   * rather than one that silently does nothing. Everything except the set
   * counts is carried through unchanged, so this cannot become a rewrite of
   * the whole template disguised as an emphasis nudge.
   */
  /**
   * Writes a finished rhythm onto the plan's own entries.
   *
   * Entry labels already carry weekday keys, so this needs no new stored
   * state — and the screen only calls it once the day count is whole again,
   * so a plan can never be written mid-move.
   *
   * The days are the ones the strip draws, and the strip draws only the
   * entries Home's rotation counts (`livePlanEntries`). An entry naming a
   * session the template lost is not on the strip, so it is not relabelled
   * here either: the strip hands back one day fewer than the stored entries,
   * and comparing against the stored count made this return without a word.
   * Returns false when nothing was written, so the caller can say so.
   */
  async function handleSaveRhythm(workoutTemplateId: string, dayIndexes: number[]): Promise<boolean> {
    // The plan the page reads, rhythm and weekdays alike: the one the reader
    // is on when several hold this programme (planForTemplate).
    const plan = planForTemplate(
      { plans: database.workoutPlans, activePlanId: preferences.activePlanId, activePlanIds: preferences.activePlanIds },
      workoutTemplateId,
    );
    if (!plan) {
      return false;
    }
    const allOrdered = [...plan.entries].sort((left, right) => left.orderIndex - right.orderIndex);
    const ordered = livePlanEntries(allOrdered, templateSessionsReader(database));
    if (ordered.length !== dayIndexes.length) {
      return false;
    }
    // The strip is a set of days, not a per-session assignment — it hands them
    // back Monday-first however they were tapped. Which session lands on which
    // of them is this app's answer, and it is the same one adoption gives:
    // whatever comes next in the rotation takes the first day not yet gone.
    const completedHere = completedSessionsForTemplate(ordered[0]?.workoutTemplateId);
    const now = new Date();
    const labels = rotateLabelsForNextSession(
      dayIndexes.map((index) => WEEKDAY_KEYS[index]),
      resolveNextPlanEntryIndex(ordered, completedHere),
      now,
      planTrainedOnDay(ordered, completedHere, new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()),
    );
    const labelByEntryId = new Map(ordered.map((entry, index) => [entry.id, labels[index]] as const));
    const entries = allOrdered.map((entry) =>
      labelByEntryId.has(entry.id) ? { ...entry, label: labelByEntryId.get(entry.id) as string } : entry,
    );
    await upsertWorkoutPlan({
      ...plan,
      entries,
      updatedAt: plan.updatedAt,
    });

    // The other half of the same week. The plan's labels drive Home's strip and
    // the calendar; availability drives the reminders, the widget and Profile's
    // chips. Writing only the first left a reader who moved leg day here still
    // being reminded on the day they moved it off.
    const days = weekdaysFromPlanLabels(livePlanEntries(entries, templateSessionsReader(database)));
    // Only the plan Home leads with, which is the same invariant the Profile
    // picker states two functions below. Availability is one list for the
    // whole app — Profile's chips, the reminders, the widget — and a rhythm
    // is per programme. Moving a day on a programme the reader holds but has
    // switched off rewrote that list while Home and the calendar kept reading
    // the lead plan's own labels (audit round 4, 2026-09-20); so does moving a
    // day on the SECOND running programme, which the running-set test let
    // through — two may run at once (CI review of #161).
    if (days.length > 0 && plan.id === preferences.activePlanId) {
      await updatePreferences({
        setupAvailableDays: days,
        // Naming the days by hand IS self-managed; leaving the mode alone would
        // let app_managed clear the list we just wrote.
        setupScheduleMode: 'self_managed',
        // Only when the count is an answer the questionnaire can hold. A
        // one-session programme is a real rhythm but not a 2–6 answer, and
        // clamping it up would tell the recommender something untrue.
        ...(days.length >= 2 && days.length <= 6
          ? { setupDaysPerWeek: days.length as SetupDaysPerWeek }
          : {}),
      });
    }
    return true;
  }

  /**
   * The weekday picker in Profile, from the other side of the same week.
   *
   * Only the lead plan is rewritten. Availability is one list for the whole
   * app, but a rhythm is per programme, and rewriting every active plan from
   * one picker would move days on programmes this screen never showed.
   */
  async function handleChangeTrainingDays(days: SetupWeekday[]) {
    // Same invariants as the onboarding day question: picking specific days
    // makes the schedule self-managed and the count follows, 2–6.
    const clamped = Math.min(6, Math.max(2, days.length)) as SetupDaysPerWeek;
    await updatePreferences({
      setupAvailableDays: days,
      setupDaysPerWeek: clamped,
      setupScheduleMode: 'self_managed',
    });

    const plan = database.workoutPlans.find((item) => item.id === preferences.activePlanId);
    if (!plan) {
      return;
    }
    const ordered = [...plan.entries].sort((left, right) => left.orderIndex - right.orderIndex);
    const labels = planLabelsFromWeekdays(ordered.length, days);
    if (!labels) {
      // Fewer days chosen than the programme has sessions. The availability is
      // stored — reminders follow it — and the rhythm the reader already has is
      // left alone rather than replaced by a week they did not choose.
      return;
    }
    // Same rule as adoption and as the rhythm strip: the session that comes
    // next takes the first training day that has not gone. Writing the spread
    // straight through put session one on the earliest weekday, so a reader
    // who moved a day mid-week was offered one session and shown another one's
    // day beside it.
    const completedHere = completedSessionsForTemplate(ordered[0]?.workoutTemplateId);
    const now = new Date();
    const placed = rotateLabelsForNextSession(
      labels,
      resolveNextPlanEntryIndex(ordered, completedHere),
      now,
      planTrainedOnDay(ordered, completedHere, new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()),
    );
    await upsertWorkoutPlan({
      ...plan,
      entries: ordered.map((entry, index) => ({ ...entry, label: placed[index] })),
      // Untouched on purpose: the plan record's own boundary is what the week
      // counter counts from, so moving days must not restart the block.
      updatedAt: plan.updatedAt,
    });
  }

  async function handleSaveEmphasis(
    workoutTemplateId: string,
    updates: Array<{ sessionId: string; exerciseId: string; sets: number }>,
  ) {
    if (updates.length === 0) {
      return;
    }
    const setsByExerciseId = new Map(updates.map((update) => [update.exerciseId, update.sets]));
    // Read off the days the write itself reads, so the line names what this
    // save changed and not what a stale copy of the programme would have.
    let changes: SetCountChange[] = [];
    const result = await editWorkoutTemplateSessions(workoutTemplateId, (sessions) => {
      changes = setCountChanges(sessions, setsByExerciseId);
      return {
        kind: 'save',
        sessions: sessions.map((session) => ({
          id: session.id,
          name: session.name,
          exercises: session.exercises.map((exercise) => ({
            ...toDraftExercise(exercise),
            targetSets: setsByExerciseId.get(exercise.id) ?? exercise.targetSets,
          })),
        })),
      };
    });
    if (!result.saved) {
      return;
    }
    void haptics.success();
    // The sliders move set counts on rows the sheet does not show, so the
    // save names them: "Hip thrust 4 → 5 sets" is the one moment the reader
    // sees which lift changed (#to-do 2026-09-29). A save that moved no count
    // says nothing — the bars on the page already show the new split, and a
    // toast repeating them is what the reader asked to be rid of (2026-08-26).
    if (changes.length > 0) {
      showToast(setCountToast(changes));
    }
  }

  function setCountToast(changes: readonly SetCountChange[]): string {
    const language = preferences.appLanguage;
    const label = (change: SetCountChange) => exerciseNameLabel(language, change.name);
    if (changes.length === 1) {
      const [change] = changes;
      return t(language, 'toast.setCountChanged', { name: label(change), from: change.from, to: change.to });
    }
    const { named, more } = setCountToastParts(changes);
    const items = named.map((change) =>
      t(language, 'toast.setCountChangedItem', { name: label(change), from: change.from, to: change.to }),
    );
    if (more > 0) {
      items.push(t(language, 'toast.setCountChangedMore', { count: more }));
    }
    return t(language, 'toast.setCountChangedMany', { list: items.join(', ') });
  }

  async function handleCompletionRestart(planId: string) {
    const plan = database.workoutPlans.find((entry) => entry.id === planId);
    if (!plan) {
      return;
    }
    // A fresh `updatedAt` IS the restart: the hero counts sessions from the
    // plan record's own boundary, so the new round begins at 0 of N without
    // touching a single logged session.
    await upsertWorkoutPlan({ ...plan, updatedAt: new Date().toISOString() });
    // The card goes because the block is no longer finished — 0 of N — not
    // because it was dismissed. Dismissing put the plan id on a list that is
    // never cleared, so the reader who restarted a programme was never
    // congratulated for finishing it again: the card was answered once, for
    // ever (2026-09-16). A new round is a new card, so the old dismissal is
    // dropped here rather than added to.
    if (preferences.dismissedCompletionPlanIds.includes(planId)) {
      await updatePreferences({
        dismissedCompletionPlanIds: preferences.dismissedCompletionPlanIds.filter((id) => id !== planId),
      });
    }
    // The hero counts 0 of N and the completion card is gone: the restart is
    // the thing on screen, not a sentence about it.
  }

  return {
    dismissCompletionCard,
    handleCompletionStartNext,
    handleSaveRhythm,
    handleChangeTrainingDays,
    handleSaveEmphasis,
    handleCompletionRestart,
  };
}
