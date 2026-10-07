const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * "Miltä treeni tuntui?" — one question on the way out of the finish screen
 * (user 2026-08-23), written onto the already-saved session.
 *
 * Source-level where the code talks to AsyncStorage or renders; the guards
 * pin the chain: Done opens the ask → the answer reaches
 * updateCompletedWorkoutSession → the stored value survives normalization.
 */

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const completionSource = read('src/screens/WorkoutCompletionScreen.tsx');
const historySource = read('src/screens/HistoryScreen.tsx');
// The whole shell: the finish screen's render moved from App.tsx to
// src/app/renderWorkoutCompletion.tsx (phase C, 2026-10-01).
const appSource = readAppWiring();
const databaseSource = read('src/storage/database.ts');
const modelsSource = read('src/types/models.ts');
const i18nSource = read('src/lib/i18n.ts');

const {
  SESSION_FEEL_SCALE,
  SESSION_FEEL_LABEL_KEY,
  SESSION_FEEL_WINDOW,
  summariseSessionFeel,
} = require('../../.test-dist/lib/sessionFeel');

const s = (feel) => ({ feel });

module.exports = [
  {
    name: 'session feel: Done asks, four colour-coded answers, skip costs one tap',
    run() {
      // The CTA opens the ask instead of leaving directly.
      assert.match(completionSource, /onPress=\{\(\) => setFeelSheetVisible\(true\)\}/);
      // The four verdicts come from the shared scale rather than a second
      // hand-written list, so the sheet that collects the answer and the
      // history that reads it back cannot drift apart. The scale's own
      // contents are asserted below, against the module.
      assert.match(completionSource, /SESSION_FEEL_SCALE\.map\(\(feel\) =>/);
      assert.match(completionSource, /SESSION_FEEL_LABEL_KEY\[feel\]/);
      assert.match(completionSource, /sessionFeelColor\(theme, feel\)/);
      // Each answer leaves, and skipping costs one tap.
      assert.match(completionSource, /onDone\(feel\)/);
      assert.match(completionSource, /onDone\(null\)/);
      // The prop carries the verdict out.
      assert.match(completionSource, /onDone: \(feel: SessionFeel \| null\) => void/);
    },
  },
  {
    name: 'session feel: the verdict lands on the saved session',
    run() {
      assert.match(
        appSource,
        /void updateCompletedWorkoutSession\(completionSummary\.sessionId, \{ feel \}\)/,
      );
    },
  },
  {
    // Bug hunt, 2026-10-04: a failed commit lost the verdict silently and left
    // an unhandled rejection. The failure toast and the log must follow it.
    name: 'session feel: a failed write is logged and shown, not dropped',
    run() {
      assert.match(
        appSource,
        /\{ feel \}\)\.catch\(\(error\) => \{\s*console\.warn\([^;]*error\);\s*showToast\(t\(preferences\.appLanguage, 'toast\.entrySaveFailed'\)\);/,
      );
    },
  },
  {
    name: 'session feel: the stored value survives a reload, junk does not',
    run() {
      assert.match(modelsSource, /export type SessionFeel = 'easy' \| 'right' \| 'hard' \| 'too_hard'/);
      assert.match(modelsSource, /feel\?: SessionFeel \| null;/);
      // Normalization admits exactly the four values and nulls anything else.
      assert.match(
        databaseSource,
        /session\?\.feel === 'easy' \|\| session\?\.feel === 'right' \|\| session\?\.feel === 'hard' \|\| session\?\.feel === 'too_hard'/,
      );
    },
  },
  {
    name: 'session feel: every string reads in both languages',
    run() {
      for (const key of [
        'complete.feel.title',
        'complete.feel.easy',
        'complete.feel.right',
        'complete.feel.hard',
        'complete.feel.tooHard',
        'complete.feel.skip',
        'history.feel.heading',
        'history.feel.demanding',
        'history.feel.balanced',
        'history.feel.light',
        'history.feel.basis',
        'history.feel.tooFew',
        'history.feel.tooHard',
      ]) {
        const occurrences = i18nSource.split(`'${key}':`).length - 1;
        assert.equal(occurrences, 2, `${key} is missing one of its two languages`);
      }
    },
  },
  {
    name: 'session feel: history colours only what was answered, and reads the unfiltered list',
    run() {
      // An unanswered session gets no stripe. A default colour would turn
      // "never asked" into a verdict, and most sessions predate the question.
      assert.match(historySource, /const feelColor = session\.feel \? sessionFeelColor\(theme, session\.feel\) : null;/);
      assert.match(historySource, /\{feelColor \?[\s\S]{0,160}sessionFeelStripe/);

      // The summary describes the training, so a search must not change it:
      // it runs over sessionViewModels, never filteredSessions.
      assert.match(historySource, /summariseSessionFeel\(sessionViewModels\)/);
      assert.doesNotMatch(historySource, /summariseSessionFeel\(filteredSessions\)/);

      // Nothing at all until something has been answered — a card explaining
      // an absence to someone who never saw the question is an empty box.
      assert.match(historySource, /if \(summary\.answered === 0\) \{\s*return null;/);

      // The view model has to carry the verdict for any of that to be possible.
      assert.match(read('src/lib/historyView.ts'), /feel: session\.feel \?\? null,/);
    },
  },
  {
    name: 'sessionFeel: the scale runs easiest to hardest and every step has a label',
    run() {
      assert.deepEqual([...SESSION_FEEL_SCALE], ['easy', 'right', 'hard', 'too_hard']);
      for (const feel of SESSION_FEEL_SCALE) {
        assert.ok(SESSION_FEEL_LABEL_KEY[feel], `${feel} has no label key`);
      }
    },
  },
  {
    name: 'sessionFeel: too few answers produce no read, however many sessions there are',
    run() {
      const twelveSessions = Array.from({ length: 12 }, () => s(null));
      twelveSessions[0] = s('too_hard');
      twelveSessions[1] = s('too_hard');

      const summary = summariseSessionFeel(twelveSessions);
      assert.equal(summary.considered, 12);
      assert.equal(summary.answered, 2);
      // Two answers describe two evenings. A label here would be the app
      // inventing a conclusion out of a sample the reader never gave it.
      assert.equal(summary.read, null);
      // The count still comes through — it is what the screen can honestly say.
      assert.equal(summary.tooHardCount, 2);

      assert.equal(summariseSessionFeel([]).read, null);
      assert.equal(summariseSessionFeel([]).considered, 0);
    },
  },
  {
    name: 'sessionFeel: a lopsided run leans, a mixed one stays balanced',
    run() {
      assert.equal(summariseSessionFeel([s('hard'), s('hard'), s('too_hard')]).read, 'demanding');
      assert.equal(summariseSessionFeel([s('easy'), s('easy'), s('easy')]).read, 'light');
      assert.equal(summariseSessionFeel([s('right'), s('right'), s('right')]).read, 'balanced');

      // Three hard out of five is 0.6 — the lean starts exactly here.
      assert.equal(
        summariseSessionFeel([s('hard'), s('hard'), s('hard'), s('right'), s('easy')]).read,
        'demanding',
      );
      // Two of five is not.
      assert.equal(
        summariseSessionFeel([s('hard'), s('hard'), s('right'), s('right'), s('easy')]).read,
        'balanced',
      );
    },
  },
  {
    name: 'sessionFeel: a split between easy and brutal is mixed, not average',
    run() {
      // The thing a mean would get wrong: two sessions that felt easy and two
      // that felt too hard are not "just right", and filing them there would
      // hide exactly the pattern worth looking at.
      const split = summariseSessionFeel([s('easy'), s('too_hard'), s('easy'), s('too_hard')]);
      assert.equal(split.read, 'balanced');
      assert.equal(split.tooHardCount, 2, 'the brutal sessions stay visible on their own');
    },
  },
  {
    name: 'sessionFeel: only the window is read, and unanswered sessions still count as looked at',
    run() {
      // Newest first: thirteen sessions, and the oldest falls outside.
      const sessions = [
        ...Array.from({ length: SESSION_FEEL_WINDOW }, () => s('easy')),
        s('too_hard'),
      ];
      const summary = summariseSessionFeel(sessions);
      assert.equal(summary.considered, SESSION_FEEL_WINDOW);
      assert.equal(summary.answered, SESSION_FEEL_WINDOW);
      assert.equal(summary.read, 'light');
      assert.equal(summary.tooHardCount, 0, 'the session outside the window is not read');

      // Unanswered sessions are looked at even though they say nothing: "you
      // have not been answering" is part of what the screen has to convey.
      const half = summariseSessionFeel([s('hard'), s(null), s('hard'), s(undefined), s('hard')]);
      assert.equal(half.considered, 5);
      assert.equal(half.answered, 3);
      assert.equal(half.read, 'demanding');
    },
  },
];
