/**
 * Session names live in the program catalogs as English data — "HOME Starter -
 * Day 1: Full Body". Program family names are brand (STRONG, HOME, SHRED…) and
 * stay put, but the structural parts around them read as untranslated UI to a
 * Finnish user: "Day 1", "Upper (Heavy)", "Chest & Triceps".
 *
 * These helpers translate the structure only, and compositionally: the focus is
 * split on the separators the catalogs actually use (`&`, `+`, a trailing
 * qualifier in parentheses) and each part is looked up on its own. Anything the
 * dictionary doesn't know is passed through untouched, so a new catalog entry
 * degrades to English rather than breaking.
 */
import { formatWorkoutDisplayLabel } from './displayLabel';
import { t } from './i18n';
import { AppLanguage } from '../types/models';

/** Focus words used across workoutCatalog + gainerProgramCatalog. */
const FOCUS_FI: Record<string, string> = {
  // Names the decomposition only half-translated: it renders "&" and the
  // parenthetical separately, so "Morning Mobility (Full Body)" came back as
  // "Morning Mobility (Koko keho)" — a checker that only looks for names
  // returned UNCHANGED never sees those.
  'core & mobility for runners': 'Keskivartalo ja liikkuvuus juoksijalle',
  'lower volume + engine': 'Alavartalon volyymi + kestävyys',
  'full body & balance': 'Koko keho ja tasapaino',
  'full body & conditioning': 'Koko keho ja kunto',
  'glutes & hamstrings': 'Pakarat ja takareidet',
  'hiit cardio & core': 'HIIT-kestävyys ja keskivartalo',
  'lower body (supported)': 'Alavartalo (tuettuna)',
  'mobility & pelvic floor': 'Liikkuvuus ja lantionpohja',
  'morning mobility (full body)': 'Aamuliikkuvuus (koko keho)',
  'press & hypertrophy pump': 'Pystypunnerrus ja kasvupumppi',
  'pull & conditioning': 'Veto ja kunto',
  'shoulders & back (width)': 'Olkapäät ja selkä (leveys)',
  'skills & core': 'Taidot ja keskivartalo',
  'upper body (supported)': 'Ylävartalo (tuettuna)',

  // ── Whole session names from the Vinha programs ──────────────────────
  // Written out rather than decomposed: "Pull A: Width Focus" and "Push:
  // Handstand & Planche Progressions" are sentences, not two nouns, and
  // word-by-word translation turns them into something a reader has to
  // decode. A whole-phrase hit wins over decomposition.
  // The two season programmes. Whole phrases: "Push and Easy Run" is what the
  // session IS, and decomposing it gives two nouns joined by a conjunction the
  // dictionary would have to guess at.
  'push and easy run': 'Työntö ja kevyt juoksu',
  'strength and tempo run': 'Voima ja vauhtijuoksu',
  'legs and strides': 'Jalat ja vedot',
  'lower, heavy': 'Alavartalo, raskas',
  'upper, press': 'Ylävartalo, työntö',
  'lower, volume': 'Alavartalo, volyymi',
  'upper, pull': 'Ylävartalo, veto',
  'athletic upper': 'Urheilullinen ylävartalo',
  'bench day': 'Penkkipäivä',
  'core reconnection': 'Keskivartalon herättely',
  'deadlift day': 'Maastavetopäivä',
  'deep recovery stretch': 'Syvä palautusvenyttely',
  'endurance & conditioning': 'Kestävyys ja kunto',
  'explosive lower': 'Räjähtävä alavartalo',
  'full body burn': 'Koko kehon poltto',
  'gentle full body': 'Kevyt koko keho',
  'gentle strength': 'Kevyt voima',
  'glute activation': 'Pakaroiden herättely',
  'glute finisher': 'Pakaralopetus',
  'glute hypertrophy': 'Pakaroiden kasvatus',
  'glute volume (pump)': 'Pakaravolyymi (pumppi)',
  'heavy glutes (strength)': 'Raskaat pakarat (voima)',
  'hip opening flow': 'Lonkkien avaus',
  'legs a: quad focus': 'Jalat A: etureidet',
  'legs b: posterior focus': 'Jalat B: takaketju',
  'legs: pistol squats & plyo': 'Jalat: pistolikyykyt ja hypyt',
  // The same day once the knees flag took the pistol squats out
  // (sessionNameAfterRemovedLifts).
  'legs: plyo': 'Jalat: hypyt',
  'low-impact cardio & stability': 'Kevyt kestävyys ja tasapaino',
  'lower body bodyweight': 'Alavartalo kehonpainolla',
  'lower body hiit': 'Alavartalon HIIT',
  'lower body strength': 'Alavartalon voima',
  'posterior chain & power': 'Takaketju ja teho',
  'pull a: width focus': 'Veto A: leveys',
  'pull b: thickness focus': 'Veto B: paksuus',
  'pull day': 'Vetopäivä',
  'pull: muscle-up & front lever': 'Veto: muscle-up ja front lever',
  'push a: chest focus': 'Työntö A: rinta',
  'push b: shoulder focus': 'Työntö B: olkapäät',
  'push: handstand & planche progressions': 'Työntö: käsinseisonta ja planche',
  'quads & cardio': 'Etureidet ja kestävyys',
  'quads & hamstrings': 'Etureidet ja takareidet',
  'shoulder mobility': 'Olkapäiden liikkuvuus',
  'single-leg stability': 'Yhden jalan tasapaino',
  'speed & agility': 'Nopeus ja ketteryys',
  'spinal flexibility': 'Selkärangan liikkuvuus',
  'squat day': 'Kyykkypäivä',
  'strength circuit': 'Voimakierros',
  'strength rebuild': 'Voiman palautus',
  'tabata finisher': 'Tabata-treeni',
  'total body hiit': 'Koko kehon HIIT',
  'upper body bodyweight': 'Ylävartalo kehonpainolla',
  'upper body hiit': 'Ylävartalon HIIT',
  'upper body sculpt': 'Ylävartalon muotoilu',
  'upper body strength': 'Ylävartalon voima',
  'upper body toning': 'Ylävartalon kiinteytys',
  // The three lean and athletic weeks (2026-10-08). Whole phrases: the "+" in
  // them joins a day's focus to what closes it, and the decomposition would
  // pair each half with the wrong Finnish connective.
  'upper strength + finisher': 'Ylävartalon voima + kuntoloppu',
  'lower strength + finisher': 'Alavartalon voima + kuntoloppu',
  'upper athletic + intervals': 'Urheilullinen ylävartalo + intervallit',
  'lower power + conditioning': 'Alavartalon teho + kunto',
  'upper hypertrophy': 'Ylävartalon lihaskasvu',
  'lower strength (squat)': 'Alavartalon voima (kyykky)',
  'power + engine': 'Teho + kestävyys',
  'lower hinge + conditioning': 'Alavartalo, maastaveto + kunto',
  'power + conditioning': 'Teho + kunto',
  'lower + engine': 'Alavartalo + kestävyys',
  'upper pull + hiit': 'Ylävartalon veto + HIIT',
  'upper push + hiit': 'Ylävartalon työntö + HIIT',
  'workout a': 'Treeni A',
  'workout b': 'Treeni B',

  'full body': 'Koko keho',

  // ── Names the app writes itself ──────────────────────────────────────
  // Not catalogue data: onboarding appends these days to a shorter programme
  // (recommendationProgramme.buildSupplementalDay), and Home titles a session
  // named only "Day 2" or "Workout A" by its first lift
  // (app/homeSessionTitle.ts). Both reached a Finnish reader in English —
  // "Accessory Strength Day", "Palautuminen + Mobility Day", "Lower Focus"
  // (2026-09-14). Translated here, at display time, so installs that already
  // saved these names read them in Finnish too.
  'accessory strength day': 'Tukiliikkeiden voimapäivä',
  'recovery strength day': 'Kevyt voimapäivä',
  'easy run add-on': 'Lisäpäivä: kevyt juoksu',
  'long run add-on': 'Lisäpäivä: pitkä juoksu',
  // The same days when the reader's knee or ankle flag turned the runs into
  // walks or rides (sessionNameAfterRunStandIn).
  'easy walk add-on': 'Lisäpäivä: kevyt kävely',
  'long walk add-on': 'Lisäpäivä: pitkä kävely',
  'easy ride add-on': 'Lisäpäivä: kevyt pyöräily',
  'long ride add-on': 'Lisäpäivä: pitkä pyöräily',
  'bodyweight volume day': 'Kehonpainon volyymipäivä',
  'conditioning + mobility day': 'Kunto ja liikkuvuus',
  'recovery + mobility day': 'Palautuminen ja liikkuvuus',
  'easy conditioning day': 'Kevyt kuntopäivä',
  'upper focus': 'Ylävartalo',
  'lower focus': 'Alavartalo',
  'posterior focus': 'Takaketju',
  'push focus': 'Työntö',
  'pull focus': 'Veto',
  'conditioning focus': 'Kunto',
  'full body focus': 'Koko keho',
  'upper body': 'Ylävartalo',
  'lower body': 'Alavartalo',
  upper: 'Ylävartalo',
  lower: 'Alavartalo',
  push: 'Työntö',
  pull: 'Veto',
  chest: 'Rinta',
  back: 'Selkä',
  legs: 'Jalat',
  glutes: 'Pakarat',
  shoulders: 'Olkapäät',
  arms: 'Kädet',
  abs: 'Vatsa',
  core: 'Keskivartalo',
  biceps: 'Hauikset',
  triceps: 'Ojentajat',
  'weak points': 'Heikot kohdat',
  squat: 'Kyykky',
  bench: 'Penkki',
  deadlift: 'Maastaveto',
  press: 'Pystypunnerrus',
  row: 'Soutu',
  hinge: 'Saranaliike',
  circuit: 'Kiertoharjoittelu',
  intervals: 'Intervallit',
  engine: 'Kestävyys',
  reset: 'Palautus',
  recovery: 'Palautuminen',
  mobility: 'Liikkuvuus',
  'mobility flow': 'Liikkuvuusvirta',
  'yoga flow': 'Joogavirta',
  'easy run': 'Kevyt juoksu',
  'tempo run': 'Tempojuoksu',
  'easy walk': 'Kevyt kävely',
  'tempo walk': 'Tempokävely',
  'easy ride': 'Kevyt pyöräily',
  'tempo ride': 'Tempopyöräily',
  // Two-word focuses with no separator to split on.
  // The block below is what the template editor's split presets write: they
  // are stored as session names, so they arrive here rather than through a
  // translation key. Decomposition cannot reach them — "Upper Heavy" has no
  // separator and no parentheses, so it fell through as written.
  'upper heavy': 'Ylävartalo raskas',
  'lower heavy': 'Alavartalo raskas',
  'upper pump': 'Ylävartalo pumppi',
  'lower pump': 'Alavartalo pumppi',
  'upper strength': 'Ylävartalon voima',
  'lower strength': 'Alavartalon voima',
  'push volume': 'Työntövolyymi',
  'pull volume': 'Vetovolyymi',
  'legs volume': 'Jalkavolyymi',
  'full body a': 'Koko keho A',
  'full body b': 'Koko keho B',
  'full body c': 'Koko keho C',
  'full body d': 'Koko keho D',
  'upper power': 'Ylävartalon teho',
  'lower power': 'Alavartalon teho',
  'upper volume': 'Ylävartalon volyymi',
  'full body circuit': 'Koko kehon kierto',
  // Qualifiers, which arrive in parentheses.
  heavy: 'raskas',
  volume: 'volyymi',
  growth: 'kasvu',
  pressure: 'kova',
  tempo: 'tempo',
  pump: 'pumppi',
  strength: 'voima',
};

