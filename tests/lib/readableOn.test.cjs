const assert = require('node:assert/strict');

const { readableOn } = require('../../src/theming');

/**
 * The guided player's primary button paints itself `theme.ink` to mean "the
 * quiet one" and drew its label `#fff` regardless. Under the light theme ink is
 * near-black and that reads; under the dark theme ink is #F4F1FF, so "Pysäytä
 * kello" was white on white and the button looked blank. Reported from a gym
 * floor 2026-08-21.
 */
module.exports = [
  {
    name: 'readableOn: the dark theme ink that made a button read as blank',
    run() {
      // The exact pair from the report.
      assert.equal(readableOn('#F4F1FF'), '#17131F');
      // And the light theme's ink, which was always fine.
      assert.equal(readableOn('#17131F'), '#FFFFFF');
    },
  },
  {
    name: 'readableOn: the player\'s other button fills still take white',
    run() {
      // Green and purple are the two the player paints most.
      assert.equal(readableOn('#2E9E5B'), '#FFFFFF');
      assert.equal(readableOn('#8B5CF6'), '#FFFFFF');
    },
  },
  {
    name: 'readableOn: shorthand and junk do not produce an invisible label',
    run() {
      assert.equal(readableOn('#fff'), '#17131F');
      assert.equal(readableOn('#000'), '#FFFFFF');
      // Anything unreadable falls back to white, which is what every one of
      // these buttons had before and is wrong only on a near-white fill.
      assert.equal(readableOn('rgba(0,0,0,0.5)'), '#FFFFFF');
      assert.equal(readableOn(''), '#FFFFFF');
    },
  },
];
