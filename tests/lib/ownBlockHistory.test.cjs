const assert = require('node:assert/strict');

const {
  formatLastOwnBlock,
  normalizeOwnBlockStats,
  recordOwnBlock,
} = require('../../src/lib/ownBlockHistory');

module.exports = [
  {
    name: 'own-block stats survive whatever an older install stored',
    run() {
      assert.deepEqual(normalizeOwnBlockStats(undefined), {});
      assert.deepEqual(normalizeOwnBlockStats(null), {});
      assert.deepEqual(normalizeOwnBlockStats('4:20'), {});
      // An array is an object; it is still not this.
      assert.deepEqual(normalizeOwnBlockStats([]), {});
      // Junk inside a real shape drops out rather than reaching the screen.
      assert.deepEqual(
        normalizeOwnBlockStats({ warmup: { lastSeconds: 'x' }, cooldown: null, legs: { count: 9 } }),
        {},
      );
      assert.deepEqual(normalizeOwnBlockStats({ warmup: { lastSeconds: 260.4 } }), {
        warmup: { lastSeconds: 260 },
      });
      // An install from before the offer was removed also stored a count. It
      // is dropped rather than carried forward.
      assert.deepEqual(normalizeOwnBlockStats({ warmup: { lastSeconds: 260, count: 7 } }), {
        warmup: { lastSeconds: 260 },
      });
    },
  },
  {
    name: 'a recorded block sets the mark, unless it was a mis-tap',
    run() {
      const first = recordOwnBlock({}, 'warmup', 260);
      assert.deepEqual(first, { warmup: { lastSeconds: 260 } });
      const second = recordOwnBlock(first, 'warmup', 134);
      assert.deepEqual(second, { warmup: { lastSeconds: 134 } });
      // The other phase keeps its own mark.
      const both = recordOwnBlock(second, 'cooldown', 90);
      assert.deepEqual(both.warmup, { lastSeconds: 134 });
      assert.deepEqual(both.cooldown, { lastSeconds: 90 });
      // Four seconds is a mis-tap, not a warm-up: it must not become the mark
      // the next session is measured against.
      assert.deepEqual(recordOwnBlock(second, 'warmup', 4), second);
      assert.deepEqual(recordOwnBlock(second, 'warmup', Number.NaN), second);
      // And the input is not mutated.
      assert.deepEqual(first, { warmup: { lastSeconds: 260 } });
    },
  },
  {
    name: 'the last-time line is a clock, and absent before there is one',
    run() {
      assert.equal(formatLastOwnBlock({ warmup: { lastSeconds: 260 } }, 'warmup', 'en'), 'Last time you took 4:20');
      assert.equal(formatLastOwnBlock({ warmup: { lastSeconds: 260 } }, 'warmup', 'fi'), 'Viime kerralla käytit 4:20');
      // Seconds pad, so 4:05 is never "4:5".
      assert.equal(formatLastOwnBlock({ warmup: { lastSeconds: 245 } }, 'warmup', 'en'), 'Last time you took 4:05');
      assert.equal(formatLastOwnBlock({}, 'warmup', 'en'), null);
      assert.equal(formatLastOwnBlock({ cooldown: { lastSeconds: 90 } }, 'warmup', 'en'), null);
    },
  },
];
