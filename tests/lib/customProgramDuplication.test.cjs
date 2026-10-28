const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { buildDuplicatedCustomProgramDraft } = require('../../src/lib/customProgramDuplication');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

module.exports = [
  {
    name: 'custom program duplication keeps sessions and exercises in order',
    run() {
      const draft = buildDuplicatedCustomProgramDraft('Upper Lower', [
        {
          id: 'upper',
          name: 'Upper',
          orderIndex: 0,
          exerciseIds: ['bench', 'row'],
          exercises: [
            { id: 'bench', workoutTemplateId: 'custom_1', workoutTemplateSessionId: 'upper', name: 'Bench Press', targetSets: 3, repMin: 6, repMax: 8, restSeconds: 120, trackedDefault: true, orderIndex: 0, libraryItemId: 'lib_bench' },
            { id: 'row', workoutTemplateId: 'custom_1', workoutTemplateSessionId: 'upper', name: 'Row', targetSets: 3, repMin: 8, repMax: 10, restSeconds: 90, trackedDefault: true, orderIndex: 1, libraryItemId: 'lib_row' },
          ],
        },
        {
          id: 'lower',
          name: 'Lower',
          orderIndex: 1,
          exerciseIds: ['squat'],
          exercises: [
            { id: 'squat', workoutTemplateId: 'custom_1', workoutTemplateSessionId: 'lower', name: 'Back Squat', targetSets: 3, repMin: 5, repMax: 8, restSeconds: 150, trackedDefault: true, orderIndex: 0, libraryItemId: 'lib_squat' },
          ],
        },
      ], []);

      assert.equal(draft.name, 'Upper Lower', 'a copy keeps its own name');
      assert.equal(draft.sessions.length, 2);
      assert.equal(draft.sessions[0].name, 'Upper');
      assert.deepEqual(draft.sessions[0].exercises.map((exercise) => exercise.name), ['Bench Press', 'Row']);
      assert.equal(draft.sessions[1].exercises[0].restSeconds, 150);
    },
  },
  {
    /**
     * A copy keeps its own name. The reader changed a lift in a ready
     * programme; they did not ask for a second programme, and there is no
     * second programme — the catalog original is untouched behind them (user
     * 2026-09-08, "ei ole tarkoitus olla kopiota").
     */
    name: 'a copy keeps the programme\'s own name',
    run() {
      const draft = buildDuplicatedCustomProgramDraft('Upper Lower', [], ['Something Else']);
      assert.equal(draft.name, 'Upper Lower');
      // Whitespace is not a different name.
      assert.equal(buildDuplicatedCustomProgramDraft('  Upper Lower  ', [], ['Upper Lower']).name.startsWith('Upper Lower ('), true);
    },
  },
  {
    /**
     * The suffix survives for one case, and it is not a feature: the plain
     * name is already taken. Two rows reading the same is worse than one
     * reading "(copy)" — and either can be typed over on the programme page.
     */
    name: 'only a name already taken falls back to a suffix, and it counts up',
    run() {
      assert.equal(
        buildDuplicatedCustomProgramDraft('Upper Lower', [], ['Upper Lower']).name,
        'Upper Lower (copy)',
      );
      assert.equal(
        buildDuplicatedCustomProgramDraft('Upper Lower', [], ['Upper Lower', 'Upper Lower (copy)']).name,
        'Upper Lower (copy 2)',
      );
    },
  },
  {
    // Duplication is where catalog English entered the user's own database.
    // Every viewer localises on the way out, so this showed through only in
    // the template editor — the one screen that must display the stored name
    // verbatim, because that is the name it will save.
    name: 'duplicating into Finnish writes Finnish names, not catalog English',
    run() {
      const draft = buildDuplicatedCustomProgramDraft(
        'Rintavoima',
        [
          { id: 'd1', name: 'Day 1: Upper (Heavy)', orderIndex: 0, exercises: [] },
          { id: 'd4', name: 'Day 4: Lower (Growth)', orderIndex: 1, exercises: [] },
        ],
        [],
        'fi',
      );

      assert.equal(draft.name, 'Rintavoima');
      assert.equal(draft.sessions[0].name, 'Päivä 1: Ylävartalo (raskas)');
      assert.equal(draft.sessions[1].name, 'Päivä 4: Alavartalo (kasvu)');

      // English stays English — the language decides, not the presence of a
      // dictionary entry.
      const en = buildDuplicatedCustomProgramDraft(
        'Chest Power',
        [{ id: 'd1', name: 'Day 1: Upper (Heavy)', orderIndex: 0, exercises: [] }],
        [],
        'en',
      );
      assert.equal(en.sessions[0].name, 'Day 1: Upper (Heavy)');

      // And when the fallback does fire, the suffix is the reader's language.
      const clash = buildDuplicatedCustomProgramDraft('Rintavoima', [], ['Rintavoima'], 'fi');
      assert.equal(clash.name, 'Rintavoima (kopio)');
    },
  },
  {
    /**
     * There is no "duplicate this programme" action, and there was never
     * meant to be one (user 2026-09-08). The idea was only ever that editing
     * a programme you were given must not touch the original — so the app
     * makes you your own copy, silently, and the catalog keeps its own.
     *
     * A handler for a real duplicate existed anyway, threaded through three
     * files and called from nowhere, quietly adding "(kopio)" if anything had
     * ever reached it. It is gone. This guard is what stops it coming back by
     * accident, because nothing on screen would have shown it was there.
     */
    name: 'nothing offers to duplicate a programme',
    run() {
      // The whole shell, not a hand list of its files: phase B (2026-09-30)
      // moves VinhaApp's handlers into src/app modules one by one, and the
      // copy-on-edit fork is among them. Asserted present first, so the
      // absence below is read over the code that copies a programme and over
      // the workout tab, wherever they sit.
      const shell = readAppWiring().replace(/\r\n/g, '\n');
      assert.match(shell, /const draft = buildDuplicatedCustomProgramDraft\(/);
      assert.match(shell, /export function renderWorkoutTab\(/);
      for (const [file, source] of [
        ['App.tsx and src/app', shell],
        ['src/screens/WorkoutsScreen.tsx', read('src/screens/WorkoutsScreen.tsx')],
      ]) {
        assert.doesNotMatch(source, /handleDuplicateCustomProgram|DuplicateCustomWorkout/, file);
      }
      // And the one caller left asks for no naming option at all: keeping the
      // name is the rule now, not a flag one call site happens to pass.
      const lib = read('src/lib/customProgramDuplication.ts');
      assert.doesNotMatch(lib, /keepName|DuplicateNamingOptions/);
      assert.match(lib, /name: taken \? buildDisplayCopyName\(name, language, existingNames\) : name,/);
      // The toast only that handler raised went with it.
      assert.doesNotMatch(read('src/lib/i18n.ts'), /workoutDuplicateFailed/);
    },
  },
];
