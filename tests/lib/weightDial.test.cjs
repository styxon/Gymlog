const assert = require('node:assert/strict');

const {
  commitDialWeight,
  stepDialWeight,
  WEIGHT_DIAL_MAX_KG,
  WEIGHT_DIAL_STEP_KG,
  commitDialReps,
  stepDialReps,
  REPS_DIAL,
  HOLD_DIAL,
} = require('../../.test-dist/lib/weightDial');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

module.exports = [
  {
    /**
     * The complaint itself. 12 is not on the 1,25 grid and never will be, so
     * the only answer is being able to write it.
     */
    name: 'exactly 12 kg can be typed, though it is not on the step grid',
    run() {
      let kg = 0;
      for (let i = 0; i < 40; i += 1) {
        kg = stepDialWeight(kg, 1);
        assert.notEqual(kg, 12, 'stepping should never land on 12 — that is the bug');
      }
      assert.equal(commitDialWeight('12', 10), 12);
    },
  },
  {
    name: 'a held button stops at the ceiling instead of running to 5000',
    run() {
      let kg = 495;
      for (let i = 0; i < 100; i += 1) {
        kg = stepDialWeight(kg, 1);
      }
      assert.equal(kg, WEIGHT_DIAL_MAX_KG);
      // And the ceiling is above any lift a reader could actually do — a
      // heavy leg press or sled included (bug hunt, 2026-10-05).
      assert.equal(WEIGHT_DIAL_MAX_KG, 600);
    },
  },
  {
    name: 'the dial never goes below zero',
    run() {
      let kg = 2;
      for (let i = 0; i < 10; i += 1) {
        kg = stepDialWeight(kg, -1);
      }
      assert.equal(kg, 0);
    },
  },
  {
    name: 'the step stays on two decimals rather than rounding itself away',
    run() {
      assert.equal(WEIGHT_DIAL_STEP_KG, 1.25);
      assert.equal(stepDialWeight(60, 1), 61.25);
      assert.equal(stepDialWeight(61.25, 1), 62.5);
    },
  },
  {
    /** Finnish writes 92,5. The app's first language cannot be the one that fails. */
    name: 'a typed weight takes the Finnish comma as well as the dot',
    run() {
      assert.equal(commitDialWeight('92,5', 0), 92.5);
      assert.equal(commitDialWeight('92.5', 0), 92.5);
    },
  },
  {
    name: 'typed nonsense keeps the number that was there, and so does a typo past the ceiling',
    run() {
      // Mid-edit with the field emptied: the number being adjusted survives.
      assert.equal(commitDialWeight('', 82.5), 82.5);
      assert.equal(commitDialWeight('kg', 82.5), 82.5);
      // Below zero is not a weight either, and it used to become 0 over the
      // dialled one while the field read red (CI review of #174).
      assert.equal(commitDialWeight('-5', 82.5), 82.5);
      assert.equal(commitDialWeight('0', 82.5), 0);
      // Past the ceiling is a typo, not a heavier set. It was clamped to 500,
      // so "825" for 82,5 logged 500 kg while the field read 825 (decimal
      // audit, 2026-09-21); the set editor and freestyle already refused it.
      assert.equal(commitDialWeight('825', 82), 82);
      assert.equal(commitDialWeight('5000', 82.5), 82.5);
      assert.equal(commitDialWeight(String(WEIGHT_DIAL_MAX_KG), 82.5), WEIGHT_DIAL_MAX_KG);

      // And the field says whether it holds a loggable weight, so the log
      // button can wait rather than write the number the dial kept.
      const { isLoggableTypedWeight } = require('../../.test-dist/lib/weightDial.js');
      assert.equal(isLoggableTypedWeight('82,5'), true);
      assert.equal(isLoggableTypedWeight('82.5'), true);
      assert.equal(isLoggableTypedWeight('0'), true);
      assert.equal(isLoggableTypedWeight('825'), false);
      assert.equal(isLoggableTypedWeight('82,,5'), false);
      assert.equal(isLoggableTypedWeight(''), false);
      assert.equal(isLoggableTypedWeight('-5'), false);
    },
  },
  {
    /**
     * The card drew a pencil and told a screen reader "tap to edit" while
     * tapping opened two buttons. This pins the promise to a handler.
     */
    name: 'the weight card is wired to both stepping and typing',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(
        path.join(__dirname, '../../src/screens/GuidedPlayerScreen.tsx'),
        'utf8',
      );
      assert.match(screen, /onStep=\{\(direction\) => setKg\(\(current\) => stepDialWeight\(current, direction\)\)\}/);
      assert.match(
        screen,
        /onCommit=\{\(text\) => \{\s*setTypedTextInvalid\(!isLoggableTypedWeight\(text\)\);\s*setTypedTextPending\(false\);\s*setKg\(\(current\) => commitDialWeight\(text, current\)\);\s*\}\}/,
      );
      // While the field holds no loggable weight, the set is not logged.
      assert.match(screen, /const logBlocked = dial !== null && typedTextInvalid;/);
      assert.match(screen, /disabled=\{logBlocked\}/);
      // And only while the typed text is what the field shows. The keyboard
      // going away, or a step, puts the card's own number back in the field;
      // the lock stayed on over a good weight (CI review of #174).
      assert.match(screen, /onDraftCleared=\{\(\) => \{\s*setTypedTextInvalid\(false\);/);
      assert.match(screen, /onBlur=\{\(\) => \{\s*setDraft\(null\);\s*onDraftCleared\?\.\(\);\s*\}\}/);
      // Both step buttons clear the typed text. Since the accessibility audit
      // (2026-09-21) a screen reader's swipe steps the card too, so the three
      // clears-and-steps became one `step` helper that all of them call —
      // the rule is held on the helper, and on every caller going through it.
      assert.match(
        screen,
        /const step = \(direction: -1 \| 1\) => \{\s*setDraft\(null\);\s*onDraftCleared\?\.\(\);\s*onStep\(direction\);\s*\};/,
        'a step clears the typed text',
      );
      assert.match(screen, /<DialButton glyph="−" accessibilityLabel=\{downLabel\} onStep=\{\(\) => step\(-1\)\} \/>/);
      assert.match(screen, /<DialButton glyph="\+" accessibilityLabel=\{upLabel\} onStep=\{\(\) => step\(1\)\} \/>/);
      assert.doesNotMatch(screen, /<DialButton[^>]*onStep=\{\(\) => \{/, 'a button steps around the helper');
      // The old unbounded arithmetic must not come back.
      assert.doesNotMatch(screen, /setKg\(\(current\) => Math\.max\(0, Number\(\(current \+ direction/);
      // And the wiring lives on a screen, not in the shell — this only checks
      // the shell has not grown its own copy of the rule.
      assert.doesNotMatch(readAppWiring(), /current \+ direction \* 1\.25/);
    },
  },
  {
    /**
     * The reps card types too (user 2026-09-09, with a sketch). Reps are whole;
     * a hold counts seconds in fives, so its floor is five. And both have a
     * ceiling, for the reason the weight has one (review, PR #88): 99999 typed
     * or held into the log poisons every chart that reads it.
     */
    name: 'typed and stepped reps stay whole and inside the dial, and nonsense keeps the number',
    run() {
      assert.equal(commitDialReps('12', 8, REPS_DIAL), 12);
      assert.equal(commitDialReps('12,7', 8, REPS_DIAL), 13);
      assert.equal(commitDialReps('', 8, REPS_DIAL), 8);
      assert.equal(commitDialReps('abc', 8, REPS_DIAL), 8);
      assert.equal(commitDialReps('0', 8, REPS_DIAL), 1);
      assert.equal(commitDialReps('99999', 8, REPS_DIAL), REPS_DIAL.max);
      assert.equal(commitDialReps('3', 20, HOLD_DIAL), 5);
      assert.equal(commitDialReps('45', 20, HOLD_DIAL), 45);
      assert.equal(commitDialReps('5000', 20, HOLD_DIAL), HOLD_DIAL.max);

      assert.equal(stepDialReps(8, 1, REPS_DIAL), 9);
      assert.equal(stepDialReps(1, -1, REPS_DIAL), 1);
      assert.equal(stepDialReps(REPS_DIAL.max, 1, REPS_DIAL), REPS_DIAL.max);
      assert.equal(stepDialReps(20, 1, HOLD_DIAL), 25);
      assert.equal(stepDialReps(5, -1, HOLD_DIAL), 5);
      assert.equal(stepDialReps(HOLD_DIAL.max, 1, HOLD_DIAL), HOLD_DIAL.max);
    },
  },
  {
    name: 'a 550 kg leg press set survives a load: the loader keeps what the dial and an import can write (bug hunt 2026-10-05)',
    run() {
      const { normalizeExerciseSets } = require('../../.test-dist/lib/exerciseLog');
      const kept = normalizeExerciseSets([
        { orderIndex: 0, weight: 550, reps: 10, status: 'completed' },
        { orderIndex: 1, weight: 600, reps: 8, status: 'completed' },
        // Past the ceiling is still an artefact, and still goes.
        { orderIndex: 2, weight: 5122.5, reps: 5, status: 'completed' },
      ]);
      assert.deepEqual(kept.map((set) => set.weight), [550, 600]);
    },
  },
];
