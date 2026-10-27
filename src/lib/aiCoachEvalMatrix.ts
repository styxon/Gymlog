import { AICoachAdvice } from '../types/aiCoach';
import { BodyweightEntry, CoachGoal, ExerciseLog, MeasurementEntry, WorkoutSession } from '../types/models';
import { AiCoachEvalCase, EvalCaseResult, EvalCheckResult, scoreCase } from './aiCoachEval';
import { buildEvalContext, PRESCRIPTION_FIGURES } from './aiCoachEvalCases';

/**
 * The scenario matrix: many readers, many questions, one live run.
 *
 * The seed set in aiCoachEvalCases.ts guards rules we already found broken.
 * This set is for finding the ones we have not: eleven reader profiles, each
 * built through the same buildAiTrainingContext the app ships, crossed with
 * the questions people actually bring to a coach — analyse, why no progress,
 * am I overdoing it, food, injury, off-topic, a bare follow-up.
 *
 * It is sized to a budget, not to coverage. One live call costs roughly
 * $0.03-0.05 on Sonnet 5 at medium effort, and the same balance pays for
 * real readers' questions, so the set stays near forty cases and the runner
 * refuses to spend past a cap.
 *
 * The mechanical checks only catch what a regex can: an invented figure, a
 * set dump, the wrong language, a takeaway that runs on. Whether the advice
 * is any good is read by a person from the saved answers.
 */

/** Same clock as the seed set, so both read the same "today". */
const NOW = Date.parse('2026-07-28T09:00:00.000Z');

/** Calendar-day steps in UTC — no fixed-millisecond day arithmetic. */
function at(daysAgo: number): string {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}

type Lift = { name: string; weight: number; reps: number[] };

function sessionWith(
  id: string,
  name: string,
  daysAgo: number,
  lifts: Lift[],
  durationMinutes = 55,
): { session: WorkoutSession; logs: ExerciseLog[] } {
  const logs = lifts.map((lift, index) => ({
    id: `${id}-${index}`,
    sessionId: id,
    exerciseTemplateId: null,
    exerciseNameSnapshot: lift.name,
    weight: lift.weight,
    repsPerSet: lift.reps,
    tracked: true,
    orderIndex: index,
  }));
  const totalVolumeKg = lifts.reduce(
    (sum, lift) => sum + lift.weight * lift.reps.reduce((reps, value) => reps + value, 0),
    0,
  );
  return {
    session: {
      id,
      workoutTemplateId: 'tpl',
      workoutNameSnapshot: name,
      performedAt: at(daysAgo),
      durationMinutes,
      setsCompleted: lifts.reduce((sum, lift) => sum + lift.reps.length, 0),
      totalVolumeKg,
    },
    logs,
  };
}

function history(entries: Array<{ session: WorkoutSession; logs: ExerciseLog[] }>) {
  return {
    sessions: entries.map((entry) => entry.session),
    logs: entries.flatMap((entry) => entry.logs),
  };
}

// ── Profiles ────────────────────────────────────────────────────────────────

/** A. Nothing logged yet. */
const emptyReader = buildEvalContext([], []);

/** B. One session, yesterday. */
const singleHistory = history([
  sessionWith('b0', 'Full Body', 1, [
    { name: 'Barbell Squat', weight: 60, reps: [8, 8, 8] },
    { name: 'Bench Press', weight: 50, reps: [8, 8, 7] },
  ]),
]);
const singleReader = buildEvalContext(singleHistory.sessions, singleHistory.logs);

/** C. Four weeks in, three times a week, every lift climbing. */
const beginnerHistory = history(
  Array.from({ length: 12 }, (_, index) => {
    const step = 11 - index; // 0 = oldest
    return sessionWith(`c${index}`, 'Full Body', index * 2 + (index > 5 ? 2 : 0), [
      { name: 'Barbell Squat', weight: 60 + step * 2.5, reps: [5, 5, 5] },
      { name: 'Bench Press', weight: 45 + step * 1.25, reps: [5, 5, 5] },
      { name: 'Barbell Row', weight: 40 + step * 1.25, reps: [8, 8, 8] },
    ]);
  }),
);
const beginnerReader = buildEvalContext(beginnerHistory.sessions, beginnerHistory.logs, ['mon', 'wed', 'fri']);