/**
 * The name a free (Empty) workout is saved under: the title in the language
 * the app had at the moment of finishing, and for the holder template the
 * short date after it ("Tyhjä treeni 9.10."). The dictionary above only goes
 * English to Finnish, so a name the app wrote in one language and shows after
 * a switch to the other needs its own rule, in both directions.
 */
const FREESTYLE_TITLES: readonly AppLanguage[] = ['en', 'fi'];
function localizeFreestyleName(name: string, language: AppLanguage): string | null {
  const match = name.match(/^(.+?)(\s+\d{1,2}\.\d{1,2}\.)?$/);
  if (!match) {
    return null;
  }
  const title = match[1].toLowerCase();
  if (!FREESTYLE_TITLES.some((saved) => t(saved, 'emptyWorkout.title').toLowerCase() === title)) {
    return null;
  }
  return `${t(language, 'emptyWorkout.title')}${match[2] ?? ''}`;
}

const DICTIONARIES: Partial<Record<AppLanguage, Record<string, string>>> = { fi: FOCUS_FI };

/**
 * The dictionary's own entry for a key, or undefined. Free text is looked up
 * here, and a plain index finds "constructor" and "valueOf" on Object.prototype
 * and hands back a function as the label.
 */
function entryFor(dictionary: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : undefined;
}

