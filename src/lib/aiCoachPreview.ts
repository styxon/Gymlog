import { classifyCoachScope } from './aiCoachScope';
import { hasWord, hasWordStart } from './wordMatch';
import { I18nKey, t } from './i18n';
import { liftGroupOf } from './liftIdentity';
import { AICoachAdvice, AICoachPlateauSummary, AICoachTrainingContext } from '../types/aiCoach';
import { AppLanguage } from '../types/models';
import { applyDecimalSeparator, removeTrailingZeros, withNumberLanguage } from './format';
import { exerciseNameLabel } from './exerciseNameLabel';

/**
 * The offline coach.
 *
 * This is not a fallback in practice — the endpoint is not deployed, so every
 * install answers from here. It shipped hardcoded in English inside a Finnish
 * app, which meant the paid feature spoke the wrong language to every user who
 * tried it. Every string now goes through the dictionary.
 *
 * The rules are the live coach's rules: no number that is not in the context,
 * no comment on a signal the window cannot support, and every answer says it
 * is a preview.
 */

function formatActiveContext(context: AICoachTrainingContext, language: AppLanguage) {
  if (!context.activeSession) return null;
  if (context.activeSession.nextExercise) {
    return t(language, 'coachPreview.nowNext', {
      title: context.activeSession.title,
      next: exerciseNameLabel(language, context.activeSession.nextExercise),
    });
  }
  return t(language, 'coachPreview.now', { title: context.activeSession.title });
}

function formatLiftLine(context: AICoachTrainingContext, language: AppLanguage) {
  const firstLift = context.trackedLifts[0];
  if (!firstLift) return null;
  const latest =
    firstLift.latestWeight !== null
      ? `${removeTrailingZeros(firstLift.latestWeight)} ${context.unitPreference}`
      : t(language, 'coachPreview.noLoad');
  return `${exerciseNameLabel(language, firstLift.name)}: ${latest} × ${firstLift.latestReps}`;
}

function formatTopSetLine(context: AICoachTrainingContext, language: AppLanguage) {
  const latestTopSet = context.latestTopSets[0];
  if (!latestTopSet) return null;
  const weight =
    latestTopSet.weight !== null
      ? `${removeTrailingZeros(latestTopSet.weight)} ${context.unitPreference}`
      : t(language, 'coachPreview.noLoad');
  return `${exerciseNameLabel(language, latestTopSet.exerciseName)}: ${weight} × ${latestTopSet.reps}`;
}

function formatRecentSessionLine(context: AICoachTrainingContext, language: AppLanguage) {
  const session = context.recentCompletedSessions[0];
  if (!session) return null;
  return t(language, 'coachPreview.last', { title: session.title });
}

/**
 * The lifts a question names, as lift groups. Finnish stems are the ones that
 * mean the lift and not the furniture: "penkki" and "penkin" are the bench
 * press, "penkillä" is sitting on one.
 */
const ASKED_LIFTS: ReadonlyArray<{ liftName: string; stems: readonly string[] }> = [
  { liftName: 'bench press', stems: ['bench', 'penkki', 'penkin'] },
  { liftName: 'squat', stems: ['squat', 'kyyk'] },
  { liftName: 'deadlift', stems: ['deadlift', 'maastaveto', 'maastaved', 'maasta'] },
];

function askedLiftGroups(lower: string): number[] {
  return ASKED_LIFTS.filter((lift) => lift.stems.some((stem) => hasWordStart(lower, stem)))
    .map((lift) => liftGroupOf(lift.liftName))
    .filter((group): group is number => group !== null);
}

/** A question about the programme or its split. */
function namesProgramme(lower: string): boolean {
  return lower.includes('program') || lower.includes('ohjelma') || lower.includes('split') || lower.includes('treenijako');
}

