const assert = require('node:assert/strict');
const path = require('node:path');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const { localizeSessionFocus, localizeSessionName } = require(path.join(DIST, 'lib', 'sessionNameLabel.js'));
const { formatWorkoutDisplayLabel } = require(path.join(DIST, 'lib', 'displayLabel.js'));
const { t } = require(path.join(DIST, 'lib', 'i18n.js'));

/**
 * Bug hunt 10 (2026-10-09): a free workout is saved under the title for the
 * language at the moment of finishing, and the localizers only went English to
 * Finnish. Switching language left every such history row in the old one.
 */
module.exports = [
  {
    name: 'free workout names: a name saved in one language reads in the other after a switch, with or without the date',
    run() {
      for (const saved of ['en', 'fi']) {
        for (const view of ['en', 'fi']) {
          const stored = t(saved, 'emptyWorkout.title');
          const expected = t(view, 'emptyWorkout.title');
          assert.equal(localizeSessionName(stored, view), expected, `${saved} name viewed in ${view} (name)`);
          assert.equal(localizeSessionFocus(formatWorkoutDisplayLabel(stored), view), expected, `${saved} name viewed in ${view} (focus)`);
          // The holder template carries the date the workout was done.
          assert.equal(localizeSessionName(`${stored} 9.10.`, view), `${expected} 9.10.`, `${saved} holder viewed in ${view}`);
          assert.equal(localizeSessionFocus(`${stored} 19.12.`, view), `${expected} 19.12.`);
        }
      }
    },
  },
  {
    name: 'free workout names: only the app\'s own title is rewritten',
    run() {
      assert.equal(localizeSessionName('Empty workout plan', 'fi'), 'Empty workout plan');
      assert.equal(localizeSessionName('Tyhjä treeni A', 'en'), 'Tyhjä treeni A');
      assert.equal(localizeSessionName('Push Day', 'en'), 'Push Day');
      assert.equal(localizeSessionName('Day 3', 'fi'), 'Päivä 3');
    },
  },
];
