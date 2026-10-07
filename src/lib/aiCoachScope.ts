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
 * 2026-10-07).
 */
type CrisisPattern = CrisisSlots | { slots: CrisisSlots; unlessFollowedBy?: readonly string[]; closing?: true };

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
 * An empty option makes a slot optional. "vain" and "just" are written into
 * the slots where they colour a crisis ("haluan vain kuolla", "I want to just
 * die") rather than dropped everywhere, because elsewhere they turn the
 * sentence round: "I don't want to just exist, I want to get strong" is a
 * training goal (review, 2026-10-07).
 */
const CRISIS_PATTERNS: readonly CrisisPattern[] = [
  // Finnish
  [['en'], ['halua', 'haluu', 'haluis', 'haluais', 'haluaisi', 'tahdo', 'tahtois', 'tahtoisi'], ['elää', 'herätä', 'olla elossa', 'olla olemassa']],
  // Not "herätä" here: "en jaksa herätä aamutreeniin" is a tired reader.
  [['en'], ['jaksa', 'jaksais', 'jaksaisi'], ['elää', 'elämää', 'olla elossa', 'olla olemassa']],
  [['haluan', 'haluun', 'haluaisin', 'haluisin', 'tahdon', 'tahtoisin'], ['', 'vain', 'vaan', 'vaa'], ['kuolla', 'olla kuollut']],
  [['tapan', 'tappaa', 'tappaan', 'tappaisin', 'tappamaan'], ['itseni', 'itteni', 'ittein']],
  [['toivon', 'toivoisin', 'toivoin'], ['', 'vain', 'vaan'], ['että kuolisin', 'et kuolisin', 'etten heräisi', 'etten heräis', 'että en heräisi']],
  // Not "päättää päiväni": that is also ending the day with a stretch.
  [['päättää', 'päätän', 'päättäisin', 'lopettaa', 'lopetan', 'lopettaisin'], ['elämäni']],
  // English. Not "kms": in a training app that is kilometres.
  [['suicide', 'suicidal', 'self-harm', 'self harm']],
  [["don't", 'dont', 'do not', 'no longer'], ['want to', 'wanna', 'wish to'], ['live', 'be alive', 'exist']],
  [['want to', 'wanna', 'wanting to', 'wish i could'], ['', 'just'], ['die', 'be dead']],
  [['kill', 'killing', 'hang', 'hanging', 'unalive', 'unaliving'], ['myself', 'my self']],
  [['cut', 'cutting'], ['myself']],
  [['end', 'ending'], ['my life', 'it all']],
  [['wish i was', 'wish i were', 'better off'], ['dead']],
  {
    slots: [['take', 'taking'], ['my life']],
    // Not a bare "in": "in the next few days" is a when (review, 2026-10-07).
    unlessFollowedBy: ['back', 'to', 'into', 'over', 'seriously', 'more', 'forward', 'apart', 'in my hands', 'in hand'],
  },
  {
    // Not a bare "will": "this set will end it." is a set.
    slots: [['want to', 'wanna', 'going to', 'gonna', 'i will', "i'll", 'ready to', 'thinking about', 'think about', 'thought about'], ['', 'just'], ['end it', 'ending it']],
    closing: true,
  },
];

/** Words that may stand after a closing phrase and still let it close. */
const CRISIS_CLOSING_TAIL = new Set(['now', 'tonight', 'today', 'soon', 'already', 'forever', 'lately']);

/** Words that turn a sentence, so the phrase before them closed it. */
const CRISIS_CLOSING_TURNS = new Set(['but', 'because', 'cause', 'cuz', 'mutta', 'koska']);

/**
 * Words that colour a sentence and never change what it says.
 *
 * Not read at all, wherever they sit — "en enää halua elää", "en halua enää
 * elää" and "en halua elää enää" are one sentence. "own" is here so "end my
 * own life" is "end my life"; the pronouns because spoken Finnish puts one
 * in the middle ("en mä jaksa elää").
 */
const CRISIS_FILLERS = new Set([
  'enää', 'enään', 'ihan', 'oikeasti', 'oikeesti', 'edes', 'yhtään', 'kyllä', 'tätä',
  'minä', 'mä', 'mää', 'mie',
  'really', 'even', 'ever', 'honestly', 'truly', 'actually', 'literally', 'anymore', 'own', 'still',
]);

const words = (option: string) => (option ? option.split(' ') : []);

/** Every way through a row of slots, as word lists. */
function expand(slots: CrisisSlots): string[][] {
  return slots.reduce<string[][]>(
    (phrases, slot) => phrases.flatMap((phrase) => slot.map((option) => [...phrase, ...words(option)])),
    [[]],
  );
}

const CRISIS_PHRASES = CRISIS_PATTERNS.flatMap((pattern) => {
  const { slots, unlessFollowedBy = [], closing = false } = 'slots' in pattern ? pattern : { slots: pattern };
  const unless = unlessFollowedBy.map(words);
  return expand(slots).map((phrase) => ({ phrase, unless, closing }));
});

/** A sentence end, between words. */
const CLAUSE_END = '.';

/** A word of the reader's, and whether a sentence ends after it. */
interface CrisisWord {
  word: string;
  closes: boolean;
}

/**
 * The words read for a crisis, fillers out, each marked if a sentence ends
 * after it. Quote marks come off the ends of a word — "‘I want to die’" is
 * typed with the curly quotes the apostrophe fold straightens (review,
 * 2026-10-07) — and the apostrophe inside "don't" stays.
 */
function crisisTokens(text: string): CrisisWord[] {
  const tokens: CrisisWord[] = [];
  for (const raw of text.split(' ')) {
    if (raw === CLAUSE_END) {
      if (tokens.length > 0) tokens[tokens.length - 1].closes = true;
      continue;
    }
    const word = raw.replace(/^['-]+|['-]+$/g, '');
    if (!/[\p{L}\p{N}]/u.test(word) || CRISIS_FILLERS.has(word)) continue;
    tokens.push({ word, closes: false });
  }
  if (tokens.length > 0) tokens[tokens.length - 1].closes = true;
  return tokens;
}

function startsAt(tokens: readonly CrisisWord[], at: number, phrase: readonly string[]): boolean {
  return phrase.length > 0 && phrase.every((word, i) => tokens[at + i]?.word === word);
}

function saysCrisis(text: string): boolean {
  const tokens = crisisTokens(text);
  return CRISIS_PHRASES.some(({ phrase, unless, closing }) =>
    tokens.some((_, at) => {
      if (!startsAt(tokens, at, phrase)) return false;
      const last = at + phrase.length - 1;
      if (tokens[last].closes) return true;
      const next = last + 1;
      if (closing) {
        if (CRISIS_CLOSING_TURNS.has(tokens[next].word)) return true;
        return CRISIS_CLOSING_TAIL.has(tokens[next].word) && tokens[next].closes;
      }
      return !unless.some((after) => startsAt(tokens, next, after));
    }),
  );
}

/**
 * Finnish words whose every ending names the thing itself.
 *
 * A phrase list matched as whole words could not hold Finnish: "itsemurha"
 * did not catch "ajattelen itsemurhasta" or "mietin itsemurhaan", because the
 * case ending is part of the word (bug hunt, 2026-10-05). These stems match
 * from the start of a word with any ending, and none of them begins a word
 * that means something else. "viillel" is the same verb after consonant
 * gradation ("olen viillellyt"), and "itsari" the spoken word for itsemurha
 * ("aion tehdä itsarin") — both went past as training (evening hunt,
 * 2026-10-05).
 */
const CRISIS_STEMS_FI = ['itsemurh', 'itsetuho', 'viiltel', 'viillel', 'itsari'];

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
 * and "self-harm" are spelled with them, and a sentence end — a full stop, a
 * comma, a line break, a dash between words — stays as a word of its own,
 * `CLAUSE_END`, for the phrases the next word decides.
 */
function crisisWords(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[.!?\u2026;:,\n\r\u2013\u2014]+|\s-+\s/g, ` ${CLAUSE_END} `)
    .replace(/[^\p{L}\p{N}\p{M}'.-]+/gu, ' ')
    .trim();
}

/**
 * Gym sentences that contain a crisis word and mean only the gym.
 *
 * Taken out before the crisis lists are read, so the rest of the sentence is
 * still read: "suicide sprints make me want to die" still gets the line.
 *
 * - Suicide sprints (and runs, drills, shuttles) are a conditioning drill.
 *   Not "suicide lines": that is also how a reader asks for a crisis line.
 * - The knurling cuts hands; "I cut myself on the bar" is an injury report.
 *   Only the gym's own objects are excused — "cut myself on my arm" is not.
 * - "viiltelevä kipu" is a stabbing pain. The participle names the pain; the
 *   forms that name the act — viiltelin, viiltely, viiltelen — stay in.
 */
const GYM_LOOKALIKES: RegExp[] = [
  /(^|[^\p{L}\p{N}])suicide (sprint|run|drill|shuttle)s?(?![\p{L}\p{N}])/gu,
  /(^|[^\p{L}\p{N}])cut myself on (the|a|my) (knurl\p{L}*|bar|barbell|bars|plate|plates|rack|kettlebell|dumbbell|machine|equipment|j-hooks?|hooks?|safet\p{L}*|pins?|collar|clip)(?![\p{L}\p{N}])/gu,
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
  const text = prompt.toLowerCase().replace(APOSTROPHES, "'");
  const words = withoutGymLookalikes(crisisWords(text));
  if (
    saysCrisis(words) ||
    CRISIS_STEMS_FI.some((stem) => hasWordStart(words, stem)) ||
    CRISIS_INFIXES_FI.some((infix) => words.includes(infix))
  ) {
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
