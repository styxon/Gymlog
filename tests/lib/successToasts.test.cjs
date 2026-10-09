const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * The rule the reader has now stated five times, most recently as prio 1 with
 * a photograph of the phone: a bar that announces a result the screen already
 * shows is noise. "Pilvivarmuuskopio poistettu" over a row that has just
 * changed to "Ei vielä varmuuskopiota" is the app saying it twice.
 *
 * The line is not "no toasts". A failure or a refusal is the one thing the
 * screen cannot show — nothing happened, so nothing changed to look at — and
 * those stay. This guard pins the removals so the next hand does not put a
 * "saved!" back on a screen that already says it.
 */
const RETIRED_SUCCESS_KEYS = [
  'account.backupDone',
  'account.deleteRemote.done',
  'home.complete.restarted',
];

/** Toasts that must survive: each explains why something did NOT happen. */
const KEPT_FAILURE_KEYS = [
  'account.backupFailed',
  'toast.saveWorkoutFailed',
  'toast.lastExerciseInDay',
];

module.exports = [
  {
    name: 'no screen announces a success the screen itself already shows',
    run() {
      const wiring = readAppWiring();
      for (const key of RETIRED_SUCCESS_KEYS) {
        assert.doesNotMatch(
          wiring,
          new RegExp(`showToast\\([^)]*'${key.replace(/\./g, '\\.')}'`),
          `${key} announces a result the screen already carries — it should not be a toast`,
        );
      }
    },
  },
  {
    name: 'the retired copy went with the toasts rather than lingering',
    run() {
      const i18n = fs.readFileSync(path.join(__dirname, '../../src/lib/i18n.ts'), 'utf8');
      for (const key of RETIRED_SUCCESS_KEYS) {
        assert.doesNotMatch(i18n, new RegExp(`'${key.replace(/\./g, '\\.')}':`), `${key} is dead copy`);
      }
    },
  },
  {
    /**
     * The other half of the rule, and the reason this is not "delete all
     * toasts": when an action fails, nothing on screen changed, so the bar is
     * the only thing that can say so.
     */
    name: 'failures still speak, because nothing on screen says them',
    run() {
      const wiring = readAppWiring();
      for (const key of KEPT_FAILURE_KEYS) {
        assert.match(
          wiring,
          new RegExp(`'${key.replace(/\./g, '\\.')}'`),
          `${key} explains why nothing happened and must stay`,
        );
      }
      // The full-set refusal is one message for every door, built in
      // programCapNotice (it names the excess past the cap, hunt 9, 2026-10-09).
      assert.match(
        wiring,
        /showToast\(programCapFullMessage\(preferences\.appLanguage, decision\.used, decision\.cap\)\)/,
        'programs.cap.full explains why nothing happened and must stay',
      );
    },
  },
];
