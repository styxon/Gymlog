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
      for (const reps of ['Bench Press', 'Romanian Deadlift', 'Hammer Curl', '10 min walk', 'Farmer\'s Walk']) {
        assert.equal(prescriptionUnitFromName(reps), null, reps);
      }

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
      assert.equal(week.sessionMinutes, estimateProgrammeSessionMinutes(week.sessions, { availableEquipment: null }));
      assert.notEqual(week.sessionMinutes, 0);
    },
  },
  {
    name: 'programme minutes: every card reads the estimate, none the catalog\'s hand-written number',
    run() {
      const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(read('src/lib/programDayComposer.ts'), /sessionMinutes: template\.estimatedSessionDuration,/);
      for (const file of ['src/app/useProgramsCatalog.tsx', 'src/app/useGoalFlow.tsx']) {
        const source = read(file);
        assert.doesNotMatch(source, /minutes: template\.estimatedSessionDuration/, file);
        assert.match(source, /readyTemplateCardMinutes\(template/, file);
      }
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
];
