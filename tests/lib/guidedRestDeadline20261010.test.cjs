const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildGuidedSteps,
  getGuidedStepAnchor,
  guidedAdjustedMs,
  guidedRestCueDue,
  guidedRestOpeningMs,
  guidedRestToExtend,
  withGuidedRestDeadline,
  withGuidedRestPaused,
} = require('../../.test-dist/lib/guidedPlayer.js');
const { extendRest } = require('../../.test-dist/lib/restSchedule.js');

/**
 * Bug hunt 2026-10-10: the guided rest's deadline against the lock-screen
 * "+60 s", the overview's Resume, a pause and the permission moment.
 */

const screen = fs
  .readFileSync(path.join(__dirname, '../../src/screens/GuidedPlayerScreen.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

function plan() {
  return buildGuidedSteps({
    warmup: [],
    exercises: [{ slotId: 'a', name: 'Bench Press', restSeconds: 120, setCount: 3, skipped: false }],
    cooldown: [],
  }).steps;
}

/** The text between the parentheses of every `name(` call in the source. */
function callArguments(source, name) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${name}(`, from);
    if (at === -1) {
      return out;
    }
    let depth = 0;
    let end = at + name.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(source.slice(at + name.length + 1, end));
    from = end;
  }
}

module.exports = [
  {
    name: 'guided +60 s on a rest that has ended makes a new rest of 60 s, as extendRest does (#3)',
    run() {
      const now = 1_000_000_000;
      for (const overdueS of [0, 5, 20, 59, 61, 300]) {
        const endsAtMs = now - overdueS * 1000;
        const guided = guidedAdjustedMs({ endsAtMs, remainingMs: 0, nowMs: now, deltaMs: 60_000 });
        const free = extendRest({ totalSeconds: 90, endsAtMs, startedAtMs: endsAtMs - 90_000 }, 60, now);
        assert.equal(guided, 60_000, `ended ${overdueS}s ago`);
        assert.equal(guided, free.endsAtMs - now, `free workout agrees, ended ${overdueS}s ago`);
      }
    },
  },
  {
    name: 'guided adjust: a running rest counts from its deadline, a stopped one from what it had left',
    run() {
      const now = 5_000;
      // 30 s on the clock, +60 s: the added time stands on top of what is left.
      assert.equal(guidedAdjustedMs({ endsAtMs: now + 30_000, remainingMs: 99_000, nowMs: now, deltaMs: 60_000 }), 90_000);
      // The stale tick value is not read while a deadline runs.
      assert.equal(guidedAdjustedMs({ endsAtMs: now + 10_000, remainingMs: 50_000, nowMs: now, deltaMs: -15_000 }), 0);
      // No deadline (paused): the leftover.
      assert.equal(guidedAdjustedMs({ endsAtMs: null, remainingMs: 40_000, nowMs: now, deltaMs: 15_000 }), 55_000);
      // A floor holds, and an ended rest does not owe the overrun to a shortening.
      assert.equal(guidedAdjustedMs({ endsAtMs: now - 9_000, remainingMs: 0, nowMs: now, deltaMs: -15_000, floorMs: 1_000 }), 1_000);
      assert.equal(guidedAdjustedMs({ endsAtMs: now - 9_000, remainingMs: 0, nowMs: now, deltaMs: -15_000 }), 0);
    },
  },
  {
    name: 'guided adjust: the screen takes its sums from guidedAdjustedMs (#3)',
    run() {
      const body = screen.slice(screen.indexOf('const adjustRemaining = '), screen.indexOf('const goToRef = '));
      assert.ok(body.includes('guidedAdjustedMs('), 'adjustRemaining uses the pure sum');
      assert.ok(!/endsAtRef\.current - Date\.now\(\)/.test(body), 'no second copy of the unclamped sum');
    },
  },
  {
    name: 'guided +60 s from the lock screen reaches back to the rest that just ran out, and only that one (#3)',
    run() {
      const steps = plan();
      const restIndex = steps.findIndex((step) => step.type === 'rest');
      assert.equal(steps[restIndex + 1].type, 'set');
      assert.equal(guidedRestToExtend(steps, restIndex, restIndex + 1), restIndex);
      // Nothing expired, or the reader has been somewhere since.
      assert.equal(guidedRestToExtend(steps, null, restIndex + 1), null);
      assert.equal(guidedRestToExtend(steps, restIndex, restIndex + 2), null);
      assert.equal(steps[restIndex + 3].type, 'set');
      assert.equal(guidedRestToExtend(steps, restIndex, restIndex + 3), null);
      assert.equal(guidedRestToExtend(steps, restIndex, restIndex), null);
      // Not a rest at all, or one that is not stretched.
      assert.equal(guidedRestToExtend(steps, 0, 1), null);
      const interval = steps.map((step, i) => (i === restIndex ? { ...step, recoveryKind: 'walk' } : step));
      assert.equal(guidedRestToExtend(interval, restIndex, restIndex + 1), null);
      assert.equal(guidedRestToExtend(steps, 999, 1000), null);
    },
  },
  {
    name: 'guided +60 s wiring: the listener goes back, every move forgets the expired rest, the settle records it (#3)',
    run() {
      const listener = screen.slice(screen.indexOf('subscribeRestActions((action)'), screen.indexOf('const [paused, setPaused]'));
      assert.ok(listener.includes('guidedRestToExtend('));
      assert.ok(listener.includes("goToRef.current(lapsed, action.seconds * 1000)"));
      const goTo = screen.slice(screen.indexOf('const goTo = useCallback('), screen.indexOf('A running rest\'s end time'));
      assert.ok(goTo.includes('expiredRestRef.current = null'), 'a move clears it');
      assert.ok(goTo.includes('openingMs ?? stepSeconds(target) * 1000'));
      const settle = screen.slice(screen.indexOf('const settle = () => {'), screen.indexOf('const interval = setInterval(settle'));
      assert.ok(/expireRef\.current\(\);\s*if \(step\.type === 'rest'[^)]*\) \{[^}]*expiredRestRef\.current = stepIndex/.test(settle), 'recorded after the move');
    },
  },
  {
    name: 'guided overview Resume on a rest opens with the time left and not a full rest (#21)',
    run() {
      const steps = plan();
      const rest = steps.find((step) => step.type === 'rest');
      const now = 5_000_000;
      const live = withGuidedRestDeadline(getGuidedStepAnchor(rest), now + 40_000);
      assert.equal(guidedRestOpeningMs(live, rest, now), 40_000);
      // Over long ago: nothing left, so the timer moves on at once.
      assert.equal(guidedRestOpeningMs(withGuidedRestDeadline(getGuidedStepAnchor(rest), now - 3_600_000), rest, now), 0);
      // A step that is not the stored rest starts at its own length.
      const set = steps.find((step) => step.type === 'set');
      assert.equal(guidedRestOpeningMs(live, set, now), null);
      const start = screen.slice(screen.indexOf('const startAt = (index: number)'), screen.indexOf('const opening = resolveGuidedOpening'));
      assert.ok(start.includes('guidedRestOpeningMs(session.ui.guidedResumeAnchor'));
      assert.ok(/goTo\(index, left \?\? undefined\)/.test(start));
    },
  },
  {
    name: 'guided rest-over cue: a rest that opened with nothing left ended while the screen was gone and stays quiet (#22)',
    run() {
      // Ran out in front of the reader.
      assert.equal(guidedRestCueDue(90_000, -100), true);
      assert.equal(guidedRestCueDue(3_000, 0), true);
      // Caught late: backgrounded when it ran out.
      assert.equal(guidedRestCueDue(90_000, -1_500), false);
      assert.equal(guidedRestCueDue(90_000, -60_000), false);
      // Opened over: the re-derived deadline is only a tick old, but the rest is an hour old.
      assert.equal(guidedRestCueDue(0, -100), false);
      assert.equal(guidedRestCueDue(-5, -100), false);
      const steps = screen.slice(screen.indexOf('const openedWithMs'), screen.indexOf('const interval = setInterval(settle'));
      assert.ok(steps.includes('guidedRestCueDue(openedWithMs, next)'));
    },
  },
  {
    name: 'guided pause: the leftover of a paused rest rides on the anchor and reopens the rest (#23)',
    run() {
      const steps = plan();
      const rest = steps.find((step) => step.type === 'rest');
      const now = 9_000_000;
      const paused = withGuidedRestPaused(getGuidedStepAnchor(rest), 100_000);
      assert.equal(paused.restLeftMs, 100_000);
      assert.equal('restEndsAtMs' in paused, false);
      // Any time later: a pause does not run down.
      assert.equal(guidedRestOpeningMs(paused, rest, now), 100_000);
      assert.equal(guidedRestOpeningMs(paused, rest, now + 3_600_000), 100_000);
      // Survives storage.
      assert.equal(guidedRestOpeningMs(JSON.parse(JSON.stringify(paused)), rest, now), 100_000);
      // Running again swaps the leftover for a deadline, and back.
      const running = withGuidedRestDeadline(paused, now + 70_000);
      assert.equal('restLeftMs' in running, false);
      assert.equal(guidedRestOpeningMs(running, rest, now), 70_000);
      assert.equal('restEndsAtMs' in withGuidedRestPaused(running, 5_000), false);
      assert.deepEqual(withGuidedRestDeadline(paused, null), getGuidedStepAnchor(rest));
      // Another rest's leftover is not this one's; garbage is ignored; the cap holds.
      assert.equal(guidedRestOpeningMs({ ...paused, setIndex: 7 }, rest, now), null);
      assert.equal(guidedRestOpeningMs({ ...paused, restLeftMs: 'soon' }, rest, now), null);
      assert.equal(guidedRestOpeningMs({ ...paused, restLeftMs: Number.NaN }, rest, now), null);
      assert.ok(guidedRestOpeningMs({ ...paused, restLeftMs: 9 * 3_600_000 }, rest, now) <= 30 * 60 * 1000);
      assert.equal(guidedRestOpeningMs({ ...paused, restLeftMs: -5 }, rest, now), 0);
      // A leftover that is not a number stores nothing.
      assert.equal('restLeftMs' in withGuidedRestPaused(getGuidedStepAnchor(rest), Number.NaN), false);
    },
  },
  {
    name: 'guided pause wiring: a frozen rest stores its leftover, not a plain anchor (#23)',
    run() {
      const frozen = screen.slice(screen.indexOf("if (mode !== 'player' || frozen) {"), screen.indexOf('// Not `position` any more'));
      assert.ok(frozen.includes('persistRestLeft(remainingRef.current)'));
      assert.ok(frozen.includes("mode === 'player'"), 'the entry screen keeps writing the plain anchor');
    },
  },
  {
    name: 'guided rest card: every arming of the OS card says whether it is an interval recovery (#24)',
    run() {
      const calls = callArguments(screen, 'syncRestNotification').filter((args) => !/^\s*null\b/.test(args) && !args.includes('=>'));
      // The effect, the adjust and the permission grant.
      assert.ok(calls.length >= 3, `found ${calls.length} arming calls`);
      for (const args of calls) {
        assert.ok(/recoveryKind !== undefined/.test(args), `no recovery argument in syncRestNotification(${args.trim()})`);
      }
    },
  },
];
