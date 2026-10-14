const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FREE_TREND_MONTHS,
  isMeasureRangeLocked,
  isTrendRangeLocked,
  resolveMeasureRange,
  resolveTrendRange,
} = require('../../.test-dist/lib/historyWindow.js');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

module.exports = [
  {
    name: 'historyWindow: three months of trend on free, all of it on Pro',
    run() {
      assert.equal(FREE_TREND_MONTHS, 3);

      // The week is the default view and is shorter than the free cap, so
      // locking it would be a paywall on this week (added 2026-08-25).
      assert.equal(isTrendRangeLocked('7d', false), false);
      assert.equal(isMeasureRangeLocked('7d', false), false);

      assert.equal(isTrendRangeLocked('1m', false), false);
      assert.equal(isTrendRangeLocked('3m', false), false);
      assert.equal(isTrendRangeLocked('6m', false), true);
      assert.equal(isTrendRangeLocked('all', false), true);

      assert.equal(isMeasureRangeLocked('3m', false), false);
      assert.equal(isMeasureRangeLocked('1y', false), true);
      assert.equal(isMeasureRangeLocked('all', false), true);

      for (const range of ['7d', '1m', '3m', '6m', 'all']) {
        assert.equal(isTrendRangeLocked(range, true), false, `pro ${range}`);
      }
      for (const range of ['7d', '3m', '1y', 'all']) {
        assert.equal(isMeasureRangeLocked(range, true), false, `pro ${range}`);
      }
    },
  },
  {
    name: 'historyWindow: a lapsed entitlement narrows the chart instead of leaving it drawn',
    run() {
      // The selected range is component state and knows nothing about a promo
      // code running out mid-session. Without resolving on render, a six-month
      // chart chosen while Pro was on keeps drawing after it is off.
      assert.equal(resolveTrendRange('all', false), '3m');
      assert.equal(resolveTrendRange('6m', false), '3m');
      assert.equal(resolveMeasureRange('1y', false), '3m');

      // It narrows to the longest free window, not to nothing: losing Pro
      // should cost the long view, not the chart.
      assert.equal(resolveTrendRange('1m', false), '1m');
      assert.equal(resolveTrendRange('all', true), 'all');
      assert.equal(resolveMeasureRange('all', true), 'all');
    },
  },
  {
    name: 'the cap is on the charts, and the Progress screen draws the resolved range',
    run() {
      const progress = read('src', 'screens', 'ProgressScreen.tsx');

      // Every read of the range goes through the resolver. A single raw read
      // is a chart that ignores the entitlement.
      assert.match(progress, /getOverviewRangeStart\(resolvedOverviewRange\)/);
      assert.match(progress, /measureRangeDays\(resolvedMeasureRange,/);
      assert.doesNotMatch(progress, /getOverviewRangeStart\(overviewRange\)/);
      assert.doesNotMatch(progress, /measureRangeDays\(measureRange,/);

      // Locked options are shown with a lock, not removed: a reader who never
      // learns the long view exists cannot want it.
      assert.match(progress, /lockedKeys=\{lockedTrendRanges\}/);
      assert.match(progress, /lockedKeys=\{lockedMeasureRanges\}/);
      assert.match(progress, /onLockedPress=\{onOpenPremium\}/);
      // The control itself moved to components/Seg.tsx when RecordsScreen
      // stopped hand-building a second one (Progress v2, piece 02). The rule
      // it carries is the same: a locked option opens Pro instead of
      // selecting, so it is a door rather than a broken chip.
      assert.match(
        read('src', 'components', 'Seg.tsx'),
        /locked \? onLockedPress\?\.\(\) : onChange\(option\.key\)/,
      );
    },
  },
  {
    name: 'the log stays uncapped, and the table says both things separately',
    run() {
      const premium = read('src', 'screens', 'PremiumScreen.tsx');
      const tiers = read('src', 'lib', 'proTiers.ts');
      const i18n = read('src', 'lib', 'i18n.ts');

      // The Pro page has no table, so the distinction the whole free tier
      // rests on has to survive in prose instead: the row that sells the
      // window says CHARTS AND RECORDS, and a separate trust line states that
      // the log itself is never capped in either tier. Losing either half
      // turns "3 months" into a claim that the app deletes training.
      //
      // v6 moved the row into lib/proTiers and put the window on the Free tab,
      // where it reads as what the free tier gets rather than as what Pro
      // withholds. The interpolation is the part that must not move.
      assert.match(
        tiers,
        /titleKey: 'pro\.v6\.free\.history\.t',[\s\S]{0,200}?vars: \{ months: FREE_TREND_MONTHS \}/,
        'the history row must take its free window from FREE_TREND_MONTHS',
      );
      const windowCopy = i18n.split('\n').filter((line) => line.includes("'pro.v6.free.history.t':"));
      assert.equal(windowCopy.length, 2, 'both languages');

      // The Free tab is titles only now (2026-10-14): the long "kept forever,
      // exportable as CSV" body is gone on purpose. The row that remains says
      // where the log lives, in both languages.
      const stored = i18n.split('\n').filter((line) => line.includes("'pro.v6.free.yours.t':"));
      assert.equal(stored.length, 2, 'the "stored on your phone" row must exist in both languages');
      assert.match(premium, /rows\.map|row\.bodyKey/, 'the Pro page must render the tier rows');

      // History, exercise detail and the session analysis read the log, not a
      // trend window — none of them may start asking about entitlement.
      for (const file of ['HistoryScreen.tsx', 'SessionAnalysisScreen.tsx']) {
        const source = read('src', 'screens', file);
        assert.doesNotMatch(source, /historyWindow|isTrendRangeLocked/, `${file} reads the log`);
      }

      // The Free rows are titles only; none may imply the charts go back
      // forever.
      for (const line of stored) {
        assert.doesNotMatch(line, /full history, forever|koko historiasi, ikuisesti/);
      }
    },
  },
];
