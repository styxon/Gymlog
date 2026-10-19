const assert = require('node:assert/strict');

const { createOnceReady } = require('../../.test-dist/lib/onceReady.js');

// iPhone, G1-8: the audio mode was set fire-and-forget, so the first cue
// started on iOS's default session and cut the user's music for a moment.

module.exports = [
  {
    name: 'once ready: the setup runs once and every caller waits for it',
    async run() {
      let calls = 0;
      let release;
      const gate = createOnceReady(() => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      const events = [];
      const first = gate().then(() => events.push('first'));
      const second = gate().then(() => events.push('second'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(events, [], 'nothing plays before the mode is set');
      release();
      await Promise.all([first, second]);
      assert.deepEqual(events.slice().sort(), ['first', 'second']);
      await gate();
      assert.equal(calls, 1);
    },
  },
  {
    name: 'once ready: a failing setup still lets the cue through',
    async run() {
      const gate = createOnceReady(() => Promise.reject(new Error('native refused')));
      await gate();
    },
  },
  {
    name: 'once ready: a setup that never answers is cut off at the cap',
    async run() {
      let waitedMs = null;
      const gate = createOnceReady(
        () => new Promise(() => undefined),
        (ms) => {
          waitedMs = ms;
          return Promise.resolve();
        },
        900,
      );
      await gate();
      assert.equal(waitedMs, 900);
    },
  },
  {
    name: 'once ready: the cue sounds play only after the audio mode is awaited',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(path.join(__dirname, '../../src/utils/sound.ts'), 'utf8');
      assert.match(source, /createOnceReady\(/);
      assert.match(source, /ensureAudioMode\(\)\.then\(/);
      assert.match(source, /mixWithOthers/);
    },
  },
];
