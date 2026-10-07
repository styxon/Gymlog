import { hasWord, hasWordStart } from './wordMatch';

/**
 * What kind of question this is, before anything tries to answer it.
 *
 * The coach's scope is a rule on the server (COACH_SYSTEM_RULES), where the
 * model can read a whole sentence and judge it. Offline there is no model:
 * `aiCoachPreview` matches keywords, and a question about the weather used to
 * come back as a recovery answer with the reader's own numbers in it — the
 * app answering, confidently, something it was never asked.
 *
 * So this is deliberately not a classifier. It names only what it is sure of:
 * a handful of subjects that cannot be training questions, and the words
 * somebody in trouble uses. Everything else is training, because that is what
 * this app is for and a reader phrasing a training question unusually must
 * not be turned away.
 *
 * The server reads every chat question with this same function before the
 * model sees it (api/ai-coach.ts), so a build whose copy is older still meets
 * the newest one.
 */
export type CoachScopeVerdict = 'training' | 'off_topic' | 'crisis';

type CrisisSlots = readonly (readonly string[])[];

/**
 * A row of slots, and — for the few phrases the gym says too — what the next
 * word decides.
 *
 * "I'm going to take my life" and "this programme will take my life back"
 * share three words, and so do "I want to end it" and "I want to end it with
 * a finisher". A word list cannot hold either pair apart. What does is what
 * comes after, inside the same sentence:
 *
 * - `unlessFollowedBy`: crisis, unless the sentence goes on with one of these.
 * - `closing`: crisis only when the sentence stops there — or goes on with a
 *   word that only says when (`CRISIS_CLOSING_TAIL`), or turns ("but",
 *   "because": `CRISIS_CLOSING_TURNS`).
 *
 * A comma, a line break and a dash end a sentence here as much as a full stop
 * does: a phone types "I want to end it, nothing matters" (review,
 * 2026-10-07). So do a bracket, a double quote and an emoji: "I want to end
 * it 😭 nothing matters" (A6 hunt, 2026-10-07).
 *
 * - `inTheGym`: a reading of the rest of the sentence that says it is the
 *   session. Crisis unless it does.
 *
 * `closing` named the crisis and let everything else out, and "I'm going to
 * end it tomorrow" and "I will end it with pills" went past as training (A6
 * hunt, 2026-10-07). The excuses only ever narrow a crisis to the gym talk
 * they name: a crisis must never reach the model, and a sentence that could
 * be either gets the line (owner's call, 2026-10-07). A false alarm costs one
 * answer; a missed crisis is not a cost this file may take.
 */
type CrisisPattern =
  | CrisisSlots
  | {
      slots: CrisisSlots;
      unlessFollowedBy?: readonly string[];
      closing?: true;
      inTheGym?: (rest: readonly CrisisWord[]) => boolean;
    };

// Shared slots. Each list holds the forms a reader types, not a grammar.

/** Finnish "not", spoken forms included: "emmä halua elää", "enkä jaksa". */
const FI_NOT = ['en', 'enkä', 'emmä', 'emmää', 'emmie'];

/**
 * What sits between "en" and the verb and only colours it: "en oikein jaksa
 * elää", "en vaan jaksa", "en todellakaan halua". Here rather than in
 * `CRISIS_FILLERS`, because after the verb "vain" turns the sentence round:
 * "en halua vain elää salilla" is a training goal.
 */
const FI_NOT_COLOUR = ['', 'oikein', 'vaan', 'vain', 'todellakaan', 'jo', 'nyt'];

const FI_WANT_NOT = ['halua', 'haluu', 'haluis', 'haluais', 'haluaisi', 'tahdo', 'tahtois', 'tahtoisi', 'halunnut', 'halunnu', 'tahtonut'];

/** "haluan kuolla" in every person, tense and mood a reader uses of themselves. */
const FI_WANT = [
  'haluan', 'haluun', 'haluu', 'haluis', 'haluais', 'haluaisi', 'haluaisin', 'haluisin', 'tahdon', 'tahtoisin',
  'halusin', 'tahdoin', 'halunnut', 'halunnu', 'tekis mieli', 'tekisi mieli', 'tekee mieli', 'teki mieli',
];

const FI_WANT_COLOUR = ['', 'vain', 'vaan', 'vaa', 'jo', 'nyt', 'nyt vain', 'nyt vaan', 'jo vain', 'jo vaan'];

/** "myself", and the ways a thumb types it. */
const EN_SELF = ['myself', 'my self', 'meself', 'myselfs', 'myslef', 'mysef'];

/** Intent, in the tenses and modals a reader uses of themselves. */
const EN_INTENT = [
  'want to', 'wanna', 'wanted to', 'wanting to', 'going to', 'gonna', 'i will', "i'll", 'ready to', 'about to',
  'plan to', 'planning to', 'decided to', 'need to', 'have to', 'try to', 'tried to', 'trying to', 'would like to',
  "i'd like to", 'id like to', 'should', 'could', 'might',
];

const EN_THINKING = ['thinking about', 'think about', 'thought about', 'thinking of', 'thought of'];

/** Words that only say when, read past before what "end it" goes on with. */
const END_IT_WHEN = new Set(['now', 'today', 'tonight', 'tomorrow', 'soon', 'then']);

/**
 * What a crisis ends it with or on. Only ever read to overrule a session word
 * beside it — "with dips and pills" — since a sentence with no session word
 * is a crisis anyway.
 */
const END_IT_METHOD = new Set([
  'pills', 'pill', 'pillz', 'meds', 'medication', 'medications', 'tablets', 'painkillers', 'overdose', 'od', 'poison',
  'bleach', 'antifreeze', 'insulin', 'heroin', 'alcohol', 'tylenol', 'paracetamol', 'xanax',
  'rope', 'noose', 'belt', 'cord', 'scarf', 'bag', 'gun', 'guns', 'gunshot', 'handgun', 'shotgun', 'pistol', 'revolver',
  'rifle', 'bullet', 'bullets', 'shot', 'knife', 'knives', 'blade', 'blades', 'razor', 'razors', 'monoxide', 'car',
  'train', 'traffic', 'tracks', 'track', 'railway', 'railroad', 'rails', 'bridge', 'roof', 'rooftop', 'ledge', 'cliff',
  'balcony', 'highway', 'motorway', 'floor', 'window', 'building',
]);

