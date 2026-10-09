/**
 * What a library search matches against.
 *
 * The library screen showed "Takakyykky" and searched "kyykky" against
 * "Barbell Squat" — zero results, on the one screen whose job is finding
 * lifts. Three screens each kept their own copy of this haystack and only one
 * of them had thought to include the Finnish name. One builder now, and it
 * carries both spellings of everything the reader can see: the exercise name
 * and its translation, and the body part, category and equipment in both the
 * data's English and the label the screen prints.
 */
import { exerciseNameLabel } from './exerciseNameLabel';
import { displayEquipmentValue, libraryLabel } from './libraryLabel';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';

export function buildExerciseSearchHaystack(
  item: Pick<
    ExerciseLibraryItem,
    'name' | 'bodyPart' | 'category' | 'equipment' | 'sourceEquipment' | 'primaryMuscles' | 'secondaryMuscles'
  >,
  language: AppLanguage,
): string {
  // Both the bucket and the word the row prints. They differ for the 54
  // kettlebell exercises, which are filed under `dumbbell` but say
  // "Kahvakuula" on screen — and a haystack that carries only the bucket
  // makes 15 of them unfindable by the word the reader is looking at, Goblet
  // Squat among them. A Set because they are the same value for everything
  // else, and a duplicated facet would be a duplicated label too.
  const facets: string[] = [
    ...new Set([item.bodyPart, item.category, item.equipment, displayEquipmentValue(item)]),
  ].filter((value) => Boolean(value));
  return [
    item.name,
    exerciseNameLabel(language, item.name),
    // The Finnish name whatever the app's language: the gym this app is for
    // says "reiden ojennus", and a reader with the app in English typed it
    // and found nothing (#bugs 2026-10-06). The English name is the stored
    // one, already above, so Finnish finds the English too.
    ...(language === 'fi' ? [] : [exerciseNameLabel('fi', item.name)]),
    ...facets,
    ...facets.map((facet) => libraryLabel(facet, language)),
    ...(item.primaryMuscles ?? []),
    ...(item.secondaryMuscles ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Text as search compares it: lower case, ä/ö/å folded to a/o/a, and
 * hyphens, dashes, brackets and runs of spaces all one space.
 *
 * "Joskus liikkeen nimeäminen on niin sana tarkkaa, jokainen väli pitää olla
 * oikein muuten ei löydä" (#bugs 2026-09-27): "trap bar" missed "Trap bar
 * -maastaveto" on the dash, and a keyboard without ä could not type "ylä".
 */
const normalizedCache = new Map<string, string>();

export function normalizeSearchText(value: string): string {
  // A stored row with no name must not throw on every keystroke — the crash
  // class the name guards in this file's callers exist for (PR review).
  if (typeof value !== 'string') {
    return '';
  }
  // Library labels and facets repeat on every keystroke of every sheet; a
  // bounded memo keeps the fold to once per string.
  const cached = normalizedCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = foldSearchText(value);
  if (normalizedCache.size > 20000) {
    normalizedCache.clear();
  }
  normalizedCache.set(value, normalized);
  return normalized;
}

function foldSearchText(value: string): string {
  return value
    // Some keyboards write ä as a + a combining diaeresis (NFD); composed
    // first, it folds like the precomposed letter instead of leaving a mark
    // that no stored name has (recheck of #222, 2026-09-28).
    .normalize('NFC')
    .toLowerCase()
    .replace(/[äå]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[-–—_/(),.:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The gym's own words for lifts the library names otherwise, folded like
 * everything else. "Eikö ole yläpenkkiä?" (#bugs 2026-09-27) — it was there,
 * as "Vinopenkkipunnerrus". Kept to words a Finnish gym actually says; a
 * term here widens every search that contains it.
 */
const SEARCH_ALIASES: Record<string, readonly string[]> = {
  ylapenkki: ['vinopenkki'],
  ylaviistopenkki: ['vinopenkki'],
  alapenkki: ['laskeva penkki'],
  alaviistopenkki: ['laskeva penkki'],
  penkkari: ['penkkipunnerrus'],
  kp: ['kasipaino'],
  // The short forms the rows print (exerciseListLabel) find what they stand for.
  kk: ['kahvakuula'],
  smithissa: ['smith'],
  mave: ['maastaveto'],
  leuka: ['leuanveto'],
  leuat: ['leuanveto'],
  // The app's supinated grip is `alaote` (Leuanveto alaotteella); the gym also says vastaote.
  // The stem, not the word: alaote / alaotteella differ in the consonant.
  vastaote: ['alaot'],
  vastaotteella: ['alaot'],
  // "Jalankoukistus ja ojennus ei löydy" (#bugs 2026-09-29): the gym's one
  // compound word for these two machines, where the library's own English
  // name — carried in the haystack alongside the Finnish label — is the
  // target, so the match holds whichever language the reader is in.
  jalankoukistus: ['leg curl'],
  jalkakoukistus: ['leg curl'],
  jalanojennus: ['leg extension'],
  jalkaojennus: ['leg extension'],
  polvenojennus: ['leg extension'],
  // "Vipunostot tai viparit ei löydy" (#bugs 2026-10-01): the gym calls the
  // lateral raise a vipunosto, where the library says Sivunosto and keeps
  // "vipunosto" for flyes. The English name is the target, as above. The
  // plurals are their own keys: "vipunostot" is not a piece of "vipunosto",
  // so the plural found nothing at all — the flyes included.
  vipunosto: ['lateral raise'],
  vipunostot: ['vipunosto', 'lateral raise'],
  vipunostoa: ['vipunosto', 'lateral raise'],
  vipari: ['lateral raise'],
  viparit: ['lateral raise'],
  vipareita: ['lateral raise'],
  // The library's own Finnish word, plural or not, in either language: the
  // English haystack carries no "sivunosto" to find.
  sivunosto: ['lateral raise'],
  sivunostot: ['sivunosto', 'lateral raise'],
  sivunostoa: ['sivunosto', 'lateral raise'],
};

/**
 * Gym phrases that split into two words the library's name does not carry
 * either half of on its own — "jalan ojennus" (#bugs 2026-09-29) has no
 * "jalka" anywhere near "Leg Extension" or "Reiden ojennus", so aliasing only
 * "ojennus" would still leave "jalan" unmatched and the whole query would
 * fail (every term must land). Replaced as a phrase, before the query is
 * split into terms, so the two words resolve together to the one the
 * library uses.
 *
 * The English forms ("hamstring curl", "quad extension") are gym words too —
 * a reader who trained abroad or read them off a machine plaque types the
 * muscle, not the library's "leg". Kept to phrases that would otherwise miss
 * entirely; a single English word like "curl" or "extension" already lands
 * on its own.
 *
 * The partitive/elative forms ("jalan ojennusta", "jalan koukistusta",
 * "polven ojennuksesta") are their own entries rather than a suffix the code
 * strips: Finnish case endings sometimes change the stem itself
 * ("ojennus" → "ojennukse-" before "-sta"), so there is no fixed suffix to
 * peel off. Listed exactly like "leuka"/"leuat" above.
 */
const SEARCH_PHRASE_ALIASES: ReadonlyArray<readonly [phrase: string, target: string]> = [
  ['jalan koukistus', 'leg curl'],
  ['jalan koukistusta', 'leg curl'],
  ['jalan ojennus', 'leg extension'],
  ['jalan ojennusta', 'leg extension'],
  ['polven ojennus', 'leg extension'],
  ['polven ojennuksesta', 'leg extension'],
  ['hamstring curl', 'leg curl'],
  ['quad extension', 'leg extension'],
];

/**
 * Every alias above routes its gym phrase through the boundary + join
 * machinery below so the two words only ever match together — but typing
 * the target phrase itself ("leg extension") skipped that machinery
 * entirely, since it is nowhere on the left side of `SEARCH_PHRASE_ALIASES`.
 * Split into its bare terms "leg" and "extension", "leg" landed on
 * "Reverse Hyperextension" via its `legs` bodyPart and "extension" landed on
 * the same lift's name, matching a machine the phrase never meant to reach
 * (recheck round 2026-09-29). An identity entry for each distinct target
 * phrase feeds the literal phrase through the same check its aliases use.
 */
const PHRASE_ALIAS_TARGETS = [...new Set(SEARCH_PHRASE_ALIASES.map(([, target]) => target))];

const ALL_PHRASE_ALIASES: ReadonlyArray<readonly [phrase: string, target: string]> = [
  ...SEARCH_PHRASE_ALIASES,
  ...PHRASE_ALIAS_TARGETS.map((target) => [target, target] as const),
];

/**
 * A stand-in for the space inside a phrase-alias target, so the target's
 * words survive `applyPhraseAliases`'s output being split on `' '` into
 * per-term pieces further down. Never typed by a reader and never produced
 * by `normalizeSearchText` (which only ever emits plain spaces), so it
 * cannot collide with a real query.
 */
const PHRASE_JOIN = '\u0000';

/**
 * Between a phrase-alias token's target and the phrase as the reader typed
 * it, so either can land. "hamstring curl" became "leg curl" alone, and
 * Seated Band Hamstring Curl — whose name holds the typed phrase, not the
 * alias — could not be found by its own name (hunt 2026-10-08). Never typed
 * by a reader, never produced by `normalizeSearchText`.
 */
const PHRASE_OR = '\u0001';

/** Each alias's boundary pattern, compiled once: a search runs it per row, per keystroke. */
const PHRASE_ALIAS_PATTERNS = ALL_PHRASE_ALIASES.map(([phrase, target]) => ({
  boundary: new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}s?\\b`, 'g'),
  joinedTarget: target.split(' ').join(PHRASE_JOIN),
}));

const aliasedCache = new Map<string, string>();

/**
 * The query with every known phrase swapped for the word the library
 * carries, applied before the per-term aliasing below (and before the query
 * is split into terms) so a two-word gym phrase is one hit instead of two
 * separate ones that both have to land.
 *
 * Matched on a word boundary, not a bare substring: "jalan ojennus" sits
 * inside "jalan ojennusta" (the partitive case) with no space, and the old
 * `text.split(phrase).join(target)` glued the target straight onto that
 * leftover "ta", turning the query into "leg extensionta" — a term that then
 * failed to match anything and made the whole search come back empty
 * (review of #bugs 2026-09-29). A boundary check leaves an un-listed
 * inflected form as plain, unaliased text instead of a corrupted one; the
 * inflected forms this app has actually seen are their own entries above.
 *
 * The target's own words are joined with `PHRASE_JOIN`, not a space: "jalan
 * ojennus" → "leg extension" used to become the two independent terms "leg"
 * and "extension" once split, and "extension" alone is a substring of
 * "Reverse Hyperextension" (bodyPart "legs" supplied the other term) — a
 * lift the phrase never meant to reach showed up for it (#bugs 2026-09-29,
 * caught reviewing the case-ending fix above). Kept as one token, the target
 * can only match where "leg extension" sits together as a phrase.
 *
 * The trailing `s?` before the closing boundary is the English plural of the
 * phrase's last word — "leg extensions", "leg curls", the machine's own
 * plate label. Without it, `\b` never lands between "extension" and its "s"
 * (both are word characters), so the plural skipped this whole-phrase check
 * and fell back to the old two-bare-terms path: "leg curls" matched only the
 * library rows whose name happened to literally contain "curls" (Lying Leg
 * Curls) and silently dropped the singular family members (Seated/Standing
 * Leg Curl) that the singular query finds (recheck round 2026-09-29). Safe
 * to add to every phrase here, not just the identity targets: a Finnish
 * phrase followed immediately by a real inflection ("jalan ojennusta") still
 * fails the boundary, because the char after the phrase is "t", not "s" —
 * only a genuine trailing "s" (or nothing) satisfies it.
 */
function applyPhraseAliases(normalizedQuery: string): string {
  // The same query is aliased once per library row; a bounded memo like
  // normalizeSearchText's keeps that to once per keystroke.
  const cached = aliasedCache.get(normalizedQuery);
  if (cached !== undefined) {
    return cached;
  }
  const aliased = PHRASE_ALIAS_PATTERNS.reduce(
    (text, { boundary, joinedTarget }) =>
      // The phrase as typed (an alias, or the target's plural) rides along
      // as the token's other variant, so a name that holds it literally —
      // Seated Band Hamstring Curl, Leg Extensions — still matches and ranks
      // as its own name (see PHRASE_OR).
      text.replace(boundary, (typed) => {
        const asTyped = typed.split(/\s+/).join(PHRASE_JOIN);
        return asTyped === joinedTarget ? joinedTarget : `${joinedTarget}${PHRASE_OR}${asTyped}`;
      }),
    normalizedQuery,
  );
  if (aliasedCache.size > 2000) {
    aliasedCache.clear();
  }
  aliasedCache.set(normalizedQuery, aliased);
  return aliased;
}

/** A phrase-alias token's words, back to a plain space; a no-op on anything else. */
function dephrase(term: string): string {
  return term.split(PHRASE_JOIN).join(' ');
}

/**
 * Abbreviations the rows print. They stand for the word alone: left as their
 * own letters they match inside kyykky, penkki and lankku, so "kyykky kk"
 * (kettlebell squats) listed every squat there is.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set(['kk', 'kp']);

/** A term and the words it also stands for — both sides of a phrase alias. */
function termVariants(term: string): string[] {
  return term.split(PHRASE_OR).flatMap((variant) => {
    // An own-property read: the reader's text may be "constructor", which a
    // plain lookup finds on Object.prototype and the spread cannot iterate.
    const aliases = Object.prototype.hasOwnProperty.call(SEARCH_ALIASES, variant) ? SEARCH_ALIASES[variant] : [];
    return ABBREVIATIONS.has(variant) ? [...aliases] : [variant, ...aliases];
  });
}

/**
 * True when every term of the query appears in the haystack — in any order,
 * as a piece of a word, with or without the spaces between words.
 *
 * "yläpenkki kp" finds Vinopenkkipunnerrus käsipainoilla, "penkki punnerrus"
 * finds Penkkipunnerrus, and "trap bar" finds Trap bar -maastaveto — each
 * term is a piece of a word, so a space typed inside a word costs nothing.
 * The haystack's words are never joined: a term would then match across two
 * of them ("…bar in ta…" for "rinta").
 */
export function exerciseMatchesQuery(haystack: string, query: string): boolean {
  const hay = normalizeSearchText(haystack);
  const terms = applyPhraseAliases(normalizeSearchText(query)).split(' ').filter(Boolean);
  // dephrase: a phrase-alias term ("leg[JOIN]extension") must be found as
  // the whole phrase "leg extension", never as its words "leg" and
  // "extension" checked apart — see applyPhraseAliases above.
  return terms.every((term) => termVariants(term).some((variant) => hay.includes(dephrase(variant))));
}

/**
 * How well a match answers the query, lower is better.
 *
 * Matching alone is not enough: the empty workout listed its matches in the
 * English name's alphabetical order, so "ylätal" put Kapea ylätalja and
 * Soutu ylätaljasta korokkeelta first and the plain lat pulldown twelfth
 * ("haluisin vain ylätalja — huonot suositukset", #bugs 2026-08-28). The
 * name the reader is looking at is what they typed a piece of, so it is
 * ranked first: the name as typed, then a name that begins with it, then a
 * name with a word that begins with it, then a name that merely contains it,
 * and last a row that matched on a facet only.
 */
export function rankExerciseMatch(
  item: Pick<ExerciseLibraryItem, 'name' | 'bodyPart' | 'category' | 'equipment' | 'primaryMuscles' | 'secondaryMuscles'>,
  query: string,
  language: AppLanguage,
): number {
  const normalized = applyPhraseAliases(normalizeSearchText(query));
  if (!normalized) {
    return 0;
  }
  const shown = normalizeSearchText(exerciseNameLabel(language, item.name));
  const stored = normalizeSearchText(item.name);
  // A muscle or body part the reader names by the start of its word ranks
  // with a name that starts so: "olkap" is asking for shoulder
  // work, and Pystypunnerrus sorted behind every lift with "olkapää" in its
  // name, past the list's cut (#bugs 2026-09-27). Popularity then decides.
  const facetWords = [item.bodyPart, ...(item.primaryMuscles ?? [])]
    .filter((facet): facet is string => Boolean(facet))
    .flatMap((facet) => [facet, libraryLabel(facet, language)])
    .flatMap((facet) => normalizeSearchText(facet).split(' '));
  const rankFor = (needle: string) => {
    if (shown === needle || stored === needle) {
      return 0;
    }
    // Three letters before a muscle counts: one or two would rank every lift
    // whose muscle starts so with the names the reader is spelling out.
    if (shown.startsWith(needle) || (needle.length >= 3 && facetWords.some((word) => word.startsWith(needle)))) {
      return 1;
    }
    if (shown.split(' ').some((word) => word.startsWith(needle))) {
      return 2;
    }
    if (shown.includes(needle) || stored.includes(needle)) {
      return 3;
    }
    return 4;
  };
  // "yläpenkki" ranks as what it stands for, so Vinopenkkipunnerrus leads —
  // and each word of a longer query stands for its own words ("yläpenkki kp").
  const best = Math.min(...queryVariants(normalized).map(rankFor));
  // Every word found in the name is a name match, whatever order they came in.
  return best === 4 && exerciseMatchesQuery(`${shown} ${stored}`, query) ? 3 : best;
}

/** The query with each word also read as what it stands for, every combination. */
function queryVariants(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter(Boolean)
    .reduce<string[]>(
      (variants, term) =>
        variants.flatMap((head) => termVariants(term).map(dephrase).map((variant) => (head ? `${head} ${variant}` : variant))),
      [''],
    );
}

/**
 * The matches for a query, best answer first.
 *
 * Within a rank, a lift the app counts as popular comes before one it does
 * not — "penkki" is asking for the bench press, not the bench dip that
 * happens to be the shorter name — then a shorter name (the plainer version
 * of the same lift), then the caller's order.
 */
export function rankExerciseMatches<
  T extends Pick<ExerciseLibraryItem, 'name' | 'bodyPart' | 'category' | 'equipment' | 'primaryMuscles' | 'secondaryMuscles'>,
>(
  items: readonly T[],
  query: string,
  language: AppLanguage,
  /** A lower number is more popular; undefined is "not on the list". */
  popularity?: (item: T) => number | undefined,
): T[] {
  const needle = query.trim();
  if (!needle) {
    return [...items];
  }
  // A large finite stand-in: Infinity - Infinity is NaN, and a comparator
  // that returns NaN leaves the order to the engine.
  const popular = (item: T) => popularity?.(item) ?? Number.MAX_SAFE_INTEGER;
  // Matched first, ranked after: the ranking reads several normalised strings
  // per row and most of a library does not match a typed word, so ranking all
  // of it first spent the work on rows the filter then dropped — on each
  // keystroke. The filter keeps relative order, so `index` is unchanged.
  const ranked = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => exerciseMatchesQuery(buildExerciseSearchHaystack(item, language), needle))
    .map(({ item, index }) => {
      const label = exerciseNameLabel(language, item.name);
      return {
        item,
        index,
        rank: rankExerciseMatch(item, needle, language),
        popular: popular(item),
        label,
        // Past popularity, a lift whose name says what was typed comes before
        // one that only trains it: "hauis" is Hauiskääntö before Rannerulla.
        // Every word of the query, as itself or what it stands for.
        nameHit: exerciseMatchesQuery(`${label} ${item.name}`, needle) ? 0 : 1,
      };
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.popular - right.popular ||
        left.nameHit - right.nameHit ||
        left.label.length - right.label.length ||
        left.index - right.index,
    );
  return ranked.map(({ item }) => item);
}

/**
 * One row per name the reader sees, first kept: "Bench Press with Chains" and
 * "Chain Press" both read "Penkkipunnerrus ketjuilla", and the swap list showed
 * it twice (#bugs 2026-09-27). For choosing a replacement, not for browsing —
 * the library keeps both rows, each with its own pictures and steps.
 */
export function oneRowPerShownName<T extends Pick<ExerciseLibraryItem, 'name'>>(
  items: readonly T[],
  language: AppLanguage,
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeSearchText(exerciseNameLabel(language, item.name));
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
