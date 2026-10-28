const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applySessionAdaptation,
  hasSessionAdaptation,
  EMPTY_SESSION_ADAPTATION,
} = require('../../src/lib/sessionAdaptation');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

function template() {
  return {
    id: 'tpl',
    name: 'Lower',
    sessions: [
      {
        id: 'day1',
        name: 'Lower',
        exercises: [
          { slotId: 'primary_1', exerciseName: 'Barbell Hip Thrust', role: 'primary', sets: 4 },
          { slotId: 'secondary_2', exerciseName: 'Bulgarian Split Squat', role: 'secondary', sets: 3 },
          { slotId: 'accessory_3', exerciseName: 'Leg Curl', role: 'accessory', sets: 3 },
        ],
      },
    ],
  };
}

module.exports = [
  {
    name: 'drops: a slot left out today is gone from the session that starts',
    run() {
      const adapted = applySessionAdaptation(template(), {
        ...EMPTY_SESSION_ADAPTATION,
        drops: ['secondary_2'],
      });
      const slots = adapted.sessions[0].exercises.map((exercise) => exercise.slotId);
      assert.deepEqual(slots, ['primary_1', 'accessory_3']);
      // The source template is not touched — the programme is edited from its
      // own page, and today's answer must not rewrite it.
      assert.equal(template().sessions[0].exercises.length, 3);
    },
  },
  {
    name: 'drops: a drop counts as an adaptation, so it is not silently discarded',
    run() {
      // hasSessionAdaptation gates the whole apply. Forgetting drops here
      // would return the template untouched and the row would come back at
      // the moment the session started.
      assert.equal(hasSessionAdaptation({ swaps: {}, drops: ['a'], trimSets: false }), true);
      assert.equal(hasSessionAdaptation(EMPTY_SESSION_ADAPTATION), false);
      // An older caller that predates the field must not throw.
      assert.equal(hasSessionAdaptation({ swaps: {}, trimSets: false }), false);
      assert.doesNotThrow(() => applySessionAdaptation(template(), { swaps: { primary_1: 'Machine Hip Thrust' }, trimSets: false }));
    },
  },
  {
    name: 'drops: a dropped exercise leaves the session and the rest are untouched',
    run() {
      // The set trim this suite also covered went with the Adapt sheet that
      // was its only way in (2026-08-30). Dropping did not: it is answered in
      // the gym, from the day's own list, and it still has to leave the
      // others exactly as prescribed.
      const adapted = applySessionAdaptation(template(), {
        swaps: {},
        drops: ['accessory_3'],
      });
      const remaining = adapted.sessions[0].exercises;
      assert.deepEqual(remaining.map((exercise) => exercise.slotId), ['primary_1', 'secondary_2']);
      const total = remaining.reduce((sum, exercise) => sum + exercise.sets, 0);
      assert.equal(total, 7, 'dropping one exercise must not re-prescribe the others');
    },
  },
  {
    // Rewritten 2026-09-21 (swap audit). This pinned the swaps and drops as
    // one slot-keyed pair that every start applied and then cleared — which is
    // the leak: slot ids repeat across a programme's days, so what was chosen
    // for day A was applied to day B when B was started instead, and until
    // something started nothing let it go. They are still spent together, but
    // only the session's own, and read only for the session they were made on
    // (lib/sessionAdaptation, suites in sessionAdaptation.test.cjs).
    name: 'drops: a start applies and spends only what was chosen for that session',
    run() {
      const wiring = require('../helpers/appWiringSource.cjs').readAppWiring();
      // Each start's own body, from its name to the navigation that ends it —
      // bounded both ends, so a match cannot come from some other function.
      const startBody = (signature) => {
        const from = wiring.indexOf(signature);
        assert.ok(from >= 0, `${signature} is gone`);
        const to = wiring.indexOf('navigateToGuidedWorkout(workoutTemplateId);', from);
        assert.ok(to > from, `${signature} no longer ends in the guided player`);
        return wiring.slice(from, to);
      };
      for (const [label, body] of [
        ['ready', startBody('function startReadyProgramSessionWithUnit(')],
        ['custom', startBody('function handleStartCustomProgramSession(')],
      ]) {
        assert.match(body, /const sessionRef = \{ programId: workoutTemplateId, sessionId \};/, label);
        assert.match(body, /applySessionAdaptation\(\s*build\w+SessionRuntimeTemplate\([^)]*\),\s*sessionAdaptationFor\(sessionRef\),\s*\)/, label);
        assert.match(body, /setHeldSessionAdaptations\(\(held\) => spendHeldAdaptation\(held, sessionRef\)\);/, label);
      }
      // No start reads the old unscoped pair any more.
      assert.doesNotMatch(wiring, /\{ swaps: sessionSwaps, drops: sessionDrops \}/);
      assert.doesNotMatch(wiring, /setSessionSwaps\(\{\}\)|setSessionDrops\(\[\]\)/);
    },
  },
  {
    name: 'home: the whole exercise row opens the sheet, and a dropped row can be put back',
    run() {
      const home = read('src/screens/HomeScreen.tsx');
      // The reader tapped the name — the part that says what the row is — and
      // nothing happened, because only the 15dp glyph was pressable.
      assert.match(home, /<Pressable\s*\n\s*key=\{`\$\{exercise\.name\}-\$\{index\}`\}/);
      assert.match(home, /onPress=\{\(\) => setSwapSlotId\(exercise\.slotId \?\? null\)\}/);
      // A row that vanishes takes its own undo with it.
      assert.match(home, /planExerciseDropped/);
      assert.match(home, /textDecorationLine: 'line-through'/);
      assert.match(home, /onRestoreSessionExercise\?\.\(swapSlotId\)/);
      assert.match(home, /onDropSessionExercise\?\.\(swapSlotId\)/);
      // The sheet must say the scope out loud: this is today, not the plan.
      assert.match(home, /home\.swapSheet\.dropNote/);
      const fi = read('src/lib/i18n.ts');
      assert.match(fi, /'home\.swapSheet\.dropNote': 'Vain tälle kerralle\. Ohjelmasi pysyy ennallaan\.'/);
    },
  },
];