/**
 * Exercises a method word is part of: a jump rope, rope climbs, battle
 * ropes, a glute bridge. Beside one of these the word is the exercise.
 */
const METHOD_EXERCISE_BEFORE = new Set(['jump', 'battle', 'glute', 'hip', 'skipping']);
const METHOD_EXERCISE_AFTER = new Set([
  'climb', 'climbs', 'climbing', 'pull', 'pulls', 'pulldown', 'pulldowns', 'pushdown', 'pushdowns', 'curl', 'curls',
  'crunch', 'crunches', 'slam', 'slams', 'wave', 'waves', 'face', 'skipping', 'jumps', 'hold', 'holds', 'march',
  'marches', 'walk', 'walks', 'press', 'presses', 'wipers',
]);

/**
 * The session, as "end it with", "on" and "after" go on into it: "with dips",
 * "on a PR", "after 3 sets". A closed list, on purpose. 4ff438f1 read
 * anything that was not a listed method as the session, and "end it with a
 * gunshot", "on friday" and "after 3 days" went past as training (re-hunt,
 * 2026-10-07): a method list is never finished, and an exercise this list
 * misses costs only a false alarm. Not "train", "car" or "bridge", which are
 * how a crisis says it, nor a bare "minutes", "failure" or "note".
 */
const END_IT_SESSION_WORDS = new Set([
  'set', 'sets', 'superset', 'supersets', 'dropset', 'dropsets', 'rep', 'reps', 'round', 'rounds', 'lap', 'laps', 'km',
  'miles', 'finisher', 'finishers', 'burnout', 'amrap', 'emom', 'hiit', 'tabata', 'circuit', 'circuits', 'cooldown',
  'warmup', 'warm-up', 'stretch', 'stretches', 'stretching', 'mobility', 'yoga', 'cardio', 'conditioning', 'core', 'abs',
  'workout', 'session', 'exercise', 'exercises', 'deload', 'accessories', 'accessory', 'isolation', 'pump', 'pr', 'pb',
  'rpe', 'sprint', 'sprints', 'run', 'jog', 'rowing', 'bike', 'cycling', 'treadmill', 'elliptical', 'erg', 'stairmaster',
  'dips', 'dip', 'squat', 'squats', 'deadlift', 'deadlifts', 'bench', 'press', 'presses', 'curl', 'curls', 'row', 'rows',
  'pullup', 'pullups', 'pull-up', 'pull-ups', 'chinup', 'chinups', 'chin-up', 'chin-ups', 'pushup', 'pushups', 'push-up',
  'push-ups', 'burpee', 'burpees', 'lunge', 'lunges', 'crunch', 'crunches', 'situp', 'situps', 'sit-up', 'sit-ups',
  'plank', 'planks', 'raises', 'extensions', 'flyes', 'flies', 'shrugs', 'cleans', 'snatch', 'snatches', 'thruster',
  'thrusters', 'swings', 'kettlebell', 'kettlebells', 'dumbbell', 'dumbbells', 'barbell', 'pulldown', 'pulldowns',
  'pushdown', 'pushdowns', 'kickbacks', 'climbers', 'carries', 'farmer', 'farmers', 'glute', 'glutes', 'calves', 'calf',
  'hamstrings', 'quads', 'biceps', 'triceps', 'arms', 'legs', 'chest', 'shoulders', 'skipping',
]);

/** Sessions said in two words: "a heavy single", "a high note". */
const END_IT_SESSION_PHRASES = [
  ['heavy', 'single'], ['high', 'note'], ['good', 'note'], ['positive', 'note'], ['strong', 'note'], ['cool', 'down'],
  ['warm', 'up'], ['box', 'jumps'], ['jumping', 'jacks'],
];

/** What ends a session and nothing else: "early", "here", "for today". */
const END_IT_SESSION = [
  'early', 'earlier', 'there', 'here', 'for today', 'for the day', 'for this session', 'for this week',
];

/** Whether the word at `i` is a method word, not the exercise it is part of. */
function namesMethodAt(words: readonly CrisisWord[], i: number): boolean {
  return (
    END_IT_METHOD.has(words[i].word) &&
    !METHOD_EXERCISE_BEFORE.has(words[i - 1]?.word ?? '') &&
    !METHOD_EXERCISE_AFTER.has(words[i + 1]?.word ?? '')
  );
}

/** Whether the words from `i` name the session: "dips", "a jump rope", "a high note". */
function namesSessionAt(words: readonly CrisisWord[], i: number): boolean {
  if (END_IT_SESSION_WORDS.has(words[i].word)) return true;
  if (END_IT_SESSION_PHRASES.some((phrase) => startsAt(words, i, phrase))) return true;
  return END_IT_METHOD.has(words[i].word) && !namesMethodAt(words, i);
}

/**
 * Whether what follows "end it", in its sentence, ends a session.
 *
 * Only these do: "early", "here", "for today" and the like; and "with", "on"
 * or "after" with a session word among the three words after it — "with
 * dips", "with a heavy single", "on a PR", "after 3 sets", "after squats" —
 * and no method anywhere after it. Everything else is the crisis:
 * "tomorrow", "for good", "on friday", "with a gunshot", "after 3 days", "by
 * jumping", "and be gone", and a "with" the sentence ends after ("with 💊").
 * A when is read past: "I'm ending it now with stretching" is a session,
 * "I'm ending it now" is not.
 */
function endsASession(rest: readonly CrisisWord[]): boolean {
  let at = 0;
  while (at < rest.length && END_IT_WHEN.has(rest[at].word)) at += 1;
  const goesOn = rest.slice(at);
  if (goesOn.length === 0) return false;
  if (!['with', 'on', 'after'].includes(goesOn[0].word)) {
    return END_IT_SESSION.some((session) => startsAt(goesOn, 0, session.split(' ')));
  }
  if (goesOn.some((_, i) => i > 0 && namesMethodAt(goesOn, i))) return false;
  return [1, 2, 3].some((i) => i < goesOn.length && namesSessionAt(goesOn, i));
}

