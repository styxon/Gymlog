const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const { darkTheme, lightTheme } = require('../../.test-dist/theming.js');
const { HG } = require('../../.test-dist/lightTheme.js');
const { resolveThemeName } = require('../../.test-dist/lib/themePreference.js');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

module.exports = [
  {
    name: 'theming: the light theme is the palette, not a copy of it',
    run() {
      // A copy would drift the moment someone edits one and not the other —
      // which is exactly how nine screens ended up with a stale background.
      assert.equal(lightTheme, HG, 'lightTheme must be the same object as HG');
    },
  },
  {
    name: 'theming: every Theme token exists in the palette and vice versa',
    run() {
      // The Theme interface is what components read. If the palette grows a
      // token the interface does not declare, the first component to want it
      // has to reach around the theme — and that is how a second source of
      // truth starts.
      const source = read('src/theming.ts');
      const body = /export interface Theme \{([\s\S]*?)\n\}/.exec(source);
      assert.ok(body, 'Theme interface not found');

      const declared = [...body[1].matchAll(/^\s*(\w+):\s*string;/gm)].map((match) => match[1]).sort();
      const palette = Object.keys(HG).sort();

      assert.deepEqual(declared, palette);
    },
  },
  {
    name: 'theming: the dark theme fills exactly the same token shape',
    run() {
      // A missing token is an `undefined` colour, which React Native renders as
      // transparent rather than throwing — so it would ship as an invisible
      // element, not a crash. This is the check that cannot be skipped.
      assert.deepEqual(Object.keys(darkTheme).sort(), Object.keys(HG).sort());
      for (const [token, value] of Object.entries(darkTheme)) {
        assert.equal(typeof value, 'string', `${token} must be a colour string`);
        // Hex for solid tokens, rgba() for the washes that have to blend with
        // whatever is behind them (highlightSoft over the tab bar's pill).
        assert.match(
          value,
          /^(#[0-9A-Fa-f]{6}|rgba\([\d\s.,]+\))$/,
          `${token} must be a hex or rgba colour`,
        );
      }
    },
  },
  {
    name: 'theming: the two themes actually differ where it matters',
    run() {
      // Guards against a dark palette that was copied from the light one and
      // never finished — the failure mode would be a "dark" theme that is
      // simply the light one with a different name.
      for (const token of ['bg', 'surface', 'ink', 'muted', 'border', 'purple']) {
        assert.notEqual(darkTheme[token], HG[token], `${token} must not be shared`);
      }
      // ink/surface are an inverting pair: a black button becomes a white one.
      // If they stopped inverting, every ink-filled button would go unreadable.
      assert.ok(HG.ink < HG.surface, 'light: ink darker than surface');
      assert.ok(darkTheme.ink > darkTheme.surface, 'dark: ink lighter than surface');
    },
  },
  {
    name: 'theming: one resolver decides, and the provider still only takes a theme',
    run() {
      // The provider takes a theme; it does not decide one. Keeping the
      // entitlement out of this file is what lets a screen be rendered under
      // either theme in a test without faking a subscription.
      const source = read('src/theming.ts');
      assert.doesNotMatch(source, /isProUnlocked|promoProUntil|AppPreferences/);
      assert.match(source, /theme = lightTheme/);

      // The vestigial preference is still gone: it was typed as the single
      // value 'dark', stored 'dark', and read by nothing.
      const models = read('src/types/models.ts');
      assert.doesNotMatch(models, /ThemePreference/);
    },
  },
  {
    name: 'theming: dark is free, and no surface still consults the entitlement',
    run() {
      // The gate came off on 2026-08-23: a theme is not a feature anyone
      // subscribes for, and gating it shipped one finished palette to nobody.
      // A free account with the switch on gets dark, full stop.
      const free = { darkThemeEnabled: true, promoProUntil: null, adaptiveCoachPremiumUnlocked: false };
      assert.equal(resolveThemeName(free), 'dark', 'dark is not a paid theme any more');
      assert.equal(resolveThemeName({ ...free, darkThemeEnabled: false }), 'light');

      // The resolver reads the switch and nothing else — the entitlement
      // import is what a half-removed gate would leave behind.
      const resolver = read('src/lib/themePreference.ts');
      assert.doesNotMatch(resolver, /isProUnlocked|proEntitlement|promoProUntil/);
      assert.doesNotMatch(resolver, /resolveThemeRowState/);

      // And the ghosts: no locked row in Settings, no theme in the benefit
      // list, no theme card on the unlock screen. A removed gate that still
      // has copy selling it is the failure this guards.
      const settings = read('src/screens/SettingsScreen.tsx');
      assert.doesNotMatch(settings, /themeProPill|resolveThemeRowState|unlockDarkTheme/);
      const benefits = read('src/lib/proBenefits.ts');
      assert.doesNotMatch(benefits, /pro\.v2\.read\.theme|unlock\.theme/);
      const i18n = read('src/lib/i18n.ts');
      assert.doesNotMatch(i18n, /'pro\.v2\.read\.theme|'unlock\.theme|darkTheme\.subPro/);
    },
  },
  {
    name: 'theming: the choice is the hand-off\'s last page, and a new install starts dark',
    run() {
      // Not after "Let's begin" any more (user 2026-10-17): it put a violet
      // dialog in front of the orange welcome. Nothing in the shell opens it.
      assert.doesNotMatch(readAppWiring(), /setThemeChoiceVisible/);
      // The hand-off draws it as its 'theme' page, and its Done moves on once
      // the dialog has gone (iosModalSequencing.test.cjs).
      const handoff = read('src/screens/SetupHandoffScreen.tsx');
      assert.match(
        handoff,
        /<ThemeChoiceDialog\s+visible=\{page === 'theme' && !dialogLeaving\}[\s\S]{0,300}?onDone=\{leaveDialog\}/,
      );
      // Dark until the reader says otherwise; an old install keeps light.
      assert.match(read('src/data/seed.ts'), /darkThemeEnabled: true,/);
      assert.match(
        read('src/storage/database.ts'),
        /input\?\.preferences\?\.onboardingCompleted === true\s*\?\s*false\s*:\s*fallback\.preferences\.darkThemeEnabled/,
      );
    },
  },
  {
    name: 'animated nodes: no interpolation is shared between two views',
    run() {
      // One interpolation is one native node, and PropsAnimatedNode holds
      // exactly one connectedViewTag. Sharing one across sibling views throws
      // "Animated node N is already attached to a view" and kills the app —
      // it took down the plan-build screen on 2026-08-24, and the same shape
      // was waiting in the Home card grid. Both are keyed per index now.
      const cards = read('src/components/HomeStatCardsSection.tsx');
      assert.match(cards, /const rotateNodes = useRef\(new Map</);
      assert.match(cards, /rotate: rotateFor\(index\)/);
      assert.doesNotMatch(
        cards,
        /index % 2 === 0 \? evenRotate : oddRotate/,
        'one node on every even card is the crash this guards',
      );

      const onboarding = read('src/screens/OnboardingScreen.tsx');
      assert.match(onboarding, /buildingPlanPulseOpacities\[index\]/);
      assert.doesNotMatch(onboarding, /const buildingPlanPulse(Scale|Opacity) = useRef\(/);
    },
  },
  {
    name: 'theming: style factories are built per theme, not per render',
    run() {
      const source = read('src/theming.ts');
      assert.match(source, /WeakMap/, 'styles should be cached per factory');
      assert.match(source, /useMemo/);
    },
  },
];
