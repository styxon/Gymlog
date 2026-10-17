const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
const hook = read('src', 'hooks', 'useModalHandoff.ts');

/**
 * #bugs 2026-10-17, iOS build 4: "Ohita tämä liike" froze the whole app.
 * React Native presents every Modal from the root view controller on iOS, and
 * UIKit refuses a second presentation while that controller is still showing a
 * sheet, or still animating it away — yet React Native records the second
 * modal as shown, and touches stop. The confirmation was opened over the open
 * actions sheet. These pin the handoff: a modal opened from the actions or
 * exit sheet opens only after that sheet has gone.
 */
module.exports = [
  {
    name: 'iOS modal handoff: the actions and exit sheets open no modal in the same tick as they close',
    run() {
      // Each opener that starts from one of the two sheets goes through handOff.
      for (const open of [
        'setConfirmingSkipExercise(true)',
        'setConfirmingEnd(true)',
        'setRunSheetOpen(true)',
        'setSwapOpen(true)',
      ]) {
        const escaped = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const handed = new RegExp(`handOff\\(\\s*\\(\\) => set(?:PauseSheet|Exit)Open\\(false\\),\\s*\\(\\) => ${escaped},?\\s*\\)`);
        if (open === 'setRunSheetOpen(true)' || open === 'setSwapOpen(true)') {
          // These are also opened from the screen itself, with no sheet up.
          assert.match(player, handed, `${open} from a sheet goes through handOff`);
        } else {
          assert.match(player, handed, `${open} goes through handOff`);
          assert.equal(player.split(open).length - 1, 1, `${open} is opened only through handOff`);
        }
      }
      // No sheet is closed and another modal opened on the next line.
      assert.doesNotMatch(
        player,
        /set(?:PauseSheet|Exit)Open\(false\);\s*(?:moveOnFromMenu\(\);\s*)?set(?:\w+Open|Confirming\w+)\(true\)/,
        'a sheet closes and the next modal opens in the same tick',
      );
      // The skip confirmation is not asked over the open sheet either.
      assert.doesNotMatch(player, /onPress=\{\(\) => setConfirmingSkipExercise\(true\)\}/);
    },
  },
  {
    name: 'iOS modal handoff: the two sheets stay mounted and report their dismissal',
    run() {
      assert.match(player, /<GPSheet\s+visible=\{pauseSheetOpen\}\s+onDismissed=\{onSheetDismissed\}/);
      assert.match(player, /<GPSheet\s+visible=\{exitOpen\}\s+onDismissed=\{onSheetDismissed\}/);
      assert.doesNotMatch(player, /\{pauseSheetOpen && \(/);
      assert.doesNotMatch(player, /\{exitOpen && \(/);
      // GPSheet hands both to its Modal: iOS reports onDismiss only for a
      // Modal whose visible turned false, never for one that unmounted.
      assert.match(player, /<Modal\s+visible=\{visible\}\s+transparent\s+animationType="fade"\s+onRequestClose=\{onClose\}\s+onDismiss=\{onDismissed\}/);
      // A sheet closed by a pull opens again at rest.
      assert.match(player, /if \(visible\) \{\s*dragY\.setValue\(0\);/);
      // Cancelling the skip, with the sheet already gone, closes the menu.
      assert.match(player, /onCancel=\{\(\) => \{\s*setConfirmingSkipExercise\(false\);\s*closeActionsMenu\(\);/);
    },
  },
  {
    name: 'iOS modal handoff: the hook waits on iOS only, and never forever',
    run() {
      assert.match(hook, /if \(Platform\.OS !== 'ios'\) \{\s*close\(\);\s*open\(\);\s*return;/);
      assert.match(hook, /pending\.current = open;\s*close\(\);/);
      assert.match(hook, /setTimeout\(onSheetDismissed, MODAL_HANDOFF_FALLBACK_MS\)/);
      assert.match(hook, /export const MODAL_HANDOFF_FALLBACK_MS = \d+;/);
      // Run once: the dismissal and the timer both call it.
      assert.match(hook, /const next = pending\.current;\s*pending\.current = null;\s*next\?\.\(\);/);
    },
  },
];
