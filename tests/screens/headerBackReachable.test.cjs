const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const screensDir = path.join(__dirname, '..', '..', 'src', 'screens');

function screenFiles() {
  return fs
    .readdirSync(screensDir)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => ({ name, source: fs.readFileSync(path.join(screensDir, name), 'utf8') }));
}

module.exports = [
  {
    name: 'no screen centres a header title with a bare absolute Text',
    run() {
      // The bug this guards: an absolutely positioned <Text> spanning
      // left:0/right:0 is the later sibling, so it paints over the back button.
      // pointerEvents does nothing on a Text on Android — as a style OR a prop,
      // both were tried on device — so the title swallowed every press landing
      // in its band, and the visible chevron sits inside that band. Back was
      // unreachable on ten screens. ScreenHeaderTitle wraps the Text in a View,
      // where pointerEvents actually works.
      const offenders = [];
      for (const { name, source } of screenFiles()) {
        if (!/headerTitle:\s*\{/.test(source)) continue;
        const block = source.slice(source.indexOf('headerTitle: {'));
        const body = block.slice(0, block.indexOf('},'));
        if (/position:\s*'absolute'/.test(body) && /right:\s*0/.test(body)) {
          offenders.push(name);
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `${offenders.join(', ')} re-introduced the absolute header title. Use ScreenHeaderTitle instead — a bare Text covers the back button and pointerEvents does not save it on Android.`,
      );
    },
  },
  {
    name: 'every screen with a back button and a centred title uses ScreenHeaderTitle',
    run() {
      const expected = [
        // Support, feature requests, the design shelf and the AI info page
        // were removed from Settings (2026-08-22).
        'LegalDocumentScreen',
        'MyDataScreen',
        'NotificationsScreen',
        'SettingsScreen',
        'SubscriptionScreen',
        'TrainingBreakScreen',
      ];
      for (const name of expected) {
        const source = fs.readFileSync(path.join(screensDir, `${name}.tsx`), 'utf8');
        assert.ok(
          source.includes('<ScreenHeaderTitle') || source.includes('<PageHeader'),
          `${name} no longer renders ScreenHeaderTitle; its back button is probably unreachable again`,
        );
      }
    },
  },
  {
    name: 'ScreenHeaderTitle puts pointerEvents on a View, not on the Text',
    run() {
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'ScreenHeaderTitle.tsx'),
        'utf8',
      );
      assert.ok(
        /<View pointerEvents="none"/.test(source),
        'the wrapper must carry pointerEvents — that is the entire reason this component exists',
      );
      assert.ok(
        !/<Text[^>]*pointerEvents/.test(source),
        'pointerEvents on a Text does nothing on Android; it belongs on the wrapping View',
      );
    },
  },
];
