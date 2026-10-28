const assert = require('node:assert/strict');

const { getOnboardingFocusAreaPresentationOptions } = require('../../src/lib/focusAreaPresentation');

module.exports = [
  {
    name: 'focus area presentation exposes consistent Step 4 placeholder options',
    run() {
      const onboardingOptions = getOnboardingFocusAreaPresentationOptions();

      assert.deepEqual(
        onboardingOptions.map((option) => option.area),
        ['chest', 'back', 'shoulders', 'arms', 'core', 'quads', 'glutes', 'hamstrings', 'calves', 'mobility'],
      );
      assert.deepEqual(
        onboardingOptions.map((option) => option.assetKey),
        ['chest', 'back', 'shoulders', 'arms', 'core', 'quads', 'glutes', 'hamstrings', 'calves', 'mobility'],
      );
      assert.deepEqual(
        onboardingOptions.map((option) => option.group),
        ['upper', 'upper', 'upper', 'upper', 'upper', 'lower', 'lower', 'lower', 'lower', 'lower'],
      );
      assert.equal(onboardingOptions.some((option) => option.area === 'mobility'), true);
      assert.equal(onboardingOptions.some((option) => option.area === 'core' && option.title === 'Abs'), true);
      assert.equal(onboardingOptions.some((option) => option.area === 'conditioning'), false);
      // Asserted on the onboarding list, which is the only one anything reads.
      // The full table used to be reachable through a getter of its own; it had
      // no caller outside this file and went with the sweep.
      assert.equal(onboardingOptions.every((option) => option.title.length > 0), true);
      assert.equal(onboardingOptions.every((option) => option.accessibilityLabel.includes('focus')), true);
    },
  },
];
