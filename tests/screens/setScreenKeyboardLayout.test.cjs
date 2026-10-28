const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const fs = require('node:fs');
const path = require('node:path');

const player = readGuidedPlayerSource()
  .replace(/\r\n/g, '\n');

function style(name) {
  const match = player.match(new RegExp(`\\n  ${name}: (\\{[^}]*\\}),`));
  assert.ok(match, `styles.${name} moved`);
  return match[1];
}

/**
 * Owner's #2, iOS build 4 (iOS hunt 2026-10-17, P1-1): typing into the reps or
 * weight dial piled the two dial cards over the lift's card and the "Log set"
 * button. iOS shortens the screen by the keyboard's height (the AppShell's
 * KeyboardAvoidingView), and the dials' box was the one thing on the set
 * screen allowed to shrink — `flex: 1, minHeight: 0` — while the cards inside
 * it could not. Centred, the overflow went out both ends, and the set row's
 * dots and ± under it took the taps. Android draws the keyboard over a screen
 * that keeps its height, so it never showed there.
 */
module.exports = [
  {
    name: 'set screen: the dials\' box never shrinks under its cards; the card above gives the room',
    run() {
      const target = style('setTargetArea');
      assert.doesNotMatch(target, /\bflex: 1\b/);
      assert.doesNotMatch(target, /minHeight: 0/);
      assert.match(target, /flexGrow: 1/);
      assert.match(target, /flexShrink: 0/);
      assert.match(target, /justifyContent: 'center'/);
      const scroll = style('setTopScroll');
      assert.match(scroll, /flexGrow: 0/);
      assert.match(scroll, /flexShrink: 1/);
    },
  },
  {
    name: 'set screen: the lift\'s card and the set row scroll, the dials and the log row stay put',
    run() {
      const view = player.slice(player.indexOf('function SetStepView('), player.indexOf('function FinishView('));
      assert.ok(view.length > 0);
      const open = view.indexOf('<ScrollView\n          style={[styles.setTopScroll, typingKeys && styles.hidden]}');
      // Its own close, at its own depth: the chip rows inside it scroll too.
      const close = view.indexOf('\n        </ScrollView>\n', open);
      assert.ok(open > 0 && close > open, 'the scroll around the card and the set row');
      const at = (needle) => {
        const index = view.indexOf(needle);
        assert.ok(index > 0, `${needle} moved`);
        return index;
      };
      const card = at('style={styles.setExerciseCard}');
      const meta = at('style={styles.setMetaRow}');
      const target = at('<View style={styles.setTargetArea}>');
      const controls = at('<View style={styles.setControls}>');
      assert.ok(open < card && card < close, 'the card scrolls');
      assert.ok(open < meta && meta < close, 'the set row scrolls');
      assert.ok(close < target && target < controls, 'the dials and the log row are under the scroll');
      // Blank taps on the card's area still reach the "close the dial"
      // target around everything: "handled" would let the scroll take them.
      assert.match(view.slice(open, open + 200), /keyboardShouldPersistTaps="always"/);
      assert.match(view, /<Pressable\s+style=\{\{ flex: 1, minHeight: 0 \}\}\s+onPress=\{dial \? \(\) => setDial\(null\) : undefined\}/);
    },
  },
  {
    name: 'set screen: while a dial is typed in, last time\'s rows fold away',
    run() {
      assert.match(
        player,
        /ref=\{historyRef\}\s+collapsable=\{false\}\s+style=\{\[styles\.setExerciseRows, dial !== null && \{ display: 'none' \}\]\}/,
      );
    },
  },
];
