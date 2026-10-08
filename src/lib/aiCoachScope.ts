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
 * - `inTheGym`: a reading of the rest of the sentence (and of everything
 *   after it) that says it is the session. Crisis unless it does.
 * - `thenInSentence`: the row says it only with one of these later in the
 *   same sentence — "how many pills ... to die".
 *
 * A comma, a line break and a dash end a sentence here as much as a full stop
 * does: a phone types "I want to end it, nothing matters" (review,
 * 2026-10-07). So do a bracket, a double quote and an emoji: "I want to end
 * it 😭 nothing matters" (A6 hunt, 2026-10-07).
 *
 * A `closing` row once named the crisis and let everything else out, and
 * "I'm going to end it tomorrow", "I hope I don't wake up again" and "en
 * halua olla täällä maailmassa" went past as training (A6 hunt, 2026-10-07;
 * K1 hunt, 2026-10-08). The excuses only ever narrow a crisis to the gym talk
 * they name: a crisis must never reach the model, and a sentence that could
 * be either gets the line (owner's call, 2026-10-07). A false alarm costs one
 * answer; a missed crisis is not a cost this file may take.
 */
type CrisisPattern =
  | CrisisSlots
  | {
      slots: CrisisSlots;
      unlessFollowedBy?: readonly string[];
      inTheGym?: CrisisGymReading;
      thenInSentence?: readonly string[];
    };

/** The rest of the sentence after a phrase, and everything after the phrase. */
type CrisisGymReading = (rest: readonly CrisisWord[], after: readonly CrisisWord[]) => boolean;

/**
 * "ä" and "a" as one letter, "ö" and "o" as one, "å" and "a" as one.
 *
 * A reader on an English layout, or typing fast, leaves them out, and "en
 * halua elaa" and "haluan paattaa elamani" went past every Finnish row as
 * training (K1 hunt, 2026-10-08). Every reading of the text is folded, and so
 * is every word this file compares it with — the slots, the stems, the
 * fillers and the excuses — so the lists stay spelled the way Finnish is.
 */
const folded = (text: string) => text.replace(/[äå]/g, 'a').replace(/ö/g, 'o');

const foldedSet = (list: readonly string[]) => new Set(list.map(folded));

/**
 * A slot that reads a count past what any routine takes: "I took 30 sleeping
 * pills", "otin kolmekymmentä unilääkettä" (K1 hunt, 2026-10-08). Ten and
 * up; "I take 3 creatine pills" is a supplement.
 */
const MANY = '#many';
const MANY_WORDS = foldedSet([
  'ten', 'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'hundred', 'dozen', 'dozens',
  'hundreds', 'kymmenen', 'kaksitoista', 'viisitoista', 'kaksikymmentä', 'kolmekymmentä', 'neljäkymmentä',
  'viisikymmentä', 'sata', 'satoja', 'kymmeniä', 'kymmenkunta',
]);
const isMany = (word: string) => (/^\d+$/.test(word) ? Number(word) >= 10 : MANY_WORDS.has(word));

/**
 * A slot that reads any count: what a count of whole packs is counted in.
 * "I took 2 packs of paracetamol" is twenty pills or more (K1 review,
 * 2026-10-08).
 */
const COUNT = '#count';
const COUNT_WORDS = foldedSet([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'few', 'couple', 'several', 'yksi', 'yhden',
  'kaksi', 'kaks', 'kolme', 'neljä', 'viisi', 'kuusi', 'seitsemän', 'kahdeksan', 'yhdeksän', 'pari', 'monta', 'useamman',
]);
const isCount = (word: string) => /^\d+$/.test(word) || isMany(word) || COUNT_WORDS.has(word);

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

/** "otan kaikki pillerit", "nielin koko purkin": taking, eating, swallowing. */
const FI_SWALLOW = [
  'otan', 'ottaa', 'ottaisin', 'otin', 'ottamaan', 'syön', 'syödä', 'söin', 'syömään', 'nielen', 'niellä', 'nielin',
  'vedän', 'vetää', 'vedin', 'popsin', 'popsia',
];

/** What a whole pack of is food or a supplement: "koko levyn suklaata". */
const FI_WHOLE_PACK_FOOD = [
  'vettä', 'proteiinia', 'proteiinijauhetta', 'jauhetta', 'kreatiinia', 'vitamiineja', 'vitamiinia', 'magnesiumia',
  'kalaöljyä', 'kofeiinia', 'kahvia', 'karkkia', 'karkkeja', 'suklaata', 'jäätelöä', 'sipsejä', 'keksejä', 'rahkaa',
  'maitoa', 'mehua', 'jogurttia', 'patukoita', 'proteiinipatukoita', 'pre-workoutia', 'preworkoutia', 'pre', 'energiajuomaa',
  'energiajuomia', 'pähkinöitä', 'hiutaleita', 'kaurahiutaleita', 'riisiä', 'pastaa', 'leipää', 'munia', 'kananmunia',
  'tonnikalaa', 'raejuustoa', 'juustoa', 'purkkaa', 'pizzaa',
];

/** "otin 30 unilääkettä": what a counted dose is counted in. */
const FI_PILLS_COUNTED = [
  'pilleriä', 'unipilleriä', 'lääkettä', 'unilääkettä', 'särkylääkettä', 'tablettia', 'kapselia', 'buranaa', 'panadolia',
  'parasetamolia', 'ibuprofeenia',
];

/** What a pack or a handful of is: "kaksi pakkausta buranaa". */
const FI_PILLS_PARTITIVE = [
  'pillereitä', 'unipillereitä', 'lääkkeitä', 'unilääkkeitä', 'särkylääkkeitä', 'tabletteja', 'kapseleita', 'buranaa',
  'panadolia', 'parasetamolia', 'ibuprofeenia',
];

/** Killing, hanging, shooting, drowning, poisoning: the Finnish verb a reader uses of themselves. */
const FI_METHOD_VERBS = [
  'hirttää', 'hirtän', 'hirttäisin', 'hirttäis', 'hirtin', 'hirttämään', 'hirttänyt', 'hirttäny',
  'ampua', 'ammun', 'ampuisin', 'ampuis', 'ammuin', 'ampumaan', 'ampunut', 'ampunu',
  'hukuttaa', 'hukutan', 'hukuttaisin', 'hukutin', 'hukuttamaan', 'hukuttanut',
  'myrkyttää', 'myrkytän', 'myrkyttäisin', 'myrkytin', 'myrkyttämään', 'myrkyttänyt', 'myrkyttäny',
];

/** "itseni" as it is said and typed, and the third person a question asks in. */
const FI_SELF = ['itseni', 'itteni', 'ittein', 'itteeni', 'itseäni', 'ittiäni', 'itsensä', 'ittensä'];

/** Where a jump is from, and what a reader goes under or in front of. */
const FI_UNDER = [
  'junan alle', 'auton alle', 'rekan alle', 'bussin alle', 'ratikan alle', 'raitiovaunun alle', 'metron alle',
  'junan eteen', 'auton eteen', 'rekan eteen', 'bussin eteen', 'ratikan eteen', 'raitiovaunun eteen', 'metron eteen',
];
const FI_JUMP_FROM = [
  'sillalta', 'sillalt', 'katolta', 'katolt', 'parvekkeelta', 'parvekkeelt', 'kalliolta', 'kalliolt', 'tornista',
  'ikkunasta', 'kerroksesta', ...FI_UNDER,
];

/**
 * What "lopetan kaiken" quits when it is a habit: "lopetan kaiken sokerin".
 * Closed, on purpose: a sentence that stops at "kaiken", or goes on with
 * anything else, is the crisis.
 */
const FI_QUIT_HABITS = foldedSet([
  'sokerin', 'herkuttelun', 'herkut', 'herkkujen', 'karkin', 'karkkien', 'alkoholin', 'juomisen', 'syömisen',
  'napostelun', 'treenin', 'treenaamisen', 'treenit', 'kardion', 'juoksemisen', 'muun', 'turhan', 'roskaruoan',
  'roskaruuan', 'pikaruoan', 'kahvin', 'mässäilyn', 'tupakoinnin', 'nuuskan', 'energiajuomien', 'lisäravinteiden',
  'somen', 'pelaamisen', 'muut', 'ylimääräisen', 'ylimääräiset',
]);

/**
 * What makes a genitive the object of a postposition rather than of
 * "lopettaa": "lopetan kaiken treenin jälkeen" ends everything after
 * training (K1 review, 2026-10-08). "ennen" only where it ends the sentence:
 * "lopetan kaiken sokerin ennen kisoja" is a diet, "ennen" going with
 * "kisoja".
 */
const FI_POSTPOSITIONS = foldedSet(['jälkeen', 'jälkeenkin', 'jälkee', 'aikana', 'takia', 'takii', 'vuoksi', 'perään', 'myötä']);

/** Whether "lopetan kaiken" goes on into a habit it quits, and only that. */
function quitsAHabit(rest: readonly CrisisWord[]): boolean {
  if (!FI_QUIT_HABITS.has(rest[0]?.word ?? '')) return false;
  const next = rest[1]?.word;
  return next === undefined || !(FI_POSTPOSITIONS.has(next) || (next === 'ennen' && rest.length === 2));
}

/** "olen väsynyt elämään dieetillä" is a long cut. */
const FI_LIVING_ON = ['dieetillä', 'dieetissä', 'kanalla', 'riisillä', 'salaatilla', 'proteiinilla', 'rahkalla'];

/** "myself", and the ways a thumb types it. */
const EN_SELF = ['myself', 'my self', 'meself', 'myselfs', 'myslef', 'mysef'];

/** Intent, in the tenses and modals a reader uses of themselves. */
const EN_INTENT = [
  'want to', 'wanna', 'wanted to', 'wanting to', 'going to', 'gonna', 'i will', "i'll", 'ready to', 'about to',
  'plan to', 'planning to', 'decided to', 'need to', 'have to', 'try to', 'tried to', 'trying to', 'would like to',
  "i'd like to", 'id like to', 'should', 'could', 'might',
];

/**
 * A wish to die, as "want to" and its neighbours say it. Not "going to" or
 * "gonna": "I'm gonna die on leg day" is leg day. Nor "about to": "I'm about
 * to die on this set" is the set.
 */
const EN_WISH_TO = [
  'want to', 'wanna', 'wanting to', 'wanted to', 'wish i could', 'would like to', "i'd like to", 'id like to', 'need to',
  'deserve to', 'should', 'ready to', 'might as well', 'all i want is to', 'all i wanna do is', 'praying to', 'pray to',
  'long to',
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
 * "on deadlifts", "after 3 sets". Closed lists, on purpose. 4ff438f1 read
 * anything that was not a listed method as the session, and "end it with a
 * gunshot", "on friday" and "after 3 days" went past as training (re-hunt,
 * 2026-10-07): a method list is never finished, and an exercise these lists
 * miss costs only a false alarm. Not "train", "car" or "bridge", which are
 * how a crisis says it, nor a bare "minutes", "failure" or "note".
 */

/** What a session is counted in: "after 3 sets", "with a drop set". */
const END_IT_UNITS = new Set([
  'set', 'sets', 'superset', 'supersets', 'dropset', 'dropsets', 'rep', 'reps', 'round', 'rounds', 'lap', 'laps',
]);

/** The exercises by name: "with dips", "on deadlifts", "after squats". */
const END_IT_EXERCISES = new Set([
  'dips', 'dip', 'squat', 'squats', 'deadlift', 'deadlifts', 'bench', 'press', 'presses', 'curl', 'curls', 'row', 'rows',
  'pullup', 'pullups', 'pull-up', 'pull-ups', 'chinup', 'chinups', 'chin-up', 'chin-ups', 'pushup', 'pushups', 'push-up',
  'push-ups', 'burpee', 'burpees', 'lunge', 'lunges', 'crunch', 'crunches', 'situp', 'situps', 'sit-up', 'sit-ups',
  'plank', 'planks', 'raises', 'extensions', 'flyes', 'flies', 'shrugs', 'cleans', 'snatch', 'snatches', 'thruster',
  'thrusters', 'swings', 'pulldown', 'pulldowns', 'pushdown', 'pushdowns', 'kickbacks', 'climbers', 'carries', 'sprint',
  'sprints', 'skipping',
]);

/**
 * The rest of what "end it with" may go on into: "with a finisher", "with
 * core work", "with a run". Not after "on" or "after": "on a good note" and
 * "after this session" are how a farewell is said too (review, 2026-10-07).
 */
const END_IT_WITH_WORDS = new Set([
  'km', 'miles', 'finisher', 'finishers', 'burnout', 'amrap', 'emom', 'hiit', 'tabata', 'circuit', 'circuits',
  'cooldown', 'warmup', 'warm-up', 'stretch', 'stretches', 'stretching', 'mobility', 'yoga', 'cardio', 'conditioning',
  'core', 'abs', 'workout', 'session', 'exercise', 'exercises', 'deload', 'accessories', 'accessory', 'isolation', 'pump',
  'pr', 'pb', 'rpe', 'run', 'jog', 'rowing', 'bike', 'cycling', 'treadmill', 'elliptical', 'erg', 'stairmaster',
  'kettlebell', 'kettlebells', 'dumbbell', 'dumbbells', 'barbell', 'farmer', 'farmers', 'glute', 'glutes', 'calves',
  'calf', 'hamstrings', 'quads', 'biceps', 'triceps', 'arms', 'legs', 'chest', 'shoulders',
]);

/** Exercises said in two words: "a heavy single", "box jumps". */
const END_IT_EXERCISE_PHRASES = [['heavy', 'single'], ['box', 'jumps'], ['jumping', 'jacks']];

/** Parts of a session said in two words, after "with" only. */
const END_IT_WITH_PHRASES = [['cool', 'down'], ['warm', 'up']];

/** What counts the sets in "after 3 sets", "after this set". */
const END_IT_COUNT = new Set([
  'this', 'that', 'the', 'these', 'those', 'next', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'few', 'couple',
]);

/**
 * The words of a farewell. With any of them in the sentence, "end it" is the
 * crisis, whatever else is there: "after my last workout", "with one final
 * set", "after one more run" (review, 2026-10-07).
 */
const END_IT_FAREWELL = [['last'], ['final'], ['one', 'more']];

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

/**
 * Whether a list holds the word at `i`, or the hyphened word it starts: the
 * reading that splits "i-want-to-die" splits "pull-up" too, and "end it with
 * pull-ups" went to the crisis line (K1 review, 2026-10-08). "pull ups" typed
 * with a space is the same exercise.
 */
function holdsAt(list: ReadonlySet<string> | readonly string[], words: readonly CrisisWord[], i: number): boolean {
  const has = (word: string) => ('has' in list ? list.has(word) : list.includes(word));
  return has(words[i].word) || (i + 1 < words.length && has(`${words[i].word}-${words[i + 1].word}`));
}

/** Whether the words from `i` name an exercise: "dips", "a jump rope", "a glute bridge". */
function namesExerciseAt(words: readonly CrisisWord[], i: number): boolean {
  if (holdsAt(END_IT_EXERCISES, words, i)) return true;
  if (END_IT_EXERCISE_PHRASES.some((phrase) => startsAt(words, i, phrase))) return true;
  return END_IT_METHOD.has(words[i].word) && !namesMethodAt(words, i);
}

/** Whether the word at `i` counts sets: "3 sets", "this set", "three rounds". */
function countsSetsAt(words: readonly CrisisWord[], i: number): boolean {
  const count = words[i - 1]?.word ?? '';
  return END_IT_UNITS.has(words[i].word) && (/^\d+$/.test(count) || END_IT_COUNT.has(count));
}

/** Whether the words from `i` name the session as "end it with" says it. */
function namesWithAt(words: readonly CrisisWord[], i: number): boolean {
  return (
    END_IT_UNITS.has(words[i].word) ||
    holdsAt(END_IT_WITH_WORDS, words, i) ||
    END_IT_WITH_PHRASES.some((phrase) => startsAt(words, i, phrase)) ||
    namesExerciseAt(words, i)
  );
}

/** What each word may go on into, within three words of it. */
const END_IT_GOES_ON = new Map<string, (words: readonly CrisisWord[], i: number) => boolean>([
  ['with', namesWithAt],
  ['on', (words, i) => namesExerciseAt(words, i) || ['pr', 'pb'].includes(words[i].word)],
  ['after', (words, i) => countsSetsAt(words, i) || namesExerciseAt(words, i)],
]);

/**
 * Whether what follows "end it", in its sentence, ends a session.
 *
 * Only the owner's closed set does (2026-10-07): "early", "here", "for
 * today" and the like; "with" and a set, an exercise or a session part
 * ("with dips", "with a finisher", "with core work"); "on" and an exercise
 * or a PR; "after" and a count of sets or an exercise ("after 3 sets",
 * "after squats"). The word must come within three words, and no method may
 * follow anywhere. Everything else is the crisis: "tomorrow", "for good",
 * "on friday", "on a high note", "with a gunshot", "after 3 days", "after
 * this session", "by jumping", "and be gone", a "with" the sentence ends
 * after ("with 💊"), and a "last", "final" or "one more" anywhere. A when is
 * read past: "I'm ending it now with stretching" is a session, "I'm ending
 * it now" is not.
 *
 * A method anywhere after it, past the sentence end too, is the crisis: a
 * comma hid the gun in "I'll end it after squats, with a gun" (K1 hunt,
 * 2026-10-08).
 */
function endsASession(rest: readonly CrisisWord[], after: readonly CrisisWord[]): boolean {
  if (after.some((_, i) => namesMethodAt(after, i))) return false;
  if (rest.some((_, i) => END_IT_FAREWELL.some((farewell) => startsAt(rest, i, farewell)))) return false;
  let at = 0;
  while (at < rest.length && END_IT_WHEN.has(rest[at].word)) at += 1;
  const goesOn = rest.slice(at);
  if (goesOn.length === 0) return false;
  const namesSession = END_IT_GOES_ON.get(goesOn[0].word);
  if (!namesSession) {
    return END_IT_SESSION.some((session) => startsAt(goesOn, 0, session.split(' ')));
  }
  if (goesOn.some((_, i) => i > 0 && namesMethodAt(goesOn, i))) return false;
  return [1, 2, 3].some((i) => i < goesOn.length && namesSession(goesOn, i));
}

/** Finnish words for the gym a stem list does not start: "jalkapäivän", "burpeitä". */
const GYM_STEMS_FI_MORE = ['jalkapäiv', 'burpe', 'kardio', 'aamutreen', 'iltatreen'];

/**
 * Whether the words from `i` name the gym: an exercise, a set or a part of a
 * session, leg day, or a word that means the gym and nothing else, in either
 * language ("salilla", "treeniin", "workout").
 */
function namesTheGymAt(words: readonly CrisisWord[], i: number): boolean {
  const { word } = words[i];
  return (
    namesWithAt(words, i) ||
    startsAt(words, i, ['leg', 'day']) ||
    holdsAt(GYM_WORDS_EN, words, i) ||
    [...GYM_STEMS_FI, ...GYM_STEMS_FI_MORE].some((stem) => word.startsWith(folded(stem)))
  );
}

/** "at 6", "at 6am", "at 5 pm": a time on the clock. */
const atClockTime = (words: readonly CrisisWord[]) =>
  words[0]?.word === 'at' && /^\d{1,2}(am|pm)?$/.test(words[1]?.word ?? '');

/** Where "be here" is the session: "at the gym", "so early", "näin aikaisin". */
const HERE_FOR_THE_SESSION = [
  ['at', 'the', 'gym'], ['at', 'this', 'gym'], ['at', 'gym'], ['in', 'the', 'gym'], ['at', 'practice'], ['at', 'training'],
  ['for', 'leg', 'day'], ['on', 'leg', 'day'], ['early'], ['this', 'early'], ['nain', 'aikaisin'], ['tahan', 'aikaan'],
];

/**
 * Whether "I don't want to be here" and "en halua olla täällä" go on into
 * the session: a time on the clock, a gym said ("at the gym", "salilla"),
 * "so early". "anymore and nobody cares", "in this world", "maailmassa" and
 * "huomenna" are not (K1 hunt, 2026-10-08).
 */
function hereForTheSession(rest: readonly CrisisWord[]): boolean {
  if (rest.length === 0) return false;
  return atClockTime(rest) || HERE_FOR_THE_SESSION.some((session) => startsAt(rest, 0, session)) || namesTheGymAt(rest, 0);
}

/** How a reader hopes not to wake up when it is the gym: "sore", "jumissa". */
const WAKE_FOR_THE_SESSION = [
  'sore', 'stiff', 'achy', 'aching', 'late', 'early', 'hungover', 'with doms', 'with sore', 'too sore', 'too stiff',
  'kipeänä', 'kipeenä', 'jumissa', 'jumiin', 'kankeana', 'jäykkänä', 'krampissa', 'lihaskipuisena', 'myöhässä',
  'krapulassa', 'liian aikaisin', 'liian myöhään',
].map((option) => folded(option).split(' '));

/**
 * Whether "I hope I don't wake up" and "toivon etten herää" go on into a
 * sore morning. "again", "tomorrow morning", "aamulla" and "ollenkaan" do not
 * (K1 hunt, 2026-10-08).
 */
function wakesForTheSession(rest: readonly CrisisWord[]): boolean {
  return WAKE_FOR_THE_SESSION.some((session) => startsAt(rest, 0, session));
}

/** What a reader would rather die than do, when it is not the gym. */
const RATHER_LIVING = foldedSet([
  'live', 'living', 'alive', 'exist', 'existing', 'go', 'keep', 'wake', 'feel', 'feeling', 'be', 'suffer', 'suffering',
  'continue', 'burden', 'elää', 'elän', 'elämää', 'elämään', 'olla', 'olen', 'jatkaa', 'jatkan', 'herätä', 'herään',
  'tuntea', 'tunnen', 'kärsiä', 'kärsin',
]);

/**
 * Whether "I'd rather die than ..." goes on into the gym: "than skip leg
 * day", "than do burpees", "kuin jättäisin jalkapäivän väliin". A bare
 * "than" let "than live like this" and "than alive" out (K1 hunt,
 * 2026-10-08): the gym must be said within four words, and living, going on,
 * waking or being anything is the crisis wherever it sits.
 */
function ratherTheGym(rest: readonly CrisisWord[]): boolean {
  if (rest.length < 2 || (rest[0].word !== 'than' && rest[0].word !== 'kuin')) return false;
  if (rest.some(({ word }) => RATHER_LIVING.has(word))) return false;
  return [1, 2, 3, 4].some((i) => i < rest.length && namesTheGymAt(rest, i));
}

/**
 * What a life is lived on when it is a diet, a budget or short sleep: "on
 * chicken and rice", "on 1500 calories", "off protein shakes", "on 5 hours
 * of sleep".
 */
const LIVING_ON_FOOD = foldedSet([
  'chicken', 'rice', 'broccoli', 'oats', 'oatmeal', 'eggs', 'egg', 'tuna', 'salad', 'salads', 'pasta', 'bread',
  'potatoes', 'protein', 'shakes', 'shake', 'carbs', 'calories', 'calorie', 'kcal', 'cals', 'macros', 'diet', 'diets',
  'cut', 'bulk', 'keto', 'fasting', 'coffee', 'caffeine', 'pre-workout', 'preworkout', 'supplements', 'takeout',
  'takeaway', 'junk', 'ramen', 'noodles', 'sugar', 'food', 'meals', 'snacks', 'sleep', 'paycheck', 'wage', 'budget',
  'salary', 'savings', 'leftovers',
]);

/**
 * Whether "tired of living" and "can't live" go on into a diet: "on" or "off"
 * and a food, a budget or sleep within four words. A bare "on" let "tired of
 * living on this earth" and "sick of living off other people" out (K1
 * review, 2026-10-08).
 */
function livesOnADiet(rest: readonly CrisisWord[]): boolean {
  const on = rest[0]?.word === 'out' && rest[1]?.word === 'of' ? 2 : ['on', 'off'].includes(rest[0]?.word ?? '') ? 1 : 0;
  return on > 0 && [0, 1, 2, 3].some((k) => on + k < rest.length && holdsAt(LIVING_ON_FOOD, rest, on + k));
}

/** The supplements and food a gym "overdoses" on. */
const OVERDOSE_FOOD = [
  'caffeine', 'coffee', 'carbs', 'protein', 'creatine', 'pre', 'pre-workout', 'preworkout', 'sugar', 'cardio', 'volume',
  'chocolate', 'candy', 'pizza',
];

/** "overdosed on caffeine", "an overdose of caffeine". */
const OVERDOSE_ON_FOOD = OVERDOSE_FOOD.flatMap((food) => [`on ${food}`, `of ${food}`]);

/**
 * What a reader takes every one of. With "all", "every" or a bottle in front,
 * none of them is a dose: a routine is said without them — "I take my meds
 * before training", "otan lääkkeet aamulla" (owner's call, 2026-10-07).
 */
const EN_PILLS = [
  'pills', 'pill', 'meds', 'med', 'medication', 'medications', 'medicine', 'sleeping pills', 'painkillers', 'pain killers',
  'tablets', 'tablet', 'capsules', 'capsule', 'antidepressants', 'tylenol', 'paracetamol', 'ibuprofen', 'advil',
  'aspirin', 'xanax', 'insulin',
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
 * The K1 hunt (2026-10-08) found the Finnish rows without the methods the
 * English ones hold ("hirtän itseni", "otin yliannostuksen", "haluan
 * lopettaa kaiken"), no row for how much of what kills ("how many pills to
 * die", "tappava annos", "I took 30 sleeping pills"), and the death wishes
 * one word from a row ("I should just die", "imma end it"). They went in the
 * same way.
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
  { slots: [FI_NOT, FI_NOT_COLOUR, FI_WANT_NOT, ['olla täällä']], inTheGym: hereForTheSession },
  [FI_WANT, FI_WANT_COLOUR, ['kuolla', 'olla kuollut', 'olla kuolleena']],
  [['tapan', 'tappaa', 'tappaan', 'tappaisin', 'tappamaan', 'tapoin', 'tappanut'], ['itseni', 'itteni', 'ittein', 'itteeni', 'itseäni']],
  [
    ['toivon', 'toivoisin', 'toivoin'],
    ['', 'vain', 'vaan', 'jo'],
    [
      'että kuolisin', 'et kuolisin', 'etten heräisi', 'etten heräis', 'että en heräisi', 'että kuolen', 'et kuolen', 'kuolevani',
      'olevani kuollut', 'että olisin kuollut', 'et oisin kuollu', 'että joku tappaisi minut',
    ],
  ],
  // "toivon etten herää kipeänä" is a sore morning.
  {
    slots: [['toivon', 'toivoisin', 'toivoin'], ['', 'vain', 'vaan', 'jo'], ['etten herää', 'että en herää', 'et en herää', 'etten ikinä herää']],
    inTheGym: wakesForTheSession,
  },
  [
    ['kunpa', 'kumpa', 'jospa', 'jos vaan', 'jos vain'],
    ['', 'vain', 'vaan', 'jo'],
    ['kuolisin', 'olisin kuollut', 'olisin kuollu', 'oisin kuollut', 'oisin kuollu', 'en heräisi', 'en heräis', 'joku tappaisi minut', 'joku tappais mut'],
  ],
  [['olisinpa', 'oisinpa', 'olispa', 'oispa'], ['', 'jo', 'vain', 'vaan'], ['kuollut', 'kuollu', 'kuolleena']],
  [['kuolisinpa', 'kuolispa', 'kuolisimpa']],
  // The FI twin of "I wish I'd never been born".
  [
    ['kunpa', 'kumpa', 'jospa', 'toivon', 'toivoisin', 'toivoin', 'toivon vain'],
    ['', 'vain', 'vaan', 'jo'],
    ['en', 'etten', 'että en', 'et en'],
    ['olisi', 'olis', 'ois'],
    ['', 'ikinä', 'koskaan'],
    ['syntynyt', 'syntyny'],
  ],
  // "kuolisin mieluummin kuin jättäisin jalkapäivän väliin" is leg day.
  {
    slots: [['olisin', 'oisin'], ['mieluummin', 'mieluimmin', 'mielummin', 'ennemmin', 'jo'], ['kuollut', 'kuollu', 'kuolleena']],
    inTheGym: ratherTheGym,
  },
  {
    slots: [['kuolisin', 'kuolen'], ['mieluummin', 'mieluimmin', 'mielummin', 'ennemmin']],
    inTheGym: ratherTheGym,
  },
  // Not "päättää päiväni": that is also ending the day with a stretch.
  [['päättää', 'päätän', 'päättäisin', 'päätin', 'lopettaa', 'lopetan', 'lopettaisin', 'lopetin'], ['elämäni']],
  // Everything, not a habit: "lopetan kaiken sokerin" is a diet.
  {
    slots: [['lopettaa', 'lopetan', 'lopettaisin', 'lopettais', 'lopetin', 'lopettamaan'], ['kaiken', 'tämän kaiken', 'tän kaiken']],
    inTheGym: quitsAHabit,
  },
  [
    [...FI_WANT, 'toivon', 'toivoisin'],
    FI_WANT_COLOUR,
    [
      'että elämäni loppuu', 'et elämäni loppuu', 'elämäni loppuvan', 'että kaikki loppuu', 'et kaikki loppuu',
      'että kaikki loppuisi', 'kaiken loppuvan', 'lakata olemasta', 'lakata elämästä', 'kadota ikuisesti',
      'kadota lopullisesti', 'olla olematta', 'pois tästä elämästä', 'pois elämästä',
    ],
  ],
  [['pitäis', 'pitäisi', 'pitäs', 'kannattais', 'kannattaisi'], ['', 'vain', 'vaan', 'vaa', 'jo'], ['kuolla']],
  [['olen', 'oon', 'olisin', 'oisin', 'olin'], ['', 'jo', 'vihdoin'], ['valmis kuolemaan', 'valmis kuoleen', 'valmis kuolee']],
  {
    slots: [['kyllästynyt', 'kyllästyny', 'väsynyt', 'väsyny'], ['elämään', 'elämääni', 'elämiseen', 'olemaan elossa', 'olemassaoloon']],
    unlessFollowedBy: FI_LIVING_ON,
  },
  [['vihaan'], ['elämistä', 'elämääni', 'olla elossa', 'olemassaoloa', 'olemassaoloani']],
  [
    ['tappakaa', 'tappakaa nyt', 'tappakaa jo', 'joku tappakoon', 'joku tappaisi', 'joku tappais', 'tappaisko joku', 'tappaiskohan joku', 'joku vois tappaa', 'joku voisi tappaa'],
    ['minut', 'mut', 'mua', 'minua'],
  ],
  // The method, said of oneself. Not the verb alone: "ampua hauiksia" is not.
  [FI_METHOD_VERBS, FI_SELF],
  // A third person asked about: "miten voi tappaa itsensä".
  [['tappaa', 'tappoi', 'tappanut', 'tappaisi', 'tappais'], ['itsensä', 'ittensä']],
  [
    ['tappava', 'tappavan', 'tappavaa', 'tappavia', 'kuolettava', 'kuolettavan', 'kuolettavaa'],
    ['annos', 'annoksen', 'annosta', 'annokset', 'annoksia', 'määrä', 'määrän', 'määrää'],
  ],
  [
    ['kivuttomin', 'kivuton', 'nopein', 'nopea', 'helpoin', 'helppo', 'varmin', 'paras', 'lempein'],
    ['tapa', 'keino', 'tapaa'],
    ['kuolla', 'tappaa itsensä', 'tappaa itseni', 'päättää elämänsä', 'päättää elämäni'],
  ],
  // "paljonko panadolia tarvitaan kuolemaan", "kuinka monta unilääkettä tappaa".
  {
    slots: [['paljonko', 'kuinka monta', 'kuinka paljon', 'montako', 'miten monta', 'kuinka korkealta']],
    thenInSentence: ['kuolemaan', 'kuolee', 'kuolisi', 'kuolis', 'kuolen', 'kuolisin', 'kuolla', 'tappaa', 'tappaisi', 'tappais', 'tappava'],
  },
  // A counted dose: "otin 30 unilääkettä". Not "12 kapselia kalaöljyä".
  {
    slots: [FI_SWALLOW, ['', 'jotain', 'ainakin', 'yli', 'melkein', 'noin'], [MANY], FI_PILLS_COUNTED],
    unlessFollowedBy: FI_WHOLE_PACK_FOOD,
  },
  [FI_SWALLOW, ['överit', 'överin', 'överi']],
  // Packs counted: "otin kaksi pakkausta buranaa".
  [
    FI_SWALLOW,
    ['', 'jotain', 'ainakin', 'yli', 'melkein', 'noin'],
    [COUNT],
    ['pakkausta', 'pakettia', 'purkkia', 'levyä', 'liuskaa', 'purkillista', 'rasiaa', 'laatikkoa'],
    FI_PILLS_PARTITIVE,
  ],
  // "onko 20 panadolia tappava", "montako buranaa on kuolettava annos".
  {
    slots: [[...FI_PILLS_COUNTED, ...FI_PILLS_PARTITIVE]],
    thenInSentence: ['tappava', 'tappavaa', 'tappavan', 'kuolettava', 'kuolettavaa', 'hengenvaarallinen', 'hengenvaarallista', 'kuolemaan'],
  },
  // The single act. Not the verb alone: "polvessa viiltää" is a sharp pain.
  [
    ['viiltää', 'viillän', 'viillät', 'viilsin', 'viilsi', 'viiltäisin', 'viiltäis', 'viiltämään', 'viiltänyt', 'viiltäny', 'viillellä'],
    ['itseäni', 'itseni', 'itteni', 'itteeni', 'ittiäni', 'ranteeni', 'ranteitani', 'ranteet', 'ranteen', 'käteni', 'käsiäni', 'käsivarteni', 'käsivarsiani', 'reisiäni'],
  ],
  [['haluan', 'haluun', 'haluu', 'haluaisin', 'tekis mieli', 'tekisi mieli', 'tekee mieli', 'aion', 'meinaan'], ['viiltää', 'viillellä']],
  // Where from, anywhere after the jump: "hyppään kerrostalon katolta",
  // "hyppään kymmenennestä kerroksesta" (K1 hunt, 2026-10-08).
  {
    slots: [['hyppään', 'hypätä', 'hyppäisin', 'hyppäis', 'hyppäsin', 'hyppäämään', 'hyppää', 'hypätään']],
    thenInSentence: FI_JUMP_FROM,
  },
  [
    [
      'heittäydyn', 'heittäytyä', 'heittäytyisin', 'heittäydyin', 'heittäytymään', 'menen', 'meen', 'käyn', 'kävelen', 'jään',
      'ajan', 'ajaa', 'ajaisin', 'ajoin', 'ajamaan', 'astun', 'astua', 'juoksen', 'juosta',
    ],
    ['', 'autolla', 'autollani', 'suoraan', 'tahallani'],
    FI_UNDER,
  ],
  [['tehdä', 'teen', 'tekisin', 'tein', 'tekemään'], ['lopun', 'loppu'], ['kaikesta', 'tästä kaikesta', 'itsestäni', 'elämästäni']],
  // Every pill, whatever comes after it. A routine is said without "kaikki"
  // ("otan lääkkeet aamulla"); with it, a "when" did not make a routine of
  // it — "ennen kuin kukaan tulee kotiin" (re-hunt, 2026-10-07). "these"
  // and "my" sit on either side of "kaikki": "otan kaikki nää pillerit",
  // "otan mun kaikki lääkkeet" (review, 2026-10-07).
  [
    FI_SWALLOW,
    ['kaikki', 'mun kaikki', 'minun kaikki', 'ne kaikki', 'nämä kaikki', 'nää kaikki', 'noi kaikki', 'nuo kaikki'],
    ['', 'mun', 'minun', 'ne', 'nämä', 'nää', 'noi', 'nuo', 'nämä mun', 'nää mun'],
    ['pillerit', 'pillerini', 'lääkkeet', 'lääkkeeni', 'unilääkkeet', 'unilääkkeeni', 'tabletit', 'tablettini', 'kapselit', 'kapselini', 'särkylääkkeet', 'särkylääkkeeni', 'buranat', 'panadolit'],
  ],
  [
    FI_SWALLOW,
    ['purkillisen', 'kourallisen'],
    ['pillereitä', 'lääkkeitä', 'unilääkkeitä', 'tabletteja', 'särkylääkkeitä', 'buranaa', 'panadolia', 'parasetamolia', 'ibuprofeenia'],
  ],
  // The whole pack, said or not what of — "nielin koko purkin." — unless it
  // is food or a supplement: "söin koko levyn suklaata".
  {
    slots: [FI_SWALLOW, ['koko purkin', 'koko purkillisen', 'koko paketin', 'koko pakkauksen', 'koko levyn']],
    unlessFollowedBy: FI_WHOLE_PACK_FOOD,
  },
  // English. Not "kms": in a training app that is kilometres.
  [['suicide', 'suicidal', 'self-harm', 'self harm']],
  [
    ["don't", 'dont', 'do not', 'no longer', "didn't", 'didnt', 'did not', 'never'],
    ['want to', 'wanna', 'wish to', 'wanted to'],
    ['live', 'be alive', 'exist', 'stay alive', 'keep living', 'go on living'],
  ],
  [["i'd rather not", 'id rather not', 'i would rather not'], ['live', 'be alive', 'exist', 'be here', 'wake up']],
  // "I can't live without the gym" is a gym, and "on 1500 calories" a diet.
  {
    slots: [["can't", 'cant', 'cannot', 'can not'], ['live', 'keep living', 'go on living', 'stay alive']],
    inTheGym: (rest) => ['without', 'near', 'far'].includes(rest[0]?.word ?? '') || livesOnADiet(rest),
  },
  // "I don't want to be here at 6am" is an early session, and "I don't want
  // to wake up sore" a sore morning.
  {
    slots: [["don't", 'dont', 'do not', 'no longer', 'never'], ['want to', 'wanna', 'wanted to'], ['be here', 'be around', 'wake up']],
    inTheGym: (rest) => hereForTheSession(rest) || wakesForTheSession(rest),
  },
  [['wish'], ["i'd never been born", 'id never been born', 'i had never been born', 'i was never born', 'i were never born']],
  [EN_WISH_TO, ['', 'just'], ['die', 'be dead', 'stop existing', 'disappear forever', 'not exist', 'not be alive', 'cease to exist']],
  // "I need to stop living on takeout" is a diet.
  { slots: [EN_WISH_TO, ['', 'just'], ['stop living']], inTheGym: livesOnADiet },
  [
    [
      'never should have been born', "never should've been born", 'never shouldve been born', 'should never have been born',
      "should've never been born", 'shouldve never been born', "shouldn't have been born", 'shouldnt have been born',
      'should not have been born',
    ],
  ],
  // "I'd rather die than skip leg day" is leg day; "than live like this" is
  // not.
  { slots: [["i'd rather", 'id rather', 'i would rather', "i'd sooner"], ['die', 'be dead']], inTheGym: ratherTheGym },
  [['hope', 'wish', 'pray'], ['i', 'that i'], ['die', 'would die', 'could die', 'would just die', 'was dead', 'were dead']],
  // "I hope I don't wake up sore" is a sore morning.
  {
    slots: [
      ['hope', 'wish', 'pray'],
      ['i', 'that i'],
      ["don't wake up", 'dont wake up', 'do not wake up', 'never wake up', "wouldn't wake up", 'wouldnt wake up', 'would not wake up'],
    ],
    inTheGym: wakesForTheSession,
  },
  [['want', 'wanna', 'long for', 'longing for', 'crave', 'craving', 'wish for', 'pray for', 'praying for', 'ready for'], ['death']],
  [
    ['want', 'wish', 'need'],
    [
      'my life to end', 'my life to be over', 'it all to end', 'it all to be over', 'everything to end',
      'everything to be over', 'this life to end', 'this life to be over',
    ],
  ],
  // "I want it to end with a finisher" is the session.
  { slots: [['want', 'wish', 'need'], ['it to end', 'it to be over']], inTheGym: endsASession },
  // "tired of living on chicken and rice" is a diet; "on this earth" is not.
  {
    slots: [
      ['tired of', 'sick of', 'done with', 'done', 'sick and tired of', 'hate', 'hating'],
      ['living', 'being alive', 'existing', 'life', 'this life', 'my life', 'my existence'],
    ],
    inTheGym: livesOnADiet,
  },
  [
    [
      'someone', 'somebody', 'someone please', 'somebody please', 'please', 'pls', 'plz', 'can someone', 'could someone',
      'wish someone would', 'wish somebody would', 'want someone to', 'need someone to',
    ],
    ['kill me'],
  ],
  [['kill me'], ['now', 'already']],
  [
    [
      'kill', 'killing', 'killed', 'killin', 'hang', 'hanging', 'hanged', 'hung', 'unalive', 'unaliving', 'unalived',
      'harm', 'harming', 'harmed', 'stab', 'stabbing', 'stabbed', 'strangle', 'strangling', 'suffocate', 'suffocating',
    ],
    EN_SELF,
  ],
  // Asked of another, or of anyone: "how to hang yourself", "how do people
  // kill themselves" (K1 hunt, 2026-10-08).
  [
    ['kill', 'killing', 'killed', 'unalive', 'stab', 'strangle', 'suffocate'],
    ['yourself', 'urself', 'ur self', 'your self', 'themselves', 'oneself', 'himself', 'herself'],
  ],
  // "hang yourself from the bar for 30 seconds" is a dead hang.
  {
    slots: [['hang', 'hanging', 'hanged', 'hung'], ['yourself', 'urself', 'ur self', 'your self', 'themselves', 'oneself', 'himself', 'herself']],
    unlessFollowedBy: [
      'from the bar', 'from a bar', 'on the bar', 'on a bar', 'from the pull-up bar', 'from a pull-up bar', 'from the pullup bar',
      'from a pullup bar', 'from the rings', 'on the rings', 'from rings',
    ],
  },
  [['cut', 'cutting'], EN_SELF],
  { slots: [['shoot', 'shooting', 'shot'], EN_SELF], unlessFollowedBy: ['in the foot'] },
  { slots: [['shoot', 'shooting'], ['yourself', 'urself', 'themselves', 'oneself']], unlessFollowedBy: ['in the foot'] },
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
  // The act itself needs no lead: "I'm overdosing tonight", "tonight I
  // overdose", "I've taken an overdose" (review, 2026-10-07). What it is on
  // still decides: "I overdosed on caffeine".
  { slots: [['overdosing', 'overdosed']], unlessFollowedBy: OVERDOSE_ON_FOOD },
  { slots: [['i'], ['', 'just'], ['overdose', 'od']], unlessFollowedBy: OVERDOSE_ON_FOOD },
  { slots: [['take', 'taking', 'took', 'taken', 'had'], ['an overdose', 'a overdose', 'an od']], unlessFollowedBy: OVERDOSE_ON_FOOD },
  // Every pill, or the whole bottle, whoever says it and whatever follows.
  // 4ff438f1 let the lead, a "before" clause or a question after it make a
  // dose of it, and "I'll take all my pills tonight", "...before my parents
  // get home" and "I took all my pills. should I go to work or the
  // hospital?" went past (re-hunt, 2026-10-07).
  [
    EN_SWALLOW,
    [
      'all my', 'all the', 'all of my', 'all of the', 'all', 'all these', 'all those', 'all of these', 'all of those',
      'every', 'every single', 'every last', 'every one of my', 'every one of these', 'every one of those',
      'a bottle of', 'a whole bottle of', 'the whole bottle of', 'my whole bottle of', 'an entire bottle of',
      'the entire bottle of', 'a full bottle of',
    ],
    ['', 'my'],
    EN_PILLS,
  ],
  // A handful, a whole pack, or counted past what any routine takes: "I took
  // 30 sleeping pills", "I took a handful of pills" (K1 hunt, 2026-10-08).
  [
    EN_SWALLOW,
    [
      'a handful of', 'handfuls of', 'a bunch of', 'a fistful of', 'a whole pack of', 'a whole packet of', 'the whole pack of',
      'the whole packet of', 'an entire pack of', 'the entire pack of', 'a whole box of', 'the whole box of', 'an entire box of',
      'the entire box of', 'a whole strip of', 'two packs of', 'two boxes of',
    ],
    ['', 'my'],
    EN_PILLS,
  ],
  {
    slots: [EN_SWALLOW, ['', 'like', 'about', 'around', 'over', 'almost', 'nearly', 'maybe', 'at least'], [MANY], ['', 'of my', 'of the', 'of'], EN_PILLS],
    unlessFollowedBy: ['of creatine', 'of fish', 'of vitamin', 'of vitamins', 'of magnesium', 'of zinc', 'of caffeine', 'of omega'],
  },
  // Packs counted: "I took 2 packs of paracetamol", "I took 3 boxes of pills".
  [
    EN_SWALLOW,
    ['', 'a', 'like', 'about', 'around', 'over', 'almost', 'nearly', 'maybe', 'at least'],
    [COUNT],
    [
      'pack of', 'packs of', 'packet of', 'packets of', 'box of', 'boxes of', 'strip of', 'strips of', 'bottle of',
      'bottles of', 'blister of', 'blisters of', 'sheet of', 'sheets of',
    ],
    ['', 'my', 'the'],
    EN_PILLS,
  ],
  // "I swallowed the whole bottle", whatever follows — "...before my parents
  // got home", "...and lay down" (review, 2026-10-07). Not "the whole bottle
  // of water": what it is a bottle of, if it is pills, is the row above.
  {
    slots: [EN_SWALLOW, ['the whole bottle', 'a whole bottle', 'the entire bottle', 'an entire bottle']],
    unlessFollowedBy: ['of'],
  },
  // How much of what kills, and how: no lead, no reason, no question mark
  // decides these (K1 hunt, 2026-10-08).
  [['lethal', 'fatal', 'deadly'], ['dose', 'doses', 'amount', 'amounts', 'overdose', 'quantity']],
  {
    slots: [['how many', 'how much', 'how high', 'how deep', 'how far']],
    thenInSentence: [
      'to die', 'die', 'would kill me', 'will kill me', 'could kill me', 'kills you', 'kill you', 'kill me', 'to kill myself',
      'be fatal', 'is fatal', 'be lethal', 'is lethal', 'to overdose', 'to od', 'for an overdose', 'lethal', 'fatal',
      'deadly', 'overdose', 'an overdose', 'kill a person', 'kill someone', 'kill somebody', 'kill a human', 'kill people',
    ],
  },
  // "what amount of paracetamol is lethal", "is 20 tylenol lethal". Not "kill
  // me": "my meds make me tired, leg day will kill me" is leg day.
  {
    slots: [EN_PILLS],
    thenInSentence: ['lethal', 'fatal', 'deadly', 'kill a person', 'kill someone', 'kill somebody', 'to die'],
  },
  [['enough'], ['to die', 'to kill me', 'to kill myself']],
  [
    [
      'painless', 'painlessly', 'pain free', 'quickest', 'quick', 'easiest', 'easy', 'fastest', 'fast', 'best', 'simplest',
      'surest', 'least painful', 'peaceful', 'gentlest',
    ],
    ['way to', 'ways to', 'method to', 'methods to', 'way of', 'ways of'],
    ['die', 'kill myself', 'kill yourself', 'end my life', 'end your life', 'end it all'],
  ],
  [['noose', 'nooses']],
  [['bleed out', 'bleeding out', 'bled out', 'bleed to death', 'bleeding to death']],
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
    // Not a bare "will": "this set will end it." is a set. A bare "i" is:
    // "I end it tonight", "should I end it here?" (K1 hunt, 2026-10-08).
    slots: [
      [
        'want to', 'wanna', 'wanted to', 'going to', 'gonna', 'i will', "i'll", 'ready to', 'about to', 'need to',
        'have to', 'should', 'could', 'might', 'plan to', 'planning to', 'decided to', "i'm", 'i am', 'im', 'i',
        'imma', 'ima', 'ill', 'finna',
        ...EN_THINKING,
      ],
      ['', 'just'],
      ['end it', 'ending it', 'end things', 'ending things', 'end everything', 'ending everything'],
    ],
    inTheGym: endsASession,
  },
  [['it ends', 'it all ends', 'everything ends'], ['tonight', 'today']],
];

/**
 * Words that colour a sentence and never change what it says.
 *
 * Not read at all, wherever they sit — "en enää halua elää", "en halua enää
 * elää" and "en halua elää enää" are one sentence. "own" is here so "end my
 * own life" is "end my life"; the pronouns because spoken Finnish puts one
 * in the middle ("en mä jaksa elää"); the swearing and "so" because they sit
 * inside a phrase as often as around it ("I want to fucking die"); "finally"
 * because "I'm finally ending it" is "I'm ending it" (K1 hunt, 2026-10-08).
 */
const CRISIS_FILLERS = foldedSet([
  'enää', 'enään', 'ihan', 'oikeasti', 'oikeesti', 'edes', 'yhtään', 'kyllä', 'kyl', 'tätä',
  'minä', 'mä', 'mää', 'mie',
  'really', 'even', 'ever', 'honestly', 'truly', 'actually', 'literally', 'anymore', 'own', 'still',
  'so', 'kinda', 'genuinely', 'lowkey', 'legit', 'fucking', 'fuckin', 'fking', 'fkn', 'freaking', 'frickin', 'finally',
]);

const words = (option: string) => (option ? option.split(' ') : []);

/**
 * A pattern as it is read: each slot's options as word lists, folded the way
 * the readings are (`folded`), and what settles a phrase of it.
 *
 * The slots are walked against what was typed, never multiplied out. Every
 * way through them was once a phrase of its own, built when the module
 * loaded: the K1 rows made that 195,800 phrases, and Hermes took eight
 * seconds over them on every cold start, coach opened or not (2026-10-08).
 */
interface CrisisRow {
  slots: readonly (readonly (readonly string[])[])[];
  /** The words a phrase of the row can start with. */
  firsts: ReadonlySet<string>;
  unless: readonly (readonly string[])[];
  inTheGym: CrisisGymReading | null;
  then: readonly (readonly string[])[];
}

/** The words a way through `slots` can start with: each slot's, up to the first that cannot be left out. */
function firstWordsOf(slots: CrisisRow['slots']): Set<string> {
  const firsts = new Set<string>();
  for (const slot of slots) {
    for (const option of slot) {
      if (option.length > 0) firsts.add(option[0]);
    }
    if (!slot.some((option) => option.length === 0)) break;
  }
  return firsts;
}

const CRISIS_ROWS: readonly CrisisRow[] = CRISIS_PATTERNS.map((pattern) => {
  const { slots: rawSlots, unlessFollowedBy = [], inTheGym = null, thenInSentence = [] } =
    'slots' in pattern ? pattern : { slots: pattern };
  // A hyphened excuse is read spaced too, as the hyphen-split reading has it:
  // "in pre-workout" is "in pre workout" (K1 review, 2026-10-08).
  const unless = [...new Set(unlessFollowedBy.flatMap((option) => [option, option.replace(/-/g, ' ')]))].map((option) =>
    words(folded(option)),
  );
  const then = thenInSentence.map((option) => words(folded(option)));
  const slots = rawSlots.map((slot) => slot.map((option) => words(option).map(folded)));
  return { slots, firsts: firstWordsOf(slots), unless, inTheGym, then };
});

/** Every word a crisis phrase can start with. */
const FIRST_WORDS: ReadonlySet<string> = new Set(CRISIS_ROWS.flatMap((row) => [...row.firsts]));

/** A word with its hyphens and apostrophes out: "self-harm" and "selfharm", "don't" and "dont". */
const glued = (word: string) => word.replace(/['-]/g, '');

/** Runs of one repeated letter as one letter: "diiiie" and "die" both "die", "wannnna" and "wanna" both "wana". */
const squeezed = (word: string) => word.replace(/(\p{L})\1+/gu, '$1');

/**
 * Keys a thumb lands on beside each other. Each row sits half a key right of
 * the one above it, so a key touches two above and two below.
 */
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const KEY_AT = new Map(KEY_ROWS.flatMap((row, r) => [...row].map((key, c) => [key, [r, c]] as const)));

function besideOnKeyboard(a: string, b: string): boolean {
  const from = KEY_AT.get(a);
  const to = KEY_AT.get(b);
  if (!from || !to) return false;
  const [r, c] = from;
  const [r2, c2] = to;
  if (r2 === r) return Math.abs(c2 - c) === 1;
  if (r2 === r - 1) return c2 === c || c2 === c + 1;
  if (r2 === r + 1) return c2 === c - 1 || c2 === c;
  return false;
}

/**
 * Words that are words in their own right, each one slip from a slot word
 * (`typoOf`), and said in the gym: "I don't want to lie" is not "live",
 * "I didn't want to love running" not "live", "stop loving junk food" not
 * "stop living", "I almost shit myself" not "shot", "I'm sending it" not
 * "ending it", "jump off the rower" not "tower", "arm myself" not "harm",
 * "olla tällä dieetillä" not "olla täällä", "kaikkien pitää kuolla joskus"
 * not "pitäs", "20 pulls on the erg" not pills. Found by reading every word
 * of the app's texts, docs and tests against the slot words (K1 hunt,
 * 2026-10-08).
 */
const NOT_TYPOS = foldedSet([
  'lie', 'lies', 'love', 'loved', 'loves', 'loving', 'her', 'shit', 'exit', 'pull', 'pulls', 'send', 'sends', 'sending',
  'rower', 'rowers', 'arm', 'armed', 'night', 'hug', 'pay', 'paying', 'tällä', 'pitää',
]);

/**
 * Whether `typed` is `listed` one slip of the thumb off: a letter doubled or
 * dropped from a double ("kil", "too"), two letters swapped ("wnat",
 * "mysefl"), a letter dropped ("itsni", "wan") or added beside a key it
 * touches, or a key beside the right one ("wamt", "itsenu").
 *
 * Only for slot words of four letters or more — "die" is a letter from
 * "dye", "diet" and "tie" — and never for a typed word that is a word in its
 * own right (`NOT_TYPOS`). One slip is read per phrase, and never in a
 * phrase of one word: "nose" is a letter from "noose" (K1 hunt, 2026-10-08).
 */
function typoOf(typed: string, listed: string): boolean {
  if (typed === listed || NOT_TYPOS.has(typed) || !/^\p{L}+$/u.test(typed) || !/^\p{L}+$/u.test(listed)) return false;
  if (squeezed(typed) === squeezed(listed)) return true;
  if (listed.length < 4 || typed.length < 3) return false;
  let i = 0;
  while (i < typed.length && i < listed.length && typed[i] === listed[i]) i += 1;
  if (typed.length === listed.length) {
    if (typed.slice(i + 1) === listed.slice(i + 1) && besideOnKeyboard(typed[i], listed[i])) return true;
    return typed[i] === listed[i + 1] && typed[i + 1] === listed[i] && typed.slice(i + 2) === listed.slice(i + 2);
  }
  if (typed.length === listed.length - 1) return typed.slice(i) === listed.slice(i + 1);
  if (typed.length !== listed.length + 1 || typed.slice(i + 1) !== listed.slice(i)) return false;
  const added = typed[i];
  return [typed[i - 1], typed[i + 1]].some((beside) => beside === added || (beside !== undefined && besideOnKeyboard(beside, added)));
}

/** A word with each one letter left out: what two words one slip apart share. */
const deletions = (word: string) => [...word].map((_, i) => word.slice(0, i) + word.slice(i + 1));

/**
 * The first words of the phrases, by every key a slip of them may share with
 * what was typed: the word, it squeezed, and it with each letter out. A typed
 * word is looked up by its own keys, so the near first words are found
 * without reading every one (`typoOf` then decides). A slip is read only in a
 * phrase of two words or more, which the walk of the slots settles
 * (`rowSaysAt`).
 */
const FIRST_WORDS_NEAR = (() => {
  const near = new Map<string, Set<string>>();
  for (const first of FIRST_WORDS) {
    if (!/^\p{L}+$/u.test(first)) continue;
    for (const key of [first, squeezed(first), ...deletions(first)]) {
      const bucket = near.get(key);
      if (bucket) bucket.add(first);
      else near.set(key, new Set([first]));
    }
  }
  return near;
})();

/** The first words `typed` is a slip of. */
function firstWordsNear(typed: string): string[] {
  if (!/^\p{L}{2,}$/u.test(typed) || NOT_TYPOS.has(typed)) return [];
  const found = new Set<string>();
  for (const key of [typed, squeezed(typed), ...deletions(typed)]) {
    for (const first of FIRST_WORDS_NEAR.get(key) ?? []) {
      if (typoOf(typed, first)) found.add(first);
    }
  }
  return [...found];
}

/**
 * The first words `token` reads as, each with the slips it costs: none for
 * the word itself or what a loosely typed word may be, one for a slip of the
 * thumb (`firstWordsNear`).
 */
function firstReadings(token: CrisisWord): Map<string, number> {
  const readings = new Map<string, number>();
  const { loose } = token;
  if (loose) {
    for (const first of FIRST_WORDS) {
      if (loose(first)) readings.set(first, 0);
    }
    return readings;
  }
  if (FIRST_WORDS.has(token.word)) readings.set(token.word, 0);
  for (const first of firstWordsNear(token.word)) readings.set(first, 1);
  return readings;
}

/**
 * Each row's slots glued (`glued`): the phrases of two words or more typed as
 * one, "killmyself", "kill-myself", "iwanttodie" (A6 hunt, 2026-10-07).
 */
const GLUED_SLOTS: ReadonlyMap<CrisisRow, readonly (readonly string[])[]> = new Map(
  CRISIS_ROWS.map((row) => [row, row.slots.map((slot) => slot.map((option) => glued(option.join(''))))]),
);

/** Whether `typed` is a phrase of `row` of two words or more, typed without its spaces. */
function rowGluedAs(row: CrisisRow, typed: string): boolean {
  const slots = GLUED_SLOTS.get(row) ?? [];
  const walk = (slot: number, from: number, length: number): boolean => {
    if (slot === slots.length) return from === typed.length && length > 1;
    return slots[slot].some(
      (part, option) => typed.startsWith(part, from) && walk(slot + 1, from + part.length, length + row.slots[slot][option].length),
    );
  };
  return walk(0, 0, 0);
}

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
  token !== undefined &&
  (token.word === listed ||
    (listed === MANY ? isMany(token.word) : listed === COUNT ? isCount(token.word) : (token.loose?.(listed) ?? false)));

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

/**
 * Whether a phrase of `row` starts at `at` and says it (`settles`): a way
 * through its slots whose words are the reader's, the first read through
 * `firsts` (`firstReadings`). One slip of the thumb is allowed in a phrase of
 * two words or more (`typoOf`). Only the crisis phrases read slips; the
 * excuses and the gym readings are read exactly, so a slip never lets one out.
 */
function rowSaysAt(
  tokens: readonly CrisisWord[],
  at: number,
  row: CrisisRow,
  firsts: ReadonlyMap<string, number>,
): boolean {
  const walk = (slot: number, length: number, slips: number): boolean => {
    if (slot === row.slots.length) {
      return length > 0 && (slips === 0 || length > 1) && settles(tokens, at + length - 1, row);
    }
    return row.slots[slot].some((option) => {
      let used = slips;
      for (let i = 0; i < option.length; i += 1) {
        const word = option[i];
        if (length + i === 0) {
          const cost = firsts.get(word);
          if (cost === undefined) return false;
          used += cost;
          continue;
        }
        const token = tokens[at + length + i];
        if (reads(token, word)) continue;
        if (used > 0 || token === undefined || token.loose || !typoOf(token.word, word)) return false;
        used += 1;
      }
      return walk(slot + 1, length + option.length, used);
    });
  };
  return walk(0, 0, 0);
}

/** The sentence that starts at `start`: its words up to the one it ends after. */
function sentenceFrom(tokens: readonly CrisisWord[], start: number): readonly CrisisWord[] {
  const end = tokens.findIndex((token, at) => at >= start && token.closes);
  return end < 0 ? [] : tokens.slice(start, end + 1);
}

/** Whether a phrase whose last word is `last` says it, given what follows. */
function settles(tokens: readonly CrisisWord[], last: number, row: CrisisRow): boolean {
  const { unless, inTheGym, then } = row;
  const rest = tokens[last].closes ? [] : sentenceFrom(tokens, last + 1);
  if (then.length > 0) return rest.some((_, i) => then.some((word) => startsAt(rest, i, word)));
  if (inTheGym) return !inTheGym(rest, tokens.slice(last + 1));
  if (tokens[last].closes) return true;
  return !unless.some((after) => startsAt(tokens, last + 1, after));
}

/**
 * What a whole sentence typed as one word may start with before its phrase:
 * "iwanttokillmyself", "imgonnakillmyself", "haluanpäättääelämäni" (K1 hunt,
 * 2026-10-08). Read only in front of a phrase of two words or more.
 */
const GLUED_LEADS = [
  '', 'i', 'im', 'iam', 'iwant', 'iwantto', 'iwanna', 'wantto', 'wanna', 'ijustwantto', 'ijustwanna', 'imgonna',
  'imgoingto', 'iamgoingto', 'gonna', 'goingto', 'iwill', 'ill', 'imma', 'ijust', 'haluan', 'mina', 'ma', 'aion',
];

function saysCrisis(text: string): boolean {
  const tokens = crisisTokens(text);
  return tokens.some((token, at) => {
    const firsts = firstReadings(token);
    const startsHere = (row: CrisisRow) => [...firsts.keys()].some((first) => row.firsts.has(first));
    if (firsts.size > 0 && CRISIS_ROWS.some((row) => startsHere(row) && rowSaysAt(tokens, at, row, firsts))) {
      return true;
    }
    // One word that is a whole phrase typed without its spaces, with or
    // without a lead glued on the front.
    const typed = glued(token.word);
    return GLUED_LEADS.some(
      (lead) =>
        typed.startsWith(lead) &&
        CRISIS_ROWS.some((row) => rowGluedAs(row, typed.slice(lead.length)) && settles(tokens, at, row)),
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
  ...[
    // The methods whose every Finnish form names them, and an overdose:
    // "hirttäydyn", "hirttäydytään", "hukuttaudun", "yliannostuksen",
    // "hirttosilmukka". The slips the K1 hunt typed (2026-10-08): "itsemurah",
    // "ittemurha", "suicudal", "suidical"; and "unalive", which is only ever
    // the word for it.
    'hirttäy', 'hirttosilmuk', 'hukuttau', 'yliannos', 'yliannok', 'itsemur', 'ittemur', 'suicud', 'suidic', 'unaliv',
  ],
].map(folded);

/**
 * Stems no other word contains anywhere, so they match inside a compound
 * too — "lääkeitsemurha", "itsemurhayritys" (review, 2026-10-05) — and inside
 * a sentence typed as one word: "imsuicidal" (K1 hunt, 2026-10-08).
 */
const CRISIS_INFIXES = ['itsemurh', 'itsetuho', 'suicid'];

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
 * and as the letters. A hyphen between letters is read both as part of the
 * word ("self-harm") and as a space ("i-want-to-kill-myself"; K1 hunt,
 * 2026-10-08). Each reading is checked; any one is enough, because a crisis
 * read twice costs nothing and one read zero times costs everything. Every
 * reading is folded (`folded`): "elaa" is "elää".
 */
function crisisReadings(text: string): string[] {
  // Not a time: "5am" is five in the morning, not "sam".
  const asLetters = text.replace(/[\p{L}\p{N}@$*]+/gu, (word) =>
    /\p{L}/u.test(word) && /[\d@$]/.test(word) && !/^\d{1,2}(am|pm)$/.test(word)
      ? word.replace(/[\d@$]/g, (sign) => LEET[sign] ?? sign)
      : word,
  );
  const readings = [text, asLetters]
    .flatMap((reading) => [reading.replace(/\u200B/g, ' '), reading])
    .flatMap((reading) => [reading, reading.replace(/(\p{L})-+(?=\p{L})/gu, '$1 ')]);
  return [...new Set(readings.map((reading) => withoutGymLookalikes(crisisWords(folded(reading)))))];
}

/** Whether any reading of this text names the thing itself. */
function namesCrisis(text: string): boolean {
  return crisisReadings(text).some((words) => {
    // A held letter gives way for the stems too: "suiiiicide".
    const stemmed = [words, words.replace(/(\p{L})\1{2,}/gu, '$1')];
    return (
      saysCrisis(words) ||
      stemmed.some((reading) => CRISIS_STEMS.some((stem) => hasWordStart(reading, stem))) ||
      CRISIS_INFIXES.some((infix) => words.includes(infix))
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
 * - "kofeiinin yliannostus" is a bad pre-workout, as "overdosed on caffeine"
 *   is. Folded, as every reading is.
 */
const GYM_OBJECTS = '(knurl\\p{L}*|bar|barbell|bars|plate|plates|rack|kettlebell|dumbbell|machine|equipment|j[- ]?hooks?|hooks?|safet\\p{L}*|pins?|collar|clip)';
const OVERDOSED_ON_FI = '(kofeiini|kreatiini|proteiini|kahvi|nikotiini|energiajuoma|pre[- ]?workout|vitamiini|magnesium)';
const GYM_LOOKALIKES: RegExp[] = [
  /(^|[^\p{L}\p{N}])suicide[ -](sprint|run|drill|shuttle|grip)\p{L}*(?![\p{L}\p{N}])/gu,
  /(^|[^\p{L}\p{N}])(do|doing|did|done|run|running|ran) suicides(?![\p{L}\p{N}])/gu,
  /(^|[^\p{L}\p{N}])suicides (on|at|for|after|before) (the |a )?(track|court|field|pitch|line|lines|turf|hill|conditioning|practice|training)(?![\p{L}\p{N}])/gu,
  new RegExp(`(^|[^\\p{L}\\p{N}])cut (myself|my wrists?) on (the|a|my) ${GYM_OBJECTS}(?![\\p{L}\\p{N}])`, 'gu'),
  /(^|[^\p{L}\p{N}])viiltelev\p{L}*/gu,
  new RegExp(`(^|[^\\p{L}\\p{N}])${OVERDOSED_ON_FI}\\p{L}* yliannos\\p{L}*`, 'gu'),
  new RegExp(`(^|[^\\p{L}\\p{N}])yliannos\\p{L}* ${OVERDOSED_ON_FI}\\p{L}*`, 'gu'),
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
