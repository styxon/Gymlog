const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');

const {
  getDefaultCooldown,
  getDefaultWarmup,
  listRoutineDrillOptions,
  routineDrillSlotKey,
} = require('../../src/lib/homeSessionHero');

module.exports = [
  {
    name: 'a swapped warm-up drill replaces the slot it was picked for, and nothing else',
    run() {
      const before = getDefaultWarmup('upper', 'en');
      assert.ok(before.drills.length >= 2, 'the fixture needs a drill to swap and one to leave');

      // Something from the pool that is not already standing in slot 0.
      const pool = listRoutineDrillOptions('warmup', 'en');
      const replacement = pool.find((drill) => drill.key !== before.drills[0].key);
      assert.ok(replacement, 'the pool should offer more than the slot already holds');

      const after = getDefaultWarmup('upper', 'en', null, {
        [routineDrillSlotKey('warmup', 'upper', 0)]: replacement.key,
      });

      assert.equal(after.drills[0].key, replacement.key);
      assert.equal(after.drills[0].name, replacement.name);
      // Its neighbours are untouched, and the block is still the same length.
      assert.equal(after.drills.length, before.drills.length);
      assert.deepEqual(after.drills.slice(1), before.drills.slice(1));
    },
  },
  {
    name: 'the slot key names a block, a focus and a position — nothing bleeds across them',
    run() {
      const overrides = {
        [routineDrillSlotKey('warmup', 'upper', 0)]: 'home.drill.catCamel',
      };

      // Another focus keeps its own warm-up: the key names the focus.
      assert.deepEqual(
        getDefaultWarmup('lower', 'en', null, overrides).drills,
        getDefaultWarmup('lower', 'en').drills,
      );
      // And the cool-down is a different block, even at the same focus and slot.
      assert.deepEqual(
        getDefaultCooldown('upper', 'en', null, overrides).drills,
        getDefaultCooldown('upper', 'en').drills,
      );
    },
  },
  {
    name: 'a swap survives a language change, because it stores the key and not the name',
    run() {
      const pool = listRoutineDrillOptions('warmup', 'en');
      const english = getDefaultWarmup('upper', 'en');
      const replacement = pool.find((drill) => drill.key !== english.drills[0].key);
      const overrides = { [routineDrillSlotKey('warmup', 'upper', 0)]: replacement.key };

      const finnish = getDefaultWarmup('upper', 'fi', null, overrides);
      // Same drill, read in Finnish — a stored NAME could not have done this.
      assert.equal(finnish.drills[0].key, replacement.key);
      assert.notEqual(finnish.drills[0].name, replacement.name);
    },
  },
  {
    name: 'an override naming a drill this build no longer ships falls back to the default',
    run() {
      const fallback = getDefaultWarmup('upper', 'en');
      const stale = getDefaultWarmup('upper', 'en', null, {
        [routineDrillSlotKey('warmup', 'upper', 0)]: 'home.drill.thisWasRemovedInV2',
      });
      // Not a raw key on screen, and not a hole in the block either.
      assert.deepEqual(stale.drills, fallback.drills);
    },
  },
  {
    name: 'the minutes follow the drills that are there now, not the ones that were',
    run() {
      const pool = listRoutineDrillOptions('warmup', 'en');
      const before = getDefaultWarmup('upper', 'en');
      // The longest thing in the pool, so the block cannot come out the same
      // length by accident.
      const longest = pool
        .filter((drill) => drill.key !== before.drills[0].key)
        .sort((left, right) => right.schemeLabel.length - left.schemeLabel.length)[0];

      const after = getDefaultWarmup('upper', 'en', null, {
        [routineDrillSlotKey('warmup', 'upper', 0)]: longest.key,
      });
      assert.ok(after.minutes >= 1, 'a block is never shorter than a minute');
      assert.equal(typeof after.minutes, 'number');
    },
  },
  {
    name: 'the pool is every drill the app knows for that block, each one offered once',
    run() {
      const warmups = listRoutineDrillOptions('warmup', 'en');
      const keys = warmups.map((drill) => drill.key);
      assert.equal(new Set(keys).size, keys.length, 'no drill is offered twice');
      // It reaches past the focus being edited — that is the point of a pool.
      const upperOnly = getDefaultWarmup('upper', 'en').drills.length;
      assert.ok(warmups.length > upperOnly);
      // Warm-ups and cool-downs are separate questions.
      const cooldowns = listRoutineDrillOptions('cooldown', 'en');
      assert.ok(cooldowns.length > 0);
    },
  },
  {
    /**
     * Every screen that BUILDS a block is handed the reader's picks.
     *
     * The swap showed on Home and in the day editor and never reached the one
     * screen that actually runs the drill: the player coached the drill that
     * had been replaced, and the "~50 min" estimate was computed from it too
     * (found in review, 2026-08-31). Nothing fails at runtime when a caller
     * forgets the fourth argument — the block simply comes back as the
     * default — so only this holds it.
     */
    name: 'no caller builds a warm-up or cool-down without the picks the reader made',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const root = path.join(__dirname, '..', '..');
      const { readAppWiring } = require('../helpers/appWiringSource.cjs');
      const read = (...parts) => [parts.join('/'), fs.readFileSync(path.join(root, ...parts), 'utf8')];
      const files = [
        // The whole shell, App.tsx and the src/app modules the phase-B split
        // (2026-09-30) moved VinhaApp's hooks into: a block built in a hook
        // without the picks is the same bug.
        ['App.tsx or src/app', readAppWiring()],
        ['src/screens/GuidedPlayerScreen.tsx', readGuidedPlayerSource()],
        read('src', 'screens', 'HomeScreen.tsx'),
        read('src', 'screens', 'ProgramDayScreen.tsx'),
      ];
      for (const [file, source] of files) {
        const calls = source.match(/getDefault(?:Warmup|Cooldown)\(([\s\S]*?)\)/g) || [];
        // Each of these builds both blocks. A file whose builders moved out
        // of it would otherwise pass with nothing left to check.
        assert.ok(
          calls.filter((call) => call.includes(',')).length >= 2,
          `${file} no longer builds a warm-up and a cool-down — recheck where they moved`,
        );
        for (const call of calls) {
          // The import line names them without calling them.
          if (!call.includes(',')) {
            continue;
          }
          assert.ok(
            /routineDrillOverrides/.test(call),
            `${file} builds a block without the overrides: ${call}`,
          );
        }
      }
    },
  },
];
