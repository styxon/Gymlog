const assert = require('node:assert/strict');

const {
  buildWelcomeMarqueeRows,
  marqueeDurationMs,
  WELCOME_TILE_SWATCHES,
} = require('../../src/lib/welcomeMarquee');

const CATALOG = [
  { id: 'gainer_huge_builder', title: 'HUGE Builder' },
  { id: 'gainer_reset_yoga', title: 'RESET Yoga' },
  { id: 'gainer_strong_pro', title: 'STRONG Pro' },
  { id: 'gainer_huge_pro', title: 'HUGE Pro' },
  { id: 'gainer_mobility_flow', title: 'Mobility Flow' },
];

module.exports = [
  {
    name: 'programmes are dealt across the rows, not sliced into them',
    run() {
      const rows = buildWelcomeMarqueeRows(CATALOG, 2);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows[0].map((tile) => tile.title), ['HUGE Builder', 'STRONG Pro', 'Mobility Flow']);
      assert.deepEqual(rows[1].map((tile) => tile.title), ['RESET Yoga', 'HUGE Pro']);
    },
  },
  {
    /**
     * The first screen must not promise programmes the app does not have —
     * the seed-data lie with better art. No catalog, no tiles.
     */
    name: 'an empty catalog draws empty rows rather than invented tiles',
    run() {
      const rows = buildWelcomeMarqueeRows([], 3);
      assert.equal(rows.length, 3);
      assert.ok(rows.every((row) => row.length === 0));
    },
  },
  {
    /**
     * Three brand colours, not one per programme. The identity hue is right on
     * the browse screen and wrong on a wall of twenty-eight tiles.
     */
    name: 'tiles wear the three brand swatches in turn, and nothing else',
    run() {
      const [row] = buildWelcomeMarqueeRows(CATALOG, 1);
      const used = new Set(row.map((tile) => tile.from));
      assert.equal(used.size, WELCOME_TILE_SWATCHES.length);
      for (const tile of row) {
        assert.ok(
          WELCOME_TILE_SWATCHES.some((swatch) => swatch.from === tile.from && swatch.ink === tile.ink),
          `${tile.title} should wear a brand swatch with its own ink`,
        );
        // The motif is the one thing still saying which programme this is.
        assert.ok(tile.motif.length > 0);
      }
    },
  },
  {
    /**
     * White on the orange swatch is about 2:1 — the same reason the dark
     * theme's onHighlight is near-black. Ink travels with the swatch so it
     * cannot be forgotten at a call site.
     */
    name: 'the orange swatch never carries white text',
    run() {
      const orange = WELCOME_TILE_SWATCHES.find((swatch) => swatch.from.toUpperCase() === '#FF8A4C');
      assert.ok(orange, 'the orange swatch should still exist');
      assert.notEqual(orange.ink.toUpperCase(), '#FFFFFF');
      // The pale swatch is the one with an edge — it is the only one that needs
      // one, because it sits on a pale screen and would otherwise read as a
      // hole rather than a tile.
      const pale = WELCOME_TILE_SWATCHES.filter((swatch) => swatch.border);
      assert.equal(pale.length, 1, 'exactly one swatch is the pale one');
      assert.notEqual(pale[0].ink.toUpperCase(), '#FFFFFF');
    },
  },
  {
    name: 'a row of zero is still a row',
    run() {
      const rows = buildWelcomeMarqueeRows(CATALOG, 0);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].length, CATALOG.length);
    },
  },
  {
    name: 'a longer row takes longer, so both rows drift at one speed',
    run() {
      const short = marqueeDurationMs(4, 118, 10, 22);
      const long = marqueeDurationMs(8, 118, 10, 22);
      assert.ok(long > short);
      // Twice the tiles, twice the time — same pixels per second. Within a
      // millisecond, because the result is rounded to whole ones.
      assert.ok(Math.abs(long - short * 2) <= 2, `${long} should be twice ${short}`);
    },
  },
];
