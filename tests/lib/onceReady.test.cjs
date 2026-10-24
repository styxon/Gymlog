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
      assert.match(source, /createCueGate\(ensureAudioMode,/);
      assert.match(source, /mixWithOthers/);
    },
  },
  {
    name: 'cue gate: a cue released after its moment has passed is dropped, never stacked',
    async run() {
      const { createCueGate } = require('../../.test-dist/lib/onceReady.js');
      let clock = 0;
      let release;
      const ready = () => new Promise((resolve) => (release = resolve));
      const gate = createCueGate(ready, () => clock, 500);
      const played = [];
      gate(() => played.push('tick3'));
      clock = 1000;
      gate(() => played.push('tick2'));
      clock = 1400;
      gate(() => played.push('tick1'));
      clock = 1500; // the setup finally answers
      release();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(played, ['tick1'], 'only the cue younger than the limit plays');
    },
  },
  {
    name: 'cue gate: a cue asked for after the mode is ready plays at once',
    async run() {
      const { createCueGate } = require('../../.test-dist/lib/onceReady.js');
      const gate = createCueGate(() => Promise.resolve(), () => 0);
      const played = [];
      gate(() => played.push('go'));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(played, ['go']);
    },
  },
  {
    name: 'cue gate: the screens warm the audio mode and the sound module does not at load',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const read = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
      const sound = read('utils/sound.ts');
      assert.match(sound, /whenReady\(\(\) =>/);
      assert.doesNotMatch(sound, /^void ensureAudioMode/m);
      for (const screen of ['GuidedPlayerScreen', 'EmptyWorkoutScreen', 'CardioScreen']) {
        assert.match(read(`screens/${screen}.tsx`), /prepareCueSounds\(\);/, screen);
      }
    },
  },
];
