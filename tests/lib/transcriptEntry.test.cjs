const assert = require('node:assert/strict');

const { LOG_ID_PATTERN, randomLogId } = require('../../.test-dist/lib/aiCoachLogId.js');

// The reader endpoint (api/transcripts.ts) and the helpers that shaped its
// answers were removed before release (2026-10-09, docs/play-data-safety.md
// §3). What stays is the label: the forget route still accepts it.
module.exports = [
  {
    name: 'transcript entry: a minted label is one the server accepts',
    run() {
      for (let index = 0; index < 50; index += 1) {
        assert.match(randomLogId(), LOG_ID_PATTERN);
      }
    },
  },
];
