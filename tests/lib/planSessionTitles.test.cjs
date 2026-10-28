const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  disambiguateSessionTitles,
  planSessionTitles,
} = require('../../src/lib/sessionNameLabel');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const app = (name) => ({ name, readerNamed: false });
const typed = (name) => ({ name, readerNamed: true });

module.exports = [
  {
    name: 'plan session titles: the Today sheet case — no "Päivä N:", repeats get A and B, the rest stay bare',
    run() {
      const sessions = [app('Day 1: Full Body'), app('Day 2: Full Body'), app('Recovery + Mobility Day')];
      assert.deepEqual(planSessionTitles(sessions, 'HOME Starter', 'fi'), [
        'Koko keho A',
        'Koko keho B',
        'Palautuminen ja liikkuvuus',
      ]);
      assert.deepEqual(planSessionTitles(sessions, 'HOME Starter', 'en'), [
        'Full Body A',
        'Full Body B',
        'Recovery + Mobility Day',
      ]);
    },
  },
  {
    name: 'plan session titles: names that differ are never touched, and the Finnish stored prefix goes too',
    run() {
      assert.deepEqual(
        planSessionTitles([app('Day 1: Upper'), app('Päivä 2: Lower'), app('Day 3: Push')], 'Plan', 'fi'),
        ['Ylävartalo', 'Alavartalo', 'Työntö'],
      );
    },
  },
  {
    name: 'plan session titles: a placeholder-only name follows formatPlanSessionTitle (numbered by position)',
    run() {
      assert.deepEqual(planSessionTitles([app('Day 1: Upper'), app('Day 3')], 'Plan', 'fi'), [
        'Ylävartalo',
        'Treeni 2',
      ]);
      // Two placeholders are numbered by place, so they never collide.
      assert.deepEqual(planSessionTitles([app('Day 1'), app('Day 1')], 'Plan', 'en'), ['Workout 1', 'Workout 2']);
    },
  },
  {
    name: 'disambiguate: three or more get A, B, C in list order; two separate pairs each get their own letters',
    run() {
      assert.deepEqual(disambiguateSessionTitles(['Legs', 'Legs', 'Legs']), ['Legs A', 'Legs B', 'Legs C']);
      assert.deepEqual(disambiguateSessionTitles(['Legs', 'Push', 'Legs', 'Pull', 'Push']), [
        'Legs A',
        'Push A',
        'Legs B',
        'Pull',
        'Push B',
      ]);
      assert.deepEqual(disambiguateSessionTitles([]), []);
      assert.deepEqual(disambiguateSessionTitles(['Legs']), ['Legs']);
    },
  },
  {
    name: 'disambiguate: case and spacing do not hide a collision, and a letter already in the list is skipped',
    run() {
      assert.deepEqual(disambiguateSessionTitles(['Koko keho', 'koko  keho']), ['Koko keho A', 'koko  keho B']);
      assert.deepEqual(disambiguateSessionTitles(['Koko keho', 'Koko keho', 'Koko keho A']), [
        'Koko keho B',
        'Koko keho C',
        'Koko keho A',
      ]);
      // More than 26 repeats still get distinct suffixes.
      const many = disambiguateSessionTitles(Array.from({ length: 28 }, () => 'X'));
      assert.equal(new Set(many).size, 28);
      assert.equal(many[26], 'X AA');
    },
  },
  {
    name: 'disambiguate: a reader-typed name keeps exactly what was typed and collides only with other typed names',
    run() {
      // Typed twice: told apart. Typed once next to the app's own wording: bare.
      assert.deepEqual(planSessionTitles([typed('Jalat'), typed('Jalat')], 'Plan', 'fi'), ['Jalat A', 'Jalat B']);
      assert.deepEqual(
        planSessionTitles([typed('Koko keho'), app('Day 2: Full Body'), app('Day 3: Full Body')], 'Plan', 'fi'),
        ['Koko keho', 'Koko keho A', 'Koko keho B'],
      );
      assert.deepEqual(planSessionTitles([typed('Koko keho'), app('Day 2: Full Body')], 'Plan', 'fi'), [
        'Koko keho',
        'Koko keho',
      ]);
      // Placeholder-shaped, but theirs: not rewritten, not numbered.
      assert.deepEqual(planSessionTitles([typed('Päivä 2'), app('Day 2: Upper')], 'Plan', 'fi'), [
        'Päivä 2',
        'Ylävartalo',
      ]);
    },
  },
  {
    name: 'Home Today sheet: titles come from planSessionTitles, the meta line is the app face, and the tag shares the title line',
    run() {
      const home = read('src', 'screens', 'HomeScreen.tsx');
      const sheet = home.slice(home.indexOf("title={t(language, 'home.today.title')}"));
      assert.match(home, /planSessionTitles as planSessionTitlesFor/);
      assert.match(sheet, /title=\{planSessionTitles\[sessionIndex\] \?\?/);
      assert.match(sheet, /metaFont="app"/);
      // The bar names the same row the list does.
      assert.match(sheet, /to=\{planSessionTitles\[planSessions\.findIndex/);
      assert.doesNotMatch(sheet.slice(0, sheet.indexOf('</KitSheet>')), /title=\{localizeSessionName\(session\.title, language\)\}/);

      const dashboard = read('src', 'app', 'renderHomeDashboard.tsx');
      assert.match(dashboard, /readerSessionNames=\{preferences\.readerSessionNames\}/);

      const kit = read('src', 'components', 'sheetKit.tsx');
      // The mono face stays the kit's default; the app face has no fontFamily.
      assert.match(kit, /metaFont = 'mono'/);
      const appMeta = kit.match(/rowMetaApp: \{([^}]*)\}/);
      assert.ok(appMeta, 'rowMetaApp style exists');
      assert.doesNotMatch(appMeta[1], /fontFamily/);
      // The chip is on the name's line, so it cannot take width from the meta line.
      assert.match(kit, /<View style=\{styles\.rowTitleLine\}>[\s\S]*?styles\.tag[\s\S]*?<\/View>\s*\{meta \? \(/);
    },
  },
  {
    name: 'programme page and day page list the same titles',
    run() {
      const detail = read('src', 'screens', 'ProgramDetailScreen.tsx');
      assert.match(detail, /dayTitles\[index\]/);
      const tab = read('src', 'app', 'renderWorkoutTab.tsx');
      assert.match(tab, /dayTitle=\{\s*planSessionTitles\(/);
      const day = read('src', 'screens', 'ProgramDayScreen.tsx');
      assert.match(day, /dayTitleFromList \?\? formatPlanSessionTitle\(/);
    },
  },
];
