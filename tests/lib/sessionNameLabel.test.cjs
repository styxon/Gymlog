const assert = require('node:assert/strict');

const {
  formatPlanSessionTitle,
  localizeSessionName,
  localizeWorkoutFocus,
} = require('../../src/lib/sessionNameLabel');

module.exports = [
  {
    name: 'session focus: the ordinal goes where something else already names the day',
    run() {
      const { localizeSessionFocus } = require('../../src/lib/sessionNameLabel');

      // The home card carries a MA/TO badge, so "Päivä 1:" said it twice and
      // cost the focus the width it then truncated for.
      assert.equal(localizeSessionFocus('Day 1: Full Body', 'fi'), 'Koko keho');
      assert.equal(localizeSessionFocus('HOME Starter - Day 2: Upper Body', 'fi'), 'Ylävartalo');
      assert.equal(localizeSessionFocus('Day 1: Full Body', 'en'), 'Full Body');

      // A name with no day in it is just the name.
      assert.equal(localizeSessionFocus('Bench Day', 'fi'), 'Penkkipäivä');

      // The editor's placeholder has no focus to fall back on, so the ordinal
      // stays rather than leaving an empty row.
      assert.equal(localizeSessionFocus('Day 3', 'fi'), 'Päivä 3');
      assert.equal(localizeSessionFocus('Day 3:', 'fi'), 'Päivä 3');
      assert.equal(localizeSessionFocus('', 'fi'), '');

      // Custom programmes SAVE their session names in Finnish (by design —
      // customProgramDuplication), and the Finnish ordinal used to slip
      // through untouched: "Päivä 1:" came back onto the very rows this
      // function exists to unclutter (user, 2026-08-25).
      assert.equal(localizeSessionFocus('Päivä 1: Koko keho + HIIT', 'fi'), 'Koko keho + HIIT');
      assert.equal(localizeSessionFocus('Päivä 3', 'fi'), 'Päivä 3');
    },
  },
  {
    name: 'session names keep the plan brand and translate the structure',
    run() {
      assert.equal(
        localizeSessionName('HOME Starter - Day 1: Full Body', 'fi'),
        'HOME Starter - Päivä 1: Koko keho',
      );
      assert.equal(
        localizeSessionName('STRONG Elite - Day 3: Upper (Heavy)', 'fi'),
        'STRONG Elite - Päivä 3: Ylävartalo (raskas)',
      );
    },
  },
  {
    name: 'English is the source of truth and passes through untouched',
    run() {
      const name = 'HOME Starter - Day 1: Full Body';
      assert.equal(localizeSessionName(name, 'en'), name);
      assert.equal(localizeSessionName(name), name);
    },
  },
  {
    name: 'focus decomposes on the separators the catalogs use',
    run() {
      // Finnish spells the conjunction, and the second noun is not a title:
      // the whole-phrase entries in the table have always written "Pakarat ja
      // takareidet", while decomposition produced "Rinta & Ojentajat" — one
      // file, two spellings of the same word, decided by which branch answered.
      assert.equal(localizeWorkoutFocus('Chest & Triceps', 'fi'), 'Rinta ja ojentajat');
      assert.equal(localizeWorkoutFocus('Squat & Bench', 'fi'), 'Kyykky ja penkki');
      assert.equal(localizeWorkoutFocus('Glutes & Legs', 'fi'), 'Pakarat ja jalat');
      // English keeps the catalog's own ampersand.
      assert.equal(localizeWorkoutFocus('Chest & Triceps', 'en'), 'Chest & Triceps');

      // "+" is not a conjunction here — it reads as "and then", and the
      // whole-phrase entries keep it in Finnish too.
      assert.equal(localizeWorkoutFocus('Full Body + HIIT', 'fi'), 'Koko keho + HIIT');

      // An acronym must survive the lowering that "ja" applies to an ordinary
      // capitalized noun.
      assert.equal(localizeWorkoutFocus('Core & HIIT', 'fi'), 'Keskivartalo ja HIIT');

      // And so must a name the reader typed. Only a word the dictionary
      // answered for may be lowered: lowering an untranslated phrase touches
      // its first letter and leaves the rest, which is worse than either
      // ending — "Maastaveto ja overhead Press".
      assert.equal(
        localizeWorkoutFocus('Deadlift & Overhead Press', 'fi'),
        'Maastaveto ja Overhead Press',
      );
      assert.equal(
        localizeWorkoutFocus('Squat & Sandbag Carries', 'fi'),
        'Kyykky ja Sandbag Carries',
      );

      // The slash was added to the split but not to the separator test, so it
      // fell through to the word translator — which trims — and the editor's
      // own body-part presets came back welded together.
      assert.equal(localizeWorkoutFocus('Chest / Triceps', 'fi'), 'Rinta / Ojentajat');
      assert.equal(localizeWorkoutFocus('Legs / Glutes', 'fi'), 'Jalat / Pakarat');
    },
  },
  {
    name: 'no catalog session name reaches a Finnish reader with an ampersand in it',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
      const { localizeSessionFocus } = require('../../src/lib/sessionNameLabel');
      const left = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          const finnish = localizeSessionFocus(session.name, 'fi');
          if (finnish.includes('&')) {
            left.push(`${session.name} -> ${finnish}`);
          }
        }
      }
      assert.deepEqual(left, [], `English conjunctions left in Finnish session names:\n  ${left.join('\n  ')}`);
    },
  },
  {
    name: 'whole-phrase entries win over decomposition',
    run() {
      assert.equal(localizeWorkoutFocus('Full Body Circuit', 'fi'), 'Koko kehon kierto');
      assert.equal(localizeWorkoutFocus('Lower Power', 'fi'), 'Alavartalon teho');
    },
  },
  {
    name: 'unknown catalog copy degrades to English instead of breaking',
    run() {
      assert.equal(localizeWorkoutFocus('Sandbag Carries', 'fi'), 'Sandbag Carries');
      assert.equal(
        localizeSessionName('NEW Plan - Day 2: Sandbag Carries', 'fi'),
        'NEW Plan - Päivä 2: Sandbag Carries',
      );
    },
  },
  {
    name: 'a name without a Day prefix still gets its focus translated',
    run() {
      assert.equal(localizeSessionName('Upper Body', 'fi'), 'Ylävartalo');
    },
  },
  {
    name: 'no session name is left half-English, which a same-string check misses',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

      // The obvious check — "did the string come back unchanged" — passes for
      // "Morning Mobility (Full Body)" -> "Morning Mobility (Koko keho)",
      // because the qualifier translated and the head did not. Fourteen names
      // were sitting half-translated behind exactly that blind spot.
      //
      // Loanwords Finnish uses as-is are allowed; the rest must not survive.
      const KEEP = new Set([
        'hiit', 'tabata', 'emom', 'amrap', 'vinha', 'strong', 'huge', 'shred',
        'fit', 'home', 'run', 'reset', 'powerbuild', 'focus', 'flow', 'plyo',
        'planche', 'lever', 'muscle', 'muscle-up', 'front', 'day', 'ppl',
      ]);

      const leftovers = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          const finnish = localizeSessionName(session.name, 'fi');
          const source = new Set(session.name.toLowerCase().match(/[a-z-]{4,}/g) ?? []);
          const survived = (finnish.toLowerCase().match(/[a-z-]{4,}/g) ?? []).filter(
            (word) => source.has(word) && !KEEP.has(word),
          );
          if (survived.length > 0) {
            leftovers.push(`${session.name} -> ${finnish}`);
          }
        }
      }
      assert.equal(leftovers.length, 0, `half-English: ${leftovers.slice(0, 5).join(' | ')}`);
    },
  },
  {
    /**
     * The day number follows the row, not the name it was saved with.
     *
     * Days became draggable on 2026-08-31. A stored "Day 1: Upper (Heavy)"
     * dropped into third place used to keep printing "Day 1", so a reordered
     * programme read "Day 2, Day 3, Day 1" straight down the list.
     */
    name: 'a day row says the workout name, and only a placeholder is numbered — by position',
    run() {
      // "Poistetaan päivä sana tästä eli näyttää vain treenin nimen" (#bugs
      // 2026-09-24): the stored day number goes, and no "Day N." replaces it.
      assert.equal(
        formatPlanSessionTitle({ name: 'Day 1: Upper (Heavy)' }, 2, 'Strong Calves Pro', 'en'),
        'Upper (Heavy)',
      );
      // Whichever separator it was saved with.
      assert.equal(
        formatPlanSessionTitle({ name: 'Day 5. Accessory Strength Day' }, 0, 'X', 'en'),
        'Accessory Strength Day',
      );
      assert.equal(formatPlanSessionTitle({ name: 'Upper (Heavy)' }, 0, 'X', 'en'), 'Upper (Heavy)');
      assert.equal(formatPlanSessionTitle({ name: 'Päivä 2: Pakarat' }, 0, 'X', 'fi'), 'Pakarat');
      // A name that is ONLY a placeholder still says something, numbered by
      // the row's place now rather than the number it was saved with.
      assert.equal(formatPlanSessionTitle({ name: 'Day 4' }, 1, 'X', 'en'), 'Workout 2');
      assert.equal(formatPlanSessionTitle({ name: 'Päivä 4' }, 1, 'X', 'fi'), 'Treeni 2');
      assert.equal(formatPlanSessionTitle({ name: 'Workout B' }, 2, 'X', 'fi'), 'Treeni 3');
      // The full-body letters keep the days apart.
      assert.equal(formatPlanSessionTitle({ name: 'Minimal B' }, 1, 'Full Body Minimal', 'fi'), 'Koko keho B');
      // And nothing says "Päivä" any more.
      for (const name of ['Day 1: Upper', 'Päivä 3', 'Workout A', 'Rinta', 'Minimal A']) {
        assert.doesNotMatch(formatPlanSessionTitle({ name }, 0, 'Full Body', 'fi'), /päivä/i, name);
      }
    },
  },
];
