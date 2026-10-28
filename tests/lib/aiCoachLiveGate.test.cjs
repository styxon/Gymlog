const assert = require('node:assert/strict');

const {
  AI_LIVE_SPEND_CAP_CONFIRMED,
  resolveLiveAiCoachUrl,
} = require('../../src/lib/aiCoachLiveGate');

const URL = 'https://vinha.example/api/ai-coach';

module.exports = [
  {
    // The gate has one job: a release build without the human signature must
    // behave exactly like a build with no URL at all — preview mode, nothing
    // leaves the device, nothing is billed.
    name: 'a release build without the confirmed cap falls back to preview',
    run() {
      if (AI_LIVE_SPEND_CAP_CONFIRMED) {
        // Once the cap is confirmed the release path passes through; the
        // unconfirmed branch below is then unreachable by design.
        assert.equal(resolveLiveAiCoachUrl(URL, false), URL);
        return;
      }
      assert.equal(resolveLiveAiCoachUrl(URL, false), '');
    },
  },
  {
    name: 'a dev build passes the URL through so the live path can be tested',
    run() {
      assert.equal(resolveLiveAiCoachUrl(URL, true), URL);
      assert.equal(resolveLiveAiCoachUrl(`  ${URL}  `, true), URL);
    },
  },
  {
    name: 'no URL means preview mode in every build type',
    run() {
      assert.equal(resolveLiveAiCoachUrl(undefined, true), '');
      assert.equal(resolveLiveAiCoachUrl(undefined, false), '');
      assert.equal(resolveLiveAiCoachUrl('   ', true), '');
    },
  },
];