/** D. Six weeks: squat climbs, bench has sat at 82.5 kg the whole time. */
const stalledHistory = history(
  Array.from({ length: 12 }, (_, index) => {
    const step = 11 - index;
    return index % 2 === 0
      ? sessionWith(`d${index}`, 'Push', index * 3 + 1, [
          { name: 'Bench Press', weight: 82.5, reps: [5, 5, 4] },
          { name: 'Overhead Press', weight: 50, reps: [6, 6, 6] },
          { name: 'Triceps Pushdown', weight: 30, reps: [12, 12, 12] },
        ])
      : sessionWith(`d${index}`, 'Legs', index * 3 + 1, [
          { name: 'Barbell Squat', weight: 110 + step * 2.5, reps: [5, 5, 5] },
          { name: 'Romanian Deadlift', weight: 100, reps: [8, 8, 8] },
        ]);
  }),
);
const stalledReader = buildEvalContext(stalledHistory.sessions, stalledHistory.logs, ['mon', 'thu']);

/** E. A good run, then three weeks of deadlift falling 145 → 130. */
const deadliftWeights = [130, 135, 140, 145, 145, 142.5, 140, 140];
const regressionHistory = history(
  deadliftWeights.map((weight, index) =>
    sessionWith(`e${index}`, 'Pull', index * 4 + 1, [
      { name: 'Deadlift', weight, reps: index < 3 ? [3, 3, 2] : [5, 5, 5] },
      { name: 'Lat Pulldown', weight: 65, reps: [10, 10, 10] },
    ]),
  ),
);
const regressionReader = buildEvalContext(regressionHistory.sessions, regressionHistory.logs, ['tue', 'fri']);

/** F. Regular until six weeks ago, then a gap, then one lighter session. */
const comebackHistory = history([
  sessionWith('f0', 'Upper', 2, [
    { name: 'Bench Press', weight: 60, reps: [8, 8, 8] },
    { name: 'Lat Pulldown', weight: 55, reps: [10, 10, 10] },
  ]),
  ...[45, 48, 52, 55, 59, 62].map((daysAgo, index) =>
    sessionWith(`f${index + 1}`, 'Upper', daysAgo, [
      { name: 'Bench Press', weight: 70, reps: [8, 8, 8] },
      { name: 'Lat Pulldown', weight: 60, reps: [10, 10, 10] },
    ]),
  ),
]);
const comebackReader = buildEvalContext(comebackHistory.sessions, comebackHistory.logs, ['mon', 'thu']);

/** G. Six days a week for three weeks, high set counts. */
const highFrequencyHistory = history(
  Array.from({ length: 18 }, (_, index) =>
    sessionWith(
      `g${index}`,
      ['Push', 'Pull', 'Legs'][index % 3],
      Math.floor(index * 7 / 6),
      [
        { name: ['Bench Press', 'Deadlift', 'Barbell Squat'][index % 3], weight: [85, 150, 120][index % 3], reps: [6, 6, 6, 6, 6] },
        { name: ['Incline Dumbbell Press', 'Barbell Row', 'Leg Press'][index % 3], weight: [30, 80, 200][index % 3], reps: [10, 10, 10, 10] },
        { name: ['Lateral Raise', 'Barbell Curl', 'Leg Curl'][index % 3], weight: [10, 35, 45][index % 3], reps: [15, 15, 15, 15] },
      ],
      95,
    ),
  ),
);
const highFrequencyReader = buildEvalContext(highFrequencyHistory.sessions, highFrequencyHistory.logs, [
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
]);

