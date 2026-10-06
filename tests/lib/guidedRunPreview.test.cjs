const assert = require('node:assert/strict');

const { fitRunPreview } = require('../../.test-dist/lib/guidedRunPreview.js');

const ROW = 30;
const HEAD = 28;

module.exports = [
  {
    name: 'walk-up contents: every row when the space holds them all',
    run() {
      assert.deepEqual(
        fitRunPreview({ count: 6, currentIndex: 2, availableHeight: HEAD + 6 * ROW, headHeight: HEAD, rowHeight: ROW }),
        { start: 0, end: 6, hidden: 0 },
      );
    },
  },
  {
    name: 'walk-up contents: when not all fit, the lift walked up to and what follows, plus a "+N" line',
    run() {
      // Room for 5 rows of 12: 4 real rows and the "+N" line.
      const fit = fitRunPreview({ count: 12, currentIndex: 3, availableHeight: HEAD + 5 * ROW + 7, headHeight: HEAD, rowHeight: ROW });
      assert.deepEqual(fit, { start: 3, end: 7, hidden: 8 });
      // Rows plus the "+N" line never exceed the space.
      const shown = fit.end - fit.start;
      assert.ok(HEAD + (shown + 1) * ROW <= HEAD + 5 * ROW + 7);
    },
  },
  {
    name: 'walk-up contents: near the end, done rows fill in from above, the window stays contiguous',
    run() {
      const fit = fitRunPreview({ count: 9, currentIndex: 8, availableHeight: HEAD + 4 * ROW, headHeight: HEAD, rowHeight: ROW });
      // 4 rows: 3 real and the "+N" line; the last lift and the two before it.
      assert.deepEqual(fit, { start: 6, end: 9, hidden: 6 });
      assert.ok(fit.start <= 8 && 8 < fit.end, 'the current row is always shown');
    },
  },
  {
    name: 'walk-up contents: nothing at all when not one real row fits (320 × 640 phone), never a partial block',
    run() {
      for (const available of [-200, 0, HEAD, HEAD + ROW, HEAD + 2 * ROW - 1]) {
        assert.equal(
          fitRunPreview({ count: 9, currentIndex: 0, availableHeight: available, headHeight: HEAD, rowHeight: ROW }),
          null,
          String(available),
        );
      }
      // A one-row session in a one-row space is the whole session, not a "+0".
      assert.deepEqual(
        fitRunPreview({ count: 1, currentIndex: 0, availableHeight: HEAD + ROW, headHeight: HEAD, rowHeight: ROW }),
        { start: 0, end: 1, hidden: 0 },
      );
      assert.equal(fitRunPreview({ count: 0, currentIndex: -1, availableHeight: 999, headHeight: HEAD, rowHeight: ROW }), null);
      assert.equal(
        fitRunPreview({ count: 4, currentIndex: 0, availableHeight: Number.NaN, headHeight: HEAD, rowHeight: ROW }),
        null,
      );
    },
  },
  {
    name: 'walk-up contents: no current row starts from the top',
    run() {
      assert.deepEqual(
        fitRunPreview({ count: 10, currentIndex: -1, availableHeight: HEAD + 4 * ROW, headHeight: HEAD, rowHeight: ROW }),
        { start: 0, end: 3, hidden: 7 },
      );
    },
  },
  {
    name: 'walk-up contents: every shape of space and session stays inside the space and keeps the current row',
    run() {
      for (let count = 1; count <= 16; count += 1) {
        for (let current = -1; current < count; current += 1) {
          for (let available = 0; available <= HEAD + 18 * ROW; available += 7) {
            const fit = fitRunPreview({ count, currentIndex: current, availableHeight: available, headHeight: HEAD, rowHeight: ROW });
            if (!fit) {
              continue;
            }
            const shown = fit.end - fit.start;
            const lines = shown + (fit.hidden > 0 ? 1 : 0);
            assert.ok(HEAD + lines * ROW <= available, `overflow ${count}/${current}/${available}`);
            assert.ok(fit.start >= 0 && fit.end <= count && shown >= 1);
            assert.equal(fit.hidden, count - shown);
            if (current >= 0) {
              assert.ok(fit.start <= current && current < fit.end, `current hidden ${count}/${current}/${available}`);
            }
          }
        }
      }
    },
  },
];
