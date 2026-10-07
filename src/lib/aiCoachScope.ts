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

/**
 * Said plainly enough that no training reading survives.
 *
 * Whole phrases, matched as whole words. Both halves of that matter, and the
 * first review of this file found why (PR #124):
 *
 * - Substring matching put "want to die" inside "I want to diet for summer",
 *   so a question about a deficit got a crisis line. Every phrase here is
 *   matched with a boundary on both sides.
 * - "hurt myself" and "satuttaa itseäni" are how a gym injury is reported —
 *   "I hurt myself deadlifting, what can I still train?" — so they are not
 *   here at all. What names the thing itself is: self-harm, cutting,
 *   itsetuhoisuus.
 *
 * The near-misses are listed rather than pattern-matched, because a phrase
 * list is something a person can read and argue with. "en halua elää" and
 * "en halua enää elää" are one word apart and both go in.
 */
const CRISIS_PHRASES = [
  // Finnish
  'tapan itseni',
  'tapan itteni',
  'tappaa itseni',
  'tappaisin itseni',
  'en halua elää',
  'en halua enää elää',
  'en jaksa elää',
  'en jaksa enää elää',
  'en halua herätä',
  'haluan kuolla',
  'haluan vain kuolla',
  'haluan vaan kuolla',
  'haluaisin kuolla',
  'toivon että kuolisin',
  'toivoisin että kuolisin',
  'toivoisin etten heräisi',
  // The spoken and conditional forms, which a phone keyboard types as often
  // as the written ones (bug hunt, 2026-10-05).
  'en jaksaisi elää',
  'en jaksaisi enää elää',
  'en haluaisi elää',
  'en haluaisi enää elää',
  'en halua enää herätä',
  'en haluu elää',
  'en haluu enää elää',
  'haluun kuolla',
  'haluisin kuolla',
  'haluaisin vain kuolla',
  // English
  'suicide',
  'suicidal',
  'kill myself',
  'kill my self',
  'killing myself',
  'end my life',
  'end my own life',
  'ending my life',
  'take my own life',
  'taking my own life',
  'end it all',
  'ending it all',
  'want to die',
  'wanna die',
  'hang myself',
  'hanging myself',
  'wish i was dead',
  'wish i were dead',
  'better off dead',
  'do not want to live',
  "don't want to live",
  'dont want to live',
  'self-harm',
  'self harm',
  'cut myself',
  'cutting myself',
];

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
 * and "self-harm" are spelled with them.
 */
function crisisWords(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}'-]+/gu, ' ')
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
    CRISIS_PHRASES.some((phrase) => hasWord(words, phrase)) ||
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
