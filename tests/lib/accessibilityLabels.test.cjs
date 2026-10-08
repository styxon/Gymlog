const assert = require('node:assert/strict');

const {
  exerciseCardAccessibilityLabel,
  setFieldAccessibilityLabel,
  weightStepAccessibilityLabel,
} = require('../../.test-dist/lib/accessibilityLabels.js');
const { removeTrailingZeros, setNumberLanguage } = require('../../.test-dist/lib/format.js');
const { WEIGHT_DIAL_STEP_KG } = require('../../.test-dist/lib/weightDial.js');
const { t } = require('../../.test-dist/lib/i18n.js');
const {
  rulerStepCount,
  rulerValueAt,
  stepRulerValue,
} = require('../../.test-dist/lib/rulerValue.js');

/**
 * Screen-reader labels built from what a control shows (accessibility audit,
 * 2026-09-21).
 *
 * The set screen's lift card was labelled with its action, "Liikkeen tiedot",
 * and on Android a label replaces the contents — the lift's name and last
 * time's numbers were never spoken. The weight dial's −/+ said 2,5 kg while
 * the dial moved 1,25. The set fields were bare numbers. These pin the words
 * a reader hears.
 */
module.exports = [
  {
    // The card's TÄNÄÄN row (#bugs 2026-10-08) is drawn inside the card, whose
    // label replaces its children for TalkBack: said in the label, after last time.
    name: "a11y: the set card says today's sets after last time's",
    run() {
      const { exerciseCardAccessibilityLabel } = require('../../.test-dist/lib/accessibilityLabels.js');
      const lastTime = { sets: [{ loadKg: 35, reps: 12 }, { loadKg: 35, reps: 8 }], borrowed: false };
      const without = exerciseCardAccessibilityLabel('fi', 'Ojentajapushdown', lastTime);
      assert.equal(exerciseCardAccessibilityLabel('fi', 'Ojentajapushdown', lastTime, [10, 10, null]), `${without}. Tänään: 10, 10, –`);
      assert.equal(exerciseCardAccessibilityLabel('fi', 'Ojentajapushdown', lastTime, []), without);
      assert.equal(exerciseCardAccessibilityLabel('fi', 'Ojentajapushdown', null, [10]), `${exerciseCardAccessibilityLabel('fi', 'Ojentajapushdown', null)}. Tänään: 10`);
    },
  },
  {
    name: 'a11y labels: the lift card is read as the lift, then last time',
    run() {
      setNumberLanguage('fi');
      assert.equal(
        exerciseCardAccessibilityLabel('fi', 'Penkkipunnerrus', {
          sets: [{ loadKg: 62.5, reps: 8 }, { loadKg: 62.5, reps: 8 }, { loadKg: 62.5, reps: 6 }],
          borrowed: false,
        }),
        'Penkkipunnerrus. Viime kerralla: 62,5 kg, toistot 8, 8, 6',
      );
      // Borrowed history is a different claim, as it is on the card.
      assert.equal(
        exerciseCardAccessibilityLabel('fi', 'Kyykky', { sets: [{ loadKg: 100, reps: 5 }], borrowed: true }),
        'Kyykky. Viime kerralla, eri päivänä: 100 kg, toistot 5',
      );
      // No weight on any set: the card prints a dash, the label says nothing.
      assert.equal(
        exerciseCardAccessibilityLabel('fi', 'Leuanveto', {
          sets: [{ loadKg: 0, reps: 10 }, { loadKg: 0, reps: 9 }],
          borrowed: false,
        }),
        'Leuanveto. Viime kerralla: toistot 10, 9',
      );
      // Never done: the card's own first-time line.
      assert.equal(
        exerciseCardAccessibilityLabel('fi', 'Penkkipunnerrus', null),
        `Penkkipunnerrus. ${t('fi', 'guided.card.firstTime')}`,
      );
      setNumberLanguage('en');
      assert.equal(
        exerciseCardAccessibilityLabel('en', 'Bench press', {
          sets: [{ loadKg: 62.5, reps: 8 }, { loadKg: 62.5, reps: 8 }, { loadKg: 62.5, reps: 6 }],
          borrowed: false,
        }),
        'Bench press. Last time: 62.5 kg, reps 8, 8, 6',
      );
      setNumberLanguage('fi');
      // The action is not the label: it went to the hint.
      assert.doesNotMatch(
        exerciseCardAccessibilityLabel('fi', 'Kyykky', null),
        new RegExp(t('fi', 'guided.panelsToggle')),
      );
    },
  },
  {
    name: 'a11y labels: a ramp is spoken per set, not smoothed to one heaviest weight',
    run() {
      setNumberLanguage('fi');
      // The exact reported case (#bugs 2026-09-29): Lantionnosto laitteessa
      // 16,25×8, 16,25×8, 30×6, 30×6, 30×6. The card's own heading hides the
      // single "30 kg" number for this ramp and shows per-set chips instead
      // (decision "a") — the spoken label must not fall back to the old
      // single-heaviest-weight-plus-reps summary ("30 kg, toistot 8 8 6 6 6"),
      // since that is the exact bug the visual fix stops showing.
      const label = exerciseCardAccessibilityLabel('fi', 'Lantionnosto laitteessa', {
        sets: [
          { loadKg: 16.25, reps: 8 },
          { loadKg: 16.25, reps: 8 },
          { loadKg: 30, reps: 6 },
          { loadKg: 30, reps: 6 },
          { loadKg: 30, reps: 6 },
        ],
        borrowed: false,
      });
      assert.equal(label, 'Lantionnosto laitteessa. Viime kerralla: 16,25×8, 16,25×8, 30×6, 30×6, 30×6 kg');
      assert.doesNotMatch(label, /toistot/);
      assert.doesNotMatch(label, /^Lantionnosto laitteessa\. Viime kerralla: 30 kg/);
      // Borrowed + ramp: the borrowed lead still applies.
      assert.equal(
        exerciseCardAccessibilityLabel('fi', 'Maastaveto', {
          sets: [{ loadKg: 55, reps: 8 }, { loadKg: 60, reps: 8 }],
          borrowed: true,
        }),
        'Maastaveto. Viime kerralla, eri päivänä: 55×8, 60×8 kg',
      );
      // A uniform session is unaffected: same words as before.
      setNumberLanguage('en');
      assert.equal(
        exerciseCardAccessibilityLabel('en', 'Hip thrust machine', {
          sets: [
            { loadKg: 16.25, reps: 8 },
            { loadKg: 16.25, reps: 8 },
            { loadKg: 30, reps: 6 },
          ],
          borrowed: false,
        }),
        'Hip thrust machine. Last time: 16.25×8, 16.25×8, 30×6 kg',
      );
      setNumberLanguage('fi');
    },
  },
  {
    name: 'a11y labels: a set field names its set, what it holds, and the unit',
    run() {
      assert.equal(setFieldAccessibilityLabel('fi', 'kg', 2), 'Sarja 2, paino, kg');
      assert.equal(setFieldAccessibilityLabel('fi', 'reps', 2), 'Sarja 2, toistot');
      assert.equal(setFieldAccessibilityLabel('en', 'kg', 3), 'Set 3, weight, kg');
      // Where the list holds more than one lift, the lift comes first.
      assert.equal(setFieldAccessibilityLabel('fi', 'reps', 1, 'Kyykky'), 'Kyykky, sarja 1, toistot');
      assert.equal(setFieldAccessibilityLabel('en', 'kg', 1, 'Squat'), 'Squat, set 1, weight, kg');
    },
  },
  {
    name: 'a11y labels: the weight dial\'s −/+ say the step the dial takes',
    run() {
      setNumberLanguage('fi');
      assert.equal(weightStepAccessibilityLabel('fi', -1), 'Vähennä painoa 1,25 kg');
      assert.equal(weightStepAccessibilityLabel('fi', 1), 'Lisää painoa 1,25 kg');
      setNumberLanguage('en');
      assert.equal(weightStepAccessibilityLabel('en', 1), 'Raise the weight by 1.25 kg');
      // Tied to the constant, not to a number in the copy: the copy said 2,5
      // for as long as the dial moved 1,25.
      assert.ok(weightStepAccessibilityLabel('en', -1).includes(`${removeTrailingZeros(WEIGHT_DIAL_STEP_KG)} kg`));
      setNumberLanguage('fi');
      for (const language of ['fi', 'en']) {
        for (const key of ['guided.a11y.weightDown', 'guided.a11y.weightUp']) {
          assert.match(t(language, key), /\{kg\}/, `${language} ${key} must take the step`);
          assert.doesNotMatch(t(language, key), /2[.,]5/);
        }
      }
    },
  },
  {
    name: 'ruler: one screen-reader step is one mark, held inside the scale',
    run() {
      const kg = { min: 35, max: 220, step: 0.1 };
      assert.equal(stepRulerValue(75, 1, kg), 75.1);
      assert.equal(stepRulerValue(75, -1, kg), 74.9);
      // The ends hold.
      assert.equal(stepRulerValue(220, 1, kg), 220);
      assert.equal(stepRulerValue(35, -1, kg), 35);
      // Off-grid input lands on the grid, one mark over.
      assert.equal(stepRulerValue(75.04, 1, kg), 75.1);
      // Three hundred steps do not drift into 74.30000000000001.
      let value = 44.3;
      for (let index = 0; index < 300; index += 1) {
        value = stepRulerValue(value, 1, kg);
      }
      assert.equal(value, 74.3);
      // Half-centimetre tapes and whole-centimetre heights.
      assert.equal(stepRulerValue(80, 1, { min: 20, max: 200, step: 0.5 }), 80.5);
      assert.equal(stepRulerValue(180, -1, { min: 120, max: 220, step: 1 }), 179);
      assert.equal(rulerStepCount(kg), 1850);
      assert.equal(rulerValueAt(1850, kg), 220);
    },
  },
];
