const assert = require('node:assert/strict');

/**
 * The Finnish instruction layer, kept paired with the English library.
 *
 * The library is a generated English dataset — `npm run exercise:sync` rewrites
 * it — so the Finnish steps live in their own file keyed by the English name.
 * That arrangement has exactly one failure mode worth automating: the two
 * drifting apart. A renamed library entry orphans its translation silently, and
 * a translation that merges two steps into one loses a number the reader is
 * counting along with.
 */
const { getExerciseInstructions, finnishInstructionTable, effectiveEnglishInstructions } = require('../../.test-dist/lib/exerciseInstructions.js');
const { EXERCISE_INSTRUCTIONS_EN } = require('../../.test-dist/lib/exerciseInstructionsEn.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary.js');
const { WORKOUT_TEMPLATES_V1, WORKOUT_SUBSTITUTION_GROUPS } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { EQUIPMENT_FALLBACKS } = require('../../.test-dist/lib/equipmentExerciseFilter.js');

// The extras are library entries too — they exist because the generated file
// lacks them and `exercise:sync` would erase them. Reading only the generated
// half made a hand-added exercise look like a translation of nothing.
const FULL_LIBRARY = [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY];
const BY_NAME = new Map(FULL_LIBRARY.map((item) => [item.name, item]));
const LIBRARY_NAMES = FULL_LIBRARY.map((item) => item.name);

// Both Finnish tables as one. The second is loaded on first use, so asking for
// the merged table is the one place this suite loads it on purpose.
const EXERCISE_INSTRUCTIONS_FI_TABLE = finnishInstructionTable();

/**
 * Exercises whose Finnish steps may be word for word their English steps, each
 * with the reason. Empty on purpose: a step that is the same in both languages
 * is almost always an English sentence left in place. An entry belongs here only
 * if the whole text is names and numbers that read the same in Finnish.
 */
const SAME_AS_ENGLISH_ALLOWED = new Map([]);

/**
 * The English steps the reader would see: the audit's correction where there is
 * one (exerciseInstructionsEn.ts), the library row's own otherwise, and blank
 * steps dropped, as the app drops them. The Finnish steps are paired with THESE,
 * not with the upstream text the corrections replace.
 */
function visibleEnglishSteps(item) {
  return item ? effectiveEnglishInstructions(item.name, item.instructions) : [];
}

/** Every library entry a ready program can actually put in front of a reader. */
function reachableLibraryEntries() {
  const names = new Set();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        names.add(exercise.exerciseName);
      }
    }
  }
  // A plan swaps onto these when the reader lacks the gear, so they are
  // prescribed as surely as the rows above — and five of them were English.
  for (const [, candidates] of EQUIPMENT_FALLBACKS) {
    for (const name of candidates) {
      names.add(name);
    }
  }
  // And the swap sheet offers every member of a row's group. Band Assisted
  // Pull-Up, Rope Straight-Arm Pulldown, EZ-Bar Curl and the pec deck were
  // reachable only from there, and all four opened English steps (bug hunt,
  // 2026-10-09).
  for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
    for (const name of group.allowedExerciseNames) {
      names.add(name);
    }
  }

  const entries = new Map();
  for (const name of names) {
    const index = findGuidedLibraryIndex(name, LIBRARY_NAMES);
    if (index === null || index === undefined || index < 0) {
      continue;
    }
    // FULL_LIBRARY, because that is the array LIBRARY_NAMES was built from.
    // Indexing the generated half with an index that can land in the extras
    // returned `undefined` and threw — latent since the extras existed, and
    // only reached once a ready programme actually prescribed one of them.
    const item = FULL_LIBRARY[index];
    // A handful of library entries carry no instructions at all. There is
    // nothing to translate there, and inventing steps would be worse.
    if ((item.instructions ?? []).length > 0) {
      entries.set(item.name, item);
    }
  }
  return entries;
}

