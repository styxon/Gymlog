const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * A superset is one field on a stored lift, and the template writer replaces
 * the whole record — so every save has to carry `supersetGroup` or it ends
 * every pair in the programme (found 2026-09-14).
 *
 * Two ways it was being lost:
 *   - onboarding saved the composed week without it, so the programme most
 *     readers own — the one onboarding builds — never ran a superset, though
 *     the catalogue prescribes 83 and the preview showed them;
 *   - three App.tsx saves (emphasis, renaming a day, reordering days) copied
 *     the lift's fields by hand and left it out.
 */
module.exports = [
  {
    name: 'supersetsSurviveSaves: the programme onboarding saves keeps the catalogue pairs',
    run() {
      const { buildSavedOnboardingPlan } = require('../../src/app/onboardingHandoff');
      const { DEFAULT_FIRST_RUN_SELECTION } = require('../../src/lib/firstRunSetup');
      const selection = {
        ...DEFAULT_FIRST_RUN_SELECTION,
        goal: 'muscle',
        level: 'advanced',
        daysPerWeek: 4,
        equipment: 'gym',
        trainingEnvironment: 'full_gym',
        focusAreas: ['chest', 'back', 'shoulders'],
      };
      // HUGE Pro: day 1 pairs Lateral Raise with Triceps Pushdown.
      const { draft, runtimeTemplate } = buildSavedOnboardingPlan(selection, 'tpl_4_day_upper_lower_v1', 'fi');

      const composedPairs = runtimeTemplate.sessions.flatMap((session) =>
        session.exercises.filter((exercise) => exercise.supersetGroup).map((exercise) => `${session.id}|${exercise.id}|${exercise.supersetGroup}`),
      );
      assert.ok(composedPairs.length >= 2, 'the composed week should carry the catalogue pairs');

      const savedPairs = draft.sessions.flatMap((session) =>
        session.exercises.filter((exercise) => exercise.supersetGroup).map((exercise) => `${session.id}|${exercise.id}|${exercise.supersetGroup}`),
      );
      assert.deepEqual(savedPairs, composedPairs, 'the saved draft pairs exactly what the composed week pairs');

      const day1 = draft.sessions[0].exercises;
      const raise = day1.find((exercise) => exercise.name === 'Lateral Raise');
      const pushdown = day1.find((exercise) => exercise.name === 'Triceps Pushdown');
      assert.ok(raise && pushdown);
      assert.ok(raise.supersetGroup, 'Lateral Raise is paired');
      assert.equal(raise.supersetGroup, pushdown.supersetGroup, 'with Triceps Pushdown');
    },
  },
  {
    name: 'supersetsSurviveSaves: the shared copy of a lift carries its superset',
    run() {
      const { toDraftExercise } = require('../../src/lib/programSessionEdit');
      const lift = {
        id: 'x',
        name: 'Lateral Raise',
        targetSets: 2,
        repMin: 15,
        repMax: 15,
        restSeconds: 75,
        trackedDefault: true,
        libraryItemId: null,
        supersetGroup: 'ss_a',
      };
      assert.equal(toDraftExercise(lift).supersetGroup, 'ss_a');
      assert.equal(toDraftExercise({ ...lift, supersetGroup: undefined }).supersetGroup, null);
    },
  },
  {
    name: 'supersetsSurviveSaves: every whole-programme save in App.tsx copies lifts through the shared helper',
    run() {
      // Every save in the shell: the handlers leave VinhaApp for src/app in
      // the phase-B split (2026-09-30), App.tsx is read first and the modules
      // after it, and the floor below is today's count, so none can leave the
      // loop unread.
      const app = require('../helpers/appWiringSource.cjs').readAppWiring().replace(/\r\n/g, '\n');
      const marker = 'await editWorkoutTemplateSessions(';
      let from = 0;
      let saves = 0;
      for (;;) {
        const at = app.indexOf(marker, from);
        if (at === -1) break;
        saves += 1;
        // The handler from the call to its closing brace, capped so a missing
        // brace cannot swallow the rest of the file.
        const handlerEnd = app.indexOf('\n  }\n', at);
        const body = app.slice(at, Math.min(handlerEnd === -1 ? app.length : handlerEnd, at + 2500));
        assert.ok(
          /toDraftExercise|applyProgramSessionEdit/.test(body),
          `a template save at shell wiring offset ${at} copies lifts without toDraftExercise`,
        );
        assert.doesNotMatch(
          body,
          /repMin: exercise\.repMin,/,
          `a template save at shell wiring offset ${at} copies a lift's fields by hand`,
        );
        from = at + marker.length;
      }
      // Emphasis, rename, reorder, and the day editor's own add/remove/replace.
      assert.ok(saves >= 6, `expected at least six whole-programme saves, found ${saves}`);
    },
  },
];
