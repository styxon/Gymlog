const assert = require('node:assert/strict');

const { warmupLadder, warmupOffer } = require('../../.test-dist/lib/warmupSets');

/**
 * The "+ Warm-up set" ladder off a light working weight (bug hunt W10,
 * 2026-10-05, after #321): 5 kg offered 2.5 / 2.5 / 5 — one rung twice, then
 * the working weight itself — and a weight under a plate step offered 0 kg.
 * A warm-up is above nothing and below the work, and each one climbs.
 */

module.exports = [
  {
    name: 'W10 invariant: for every working weight 0.5-300 kg, every warm-up rung is on a plate, above 0, below the work, and climbs',
    run() {
      for (let tenths = 5; tenths <= 3000; tenths += 5) {
        const working = tenths / 10;
        const ladder = warmupLadder(working);
        let below = 0;
        ladder.forEach((rung, index) => {
          assert.ok(rung.loadKg > 0, `${working} kg rung ${index}: ${rung.loadKg} is above nothing`);
          assert.ok(rung.loadKg < working, `${working} kg rung ${index}: ${rung.loadKg} is below the work`);
          assert.ok(rung.loadKg > below, `${working} kg rung ${index}: ${rung.loadKg} climbs from ${below}`);
          assert.equal(Math.round(rung.loadKg / 2.5) * 2.5, rung.loadKg, `${working} kg: on a 2.5 kg step`);
          below = rung.loadKg;
        });
        // Anything a plate step can go under has a rung.
        assert.equal(ladder.length > 0, working > 2.5, `${working} kg: ${ladder.length} rungs`);
        // And what the button opens on, at any position, is one of them — or
        // an empty weight when there is none.
        for (let index = 0; index < 6; index += 1) {
          const offer = warmupOffer(undefined, index, working);
          if (ladder.length === 0) {
            assert.equal(offer.loadKg, null, `${working} kg #${index}`);
          } else {
            assert.ok(offer.loadKg > 0 && offer.loadKg < working, `${working} kg #${index}: ${offer.loadKg}`);
          }
        }
      }
    },
  },
  {
    name: 'W10: light lifts get fewer rungs, never the work itself; heavy ones the full 50/70/85 ladder',
    run() {
      assert.deepEqual(warmupLadder(5), [{ loadKg: 2.5, reps: 10 }], '5 kg: 2.5 once, not 2.5 / 2.5 / 5');
      assert.deepEqual(warmupLadder(10), [{ loadKg: 5, reps: 10 }, { loadKg: 7.5, reps: 6 }]);
      assert.deepEqual(warmupLadder(100), [{ loadKg: 50, reps: 10 }, { loadKg: 70, reps: 6 }, { loadKg: 85, reps: 3 }]);
      assert.deepEqual(warmupLadder(2.5), []);
      assert.deepEqual(warmupLadder(0), []);
      assert.deepEqual(warmupLadder(null), []);
      assert.deepEqual(warmupOffer(undefined, 0, 5), { loadKg: 2.5, reps: 10 });
      assert.deepEqual(warmupOffer(undefined, 2, 5), { loadKg: 2.5, reps: 10 }, 'past the ladder: its top rung again');
      assert.deepEqual(warmupOffer(undefined, 0, 2), { loadKg: null, reps: 10 }, 'nothing to climb: the reader picks');
      // Last time's warm-up is repeated only while it is under today's work.
      assert.deepEqual(warmupOffer([{ loadKg: 60, reps: 5 }], 0, 80), { loadKg: 60, reps: 5 });
      assert.deepEqual(warmupOffer([{ loadKg: 60, reps: 5 }], 0, 60), { loadKg: 30, reps: 10 });
      assert.deepEqual(warmupOffer([{ loadKg: 60, reps: 5 }], 0, 50), { loadKg: 25, reps: 10 });
    },
  },
];