module.exports = [
  {
    name: 'instructions: every English correction is for an exercise the library has, and pairs with a Finnish entry',
    run() {
      const table = EXERCISE_INSTRUCTIONS_EN;
      const orphans = Object.keys(table).filter((name) => !BY_NAME.has(name));
      assert.deepEqual(orphans, [], `English corrections keyed to exercises the library does not have: ${orphans.join(', ')}`);
      const unpaired = Object.keys(table).filter((name) => !EXERCISE_INSTRUCTIONS_FI_TABLE[name]);
      assert.deepEqual(unpaired, [], `English corrections with no Finnish steps: ${unpaired.join(', ')}`);
      for (const [name, steps] of Object.entries(table)) {
        assert.ok(steps.length > 0 && steps.every((step) => step.trim()), `${name} has a blank English correction`);
      }
    },
  },
  {
    name: 'instructions: the correction is what English readers get, and the library row is untouched',
    run() {
      const table = EXERCISE_INSTRUCTIONS_EN;
      const name = Object.keys(table)[0];
      const row = BY_NAME.get(name);
      assert.deepEqual(getExerciseInstructions(name, row.instructions, 'en'), table[name]);
      assert.deepEqual(effectiveEnglishInstructions(name, row.instructions), table[name]);
      assert.deepEqual(effectiveEnglishInstructions('Not In The Table', ['A.', '', 'B.']), ['A.', 'B.']);
    },
  },
  {
    name: 'instructions: every translated exercise still exists in the library',
    run() {
      const orphans = Object.keys(EXERCISE_INSTRUCTIONS_FI_TABLE).filter((name) => !BY_NAME.has(name));
      assert.deepEqual(
        orphans,
        [],
        `translations keyed to exercises the library no longer has: ${orphans.join(', ')}`,
      );
    },
  },
  {
    name: 'instructions: a Finnish entry has exactly as many steps as the English one',
    run() {
      const mismatched = [];
      for (const [name, steps] of Object.entries(EXERCISE_INSTRUCTIONS_FI_TABLE)) {
        const english = visibleEnglishSteps(BY_NAME.get(name));
        if (english.length !== steps.length) {
          mismatched.push(`${name} (${english.length} → ${steps.length})`);
        }
      }
      assert.deepEqual(mismatched, [], `step counts drifted: ${mismatched.join(', ')}`);
    },
  },
  {
    name: 'instructions: no step is blank, and none is the English left in place',
    run() {
      for (const [name, steps] of Object.entries(EXERCISE_INSTRUCTIONS_FI_TABLE)) {
        const english = visibleEnglishSteps(BY_NAME.get(name));
        steps.forEach((step, index) => {
          assert.ok(step.trim().length > 0, `${name} step ${index + 1} is empty`);
          assert.notEqual(
            step.trim(),
            (english[index] ?? '').trim(),
            `${name} step ${index + 1} is still the English sentence`,
          );
        });
      }
    },
  },
  {
    name: 'instructions: every exercise a program can prescribe is translated',
    run() {
      // The coverage the file claims. Anything else in the 873-entry library
      // falls back to English on purpose — this is the set a reader meets
      // inside a program rather than while browsing.
      const missing = [...reachableLibraryEntries().keys()].filter(
        (name) => !EXERCISE_INSTRUCTIONS_FI_TABLE[name],
      );
      assert.deepEqual(
        missing,
        [],
        `exercises a program prescribes with no Finnish steps: ${missing.join(', ')}`,
      );
    },
  },
  {
    name: 'instructions: every library exercise with English steps has Finnish steps that are not its English',
    run() {
      // The browse list shows all 958 entries, not only the ones a program
      // prescribes. 708 of them showed English steps to a Finnish reader until
      // the second table existed (2026-10-19). This is the guard that stops it
      // coming back: an entry added by exercise:sync with no translation, or
      // translated by pasting the English, fails here.
      const untranslated = [];
      const sameAsEnglish = [];
      for (const item of FULL_LIBRARY) {
        const english = visibleEnglishSteps(item);
        if (english.length === 0) {
          continue;
        }
        const finnish = getExerciseInstructions(item.name, item.instructions, 'fi');
        if (!EXERCISE_INSTRUCTIONS_FI_TABLE[item.name]) {
          untranslated.push(item.name);
          continue;
        }
        const identical = finnish.length === english.length && finnish.every((step, index) => step === english[index]);
        if (identical && !SAME_AS_ENGLISH_ALLOWED.has(item.name)) {
          sameAsEnglish.push(item.name);
        }
      }
      assert.deepEqual(untranslated, [], `exercises with no Finnish steps: ${untranslated.slice(0, 20).join(', ')}`);
      assert.deepEqual(
        sameAsEnglish,
        [],
        `exercises whose Finnish steps are their English steps: ${sameAsEnglish.slice(0, 20).join(', ')}`,
      );
    },
  },
  {
    name: 'instructions: the same-as-English allow-list is tiny and every entry has a reason and a real exercise',
    run() {
      assert.ok(SAME_AS_ENGLISH_ALLOWED.size <= 3, 'the allow-list is for names and numbers only, not for untranslated text');
      for (const [name, reason] of SAME_AS_ENGLISH_ALLOWED) {
        assert.ok(BY_NAME.has(name), `${name} is allowed but is not in the library`);
        assert.ok(String(reason).trim().length > 10, `${name} is allowed with no reason`);
      }
    },
  },
  {
    name: 'instructions: Finnish steps have no English words and no broken letters',
    run() {
      // A cheap net for the two ways a long hand translation goes wrong: an
      // English phrase left inside a Finnish sentence, and a letter that lost
      // its dots on the way. The words below are all common in the source text
      // and none of them is Finnish.
      const ENGLISH = /\b(the|and|with|your|until|then|repeat|starting|position|palms?|bench|dumbbells?|barbell|shoulders?|elbows?|knees?|hips?|chest|inhale|exhale|breathe)\b/i;
      const BROKEN = /[\u00c3\u00c2\ufffd]|\?\?|\bylos\b|\bselka\b|\bkasi\b|\bkasia\b|\bpaan\b|\bmyos\b/;
      const problems = [];
      for (const [name, steps] of Object.entries(EXERCISE_INSTRUCTIONS_FI_TABLE)) {
        steps.forEach((step, index) => {
          if (ENGLISH.test(step)) problems.push(`${name} step ${index + 1}: English word`);
          if (BROKEN.test(step)) problems.push(`${name} step ${index + 1}: broken letter`);
        });
      }
      assert.deepEqual(problems, [], problems.slice(0, 20).join('; '));
    },
  },
  {
    name: 'instructions: a name the library does not know falls back to English, never to nothing',
    run() {
      // The rule the name layer already follows: an English instruction beats a
      // missing one. A custom exercise is the case left now that the library is
      // fully translated.
      const steps = ['Do this.', 'Then this.'];
      assert.deepEqual(getExerciseInstructions('A Custom Exercise Nobody Translated', steps, 'fi'), steps);

      // English asks for English even where a translation exists.
      const translated = BY_NAME.get(Object.keys(EXERCISE_INSTRUCTIONS_FI_TABLE)[0]);
      assert.deepEqual(
        getExerciseInstructions(translated.name, translated.instructions, 'en'),
        effectiveEnglishInstructions(translated.name, translated.instructions),
      );
      assert.deepEqual(
        getExerciseInstructions(translated.name, translated.instructions, 'fi'),
        EXERCISE_INSTRUCTIONS_FI_TABLE[translated.name],
      );

      // And an entry from the second table answers too.
      const second = BY_NAME.get('Zottman Curl');
      assert.ok(second, 'Zottman Curl is expected in the library');
      assert.deepEqual(
        getExerciseInstructions(second.name, second.instructions, 'fi'),
        EXERCISE_INSTRUCTIONS_FI_TABLE['Zottman Curl'],
      );
    },
  },
  {
    name: 'instructions: the second table is not loaded until a Finnish reader needs it',
    run() {
      // The app evaluates every module before its first render, and the second
      // table is about 0.4 MB of text. Run in a fresh Node so this suite's own
      // use of the merged table does not hide a top-level import.
      const { spawnSync } = require('node:child_process');
      const path = require('node:path');
      const dist = path.resolve(__dirname, '../../.test-dist/lib');
      const script = `
        const path = require('path');
        const dist = ${JSON.stringify(dist)};
        const more = path.join(dist, 'exerciseInstructionsFiMore.js');
        const { getExerciseInstructions } = require(path.join(dist, 'exerciseInstructions.js'));
        const loaded = () => Boolean(require.cache[more]);
        const out = [];
        out.push(loaded());
        getExerciseInstructions('Zottman Curl', ['English.'], 'en');
        out.push(loaded());
        getExerciseInstructions('Barbell Curl', ['English.'], 'fi');
        out.push(loaded());
        getExerciseInstructions('Zottman Curl', ['English.'], 'fi');
        out.push(loaded());
        console.log(JSON.stringify(out));
      `;
      const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60_000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        JSON.parse(result.stdout.trim()),
        [false, false, false, true],
        'not at load, not for English, not for an exercise the first table holds, yes for one it does not',
      );
    },
  },
  {
    name: 'instructions: nothing to draw returns nothing, in either language',
    run() {
      for (const language of ['en', 'fi']) {
        assert.deepEqual(getExerciseInstructions('Bench Press', [], language), []);
        assert.deepEqual(getExerciseInstructions('Bench Press', null, language), []);
        assert.deepEqual(getExerciseInstructions(null, null, language), []);
        // A blank step in the source is not a step.
        assert.deepEqual(getExerciseInstructions('Nothing At All', ['', 'Do it.'], language), ['Do it.']);
      }
    },
  },
];
