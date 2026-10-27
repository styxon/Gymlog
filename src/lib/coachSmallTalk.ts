/**
 * "Kiitos" is not a coaching question.
 *
 * The transcript review on 2026-08-23 found a thank-you answered with a full
 * analysis, a plan and three next steps — the forced tool shape has no way to
 * simply acknowledge something. Worse, it cost one of three free questions a
 * week to say you are welcome.
 *
 * So the chat answers these itself: no request leaves the device, nothing is
 * charged, and the reply comes from the list below.
 *
 * The matching is deliberately narrow, because the two mistakes are not
 * equally bad. Missing one costs a needless API call. A false positive answers
 * a real question with "ole hyvä" — which reads as the coach ignoring you. So
 * the whole message must be small talk: no digits, no question mark, at most
 * four words, and every one of them from the vocabulary.
 */

type CoachSmallTalkKind = 'thanks' | 'farewell' | 'greeting' | 'acknowledgement';

/**
 * A word that carries the intent. One of these must appear, or the message is
 * a question the coach should answer.
 */
const KEYWORDS: Array<{ kind: CoachSmallTalkKind; words: string[] }> = [
  {
    kind: 'thanks',
    words: ['kiitos', 'kiitti', 'kiitoksia', 'kiitos_paljon', 'thanks', 'thank', 'thankyou', 'thx', 'ty', 'cheers'],
  },
  {
    kind: 'farewell',
    words: ['heippa', 'moikka', 'moikkaa', 'nähdään', 'hyvääyötä', 'bye', 'goodbye', 'cya', 'later'],
  },
  {
    kind: 'greeting',
    words: ['moi', 'hei', 'terve', 'moro', 'morjens', 'huomenta', 'iltaa', 'päivää', 'hello', 'hi', 'hey', 'yo'],
  },
  {
    kind: 'acknowledgement',
    words: [
      'ok',
      'okei',
      'okay',
      'joo',
      'jep',
      'juu',
      'selvä',
      'selvä!',
      'hyvä',
      'hienoa',
      'mahtavaa',
      'siistiä',
      'sopii',
      'totta',
      'aivan',
      'nice',
      'cool',
      'great',
      'good',
      'perfect',
      'yes',
      'yep',
      'sure',
      'noted',
    ],
  },
];

/**
 * Words that may keep a keyword company without changing what the message is.
 * "kiitos paljon" is still thanks; "kiitos, mutta miksi" is not — and that one
 * is caught by the question mark and the length cap rather than here.
 */
const MODIFIERS = [
  'paljon',
  'oikein',
  'tosi',
  'todella',
  'vielä',
  'sitten',
  'taas',
  'ja',
  'no',
  'niin',
  'very',
  'much',
  'a',
  'lot',
  'so',
  'then',
  'again',
  'you',
  'mate',
];

/** Above this the message is doing something other than acknowledging. */
const MAX_WORDS = 4;

const EMOJI_AND_PUNCTUATION = /[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️\p{P}\p{S}]/gu;

/**
 * The small-talk kind of a whole message, or null when it is anything else —
 * including anything with a number or a question in it.
 */
export function parseCoachSmallTalk(message: string): CoachSmallTalkKind | null {
  const raw = message.trim();
  if (!raw) {
    return null;
  }
  // A question is a question even when it is short and polite.
  if (/[?？]/.test(raw) || /\d/.test(raw)) {
    return null;
  }

  const stripped = raw.replace(EMOJI_AND_PUNCTUATION, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!stripped) {
    // A message that was nothing but emoji — a thumbs up is an acknowledgement.
    return 'acknowledgement';
  }

  const words = stripped.split(' ');
  if (words.length > MAX_WORDS) {
    return null;
  }

  let found: CoachSmallTalkKind | null = null;
  for (const word of words) {
    const keyword = KEYWORDS.find((entry) => entry.words.includes(word));
    if (keyword) {
      // Earlier entries win: "kiitos ja moi" is a thank-you being said
      // goodbye with, and the thanks is the part worth answering.
      const rank = (kind: CoachSmallTalkKind) => KEYWORDS.findIndex((entry) => entry.kind === kind);
      found = found === null || rank(keyword.kind) < rank(found) ? keyword.kind : found;
      continue;
    }
    if (!MODIFIERS.includes(word)) {
      return null;
    }
  }

  return found;
}

/**
 * The replies, as translation keys. Two per kind so that saying thanks twice
 * does not get the same sentence back twice; the caller picks by how far into
 * the conversation it is, which keeps this pure.
 */
type CoachSmallTalkReplyKey = `coach.smalltalk.${CoachSmallTalkKind}.${'a' | 'b'}`;

export function coachSmallTalkReplyKey(kind: CoachSmallTalkKind, turn: number): CoachSmallTalkReplyKey {
  const variants = ['a', 'b'] as const;
  const index = Math.abs(Math.trunc(turn)) % variants.length;
  return `coach.smalltalk.${kind}.${variants[index]}`;
}
