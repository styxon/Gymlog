const assert = require('assert');
const fs = require('fs');
const path = require('path');

const componentSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'PrimaryCTAButton.tsx'),
  'utf8',
);
const welcomeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'WelcomeScreen.tsx'),
  'utf8',
);

module.exports = [
  {
    name: 'PrimaryCTAButton is the flat violet CTA, dimmed when disabled, with an optional hint',
    run() {
      assert.match(componentSource, /interface PrimaryCTAButtonProps/);
      assert.match(componentSource, /title: string/);
      assert.match(componentSource, /disabled\?: boolean/);
      assert.match(componentSource, /style\?: StyleProp<ViewStyle>/);
      assert.match(componentSource, /export function PrimaryCTAButton/);

      // Flat design tokens: solid purple pill, 56px tall, radius 18. The three
      // colours are the palette's own now (theme migration 2026-08-01) rather
      // than local copies of it, so the CTA can follow a theme change.
      assert.match(componentSource, /useThemedStyles\(makeStyles\)/);
      // purpleFill, the violet a white label sits on, since the accessibility
      // audit of 2026-09-21: the white "Jatka" on the dark theme's
      // purpleBright was 2.72:1. The shadow keeps purpleBright's glow.
      // (Orange for an afternoon in #382, taken back 2026-10-16.)
      assert.match(componentSource, /backgroundColor: theme\.purpleFill/);
      assert.match(componentSource, /shadowColor: theme\.purpleBright/);
      assert.match(componentSource, /color: '#FFFFFF'/);
      assert.doesNotMatch(componentSource, /theme\.orange/);
      assert.match(componentSource, /height: 56/);
      assert.match(componentSource, /borderRadius: 18/);
      assert.match(componentSource, /shadowOpacity: 0\.32/);
      assert.match(componentSource, /shadowRadius: 14/);
      assert.match(componentSource, /shadowOffset: \{ width: 0, height: 14 \}/);
      assert.match(componentSource, /fontSize: 17/);
      assert.match(componentSource, /fontWeight: '800'/);

      // Disabled is the same violet dimmed, never a grey swap.
      assert.match(componentSource, /buttonDisabled:\s*\{\s*opacity: 0\.4,\s*shadowOpacity: 0,\s*elevation: 0/);

      // A disabled button can say what it waits for, on a line under it.
      assert.match(componentSource, /hint\?: string \| null/);
      assert.match(componentSource, /const withHint = disabled && Boolean\(hint\);/);
      assert.match(componentSource, /if \(!withHint\) \{\s*return button;/);
      // With the hint, the caller's style moves to the wrapper, not the button.
      assert.match(componentSource, /withHint \? null : style,/);
      assert.match(componentSource, /<View style=\{\[styles\.withHint, style\]\}>/);

      // No gradient remnants and no forced uppercase.
      assert.doesNotMatch(componentSource, /LinearGradient|Svg|gradientStops|toUpperCase|textTransform/);

      // Press feedback stays subtle (slight opacity/scale).
      assert.match(componentSource, /Animated\.timing\(pressProgress/);
      assert.match(componentSource, /outputRange: \[1, 0\.98\]/);
      assert.match(componentSource, /outputRange: \[1, 0\.92\]/);

      // Welcome no longer has a local CTA of its own: the Vinha design cut the
      // email sign-up, the feature row and the account link, leaving the two
      // providers and the tagline (2026-08-01). It still must not reach for
      // PrimaryCTAButton — that one belongs to onboarding.
      assert.doesNotMatch(welcomeSource, /PrimaryCTAButton/);
      assert.doesNotMatch(welcomeSource, /welcome\.signUpEmail/);
      assert.doesNotMatch(welcomeSource, /welcome\.haveAccount/);
      assert.doesNotMatch(welcomeSource, /welcome\.feature\./);
    },
  },
];