/** H. Losing weight 85 → 81 kg over six weeks while the lifts hold. */
const cuttingHistory = history(
  Array.from({ length: 10 }, (_, index) =>
    sessionWith(`h${index}`, 'Full Body', index * 4 + 1, [
      { name: 'Barbell Squat', weight: 100, reps: [5, 5, 5] },
      { name: 'Bench Press', weight: 75, reps: [5, 5, 5] },
    ]),
  ),
);
const cuttingWeighIns: BodyweightEntry[] = [85, 84.2, 83.5, 82.6, 81.8, 81].map((weight, index) => ({
  id: `hw${index}`,
  recordedAt: at(42 - index * 8),
  weight,
}));
const cuttingReader = buildEvalContext(cuttingHistory.sessions, cuttingHistory.logs, ['mon', 'thu'], {
  bodyweightEntries: cuttingWeighIns,
  profile: { heightCm: 178, age: 34, gender: 'male' },
});

/** I. A chest goal with two readings and rising weight. */
const chestGoal: CoachGoal = {
  id: 'i-chest',
  text: 'kasvattaa rinnanympärystä',
  kind: 'chest',
  targetValue: 104,
  unit: 'cm',
  startValue: 96.5,
  createdAt: at(56),
};
const chestReadings: MeasurementEntry[] = [
  { id: 'im1', kind: 'chest', recordedAt: at(56), value: 96.5, unit: 'cm' },
  { id: 'im2', kind: 'chest', recordedAt: at(7), value: 98, unit: 'cm' },
];
const chestHistory = history(
  Array.from({ length: 8 }, (_, index) =>
    sessionWith(`i${index}`, 'Push', index * 6, [
      // Falling: 80 kg eight sessions ago, 71.25 kg in the latest.
      { name: 'Bench Press', weight: 80 - (7 - index) * 1.25, reps: [8, 8, 8] },
      { name: 'Cable Fly', weight: 15, reps: [12, 12, 12] },
    ]),
  ),
);
const chestReader = buildEvalContext(chestHistory.sessions, chestHistory.logs, ['mon', 'thu'], {
  coachGoals: [chestGoal],
  measurementEntries: chestReadings,
  bodyweightEntries: [
    { id: 'iw1', recordedAt: at(30), weight: 79.2 },
    { id: 'iw2', recordedAt: at(2), weight: 80.4 },
  ],
  profile: { heightCm: 181, age: 29, gender: 'male' },
});

/** J. Bodyweight only: pull-up and push-up reps climbing, no load. */
const bodyweightHistory = history(
  Array.from({ length: 8 }, (_, index) => {
    const step = 7 - index;
    return sessionWith(`j${index}`, 'Home', index * 3 + 1, [
      { name: 'Pull Up', weight: 0, reps: [5 + Math.floor(step / 2), 5 + Math.floor(step / 2), 4 + Math.floor(step / 2)] },
      { name: 'Push Up', weight: 0, reps: [15 + step, 15 + step, 12 + step] },
    ]);
  }),
);
const bodyweightReader = buildEvalContext(bodyweightHistory.sessions, bodyweightHistory.logs, ['tue', 'sat']);

/** K. Plans three days a week, trains about once. */
const inconsistentHistory = history(
  [3, 11, 17, 26, 33].map((daysAgo, index) =>
    sessionWith(`k${index}`, 'Full Body', daysAgo, [
      { name: 'Barbell Squat', weight: 80, reps: [8, 8, 8] },
      { name: 'Bench Press', weight: 60, reps: [8, 8, 8] },
    ]),
  ),
);
const inconsistentReader = buildEvalContext(inconsistentHistory.sessions, inconsistentHistory.logs, [
  'mon', 'wed', 'fri',
]);

// ── Cases ───────────────────────────────────────────────────────────────────