function translateWord(word: string, dictionary: Record<string, string>): string {
  return entryFor(dictionary, word.trim().toLowerCase()) ?? word.trim();
}

/**
 * "Upper (Heavy)" → "Ylävartalo (raskas)", "Chest & Triceps" → "Rinta &
 * ojentajat". Unknown words survive as they were written.
 */
export function localizeWorkoutFocus(focus: string, language: AppLanguage = 'en'): string {
  const dictionary = DICTIONARIES[language];
  const raw = focus.trim();
  if (!dictionary || !raw) {
    return raw;
  }

  // A whole-phrase hit wins over decomposition ("Full Body Circuit").
  const whole = entryFor(dictionary, raw.toLowerCase());
  if (whole) {
    return whole;
  }

  const qualifierMatch = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const head = qualifierMatch ? qualifierMatch[1] : raw;
  const qualifier = qualifierMatch ? qualifierMatch[2] : null;

  // Keep the separator the catalog used — "&", "+" and "/" mean different
  // things, and "/" was missing: the editor's body-part presets are all
  // "Chest / Triceps", "Legs / Glutes", so every one of them survived
  // untranslated even though both halves were in the dictionary.
  //
  // Two things the first version of that got wrong. The slash was added to the
  // split but not to the test below it, so it fell through to translateWord,
  // which trims — "Chest / Triceps" came back as "Rinta/Ojentajat". And in
  // Finnish the ampersand is not a word: every whole-phrase entry in the table
  // above writes "Pakarat ja takareidet", while the decomposed names came back
  // as "Pakarat & Jalat", so the same file spelled the same conjunction two
  // ways depending on which branch answered.
  const segments = head.split(/(\s*[&+/]\s*)/);
  const translatedHead = segments
    .map((segment, index) => {
      if (/^\s*[&+/]\s*$/.test(segment)) {
        return language === 'fi' && segment.includes('&') ? ' ja ' : segment;
      }
      // The dictionary's own answer, or null when it has none. Which of the
      // two it is decides whether the word may be lowered below, so the miss
      // has to stay visible here rather than behind translateWord's fallback.
      const translated = entryFor(dictionary, segment.trim().toLowerCase()) ?? null;
      const text = translated ?? segment.trim();
      // "Kyykky ja penkki", not "Kyykky ja Penkki": the words are stored
      // capitalized because each can open a name.
      //
      // Only a word the dictionary answered for is lowered. A name the reader
      // typed passes through untranslated, and lowering its first letter alone
      // gave back half of it: "Deadlift & Overhead Press" came out as
      // "Maastaveto ja overhead Press". An acronym the dictionary does return,
      // like "HIIT", is left alone by the shape test.
      const followsFinnishAnd = language === 'fi' && (segments[index - 1] ?? '').includes('&');
      if (followsFinnishAnd && translated && /^[A-ZÄÖÅ][a-zäöå]/.test(text)) {
        return text[0].toLowerCase() + text.slice(1);
      }
      return text;
    })
    .join('');

  if (!qualifier) {
    return translatedHead;
  }
  return `${translatedHead} (${translateWord(qualifier, dictionary)})`;
}

