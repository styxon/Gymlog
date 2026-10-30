// The hand-off stays the screen until its sign-in has answered (#bugs
// 2026-10-30, both phones): let go at the write, it gave way to Home and the
// first-run tour, which opened over the account sheet and took it away.
const assert = require('node:assert/strict');
const { createSetupHandoffDone } = require('../../src/app/setupHandoffDone');

function harness(overrides = {}) {
  const log = [];
  const heldRef = { current: false };
  let held = false;
  const deps = {
    setupHandoffPlan: { offerWidget: false, phase: 'afterPro' },
    homePinnedStatCardKeys: [],
    setupHandoffHeldRef: heldRef,
    setSetupHandoffHeld: (value) => {
      held = value;
      log.push(`held:${value}`);
    },
    updatePreferences: async () => log.push('write'),
    showToast: (message) => log.push(`toast:${message}`),
    preferences: { appLanguage: 'fi' },
    requestPinHomeWidget: async () => {
      log.push(`pin held=${held}`);
      return true;
    },
    handleAccountSignIn: async (provider) => {
      log.push(`signIn:${provider} held=${held} ref=${heldRef.current}`);
      return 'backed_up';
    },
    navigate: (route) => log.push(`navigate:${route.screen} held=${held}`),
    ...overrides,
  };
  return { deps, log, heldRef, isHeld: () => held };
}

const choices = (patch = {}) => ({
  addWidget: false,
  trackedSites: [],
  signInForBackup: true,
  signInProvider: 'apple',
  showPro: false,
  legalAccepted: true,
  ...patch,
});

module.exports = [
  {
    name: 'setup hand-off: the account sheet opens while the hand-off is still held, and the hold ends after it answers',
    async run() {
      const { deps, log, heldRef, isHeld } = harness();
      await createSetupHandoffDone(deps).handleSetupHandoffDone(choices());
      assert.deepEqual(log, ['held:true', 'write', 'signIn:apple held=true ref=true', 'held:false']);
      assert.equal(isHeld(), false);
      assert.equal(heldRef.current, false);
    },
  },
  {
    name: 'setup hand-off: the widget pin dialog is held too, and the Pro page opens only after the hold ends',
    async run() {
      const { deps, log } = harness({ setupHandoffPlan: { offerWidget: true, phase: 'beforePro' } });
      await createSetupHandoffDone(deps).handleSetupHandoffDone(choices({ addWidget: true, showPro: true, signInProvider: 'google' }));
      assert.deepEqual(log.slice(0, 5), ['held:true', 'write', 'pin held=true', 'signIn:google held=true ref=true', 'held:false']);
      assert.equal(log[5], 'navigate:premium held=false');
    },
  },
  {
    name: 'setup hand-off: a sign-in that throws still lets the hand-off go, and a refused write never opens the sheet',
    async run() {
      const thrown = harness({
        handleAccountSignIn: async () => {
          throw new Error('native module gone');
        },
      });
      const originalError = console.error;
      console.error = () => {};
      try {
        await createSetupHandoffDone(thrown.deps).handleSetupHandoffDone(choices());
        assert.equal(thrown.isHeld(), false);
        assert.equal(thrown.heldRef.current, false);

        const refused = harness({
          updatePreferences: async () => {
            throw new Error('disk full');
          },
        });
        await createSetupHandoffDone(refused.deps).handleSetupHandoffDone(choices());
        assert.equal(refused.log.some((line) => line.startsWith('signIn')), false);
        assert.equal(refused.isHeld(), false);
        assert.equal(refused.heldRef.current, false);
      } finally {
        console.error = originalError;
      }
    },
  },
  {
    name: 'setup hand-off: the sign-in page says it is working while the shell holds it, and its buttons stop taking taps',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'SetupHandoffScreen.tsx'), 'utf8')
        .replace(/\r\n/g, '\n');
      // The last page's press waits for the whole Done, sign-in included.
      assert.match(screen, /setSigningIn\(true\);\s*void Promise\.resolve\(finish\(addWidget, true\)\)\.finally\(\(\) => setSigningIn\(false\)\);/);
      // Both buttons are dimmed and inert meanwhile, and a spinner stands in Skip's place.
      assert.equal((screen.match(/disabled=\{!legalReady \|\| signingIn\}/g) || []).length, 2);
      assert.equal((screen.match(/onPress=\{\(\) => signInWith\('(apple|google)'\)\}/g) || []).length, 2);
      assert.match(screen, /\{signingIn \? \(\s*<ActivityIndicator/);
    },
  },
];
