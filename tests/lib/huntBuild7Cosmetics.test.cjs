// The cosmetic findings (C1-C9) of the build 6->7 bug hunt, after main a4c9d0f8.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

function luminance(hex) {
  const value = hex.replace('#', '');
  const channel = (at) => {
    const c = parseInt(value.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = [
  {
    name: 'hunt C1: a failed payment does not read "Next charge: none scheduled"',
    run() {
      const screen = read('src', 'screens', 'SubscriptionScreen.tsx');
      assert.match(
        screen,
        /if \(model\.cancelled\) \{[\s\S]{0,400}if \(model\.billingIssue\) \{\s*return \[proEnds, \.\.\.method\];\s*\}\s*return \[proEnds, \{ \.\.\.nothingScheduled/,
      );
    },
  },
  {
    name: 'hunt C2: a rest extended inside its last three seconds beeps 3 again on the way down',
    run() {
      const { guidedBeepMarkAfterAdjust } = require('../../src/lib/guidedPlayer');
      // At 2.5 s with 3 beeped, "+10 s" clears the mark.
      assert.equal(guidedBeepMarkAfterAdjust(3, 12_500), null);
      // Lifted only to 2.9 s: still inside the beeped second, kept.
      assert.equal(guidedBeepMarkAfterAdjust(3, 2_900), 3);
      // "-15 s" with a 1 s floor lowers it: the 3 already heard is not repeated.
      assert.equal(guidedBeepMarkAfterAdjust(3, 1_000), 3);
      // From 1 to 3.2 s: back above, so 3, 2 and 1 come again.
      assert.equal(guidedBeepMarkAfterAdjust(1, 3_200), null);
      assert.equal(guidedBeepMarkAfterAdjust(null, 9_000), null);
      const player = require('../helpers/guidedPlayerSource.cjs').readGuidedPlayerSource();
      assert.match(
        player,
        /remainingRef\.current = next;\s*lastBeepSecondRef\.current = guidedBeepMarkAfterAdjust\(lastBeepSecondRef\.current, next\);/,
      );
    },
  },
  {
    name: 'hunt C3: every fontFamily in src is one useAppBoot loads',
    run() {
      const boot = read('src', 'app', 'useAppBoot.ts');
      const loaded = new Set([...boot.matchAll(/^\s*'?([A-Za-z-]+)'?: require\('\.\.\/\.\.\/assets\/fonts\//gm)].map((m) => m[1]));
      assert.ok(loaded.has('JetBrainsMono') && loaded.has('Manrope-Bold'), 'the boot list was read');
      const offenders = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (/\.tsx?$/.test(entry.name)) {
            for (const m of fs.readFileSync(full, 'utf8').matchAll(/fontFamily: '([^']+)'/g)) {
              if (!loaded.has(m[1])) {
                offenders.push(`${path.relative(root, full)}: ${m[1]}`);
              }
            }
          }
        }
      };
      walk(path.join(root, 'src'));
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'hunt C4: My data limits and the Training plan active pill use theme tokens, not light-theme hexes',
    run() {
      const myData = read('src', 'screens', 'MyDataScreen.tsx');
      assert.doesNotMatch(myData, /'#(B45309|FBF0DD|FBEAE7|C0392B)'/);
      assert.match(myData, /<ShieldIcon color=\{flag\.level === 'avoid' \? theme\.danger : theme\.amberInk\} \/>/);
      const plan = read('src', 'screens', 'TrainingPlanScreen.tsx');
      assert.doesNotMatch(plan, /'#(E4F6EA|157A3A|1FA64E)'/);
      assert.match(plan, /activePillText: \{\s*color: theme\.greenInk,/);
    },
  },
  {
    name: 'hunt C5: the sheet grip and option rows are drawn from the theme, visible on the light sheet',
    run() {
      const kit = read('src', 'components', 'sheetKit.tsx');
      assert.doesNotMatch(kit, /rgba\(255,\s*255,\s*255,\s*0\.2\)|rgba\(255,\s*255,\s*255,\s*0\.035\)/);
      assert.match(kit, /grip: \{[^}]*backgroundColor: theme\.switchOff,/);
      assert.match(kit, /row: \{[^}]*backgroundColor: theme\.controlFill,/);
    },
  },
  {
    name: 'hunt C6: a switch off track reaches 3:1 against its card in both themes',
    run() {
      const { HG } = require('../../src/lightTheme');
      const { HG_DARK } = require('../../src/darkTheme');
      const pairs = [
        ['light card', HG.switchOff, HG.surface],
        ['light page', HG.switchOff, HG.bg],
        ['dark card', HG_DARK.switchOff, HG_DARK.surface],
        ['dark soft card', HG_DARK.switchOff, HG_DARK.surfaceSoft],
      ];
      for (const [where, track, card] of pairs) {
        assert.ok(contrast(track, card) >= 3, `${where}: ${contrast(track, card).toFixed(2)}`);
      }
    },
  },
  {
    name: 'hunt C7: a relative day older than this year carries its year',
    run() {
      const { formatRelativeDay } = require('../../src/lib/format');
      const now = new Date(2026, 9, 30, 12);
      assert.equal(formatRelativeDay(new Date(2025, 9, 19, 18), now, 'fi'), '19.10.2025');
      assert.equal(formatRelativeDay(new Date(2025, 9, 19, 18), now, 'en'), 'Oct 19, 2025');
      // This year it stays short, as it was.
      assert.equal(formatRelativeDay(new Date(2026, 9, 19, 18), now, 'fi'), '19.10.');
    },
  },
  {
    name: 'hunt C8: "painoni on 100 000" is not read as 100 kg, and plain readings still are',
    run() {
      const { parseMeasurementIntent } = require('../../src/lib/measurementIntent');
      assert.equal(parseMeasurementIntent('painoni on 100 000', 'fi'), null);
      assert.equal(parseMeasurementIntent('painoni on 100 000', 'fi'), null);
      assert.equal(parseMeasurementIntent('my weight is 1 000 kg', 'en'), null);
      assert.deepEqual(parseMeasurementIntent('painoni on 82', 'fi'), { kind: 'bodyweight', value: 82, unit: 'kg' });
      assert.deepEqual(parseMeasurementIntent('paino 82,5 kg', 'fi'), { kind: 'bodyweight', value: 82.5, unit: 'kg' });
      assert.deepEqual(parseMeasurementIntent('painoni oli 82 ja vyötärö 90', 'fi'), { kind: 'bodyweight', value: 82, unit: 'kg' });
    },
  },
  {
    name: 'hunt C9: a coach spend whose write was refused is taken back from the ledger',
    run() {
      const { createCoachQuotaLedger, recordCoachQuestion, resolveCoachQuota } = require('../../src/lib/aiCoachQuota');
      const now = new Date(2026, 9, 30, 12);
      // One question left in what is stored.
      let stored = null;
      while (resolveCoachQuota(stored, now).remaining > 1) {
        stored = recordCoachQuestion(stored, now);
      }
      const ledger = createCoachQuotaLedger();
      // The updater ran (the note is ahead), then the disk refused the write.
      ledger.record(stored, now);
      assert.equal(ledger.reserve(stored, now), false, 'the note alone spends the last one');
      ledger.forget();
      assert.equal(ledger.reserve(stored, now), true, 'after forget the stored last question is there again');
      ledger.release();
      // A note written after the record is not undone by a late forget.
      const recorded = ledger.record(stored, now);
      ledger.note(recordCoachQuestion(recorded, now));
      ledger.forget();
      assert.equal(ledger.reserve(stored, now), false);
      for (const caller of [read('src', 'app', 'onboardingFinishes.tsx'), read('src', 'app', 'renderHomeScreens.tsx')]) {
        assert.match(caller, /coachQuotaLedger\.forget\(\);/);
      }
    },
  },
];
