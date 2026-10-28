const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const fs = require('node:fs');
const path = require('node:path');

const { asksBeforeZeroWeightLog } = require('../../src/lib/zeroWeightLog');
const { trackedLiftAmount } = require('../../src/lib/trackedLiftAmount');
const { formatWeight } = require('../../src/lib/format');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const strip = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Owner's #9, iOS hunt 2026-10-17: a new phone's first back squat, logged
 * with one tap on a weight dial that opened at zero, was listed on Progress as
 * "0 kg × 7". The first tap now says no weight is set; the list says reps when
 * there was no weight. 0 kg itself stays loggable (tests/lib/
 * hunt12ProgressionState.test.cjs keeps a loaded lunge at bodyweight).
 */
module.exports = [
  {
    name: 'zero weight: Log set asks once for a loaded set with no weight and nothing to go on',
    run() {
      const base = { carriesWeight: true, kg: 0, plannedKg: null, asked: false };
      assert.equal(asksBeforeZeroWeightLog(base), true);
      assert.equal(asksBeforeZeroWeightLog({ ...base, asked: true }), false, 'the second tap logs');
      assert.equal(asksBeforeZeroWeightLog({ ...base, kg: 20 }), false, 'a weight is set');
      assert.equal(asksBeforeZeroWeightLog({ ...base, plannedKg: 0 }), false, 'the plan says zero');
      assert.equal(asksBeforeZeroWeightLog({ ...base, plannedKg: 60 }), false, 'the plan has a weight');
      assert.equal(asksBeforeZeroWeightLog({ ...base, carriesWeight: false }), false, 'bodyweight lift');
      assert.equal(asksBeforeZeroWeightLog({ ...base, kg: Number.NaN }), true, 'not a weight is no weight');
    },
  },
  {
    name: 'zero weight: the guided player asks before it logs, says it in words, and forgets it on the next set',
    run() {
      const player = strip(readGuidedPlayerSource());
      const gate = player.search(
        /if \(\s*asksBeforeZeroWeightLog\(\{\s*carriesWeight: !bodyweight,\s*kg,\s*plannedKg: target\?\.loadKg \?\? null,\s*asked: zeroWeightAsked,\s*\}\)\s*\) \{\s*setZeroWeightAsked\(true\);\s*AccessibilityInfo\.announceForAccessibility\(t\(language, 'guided\.zeroWeightAsk'\)\);\s*return;\s*\}/,
      );
      assert.ok(gate > 0, 'Log set does not ask');
      const confirm = player.indexOf('onConfirm(step.slotId, step.setIndex, done, bodyweight ? null : kg);');
      assert.ok(confirm > gate && confirm - gate < 1500, 'the question is not in front of the log');
      assert.match(player, /useEffect\(\(\) => \{\s*setZeroWeightAsked\(false\);\s*\}, \[stepIndex\]\);/);
      assert.match(
        player,
        /\{zeroWeightAsked && !bodyweight && !\(kg > 0\) \? \(\s*<View style=\{styles\.setWeightNote\}>\s*<Text style=\{styles\.setWeightNoteText\}>\{t\(language, 'guided\.zeroWeightAsk'\)\}<\/Text>/,
      );
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.equal((i18n.match(/'guided\.zeroWeightAsk':/g) ?? []).length, 2, 'EN and FI');
    },
  },
  {
    name: 'zero weight: Progress lists a weightless session in reps, never as 0 kg',
    run() {
      const lift = { exerciseNameSnapshot: 'Back Squat' };
      assert.equal(trackedLiftAmount(0, '7,7,6', lift, 'kg', 'en'), '7 reps');
      assert.equal(trackedLiftAmount(0, '7', lift, 'kg', 'fi'), '7 toistoa');
      assert.equal(trackedLiftAmount(60, '5,5,5', lift, 'kg', 'en'), '60 kg × 5');
      // formatWeight's decimal mark follows the app's number locale; the row writes what it writes.
      assert.equal(trackedLiftAmount(62.5, '-', lift, 'kg', 'en'), formatWeight(62.5, 'kg'));
      assert.equal(trackedLiftAmount(null, '-', undefined, 'kg', 'en'), '-');
      assert.equal(trackedLiftAmount(0, '-', lift, 'kg', 'en'), '-');
      for (const line of [trackedLiftAmount(0, '7', lift, 'kg', 'en'), trackedLiftAmount(null, '8', null, 'kg', 'fi')]) {
        assert.doesNotMatch(line, /0 kg|null/);
      }
      // A hold's number is seconds and a bout's minutes, never reps; a bout
      // carries no weight (format.formatLogSetSummary writes "20 min" too).
      const plank = { exerciseNameSnapshot: 'Plank' };
      const ride = { repsUnit: 'minutes', exerciseNameSnapshot: 'Stationary Bike (Easy Pace)' };
      assert.equal(trackedLiftAmount(0, '60,60', plank, 'kg', 'en'), '60 s');
      assert.equal(trackedLiftAmount(10, '45', plank, 'kg', 'en'), '10 kg × 45 s');
      assert.equal(trackedLiftAmount(0, '20', ride, 'kg', 'fi'), '20 min');
      assert.equal(trackedLiftAmount(5, '20', ride, 'kg', 'en'), '20 min');
      const progress = strip(read('src', 'screens', 'ProgressScreen.tsx'));
      assert.match(
        progress,
        /\{trackedLiftAmount\(summary\.latestWeight, summary\.latestReps, summary\.latestLog, unitPreference, language\)\}/,
      );
      assert.doesNotMatch(progress, /formatWeight\(summary\.latestWeight/);
    },
  },
];
