const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  GUIDED_CARD_CHIP_CAP,
  GUIDED_SET_BOX_CAP,
  guidedBoxesThatFit,
  guidedLoadTrend,
  guidedTodayLoadKg,
  guidedWindow,
} = require('../../.test-dist/lib/guidedSetRow.js');

const playerSource = fs
  .readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

function set(setIndex, extra = {}) {
  return {
    setIndex,
    status: 'pending',
    plannedLoadKg: 16.25,
    plannedRepsMin: 6,
    plannedRepsMax: 8,
    draftLoadText: '',
    draftRepsText: '',
    ...extra,
  };
}

/**
 * #bugs 2026-10-10, from the gym on an 11-set lift: the card's lines showed
 * ten chips with the last cut at the edge, and the set row's boxes ran into
 * the buttons. Five chips a line, six boxes at most, the buttons still.
 */
module.exports = [
  {
    name: 'set row window: the first five until the current set would fall off, then it stays last',
    run() {
      assert.equal(GUIDED_CARD_CHIP_CAP, 5);
      assert.equal(GUIDED_SET_BOX_CAP, 6);
      assert.deepEqual(guidedWindow(11, 0, 5), { start: 0, end: 5 });
      assert.deepEqual(guidedWindow(11, 4, 5), { start: 0, end: 5 });
      assert.deepEqual(guidedWindow(11, 5, 5), { start: 1, end: 6 });
      assert.deepEqual(guidedWindow(11, 10, 5), { start: 6, end: 11 });
      // Fewer than the cap: all of them.
      assert.deepEqual(guidedWindow(3, 2, 5), { start: 0, end: 3 });
      // Out of range is held to the ends, never an empty or negative window.
      assert.deepEqual(guidedWindow(11, 40, 5), { start: 6, end: 11 });
      assert.deepEqual(guidedWindow(11, -3, 5), { start: 0, end: 5 });
      assert.deepEqual(guidedWindow(0, 0, 5), { start: 0, end: 0 });
      // Every position keeps the current item inside the window.
      for (let current = 0; current < 11; current += 1) {
        const { start, end } = guidedWindow(11, current, 6);
        assert.ok(start <= current && current < end, `set ${current + 1} is shown`);
        assert.equal(end - start, 6);
      }
    },
  },
  {
    name: 'set row boxes: only as many as the room holds, at most six, never a half box',
    run() {
      // 6 × 18 + 5 × 4 = 128 holds six; 127 holds five.
      assert.equal(guidedBoxesThatFit(128, 18, 4, 6), 6);
      assert.equal(guidedBoxesThatFit(127, 18, 4, 6), 5);
      assert.equal(guidedBoxesThatFit(500, 18, 4, 6), 6);
      assert.equal(guidedBoxesThatFit(10, 18, 4, 6), 1);
      // Unmeasured: the cap, which a measurement only lowers.
      assert.equal(guidedBoxesThatFit(0, 18, 4, 6), 6);
    },
  },
  {
    name: 'today weight arrow: up green, down red, the same none — and only with automated progression on',
    run() {
      assert.equal(guidedLoadTrend({ lastKg: 16.25, todayKg: 18.75, progressionOn: true }), 'up');
      assert.equal(guidedLoadTrend({ lastKg: 16.25, todayKg: 15, progressionOn: true }), 'down');
      assert.equal(guidedLoadTrend({ lastKg: 16.25, todayKg: 16.25, progressionOn: true }), null);
      assert.equal(guidedLoadTrend({ lastKg: 16.25, todayKg: 16.250000001, progressionOn: true }), null);
      assert.equal(guidedLoadTrend({ lastKg: 16.25, todayKg: 18.75, progressionOn: false }), null);
      assert.equal(guidedLoadTrend({ lastKg: null, todayKg: 18.75, progressionOn: true }), null);
      assert.equal(guidedLoadTrend({ lastKg: 16.25, todayKg: null, progressionOn: true }), null);
    },
  },
  {
    name: "today weight: the heaviest of the day, the set being done at its dial, skipped sets left out",
    run() {
      const sets = [
        set(0, { status: 'completed', actualLoadKg: 16.25, actualReps: 7 }),
        set(1),
        set(2, { plannedLoadKg: 20 }),
        set(3, { status: 'skipped', plannedLoadKg: 50 }),
      ];
      assert.equal(guidedTodayLoadKg({ sets, currentSetIndex: 1, currentKg: null, trackingMode: 'weight_reps' }), 20);
      // The thumb on the dial moves it.
      assert.equal(guidedTodayLoadKg({ sets, currentSetIndex: 1, currentKg: 22.5, trackingMode: 'weight_reps' }), 22.5);
      // No weight anywhere: nothing to show.
      const empty = [set(0, { plannedLoadKg: undefined })];
      assert.equal(guidedTodayLoadKg({ sets: empty, currentSetIndex: 0, currentKg: null, trackingMode: 'weight_reps' }), null);
    },
  },
  {
    name: 'set screen: the card and the row read these helpers, and the − keeps its place when hidden',
    run() {
      // Both lines slice one window, so last time's chips stay over today's.
      assert.match(playerSource, /panels\.history\.sets\.slice\(chipWindow\.start, chipWindow\.end\)/);
      assert.match(playerSource, /todayPlan\.slice\(chipWindow\.start, chipWindow\.end\)/);
      // The boxes come from the measured window, not a fixed count.
      assert.match(playerSource, /length: setBoxWindow\.end - setBoxWindow\.start/);
      assert.doesNotMatch(playerSource, /SET_DOT_CAP/);
      // The − hides into a spacer of its own size, so the + does not move.
      const removeAt = playerSource.indexOf("accessibilityLabel={t(language, 'guided.action.removeSet')}");
      const addAt = playerSource.indexOf("accessibilityLabel={t(language, 'guided.action.addSet')}", removeAt);
      assert.ok(removeAt > 0 && addAt > removeAt);
      assert.match(playerSource.slice(removeAt, addAt), /styles\.setAddBtnSpacer/);
      // The arrow is fed the reader's progression switch.
      assert.match(playerSource, /guidedLoadTrend\(\{[\s\S]{0,200}progressionOn,/);
      const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'renderWorkoutTab.tsx'), 'utf8');
      assert.match(shell, /progressionOn=\{proUnlocked && preferences\.automatedProgressionEnabled\}/);
    },
  },
];
