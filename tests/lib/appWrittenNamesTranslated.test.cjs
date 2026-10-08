const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { localizeSessionName, localizeSessionFocus } = require('../../.test-dist/lib/sessionNameLabel.js');
const { formatHomeSessionTitle } = require('../../.test-dist/app/homeSessionTitle.js');
const { bodyPartLabel } = require('../../.test-dist/lib/i18n.js');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between } = require('../helpers/sourceSlices.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** English words that must not survive into a Finnish name. */
const ENGLISH = /\b(day|add-on|focus|recovery|mobility|conditioning|strength|accessory|easy|long|run|volume|bodyweight|lower|posterior|push|pull|full|body|other)\b/i;

/**
 * Text the app writes itself, in English, that reached a Finnish reader
 * (bug hunt 2026-09-14). Unlike catalogue names, nothing listed these — so the
 * names are read out of the source that writes them, and a new one fails here
 * until it is translated.
 */
module.exports = [
  {
    name: 'appWrittenNames: the days onboarding appends are named in Finnish',
    run() {
      const source = read('src', 'lib', 'recommendationProgramme.ts');
      const builder = source.slice(source.indexOf('const SUPPLEMENTAL_DAYS'), source.indexOf('function buildPlanReadyWeeklySchedule('));
      const names = [...builder.matchAll(/'([A-Z][A-Za-z +-]*(?:Day|Add-On))'/g)].map((match) => match[1]);
      assert.equal(names.length, 8, `expected the eight supplemental day names, found ${names.join(', ')}`);
      for (const name of names) {
        const fi = localizeSessionName(name, 'fi');
        assert.doesNotMatch(fi, ENGLISH, `"${name}" reads "${fi}" in Finnish`);
        // The day strip and the hero read the focus alone.
        assert.doesNotMatch(localizeSessionFocus(name, 'fi'), ENGLISH, `"${name}" focus`);
        // English is left alone.
        assert.equal(localizeSessionName(name, 'en'), name);
      }
    },
  },
  {
    name: 'appWrittenNames: Home titles a "Day 2" session by its lift, in Finnish',
    run() {
      const source = read('src', 'app', 'homeSessionTitle.ts');
      const focusNames = [...source.matchAll(/return '([A-Za-z ]+ Focus)'/g)].map((match) => match[1]);
      assert.equal(focusNames.length, 6, `expected six focus titles, found ${focusNames.join(', ')}`);
      for (const name of focusNames) {
        assert.doesNotMatch(localizeSessionFocus(name, 'fi'), ENGLISH, `"${name}"`);
      }
      // End to end: an untouched "Day 2" opening on a squat.
      const title = formatHomeSessionTitle('Day 2', [{ name: 'Back Squat' }]);
      assert.equal(title, 'Lower Focus');
      assert.equal(localizeSessionFocus(title, 'fi'), 'Alavartalo');
    },
  },
  {
    // Caught by the PR review: once the builder names new days "Päivä N", every
    // detector that knew only "day" let the Finnish default through — the plan
    // list read "Päivä 1. Päivä 1" and Home's week strip "PÄI", "PÄI", "PÄI".
    name: 'appWrittenNames: a Finnish default day name is still recognised as a placeholder',
    run() {
      const { formatPlanSessionTitle } = require('../../.test-dist/lib/sessionNameLabel.js');
      // Placeholders read "Treeni N" on the day list since 2026-09-24 — the
      // word "Päivä" was taken off it — but they are still placeholders, not
      // names: "Päivä 1. Päivä 1" must not come back in any form.
      assert.equal(formatPlanSessionTitle({ name: 'Päivä 1' }, 0, 'Oma ohjelma', 'fi'), 'Treeni 1');
      assert.equal(formatPlanSessionTitle({ name: 'Päivä 1' }, 2, 'Oma ohjelma', 'fi'), 'Treeni 3', 'the number is the position');
      assert.equal(formatPlanSessionTitle({ name: 'Day 1' }, 0, 'Oma ohjelma', 'fi'), 'Treeni 1');

      assert.equal(formatHomeSessionTitle('Päivä 2', [{ name: 'Back Squat' }]), 'Lower Focus');
      assert.equal(localizeSessionName('Päivä 3', 'fi'), 'Päivä 3');
      // A word that merely starts with "päivä" is a name, not a placeholder.
      assert.equal(formatHomeSessionTitle('Päiväkirja', [{ name: 'Back Squat' }]), 'Päiväkirja');
    },
  },
  {
    name: 'appWrittenNames: the workout summary buckets unknown lifts as "Muut"',
    run() {
      assert.equal(bodyPartLabel('fi', 'Other'), 'Muut');
      assert.equal(bodyPartLabel('en', 'Other'), 'Other');
      // The bucket the summary writes is still spelled the way the label map expects.
      assert.match(read('src', 'lib', 'workoutCompleteView.ts'), /\?\? 'Other'/);
    },
  },
  {
    name: 'appWrittenNames: a new programme and History write no English defaults',
    run() {
      const builder = read('src', 'screens', 'CreateTemplateScreen.tsx');
      assert.doesNotMatch(builder, /'New template'/, 'a blank programme name is saved in the reader\'s language');
      assert.doesNotMatch(builder, /`Day \$\{index \+ 1\}`/, 'a blank day name uses tpl.dayWord');
      assert.match(builder, /name: name\.trim\(\) \|\| t\(language, 'tpl\.namePlaceholder'\)/);

      // The whole shell, App.tsx and src/app, so the draft is found wherever
      // the split puts it; bounded at its own deps line, not at the early
      // return it no longer has to sit above.
      const draft = between(
        readAppWiring(),
        'const templateBuilderDraft = useMemo',
        '}, [getWorkoutTemplateSessions, preferences.appLanguage, route, workoutTemplates]);',
      );
      assert.ok(draft.length > 200, 'templateBuilderDraft moved — recheck by hand');
      assert.doesNotMatch(draft, /'Day [123]'/, 'the builder\'s starting days are named in the reader\'s language');
      assert.match(draft, /t\(preferences\.appLanguage, 'tpl\.dayWord'\)/);

      const history = read('src', 'screens', 'HistoryScreen.tsx');
      assert.doesNotMatch(history, /\{activity\.name\}/, 'the cardio row reads the translated activity name');
      assert.match(history, /t\(language, `cardio\.activity\.\$\{session\.activityType\}`/);
    },
  },
];
