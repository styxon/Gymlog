const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

/**
 * The screen a reader meets when they try to put a lift back into a programme.
 *
 * "Tosi sekava sivu... mitään liikkeitä ei voi lisätä kun nappi häviää alas,
 * +ikoni muutenkin sotkee värit aivan pieleen" (#bugs 2026-08-26). Two causes,
 * both structural rather than matters of taste.
 */
module.exports = [
  {
    name: 'add-exercise sheet: the confirm button clears the phone buttons',
    run() {
      const sheet = read('src/components/AddExerciseSheet.tsx');
      /**
       * The bar's height comes IN as a prop; it cannot be read here.
       *
       * This guard used to pin `insets.bottom + spacing.lg` inside the sheet,
       * which is what shipped on 26.8 — and the button was still half under
       * the system buttons two days later (#bugs 2026-08-28). A Modal is its
       * own native window, and inside one this app gets zero for the bottom
       * inset from the root provider, from a provider added inside the modal,
       * and from `initialWindowMetrics` alike; all three were tried on the
       * emulator with three-button navigation. The screen that opens the sheet
       * is outside the modal, where the same hook is right.
       */
      assert.match(sheet, /bottomInset\?: number;/);
      assert.match(sheet, /styles\.footer, \{ paddingBottom: bottomInset \+ spacing\.lg \}/);
      assert.ok(
        !/useSafeAreaInsets/.test(sheet),
        'reading the inset inside the modal is the bug this guard exists for',
      );
      // And every screen that opens one hands the number over.
      for (const screen of [
        'src/screens/ProgramDayScreen.tsx',
        'src/screens/CreateTemplateScreen.tsx',
        // The free workout drew its own copy of this sheet until #bugs
        // 2026-10-10; it opens this one now and hands the inset over too.
        'src/screens/EmptyWorkoutScreen.tsx',
      ]) {
        assert.match(read(screen), /bottomInset=\{\w+\.bottom\}/, `${screen} should pass the inset`);
      }
    },
  },
  {
    name: 'add-exercise sheet: it is painted in tokens, so the dark theme reaches it',
    run() {
      const sheet = read('src/components/AddExerciseSheet.tsx');
      // It was built before the theme engine and never migrated: selected
      // filters, chips and cards were hardcoded #22C55E on #E8F6EC. Off-brand in
      // an app whose language is "orange = pressable, purple = brand", and
      // literals ignore the dark theme entirely — on dark it drew near-white
      // pills.
      for (const literal of ['#22C55E', '#E8F6EC', '#F8FFFA', '#D1D5DB']) {
        assert.ok(!sheet.includes(literal), `${literal} is a literal that cannot follow the theme`);
      }
      // Everything is a token. White on a purple fill was the one literal the
      // cards kept; the rows have no purple fill (menu redesign, 2026-10-24).
      const literals = sheet.match(/'#[0-9A-Fa-f]{6}'/g) ?? [];
      assert.deepEqual([...new Set(literals)], []);
    },
  },
  {
    name: 'add-exercise sheet: lifts are one column of rows, popular ones too',
    run() {
      const sheet = read('src/components/AddExerciseSheet.tsx');

      // The two-column cards fitted two lifts to a screen and broke long
      // names mid-word ("4 korttia näkyy samaan aikaan todella kapeasti",
      // user 2026-08-26; "Kilpapenkkipunner-rus"). Since the menu redesign
      // (2026-10-24) every lift is a row the sheet's full width: no grid, no
      // two-per-row basis left behind for the next card to inherit.
      assert.doesNotMatch(sheet, /numColumns=/);
      assert.doesNotMatch(sheet, /flexBasis: '4\d%'/);
      assert.match(sheet, /featuredEntries\.map\(\(entry, index\) => \(\s*<ExerciseRow/);
      assert.match(sheet, /renderItem=\{\(\{ item: entry, index \}\) => \(\s*<ExerciseRow/);
    },
  },
  {
    /**
     * The circle keeps its colour and changes its job.
     *
     * It was a "+" that dropped the lift straight into a workout from a row
     * that is a name and three words — adding blind — and it came out
     * entirely (#38). It is back as an eye that opens the exercise, which is
     * what the library is for (user 2026-08-31).
     */
    name: 'library browser: the circle is an eye, in the app\'s own pressable colour',
    run() {
      const browser = read('src/components/ExerciseLibraryBrowser.tsx');
      // A green circle in a purple-and-orange app was the loudest wrong note on
      // the page. Orange is the app's "you can press this".
      assert.doesNotMatch(browser, /lookButton: \{[\s\S]{0,200}theme\.green\b/);
      assert.match(browser, /backgroundColor: theme\.highlight/);
      // And the glyph takes the ink that orange was paired with, not white.
      assert.match(browser, /<VinhaIcon name="eye" color=\{theme\.onHighlight\} size=\{17\} \/>/);
      // The SHARED eye. This file kept a local almond with a filled pupil next
      // to the icon set's stroked one, in a file that already imports
      // VinhaIcon for the body-part glyphs — flagged by the PR review on #40
      // against CLAUDE.md's "use existing shared components before adding new
      // styling". The eye this card IS should be the eye the app draws.
      assert.doesNotMatch(browser, /function EyeIcon/);

      // It opens; it does not add. The prop that carried "add to workout" is
      // gone from the browser and from the screen that wraps it, so there is
      // nothing left to wire it back to by accident.
      assert.doesNotMatch(browser, /onAddToWorkout/);
      assert.doesNotMatch(browser, /PlusIcon/);
      assert.doesNotMatch(read('src/screens/ExercisesScreen.tsx'), /onAddToWorkout/);
      assert.match(browser, /library\.a11y\.look/);

      // And it renders only when it has somewhere to go. A filled accent
      // circle that ignores the tap reads as broken rather than as absent —
      // the rule #38 established, and the one this change nearly undid by
      // putting the circle back unconditionally.
      assert.match(browser, /\{onOpen \? \(\s*\r?\n\s*<LookButton/);
      // Both call sites, not "at least one": the rail and the list each pass
      // onOpen, and asserting a single match lets one of them regress while
      // the other keeps the test green.
      assert.equal(
        (browser.match(/onOpen=\{onOpenItem \? \(\) => handleOpen\(item\) : undefined\}/g) ?? []).length,
        2,
        'both the rail card and the list row must withhold onOpen when the browser has nowhere to send it',
      );
      assert.doesNotMatch(browser, /onOpen=\{\(\) => handleOpen\(item\)\}/);
    },
  },
  {
    /**
     * A filter you picked by accident comes off the way you put it on.
     *
     * Every row has an "All" chip, so there was always a way back — but the
     * gesture a reader reaches for is tapping the lit chip again, and that set
     * the value it already held. Nothing moved, so the filter read as stuck
     * (user 2026-09-01, screenshot: two chips lit, badge showing 2).
     *
     * All three rows, not one: the body-part rail, TYPE and EQUIPMENT are the
     * same control three times, and fixing the two inside the sheet while
     * leaving the rail on top would be the harder half to notice.
     */
    name: 'library browser: tapping the chosen filter chip clears it',
    run() {
      const browser = read('src/components/ExerciseLibraryBrowser.tsx');

      // The rule itself: back to 'all', which IS the cleared state here —
      // every read is `!== 'all'`, so a null would have to be taught to all
      // three.
      assert.match(browser, /function toggleFilter<T extends string>\(current: T, option: T\): T \| 'all' \{/);
      assert.match(
        browser,
        /return current === option \? 'all' : option;/,
        'the chips no longer clear themselves',
      );

      // All three rows route through it, and none sets a raw option any more.
      const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const setter of ['setBodyPartFilter', 'setCategoryFilter', 'setEquipmentFilter']) {
        const filterName = setter.slice(3, 4).toLowerCase() + setter.slice(4);
        assert.match(
          browser,
          new RegExp(esc(`onPress={() => ${setter}(toggleFilter(${filterName}, option))}`)),
          `${setter} still sets the option without toggling`,
        );
        assert.doesNotMatch(
          browser,
          new RegExp(esc(`onPress={() => ${setter}(option)}`)),
          `${setter} can still be set without a way off`,
        );
      }

      // And 'all' stays the first chip in every row, so the explicit reset is
      // still there for anyone who does not try the toggle. The rows are the
      // pickers' shared chip lists now (2026-10-06), each opening on 'all'.
      for (const list of ['BODY_PART_FILTERS', 'EXERCISE_TYPE_FILTERS', 'EQUIPMENT_FILTERS']) {
        assert.match(browser, new RegExp(`Options = ${list};`), list);
      }
      const browse = require('../../.test-dist/lib/exerciseBrowseFilter.js');
      for (const list of [browse.BODY_PART_FILTERS, browse.EXERCISE_TYPE_FILTERS, browse.EQUIPMENT_FILTERS]) {
        assert.equal(list[0], 'all');
      }
    },
  },
];