/** The supplements and food a gym "overdoses" on. */
const OVERDOSE_ON_FOOD = [
  'on caffeine', 'on coffee', 'on carbs', 'on protein', 'on creatine', 'on pre', 'on pre-workout', 'on preworkout',
  'on sugar', 'on cardio', 'on volume', 'on chocolate', 'on candy', 'on pizza',
];

/**
 * What a reader takes every one of. With "all", "every" or a bottle in front,
 * none of them is a dose: a routine is said without them — "I take my meds
 * before training", "otan lääkkeet aamulla" (owner's call, 2026-10-07).
 */
const EN_PILLS = [
  'pills', 'pill', 'meds', 'medication', 'medications', 'medicine', 'sleeping pills', 'painkillers', 'pain killers',
  'tablets', 'antidepressants', 'tylenol', 'paracetamol', 'ibuprofen', 'advil', 'aspirin', 'xanax', 'insulin',
];

const EN_SWALLOW = [
  'take', 'taking', 'took', 'taken', 'swallow', 'swallowing', 'swallowed', 'pop', 'popping', 'popped', 'down',
  'downing', 'downed',
];

/**
 * Said plainly enough that no training reading survives.
 *
 * Whole words, in order. Both halves of that matter, and the first review of
 * this file found why (PR #124):
 *
 * - Substring matching put "want to die" inside "I want to diet for summer",
 *   so a question about a deficit got a crisis line. Every phrase here is
 *   matched word for word.
 * - "hurt myself" and "satuttaa itseäni" are how a gym injury is reported —
 *   "I hurt myself deadlifting, what can I still train?" — so they are not
 *   here at all. What names the thing itself is: self-harm, cutting,
 *   itsetuhoisuus.
 *
 * Each pattern is a row of slots, and every way through the slots is a
 * phrase. This used to be a list of whole sentences, and three bug hunts in a
 * row found the same hole in it: a sentence one word or one word order away
 * from a listed one — "en enää halua elää" beside "en halua enää elää", "I
 * don't wanna live" beside "I don't want to live" (#317, #325, review
 * 2026-10-07). Each fix listed the sentence it was shown, and the next hunt
 * found its neighbour. Slots hold the verb forms a reader types, and the
 * words that only colour a sentence (`CRISIS_FILLERS`) are not read at all,
 * so where "enää" or "really" sits no longer decides anything.
 *
 * The A6 hunt (2026-10-07) found the slots themselves too narrow: present
 * tense only ("I wanted to die", "halusin kuolla"), "want to" as the only
 * modal ("I'd rather be dead", "I need to die"), the method said rather than
 * the wish ("I want to shoot myself", "hyppään sillalta"), and the single-act
 * verb ("viillän ranteeni") beside the frequentative the stems hold. Each
 * went into its slot as an alternative, not as a sentence.
 *
 * An empty option makes a slot optional. "vain" and "just" are written into
 * the slots where they colour a crisis ("haluan vain kuolla", "I want to just
 * die") rather than dropped everywhere, because elsewhere they turn the
 * sentence round: "I don't want to just exist, I want to get strong" is a
 * training goal (review, 2026-10-07).
 */
