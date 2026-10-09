const assert = require('node:assert/strict');

const { getDrillLibraryName } = require('../../.test-dist/lib/drillMedia');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary');
const { getDefaultCooldown, getDefaultWarmup } = require('../../.test-dist/lib/homeSessionHero');

const FOCUS_KINDS = ['general', 'push', 'pull', 'upper', 'lower'];

module.exports = [
  {
    name: 'every generated warmup and cooldown drill resolves to a library photo',
    run() {
      for (const focus of FOCUS_KINDS) {
        for (const language of ['en', 'fi']) {
          const drills = [
            ...getDefaultWarmup(focus, language).drills,
            ...getDefaultCooldown(focus, language).drills,
          ];
          for (const drill of drills) {
            const libraryName = getDrillLibraryName(drill.name);
            assert.ok(libraryName, `no library stand-in for "${drill.name}" (${language})`);

            const match = GENERATED_EXERCISE_LIBRARY.find((item) => item.name === libraryName);
            assert.ok(match, `library has no exercise named "${libraryName}"`);
            assert.ok(
              typeof match.imageKey === 'string' && match.imageKey.length > 0,
              `"${libraryName}" carries no photo`,
            );
          }
        }
      }
    },
  },
  {
    name: 'real exercises are left alone so they resolve on their own name',
    run() {
      assert.equal(getDrillLibraryName('Bodyweight Squat'), null);
      assert.equal(getDrillLibraryName(''), null);
    },
  },
  {
    name: 'matching ignores case and stray whitespace',
    run() {
      assert.equal(getDrillLibraryName('  rowing MACHINE '), 'Rowing, Stationary');
      assert.equal(getDrillLibraryName('Soutulaite'), 'Rowing, Stationary');
    },
  },
];