/**
 * The session's focus alone: "HOME Starter - Day 1: Full Body" → "Koko keho".
 *
 * For rows that already say which day this is. The card on Home carries a
 * weekday badge, so "Päivä 1:" says it a second time — and the repetition is
 * not free: it took the width the real name then truncated for, leaving
 * "Päivä 1: Koko keho + H…" (user, 2026-08-25). The programme name sits above
 * the list, so the brand in front goes with it.
 *
 * A session with no focus at all — "Day 3", the editor's placeholder — keeps
 * its ordinal, because removing the focus would leave nothing to show.
 */
export function localizeSessionFocus(name: string, language: AppLanguage = 'en'): string {
  const raw = name.trim();
  const freestyle = localizeFreestyleName(raw, language);
  if (freestyle) {
    return freestyle;
  }
  // Both spellings: catalog data says "Day 1:", but a duplicated or composed
  // custom programme SAVES its session names in Finnish ("Päivä 1:", by
  // design — customProgramDuplication), and the Finnish prefix used to slip
  // through here untouched. That put "Päivä 1:" back on the very rows this
  // function exists to unclutter (user, 2026-08-25).
  const dayMatch = raw.match(/^(.*?)\b(?:Day|Päivä)\s+(\d+)\s*:\s*(.*)$/i);
  if (!dayMatch) {
    return localizeSessionName(raw, language);
  }
  const focus = dayMatch[3].trim();
  if (!focus) {
    // "Day 3:" with nothing after it — the ordinal is all there is, and
    // handing it back through the full localizer keeps the dangling colon.
    return language === 'fi' ? `Päivä ${dayMatch[2]}` : `Day ${dayMatch[2]}`;
  }
  return localizeWorkoutFocus(focus, language);
}

