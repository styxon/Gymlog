const assert = require('node:assert/strict');
const { canContinueLocation, firstMissingLocation } = require('../../src/lib/locationStepRules');

module.exports = [
  {
    name: 'location step: nothing chosen waits for a place',
    run() {
      assert.equal(canContinueLocation({ selectedId: null, itemCount: 0 }), false);
      assert.equal(firstMissingLocation({ selectedId: null, itemCount: 3 }), 'location');
    },
  },
  {
    name: 'location step: full gym and bodyweight are complete answers',
    run() {
      assert.equal(canContinueLocation({ selectedId: 'full_gym', itemCount: 8 }), true);
      assert.equal(canContinueLocation({ selectedId: 'bodyweight_only', itemCount: 0 }), true);
      assert.equal(firstMissingLocation({ selectedId: 'bodyweight_only', itemCount: 0 }), null);
    },
  },
  {
    name: 'location step: home equipment needs at least one item',
    run() {
      assert.equal(canContinueLocation({ selectedId: 'home_gym', itemCount: 0 }), false);
      assert.equal(firstMissingLocation({ selectedId: 'home_gym', itemCount: 0 }), 'equip');
      assert.equal(canContinueLocation({ selectedId: 'home_gym', itemCount: 1 }), true);
      assert.equal(firstMissingLocation({ selectedId: 'home_gym', itemCount: 4 }), null);
    },
  },
];
