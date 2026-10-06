import { useMemo } from 'react';

import { getWorkoutTemplateById, WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import { isMinutesTrackingMode, isTimedTrackingMode } from '../features/workout/workoutTypes';
import { ONBOARDING_PLAN_PREFIX } from '../lib/activeProgramSet';
import { getCanonicalCompletedSessions } from '../lib/completedSessions';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { formatSetScheme } from '../lib/format';
import { buildHomePlanProgress } from '../lib/homePlanProgress';
import {
  buildSessionEquipmentLabel,
  classifySessionFocus,
  getSessionBodyFocusLabel,
  type SessionFocusKind,
} from '../lib/homeSessionHero';
import { planTrainedOnDay, resolveNextPlanEntryIndex } from '../lib/planRotation';
import { resolvablePlanEntries, weeklyMinutesLabel } from '../lib/planResolvableEntries';
import { countSessionsSince, resolveCompletionCard } from '../lib/programCompletion';
import { composeProgramWeekForSelection } from '../lib/programDayComposer';
import { programmeHistoryIds } from '../lib/programLineage';
import { hasOnlyEmptyDays, nextStartableSessionIndex } from '../lib/programSessionList';
import { getProgrammeBlockWeeks } from '../lib/readyProgramDuration';
import type { AdaptedSessionRef, SessionAdaptation } from '../lib/sessionAdaptation';
import { estimateSessionMinutes } from '../lib/sessionDuration';
import { getReadyTemplatePresentation } from '../lib/templatePresentation';
import { resolveTodaySessionPick } from '../lib/todaySessionPick';
import type { AppDatabase, AppPreferences, WorkoutTemplateSessionWithExercises } from '../types/models';
import { formatGoalLabel, formatHomeSessionTitle } from './homeSessionTitle';
import type { buildSetupSelectionFromPreferences } from './onboardingHandoff';
import type { useCustomProgramViews } from './useCustomProgramViews';

/**
 * Home's hero card: the programme the reader leads with, its sessions in
 * rotation order, the one it offers today, and how far through the block it
 * is. Every surface that says "your programme" reads this card — the week
 * strip, the calendars, the widget, Profile, the guided player, the coach —
 * so it is one memo. Beside it: the programme with only empty days that the
 * card cannot draw, the swaps and left-out rows held for the session the card
 * offers, and the card's sessions per week as a number.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook, not a helper: the card and the empty-programme reading are memos,
 * and VinhaApp calls this exactly where the lines stood — after
 * recommendedReadyContent, before useHomeStatCards — so every hook keeps its
 * slot. The card's deps array was moved stale and is fixed now (#bugs
 * 2026-10-01): it reads the language, the runtime map and the routine costs,
 * so a language switch or an edited slot or drill re-reads it. The two
 * VinhaApp helpers it calls are plain functions rebuilt every render, so they
 * stay out — what they read, database.workoutPlans and the sessions, is in.
 *
 * The card has no declared type: what it is is what the memo returns, and a
 * module that reads it takes ReturnType<typeof useHomeActivePlan>. The session
 * ref stays inside; VinhaApp reads only what this returns.
 */
export interface HomeActivePlanDeps {
  /** The whole database: the plan records, sessions and logs. */
  database: AppDatabase;
  /** The reader's preferences: the lead plan, the goal, today's pick, the dismissed completion cards. */
  preferences: AppPreferences;
  /** The app context's custom programmes. */
  workoutTemplates: AppDatabase['workoutTemplates'];
  /** The app context's exercise library, for the equipment label. */
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  /** The app context's session reader for one custom programme. */
  getWorkoutTemplateSessions: (workoutTemplateId: string) => WorkoutTemplateSessionWithExercises[];
  /** Local midnight of today, from the day key. */
  todayStartMs: number;
  /** The setup answers: an onboarding plan's promised block length is composed from them. */
  setupSelection: ReturnType<typeof buildSetupSelectionFromPreferences>;
  /** Each custom programme as the player runs it: slot ids, roles and rests. */
  customWorkoutRuntimeMap: ReturnType<typeof useCustomProgramViews>['customWorkoutRuntimeMap'];
  /** The warm-up and cool-down cost for a session's focus. */
  routineBlockSeconds: (focus: SessionFocusKind) => { warmupSeconds: number; cooldownSeconds: number };
  /** VinhaApp's lineage-aware reader of one programme's completed sessions. */
  completedSessionsForTemplate: (
    workoutTemplateId: string | null | undefined,
    completed?: readonly ReturnType<typeof getCanonicalCompletedSessions>[number][],
  ) => readonly ReturnType<typeof getCanonicalCompletedSessions>[number][];
  /** The programmes some other plan is running. */
  templatesRunByOtherPlans: (workoutTemplateId: string | null | undefined) => string[];
  /** What is held for a session today. */
  sessionAdaptationFor: (ref: AdaptedSessionRef | null | undefined) => SessionAdaptation;
  /** Hold a change for a session today. */
  adaptSession: (ref: AdaptedSessionRef, change: (current: SessionAdaptation) => SessionAdaptation) => void;
}

export function useHomeActivePlan(deps: HomeActivePlanDeps) {
  const {
    database,
    preferences,
    workoutTemplates,
    exerciseLibrary,
    getWorkoutTemplateSessions,
    todayStartMs,
    setupSelection,
    customWorkoutRuntimeMap,
    routineBlockSeconds,
    completedSessionsForTemplate,
    templatesRunByOtherPlans,
    sessionAdaptationFor,
    adaptSession,
  } = deps;

  const homeActivePlanCard = useMemo(() => {
    const completedPlanSessions = getCanonicalCompletedSessions(database);
    // Local midnight, to date the reader's hand-picked session against. Read
    // from the day key rather than from the clock, so an app left open
    // overnight moves on with the reader rather than keeping yesterday — and
    // local rather than UTC, the same midnight the calendar and the widget
    // mean.
    const todayDayStart = todayStartMs;
    /** The local midnight an ISO timestamp falls in — not the UTC one. */
    const toDayStartMs = (iso: string) => {
      const date = new Date(iso);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    };
    // Both hero branches end in the same question — is this block finished,
    // and what may the card claim? The display name is resolved here because
    // Home has no catalog access, and the presentation title (not the raw
    // template name) is what every other surface shows.
    const buildCompletion = (
      planId: string,
      sessionsDone: number,
      sessionsTotal: number,
      activeTemplate: ReturnType<typeof getWorkoutTemplateById>,
      canRestart: boolean,
    ) => {
      const card = resolveCompletionCard({
        planId,
        sessionsDone,
        sessionsTotal,
        activeTemplate,
        catalog: WORKOUT_TEMPLATES_V1,
        dismissedPlanIds: preferences.dismissedCompletionPlanIds,
      });
      if (!card) {
        return null;
      }
      const nextTemplate = card.nextLevelTemplateId ? getWorkoutTemplateById(card.nextLevelTemplateId) : null;
      return {
        planId: card.planId,
        sessionsTotal: card.sessionsTotal,
        nextLevelTemplateId: card.nextLevelTemplateId,
        nextLevelTitle: nextTemplate
          ? getReadyTemplatePresentation(nextTemplate, preferences.appLanguage).title
          : null,
        canRestart,
      };
    };
    const activeWorkoutPlan = database.workoutPlans.find((plan) => plan.id === preferences.activePlanId) ?? null;
    if (activeWorkoutPlan?.entries.length) {
      const sortedEntries = [...activeWorkoutPlan.entries].sort((left, right) => left.orderIndex - right.orderIndex);
      const firstEntry = sortedEntries[0];
      // A plan can point at either source. Only the database was resolved
      // here, so an adopted READY programme found no template, rendered no
      // hero, and fell through to the recommendation branch — which showed a
      // different programme's day 1 and started it. Removing that fallback is
      // what made this visible.
      const dbTemplate = workoutTemplates.find((template) => template.id === firstEntry.workoutTemplateId) ?? null;
      const readyPlanTemplate = dbTemplate ? null : getWorkoutTemplateById(firstEntry.workoutTemplateId);
      const activeTemplate = dbTemplate ?? readyPlanTemplate;
      const activePlanProgramType = dbTemplate ? ('custom' as const) : ('ready' as const);
      const activeTemplateSessions = dbTemplate
        ? getWorkoutTemplateSessions(dbTemplate.id)
        : (readyPlanTemplate?.sessions ?? []).map((session) => ({
            id: session.id,
            name: session.name,
            orderIndex: session.orderIndex,
            exercises: session.exercises.map((exercise) => ({
              id: exercise.id,
              name: exercise.exerciseName,
              targetSets: exercise.sets,
              repMin: exercise.repsMin,
              repMax: exercise.repsMax,
            })),
          }));
      // One list for the rotation, the labels, the forecast and the counts.
      // An entry naming a session the template lacks is left out of all of
      // them; filtering only the sessions made the indexes below point at
      // different rows (bug hunt, 2026-10-04, see planResolvableEntries).
      const resolvedEntries = resolvablePlanEntries(sortedEntries, activeTemplateSessions);
      const rotationEntries = resolvedEntries.map((resolved) => resolved.entry);
      const orderedPlanSessions = resolvedEntries.map((resolved) => resolved.session);
      // The runtime template is where a custom exercise gets its slot id and
      // substitution group; read them from there rather than rebuilding the
      // rule here, so Home and the session cannot disagree about a slot.
      // Catalog exercises already carry slot, role, tracking mode and rests,
      // so a ready plan reads them straight off the template.
      const activeRuntimeExercises = new Map(
        (dbTemplate
          ? customWorkoutRuntimeMap[dbTemplate.id]?.sessions ?? []
          : readyPlanTemplate?.sessions ?? []
        )
          .flatMap((session) => session.exercises)
          .map((exercise) => [exercise.id, exercise] as const),
      );
      const homeSessions = orderedPlanSessions.map((session, sessionIndex) => {
        // Was `exercises × 10 min`, which ignored both sets and rest. Same
        // formula as the guided entry now, so the two screens agree.
        const durationInputs = session.exercises.map((exercise) => ({
          name: exercise.name,
          slotId: activeRuntimeExercises.get(exercise.id)?.slotId ?? exercise.id,
          role: activeRuntimeExercises.get(exercise.id)?.role ?? 'accessory',
          sets: exercise.targetSets,
          reps: exercise.repMax,
          timed: isTimedTrackingMode(activeRuntimeExercises.get(exercise.id)?.trackingMode ?? 'reps_first'),
          minutes: isMinutesTrackingMode(activeRuntimeExercises.get(exercise.id)?.trackingMode),
          restSeconds: activeRuntimeExercises.get(exercise.id)?.restSecondsMin ?? 90,
          // Home quotes the same number the entry screen does, so it has to
          // know the same thing about rests: a superset rests once per round.
          supersetGroup: activeRuntimeExercises.get(exercise.id)?.supersetGroup ?? null,
        }));
        // Classified here, where the whole session is still in hand — Home
        // receives only the first five exercises below.
        const focusKind = classifySessionFocus(session.exercises.map((exercise) => exercise.name));
        const routineSeconds = routineBlockSeconds(focusKind);
        const estimatedDuration = estimateSessionMinutes({
          exercises: durationInputs,
          ...routineSeconds,
        });
        // Weekday truth (P6): surface the plan's own entry label so week rows
        // land on the user's chosen days, not a generic spread.
        const entryLabel = rotationEntries[sessionIndex]?.label ?? null;

        return {
          id: session.id,
          name: session.name,
          title: formatHomeSessionTitle(session.name, session.exercises),
          duration: `~${estimatedDuration} min`,
          dayLabel: entryLabel,
          totalSets: session.exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0),
          durationMinutes: estimatedDuration,
          focusKind,
          // The whole session, not the first five (user 2026-08-24: "saako
          // treeni osion näkyviin kokonaan"). Home decides what to show and
          // the reader can fold the list; truncating here meant the count in
          // the header and the rows beneath it were two different numbers,
          // and every consumer had to add the hidden ones back to get one.
          exercises: session.exercises.map((exercise) => ({
            name: exercise.name,
            // The template's own id, which is what removing from the programme
            // writes against. The slot id belongs to the runtime and cannot
            // find a row in the stored template.
            exerciseId: exercise.id,
            setsLabel: `${exercise.targetSets} sets`,
            targetSets: exercise.targetSets,
            schemeLabel: formatSetScheme(
              exercise.targetSets,
              exercise.repMin,
              exercise.repMax,
              activeRuntimeExercises.get(exercise.id)?.trackingMode ?? 'reps_first',
            ),
            slotId: activeRuntimeExercises.get(exercise.id)?.slotId,
            substitutionGroup: activeRuntimeExercises.get(exercise.id)?.substitutionGroup,
          })),
        };
      });
      // Was `homeSessions[0]`, always. Finishing day 1 offered day 1 again,
      // and the start button logged the wrong session against the plan.
      const completedForTemplate = completedSessionsForTemplate(firstEntry.workoutTemplateId, completedPlanSessions);
      const nextSessionIndex = resolveNextPlanEntryIndex(rotationEntries, completedForTemplate);
      // Where the rotation stands, for the calendars: they name days from here
      // on by what Home will offer, not by counting calendar days
      // (trainingSchedule forecastSlotOn).
      const sessionForecast = {
        fromDayStart: todayDayStart,
        nextSlot: nextSessionIndex,
        trainedToday: planTrainedOnDay(rotationEntries, completedForTemplate, todayDayStart),
      };
      // The reader's own answer wins for the day they gave it. The rotation
      // knows what comes next in the programme and cannot know that today is
      // legs — but it is right again tomorrow, so the override is dated rather
      // than sticky, and a stale one is ignored instead of cleared.
      //
      // The programme, not the record that happens to hold it: a copy made
      // by editing one lift is the same programme the reader has been
      // training, and every counter below reads this set. The pick reads it
      // too: the catalog reuses session ids across programmes (upper_a in two
      // of them), so an id alone let a pick made in one programme resolve in
      // the one the reader switched to, and a same-id session trained in
      // another programme cancel it (bug hunt, 2026-10-04).
      const planTemplateIds = new Set([
        ...sortedEntries.map((entry) => entry.workoutTemplateId),
        ...(activeTemplate ? [activeTemplate.id] : []),
        ...(activeTemplate
          ? programmeHistoryIds(activeTemplate.id, workoutTemplates, templatesRunByOtherPlans(activeTemplate.id))
          : []),
      ]);
      const pickedToday = resolveTodaySessionPick({
        pick: preferences.todaySession,
        sessions: homeSessions,
        todayDayStart,
        completed: completedPlanSessions,
        toDayStart: toDayStartMs,
        templateIds: planTemplateIds,
      });
      // A day named but not yet filled is not a session to offer: its turn
      // goes to the next day that has something in it (2026-09-26). A pick of
      // an empty day is passed over the same way.
      const startableIndex = nextStartableSessionIndex(
        homeSessions.map((session) => session.exercises.length),
        nextSessionIndex,
      );
      const nextSession =
        (pickedToday && pickedToday.exercises.length > 0 ? pickedToday : null) ??
        (startableIndex === null ? null : homeSessions[startableIndex]) ??
        null;
      if (activeTemplate && nextSession) {
        // Counted from the plan record's own start, not all time. Plan records
        // are only written at onboarding, adoption and restart, so `updatedAt`
        // IS the block boundary — and without it "Uusi kierros" is impossible:
        // an all-time count means a restarted plan is born complete.
        const completedSessionCount = countSessionsSince(
          completedPlanSessions,
          planTemplateIds,
          activeWorkoutPlan.updatedAt,
        );
        // Onboarding-built plans promised a specific block length ("4-week
        // plan") — the Home hero must count the same total, not the generic
        // 8-week default.
        const onboardingBlockWeeks =
          activeWorkoutPlan.id.startsWith(ONBOARDING_PLAN_PREFIX) && setupSelection && preferences.recommendedProgramId
            ? composeProgramWeekForSelection(setupSelection, preferences.recommendedProgramId)?.weeks
            : undefined;
        // The demo tester's block is one week by construction — see
        // handleCreateDemoCompletionProgram.
        const demoBlockWeeks = activeWorkoutPlan.id.startsWith('demo_plan_') ? 1 : undefined;
        // An adopted ready programme carries its own block length — twelve
        // weeks for several of them — and Home counted every one of them as
        // the generic eight. The programme's own page already showed twelve,
        // so the hero said "week 1/8" beside a page saying 12, and the
        // session total under it was a third short.
        // Asked of the programme, not of the record holding it: the copy
        // made by changing one lift keeps this block's start and its
        // sessions, so it keeps its length too — see getProgrammeBlockWeeks.
        const programmeBlockWeeks = getProgrammeBlockWeeks(activeTemplate.id, workoutTemplates, getWorkoutTemplateById);
        const planProgress = buildHomePlanProgress({ language: preferences.appLanguage,
          completedSessions: completedSessionCount,
          sessionsPerWeek: rotationEntries.length,
          totalWeeks: demoBlockWeeks ?? onboardingBlockWeeks ?? programmeBlockWeeks,
        });

        return {
          programId: activeTemplate.id,
          programType: activePlanProgramType,
          // The plan's own templates, so every counter that says "of this
          // plan" can agree on what that means. The week counter used to read
          // all sessions in the week and filled the programme's week with
          // freestyle workouts.
          planTemplateIds: [...planTemplateIds],
          // The boundary every count above is measured from, so a screen
          // asking which week a past session filled counts from the same
          // place the hero does.
          blockStartedAt: activeWorkoutPlan.updatedAt,
          eyebrow: `${rotationEntries.length} day custom plan`,
          goalLabel: formatGoalLabel(preferences.aiPlannerGoal || preferences.setupGoal || 'general'),
          // For a CUSTOM programme the template's name wins, and the plan's
          // copy is only the fallback. Both records hold the name — the plan
          // took its copy the day it was made — and renaming keeps them in
          // step, but that only helps renames made after the fix existed. A
          // reader who renamed on an earlier build was left with the old name
          // on Home for ever, with the programme page showing the new one
          // (user 2026-09-09, "ei vaihtunut kodissa nimi"). Reading the
          // template first heals that, and makes the whole class impossible.
          //
          // A READY programme keeps the plan's name first: there the plan may
          // carry a season's name, which is not the template's at all.
          title: formatWorkoutDisplayLabel(
            activePlanProgramType === 'custom'
              ? activeTemplate.name || activeWorkoutPlan.name
              : activeWorkoutPlan.name || activeTemplate.name,
            'Workout plan',
          ),
          subtitle: `${rotationEntries.length} workouts in rotation.`,
          weekLabel: planProgress.weekLabel,
          progressPercent: planProgress.progressPercent,
          sessionsDone: planProgress.sessionsDone,
          sessionsTotal: planProgress.sessionsTotal,
          currentWeek: planProgress.currentWeek,
          planTotalWeeks: planProgress.totalWeeks,
          focusLabel: getSessionBodyFocusLabel(undefined),
          equipmentLabel: buildSessionEquipmentLabel(
            (orderedPlanSessions[0]?.exercises ?? []).map((exercise) => exercise.name),
            exerciseLibrary,
          ),
          sessionsPerWeek: `${rotationEntries.length}`,
          // The week's own sessions added up: the next session's minutes times
          // the count quoted a week of identical days (bug hunt, 2026-10-04).
          // Days with nothing in them yet cost nothing: the estimate still adds
          // a warm-up and cool-down to an empty day (review, 2026-10-04).
          weeklyMinutes: weeklyMinutesLabel(
            homeSessions.filter((session) => session.exercises.length > 0).map((session) => session.durationMinutes),
          ),
          sessions: homeSessions,
          nextSession: {
            ...nextSession,
            label: 'Week 1 · Day 1',
          },
          // The reader's own answer for today, apart from the rotation's. The
          // widget needs the difference: a pick makes today a training day,
          // the rotation's next session does not.
          todayPickSessionId: pickedToday?.id ?? null,
          sessionForecast,

          // The catalog lookup, not the DB one, but by SOURCE id for a copy:
          // a custom template carries no goal or level for affinity to
          // compare, so looking it up by its own id found nothing and the
          // card offered no step up to a reader who had only edited one lift
          // in a ready programme (#bugs, 2026-09-26) — see programmeCopyLink.
          // A hand-built custom programme still has no source and still gets
          // no step-up card, correctly: there is no "next level" of it.
          // Restart is real here — a plan record exists to reset.
          completion: buildCompletion(
            activeWorkoutPlan.id,
            planProgress.sessionsDone,
            planProgress.sessionsTotal,
            dbTemplate
              ? (dbTemplate.sourceTemplateId ? getWorkoutTemplateById(dbTemplate.sourceTemplateId) : null)
              : readyPlanTemplate,
            true,
          ),
        };
      }
    }

    // No fallback to the recommended programme.
    //
    // This branch used to build the whole hero out of `recommendedProgramId`
    // whenever the reader had no usable plan — which made three separate
    // failures invisible. Removing your last programme left Home showing a
    // programme ("poista ohjelma ei poista"), the demo plan's missing
    // entries fell through to it, and the start button logged sessions
    // against a programme the reader had never adopted.
    //
    // A suggestion is not a plan. Home's no-plan state is honest: no hero,
    // and the start button opens a freestyle session. Picking a programme
    // happens on the Programs tab, which is the one place that can say what
    // adopting it means.
    return null;
  }, [database.workoutPlans, database.workoutSessions, database.exerciseLogs, exerciseLibrary, getWorkoutTemplateSessions, preferences.activePlanId, preferences.aiPlannerGoal, preferences.dismissedCompletionPlanIds, preferences.recommendedProgramId, preferences.setupGoal, preferences.todaySession, preferences.appLanguage, customWorkoutRuntimeMap, routineBlockSeconds, setupSelection, todayStartMs, workoutTemplates]);
  /**
   * The active programme when it has days but none with anything in them.
   *
   * The hero has nothing to offer then, and the card above returns null —
   * which Home drew as having no programme at all: no hero, no week, no
   * counters, for a programme the reader is running (audit 8, 2026-09-26;
   * add an empty day, remove the only filled one). This names it instead,
   * and opens the programme where days are filled. Only an own programme can
   * be emptied; a ready one always has its lifts.
   */
  const homeEmptyProgramme = useMemo(() => {
    if (homeActivePlanCard) {
      return null;
    }
    const plan = database.workoutPlans.find((candidate) => candidate.id === preferences.activePlanId) ?? null;
    const firstEntry = plan ? [...plan.entries].sort((left, right) => left.orderIndex - right.orderIndex)[0] : undefined;
    const template = firstEntry
      ? workoutTemplates.find((candidate) => candidate.id === firstEntry.workoutTemplateId) ?? null
      : null;
    if (!template) {
      return null;
    }
    const counts = getWorkoutTemplateSessions(template.id).map((session) => session.exercises.length);
    return hasOnlyEmptyDays(counts) ? { workoutTemplateId: template.id, title: template.name } : null;
  }, [database.workoutPlans, getWorkoutTemplateSessions, homeActivePlanCard, preferences.activePlanId, workoutTemplates]);
  /**
   * The session Home's card offers, which is what its swaps and left-out rows
   * are held for. Pick another session for today and the card shows that
   * one's own — none, until some are made for it.
   */
  const homeSessionRef: AdaptedSessionRef | null = homeActivePlanCard?.nextSession
    ? { programId: homeActivePlanCard.programId, sessionId: homeActivePlanCard.nextSession.id }
    : null;
  const homeSessionAdaptation = sessionAdaptationFor(homeSessionRef);
  const adaptHomeSession = (change: (current: SessionAdaptation) => SessionAdaptation) => {
    if (homeSessionRef) {
      adaptSession(homeSessionRef, change);
    }
  };
  // The AI tab's opening state. Deterministic, so the most valuable-looking
  // part of the coach costs nothing to render and works offline.
  const progressWeeklyTarget = Number.parseInt(homeActivePlanCard?.sessionsPerWeek ?? '', 10) || null;

  return {
    homeActivePlanCard,
    homeEmptyProgramme,
    homeSessionAdaptation,
    adaptHomeSession,
    progressWeeklyTarget,
  };
}