const CRISIS_PATTERNS: readonly CrisisPattern[] = [
  // Finnish
  [FI_NOT, FI_NOT_COLOUR, FI_WANT_NOT, ['elää', 'herätä', 'olla elossa', 'olla olemassa']],
  // Not "herätä" here: "en jaksa herätä aamutreeniin" is a tired reader.
  [FI_NOT, FI_NOT_COLOUR, ['jaksa', 'jaksais', 'jaksaisi', 'jaksanut', 'jaksanu'], ['elää', 'elämää', 'olla elossa', 'olla olemassa']],
  // "en halua olla täällä salilla" is a long session.
  { slots: [FI_NOT, FI_NOT_COLOUR, FI_WANT_NOT, ['olla täällä']], closing: true },
  [FI_WANT, FI_WANT_COLOUR, ['kuolla', 'olla kuollut', 'olla kuolleena']],
  [['tapan', 'tappaa', 'tappaan', 'tappaisin', 'tappamaan', 'tapoin', 'tappanut'], ['itseni', 'itteni', 'ittein', 'itteeni', 'itseäni']],
  [
    ['toivon', 'toivoisin', 'toivoin'],
    ['', 'vain', 'vaan', 'jo'],
    ['että kuolisin', 'et kuolisin', 'etten heräisi', 'etten heräis', 'että en heräisi', 'että kuolen', 'et kuolen', 'kuolevani'],
  ],
  // "toivon etten herää kipeänä" is a sore morning.
  {
    slots: [['toivon', 'toivoisin', 'toivoin'], ['', 'vain', 'vaan', 'jo'], ['etten herää', 'että en herää', 'et en herää', 'etten ikinä herää']],
    closing: true,
  },
  // Not "päättää päiväni": that is also ending the day with a stretch.
  [['päättää', 'päätän', 'päättäisin', 'päätin', 'lopettaa', 'lopetan', 'lopettaisin', 'lopetin'], ['elämäni']],
  // The single act. Not the verb alone: "polvessa viiltää" is a sharp pain.
  [
    ['viiltää', 'viillän', 'viillät', 'viilsin', 'viilsi', 'viiltäisin', 'viiltäis', 'viiltämään', 'viiltänyt', 'viiltäny', 'viillellä'],
    ['itseäni', 'itseni', 'itteni', 'itteeni', 'ittiäni', 'ranteeni', 'ranteitani', 'ranteet', 'ranteen', 'käteni', 'käsiäni', 'käsivarteni', 'käsivarsiani', 'reisiäni'],
  ],
  [['haluan', 'haluun', 'haluu', 'haluaisin', 'tekis mieli', 'tekisi mieli', 'tekee mieli', 'aion', 'meinaan'], ['viiltää', 'viillellä']],
  [
    ['hyppään', 'hypätä', 'hyppäisin', 'hyppäsin', 'hyppäämään'],
    ['sillalta', 'katolta', 'parvekkeelta', 'kalliolta', 'tornista', 'ikkunasta', 'junan alle', 'auton alle', 'rekan alle', 'bussin alle'],
  ],
  [
    ['heittäydyn', 'heittäytyä', 'heittäytyisin', 'heittäydyin', 'heittäytymään', 'menen', 'meen', 'käyn', 'kävelen', 'jään'],
    ['junan alle', 'auton alle', 'rekan alle', 'bussin alle', 'ratikan alle'],
  ],
  // Every pill, whatever comes after it. A routine is said without "kaikki"
  // ("otan lääkkeet aamulla"); with it, a "when" did not make a routine of
  // it — "ennen kuin kukaan tulee kotiin" (re-hunt, 2026-10-07).
  [
    ['otan', 'ottaa', 'ottaisin', 'otin', 'ottamaan', 'syön', 'syödä', 'söin', 'syömään', 'nielen', 'niellä', 'nielin', 'vedän', 'vetää', 'vedin', 'popsin', 'popsia'],
    ['kaikki'],
    ['', 'mun', 'minun', 'ne'],
    ['pillerit', 'pillerini', 'lääkkeet', 'lääkkeeni', 'unilääkkeet', 'unilääkkeeni', 'tabletit', 'tablettini', 'särkylääkkeet', 'särkylääkkeeni', 'buranat', 'panadolit'],
  ],
  [
    ['otan', 'ottaa', 'otin', 'syön', 'syödä', 'söin', 'nielen', 'niellä', 'nielin', 'vedän', 'vetää', 'vedin', 'popsin', 'popsia'],
    ['koko purkin', 'koko purkillisen', 'purkillisen', 'kourallisen', 'koko paketin', 'koko pakkauksen', 'koko levyn'],
    ['pillereitä', 'lääkkeitä', 'unilääkkeitä', 'tabletteja', 'särkylääkkeitä', 'buranaa', 'panadolia', 'parasetamolia', 'ibuprofeenia'],
  ],
  // English. Not "kms": in a training app that is kilometres.
  [['suicide', 'suicidal', 'self-harm', 'self harm']],
  [
    ["don't", 'dont', 'do not', 'no longer', "didn't", 'didnt', 'did not', 'never'],
    ['want to', 'wanna', 'wish to', 'wanted to'],
    ['live', 'be alive', 'exist', 'stay alive', 'keep living', 'go on living'],
  ],
  [["i'd rather not", 'id rather not', 'i would rather not'], ['live', 'be alive', 'exist', 'be here', 'wake up']],
  // "I can't live without the gym" is a gym.
  {
    slots: [["can't", 'cant', 'cannot', 'can not'], ['live', 'keep living', 'go on living', 'stay alive']],
    unlessFollowedBy: ['without', 'on', 'off', 'near', 'far'],
  },
  // "I don't want to be here at 6am" is an early session.
  { slots: [["don't", 'dont', 'do not', 'no longer', 'never'], ['want to', 'wanna', 'wanted to'], ['be here', 'be around']], closing: true },
  // Not "going to" or "gonna": "I'm gonna die on leg day" is leg day.
  [
    ['want to', 'wanna', 'wanting to', 'wanted to', 'wish i could', 'would like to', "i'd like to", 'id like to', 'need to', 'deserve to'],
    ['', 'just'],
    ['die', 'be dead'],
  ],
  { slots: [["i'd rather", 'id rather', 'i would rather', "i'd sooner"], ['die', 'be dead']], unlessFollowedBy: ['than'] },
  [['hope', 'wish'], ['i'], ['die', 'would die', 'could die', 'would just die', 'was dead', 'were dead']],
  {
    slots: [['hope', 'wish'], ['i'], ["don't wake up", 'dont wake up', 'do not wake up', 'never wake up', "wouldn't wake up", 'wouldnt wake up', 'would not wake up']],
    closing: true,
  },
  [
    [
      'kill', 'killing', 'killed', 'killin', 'hang', 'hanging', 'hanged', 'hung', 'unalive', 'unaliving', 'unalived',
      'harm', 'harming', 'harmed', 'stab', 'stabbing', 'stabbed', 'strangle', 'strangling', 'suffocate', 'suffocating',
    ],
    EN_SELF,
  ],
  [['cut', 'cutting'], EN_SELF],
  { slots: [['shoot', 'shooting', 'shot'], EN_SELF], unlessFollowedBy: ['in the foot'] },
  {
    slots: [['drown', 'drowning', 'drowned'], EN_SELF],
    unlessFollowedBy: ['in work', 'in coffee', 'in caffeine', 'in protein', 'in training', 'in cardio', 'in volume', 'in sweat', 'in pre-workout', 'in preworkout'],
  },
  // Only with intent: "am I poisoning myself with creatine?" is a supplement
  // question, and "I overdosed on caffeine" a bad pre-workout.
  {
    slots: [EN_INTENT, ['', 'just'], ['poison myself', 'poison my self', 'overdose', 'od', 'take an overdose']],
    unlessFollowedBy: OVERDOSE_ON_FOOD,
  },
  {
    slots: [EN_THINKING, ['poisoning myself', 'overdosing', 'taking an overdose']],
    unlessFollowedBy: OVERDOSE_ON_FOOD,
  },
  // Every pill, or the whole bottle, whoever says it and whatever follows.
  // 4ff438f1 let the lead, a "before" clause or a question after it make a
  // dose of it, and "I'll take all my pills tonight", "...before my parents
  // get home" and "I took all my pills. should I go to work or the
  // hospital?" went past (re-hunt, 2026-10-07).
  [
    EN_SWALLOW,
    [
      'all my', 'all the', 'all of my', 'all of the', 'all', 'every', 'every single', 'every last', 'every one of my',
      'a bottle of', 'a whole bottle of', 'the whole bottle of', 'my whole bottle of', 'an entire bottle of',
      'the entire bottle of', 'a full bottle of',
    ],
    ['', 'my'],
    EN_PILLS,
  ],
  // "I swallowed the whole bottle." Not "the whole bottle of water".
  { slots: [EN_SWALLOW, ['the whole bottle', 'a whole bottle', 'the entire bottle', 'an entire bottle']], closing: true },
  [['slit', 'slitting', 'cut', 'cutting', 'slice', 'slicing', 'slash', 'slashing', 'open', 'opening'], ['my wrists', 'my wrist', 'my throat', 'my veins']],
  [
    [
      'jump off', 'jumping off', 'jumped off', 'jump from', 'jumping from', 'jump in front of', 'jumping in front of',
      'throw myself off', 'throw myself in front of', 'throw myself under', 'step in front of', 'walk in front of',
      'lie down in front of',
    ],
    ['a', 'the', 'that'],
    ['bridge', 'building', 'roof', 'rooftop', 'train', 'car', 'bus', 'truck', 'cliff', 'balcony', 'tower', 'overpass'],
  ],
  [['walk into', 'walking into', 'step into', 'jump into', 'run into'], ['traffic']],
  [['end', 'ending', 'ended'], ['my life', 'it all']],
  [['wish i was', 'wish i were', 'better off'], ['dead']],
  {
    slots: [['take', 'taking'], ['my life']],
    // Not a bare "in": "in the next few days" is a when (review, 2026-10-07).
    // Not a bare "to" or "over": "take my life to stop the pain" is the act
    // with its reason (A6 hunt, 2026-10-07).
    unlessFollowedBy: [
      'back', 'to the next level', 'to a new level', 'to another level', 'to new', 'to the gym', 'into', 'seriously',
      'more', 'forward', 'apart', 'in my hands', 'in hand',
    ],
  },
  {
    // Not a bare "will": "this set will end it." is a set.
    slots: [
      [
        'want to', 'wanna', 'wanted to', 'going to', 'gonna', 'i will', "i'll", 'ready to', 'about to', 'need to',
        'have to', 'should', 'could', 'might', 'plan to', 'planning to', 'decided to', "i'm", 'i am', 'im',
        ...EN_THINKING,
      ],
      ['', 'just'],
      ['end it', 'ending it'],
    ],
    inTheGym: endsASession,
  },
];

