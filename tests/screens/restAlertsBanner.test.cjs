const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { HG } = require('../../src/lightTheme');
const { HG_DARK } = require('../../src/darkTheme');
const { contrastRatio, WCAG_AA_TEXT } = require('../helpers/contrast.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The JSX element opened by `<Name`, up to its own self-closing `/>` at the same indent. */
function elementBlock(source, name) {
  const start = source.indexOf(`<${name}\n`);
  assert.ok(start >= 0, `<${name}> not found`);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const end = source.indexOf(`\n${indent}/>`, start);
  assert.ok(end > start, `<${name}> has no closing />`);
  return source.slice(start, end);
}

/**
 * Rest alerts that will not ring are said, in both workout screens
 * (2026-09-26). The hook decided "alerts are off" for both, but only the
 * freestyle screen drew the banner; the guided player ran its rests silent.
 */
module.exports = [
  {
    name: 'rest banner: the guided player draws the banner the hook decides, with a way to fix it',
    run() {
      const player = strip(read('src', 'screens', 'GuidedPlayerScreen.tsx'));
      assert.match(
        player,
        // Through the hook's turnOn, which asks first on an iPhone that never
        // has (iOS hunt 2026-10-17, S6-2; tests/screens/restAlertsAsk.test.cjs).
        /\{restAsk\.deniedBannerShown \? \(\s*<View style=\{styles\.restDeniedBanner\}>[\s\S]{0,900}?restAsk\.dismissDeniedBanner\(\);\s*void restAsk\.turnOn\(\(\) => onOpenSystemSettings\?\.\(\)\);/,
      );
      assert.match(player, /t\(language, 'rest\.denied\.title'\)/);
      // Theme tokens, readable in both themes — the freestyle banner too, whose
      // fixed hexes put #D97706 on #FEF3E2 at 2.9:1 in either theme.
      const freestyle = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      const styles = freestyle.slice(freestyle.indexOf('const makeStyles ='));
      for (const [key, expected] of [
        ['deniedBanner', /backgroundColor: theme\.amberSoft,[\s\S]*borderColor: theme\.amberBorder,/],
        ['deniedTitle', /color: theme\.amberInk/],
        ['deniedBody', /color: theme\.ink/],
        ['deniedAction', /color: theme\.amberInk/],
      ]) {
        const block = new RegExp(`\\n  ${key}: \\{([^}]*)\\}`).exec(styles);
        assert.ok(block, `${key} not found`);
        assert.match(block[1], expected, `${key} paints a fixed colour`);
      }
      for (const [name, theme] of [['light', HG], ['dark', HG_DARK]]) {
        assert.ok(contrastRatio(theme.amberInk, theme.amberSoft) >= WCAG_AA_TEXT, `${name} amberInk on amberSoft`);
        assert.ok(contrastRatio(theme.ink, theme.amberSoft) >= WCAG_AA_TEXT, `${name} ink on amberSoft`);
      }
    },
  },
  {
    name: 'rest banner: both screens open the page that fixes it — the channel when only the channel is muted',
    run() {
      const tab = strip(read('src', 'app', 'renderWorkoutTab.tsx'));
      for (const screen of ['EmptyWorkoutScreen', 'GuidedPlayerScreen']) {
        assert.match(
          elementBlock(tab, screen),
          /onOpenSystemSettings=\{\(\) => void openRestAlertSettings\(\)\}/,
          `${screen} does not open the rest-alert settings`,
        );
      }
      const util = strip(read('src', 'utils', 'sessionNotifications.ts'));
      const opener = util.slice(util.indexOf('export async function openRestAlertSettings'));
      assert.match(
        opener,
        /if \(\(await getRestAlertAccessState\(\)\) === 'channelMuted'\) \{\s*await openRestAlertChannelSettings\(\);\s*return;\s*\}\s*await Linking\.openSettings\(\)/,
      );
    },
  },
];
