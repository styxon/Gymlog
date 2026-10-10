const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { HG } = require('../../.test-dist/lightTheme.js');
const { HG_DARK } = require('../../.test-dist/darkTheme.js');
const { PRO_SURFACE, PRO_TIER } = require('../../.test-dist/theme.js');
const { contrastRatio, compositeOver, WCAG_AA_TEXT, WCAG_AA_LARGE } = require('../helpers/contrast.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8');

/**
 * The palette, measured.
 *
 * The accessibility audit of 2026-09-21 found text under WCAG AA on both
 * themes: white on the light theme's green "do the thing" fill at 3.30:1, the
 * light `faint` ink at 3.08 on its own page, white on the dark theme's violets
 * at 2.72–3.49, the rest bar's labels at 2.6, the paywall's tier tabs at 2.6.
 * Every pair below is a real one — a token the app paints text in, on the
 * token or the surface it is painted on — and the ratio is computed from the
 * values in the palette files, so a later edit to a token is measured against
 * the same line the day it is made.
 *
 * 4.5:1 is the bar for body text; 3:1 for a filled control's edge against the
 * page (WCAG 1.4.11).
 */
const THEMES = [
  ['light', HG],
  ['dark', HG_DARK],
];

function atLeast(ratio, floor, what) {
  assert.ok(ratio >= floor, `${what}: ${ratio.toFixed(2)}:1, needs ${floor}:1`);
}

