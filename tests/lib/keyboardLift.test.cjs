const assert = require('node:assert/strict');

const { keyboardOpenBottomPadding } = require('../../.test-dist/lib/keyboardLift.js');

module.exports = [
  {
    /**
     * iOS hunt 2026-10-17 (P0-4, S5a-2): the AppShell's KeyboardAvoidingView
     * already ends an iOS screen at the keyboard, and the coach chat and the
     * strength goal added the keyboard's height under their foot again. The
     * thread and the number field between them were squeezed to 0 pt.
     */
    name: 'keyboardOpenBottomPadding: Android stands the foot on the keyboard, iOS adds only the gap',
    run() {
      assert.equal(keyboardOpenBottomPadding('android', 336, 8), 344);
      assert.equal(keyboardOpenBottomPadding('ios', 336, 8), 8);
      assert.equal(keyboardOpenBottomPadding('ios', 291, 12), 12);
      // A missing or nonsensical height is no height.
      assert.equal(keyboardOpenBottomPadding('android', 0, 12), 12);
      assert.equal(keyboardOpenBottomPadding('android', -40, 12), 12);
      // Anything that is not Android has no edge-to-edge overlay to clear.
      assert.equal(keyboardOpenBottomPadding('web', 300, 8), 8);
    },
  },
];
