module.exports = [
  {
    name: 'shell chrome: the tab bar hides on every full-screen flow and nowhere else',
    run() {
      const assert = require('node:assert/strict');
      const { resolveShellChrome } = require('../../src/lib/shellChrome');
      const chrome = (route, over = {}) =>
        resolveShellChrome({
          route,
          onboardingActive: false,
          entryFlowActive: false,
          setupHandoffActive: false,
          ...over,
        });

      const hidden = [
        { tab: 'workout', screen: 'detail' },
        { tab: 'workout', screen: 'empty' },
        { tab: 'workout', screen: 'guided' },
        { tab: 'workout', screen: 'summary' },
        { tab: 'home', screen: 'cardio' },
        { tab: 'profile', screen: 'setup' },
        { tab: 'profile', screen: 'premium_unlock' },
        { tab: 'profile', screen: 'premium' },
        { tab: 'profile', screen: 'membership_end' },
      ];
      for (const route of hidden) {
        assert.equal(chrome(route).showTabBar, false, `${route.tab}/${route.screen}`);
      }
      for (const route of [
        { tab: 'home' },
        { tab: 'workout' },
        { tab: 'progress' },
        { tab: 'profile' },
        { tab: 'home', screen: 'session' },
      ]) {
        assert.equal(chrome(route).showTabBar, true, `${route.tab}/${route.screen}`);
      }
      // Onboarding and the setup hand-off hide it on any route.
      assert.equal(chrome({ tab: 'home' }, { onboardingActive: true }).showTabBar, false);
      assert.equal(chrome({ tab: 'home' }, { setupHandoffActive: true }).showTabBar, false);
    },
  },
  {
    name: 'shell chrome: the status-bar flags follow the route and the onboarding flags',
    run() {
      const assert = require('node:assert/strict');
      const { resolveShellChrome } = require('../../src/lib/shellChrome');
      const base = { onboardingActive: false, entryFlowActive: false, setupHandoffActive: false };

      const setup = resolveShellChrome({ ...base, route: { tab: 'profile', screen: 'setup' } });
      assert.equal(setup.setupOnboardingActive, true);
      assert.equal(setup.onboardingScreenActive, true);
      assert.equal(setup.welcomeActive, false);

      const onboarding = resolveShellChrome({ ...base, onboardingActive: true, route: { tab: 'home' } });
      assert.equal(onboarding.onboardingScreenActive, true);
      assert.equal(onboarding.setupOnboardingActive, false);
      assert.equal(onboarding.welcomeActive, false);

      const welcome = resolveShellChrome({
        ...base,
        onboardingActive: true,
        entryFlowActive: true,
        route: { tab: 'home' },
      });
      assert.equal(welcome.welcomeActive, true);
      // The entry flag alone is not the welcome screen.
      assert.equal(
        resolveShellChrome({ ...base, entryFlowActive: true, route: { tab: 'home' } }).welcomeActive,
        false,
      );

      const summary = resolveShellChrome({ ...base, route: { tab: 'workout', screen: 'summary' } });
      assert.equal(summary.workoutSummaryActive, true);
      assert.equal(summary.premiumActive, false);

      assert.equal(
        resolveShellChrome({ ...base, route: { tab: 'profile', screen: 'premium' } }).premiumActive,
        true,
      );
      assert.equal(
        resolveShellChrome({ ...base, route: { tab: 'home', screen: 'session' } }).historySessionActive,
        true,
      );
      const plain = resolveShellChrome({ ...base, route: { tab: 'progress' } });
      assert.equal(plain.historySessionActive, false);
      assert.equal(plain.workoutSummaryActive, false);
    },
  },
];
