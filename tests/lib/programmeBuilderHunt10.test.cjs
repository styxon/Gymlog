const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PROGRAMME_NAME_MAX, SPLIT_PRESETS, typedSessionNames } = require('../../.test-dist/lib/templateBuilderSteps.js');
const { quickLayoutLiftNames } = require('../../.test-dist/lib/quickLayoutExercises.js');
const { formatPlanSessionTitle, isReaderNamedSession } = require('../../.test-dist/lib/sessionNameLabel.js');
const {
  buildDisplayCopyName,
  formatLiftDisplayLabel,
  formatWorkoutDisplayLabel,
} = require('../../.test-dist/lib/displayLabel.js');
const { buildSwapAlternatives } = require('../../.test-dist/lib/swapPickerLists.js');
const { buildTailoringPreferences } = require('../../.test-dist/lib/tailoringFit.js');
const { WORKOUT_SUBSTITUTION_GROUPS } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { isExerciseAllowedWithEquipment, resolveAvailableEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { createSeedDatabase } = require('../../.test-dist/data/seed.js');
const i18n = require('../../.test-dist/lib/i18n.js');

/**
 * The programme builder, break round 10 (2026-10-09): what the builder writes
 * has to read the way the reader wrote it, offer what the reader's gear can do,
 * and ask before it throws a day away.
 */
const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const bothLanguages = (key) => {
  assert.equal(typeof i18n.t('en', key), 'string');
  assert.notEqual(i18n.t('en', key), key, `${key} is missing in English`);
  assert.notEqual(i18n.t('fi', key), key, `${key} is missing in Finnish`);
  assert.notEqual(i18n.t('fi', key), i18n.t('en', key), `${key} is not translated`);
};

const screenSource = () => strip(read('src', 'screens', 'CreateTemplateScreen.tsx'));

module.exports = [
  // 15
  {
    name: 'builder day names: only a name the reader typed is remembered as theirs, by day id',
    run() {
      assert.deepEqual(
        typedSessionNames([
          { id: 's1', name: ' A ', nameTyped: true },
          { id: 's2', name: 'Push', nameTyped: false },
          { id: 's3', name: '   ', nameTyped: true },
          { id: 's4', name: 'Päivä 4', nameTyped: false },
        ]),
        { s1: 'A' },
      );
    },
  },
  {
    name: 'builder day names: "A", "Workout B" and "Day 2" read as typed once remembered, as they do from the pen',
    run() {
      const days = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'Workout B' },
        { id: 'c', name: 'Day 2' },
      ];
      const remembered = typedSessionNames(days.map((day) => ({ ...day, nameTyped: true })));
      for (const language of ['en', 'fi']) {
        const rows = days.map((day, index) =>
          formatPlanSessionTitle(day, index, 'My Plan', language, isReaderNamedSession(remembered, day)),
        );
        assert.deepEqual(rows, ['A', 'Workout B', 'Day 2'], language);
        // Not remembered, the placeholder rules apply to them: what the
        // builder produced before it wrote the names down.
        const unremembered = days.map((day, index) =>
          formatPlanSessionTitle(day, index, 'My Plan', language, isReaderNamedSession({}, day)),
        );
        assert.notDeepEqual(unremembered, rows, language);
      }
    },
  },
  {
    name: 'builder day names: the screen marks typed names, gives every day an id, and the save writes them down',
    run() {
      const screen = screenSource();
      // Only the day's field marks a name as typed.
      assert.match(screen, /name: nextName,\s*nameTyped: true,/);
      assert.equal(screen.split('nameTyped: true').length - 1, 1, 'only updateSessionName marks a name typed');
      // The ids are minted before the save, because the names are kept by id.
      // and the flag rides on the draft to the caller that stores the names.
      assert.match(
        screen,
        /id: session\.id \?\? createId\('workout_template_session'\),\s*name: session\.name\.trim\(\)[^\n]*\n\s*nameTyped: session\.nameTyped,/,
      );

      const tab = strip(read('src', 'app', 'renderWorkoutTab.tsx'));
      const start = tab.indexOf('onSave={async (draft) => {');
      assert.notEqual(start, -1, 'the builder save moved');
      const end = tab.indexOf("replaceRoute({ tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId });", start);
      assert.ok(end > start, 'the save no longer ends on the programme page');
      const save = tab.slice(start, end);
      const upsert = save.indexOf('await upsertWorkoutTemplate(draft)');
      const remember = save.search(/typedSessionNames\(draft\.sessions\)/);
      assert.ok(upsert !== -1 && remember > upsert, 'the names are written down only after the programme is stored');
      assert.match(save, /readerSessionNames: \{ \.\.\.current\.readerSessionNames, \.\.\.typedDayNames \}/);
      // Its own try: a failure here is not a failed save.
      assert.match(save, /try \{\s*await updatePreferences\(\(current\) => \(\{\s*readerSessionNames/);
    },
  },

  // 16
  {
    name: 'swap alternatives: nothing the reader\'s gear cannot do is offered, for any lift of any group',
    run() {
      const base = createSeedDatabase().preferences;
      const readers = [
        { setupEquipment: 'minimal', setupTrainingEnvironment: 'bodyweight_only', setupEquipmentItems: [] },
        {
          setupEquipment: 'home',
          setupTrainingEnvironment: 'home',
          setupEquipmentItems: ['Dumbbells', 'Bench', 'Resistance bands'],
        },
      ];
      for (const reader of readers) {
        const preferences = buildTailoringPreferences({ ...base, ...reader });
        const available = resolveAvailableEquipment({
          trainingEnvironment: reader.setupTrainingEnvironment,
          equipmentItems: reader.setupEquipmentItems,
        });
        let checked = 0;
        for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
          for (const current of group.allowedExerciseNames) {
            const offered = buildSwapAlternatives({
              currentName: current,
              substitutionGroup: group.id,
              preferences,
              sessionLifts: [current],
              query: '',
              language: 'en',
            });
            for (const name of offered) {
              checked += 1;
              assert.ok(
                isExerciseAllowedWithEquipment(name, available),
                `${reader.setupTrainingEnvironment}: ${current} -> ${name} needs gear the reader does not have`,
              );
            }
          }
        }
        assert.ok(checked > 100, 'the sweep found almost nothing to check');
      }
    },
  },
  {
    name: 'swap alternatives: the named example, and gear that is unknown leaves the pool as it was',
    run() {
      const base = createSeedDatabase().preferences;
      const swap = (reader, currentName, substitutionGroup) =>
        buildSwapAlternatives({
          currentName,
          substitutionGroup,
          preferences: buildTailoringPreferences({ ...base, ...reader }),
          sessionLifts: [currentName],
          query: '',
          language: 'en',
        });
      const group = WORKOUT_SUBSTITUTION_GROUPS.find((candidate) => candidate.allowedExerciseNames.includes('Goblet Squat'));
      assert.ok(group, 'Goblet Squat is in a substitution group');
      const home = swap(
        { setupEquipment: 'home', setupTrainingEnvironment: 'home', setupEquipmentItems: ['Dumbbells', 'Bench'] },
        'Goblet Squat',
        group.id,
      );
      assert.ok(!home.includes('Back Squat'), 'a barbell squat offered to a reader with dumbbells');
      // No gear answered: every member of the group stays on the sheet.
      const unknown = swap(
        { setupEquipment: null, setupTrainingEnvironment: null, setupEquipmentItems: [] },
        'Goblet Squat',
        group.id,
      );
      assert.ok(unknown.includes('Back Squat'), 'unknown gear narrowed the pool');
      assert.ok(unknown.length > home.length);
    },
  },
  {
    name: 'swap alternatives: the gear reaches the swap sheet through the tailoring preferences and their memo key',
    run() {
      const tailoring = buildTailoringPreferences({
        ...createSeedDatabase().preferences,
        setupTrainingEnvironment: 'home',
        setupEquipmentItems: ['Dumbbells'],
      });
      assert.equal(tailoring.setupTrainingEnvironment, 'home');
      assert.deepEqual(tailoring.setupEquipmentItems, ['Dumbbells']);
      // The memo is keyed on the fields it reads; a gear change must rebuild it.
      const readings = strip(read('src', 'app', 'useSetupReadings.ts'));
      const key = readings.slice(readings.indexOf('const tailoringKey'), readings.indexOf('const tailoringPreferences'));
      assert.match(key, /preferences\.setupTrainingEnvironment/);
      assert.match(key, /preferences\.setupEquipmentItems/);
    },
  },

  // 58
  {
    name: 'quick layouts: the days of one layout are never the same lifts twice',
    run() {
      for (const presets of Object.values(SPLIT_PRESETS)) {
        for (const preset of presets) {
          const seen = new Map();
          for (const dayName of preset.names) {
            const lifts = quickLayoutLiftNames(dayName).join('|');
            assert.ok(lifts, `${preset.id}: ${dayName} has no lifts`);
            assert.ok(
              !seen.has(lifts),
              `${preset.id}: "${dayName}" has the same lifts as "${seen.get(lifts)}" (${lifts})`,
            );
            seen.set(lifts, dayName);
          }
        }
      }
    },
  },
  {
    name: 'quick layouts: Heavy, Strength and Pump / Volume days read their qualifier; a plain day is unchanged',
    run() {
      const upperHeavy = quickLayoutLiftNames('Upper Heavy');
      const upperPump = quickLayoutLiftNames('Upper Pump');
      assert.notDeepEqual(upperHeavy, upperPump);
      assert.notDeepEqual(upperHeavy, quickLayoutLiftNames('Upper Strength'));
      assert.deepEqual(quickLayoutLiftNames('Push Volume').length, 4);
      assert.notDeepEqual(quickLayoutLiftNames('Push Volume'), quickLayoutLiftNames('Push'));
      // A name with no qualifier keeps the lifts it always had.
      assert.deepEqual(quickLayoutLiftNames('Push'), ['Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Triceps Pushdown']);
      assert.deepEqual(quickLayoutLiftNames('Upper Strength'), quickLayoutLiftNames('Upper'));
      // A two-focus day does not read a qualifier.
      assert.deepEqual(quickLayoutLiftNames('Chest / Triceps'), ['Bench Press', 'Incline Dumbbell Press', 'Triceps Pushdown', 'Skull Crusher']);
    },
  },

  // 59
  {
    name: 'display labels: a programme named with one character is shown as typed',
    run() {
      for (const name of ['A', 'B', '5', 'Ä']) {
        assert.equal(formatWorkoutDisplayLabel(name), name);
      }
      assert.equal(buildDisplayCopyName('A', 'fi', ['A']), 'A (kopio)');
      // The fallback stays for what is nothing: blank, or only a copy suffix.
      assert.equal(formatWorkoutDisplayLabel('   '), 'Custom workout');
      assert.equal(formatWorkoutDisplayLabel('(copy)'), 'Custom workout');
      // And a one-character lift name is still a broken import.
      assert.equal(formatLiftDisplayLabel('t'), 'Unnamed lift');
    },
  },
  {
    name: 'display labels: the programme list and page fall back in the reader\'s language',
    run() {
      const items = strip(read('src', 'app', 'useProgramsCustomItems.ts'));
      assert.match(items, /formatWorkoutDisplayLabel\(template\.name, t\(preferences\.appLanguage, 'common\.customWorkout'\)\)/);
      const detail = strip(read('src', 'screens', 'ProgramDetailScreen.tsx'));
      assert.match(detail, /formatWorkoutDisplayLabel\(program\.title, t\(language, 'common\.customWorkout'\)\)/);
      assert.doesNotMatch(detail, /formatWorkoutDisplayLabel\(program\.title, 'Workout plan'\)/);
    },
  },

  // 60
  {
    name: 'builder: Remove on a day that holds lifts asks first, as the day-count chips do',
    run() {
      const screen = screenSource();
      assert.doesNotMatch(screen, /onPress=\{\(\) => removeSession\(/, 'Remove still drops a day unasked');
      assert.match(screen, /onPress=\{\(\) => requestSessionRemoval\(session\.localKey\)\}/);
      // An empty day is not worth a question.
      assert.match(
        screen,
        /function requestSessionRemoval\(sessionKey: string\) \{[\s\S]{0,200}target\.exercises\.length === 0\) \{\s*removeSession\(sessionKey\);\s*return;\s*\}\s*setPendingDayRemoval\(sessionKey\);/,
      );
      assert.match(screen, /<ConfirmDialog[\s\S]{0,200}visible=\{pendingDayRemoval !== null\}/);
      assert.match(screen, /onConfirm=\{\(\) => \{\s*const target = pendingDayRemoval;\s*setPendingDayRemoval\(null\);\s*if \(target\) \{\s*removeSession\(target\);/);
      for (const key of ['tpl.removeDay.title', 'tpl.removeDay.body', 'tpl.dropDays.confirm']) {
        bothLanguages(key);
      }
    },
  },

  // 61
  {
    name: 'builder: programme and day names share the page\'s 60-character limit, from one constant',
    run() {
      assert.equal(PROGRAMME_NAME_MAX, 60);
      const builder = screenSource();
      assert.equal(builder.split('maxLength={PROGRAMME_NAME_MAX}').length - 1, 2, 'both builder inputs');
      assert.equal(strip(read('src', 'screens', 'ProgramDetailScreen.tsx')).split('maxLength={PROGRAMME_NAME_MAX}').length - 1, 1);
      assert.equal(strip(read('src', 'screens', 'ProgramDayScreen.tsx')).split('maxLength={PROGRAMME_NAME_MAX}').length - 1, 1);
      for (const file of ['CreateTemplateScreen', 'ProgramDetailScreen', 'ProgramDayScreen']) {
        assert.doesNotMatch(read('src', 'screens', `${file}.tsx`), /maxLength=\{60\}/, `${file} has its own 60`);
      }
    },
  },
];
