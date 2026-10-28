const assert = require('node:assert/strict');

const {
  ANALYTICS_READ_CONCURRENCY,
  ANALYTICS_READ_PAGE_MAX,
  ANALYTICS_SINCE_PATTERN,
  inChunks,
  selectEventBatches,
} = require('../../src/lib/analyticsRead');

const blob = (day, time) => `events/${day}/${day}T${time}-000Z-abc123.json`;

// Listed out of order on purpose: the store promises no order.
const STORED = [
  blob('2026-09-05', '08-00-00'),
  blob('2026-08-31', '23-00-00'),
  blob('2026-09-01', '07-00-00'),
  blob('2026-10-02', '12-00-00'),
  blob('2026-09-01', '06-00-00'),
  'backups/some-account.json.gz',
  'transcripts/2026-09-02/1.json',
];

module.exports = [
  {
    name: 'analytics read: since is a lower bound on the day, never the only day',
    run() {
      // `since` used to be the list prefix: "since 1 September" read
      // 1 September and nothing after it.
      assert.deepEqual(selectEventBatches(STORED, '2026-09-01'), [
        blob('2026-09-01', '06-00-00'),
        blob('2026-09-01', '07-00-00'),
        blob('2026-09-05', '08-00-00'),
        blob('2026-10-02', '12-00-00'),
      ]);
      // A month is a lower bound too.
      assert.equal(selectEventBatches(STORED, '2026-09').length, 4);
      // No since: every event batch, oldest first, and nothing from another folder.
      const all = selectEventBatches(STORED);
      assert.equal(all.length, 5);
      assert.equal(all[0], blob('2026-08-31', '23-00-00'));
      assert.ok(all.every((pathname) => pathname.startsWith('events/')));

      assert.match('2026-09-01', ANALYTICS_SINCE_PATTERN);
      assert.match('2026-09', ANALYTICS_SINCE_PATTERN);
      assert.doesNotMatch('1.9.2026', ANALYTICS_SINCE_PATTERN);
    },
  },
  {
    name: 'analytics read: a page stays under the response limit, and blobs are read in runs',
    run() {
      assert.equal(ANALYTICS_READ_PAGE_MAX, 500);
      assert.equal(ANALYTICS_READ_CONCURRENCY, 25);
      const items = Array.from({ length: 60 }, (_, index) => index);
      const chunks = inChunks(items, ANALYTICS_READ_CONCURRENCY);
      assert.deepEqual(chunks.map((chunk) => chunk.length), [25, 25, 10]);
      assert.deepEqual(chunks.flat(), items, 'in order, nothing lost');
      assert.deepEqual(inChunks([], 25), []);
    },
  },
];
