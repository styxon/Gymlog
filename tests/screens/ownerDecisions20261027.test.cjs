const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { durationMinutesParts, formatDurationMinutes } = require('../../src/lib/format');
const { formatLiftDisplayLabel } = require('../../src/lib/displayLabel');
const { exerciseNameLabel } = require('../../src/lib/exerciseNameLabel');

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Owner decisions on the 2026-10-26 History/Progress hunt (2026-10-27): the
 * finish screen writes a duration as History does, and a lift name that is
 * anything at all is shown as typed.
 */
module.exports = [
  {
    name: 'finish screen: a duration of an hour or more reads "1 h 15 min", under an hour stays "57 min"',
    run() {
      assert.deepEqual(durationMinutesParts(57), [{ value: 57, unit: 'min' }]);
      assert.deepEqual(durationMinutesParts(75), [
        { value: 1, unit: 'h' },
        { value: 15, unit: 'min' },
      ]);
      assert.deepEqual(durationMinutesParts(120), [{ value: 2, unit: 'h' }]);
      // The parts are the formatter's own text, so the two never drift.
      for (const minutes of [0, 1, 57, 59, 60, 61, 75, 120, 125, 600]) {
        const joined = durationMinutesParts(minutes)
          .map((part) => `${part.value} ${part.unit}`)
          .join(' ');
        assert.equal(joined, formatDurationMinutes(minutes), String(minutes));
      }
      assert.equal(formatDurationMinutes(75), '1 h 15 min');

      const screen = read('src', 'screens', 'WorkoutCompletionScreen.tsx');
      assert.match(screen, /durationMinutesParts\(durationMinutes\)\.map\(\(part, index\) => \(/);
      assert.match(screen, /<Text style=\{styles\.statUnit\}> \{part\.unit\}<\/Text>/);
      assert.doesNotMatch(screen, /\{durationMinutes\}\s*<Text style=\{styles\.statUnit\}> min<\/Text>/);
    },
  },
  {
    name: 'lift names: one character is shown as typed, a blank one translated — on History and the free workout',
    run() {
      for (const language of ['fi', 'en']) {
        assert.equal(exerciseNameLabel(language, formatLiftDisplayLabel('X', language)), 'X');
      }
      assert.equal(exerciseNameLabel('fi', formatLiftDisplayLabel('', 'fi')), 'Nimetön liike');
      assert.equal(exerciseNameLabel('en', formatLiftDisplayLabel('  ', 'en')), 'Unnamed exercise');

      const history = read('src', 'screens', 'HistoryScreen.tsx');
      assert.match(history, /formatLiftDisplayLabel\(session\.topLiftName, language\)/);
      assert.match(history, /formatLiftDisplayLabel\(log\.exerciseNameSnapshot, language\)/);
      assert.match(history, /formatLiftDisplayLabel\(log\.swappedFrom, language\)/);
      const freestyle = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      assert.doesNotMatch(freestyle, /formatLiftDisplayLabel\([^)]*'Exercise'\)/);
      assert.doesNotMatch(read('src', 'lib', 'displayLabel.ts'), /Unnamed lift/);
    },
  },
];