/** Words that may stand after a closing phrase and still let it close. */
const CRISIS_CLOSING_TAIL = new Set([
  'now', 'tonight', 'today', 'tomorrow', 'soon', 'already', 'forever', 'lately',
  'koskaan', 'ikinä', 'huomenna', 'pian', 'nyt', 'tänään',
]);

/** Words that turn a sentence, so the phrase before them closed it. */
const CRISIS_CLOSING_TURNS = new Set(['but', 'because', 'cause', 'cuz', 'mutta', 'koska']);

/**
 * Words that colour a sentence and never change what it says.
 *
 * Not read at all, wherever they sit — "en enää halua elää", "en halua enää
 * elää" and "en halua elää enää" are one sentence. "own" is here so "end my
 * own life" is "end my life"; the pronouns because spoken Finnish puts one
 * in the middle ("en mä jaksa elää"); the swearing and "so" because they sit
 * inside a phrase as often as around it ("I want to fucking die").
 */
const CRISIS_FILLERS = new Set([
  'enää', 'enään', 'ihan', 'oikeasti', 'oikeesti', 'edes', 'yhtään', 'kyllä', 'kyl', 'tätä',
  'minä', 'mä', 'mää', 'mie',
  'really', 'even', 'ever', 'honestly', 'truly', 'actually', 'literally', 'anymore', 'own', 'still',
  'so', 'kinda', 'genuinely', 'lowkey', 'legit', 'fucking', 'fuckin', 'fking', 'fkn', 'freaking', 'frickin',
]);

const words = (option: string) => (option ? option.split(' ') : []);

/** Every way through a row of slots, as word lists. */
function expand(slots: CrisisSlots): string[][] {
  return slots.reduce<string[][]>(
    (phrases, slot) => phrases.flatMap((phrase) => slot.map((option) => [...phrase, ...words(option)])),
    [[]],
  );
}

interface CrisisPhrase {
  phrase: readonly string[];
  unless: readonly (readonly string[])[];
  closing: boolean;
  inTheGym: ((rest: readonly CrisisWord[]) => boolean) | null;
}

const CRISIS_PHRASES: readonly CrisisPhrase[] = CRISIS_PATTERNS.flatMap((pattern) => {
  const { slots, unlessFollowedBy = [], closing = false, inTheGym = null } =
    'slots' in pattern ? pattern : { slots: pattern };
  const unless = unlessFollowedBy.map(words);
  return expand(slots).map((phrase) => ({ phrase, unless, closing, inTheGym }));
});

