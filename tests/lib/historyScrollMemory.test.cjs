const assert = require('node:assert/strict');

const { clampHistoryScrollOffset, historyScrollMemoryMatches } = require('../../src/lib/historyScrollMemory');

module.exports = [
  {
    name: 'a remembered offset within the current list is restored unchanged',
    run() {
      // #bugs 2026-09-29: coming back from a session must land where the
      // reader was, not at the top.
      assert.equal(clampHistoryScrollOffset(420, 3000, 800), 420);
    },
  },
  {
    name: 'a remembered offset past the new bottom is clamped, not left wedged past the content',
    run() {
      // The list got shorter — a session was deleted while its detail was
      // open — so the old offset would scroll past the last row.
      assert.equal(clampHistoryScrollOffset(900, 1000, 800), 200);
    },
  },
  {
    name: 'a list shorter than the viewport clamps to the top, never negative',
    run() {
      assert.equal(clampHistoryScrollOffset(500, 400, 800), 0);
    },
  },
  {
    name: 'zero, negative or non-finite offsets stay at the top',
    run() {
      assert.equal(clampHistoryScrollOffset(0, 3000, 800), 0);
      assert.equal(clampHistoryScrollOffset(-40, 3000, 800), 0);
      assert.equal(clampHistoryScrollOffset(Number.NaN, 3000, 800), 0);
    },
  },
  {
    name: 'a remembered offset only matches the same search and filter it was captured under (recheck round 2026-09-29)',
    run() {
      // A tab switch away from History and back remounts the screen, which
      // resets its search box to "" — so a memory captured while the reader
      // had typed "penkki" must not be handed back once the fresh, unfiltered
      // list re-renders. #bugs report: restoring the bare offset regardless
      // landed the reader partway down rows they had never scrolled past.
      const rememberedWhileSearching = { offsetY: 800, searchQuery: 'penkki', filter: 'all' };
      assert.equal(historyScrollMemoryMatches(rememberedWhileSearching, { searchQuery: '', filter: 'all' }), false);
      assert.equal(
        historyScrollMemoryMatches(rememberedWhileSearching, { searchQuery: 'penkki', filter: 'all' }),
        true,
      );

      // Same list, different filter chip (not wired to any UI yet, but the
      // key is ready for the day one lands) — no match either.
      assert.equal(
        historyScrollMemoryMatches(
          { offsetY: 300, searchQuery: '', filter: 'all' },
          { searchQuery: '', filter: 'needs_review' },
        ),
        false,
      );

      // Nothing remembered yet (first-ever visit) — no match, same as a
      // mismatch: the list starts at the top either way.
      assert.equal(historyScrollMemoryMatches(null, { searchQuery: '', filter: 'all' }), false);
      assert.equal(historyScrollMemoryMatches(undefined, { searchQuery: '', filter: 'all' }), false);
    },
  },
];