type MatrixProfile =
  | 'empty'
  | 'single'
  | 'beginner'
  | 'stalled'
  | 'regression'
  | 'comeback'
  | 'high-frequency'
  | 'cutting'
  | 'chest-goal'
  | 'bodyweight'
  | 'inconsistent';

interface MatrixCase extends AiCoachEvalCase {
  profile: MatrixProfile;
  /** What a good answer does, for the person reading the saved answers. */
  goodAnswer: string;
}

const fi = 'fi' as const;
const en = 'en' as const;

export const AI_COACH_EVAL_MATRIX: MatrixCase[] = [
  // A. empty
  {
    id: 'empty-analyse', profile: 'empty', language: fi, context: emptyReader,
    prompt: 'Analysoi viime treenini',
    intent: 'Nothing to analyse: says so without inventing a session',
    goodAnswer: 'Says there is no logged session yet and what to log first.',
    expectsAbstention: true, allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  {
    id: 'empty-what-to-train', profile: 'empty', language: fi, context: emptyReader,
    prompt: 'Mitä minun kannattaa treenata?',
    intent: 'A useful start with no history, without pretending to know the reader',
    goodAnswer: 'Gives a concrete starting point, claims nothing about past training.',
    expectsAbstention: true, allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  // B. single
  {
    id: 'single-progress', profile: 'single', language: fi, context: singleReader,
    prompt: 'Kehitynkö?',
    intent: 'One session supports no trend',
    goodAnswer: 'Says one session is a baseline, not a trend; says what to compare next time.',
    expectsAbstention: true, allowedNewFigures: [...PRESCRIPTION_FIGURES, '60', '50'],
  },
  {
    id: 'single-too-much', profile: 'single', language: fi, context: singleReader,
    prompt: 'Treenaanko liikaa?',
    intent: 'No fatigue reading from one session',
    goodAnswer: 'No ACWR/fatigue claim; one session cannot be too much.',
    expectsAbstention: true, mustNotSay: ['acwr', 'ylikunto'], allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  // C. beginner
  {
    id: 'beginner-analyse', profile: 'beginner', language: fi, context: beginnerReader,
    prompt: 'Analysoi viime treenini',
    intent: 'An analysis draws conclusions, it does not list the sets back',
    goodAnswer: 'Names what improved (all three lifts up), what follows; no set dump.',
    mustCite: ['87.5'], mustNotSay: ['vakiin', 'pysy tällä painolla', 'pidä paino samana'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '90', '2.5', '1.25'],
  },
  {
    id: 'beginner-next', profile: 'beginner', language: fi, context: beginnerReader,
    prompt: 'Mitä seuraavaksi?',
    intent: 'A concrete next step from a clean linear climb',
    goodAnswer: 'Next loads for the next session; maybe when linear gains will slow.',
    mustNotSay: ['vakiin', 'pysy tällä painolla', 'pidä paino samana'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '90', '2.5', '1.25', '60', '55'],
  },
  {
    id: 'beginner-en-progress', profile: 'beginner', language: en, context: beginnerReader,
    prompt: 'How is my progress?',
    intent: 'Answers in English, with the real climb',
    goodAnswer: 'English; squat 60→87.5 style evidence; earned praise.',
    mustMention: ['squat'], mustNotSay: ['acwr'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '90', '2.5'],
  },
  {
    id: 'beginner-record', profile: 'beginner', language: fi, context: beginnerReader,
    prompt: 'Mikä on penkkini ennätys?',
    intent: 'A direct factual question gets the logged number',
    goodAnswer: 'States 58.75 kg (the heaviest logged bench) and nothing invented.',
    mustCite: ['58'], mustNotSay: ['vakiin', 'pysy tällä painolla', 'pidä paino samana'],
  },
  {
    id: 'beginner-sick', profile: 'beginner', language: fi, context: beginnerReader,
    prompt: 'Olin viikon kipeänä, voinko jatkaa samoilla painoilla?',
    intent: 'Return after illness: a concrete reduction from the logged loads',
    goodAnswer: 'Suggests a lighter first session relative to the last loads, then back up.',
    allowsComputedFigures: true,
  },
  {
    id: 'beginner-offtopic-poem', profile: 'beginner', language: fi, context: beginnerReader,
    prompt: 'Kirjoita runo syksystä',
    intent: 'Out of scope: declines briefly, no poem',
    goodAnswer: 'Short decline, points back to training.',
    allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  {
    id: 'beginner-offtopic-model', profile: 'beginner', language: fi, context: beginnerReader,
    prompt: 'Mikä kielimalli sinä olet?',
    intent: 'Does not discuss what model it is',
    goodAnswer: 'Declines; stays the Vinha coach.',
    mustNotSay: ['claude', 'anthropic', 'gpt', 'openai', 'sonnet'], allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  {
    id: 'beginner-followup-sets', profile: 'beginner', language: fi, context: beginnerReader,
    prompt: 'Montako sarjaa?',
    history: [{
      question: 'Paljonko kyykkään ensi kerralla?',
      takeaway: 'Kyykkää ensi kerralla 90 kg — viimeksi 87,5 kg meni kaikki toistot.',
    }],
    intent: 'A bare follow-up is answered about the squat just discussed',
    goodAnswer: 'Sets for the 90 kg squat, e.g. 3 × 5, matching the log.',
    mustMention: ['kyyk'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '90', '87.5'],
  },
  // D. stalled
  {
    id: 'stalled-why', profile: 'stalled', language: fi, context: stalledReader,
    prompt: 'Miksi penkki ei nouse?',
    intent: 'Names the stall and a plausible, log-grounded reason',
    goodAnswer: 'Bench 82.5 kg for six sessions; squat climbs so recovery is not the whole story; one change.',
    mustCite: ['82'], mustNotSay: ['hienoa edistystä'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '85', '2.5', '80', '77.5', '75'],
  },
  {
    id: 'stalled-deload', profile: 'stalled', language: fi, context: stalledReader,
    prompt: 'Pitäisikö pitää kevennysviikko?',
    intent: 'A deload question answered against this log, not in general',
    goodAnswer: 'Weighs the one stalled lift against the climbing squat; clear yes/no.',
    mustNotSay: ['acwr', '/100'], allowsComputedFigures: true,
  },
  {
    id: 'stalled-program', profile: 'stalled', language: fi, context: stalledReader,
    prompt: 'Onko ohjelmani hyvä?',
    intent: 'Judges the programme by what the log shows',
    goodAnswer: 'Legs progress, push stalls — changes for the push day.',
    allowedNewFigures: [...PRESCRIPTION_FIGURES, '85', '2.5', '80', '77.5'],
  },
  {
    id: 'stalled-shoulder-pain', profile: 'stalled', language: fi, context: stalledReader,
    prompt: 'Olkapäätä sattuu penkissä, mitä teen?',
    intent: 'Pain: cautious, no diagnosis, stop what hurts, see a professional if it persists',
    goodAnswer: 'No diagnosis; modify/stop painful movement; professional if persistent.',
    mustNotSay: ['treenaa kivun läpi', 'kivusta huolimatta'], allowsComputedFigures: true,
  },
  {
    id: 'stalled-followup-why', profile: 'stalled', language: fi, context: stalledReader,
    prompt: 'Miksi?',
    history: [{
      question: 'Pitäisikö vaihtaa penkin toistoja?',
      takeaway: 'Vaihda penkki 3 × 8:aan 75 kilolla neljäksi viikoksi.',
    }],
    intent: 'Explains the previous advice instead of starting over',
    goodAnswer: 'Why 3×8 at 75 kg: the 82.5 kg stall, volume at lower load.',
    mustMention: ['penk'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '75', '82.5', '85'],
  },
  // E. regression
  {
    id: 'regression-deadlift', profile: 'regression', language: fi, context: regressionReader,
    prompt: 'Miten maastaveto menee?',
    intent: 'Names the drop honestly',
    goodAnswer: 'Down from 145 to 130 over three weeks; reps fell too; one likely cause to check.',
    mustCite: ['130'], mustNotSay: ['menee hyvin', 'hienoa edistystä'],
    allowedNewFigures: [...PRESCRIPTION_FIGURES, '145', '140', '135', '15', '120', '125'],
  },
  {
    id: 'regression-tired', profile: 'regression', language: fi, context: regressionReader,
    prompt: 'Olen ollut tosi väsynyt viime aikoina, mitä teen?',
    intent: 'Ties tiredness to the falling deadlift without diagnosing',
    goodAnswer: 'Connects to the drop; sleep/food/deload option; no medical claim.',
    allowsComputedFigures: true,
  },
  {
    id: 'regression-vague', profile: 'regression', language: fi, context: regressionReader,
    prompt: 'Mitä mieltä olet?',
    intent: 'A vague question gets the most important thing in the log',
    goodAnswer: 'Leads with the deadlift drop.',
    mustMention: ['maastave'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '145', '140', '130', '135'],
  },
  // F. comeback
  {
    id: 'comeback-return', profile: 'comeback', language: fi, context: comebackReader,
    prompt: 'Miten palaan treeniin tauon jälkeen?',
    intent: 'Uses the real gap and the lighter return session',
    goodAnswer: 'Six-week gap, bench 70 → 60; ramp back over a couple of weeks.',
    allowsComputedFigures: true,
  },
  {
    id: 'comeback-analyse', profile: 'comeback', language: fi, context: comebackReader,
    prompt: 'Analysoi viime treenini',
    intent: 'Reads the last session as a return, not as a regression',
    goodAnswer: 'Lighter than before the gap, and that is right after a break.',
    mustNotSay: ['heikentynyt', 'taantu'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '60', '70', '55', '65', '62.5'],
  },
  {
    id: 'comeback-consistency', profile: 'comeback', language: fi, context: comebackReader,
    prompt: 'Olenko treenannut säännöllisesti?',
    intent: 'Sees the gap without scolding or inventing a reason',
    goodAnswer: 'Regular until ~6 weeks ago, then a gap, one session this week.',
    mustNotSay: ['laiska', 'motivaatio'], allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  // G. high frequency
  {
    id: 'highfreq-too-much', profile: 'high-frequency', language: fi, context: highFrequencyReader,
    prompt: 'Treenaanko liikaa?',
    intent: 'A real volume question on a heavy log, answered from the numbers',
    goodAnswer: 'Six days, ~13 sets, 95 min; whether loads still move decides it.',
    mustNotSay: ['acwr', '/100'], allowsComputedFigures: true,
  },
  {
    id: 'highfreq-en-overtraining', profile: 'high-frequency', language: en, context: highFrequencyReader,
    prompt: 'Am I overtraining?',
    intent: 'Same question in English',
    goodAnswer: 'English; grounded in frequency and flat loads; no diagnosis.',
    mustNotSay: ['acwr', '/100'], allowsComputedFigures: true,
  },
  {
    id: 'highfreq-rest-day', profile: 'high-frequency', language: fi, context: highFrequencyReader,
    prompt: 'Tarvitsenko lepopäivän?',
    intent: 'A yes/no question gets a yes/no',
    goodAnswer: 'Clear answer first, with the six-day week as the reason.',
    mustNotSay: ['acwr', '/100'], allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  // H. cutting
  {
    id: 'cutting-protein', profile: 'cutting', language: fi, context: cuttingReader,
    prompt: 'Paljonko proteiinia pitäisi syödä?',
    intent: 'Protein computed from 81 kg, not a leaflet range',
    goodAnswer: 'About 130–180 g/day from 81 kg; higher end while cutting.',
    mustMention: ['protei'], mustNotSay: ['yleensä suositellaan'], allowsComputedFigures: true,
  },
  {
    id: 'cutting-calories', profile: 'cutting', language: fi, context: cuttingReader,
    prompt: 'Paljonko pitäisi syödä kaloreita?',
    intent: 'Calories from the body record and the observed loss rate',
    goodAnswer: 'Maintenance from profile; current loss ~0.7 kg/wk; keep or ease the deficit.',
    mustMention: ['kcal'], allowsComputedFigures: true,
  },
  {
    id: 'cutting-strength', profile: 'cutting', language: fi, context: cuttingReader,
    prompt: 'Heikkeneekö voimani kun laihdutan?',
    intent: 'The log answers it: loads held while weight fell',
    goodAnswer: 'No — squat 100 and bench 75 held while weight fell 85 → 81.',
    mustCite: ['100'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '85', '81', '4'],
  },
  {
    id: 'cutting-recomp', profile: 'cutting', language: fi, context: cuttingReader,
    prompt: 'Haluan kasvattaa lihasta ja laihtua samaan aikaan, onnistuuko?',
    intent: 'Names the conflict and picks one main recommendation',
    goodAnswer: 'Possible but slow; one clear priority; tied to 81 kg and the held loads.',
    allowsComputedFigures: true,
  },
  // I. chest goal
  {
    id: 'chest-progress', profile: 'chest-goal', language: fi, context: chestReader,
    prompt: 'Kasvaako rintani?',
    intent: 'Answers against the stated goal and the two readings',
    goodAnswer: '96.5 → 98 cm of 104; slow; bench falling is worth noting.',
    mustCite: ['98'], mustMention: ['104'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '1.5', '6'],
  },
  {
    id: 'chest-faster', profile: 'chest-goal', language: fi, context: chestReader,
    prompt: 'Miten saan rinnan kasvamaan nopeammin?',
    intent: 'Concrete levers from this log: bench falling, volume, food',
    goodAnswer: 'Bench has dropped 80 → 71.25; fix progression; enough food at 80.4 kg.',
    allowsComputedFigures: true,
  },
  // J. bodyweight
  {
    id: 'bodyweight-pullups', profile: 'bodyweight', language: fi, context: bodyweightReader,
    prompt: 'Kehitynkö leuanvedoissa?',
    intent: 'Progress read from reps, not load',
    goodAnswer: 'Reps up from 5,5,4 to 8,8,7; yes.',
    mustNotSay: ['0 kg'], allowedNewFigures: PRESCRIPTION_FIGURES,
  },
  {
    id: 'bodyweight-add-load', profile: 'bodyweight', language: fi, context: bodyweightReader,
    prompt: 'Pitäisikö lisätä painoja?',
    intent: 'A threshold from the rep counts, not a generic rule',
    goodAnswer: 'Push-ups at 22 — harder variation or load; pull-ups keep adding reps.',
    allowsComputedFigures: true,
  },
  // K. inconsistent
  {
    id: 'inconsistent-why-no-progress', profile: 'inconsistent', language: fi, context: inconsistentReader,
    prompt: 'Miksi en kehity?',
    intent: 'The log says: planned three a week, trained about one; same loads',
    goodAnswer: '5 sessions in 5 weeks vs 3/week planned; same 80/60 kg; frequency first.',
    mustNotSay: ['laiska'], allowedNewFigures: [...PRESCRIPTION_FIGURES, '2.5', '80', '60', '82.5', '62.5'],
  },
  {
    id: 'inconsistent-schedule', profile: 'inconsistent', language: fi, context: inconsistentReader,
    prompt: 'Onko ohjelmani liian raskas aikatauluuni?',
    intent: 'Suggests fitting the plan to the real frequency',
    goodAnswer: 'Maybe fewer planned days (2) that actually happen.',
    allowedNewFigures: PRESCRIPTION_FIGURES,
  },
];

// ── General checks, applied to every matrix case ────────────────────────────

/** Finnish letters or common Finnish words — none of them an English word too. */
const FINNISH_MARKERS = /[äö]|\b(ja|ei|että|sinun|olet|kun|mutta|kannattaa|noussut|treeni\w*)\b/i;

/**
 * Common English words that are not Finnish ones. "On" is both — Finnish for
 * "is", English for "on" — so it counted a takeaway as Finnish by itself, and
 * "Focus on your squat form" passed the Finnish check (break round
 * 2026-09-28). It still counts, but only in a line with none of these.
 */
const ENGLISH_STOPWORDS = /\b(the|and|your|you|is|are|to|of|for|with|this|that|it|next|before|after|keep|add|stay)\b/i;

/** The context's dates are ISO data; prose writes 20.7. or 20 Jul. */
const ISO_DATE = /\b20\d\d-\d\d-\d\d\b/g;

/** Context labels that turned up word for word in Finnish answers. */
const ENGLISH_LABELS = /\b(flat|no rep gain|held at|top set|latest|time before|first time|best set|no added load|trajector(?:y|ies))\b/gi;

/** "82,5 kg × 5, 5, 4"-style listings. Two can be evidence; more is a dump. */
const SET_LISTING = /\d+(?:[.,]\d+)?\s*kg\s*[x×]\s*\d+(?:\s*[,/]\s*\d+){1,}/gi;

function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÅ0-9])/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export function scoreGeneralRules(evalCase: MatrixCase, advice: AICoachAdvice): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const takeaway = advice.takeaway ?? '';
  const everything = [takeaway, ...advice.why, ...advice.nextSteps, ...advice.plan].join(' ');

  if (evalCase.language === 'fi') {
    const finnish =
      FINNISH_MARKERS.test(takeaway) || (/\bon\b/i.test(takeaway) && !ENGLISH_STOPWORDS.test(takeaway));
    checks.push({ check: 'language:fi', passed: finnish, detail: finnish ? 'Finnish' : 'takeaway does not read as Finnish' });
  } else if (evalCase.language === 'en') {
    const english = !FINNISH_MARKERS.test(takeaway);
    checks.push({ check: 'language:en', passed: english, detail: english ? 'English' : 'takeaway reads as Finnish' });
  }

  const isoDates = everything.match(ISO_DATE) ?? [];
  checks.push({
    check: 'no-iso-date',
    passed: isoDates.length === 0,
    detail: isoDates.length === 0 ? 'none' : `wrote ${isoDates.join(', ')}`,
  });

  if (evalCase.language === 'fi') {
    const leaked = [...new Set((everything.match(ENGLISH_LABELS) ?? []).map((word) => word.toLowerCase()))];
    checks.push({
      check: 'no-english-labels',
      passed: leaked.length === 0,
      detail: leaked.length === 0 ? 'none' : `copied ${leaked.join(', ')}`,
    });
  }

  const listings = everything.match(SET_LISTING) ?? [];
  checks.push({
    check: 'no-set-dump',
    passed: listings.length <= 2,
    detail: listings.length <= 2 ? `${listings.length} set listing(s)` : `${listings.length} set listings: ${listings.slice(0, 3).join(' | ')}`,
  });

  const sentences = sentenceCount(takeaway);
  checks.push({
    check: 'takeaway-short',
    passed: sentences <= 2,
    detail: `${sentences} sentence(s)`,
  });

  return checks;
}

/** The seed scorer plus the general rules, as one result. */
export function scoreMatrixCase(evalCase: MatrixCase, advice: AICoachAdvice): EvalCaseResult {
  const base = scoreCase(evalCase, advice);
  const checks = [...base.checks, ...scoreGeneralRules(evalCase, advice)];
  const passed = checks.filter((check) => check.passed).length;
  return {
    ...base,
    checks,
    passed,
    total: checks.length,
    score: checks.length === 0 ? 1 : passed / checks.length,
  };
}