module.exports = [
  {
    name: 'contrast: the helper agrees with published WCAG ratios',
    run() {
      // Anchors, so a broken formula cannot pass everything below.
      assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(2), '21.00');
      assert.equal(contrastRatio('#FFFFFF', '#FFFFFF').toFixed(2), '1.00');
      // #767676 on white is the classic 4.54:1 grey.
      assert.equal(contrastRatio('#767676', '#FFFFFF').toFixed(2), '4.54');
      // The audit's own number for the old light CTA, reproduced.
      assert.equal(contrastRatio('#FFFFFF', '#16A34A').toFixed(2), '3.30');
      // A translucent foreground is composited over its ground first.
      assert.equal(compositeOver('rgba(255,255,255,0.5)', '#000000'), '#808080');
      assert.throws(() => contrastRatio('#FFFFFF', 'rgba(0,0,0,0.5)'), /opaque/);
    },
  },
  {
    name: 'contrast: white on the light theme\'s "do the thing" green reads',
    run() {
      // "Kirjaa sarja", the session's start button, the edit sheet's Save:
      // `accent` fill, `onHighlight` label. 17px — body text, not large.
      atLeast(contrastRatio(HG.onHighlight, HG.accent), WCAG_AA_TEXT, 'light onHighlight on accent');
      // Dark keeps its own pair: near-black on orange.
      atLeast(contrastRatio(HG_DARK.onHighlight, HG_DARK.accent), WCAG_AA_TEXT, 'dark onHighlight on accent');
      // And the accent is still a green, a step off the `green` that means done.
      assert.notEqual(HG.accent, HG.green);
      const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(HG.accent.slice(offset, offset + 2), 16));
      assert.ok(g > r && g > b, 'the light accent is still green');
    },
  },
  {
    name: 'contrast: faint text reads on every light surface it sits on',
    run() {
      // `faint` is text in about 170 places: dates, counts, meta lines.
      for (const [name, theme] of THEMES) {
        for (const ground of ['bg', 'surface', 'surfaceSoft']) {
          atLeast(contrastRatio(theme.faint, theme[ground]), WCAG_AA_TEXT, `${name} faint on ${ground}`);
        }
        // Still a step below muted, or the two inks stop meaning two things.
        assert.ok(
          contrastRatio(theme.muted, theme.surface) > contrastRatio(theme.faint, theme.surface),
          `${name}: faint must stay quieter than muted`,
        );
      }
    },
  },
  {
    name: 'contrast: white on the violet fill reads in both themes, and the fill still reads as a shape',
    run() {
      for (const [name, theme] of THEMES) {
        atLeast(contrastRatio('#FFFFFF', theme.purpleFill), WCAG_AA_TEXT, `${name} white on purpleFill`);
        atLeast(contrastRatio(theme.purpleFill, theme.surface), WCAG_AA_LARGE, `${name} purpleFill against surface`);
      }
      // Light is unchanged by the token: it IS the violet light already used.
      assert.equal(HG.purpleFill, HG.purple);
      // Dark's text violets stay text violets: the fill did not replace them.
      atLeast(contrastRatio(HG_DARK.purple, HG_DARK.surface), WCAG_AA_TEXT, 'dark purple as text on surface');
    },
  },
  {
    name: 'contrast: the rest screen\'s green and amber words, and danger ink, read on a surface',
    run() {
      // GhostBtn paints its label and outline in the tint, on `surface`.
      for (const [name, theme] of THEMES) {
        for (const ink of ['greenInk', 'amberInk', 'danger']) {
          atLeast(contrastRatio(theme[ink], theme.surface), WCAG_AA_TEXT, `${name} ${ink} on surface`);
        }
      }
      // Danger is also text on the page itself ("Delete programme" under a
      // list): light #DC2626 was 4.10:1 there (2026-09-26).
      for (const [name, theme] of THEMES) {
        atLeast(contrastRatio(theme.danger, theme.bg), WCAG_AA_TEXT, `${name} danger on bg`);
      }
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      assert.match(player, /label="\+15s"\s+tint=\{theme\.greenInk\}/);
      assert.match(player, /icon=\{paused \? 'play' : 'pause'\}\s+tint=\{theme\.amberInk\}/);
    },
  },
  {
    name: 'contrast: the rest bar\'s labels read on its violet, in both themes',
    run() {
      const bar = read('src', 'components', 'RestBar.tsx');
      const styles = bar.slice(bar.indexOf('const makeStyles ='));
      const block = (key) => {
        const match = new RegExp(`\\n  ${key}: \\{([^}]*)\\}`).exec(styles);
        assert.ok(match, `${key} not found in RestBar`);
        return match[1];
      };
      const colourIn = (key, prop) => {
        const match = new RegExp(`${prop}: '([^']+)'`).exec(block(key));
        assert.ok(match, `${key}.${prop} is not a literal colour`);
        return match[1];
      };
      // The bar's fill is the token white is written on.
      assert.match(block('bar'), /backgroundColor: theme\.purpleFill,/);
      const pillWash = colourIn('pill', 'backgroundColor');
      for (const [name, theme] of THEMES) {
        const fill = theme.purpleFill;
        atLeast(contrastRatio(colourIn('eyebrow', 'color'), fill), WCAG_AA_TEXT, `${name} rest eyebrow`);
        atLeast(contrastRatio(colourIn('endsAt', 'color'), fill), WCAG_AA_TEXT, `${name} "ends" line`);
        atLeast(contrastRatio('#FFFFFF', compositeOver(pillWash, fill)), WCAG_AA_TEXT, `${name} ±15s pill`);
      }
      // The done state is a fixed dark bar with a green pill lettered white.
      atLeast(contrastRatio('#FFFFFF', colourIn('pillDone', 'backgroundColor')), WCAG_AA_TEXT, 'done pill');
    },
  },
  {
    name: 'contrast: the paywall\'s quiet lines and tier tabs read on its dark ground',
    run() {
      // Sub-lines on the benefit card (a 72 % dark glass over the sky) and on
      // the plan tiles (4.5 % white over black at the foot).
      for (const [tier, skin] of Object.entries(PRO_TIER)) {
        const card = compositeOver(PRO_SURFACE.card, skin.sky[0]);
        atLeast(contrastRatio(PRO_SURFACE.inkFaint, card), WCAG_AA_TEXT, `${tier} benefit sub-line`);
      }
      const tile = compositeOver(PRO_SURFACE.tile, '#000000');
      atLeast(contrastRatio(PRO_SURFACE.inkFaint, tile), WCAG_AA_TEXT, 'price sub-line');

      // The tabs you are not on, on the sky under the segment's 6 % wash.
      const premium = read('src', 'screens', 'PremiumScreen.tsx');
      const segmentText = /segmentText: \{[^}]*color: '([^']+)'/.exec(premium);
      assert.ok(segmentText, 'segmentText colour not found');
      for (const [tier, skin] of Object.entries(PRO_TIER)) {
        const ground = compositeOver('rgba(255,255,255,0.06)', skin.sky[0]);
        atLeast(contrastRatio(segmentText[1], ground), WCAG_AA_TEXT, `${tier} unselected tier tab`);
      }
    },
  },
  {
    name: 'contrast: onboarding letters white on a fill, not on its dark text violet',
    run() {
      // Onboarding paints from its own palette. Its dark `primary` is the text
      // violet (#9B6DFF), and the chosen day, level, focus row and place card
      // were filled with it under white type: 3.49:1 (2026-09-26).
      const source = read('src', 'screens', 'OnboardingScreen.tsx').replace(/\r\n/g, '\n');
      const palette = (name) => {
        const match = new RegExp(`const ${name}: OnbPalette = \\{([\\s\\S]*?)\\n\\};`).exec(source);
        assert.ok(match, `${name} not found`);
        return match[1];
      };
      assert.match(palette('ONB_DARK'), /\n  primaryFill: HG_DARK\.purpleFill,/);
      assert.match(palette('ONB_LIGHT'), /\n  primaryFill: '#7C3AED',/);
      atLeast(contrastRatio('#FFFFFF', HG_DARK.purpleFill), WCAG_AA_TEXT, 'onboarding dark white on primaryFill');
      atLeast(contrastRatio('#FFFFFF', '#7C3AED'), WCAG_AA_TEXT, 'onboarding light white on primaryFill');
      // The card's second line is 85 % white on the same fill.
      for (const fill of [HG_DARK.purpleFill, '#7C3AED']) {
        atLeast(
          contrastRatio(compositeOver('rgba(255,255,255,0.85)', fill), fill),
          WCAG_AA_TEXT,
          `onboarding card subtitle on ${fill}`,
        );
      }

      // Each style lettered white, and the fill under it.
      const styles = source.slice(source.indexOf('const makeOnboardingStyles ='));
      const block = (key) => {
        const match = new RegExp(`\\n  ${key}: \\{([^}]*)\\}`).exec(styles);
        assert.ok(match, `${key} not found`);
        return match[1];
      };
      for (const key of [
        'daysChipActive',
        'daysWeekCellActive',
        'focusListRowActive',
        'locationChoiceCardActive',
        'levelSliderThumb',
        'equipmentExpandedCheck',
      ]) {
        assert.match(block(key), /backgroundColor: C\.primaryFill,/, `${key} is filled with the text violet`);
      }
    },
  },
  {
    name: 'contrast: the weekly read words its status in the theme inks, not the paywall dots',
    run() {
      // PW green / amber were 3.30 / 3.19:1 as text on a light card, PW red
      // 3.64 on a dark one (2026-09-26). The dot keeps PW; the word reads.
      const progress = read('src', 'screens', 'ProgressScreen.tsx').replace(/\r\n/g, '\n');
      assert.match(progress, /\{ dot: PW\.green, soft: PW\.greenSoft, ink: theme\.greenInk \}/);
      assert.match(progress, /\{ dot: PW\.amber, soft: PW\.amberSoft, ink: theme\.amberInk \}/);
      assert.match(progress, /\{ dot: PW\.red, soft: PW\.redSoft, ink: theme\.danger \}/);
      assert.match(progress, /<Text style=\{\[styles\.readStatus, \{ color: tone\.ink \}\]\}>\{row\.status\}<\/Text>/);
      for (const [name, theme] of THEMES) {
        for (const ink of ['greenInk', 'amberInk', 'danger']) {
          atLeast(contrastRatio(theme[ink], theme.surface), WCAG_AA_TEXT, `${name} ${ink} on the read's card`);
        }
      }
    },
  },
  {
    name: 'contrast: no screen keeps a private copy of an ink the audit darkened',
    run() {
      // #9A93AC was a light "faint" copied into four palettes (onboarding,
      // about you, the ready catalog, welcome) at 2.94:1 on white; #C0392B a
      // light-surface red used as text on the dark card at 3.23:1. They read
      // the tokens now, so a token fix reaches them.
      const offenders = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
          const rel = `${dir}/${entry.name}`;
          if (entry.isDirectory()) {
            walk(rel);
          } else if (/\.tsx?$/.test(entry.name)) {
            const source = read(rel)
              .replace(/\/\*[\s\S]*?\*\//g, '')
              .replace(/\/\/.*$/gm, '');
            if (/#9A93AC/i.test(source)) {
              offenders.push(`${rel}: #9A93AC`);
            }
          }
        }
      };
      walk('src');
      assert.deepEqual(offenders, []);

      assert.match(read('src', 'components', 'SettingsUi.tsx'), /setTitleDanger: \{\s*color: theme\.danger,/);
      const settings = read('src', 'screens', 'SettingsScreen.tsx')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(settings, /#C0392B/);
      assert.match(settings, /danger && \{ color: theme\.danger \}/);
    },
  },
  {
    name: 'contrast: white is not written on the text violets',
    run() {
      // A style that fills with `purple`, `purpleBright` or `purpleDark`
      // followed directly by a style lettered white is the shape all of these
      // took — button, then its label. In dark those three violets are text
      // colours, and white on them is 2.7–4.2:1. The label's fill is
      // `purpleFill`.
      const offenders = [];
      for (const dir of ['src/screens', 'src/components']) {
        for (const entry of fs.readdirSync(path.join(ROOT, dir))) {
          if (!entry.endsWith('.tsx')) continue;
          const source = read(dir, entry);
          // One level of nesting inside a style, for shadowOffset: { … } —
          // without it every button with a shadow slipped past unread.
          const blocks = [...source.matchAll(/\n\s+(\w+): \{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)];
          for (let index = 0; index < blocks.length - 1; index += 1) {
            const [, name, body] = blocks[index];
            const [, nextName, nextBody] = blocks[index + 1];
            // Large text needs only 3:1, which white on all three clears
            // (the 36px initials on a preset's placeholder, for one).
            const size = Number(/fontSize: ([\d.]+)/.exec(nextBody)?.[1] ?? 0);
            const weight = Number(/fontWeight: '(\d+)'/.exec(nextBody)?.[1] ?? 400);
            const large = size >= 24 || (size >= 18.66 && weight >= 700);
            if (
              !large &&
              /backgroundColor: theme\.purple(Bright|Dark)?,/.test(body) &&
              /\bcolor: '(#FFFFFF|#fff|#FFF|white)'/.test(nextBody)
            ) {
              offenders.push(`${dir}/${entry}: ${name} → ${nextName}`);
            }
          }
        }
      }
      assert.deepEqual(offenders, [], 'white label on a text violet — fill it with theme.purpleFill');

      // And the shared buttons the audit named, by name.
      assert.match(read('src', 'components', 'ConfirmDialog.tsx'), /primaryButton: \{[^}]*backgroundColor: theme\.purpleFill,/);
      assert.match(read('src', 'components', 'CutButton.tsx'), /variant === 'primary'\s*\?\s*theme\.purpleFill/);
      assert.match(read('src', 'components', 'PrimaryCTAButton.tsx'), /button: \{[^}]*backgroundColor: theme\.purpleFill,/);
      const freestyle = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      // Its add sheet is the shared AddExerciseSheet now (#bugs 2026-10-10),
      // whose chips and commit bar are checked with that component.
      for (const style of ['emptyCta', 'finishButton']) {
        assert.match(
          freestyle,
          new RegExp(`\\n  ${style}: \\{[^}]*backgroundColor: theme\\.purpleFill,`),
          `freestyle ${style} is not on purpleFill`,
        );
      }
    },
  },
];