/**
 * "HOME Starter - Day 1: Full Body" → "HOME Starter - Päivä 1: Koko keho".
 * The plan name in front is a brand and is never touched.
 */
export function localizeSessionName(name: string, language: AppLanguage = 'en'): string {
  const raw = name.trim();
  const freestyle = localizeFreestyleName(raw, language);
  if (freestyle) {
    return freestyle;
  }
  if (language === 'en' || !raw) {
    return raw;
  }

  // A session created and never renamed is just "Day 3" — no colon, no focus.
  // The pattern below requires the colon, so the placeholder name the editor
  // writes was the one session name that stayed English everywhere.
  const bareDay = raw.match(/^Day\s+(\d+)$/i);
  if (bareDay) {
    return language === 'fi' ? `Päivä ${bareDay[1]}` : raw;
  }

  const dayMatch = raw.match(/^(.*?)\bDay\s+(\d+)\s*:\s*(.*)$/i);
  if (!dayMatch) {
    return localizeWorkoutFocus(raw, language);
  }

  const [, prefix, dayNumber, focus] = dayMatch;
  const dayLabel = language === 'fi' ? `Päivä ${dayNumber}` : `Day ${dayNumber}`;
  return `${prefix}${dayLabel}: ${localizeWorkoutFocus(focus, language)}`;
}