/** Words every kind of lift shares; matching on them is matching on nothing. */
const SHARED_EXERCISE_WORDS = new Set(['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'smith', 'band', 'press', 'seated', 'standing']);

function findMatchingPlateau(lower: string, context: AICoachTrainingContext) {
  const groups = askedLiftGroups(lower);
  return context.plateaus.find((p) => {
    // The same lift under any spelling: "kyykky jumissa" finds a Back Squat.
    const group = liftGroupOf(p.name);
    if (group !== null && groups.includes(group)) return true;
    if (hasWordStart(lower, p.exerciseKey)) return true;
    // A distinctive word of the name — "barbell" made "my barbell bench"
    // answer about Barbell Row.
    return p.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.length >= 4 && !SHARED_EXERCISE_WORDS.has(word) && hasWordStart(lower, word));
  });
}

/** The load level in the reader's language, not the model's English token. */
function signalLabel(signal: AICoachTrainingContext['fatigue']['signal'], language: AppLanguage) {
  return t(language, `coachPreview.signal.${signal}` as I18nKey);
}

function plateauWeight(p: AICoachPlateauSummary, unit: string, language: AppLanguage) {
  return p.topWeightKg !== null
    ? `${removeTrailingZeros(p.topWeightKg)} ${unit}`
    : t(language, 'coachPreview.sameWeight');
}

/** Finnish needs its own singular; one key per case is the only honest way. */
function sessionsWord(count: number, language: AppLanguage) {
  return count === 1
    ? t(language, 'coachPreview.sessionOne')
    : t(language, 'coachPreview.sessionMany', { count });
}

function previewAssumption(language: AppLanguage) {
  return t(language, 'coachPreview.assume.preview');
}

function buildCombinedResponse(
  prompt: string,
  plateau: AICoachPlateauSummary,
  context: AICoachTrainingContext,
  language: AppLanguage,
): AICoachAdvice {
  const { acwr, recoveryScore, signal } = context.fatigue;
  const weight = plateauWeight(plateau, context.unitPreference, language);
  return {
    takeaway: t(language, 'coachPreview.combined.takeaway', { lift: exerciseNameLabel(language, plateau.name) }),
    why: [
      t(language, 'coachPreview.combined.why1', {
        lift: exerciseNameLabel(language, plateau.name),
        weight,
        count: plateau.stagnantSessions,
      }),
      t(language, 'coachPreview.combined.why2', { signal: signalLabel(signal, language), acwr: applyDecimalSeparator(`${acwr}`), recovery: recoveryScore }),
      t(language, 'coachPreview.combined.why3'),
    ],
    nextSteps: [
      t(language, 'coachPreview.combined.next1'),
      t(language, 'coachPreview.combined.next2', { lift: exerciseNameLabel(language, plateau.name) }),
      t(language, 'coachPreview.combined.next3'),
    ],
    plan: [
      t(language, 'coachPreview.combined.plan1'),
      t(language, 'coachPreview.combined.plan2', { lift: exerciseNameLabel(language, plateau.name) }),
      t(language, 'coachPreview.combined.plan3'),
    ],
    assumptions: [previewAssumption(language), t(language, 'coachPreview.assume.deload')],
  };
}

function buildPlateauResponse(
  prompt: string,
  plateau: AICoachPlateauSummary,
  context: AICoachTrainingContext,
  language: AppLanguage,
): AICoachAdvice {
  const weight = plateauWeight(plateau, context.unitPreference, language);
  const extraPlateaus = context.plateaus.length - 1;
  return {
    takeaway: t(language, 'coachPreview.plateau.takeaway', {
      lift: exerciseNameLabel(language, plateau.name),
      count: plateau.stagnantSessions,
    }),
    why: [
      t(language, 'coachPreview.plateau.why1', { count: plateau.stagnantSessions, weight }),
      t(language, 'coachPreview.plateau.why2'),
      extraPlateaus > 0
        ? extraPlateaus === 1
          ? t(language, 'coachPreview.plateau.why3One')
          : t(language, 'coachPreview.plateau.why3Many', { count: extraPlateaus })
        : t(language, 'coachPreview.plateau.why3None', { count: context.sessionsThisWeek }),
    ],
    nextSteps: [
      t(language, 'coachPreview.plateau.next1', { lift: exerciseNameLabel(language, plateau.name) }),
      t(language, 'coachPreview.plateau.next2'),
      t(language, 'coachPreview.plateau.next3'),
    ],
    plan: [
      t(language, 'coachPreview.plateau.plan1'),
      t(language, 'coachPreview.plateau.plan2'),
      t(language, 'coachPreview.plateau.plan3'),
    ],
    assumptions: [
      previewAssumption(language),
      t(language, 'coachPreview.assume.plateau', { count: plateau.stagnantSessions }),
    ],
  };
}

function buildHighFatigueResponse(
  prompt: string,
  context: AICoachTrainingContext,
  language: AppLanguage,
): AICoachAdvice {
  const { acwr, recoveryScore, sessionCount7d, signal } = context.fatigue;
  return {
    takeaway: t(
      language,
      signal === 'high' ? 'coachPreview.fatigue.takeawayHigh' : 'coachPreview.fatigue.takeawayElevated',
    ),
    why: [
      t(language, 'coachPreview.fatigue.why1', { acwr: applyDecimalSeparator(`${acwr}`), signal: signalLabel(signal, language) }),
      t(language, 'coachPreview.fatigue.why2', { recovery: recoveryScore }),
      t(language, 'coachPreview.fatigue.why3', { sessions: sessionsWord(sessionCount7d, language) }),
    ],
    nextSteps: [
      t(language, 'coachPreview.fatigue.next1'),
      t(language, 'coachPreview.fatigue.next2'),
      t(language, 'coachPreview.fatigue.next3'),
    ],
    plan: [
      t(language, 'coachPreview.fatigue.plan1'),
      t(language, 'coachPreview.fatigue.plan2'),
      t(language, 'coachPreview.fatigue.plan3'),
    ],
    assumptions: [previewAssumption(language), t(language, 'coachPreview.assume.volume28')],
  };
}

/** The offline answer, its numbers in the answer's own language — see withNumberLanguage. */
export function buildAiCoachPreviewAnswer(
  prompt: string,
  context: AICoachTrainingContext,
  language: AppLanguage = 'en',
): AICoachAdvice {
  return withNumberLanguage(language, () => buildPreviewAnswer(prompt, context, language));
}

function buildPreviewAnswer(
  prompt: string,
  context: AICoachTrainingContext,
  language: AppLanguage,
): AICoachAdvice {
  /**
   * The scope rule, before any answer is built.
   *
   * Offline there is no model to apply COACH_SYSTEM_RULES, so the mock
   * answered everything: a question about the weather came back as a recovery
   * reading with the reader's own numbers in it. Two things are refused here
   * — a subject that cannot be a training question, and a reader in trouble,
   * who gets a person's answer and a number to call rather than sets and
   * reps.
   */
  const scope = classifyCoachScope(prompt);
  if (scope === 'crisis') {
    return {
      takeaway: t(language, 'coachPreview.crisis.takeaway'),
      why: [t(language, 'coachPreview.crisis.why1')],
      nextSteps: [t(language, 'coachPreview.crisis.next1'), t(language, 'coachPreview.crisis.next2')],
      plan: [],
      assumptions: [],
    };
  }
  if (scope === 'off_topic') {
    return {
      takeaway: t(language, 'coachPreview.offTopic.takeaway'),
      why: [],
      nextSteps: [t(language, 'coachPreview.offTopic.next1')],
      plan: [],
      assumptions: [],
    };
  }

  const lower = prompt.toLowerCase();
  const activeContext = formatActiveContext(context, language);
  const liftLine = formatLiftLine(context, language);
  const topSetLine = formatTopSetLine(context, language);
  const recentSessionLine = formatRecentSessionLine(context, language);

  // Only call the load high when the window actually supports it; otherwise a
  // first-ever workout reads as a 4x spike and the coach tells a beginner to
  // cut volume.
  const hasHighFatigue =
    context.fatigue.confident &&
    (context.fatigue.signal === 'elevated' || context.fatigue.signal === 'high');
  const hasPlateau = context.plateaus.length > 0;
  const primaryPlateau = context.plateaus[0];

  // Running questions bypass all context signals — different domain.
  //
  // Whole words, not substrings: `includes('run')` sent "crunches", "runsaasti
  // proteiinia", "rungon lihakset", "runo", "perunaa" and "brunssi" to a
  // 20 km running plan.
  if (
    lower.includes('20 km') ||
    hasWordStart(lower, 'juosta') ||
    hasWordStart(lower, 'juoks') ||
    hasWord(lower, 'run') ||
    hasWord(lower, 'runs') ||
    hasWordStart(lower, 'running') ||
    hasWordStart(lower, 'runner') ||
    hasWordStart(lower, 'challenge')
  ) {
    return {
      takeaway: t(language, 'coachPreview.run.takeaway'),
      why: [
        t(language, 'coachPreview.run.why1'),
        t(language, 'coachPreview.run.why2'),
        t(language, 'coachPreview.run.why3', { count: context.sessionsLast30Days }),
      ],
      nextSteps: [
        t(language, 'coachPreview.run.next1'),
        t(language, 'coachPreview.run.next2'),
        t(language, 'coachPreview.run.next3'),
      ],
      plan: [
        t(language, 'coachPreview.run.plan1'),
        t(language, 'coachPreview.run.plan2'),
        t(language, 'coachPreview.run.plan3'),
        t(language, 'coachPreview.run.plan4'),
      ],
      assumptions: [previewAssumption(language), t(language, 'coachPreview.assume.runBase')],
    };
  }

  // The app's own quick-ask chips come before the reader's signals. With a
  // plateau on record, "Analysoi viime treenini" and "Paljonko proteiinia
  // tavoitteeseeni?" both answered with the bench plateau; with load up,
  // "Analyze my last workout" answered "take a lighter week".
  //
  // "Analyse my last workout" is one of the app's own quick-ask chips, and it
  // matched nothing — so tapping it spent a free question and answered "ask a
  // clearer question". Everything below is read from the stored session.
  //
  // "Analyse" alone is not the chip, though: "Analysoi ohjelmani" and
  // "analysoi penkki" ask about the programme and the lift, which have their
  // own answers below — and got a summary of the last session (2026-09-16).
  const asksLastSession =
    lower.includes('viime treeni') ||
    lower.includes('edellinen treeni') ||
    lower.includes('last workout') ||
    lower.includes('last session');
  const asksBareAnalysis =
    (hasWordStart(lower, 'analys') || hasWordStart(lower, 'analyz')) &&
    !namesProgramme(lower) &&
    askedLiftGroups(lower).length === 0;
  if (asksLastSession || asksBareAnalysis) {
    const session = context.recentCompletedSessions[0];
    if (!session) {
      return {
        unanswered: true,
        takeaway: t(language, 'coachPreview.lastSession.noneTakeaway'),
        why: [t(language, 'coachPreview.lastSession.noneWhy')],
        nextSteps: [t(language, 'coachPreview.lastSession.noneNext')],
        plan: [],
        assumptions: [previewAssumption(language)],
      };
    }

    const shape = [
      session.setsCompleted !== null
        ? t(language, 'coachPreview.lastSession.sets', { count: session.setsCompleted })
        : null,
      session.durationMinutes !== null
        ? t(language, 'coachPreview.lastSession.minutes', { count: session.durationMinutes })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      takeaway: t(language, 'coachPreview.lastSession.takeaway', { title: session.title }),
      why: [
        shape || t(language, 'coachPreview.lastSession.noShape'),
        topSetLine
          ? t(language, 'coachPreview.lastSession.topSet', { line: topSetLine })
          : t(language, 'coachPreview.lastSession.noTopSet'),
        t(language, 'coachPreview.lastSession.rhythm', {
          week: context.sessionsThisWeek,
          month: context.sessionsLast30Days,
        }),
      ],
      nextSteps: [
        hasPlateau && primaryPlateau
          ? t(language, 'coachPreview.lastSession.nextPlateau', { name: exerciseNameLabel(language, primaryPlateau.name) })
          : t(language, 'coachPreview.lastSession.next1'),
        hasHighFatigue
          ? t(language, 'coachPreview.lastSession.nextFatigue')
          : t(language, 'coachPreview.lastSession.next2'),
        session.swappedExercises > 0
          ? t(language, 'coachPreview.lastSession.nextSwaps', { count: session.swappedExercises })
          : t(language, 'coachPreview.lastSession.next3'),
      ],
      plan: [
        t(language, 'coachPreview.lastSession.plan1'),
        t(language, 'coachPreview.lastSession.plan2'),
      ],
      assumptions: [previewAssumption(language)],
    };
  }

  // The chips a reader sees before their first sessions and while they settle
  // in (lib/coachQuickAsks). Each one is a question the app asks for them, so
  // each one has to land here and not on "ask a clearer question" — and
  // before the context signals, for the reason the last-session one is.
  if (/mistä (kannattaa|pitäisi|voisin|voin) aloittaa|where (should|do) i start|how do i (get )?start/.test(lower)) {
    const programmeName = context.programme?.title ?? context.customProgramTitle ?? null;
    return {
      takeaway: t(language, 'coachPreview.start.takeaway'),
      why: [
        programmeName
          ? t(language, 'coachPreview.start.whyProgram', { name: programmeName })
          : t(language, 'coachPreview.start.whyNoProgram'),
        t(language, 'coachPreview.start.why2'),
      ],
      nextSteps: [
        t(language, 'coachPreview.start.next1'),
        t(language, 'coachPreview.start.next2'),
        t(language, 'coachPreview.start.next3'),
      ],
      plan: [t(language, 'coachPreview.start.plan1'), t(language, 'coachPreview.start.plan2')],
      assumptions: [previewAssumption(language)],
    };
  }

  // A programme question only: "mikä liike sopii minulle polvivaivan kanssa"
  // is a lift question and belongs to the branches below.
  if (namesProgramme(lower) && /sopii minulle|suits me|which program(me)? (should|is right|fits)/.test(lower)) {
    return {
      takeaway: t(language, 'coachPreview.whichProgram.takeaway'),
      why: [
        t(language, 'coachPreview.whichProgram.why1'),
        context.recommendedProgramTitle
          ? t(language, 'coachPreview.whichProgram.whyRecommended', { title: context.recommendedProgramTitle })
          : t(language, 'coachPreview.program.why2', { count: context.readyProgramCount }),
      ],
      nextSteps: [
        t(language, 'coachPreview.whichProgram.next1'),
        t(language, 'coachPreview.whichProgram.next2'),
        t(language, 'coachPreview.whichProgram.next3'),
      ],
      plan: [],
      assumptions: [previewAssumption(language)],
    };
  }

  if (hasWordStart(lower, 'aloituspain') || /starting weights?|aloitus ?painot?/.test(lower)) {
    return {
      takeaway: t(language, 'coachPreview.startingWeights.takeaway'),
      why: [t(language, 'coachPreview.startingWeights.why1'), t(language, 'coachPreview.startingWeights.why2')],
      nextSteps: [
        t(language, 'coachPreview.startingWeights.next1'),
        t(language, 'coachPreview.startingWeights.next2'),
        t(language, 'coachPreview.startingWeights.next3'),
      ],
      plan: [],
      assumptions: [previewAssumption(language)],
    };
  }

  if (/milloin (lisään|lisätä|nostan|nostaa) painoa|when (do|should) i (add|increase) (the )?weight/.test(lower)) {
    const pounds = context.unitPreference === 'lb';
    return {
      takeaway: t(language, 'coachPreview.addWeight.takeaway'),
      why: [
        t(language, 'coachPreview.addWeight.why1'),
        topSetLine ?? liftLine ?? t(language, 'coachPreview.addWeight.why2None'),
      ],
      nextSteps: [
        t(language, 'coachPreview.addWeight.next1', { step: applyDecimalSeparator(pounds ? '2.5–5 lb' : '1–2.5 kg') }),
        t(language, 'coachPreview.addWeight.next2', { step: applyDecimalSeparator(pounds ? '5–10 lb' : '2.5–5 kg') }),
        t(language, 'coachPreview.addWeight.next3'),
      ],
      plan: [],
      assumptions: [previewAssumption(language)],
    };
  }

  if (/miten viikko(ni)? (meni|on mennyt)|how (did|was) my week/.test(lower)) {
    if (context.sessionsLast30Days === 0) {
      return {
        unanswered: true,
        takeaway: t(language, 'coachPreview.week.noneTakeaway'),
        why: [],
        nextSteps: [t(language, 'coachPreview.week.noneNext')],
        plan: [],
        assumptions: [previewAssumption(language)],
      };
    }
    const { signal, confident } = context.fatigue;
    const isHigh = signal === 'elevated' || signal === 'high';
    return {
      takeaway:
        context.sessionsThisWeek === 0
          ? t(language, 'coachPreview.week.takeawayZero')
          : t(language, 'coachPreview.week.takeaway', { sessions: sessionsWord(context.sessionsThisWeek, language) }),
      why: [
        t(language, 'coachPreview.week.why1', { sessions: sessionsWord(context.sessionsLast30Days, language) }),
        confident
          ? t(language, 'coachPreview.week.why2', { signal: signalLabel(signal, language) })
          : t(language, 'coachPreview.week.why2Thin'),
        ...(recentSessionLine ? [recentSessionLine] : []),
      ],
      // The load reading drives the step only when the window supports it —
      // the rule the file opens with.
      nextSteps: [
        t(
          language,
          !confident
            ? 'coachPreview.start.next3'
            : isHigh
              ? 'coachPreview.week.nextHigh'
              : signal === 'undertrained'
                ? 'coachPreview.week.nextLow'
                : 'coachPreview.week.nextOk',
        ),
      ],
      plan: [],
      assumptions: [previewAssumption(language)],
    };
  }

  // "How much protein?" — the other chip that matched nothing. Vinha does not
  // track food, and the honest answer says so before it says anything else.
  // Before recovery, too: "protein for recovery" is a food question.
  if (
    hasWordStart(lower, 'proteiin') ||
    hasWordStart(lower, 'protein') ||
    hasWordStart(lower, 'ravinto') ||
    hasWordStart(lower, 'kalori') ||
    hasWordStart(lower, 'calorie') ||
    hasWordStart(lower, 'nutrition') ||
    hasWordStart(lower, 'syöd')
  ) {
    return {
      takeaway: t(language, 'coachPreview.protein.takeaway'),
      why: [
        t(language, 'coachPreview.protein.why1'),
        t(language, 'coachPreview.protein.why2'),
        t(language, 'coachPreview.protein.why3'),
      ],
      nextSteps: [
        t(language, 'coachPreview.protein.next1'),
        t(language, 'coachPreview.protein.next2'),
        t(language, 'coachPreview.protein.next3'),
      ],
      plan: [t(language, 'coachPreview.protein.plan1'), t(language, 'coachPreview.protein.plan2')],
      assumptions: [previewAssumption(language), t(language, 'coachPreview.protein.assume')],
    };
  }

  // Explicit recovery question: the load breakdown, when there is enough
  // history to have one. Rest between sets is not this question.
  const asksRestBetweenSets = /sarjojen väli|between sets/.test(lower);
  if (
    !asksRestBetweenSets &&
    (hasWordStart(lower, 'palautu') ||
      hasWordStart(lower, 'väsy') ||
      hasWordStart(lower, 'recover') ||
      hasWordStart(lower, 'fatigue') ||
      hasWordStart(lower, 'tired') ||
      hasWordStart(lower, 'overtrain'))
  ) {
    // The rule the file opens with, applied here too: one first-ever session
    // answered "cut volume 30–40 %, ACWR 4, recovery 0/100".
    if (!context.fatigue.confident) {
      return {
        unanswered: true,
        takeaway: t(language, 'coachPreview.recovery.thinTakeaway'),
        why: [t(language, 'coachPreview.recovery.thinWhy')],
        nextSteps: [t(language, 'coachPreview.recovery.thinNext')],
        plan: [],
        assumptions: [previewAssumption(language)],
      };
    }
    const { signal, acwr, recoveryScore, sessionCount7d } = context.fatigue;
    const isHigh = signal === 'elevated' || signal === 'high';
    return {
      takeaway: t(
        language,
        isHigh
          ? 'coachPreview.recovery.takeawayHigh'
          : signal === 'undertrained'
            ? 'coachPreview.recovery.takeawayLow'
            : 'coachPreview.recovery.takeawayOk',
      ),
      why: [
        t(
          language,
          signal === 'high'
            ? 'coachPreview.recovery.why1High'
            : signal === 'elevated'
              ? 'coachPreview.recovery.why1Elevated'
              : signal === 'undertrained'
                ? 'coachPreview.recovery.why1Under'
                : 'coachPreview.recovery.why1Ok',
          // The app's decimal separator, like every other ACWR line here.
          { acwr: applyDecimalSeparator(`${acwr}`) },
        ),
        t(language, 'coachPreview.fatigue.why2', { recovery: recoveryScore }),
        t(language, 'coachPreview.recovery.why3', { sessions: sessionsWord(sessionCount7d, language) }),
      ],
      nextSteps: isHigh
        ? [
            t(language, 'coachPreview.recovery.highNext1'),
            t(language, 'coachPreview.recovery.highNext2'),
            t(language, 'coachPreview.recovery.highNext3'),
          ]
        : signal === 'undertrained'
          ? [
              t(language, 'coachPreview.recovery.lowNext1'),
              t(language, 'coachPreview.recovery.lowNext2'),
              t(language, 'coachPreview.recovery.lowNext3'),
            ]
          : [
              t(language, 'coachPreview.recovery.okNext1'),
              t(language, 'coachPreview.recovery.okNext2'),
              t(language, 'coachPreview.recovery.okNext3'),
            ],
      plan: isHigh
        ? [
            t(language, 'coachPreview.recovery.highPlan1'),
            t(language, 'coachPreview.recovery.highPlan2'),
            t(language, 'coachPreview.recovery.highPlan3'),
          ]
        : [t(language, 'coachPreview.recovery.okPlan1'), t(language, 'coachPreview.recovery.okPlan2')],
      assumptions: [previewAssumption(language), t(language, 'coachPreview.assume.volume')],
    };
  }

  // Specific lift question — check for matching plateau, then fatigue
  if (askedLiftGroups(lower).length > 0) {
    const plateau = findMatchingPlateau(lower, context);

    if (plateau && hasHighFatigue) {
      return buildCombinedResponse(prompt, plateau, context, language);
    }

    if (plateau) {
      return buildPlateauResponse(prompt, plateau, context, language);
    }

    return {
      takeaway: t(language, 'coachPreview.lift.takeaway'),
      why: [
        t(language, 'coachPreview.lift.why1'),
        t(language, 'coachPreview.lift.why2', { count: context.sessionsThisWeek }),
        topSetLine ?? liftLine ?? t(language, 'coachPreview.lift.why3Fallback'),
      ],
      nextSteps: [
        t(language, 'coachPreview.lift.next1'),
        t(language, 'coachPreview.lift.next2'),
        t(language, 'coachPreview.lift.next3'),
      ],
      plan: [
        t(language, 'coachPreview.lift.plan1'),
        t(language, 'coachPreview.lift.plan2'),
        t(language, 'coachPreview.lift.plan3'),
      ],
      assumptions: [previewAssumption(language)],
    };
  }

  // Context-priority for general questions: fires before program/default branches
  if (hasHighFatigue && hasPlateau) {
    return buildCombinedResponse(prompt, primaryPlateau, context, language);
  }

  if (hasHighFatigue) {
    return buildHighFatigueResponse(prompt, context, language);
  }

  if (hasPlateau) {
    return buildPlateauResponse(prompt, primaryPlateau, context, language);
  }

  // Program or split question — no urgent signals, give structural advice
  if (namesProgramme(lower)) {
    const plateauNames = context.plateaus
      .map((p) => exerciseNameLabel(language, p.name))
      .join(', ');
    return {
      takeaway: t(language, 'coachPreview.program.takeaway'),
      why: [
        t(language, 'coachPreview.program.why1'),
        t(language, 'coachPreview.program.why2', { count: context.readyProgramCount }),
        plateauNames
          ? t(language, 'coachPreview.program.why3Stuck', { lifts: plateauNames })
          : (activeContext ?? recentSessionLine ?? t(language, 'coachPreview.program.why3Fallback')),
      ],
      nextSteps: [
        t(language, 'coachPreview.program.next1'),
        t(language, 'coachPreview.program.next2'),
        t(language, 'coachPreview.program.next3'),
      ],
      plan: [
        t(language, 'coachPreview.program.plan1'),
        t(language, 'coachPreview.program.plan2'),
        t(language, 'coachPreview.program.plan3'),
      ],
      assumptions: [previewAssumption(language)],
    };
  }

  // Default — no signals, no keywords matched. Flagged so the free tier does
  // not spend one of its three weekly questions on "ask a clearer question".
  return {
    unanswered: true,
    takeaway: t(language, 'coachPreview.default.takeaway'),
    why: [
      t(language, 'coachPreview.default.why1'),
      t(language, 'coachPreview.default.why2', {
        month: context.sessionsLast30Days,
        week: context.sessionsThisWeek,
      }),
      activeContext ?? recentSessionLine ?? t(language, 'coachPreview.default.why3Fallback'),
    ],
    nextSteps: [
      t(language, 'coachPreview.default.next1'),
      t(language, 'coachPreview.default.next2'),
      t(language, 'coachPreview.default.next3'),
    ],
    plan: [
      t(language, 'coachPreview.default.plan1'),
      t(language, 'coachPreview.default.plan2'),
      t(language, 'coachPreview.default.plan3'),
    ],
    assumptions: [previewAssumption(language)],
  };
}
