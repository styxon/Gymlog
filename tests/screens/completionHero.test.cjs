const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const screenSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'WorkoutCompletionScreen.tsx'),
  'utf8',
);
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');
const kitSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'sheetKit.tsx'),
  'utf8',
);

/**
 * The workout-complete hero, in gold. Design: "GAINER Treeni valmis - hero".
 *
 * It was the app's own purple, which is the colour of every other screen — so
 * the one screen that exists to say "you did it" said it in the same voice as a
 * settings row.
 */
module.exports = [
  {
    name: 'completion hero: a record earns gold, a quiet session only borrows it',
    run() {
      // Two strengths of one colour, chosen by whether there is a record. If
      // every workout celebrated equally, the record card under the hero would
      // stop being seen.
      assert.match(screenSource, /function goldHeroFace\(dark: boolean, record: boolean\)/);
      assert.match(screenSource, /goldHeroFace\(themeName === 'dark', pr !== null\)/);
      // The metal sweep is the record's alone.
      assert.match(screenSource, /gold\.sheenPeak > 0 \? \(/);
      // And the quiet seal is a ring with nothing behind it.
      assert.match(screenSource, /sealFill: 'transparent'/);
    },
  },
  {
    name: 'completion hero: all four faces are defined, not derived at render',
    run() {
      // dark+record, dark, light+record, light — each returns its own object,
      // because a gold that reads on cream does not read on near-black.
      const faces = screenSource.split('groundAngle:').length - 1;
      assert.equal(faces, 4, 'expected exactly four hero faces');
    },
  },
  {
    name: 'completion hero: the status bar is no longer forced light',
    run() {
      // A pale gold bar needs dark icons, and the shell already derives that
      // from the theme — so the summary comes off the forced-light list.
      // Over the whole shell, App.tsx and its src/app modules (phase-B split,
      // 2026-09-30): the bar's style must not force it from a hook either.
      assert.doesNotMatch(readAppWiring(), /workoutSummaryActive[\s\S]{0,40}\? 'light'/);
      // The saved-session hero still is, and the Pro page joined it: both are
      // dark surfaces the bar sits directly on. Matched on the list rather
      // than on one exact expression, so adding a screen to it is not a
      // failure — dropping the saved session off it is. The bar's style moved
      // with the shell's render tail into src/app (phase C).
      assert.match(readAppWiring(), /historySessionActive \|\| premiumActive[\s\S]{0,30}\? 'light'/);
    },
  },
  {
    name: 'completion hero: the kicker reads in both languages',
    run() {
      for (const key of ['complete.kicker.record', 'complete.kicker.done']) {
        const occurrences = i18nSource.split(`'${key}':`).length - 1;
        assert.equal(occurrences, 2, `${key} is missing one of its two languages`);
      }
      assert.match(screenSource, /pr \? 'complete\.kicker\.record' : 'complete\.kicker\.done'/);
    },
  },
  {
    /**
     * The feel sheet cannot be skipped by missing it — and can be left.
     *
     * The backdrop called onDone(null) — byte for byte the write Skip makes,
     * with none of the intent behind it. One answer per workout, thrown away
     * by a thumb landing beside the sheet (user 2026-09-01). The fix for that
     * refused instead, with a shake, and that went too far the other way: a
     * Done pressed by accident had no way back to the summary, only four
     * answers and Skip (#bugs 2026-09-24).
     *
     * So the sheet has two kinds of exit and they must not be confused.
     * Answering and Skip write, and leave the screen. The ✕, the backdrop and
     * Android's back write nothing and leave the summary where it was.
     */
    name: 'complete: the feel sheet closes without writing, and only Skip skips',
    run() {
      // Exactly one handler writes the skip, and it is the Skip button.
      // Matched as a HANDLER rather than as the bare call: the comment above
      // the sheet quotes `onDone(null)` to say what the backdrop stopped
      // doing, and a substring count read that as a second caller.
      const skipHandlers = screenSource.match(/onPress=\{\(\) => onDone\(null\)\}/g) ?? [];
      assert.equal(skipHandlers.length, 1, 'something besides Skip throws the answer away');
      const handlerAt = screenSource.indexOf('onPress={() => onDone(null)}');
      const skipStyleAt = screenSource.indexOf('styles.feelSkip');
      assert.ok(handlerAt > 0 && skipStyleAt > handlerAt, 'the surviving skip is not the Skip button');

      // The sheet is the kit's, anchored on its own title so this reads the
      // feel sheet and not whichever KitSheet comes first.
      const titleAt = screenSource.indexOf("title={t(language, 'complete.feel.title')}");
      assert.ok(titleAt > 0, 'the feel sheet was restructured — recheck by hand');
      const openAt = screenSource.lastIndexOf('<KitSheet', titleAt);
      const closeAt = screenSource.indexOf('</KitSheet>', titleAt);
      assert.ok(openAt > 0 && closeAt > titleAt, 'the feel sheet is no longer a KitSheet');
      const sheet = screenSource.slice(openAt, closeAt);

      // Its close hides the sheet and does nothing else: the ✕, the scrim and
      // the back key all route through this one prop in the kit.
      assert.match(sheet, /onClose=\{\(\) => setFeelSheetVisible\(false\)\}/, 'closing does more than close');
      assert.match(sheet, /closeLabel=\{t\(language, 'common\.close'\)\}/);
      assert.match(sheet, /bottomInset=\{insets\.bottom\}/, 'the inset must be read on the screen — 0 inside a Modal');
      // The four answers and Skip live inside it.
      assert.match(sheet, /SESSION_FEEL_SCALE\.map/);
      assert.ok(sheet.includes('onPress={() => onDone(null)}'), 'Skip left the sheet');

      // And the kit really does give all three exits to onClose. Back is the
      // Modal's onRequestClose; without it Android's back would fall through
      // to the route handler, which leaves the summary altogether.
      assert.match(kitSource, /onRequestClose=\{onClose\}/);
      assert.match(kitSource, /style=\{styles\.scrim\}\s*onPress=\{onClose\}/);
      assert.match(kitSource, /<SheetCloseButton label=\{closeLabel\} onPress=\{onClose\} \/>/);
      assert.match(kitSource, /accessibilityLabel=\{label\}\s*onPress=\{onPress\}/);

      // Skip is still there, still one tap.
      assert.match(i18nSource, /'complete\.feel\.skip':/);
    },
  },
];
