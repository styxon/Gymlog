const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { prescriptionUnitFromName, estimateSessionMinutes } = require('../../.test-dist/lib/sessionDuration.js');
const {
  estimateProgrammeSessionMinutes,
  estimateProgrammeSessionMinutesList,
  readyTemplateCardMinutes,
} = require('../../.test-dist/lib/programmeMinutes.js');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer.js');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

const root = path.join(__dirname, '..', '..');

/** Source without its comments, so a guard reads the code and not the notes on it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The names a hook takes out of its `deps` argument. */
function hookDeps(source) {
  const match = source.match(/const \{([^}]*)\} = deps;/);
  assert.ok(match, 'the hook destructures its deps');
  return match[1];
}

module.exports = [
  {
    name: 'session length: a distance or an interval in the rep field is costed as what it is',
    run() {
      assert.equal(prescriptionUnitFromName('Rowing Machine (500m intervals)'), 'metres');
      assert.equal(prescriptionUnitFromName('Sprint 40m'), 'metres');
      assert.equal(prescriptionUnitFromName('Sprint Interval (200m)'), 'metres');
      assert.equal(prescriptionUnitFromName('Treadmill HIIT (30s on / 30s off)'), 'seconds');
      assert.equal(prescriptionUnitFromName('Bike HIIT (45s sprint / 15s rest)'), 'seconds');
      assert.equal(prescriptionUnitFromName('Air Bike (30s sprint)'), 'seconds');
      assert.equal(prescriptionUnitFromName('Burpee (20s on / 10s off)'), 'seconds');
      for (const reps of ['Bench Press', 'Romanian Deadlift', 'Hammer Curl', '10 min walk', 'Walking Lunge', 'Sledgehammer Strike']) {
        assert.equal(prescriptionUnitFromName(reps), null, reps);
      }
      // Carries and sleds are prescribed by distance, ropes by time, without
      // the name saying so (sweep, 2026-10-04).
      // A loaded carry or sled push moves at a walk: its number is costed as
      // seconds, not at the sprint rate per metre (review, 2026-10-04).
      assert.equal(prescriptionUnitFromName('Farmer\'s Walk'), 'seconds');
      assert.equal(prescriptionUnitFromName('Sled Push'), 'seconds');
      // The sled lifts are repetitions.
      assert.equal(prescriptionUnitFromName('Sled Row'), null);
      assert.equal(prescriptionUnitFromName('Sled Reverse Flye'), null);
      assert.equal(prescriptionUnitFromName('Sled Overhead Triceps Extension'), null);
      assert.equal(prescriptionUnitFromName('Battle Rope Wave'), 'seconds');
      assert.equal(prescriptionUnitFromName('Battle Rope Slam'), 'seconds');
      const farmer = estimateSessionMinutes({ exercises: [{ name: 'Farmer\'s Walk', sets: 4, reps: 60, restSeconds: 60 }] });
      const farmerAsReps = estimateSessionMinutes({ exercises: [{ sets: 4, reps: 60, restSeconds: 60 }] });
      assert.ok(farmer < farmerAsReps, `${farmer} vs ${farmerAsReps}`);
      const ropes = estimateSessionMinutes({ exercises: [{ name: 'Battle Rope Slam', sets: 6, reps: 45, restSeconds: 30 }] });
      const ropesAsReps = estimateSessionMinutes({ exercises: [{ sets: 6, reps: 45, restSeconds: 30 }] });
      assert.ok(ropes < ropesAsReps, `${ropes} vs ${ropesAsReps}`);

      // Six 500 m rows were six sets of 500 repetitions: half an hour of work
      // each. As distance they are minutes.
      const asReps = estimateSessionMinutes({ exercises: [{ sets: 6, reps: 500, restSeconds: 60 }] });
      const asMetres = estimateSessionMinutes({
        exercises: [{ name: 'Rowing Machine (500m intervals)', sets: 6, reps: 500, restSeconds: 60 }],
      });
      assert.ok(asReps > 150, `as reps ${asReps}`);
      assert.ok(asMetres <= 25, `as metres ${asMetres}`);
    },
  },
  {
    name: 'programme minutes: no ready programme quotes an impossible session',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        const list = estimateProgrammeSessionMinutesList(template.sessions);
        for (const [index, minutes] of list.entries()) {
          // The conditioning day that started this read 280.
          assert.ok(minutes > 0 && minutes <= 150, `${template.id} session ${index + 1}: ${minutes} min`);
        }
        const card = readyTemplateCardMinutes(template);
        assert.ok(card >= 5 && card % 5 === 0, `${template.id}: ${card}`);
      }
    },
  },
  {
    name: 'programme minutes: the ready card quotes the week it composed, with Home\'s arithmetic',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.id === 'tpl_gainer_athlete_conditioning_v1');
      assert.ok(template);
      const selection = {
        ...DEFAULT_FIRST_RUN_SELECTION,
        daysPerWeek: template.daysPerWeek,
        availableDays: [],
        scheduleMode: 'app_managed',
      };
      const week = composeProgramWeekForSelection(selection, template.id);
      assert.ok(week);
      // The ready programme as it runs: the low end of each rest, the same as
      // the Programs cards and Home for a ready plan.
      assert.equal(week.sessionMinutes, estimateProgrammeSessionMinutes(week.sessions, { availableEquipment: null }));
      // The copy onboarding saves keeps the high end, so the pick card quotes
      // that one — and only the pick card does (review of #312).
      assert.equal(
        week.savedCopySessionMinutes,
        estimateProgrammeSessionMinutes(week.sessions, { availableEquipment: null, rest: 'max' }),
      );
      assert.ok(week.savedCopySessionMinutes >= week.sessionMinutes);
      assert.match(
        fs.readFileSync(path.join(root, 'src/app/onboardingHandoff.ts'), 'utf8'),
        /restSeconds: exercise\.restSecondsMax,/,
      );
      assert.match(
        fs.readFileSync(path.join(root, 'src/screens/OnboardingScreen.tsx'), 'utf8'),
        /mins: week\.savedCopySessionMinutes,/,
      );
      assert.notEqual(week.sessionMinutes, 0);
    },
  },
  {
    name: 'programme minutes: every card reads the estimate, none the catalog\'s hand-written number',
    run() {
      const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(read('src/lib/programDayComposer.ts'), /sessionMinutes: template\.estimatedSessionDuration,/);
      // The page's own number: the reader's composed week for their own
      // programme, the gear estimate for the rest (#37). Every card site, by
      // count: one site passing the week beside another passing null passed
      // a single match (review, 2026-10-08).
      for (const [file, sites] of [['src/app/useProgramsCatalog.tsx', 2], ['src/app/useGoalFlow.tsx', 1]]) {
        const source = stripComments(read(file));
        const minutesValues = [...source.matchAll(/\bminutes:\s*(.*)/g)].map((match) => match[1].trim());
        assert.equal(minutesValues.length, sites, `${file}: ${minutesValues.join(' | ')}`);
        for (const value of minutesValues) {
          assert.match(value, /^programmeCardMinutes\(template, readerComposedWeek, /, `${file}: minutes: ${value}`);
        }
        assert.doesNotMatch(source, /readyTemplateCardMinutes\(/, file);
      }
      // And the week is the page's: the resolver the programme page calls
      // (renderWorkoutTab), from the same context, handed on as it is.
      const pageContext =
        /resolveReaderComposedWeek\((preferences\.recommendedProgramId|workoutTemplateId), \{\s*recommendedProgramId: preferences\.recommendedProgramId,\s*setupSelection,\s*workoutTemplates: database\.workoutTemplates,\s*workoutPlans: database\.workoutPlans,\s*\}\)/;
      assert.match(stripComments(read('src/app/renderWorkoutTab.tsx')), pageContext, 'the programme page');
      const catalog = stripComments(read('src/app/useProgramsCatalog.tsx'));
      const catalogWeek = catalog.match(/const readerComposedWeek = useMemo\(\s*\(\) =>\s*preferences\.recommendedProgramId\s*\?([\s\S]*?): null,/);
      assert.ok(catalogWeek, 'useProgramsCatalog composes readerComposedWeek in one useMemo');
      assert.match(catalogWeek[1].trim(), new RegExp(`^${pageContext.source}$`), 'the cards compose from the page\'s context');
      assert.equal((catalog.match(/\breaderComposedWeek\s*=/g) ?? []).length, 1, 'useProgramsCatalog assigns readerComposedWeek once');
      assert.match(hookDeps(catalog), /^\s*setupSelection,$/m, 'useProgramsCatalog reads setupSelection from its deps');
      const goalFlow = stripComments(read('src/app/useGoalFlow.tsx'));
      assert.match(hookDeps(goalFlow), /^\s*readerComposedWeek,$/m, 'useGoalFlow reads readerComposedWeek from its deps');
      assert.equal((goalFlow.match(/\breaderComposedWeek\s*=/g) ?? []).length, 0, 'useGoalFlow composes no week of its own');
      // App hands the catalog the setup the page composes from, and the goal
      // flow the week the catalog composed.
      const app = stripComments(read('App.tsx'));
      const catalogCall = app.match(/const \{([^}]*)\} = useProgramsCatalog\(\{([^}]*)\}\);/);
      assert.ok(catalogCall, 'App calls useProgramsCatalog');
      assert.match(catalogCall[1], /^\s*readerComposedWeek,$/m, 'App takes readerComposedWeek from useProgramsCatalog');
      assert.match(catalogCall[2], /^\s*setupSelection,$/m, 'App passes setupSelection to useProgramsCatalog');
      const goalFlowCall = app.match(/\} = useGoalFlow\(\{([^}]*)\}\);/);
      assert.ok(goalFlowCall, 'App calls useGoalFlow');
      assert.match(goalFlowCall[1], /^\s*readerComposedWeek,$/m, 'App passes readerComposedWeek to useGoalFlow');
      assert.equal((app.match(/\breaderComposedWeek\s*=/g) ?? []).length, 0, 'App composes no week of its own');
      // The programme page: the composed week when it is the reader's plan,
      // otherwise the same options the cards get, so the two agree.
      assert.match(
        read('src/lib/programDetails.ts'),
        /composedWeek\?\.sessionMinutes \|\| readyTemplateCardMinutes\(template, minutesOptions\)/,
      );
      assert.equal(
        (read('src/app/renderWorkoutTab.tsx').match(/availableEquipment: availableEquipmentForDrills, overrides: preferences\.routineDrillOverrides/g) ?? []).length,
        2,
        'both programme-page builds pass the reader\'s gear',
      );
      // Home, the player and the programme page hand the estimator the name,
      // or a 500 m row is 500 repetitions there again.
      for (const file of ['src/app/useHomeActivePlan.ts', 'src/screens/GuidedPlayerScreen.tsx', 'src/screens/ProgramDetailScreen.tsx']) {
        assert.match(read(file), /\n\s+name: exercise\.(name|exerciseName),/, file);
      }
    },
  },
  {
    // Bug hunt, 2026-10-04: tpl_3_day_push_pull_legs_v1 with bands only read 35
    // on the Programs card and 20 on the programme page.
    name: 'programme minutes: the card quotes the week composed for the reader\'s own gear',
    run() {
      const gearSets = [
        { trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
        { trainingEnvironment: 'home', equipmentItems: ['bands'] },
        { trainingEnvironment: 'home', equipmentItems: ['dumbbells'] },
        { trainingEnvironment: 'home', equipmentItems: ['dumbbells', 'bench'] },
        { trainingEnvironment: 'gym', equipmentItems: [] },
      ];
      const { resolveAvailableEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
      let differing = 0;
      let checked = 0;
      for (const gear of gearSets) {
        for (const template of WORKOUT_TEMPLATES_V1) {
          if (template.daysPerWeek < 2 || template.daysPerWeek > 6) continue;
          const selection = {
            ...DEFAULT_FIRST_RUN_SELECTION,
            ...gear,
            daysPerWeek: template.daysPerWeek,
            availableDays: [],
            scheduleMode: 'app_managed',
            focusAreas: [],
            cautionFlags: [],
          };
          let week = null;
          try { week = composeProgramWeekForSelection(selection, template.id); } catch { continue; } // seasonal templates have no recommendation profile
          if (!week || week.days !== template.sessions.length) continue;
          const availableEquipment = resolveAvailableEquipment(selection);
          const card = readyTemplateCardMinutes(template, { availableEquipment });
          assert.equal(card, week.sessionMinutes, `${template.id} ${JSON.stringify(gear)}`);
          if (card !== readyTemplateCardMinutes(template)) differing += 1;
          checked += 1;
        }
      }
      assert.ok(checked > 50, `only ${checked} cases`);
      assert.ok(differing > 0, 'gear never changed a card: the test would pass without the fix');
    },
  },

];
