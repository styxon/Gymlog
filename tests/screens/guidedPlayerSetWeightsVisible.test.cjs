const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'),
  'utf8',
);

/**
 * Each set's opening weight is deliberately carried from the SAME set index
 * last time (workoutState.ts resolveHistoricalSetDraft), so a ramp stays a
 * ramp — but every summary on this screen used to collapse it to one weight.
 * A real case (#bugs 2026-09-29): Lantionnosto laitteessa went 16,25×8,
 * 16,25×8, 30×6, 30×6, 30×6; the set card said "30 kg · 8 8 6 6 6" and set 3
 * "suddenly" opened at 30 with nothing on screen explaining why. Owner's call,
 * decision "a": keep the per-set replay, make it visible instead of smoothing
 * it away. The formatting decision itself lives in a pure lib helper
 * (guidedSetWeightSummary.ts, its own suite); these guards are only that the
 * screen actually asks it, on both surfaces that used to print one number.
 */
module.exports = [
  {
    name: 'guided set card: a ramp gets per-set weight×reps chips, a uniform set keeps its one number',
    run() {
      assert.match(
        playerSource,
        /const historyChips = panels\?\.history \? summarizeHistoricalSetChips\(panels\.history\.sets\) : null;/,
      );
      // The heading number only renders for a uniform session — a ramp has no
      // single weight to lead with, and the chips already say the whole thing.
      // (A bout of minutes has no weight to lead with either.)
      assert.match(playerSource, /historyChips\?\.uniform !== false && !minutesMode \? \(/);
      // Each chip reads from the summary, falling back to the plain rep only
      // if for some reason the summary and the history sets disagree in length.
      assert.match(playerSource, /: historyChips\?\.chips\[index\] \?\? set\.reps\}/);
    },
  },
  {
    name: 'guided walk-up: NYT and VIIMEKSI show a range when the plan or the log was not one weight',
    run() {
      // Today's plan is read across every set of the lift, not only set 1.
      assert.match(
        playerSource,
        /const todayLoads = instance\.sets\.map\(\(_, index\) => resolveTarget\(step\.slotId, index\)\?\.loadKg \?\? null\)/,
      );
      assert.match(playerSource, /formatLoadOrRange\(todayLoads\) \?\? formatWeight\(target\.loadKg, unitPreference\)/);
      // Last time's span uses the same rule the set card's chips do — one
      // weight when every set matched, the range when they did not.
      assert.match(playerSource, /lastValue: formatLoadOrRange\(last\?\.sets\.map\(\(set\) => set\.loadKg\) \?\? \[\]\),/);
    },
  },
  {
    name: 'guided player: the ramp-visibility decision is a pure lib helper, not inline formatting',
    run() {
      assert.match(
        playerSource,
        /import \{ formatLoadOrRange, summarizeHistoricalSetChips \} from '\.\.\/lib\/guidedSetWeightSummary';/,
      );
    },
  },
  {
    name: 'guided set card: last time and today each stay on one line and scroll sideways when wide',
    run() {
      // A ramp's chips are "16,25×8" (7-8 characters) where this row used to
      // hold a bare 1-2 digit rep count. On a plain row `justifyContent:
      // 'flex-end'` pushed the overflow off the near (left) edge (review,
      // #bugs 2026-09-29); the fix wrapped it to a second line, and on the
      // phone's larger font five plain chips wrapped too, which made the card
      // tall (#bugs 2026-10-09). Now each line is the content of a sideways
      // ScrollView: one line, nothing pushed off, the rest a swipe away.
      const pillsStyle = playerSource.slice(
        playerSource.indexOf('setExerciseLastPills: {'),
        playerSource.indexOf('setExerciseLastPill: {'),
      );
      assert.doesNotMatch(pillsStyle, /flexWrap/);
      assert.match(pillsStyle, /flexGrow:\s*1/);
      const scrolls =
        playerSource.match(
          /<ScrollView\s+horizontal\s+showsHorizontalScrollIndicator=\{false\}\s+style=\{styles\.setExerciseChipScroll\}\s+contentContainerStyle=\{styles\.setExerciseLastPills\}/g,
        ) ?? [];
      assert.equal(scrolls.length, 2, 'last time and today each scroll on their own line');
    },
  },
  {
    // The recovery badge was computed, carried and dropped on its way to this
    // screen for weeks. The caution hold takes the same hop, so the hop is
    // guarded: the target's area is read, and the badge says it.
    name: 'guided set card: a flagged-area hold reaches the badge, and an unknown area says nothing',
    run() {
      assert.match(playerSource, /\? target\?\.heldForCautionArea \?\? null/);
      assert.match(playerSource, /t\(language, 'guided\.heldForCaution', \{ area: cautionAreaName\.toUpperCase\(\) \}\)/);
      assert.match(playerSource, /<Text style=\{styles\.setHoldBadgeText\}>\{holdLabel\}<\/Text>/);
      // t() answers undefined for a key it does not know; the badge checks
      // for a name before upper-casing it.
      assert.match(playerSource, /: cautionAreaName\r?\n\s+\? t\(language, 'guided\.heldForCaution'/);
    },
  },
];