/** A word with its hyphens and apostrophes out: "self-harm" and "selfharm", "don't" and "dont". */
const glued = (word: string) => word.replace(/['-]/g, '');

/** Runs of one repeated letter as one letter: "diiiie" and "die" both "die", "wannnna" and "wanna" both "wana". */
const squeezed = (word: string) => word.replace(/(\p{L})\1+/gu, '$1');

function indexBy(key: (entry: CrisisPhrase) => string | null): Map<string, CrisisPhrase[]> {
  const index = new Map<string, CrisisPhrase[]>();
  for (const entry of CRISIS_PHRASES) {
    const at = key(entry);
    if (at === null) continue;
    const bucket = index.get(at);
    if (bucket) bucket.push(entry);
    else index.set(at, [entry]);
  }
  return index;
}

/** The phrases by their first word: thousands of phrases, read once per word. */
const PHRASES_BY_FIRST_WORD = indexBy((entry) => entry.phrase[0]);

/** The same, for a first word typed with a letter held down. */
const PHRASES_BY_SQUEEZED_FIRST_WORD = indexBy((entry) => squeezed(entry.phrase[0]));

/**
 * For a starred first word, the phrases whose first word is as long: a star
 * stands for one letter. Read against every phrase, a prompt of starred
 * words cost the server seconds per request (review, 2026-10-07).
 */
const PHRASES_BY_FIRST_WORD_LENGTH = indexBy((entry) => String(entry.phrase[0].length));
const PHRASES_BY_SQUEEZED_FIRST_WORD_LENGTH = indexBy((entry) => String(squeezed(entry.phrase[0]).length));

function phrasesFor(token: CrisisWord): readonly CrisisPhrase[] {
  if (!token.loose) return PHRASES_BY_FIRST_WORD.get(token.word) ?? [];
  const typed = squeezed(token.word);
  if (!token.word.includes('*')) return PHRASES_BY_SQUEEZED_FIRST_WORD.get(typed) ?? [];
  return HELD_LETTER.test(token.word)
    ? PHRASES_BY_SQUEEZED_FIRST_WORD_LENGTH.get(String(typed.length)) ?? []
    : PHRASES_BY_FIRST_WORD_LENGTH.get(String(token.word.length)) ?? [];
}

/**
 * The phrases of two words or more, typed as one: "killmyself",
 * "kill-myself", "iwanttodie" (A6 hunt, 2026-10-07).
 */
const PHRASES_GLUED = indexBy((entry) => (entry.phrase.length > 1 ? glued(entry.phrase.join('')) : null));

/** A sentence end, between words. */
const CLAUSE_END = '.';

/** A word of the reader's, and whether a sentence ends after it. */
interface CrisisWord {
  word: string;
  closes: boolean;
  /**
   * For a word typed loosely — a letter held down ("diiiie"), or one starred
   * out ("k*ll") — what it may be read as. Null for every other word, which
   * reads only as itself.
   */
  loose: ((listed: string) => boolean) | null;
}

/** No word in either language holds one letter three times running. */
const HELD_LETTER = /(\p{L})\1\1/u;

/**
 * The swearing a reader stars out. A star hides the vowel of these, so a
 * starred word that reads as one is that word wherever its vowel is starred:
 * "sh*t myself" read as "shot myself" and got the crisis line (re-hunt,
 * 2026-10-07). Its consonants stay open, so "s**t my wrists" is still "slit".
 */
const STARRED_SWEARING = [
  'shit', 'fuck', 'fucked', 'damn', 'crap', 'piss', 'pissed', 'hell', 'dick', 'cock', 'cunt', 'bitch', 'ass', 'arse',
  'twat', 'wank', 'paska', 'vittu', 'perkele', 'saatana', 'helvetti',
];

const VOWEL = /[aeiouyäö]/;

/** Whether a starred word fits a word: as long, and each star one letter. */
const fits = (typed: string, target: string) =>
  typed.length === target.length && [...typed].every((letter, i) => letter === '*' || letter === target[i]);

function looseReading(word: string): CrisisWord['loose'] {
  const starred = word.includes('*');
  const held = HELD_LETTER.test(word);
  if (!starred && !held) return null;
  const typed = held ? squeezed(word) : word;
  const swearing = starred
    ? STARRED_SWEARING.map((swear) => (held ? squeezed(swear) : swear)).find((swear) => fits(typed, swear))
    : undefined;
  return (listed) => {
    const target = held ? squeezed(listed) : listed;
    if (!starred) return typed === target;
    if (!fits(typed, target)) return false;
    return (
      swearing === undefined ||
      [...typed].every((letter, i) => letter !== '*' || !VOWEL.test(swearing[i]) || target[i] === swearing[i])
    );
  };
}

const reads = (token: CrisisWord | undefined, listed: string) =>
  token !== undefined && (token.word === listed || (token.loose?.(listed) ?? false));

/**
 * The words read for a crisis, fillers out, each marked if a sentence ends
 * after it. Quote marks and stars come off the ends of a word — "‘I want to
 * die’" is typed with the curly quotes the apostrophe fold straightens
 * (review, 2026-10-07) — and the apostrophe inside "don't" stays.
 */
function crisisTokens(text: string): CrisisWord[] {
  const tokens: CrisisWord[] = [];
  for (const raw of text.split(' ')) {
    if (raw === CLAUSE_END) {
      if (tokens.length > 0) tokens[tokens.length - 1].closes = true;
      continue;
    }
    const word = raw.replace(/^['*-]+|['*-]+$/g, '');
    if (!/[\p{L}\p{N}]/u.test(word)) continue;
    const loose = looseReading(word);
    if (CRISIS_FILLERS.has(word) || (loose && [...CRISIS_FILLERS].some(loose))) continue;
    tokens.push({ word, closes: false, loose });
  }
  if (tokens.length > 0) tokens[tokens.length - 1].closes = true;
  return tokens;
}

function startsAt(tokens: readonly CrisisWord[], at: number, phrase: readonly string[]): boolean {
  return phrase.length > 0 && phrase.every((word, i) => reads(tokens[at + i], word));
}

/** The sentence that starts at `start`: its words up to the one it ends after. */
function sentenceFrom(tokens: readonly CrisisWord[], start: number): readonly CrisisWord[] {
  const end = tokens.findIndex((token, at) => at >= start && token.closes);
  return end < 0 ? [] : tokens.slice(start, end + 1);
}

/** Whether a phrase whose last word is `last` says it, given what follows. */
function settles(tokens: readonly CrisisWord[], last: number, entry: CrisisPhrase): boolean {
  const { unless, closing, inTheGym } = entry;
  if (inTheGym) return !inTheGym(tokens[last].closes ? [] : sentenceFrom(tokens, last + 1));
  if (tokens[last].closes) return true;
  const next = last + 1;
  if (closing) {
    if (CRISIS_CLOSING_TURNS.has(tokens[next].word)) return true;
    return CRISIS_CLOSING_TAIL.has(tokens[next].word) && tokens[next].closes;
  }
  return !unless.some((after) => startsAt(tokens, next, after));
}

function saysCrisis(text: string): boolean {
  const tokens = crisisTokens(text);
  return tokens.some((token, at) => {
    const says = (entry: CrisisPhrase) => startsAt(tokens, at, entry.phrase) && settles(tokens, at + entry.phrase.length - 1, entry);
    if (phrasesFor(token).some(says)) {
      return true;
    }
    // One word that is a whole phrase typed without its spaces — and
    // "iwanttodie" with the "i" on the front.
    const typed = glued(token.word);
    return [typed, typed.startsWith('i') ? typed.slice(1) : ''].some((key) =>
      (PHRASES_GLUED.get(key) ?? []).some((entry) => settles(tokens, at, entry)),
    );
  });
}

/**
 * Words whose every ending names the thing itself.
 *
 * A phrase list matched as whole words could not hold Finnish: "itsemurha"
 * did not catch "ajattelen itsemurhasta" or "mietin itsemurhaan", because the
 * case ending is part of the word (bug hunt, 2026-10-05). These stems match
 * from the start of a word with any ending, and none of them begins a word
 * that means something else. "viillel" is the same verb after consonant
 * gradation ("olen viillellyt"), and "itsari" the spoken word for itsemurha
 * ("aion tehdä itsarin") — both went past as training (evening hunt,
 * 2026-10-05).
 *
 * Not "viilt" alone: "viiltävä kipu" is a sharp pain and "viilto" an
 * incision. The single act is in the slots, with what it is done to.
 *
 * The English stems and the misspellings are the A6 hunt's (2026-10-07):
 * "sucide" is the commonest way the word is typed, and "self-harming",
 * "selfharm" and "self harmed" were each one word or two the list did not
 * have. "itse murha" is the compound typed apart.
 */
const CRISIS_STEMS = [
  'itsemurh', 'itsetuho', 'viiltel', 'viillel', 'itsari',
  'itse murh', 'itse-murh', 'itse tuhoi', 'itse tuhois', 'itse-tuho', 'itsmurh', 'itsemuhr', 'itsemruh',
  'suicid', 'sucid', 'suicd', 'suisid', 'suecid', 'sucicid', 'self-harm', 'self harm', 'selfharm', 'sewerslid', 'sewer slid',
];

/**
 * Stems no other Finnish word contains anywhere, so they match inside a
 * compound too — "lääkeitsemurha", "itsemurhayritys" (review, 2026-10-05).
 */
const CRISIS_INFIXES_FI = ['itsemurh', 'itsetuho'];

/**
 * The apostrophes a phone keyboard types. iOS and Gboard put a curly one in
 * "don’t" by default, and the list spells it straight, so "I don’t want to
 * live anymore" went past as a training question (bug hunt, 2026-10-05).
 */
const APOSTROPHES = /[‘’ʼ`´]/g;

/**
 * Characters that are not there to the reader: the zero-width space and
 * joiners, the soft hyphen, the direction marks, the invisible operators, and
 * every combining mark left after composition — a variation selector, a
 * strikethrough, U+034F. Each split or glued a word the reader saw whole
 * ("sui\u200Ecide", "die\u034F"; A6 hunt, 2026-10-07).
 */
const INVISIBLE = /[\p{Cf}\p{M}]/gu;

/**
 * What a sentence end is between words: the punctuation, a line break, a
 * dash between words — and a bracket, a double quote and an emoji, which a
 * phone types where a full stop would go.
 */
const SENTENCE_END = /[.!?\u2026;:,\n\r\u2013\u2014()[\]{}"\u00AB\u00BB\u201C\u201D\u201E\p{Extended_Pictographic}]+|\s-+\s/gu;

/** Digits and signs typed for letters: "su1cide", "k1ll". */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/**
 * The text a crisis phrase is matched against, reduced to its words.
 *
 * Each of these let a listed phrase through as a training question (bug hunt,
 * 2026-10-05): "Toivon, että kuolisin" has a comma the phrase does not, two
 * spaces or a line break sit where the phrase has one, a no-break space is
 * not a space to the phrase, and an "ä" typed as "a" plus a combining mark is
 * not the "ä" in the list — nor a letter at all to the word boundary.
 *
 * So: one composed form, invisible characters gone, every run of punctuation
 * and space one plain space. Apostrophes and hyphens stay, because "don't"
 * and "self-harm" are spelled with them, and so does a star inside a word
 * ("k*ll"). A sentence end stays as a word of its own, `CLAUSE_END`, for the
 * phrases the next word decides. And a word spelled out a letter at a time
 * ("s u i c i d e") is read as the word.
 */
function crisisWords(text: string): string {
  const cleaned = text
    .replace(INVISIBLE, '')
    .replace(SENTENCE_END, ` ${CLAUSE_END} `)
    .replace(/[^\p{L}\p{N}'*.-]+/gu, ' ')
    .trim();
  return spelledOutJoined(cleaned);
}

/** Three or more single letters in a row, read as one word. */
function spelledOutJoined(text: string): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const word of text.split(' ')) {
    if (/^\p{L}$/u.test(word)) {
      run.push(word);
    } else {
      flush();
      out.push(word);
    }
  }
  flush();
  return out.join(' ');
}

/**
 * Every way the reader's text may be read for a crisis.
 *
 * A zero-width space is two things at once: inside "itse\u200Bmurha" it is
 * nothing, and in "kill\u200Bmyself" it is the space. So it is read both
 * ways. Digits typed for letters are read both as digits — "5x5" is sets —
 * and as the letters. Each reading is checked; any one is enough, because a
 * crisis read twice costs nothing and one read zero times costs everything.
 */
function crisisReadings(text: string): string[] {
  const asLetters = text.replace(/[\p{L}\p{N}@$*]+/gu, (word) =>
    /\p{L}/u.test(word) && /[\d@$]/.test(word) ? word.replace(/[\d@$]/g, (sign) => LEET[sign] ?? sign) : word,
  );
  const readings = [text, asLetters].flatMap((reading) => [reading.replace(/\u200B/g, ' '), reading]);
  return [...new Set(readings.map((reading) => withoutGymLookalikes(crisisWords(reading))))];
}

/** Whether any reading of this text names the thing itself. */
function namesCrisis(text: string): boolean {
  return crisisReadings(text).some((words) => {
    // A held letter gives way for the stems too: "suiiiicide".
    const stemmed = [words, words.replace(/(\p{L})\1{2,}/gu, '$1')];
    return (
      saysCrisis(words) ||
      stemmed.some((reading) => CRISIS_STEMS.some((stem) => hasWordStart(reading, stem))) ||
      CRISIS_INFIXES_FI.some((infix) => words.includes(infix))
    );
  });
}

/**
 * Gym sentences that contain a crisis word and mean only the gym.
 *
 * Taken out before the crisis lists are read, so the rest of the sentence is
 * still read: "suicide sprints make me want to die" still gets the line.
 *
 * - Suicide sprints (and runs, drills, shuttles) are a conditioning drill,
 *   and so are "suicides" run on a court; the suicide grip is a thumbless
 *   grip on the bar. Not "suicide lines": that is also how a reader asks for
 *   a crisis line.
 * - The knurling cuts hands; "I cut myself on the bar" is an injury report,
 *   and so is a wrist cut on it. Only the gym's own objects are excused —
 *   "cut myself on my arm" is not.
 * - "viiltelevä kipu" is a stabbing pain. The participle names the pain; the
 *   forms that name the act — viiltelin, viiltely, viiltelen — stay in.
 */
const GYM_OBJECTS = '(knurl\\p{L}*|bar|barbell|bars|plate|plates|rack|kettlebell|dumbbell|machine|equipment|j-hooks?|hooks?|safet\\p{L}*|pins?|collar|clip)';
const GYM_LOOKALIKES: RegExp[] = [
  /(^|[^\p{L}\p{N}])suicide[ -](sprint|run|drill|shuttle|grip)\p{L}*(?![\p{L}\p{N}])/gu,
  /(^|[^\p{L}\p{N}])(do|doing|did|done|run|running|ran) suicides(?![\p{L}\p{N}])/gu,
  /(^|[^\p{L}\p{N}])suicides (on|at|for|after|before) (the |a )?(track|court|field|pitch|line|lines|turf|hill|conditioning|practice|training)(?![\p{L}\p{N}])/gu,
  new RegExp(`(^|[^\\p{L}\\p{N}])cut (myself|my wrists?) on (the|a|my) ${GYM_OBJECTS}(?![\\p{L}\\p{N}])`, 'gu'),
  /(^|[^\p{L}\p{N}])viiltelev\p{L}*/gu,
];

function withoutGymLookalikes(text: string): string {
  return GYM_LOOKALIKES.reduce((rest, pattern) => rest.replace(pattern, '$1 '), text);
}

/**
 * Subjects with no training reading at all.
 *
 * Each one is a word the reader would only write when asking about something
 * else entirely. Words that are also gym words stay out of this list —
 * "ohjelma" is a programme, "python" is not a lift.
 */
const OFF_TOPIC_WORDS = [
  // Code and computers
  'python', 'javascript', 'typescript', 'sql', 'koodi', 'koodaa', 'ohjelmoin', 'debug', 'regex', 'algoritmi',
  // Politics, news, money
  'presidentti', 'eduskunta', 'politii', 'vaali', 'vaale', 'hallitus', 'president', 'election', 'politic',
  'osake', 'bitcoin', 'kryptov', 'sijoit', 'stock market',
  // Weather, travel, entertainment
  'sääennuste', 'sään ennuste', 'sataako', 'weather', 'forecast', 'lentolippu', 'hotelli', 'matkusta', 'flight', 'hotel',
  'elokuva', 'leffa', 'movie', 'netflix', 'jalkapallo-ottelu',
  // Homework and writing
  'runo', 'essee', 'novelli', 'käännä tämä', 'poem', 'essay', 'translate this', 'write me a story',
  // The assistant itself
  'mikä malli olet', 'oletko tekoäly', 'what model are you', 'are you chatgpt', 'gpt-4', 'your system prompt',
];

/**
 * Words that mean the gym and nothing else.
 *
 * These are the veto: an off-topic word inside a real training question must
 * not win — "ehdinkö juosta maratonin ennen vaaleja" is a training question
 * with an election in it.
 *
 * The everyday words a gym shares with the rest of the language are NOT here,
 * and that is the point. "program", "set", "rest", "run" and "weight" are all
 * training words, and all of them appear in "write me a python program that
 * sorts a list" — which read as a training question, and was answered as one
 * with the reader's own numbers in it, until this list was narrowed
 * (PR #124 review).
 */
const GYM_STEMS_FI = [
  'treen', 'harjoit', 'kuntosal', 'sali', 'lihas', 'kyykky', 'kyykk', 'penkkipunnerr', 'penkkiin', 'maastaveto',
  'maastavet', 'toistoa', 'toistoja', 'sarjaa', 'sarjoja', 'palautu', 'proteiin', 'kalori', 'liikkuvuus',
  'venytt', 'ennätys', 'kehonpaino', 'juoks', 'juost', 'lenkki', 'lenkille', 'hauis', 'ojentaja', 'selkälihas',
  'vatsalihas', 'punnerr', 'leuanveto', 'tankoa', 'käsipaino', 'levytanko', 'rasvaprosent', 'massaa',
];

const GYM_WORDS_EN = [
  'workout', 'workouts', 'gym', 'squat', 'squats', 'bench', 'deadlift', 'deadlifts', 'hypertrophy', 'cardio',
  'barbell', 'dumbbell', 'kettlebell', 'lifting', 'lifts', 'reps', 'muscle', 'muscles', 'protein', 'calories',
  'mobility', 'stretching', 'bodyweight', 'pull-up', 'pullup', 'push-up', 'pushup', 'biceps', 'triceps',
  'macros', 'deload', 'warm-up',
];

/** Whether this text names the gym, in either language. */
function mentionsTraining(text: string): boolean {
  return (
    GYM_STEMS_FI.some((stem) => hasWordStart(text, stem)) ||
    GYM_WORDS_EN.some((word) => hasWord(text, word))
  );
}

export function classifyCoachScope(prompt: string): CoachScopeVerdict {
  // NFKC folds the full-width letters and the ligatures a keyboard can type
  // into the plain ones the lists spell. The apostrophes are straightened
  // first: NFKC splits "´" into a space and a mark.
  const text = prompt.replace(APOSTROPHES, "'").normalize('NFKC').toLowerCase();
  if (namesCrisis(text)) {
    return 'crisis';
  }

  const offTopic = OFF_TOPIC_WORDS.some((word) =>
    word.includes(' ') ? text.includes(word) : hasWordStart(text, word),
  );
  if (!offTopic) {
    // Training is the default, not the leftovers: a question this cannot
    // place is far more likely to be an oddly worded training question than
    // an essay, and turning a reader away from their own app is the worse
    // mistake.
    return 'training';
  }

  return mentionsTraining(text) ? 'training' : 'off_topic';
}
