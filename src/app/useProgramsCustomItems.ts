import { useMemo } from 'react';

import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { t } from '../lib/i18n';
import { leadTemplateId, listHeldProgrammes } from '../lib/runningProgrammes';
import type { AppDatabase, AppPreferences } from '../types/models';
import type { useCustomProgramViews } from './useCustomProgramViews';

/**
 * "Omat ohjelmasi" on the Programs tab: the programmes the reader built, and
 * every programme they hold, running or switched off, the lead first.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook because the list is a memo, and VinhaApp calls this exactly where
 * the lines stood — after useGoalFlow, before templateBuilderDraft — so every
 * hook keeps its slot. runningProgrammeTitle stays in App.tsx, where Home's
 * programme list asks it too, and is passed in.
 */
export interface ProgramsCustomItemsDeps {
  /** The reader's own programmes, newest first, with their counts. */
  customWorkouts: ReturnType<typeof useCustomProgramViews>['customWorkouts'];
  /** The whole database: the plan records. */
  database: AppDatabase;
  /** The reader's preferences: the lead plan, the held plans and the language. */
  preferences: AppPreferences;
  /** The one name a running programme goes by. */
  runningProgrammeTitle: (templateId: string | null, planName: string | null | undefined, days: number) => string;
}

export function useProgramsCustomItems(deps: ProgramsCustomItemsDeps) {
  const { customWorkouts, database, preferences, runningProgrammeTitle } = deps;

  // Programmes the reader built, not every template in the database: a
  // freestyle log writes a template of its own to hang the session on, and
  // "Omat ohjelmasi" was listing each of those as a programme. Those sessions
  // live in History; the same rule the programme cap already uses.
  const programsCustomItems = useMemo(() => {
    // The Active tag follows the plan Home leads with, read from the plan
    // itself. It was read off Home's hero card, which is null whenever the
    // hero cannot be built — and then no row carried the tag at all.
    const leadingTemplateId = leadTemplateId({ activePlanId: preferences.activePlanId, plans: database.workoutPlans });
    const authored = customWorkouts
      .filter((template) => template.origin !== 'freestyle')
      .map((template) => ({
        id: template.id,
        name: formatWorkoutDisplayLabel(template.name, t(preferences.appLanguage, 'common.customWorkout')),
        // Built in English here, under a Finnish heading, on the tab that
        // sells programs. The key existed the whole time.
        subtitle: t(
          preferences.appLanguage,
          template.sessionCount === 1 ? 'prog.custom.countsOne' : 'prog.custom.counts',
          { sessions: template.sessionCount, exercises: template.exerciseCount },
        ),
        active: leadingTemplateId === template.id,
        programType: 'custom' as const,
      }));

    // The plan you are actually training belongs on this list even when it is
    // a ready programme rather than one you wrote: onboarding's second button
    // adopts the catalog programme without authoring anything, so the reader
    // trained a programme that appeared nowhere under "your programmes".
    // Active first, whether it was authored or adopted (user, 2026-09-01).
    // An authored programme kept its authoring position, so the one you are
    // training could sit third under two you are not — and ACTIVE is a tag you
    // have to read the list to find rather than a place in it.
    //
    // Stable beyond that: the rest keep the order they were written in, so
    // nothing else moves under the reader.
    const leadFirst = <T extends { active: boolean }>(rows: T[]): T[] => [
      ...rows.filter((row) => row.active),
      ...rows.filter((row) => !row.active),
    ];

    // Every RUNNING programme belongs here, not only the one Home leads with.
    //
    // An adopted ready programme has no row of its own in `workoutTemplates`
    // — adoption points a plan at the catalog rather than copying it — so it
    // was listed only while it was the leader. Making a second programme lead
    // dropped it out of the one list called "your programmes" while it kept
    // running and kept holding a slot against the programme cap: a reader at
    // the cap could be blocked by a programme this screen would not show them
    // (user 2026-09-07, "laitoin advanced glutes nayta kodissa niin tama
    // strong ohjelma katosi kokonaan").
    //
    // Home already listed them under its hero, and its own removal copy says
    // "it stays in Programs" — a promise this list could not keep.
    const authoredIds = authored.map((item) => item.id);
    // And every programme the reader HOLDS, running or not: switching one off
    // is not deleting it, and a list that dropped it made the switch look
    // like a delete (device, 2026-09-16).
    const runningRows = listHeldProgrammes({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
      authoredTemplateIds: authoredIds,
    })
      .map((row) => {
        // Only what the catalog can actually open. A plan pointing at a custom
        // template the reader has since deleted is neither authored nor ready,
        // and a row for it would navigate to a programme that is not there.
        const template = getWorkoutTemplateById(row.templateId);
        if (!template) {
          return null;
        }
        // The SAME question the authored rows ask, so one list cannot hold two
        // notions of "active" and mark a row by each.
        const active = leadingTemplateId === row.templateId;
        return {
          id: row.templateId,
          name: runningProgrammeTitle(row.templateId, row.planName, template.daysPerWeek),
          /**
           * "The programme you are training right now" is a claim about ONE
           * row, and this list can now hold several running programmes. Said
           * on every one of them it contradicted the ACTIVE tag beside it,
           * which only the leader carries (review, 2026-09-07). A programme
           * that runs without leading gets the neutral line the same
           * programmes already carry under Home's hero.
           */
          subtitle: active
            ? t(preferences.appLanguage, 'programs.activeSubtitle')
            : row.running
              ? t(preferences.appLanguage, 'programs.card.days', { count: template.daysPerWeek })
              : t(preferences.appLanguage, 'programs.card.switchedOff'),
          active,
          programType: 'ready' as const,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return leadFirst([...runningRows, ...authored]);
  }, [
    customWorkouts,
    database.workoutPlans,
    preferences.activePlanId,
    preferences.activePlanIds,
    preferences.appLanguage,
    runningProgrammeTitle,
  ]);

  return {
    programsCustomItems,
  };
}
