const assert = require('node:assert/strict');

const { exerciseListLabel, exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const library = Object.values(require('../../.test-dist/data/generatedExerciseLibrary.js'))[0];

// "Pitää keksiä joku sääntö tähän että nimet ei kasva niin pitkiksi"
// (#bugs 2026-09-27) — abbreviations, the user's choice.

module.exports = [
  {
    // "Vinopenkk / ipunnerrus" on a swap card (#bugs 2026-10-08): a card's
    // name breaks on its syllables, and only where the line has to break.
    name: 'exercise card label: the list label with soft hyphens at its syllables, Finnish only',
    run() {
      const { exerciseCardLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
      const SOFT = '­';
      const card = exerciseCardLabel('fi', 'Smith Machine Incline Bench Press');
      assert.equal(card.split(SOFT).join(''), exerciseListLabel('fi', 'Smith Machine Incline Bench Press'));
      assert.equal(card.split(SOFT).join('-'), 'Vi-no-penk-ki-pun-ner-rus Smit-his-sä');
      assert.equal(exerciseCardLabel('en', 'Smith Machine Incline Bench Press'), exerciseListLabel('en', 'Smith Machine Incline Bench Press'));
      const fs = require('node:fs');
      const path = require('node:path');
      const browser = fs.readFileSync(path.join(__dirname, '../../src/components/ExerciseLibraryBrowser.tsx'), 'utf8');
      assert.match(browser, /android_hyphenationFrequency="normal"\s*>\s*\{exerciseCardLabel\(language, item\.name\)\}/);
    },
  },
  {
    name: 'list names use the gym\'s short forms for the equipment words',
    run() {
      assert.equal(exerciseListLabel('fi', 'Incline Dumbbell Press'), 'Vinopenkkipunnerrus KP');
      assert.equal(exerciseListLabel('fi', 'Smith Machine Bench Press'), 'Penkkipunnerrus Smithissä');
      const kettlebell = library.find((item) => /kahvakuulalla$/.test(exerciseNameLabel('fi', item.name)));
      assert.ok(kettlebell, 'no kettlebell name to test with');
      assert.match(exerciseListLabel('fi', kettlebell.name), / KK$/);
    },
  },
  {
    name: 'only whole words shorten, and English and plain names pass through',
    run() {
      // A word that merely contains the equipment keeps its name.
      const row = library.find((item) => /^Käsipainosoutu/.test(exerciseNameLabel('fi', item.name)));
      assert.ok(row);
      assert.equal(exerciseListLabel('fi', row.name), exerciseNameLabel('fi', row.name));
      assert.equal(exerciseListLabel('en', 'Incline Dumbbell Press'), exerciseNameLabel('en', 'Incline Dumbbell Press'));
      assert.equal(exerciseListLabel('fi', 'Bench Press'), 'Penkkipunnerrus');
    },
  },
  {
    name: 'the short forms take the long names down, and never make one longer',
    run() {
      const labels = [...new Set(library.map((item) => item.name))];
      const over30 = (fn) => labels.filter((name) => fn('fi', name).length > 30).length;
      assert.ok(over30(exerciseListLabel) < over30(exerciseNameLabel) - 40, `${over30(exerciseListLabel)} vs ${over30(exerciseNameLabel)}`);
      for (const name of labels) {
        assert.ok(exerciseListLabel('fi', name).length <= exerciseNameLabel('fi', name).length, name);
      }
    },
  },
  {
    name: 'rows show the short name and read the full one; sentences keep the full name',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
      // A swap row shows "KP" and a screen reader says "käsipainoilla". Every
      // swap draws the add sheet's cards since 2026-10-07, checked below.
      for (const file of ['src/screens/HomeScreen.tsx', 'src/screens/ProgramDayScreen.tsx']) {
        assert.match(read(file), /<ExercisePickerSheet[\s\S]{0,200}mode="swap"/, file);
      }
      // The swap sheet is the add sheet's cards now (#bugs 2026-10-06), and
      // the card still carries both names.
      assert.match(
        read('src/components/AddExerciseSheet.tsx'),
        /accessibilityLabel=\{exerciseNameLabel\(language, name\)\}\s*android_hyphenationFrequency="normal"\s*>\s*\{exerciseCardLabel\(language, name\)\}/,
      );
      // Every text that prints the short form tells a screen reader the full
      // name — "K P" is what TalkBack would say (review, 2026-09-27).
      const missing = [];
      for (const dir of ['src/screens', 'src/components']) {
        for (const file of fs.readdirSync(path.join(__dirname, '..', '..', dir)).filter((name) => name.endsWith('.tsx'))) {
          const source = read(`${dir}/${file}`);
          const shown = /<Text\b((?:(?!<Text\b)[\s\S])*?)>\s*\{exercise(?:List|Card)Label\(/g;
          let match;
          while ((match = shown.exec(source))) {
            if (!/accessibilityLabel=/.test(match[1])) {
              missing.push(`${dir}/${file}:${source.slice(0, match.index).split('\n').length}`);
            }
          }
        }
      }
      assert.deepEqual(missing, []);
      // A short name passed as a prop has to bring its full name along: the
      // swap bar's from/to (review, 2026-09-27).
      for (const file of ['src/screens/HomeScreen.tsx', 'src/screens/ProgramDayScreen.tsx']) {
        const source = read(file);
        for (const side of ['from', 'to']) {
          if (new RegExp(`\\b${side}=\\{[^\\n]*exerciseListLabel\\(`).test(source)) {
            assert.match(source, new RegExp(`\\b${side}Label=\\{[^\\n]*exerciseNameLabel\\(`), `${file}: ${side}`);
          }
        }
      }
      // A nested Text is flattened into its parent: the label goes on the
      // outer one, where a screen reader reads it.
      const player = read('src/screens/GuidedPlayerScreen.tsx');
      const flow = player.slice(player.indexOf('style={styles.setSupersetFlow}'), player.indexOf("t(language, 'guided.superset.thenRest')"));
      assert.match(flow, /accessibilityLabel=\{\[/);
      // Domain logic writes sentences, the coach's context and search: none of
      // it may use the short form.
      const libDir = path.join(__dirname, '..', '..', 'src', 'lib');
      const users = fs
        .readdirSync(libDir)
        .filter((file) => file.endsWith('.ts') && file !== 'exerciseNameLabel.ts')
        .filter((file) => fs.readFileSync(path.join(libDir, file), 'utf8').includes('exerciseListLabel('));
      assert.deepEqual(users, []);
    },
  },
  {
    name: 'what a row prints finds what it stands for',
    run() {
      const { buildExerciseSearchHaystack, exerciseMatchesQuery } = require('../../.test-dist/lib/exerciseSearch.js');
      const found = (query) =>
        library
          .filter((item) => exerciseMatchesQuery(buildExerciseSearchHaystack(item, 'fi'), query))
          .map((item) => exerciseListLabel('fi', item.name));
      assert.ok(found('penkkipunnerrus smithissä').includes('Penkkipunnerrus Smithissä'));
      assert.ok(found('kyykky kk').some((label) => / KK$/.test(label)));
      assert.ok(found('vinopenkkipunnerrus kp').includes('Vinopenkkipunnerrus KP'));
      // A chin-up is 'Leuanveto alaotteella'; the gym word for the grip finds it too.
      assert.ok(found('leuanveto vastaote').includes('Leuanveto alaotteella'));
    },
  },
];
