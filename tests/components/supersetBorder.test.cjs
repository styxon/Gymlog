const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const borderSource = read('src/components/SupersetBorder.tsx');
const playerSource = read('src/screens/GuidedPlayerScreen.tsx');
const i18nSource = read('src/lib/i18n.ts');
const daySource = read('src/screens/ProgramDayScreen.tsx');
const freestyleSource = read('src/screens/EmptyWorkoutScreen.tsx');

module.exports = [
  {
    /**
     * The marking is the outline, not the motion. A reader who turned
     * animation off still has to be able to see which lifts are done back to
     * back — so the line is drawn either way and only the two lights are
     * conditional.
     */
    name: 'superset outline: the line is drawn even when motion is off',
    run() {
      assert.match(borderSource, /queryReduceMotion\(\)/);
      // The static outline is unconditional — it sits outside the `allowed`
      // branch, which only adds the two moving segments.
      const staticRect = borderSource.indexOf('strokeOpacity={0.28}');
      const gate = borderSource.indexOf('{allowed ? (');
      assert.ok(staticRect > -1, 'the resting outline should exist');
      assert.ok(gate > staticRect, 'the resting outline must not sit behind the motion gate');
    },
  },
  {
    /**
     * strokeDashoffset is not a transform, so this animation cannot run on the
     * native driver. Said out loud here because `useNativeDriver: false` reads
     * like an oversight, and "fixing" it stops the lights dead with no error.
     */
    name: 'superset outline: the dash offset is driven in JS on purpose',
    run() {
      assert.match(borderSource, /useNativeDriver: false/);
      assert.match(borderSource, /strokeDashoffset=\{clockwise\.interpolate/);
      assert.match(borderSource, /strokeDashoffset=\{widdershins\.interpolate/);
    },
  },
  {
    /**
     * One Animated.Value per element. A single node shared across views is the
     * shape that took the app down once before.
     */
    name: 'superset outline: two lights, two animated nodes',
    run() {
      assert.match(borderSource, /const clockwise = useRef\(new Animated\.Value\(0\)\)\.current;/);
      assert.match(borderSource, /const widdershins = useRef\(new Animated\.Value\(0\)\)\.current;/);
      // And they run opposite ways, which is the whole idea.
      assert.match(borderSource, /outputRange: \[0, -perimeter\]/);
      assert.match(borderSource, /outputRange: \[0, perimeter\]/);
    },
  },
  {
    /**
     * It measures its own container and takes no taps, which is what lets the
     * same component go around one row of a sheet and around a whole screen.
     */
    name: 'superset outline: fills its container and swallows nothing',
    run() {
      assert.match(borderSource, /style=\{StyleSheet\.absoluteFill\}\s*pointerEvents="none"/);
    },
  },
  {
    /**
     * Both places a superset is shown while training wear the same boundary
     * and the same one word — the box in the contents sheet, and the screen
     * asking for the set.
     */
    name: 'superset outline: every surface that lists a superset wears it',
    run() {
      // The contents sheet and the entry table — and the day view and the
      // free workout have their own, asserted below.
      assert.equal((playerSource.match(/<SupersetBorder /g) ?? []).length, 2);
      // Painted first, so the label can break the line it sits on.
      assert.match(playerSource, /<SupersetBorder radius=\{14\} \/>\s*<View style=\{styles\.runSupersetPill\}>/);
      // NOT on the set screen: a running frame around the lift while the
      // reader was lifting it was the thing they asked to lose. The badge
      // stays on its own (device, 2026-09-16).
      assert.doesNotMatch(playerSource, /<SupersetBorder radius=\{22\} inset=\{8\} \/>/);
      assert.match(playerSource, /\{superset && !typingKeys \? \(\s*<>\s*\{\/\*[\s\S]*?\*\/\}\s*<View style=\{styles\.setSupersetPill\}>/);
      // One word, both dictionaries.
      assert.equal((i18nSource.match(/'guided\.superset\.pill': '[^']+'/g) ?? []).length, 2);
      assert.equal((i18nSource.match(/'guided\.superset\.thenRest': '[^']+'/g) ?? []).length, 2);
      // The programme's day view and the free workout draw the same box, with
      // the same one word on it — a superset that looked different in each
      // place would be three features wearing one name.
      for (const screen of [daySource, freestyleSource]) {
        assert.match(screen, /<SupersetBorder radius=\{16\} \/>/);
        assert.match(screen, /'guided\.superset\.pill'/);
      }
      // And nowhere draws an A1/A2 badge any more.
      for (const screen of [playerSource, daySource, freestyleSource]) {
        assert.doesNotMatch(screen, /supersetTag|supersetBadge|supersetLabel/);
      }
    },
  },
  {
    /**
     * "This lift, then that one, then rest" has to be readable before the set
     * is logged — that is the moment it changes what the reader does next.
     */
    name: 'superset set screen: the order of play is named, current lift marked',
    run() {
      assert.match(playerSource, /superset\.members\.map\(\(member, index\) => \(/);
      assert.match(
        playerSource,
        /member\.slotId === step\.slotId \? styles\.setSupersetFlowNow : undefined/,
      );
      assert.match(playerSource, /'guided\.superset\.thenRest'/);
    },
  },
];