/**
 * A day of a programme, named the way the reader met it: "Rinta".
 *
 * It said "Päivä 1. Rinta" until 2026-09-24: "Poistetaan päivä sana tästä eli
 * näyttää vain treenin nimen" (#bugs). The row's place in the list already
 * says which day it is, and since days can be dragged the number was the one
 * part of the title that could go stale. A name that is ONLY a placeholder —
 * "Day 3", "Päivä 3", "Workout A" — still needs something to say, so it says
 * "Treeni 3", numbered by where the row sits now.
 *
 * Lived in ProgramDetailScreen, which is the screen you tap it on. The day
 * page then built its own title out of the programme name and a stripped
 * session name, so the row said "Päivä 1. Rinta" and the page you landed on
 * said "Chest Day / Rinta" — the same day under two names, one of which the
 * reader had never seen (2026-08-27). One function, both screens.
 */
export function formatPlanSessionTitle(
  session: { name: string },
  index: number,
  programTitle: string,
  language: AppLanguage,
  /** The reader typed this name with the pen — see isReaderNamedSession. */
  readerNamed = false,
): string {
  // The English name is what is stored and matched on; localizeSessionName only
  // rewrites the parts it recognises.
  const sessionName = formatWorkoutDisplayLabel(session.name, 'Workout');
  // Every rule below is for names the app wrote. One the reader typed is
  // theirs, placeholder-shaped or not: "Päivä 2" came back as "Treeni 2", and
  // "Workout B" as a number unrelated to it (break round 2026-09-28).
  // As stored, not through the display label, which also falls back for a
  // name that is only a copy suffix.
  if (readerNamed && session.name.trim()) {
    return session.name.trim();
  }
  const normalizedProgram = programTitle.toLowerCase();
  const normalizedSession = sessionName.toLowerCase();

  // The letter stays: without it three full-body days all read "Koko keho".
  const minimal = normalizedSession.match(/^minimal\s+([a-z])$/);
  if (normalizedProgram.includes('full body') && minimal) {
    return `${t(language, 'facet.fullBody')} ${minimal[1].toUpperCase()}`;
  }

  // "Treeni A" too: a copy made of a ready programme stores the Finnish name
  // (customProgramDuplication), and the original's days read "Treeni 1/2/3".
  if (/^(?:workout|treeni)\s+[a-z]$/.test(normalizedSession)) {
    return t(language, 'detail.workoutPlaceholder', { index: index + 1 });
  }

  // A stored "Day 3: Upper" keeps its words and loses its number.
  //
  // The number is a POSITION, and since 2026-08-31 the reader can drag days
  // into any order they like — so a name that carries its own numeral will
  // disagree with where the row actually sits the first time one is moved.
  // Passing it through unchanged printed "Day 2, Day 3, Day 1" down the list.
  // "Päivä 3" too, since new days are named in the reader's language: matching
  // only "day" let a Finnish default through to the index branch below, and
  // every new Finnish programme listed "Päivä 1. Päivä 1".
  const storedDayPrefix = /^(?:day|päivä)\s+\d+\s*[.:–-]?\s*/i;
  if (storedDayPrefix.test(sessionName)) {
    const rest = sessionName.replace(storedDayPrefix, '').trim();
    return rest
      ? localizeSessionName(rest, language)
      : t(language, 'detail.workoutPlaceholder', { index: index + 1 });
  }

  return localizeSessionName(sessionName, language);
}

/** Whitespace-insensitive, so a name the store trimmed still matches. */
function sameName(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, ' ') === right.trim().replace(/\s+/g, ' ');
}

/**
 * Whether this day's stored name is still the one the reader typed with the
 * pen. A rename from anywhere else — a programme rebuilt, a CSV import —
 * changes the stored name, the entry stops matching, and the day is read by
 * the usual rules again.
 */
export function isReaderNamedSession(
  readerSessionNames: Record<string, string> | null | undefined,
  session: { id: string; name: string },
): boolean {
  const typed = readerSessionNames?.[session.id];
  return typeof typed === 'string' && sameName(typed, session.name);
}
