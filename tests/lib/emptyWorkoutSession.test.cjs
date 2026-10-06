const assert = require('node:assert/strict');

const {
  buildFreestyleFinish,
  canFinishFreestyleSession,
  exerciseInitials,
  freestyleDoneSetCount,
  freestyleUnsavedWork,
  freestyleNextSetTarget,
  freestyleRestSecondsForTick,
  freestyleVolumeKg,
  carryForwardFreestyleSet,
  normalizeFreestyleDraftSnapshot: normalizeDraftForSessionId,
  resolveFreestyleSessionId,
  discardSavedFreestyleDraft,
  resolveFreestyleSaveTarget,
} = require('../../.test-dist/lib/emptyWorkoutSession.js');

const emptyPrLookup = { byLibraryItemId: {}, byName: {} };

function makeExercise(overrides = {}) {
  return {
    localKey: 'draft_1',
    name: 'Barbell Squat',
    libraryItemId: 'ex_squat',
    imageUrl: null,
    repMin: 6,
    repMax: 8,
    restSeconds: 120,
    trackedDefault: true,
    sets: [
      { localKey: 'set_1', kg: '100', reps: '5', done: true },
      { localKey: 'set_2', kg: '100', reps: '5', done: false },
    ],
    ...overrides,
  };
}

module.exports = [
  /**
   * "Painot ja toistot automaattisesti" (#bugs 2026-08-28). The second and
   * third sets of a lift are almost always the first one again, and the
   * reader was retyping them.
   */
  {
    name: 'a new set starts at the last numbers you entered',
    run() {
      assert.deepEqual(
        carryForwardFreestyleSet([{ kg: '60', reps: '7' }]),
        { kg: '60', reps: '7' },
      );
    },
  },
  {
    /**
     * Read independently: a reader who has typed the weight for the row above
     * but not the reps yet would otherwise get a weight and a blank, or
     * nothing, depending which half they had reached.
     */
    name: 'each number is carried from the last set that has it',
    run() {
      assert.deepEqual(
        carryForwardFreestyleSet([
          { kg: '60', reps: '8' },
          { kg: '62,5', reps: '' },
        ]),
        { kg: '62,5', reps: '8' },
      );
    },
  },
  {
    name: 'nothing to carry stays empty rather than inventing a number',
    run() {
      assert.deepEqual(carryForwardFreestyleSet([]), { kg: '', reps: '' });
      assert.deepEqual(
        carryForwardFreestyleSet([{ kg: '', reps: '' }, { kg: '   ', reps: '' }]),
        { kg: '', reps: '' },
      );
    },
  },
  {
    /**
     * Bodyweight work is logged at no weight at all, and that is an answer:
     * the reps still carry.
     */
    name: 'a bodyweight set carries its reps without inventing a weight',
    run() {
      assert.deepEqual(
        carryForwardFreestyleSet([{ kg: '', reps: '12' }]),
        { kg: '', reps: '12' },
      );
    },
  },
  {
    name: 'exerciseInitials builds two-letter tiles like the design mock',
    run() {
      assert.equal(exerciseInitials('Barbell Squat'), 'BS');
      assert.equal(exerciseInitials('Pull-Up'), 'PU');
      assert.equal(exerciseInitials('Squat'), 'SQ');
      // Letter words beat leading numerals; all-numeric names still resolve.
      assert.equal(exerciseInitials('3/4 Sit-Up'), 'SU');
      assert.equal(exerciseInitials('90/90 Hamstring'), 'HA');
      assert.equal(exerciseInitials(''), 'EX');
    },
  },
  {
    name: 'stat strip counts only done sets and their volume',
    run() {
      const exercises = [makeExercise()];
      assert.equal(freestyleDoneSetCount(exercises), 1);
      assert.equal(freestyleVolumeKg(exercises), 500);
    },
  },
  {
    /**
     * User decision, 2026-09-26: a freestyle session with no ticked set is
     * not a workout, and Finish must not be reachable for one.
     */
    name: 'canFinishFreestyleSession needs one ticked set, typed numbers are not enough',
    run() {
      assert.equal(canFinishFreestyleSession([]), false);
      assert.equal(
        canFinishFreestyleSession([
          { ...makeExercise(), sets: [{ localKey: 's1', kg: '60', reps: '8', done: false }] },
        ]),
        false,
        'typed but unticked sets do not count',
      );
      assert.equal(canFinishFreestyleSession([makeExercise()]), true, 'one ticked set is enough');
    },
  },
  {
    name: 'leaving counts typed-but-unticked sets as work to lose',
    run() {
      const set = (kg, reps, done) => ({ localKey: `s${kg}${reps}${done}`, kg, reps, done });
      const exercise = (sets) => ({ ...makeExercise(), sets });

      // Nothing typed, nothing ticked: leaving loses nothing.
      assert.deepEqual(freestyleUnsavedWork([exercise([set('', '', false)])]), { doneSets: 0, enteredSets: 0 });
      assert.deepEqual(freestyleUnsavedWork([exercise([set('  ', ' ', false)])]), { doneSets: 0, enteredSets: 0 });
      assert.deepEqual(freestyleUnsavedWork([]), { doneSets: 0, enteredSets: 0 });

      // The bug: two exercises, four sets typed, none ticked.
      assert.deepEqual(
        freestyleUnsavedWork([
          exercise([set('60', '8', false), set('60', '', false)]),
          exercise([set('', '10', false), set('20', '12', false)]),
        ]),
        { doneSets: 0, enteredSets: 4 },
      );

      // A ticked set is counted once, as done, never as entered too.
      assert.deepEqual(
        freestyleUnsavedWork([exercise([set('60', '8', true), set('60', '8', false), set('', '', false)])]),
        { doneSets: 1, enteredSets: 1 },
      );
    },
  },
  {
    name: 'buildFreestyleFinish produces a matching draft and summary',
    run() {
      const { draft, summary } = buildFreestyleFinish({
        exercises: [makeExercise()],
        workoutName: 'Empty workout',
        startedAtIso: '2026-07-22T10:00:00.000Z',
        performedAtIso: '2026-07-22T10:40:00.000Z',
        elapsedSeconds: 2400,
        exercisePrLookup: emptyPrLookup,
      });

      // Draft: one session named after the first lift, sets count as targetSets.
      assert.equal(draft.name, 'Empty workout');
      assert.equal(draft.sessions.length, 1);
      assert.equal(draft.sessions[0].name, 'Barbell Squat');
      assert.deepEqual(draft.sessions[0].exercises[0], {
        name: 'Barbell Squat',
        targetSets: 2,
        repMin: 6,
        repMax: 8,
        restSeconds: 120,
        trackedDefault: true,
        libraryItemId: 'ex_squat',
        // Nothing was paired in this session, and the saved template says so
        // rather than saying nothing.
        supersetGroup: null,
      });

      // Summary: mirrors the editor finish math.
      assert.equal(summary.durationMinutes, 40);
      assert.equal(summary.setsCompleted, 1);
      assert.equal(summary.totalVolume, 500);
      assert.equal(summary.exercisesLogged, 1);
      assert.equal(summary.exerciseCards[0].completedSets, 1);
      assert.equal(summary.exerciseCards[0].totalSets, 2);
      assert.equal(summary.exerciseCards[0].totalVolumeKg, 500);

      // Logs keep every typed set; only the done one is completed.
      const log = summary.logs[0];
      assert.equal(log.exerciseNameSnapshot, 'Barbell Squat');
      assert.equal(log.sets.length, 2);
      assert.equal(log.sets[0].status, 'completed');
      assert.equal(log.sets[0].completedAt, '2026-07-22T10:40:00.000Z');
      assert.equal(log.sets[1].status, 'pending');
      assert.equal(log.sets[1].completedAt, null);
      assert.equal(log.status, 'completed');
      assert.equal(log.sessionInserted, true);
    },
  },
  {
    name: 'first-ever session yields a PR card; beaten history suppresses it',
    run() {
      const fresh = buildFreestyleFinish({
        exercises: [makeExercise()],
        workoutName: 'Empty workout',
        startedAtIso: '2026-07-22T10:00:00.000Z',
        performedAtIso: '2026-07-22T10:40:00.000Z',
        elapsedSeconds: 600,
        exercisePrLookup: emptyPrLookup,
      });
      assert.equal(fresh.summary.prCards.length, 1);
      // A record is the weight on the bar: 100 kg, not an Epley estimate off it.
      assert.equal(fresh.summary.prCards[0].performedWeightKg, 100);

      const beaten = buildFreestyleFinish({
        exercises: [makeExercise()],
        workoutName: 'Empty workout',
        startedAtIso: '2026-07-22T10:00:00.000Z',
        performedAtIso: '2026-07-22T10:40:00.000Z',
        elapsedSeconds: 600,
        exercisePrLookup: { byLibraryItemId: { ex_squat: { weight: 140, reps: 5 } }, byName: {} },
      });
      assert.equal(beaten.summary.prCards.length, 0);
    },
  },
  {
    name: 'undone-only exercises still persist but log as active',
    run() {
      const { summary } = buildFreestyleFinish({
        exercises: [
          makeExercise({
            sets: [{ localKey: 'set_1', kg: '', reps: '', done: false }],
          }),
        ],
        workoutName: 'Empty workout',
        startedAtIso: '2026-07-22T10:00:00.000Z',
        performedAtIso: '2026-07-22T10:05:00.000Z',
        elapsedSeconds: 90,
        exercisePrLookup: emptyPrLookup,
      });

      assert.equal(summary.setsCompleted, 0);
      assert.equal(summary.totalVolume, 0);
      assert.equal(summary.durationMinutes, 2);
      assert.equal(summary.prCards.length, 0);
      assert.equal(summary.logs[0].status, 'active');
    },
  },
  {
    name: 'ticking a set always starts a rest, whatever else is waiting',
    run() {
      // The rule this replaces asked "is another set already waiting" and
      // started nothing when the answer was no. In a freestyle logger the
      // answer is normally no — you tick the set you just did, THEN add the
      // next one — so the timer never ran. Reported twice on 2026-08-28
      // ("tätä lepoa ei tullut kun tein penkkiä", "lepo sekosi, ei näy
      // mitään") and reproduced on the emulator.
      const lastSetOfTheSession = { done: false };
      assert.equal(freestyleRestSecondsForTick({ restSeconds: 120 }, lastSetOfTheSession, 90), 120);

      // Guard the specific shape of the old rule: the session with nothing
      // else pending is exactly the case that used to come back with no rest.
      const soloExercise = makeExercise({
        sets: [{ localKey: 'set_1', kg: '100', reps: '5', done: false }],
      });
      assert.equal(
        freestyleRestSecondsForTick(soloExercise, soloExercise.sets[0], 90),
        120,
      );
    },
  },
  {
    name: 'the rest is the exercise own, and the default only when it has none',
    run() {
      assert.equal(freestyleRestSecondsForTick({ restSeconds: 45 }, { done: false }, 90), 45);
      assert.equal(freestyleRestSecondsForTick({ restSeconds: 0 }, { done: false }, 90), 90);
      // Rounded, because the bar counts in whole seconds.
      assert.equal(freestyleRestSecondsForTick({ restSeconds: 74.4 }, { done: false }, 90), 74);
    },
  },
  {
    name: 'a rest that cannot be counted is not started',
    run() {
      // Both numbers reach here from stored preferences by way of
      // getExerciseTemplateDefaults. NaN passes `typeof === 'number'`, and it
      // survives Math.min, Math.round and `now + n * 1000` all the way to the
      // bar, which then renders frozen at 0:00 and never ends — once per set,
      // now that every tick starts a rest.
      assert.equal(freestyleRestSecondsForTick({ restSeconds: NaN }, { done: false }, NaN), null);
      assert.equal(freestyleRestSecondsForTick({ restSeconds: 0 }, { done: false }, 0), null);
      assert.equal(freestyleRestSecondsForTick({ restSeconds: -30 }, { done: false }, -5), null);
      assert.equal(freestyleRestSecondsForTick({ restSeconds: 0 }, { done: false }, Infinity), null);
      // A usable default still rescues an exercise with no rest of its own.
      assert.equal(freestyleRestSecondsForTick({ restSeconds: NaN }, { done: false }, 90), 90);
    },
  },
  {
    name: 'un-ticking a set starts no rest',
    run() {
      // Correcting a mis-tap is not the end of a set. `done: true` is the
      // PRE-toggle state, because the caller decides before its setState lands.
      assert.equal(freestyleRestSecondsForTick({ restSeconds: 120 }, { done: true }, 90), null);
    },
  },

  {
    name: 'the done rest bar names the set you came back to log',
    run() {
      const draft = (sets) => [
        { localKey: 'e1', name: 'Bench', libraryItemId: null, imageUrl: null, repMin: 6, repMax: 8, restSeconds: 120, trackedDefault: true, sets },
      ];
      // The pending set is empty, so it carries the last logged set forward —
      // exactly what the reader sees when they tap into the fields.
      assert.deepEqual(
        freestyleNextSetTarget(draft([
          { localKey: 's1', kg: '60', reps: '8', done: true },
          { localKey: 's2', kg: '', reps: '', done: false },
        ])),
        { setNumber: 2, kg: '60', reps: '8' },
      );
      // Values already typed into the pending set win over the carried ones.
      assert.deepEqual(
        freestyleNextSetTarget(draft([
          { localKey: 's1', kg: '60', reps: '8', done: true },
          { localKey: 's2', kg: '65', reps: '6', done: false },
        ])),
        { setNumber: 2, kg: '65', reps: '6' },
      );
      // Nothing logged yet and nothing typed: a set number is still a label.
      assert.deepEqual(
        freestyleNextSetTarget(draft([{ localKey: 's1', kg: '', reps: '', done: false }])),
        { setNumber: 1, kg: '', reps: '' },
      );
      // Everything logged — no label, and the bar has nothing to point at.
      assert.equal(
        freestyleNextSetTarget(draft([{ localKey: 's1', kg: '60', reps: '8', done: true }])),
        null,
      );
      assert.equal(freestyleNextSetTarget([]), null);
    },
  },
  {
    // The hero shows the first card; in exercise order a curl record could
    // lead a session that also set a squat record (2026-09-26).
    name: 'freestyle record cards come strongest first',
    run() {
      const { buildFreestyleFinish } = require('../../.test-dist/lib/emptyWorkoutSession.js');
      const lift = (localKey, name, kg, reps) =>
        makeExercise({ localKey, name, libraryItemId: null, sets: [{ localKey: `${localKey}_1`, kg, reps, done: true }] });
      const { summary } = buildFreestyleFinish({
        exercises: [lift('a', 'Barbell Curl', '30', '10'), lift('b', 'Back Squat', '120', '5'), lift('c', 'Bench Press', '120', '6')],
        workoutName: 'Empty workout',
        startedAtIso: '2026-09-26T10:00:00.000Z',
        performedAtIso: '2026-09-26T10:40:00.000Z',
        elapsedSeconds: 600,
        exercisePrLookup: emptyPrLookup,
      });
      assert.deepEqual(summary.prCards.map((card) => card.exerciseName), ['Bench Press', 'Back Squat', 'Barbell Curl']);
    },
  },
  {
    // A ticked blank row — possible before the rule, and still in a draft
    // saved then — is not a set: not enough to save, not counted, not logged
    // as completed (2026-09-26).
    name: 'a ticked blank row is not a done set anywhere in the finish',
    run() {
      const {
        buildFreestyleFinish,
        canFinishFreestyleSession,
        freestyleDoneSetCount,
        freestyleUnsavedWork,
      } = require('../../.test-dist/lib/emptyWorkoutSession.js');
      const blank = makeExercise({ sets: [{ localKey: 'set_1', kg: '', reps: '', done: true }] });
      assert.equal(canFinishFreestyleSession([blank]), false);
      assert.equal(freestyleDoneSetCount([blank]), 0);
      // The stat strip and the remove-lift question read this one: it must
      // not call the blank row a set the finish refuses.
      assert.deepEqual(freestyleUnsavedWork([blank]), { doneSets: 0, enteredSets: 0 });
      const cleared = makeExercise({ sets: [{ localKey: 'set_1', kg: '60', reps: '', done: true }] });
      assert.deepEqual(freestyleUnsavedWork([cleared]), { doneSets: 0, enteredSets: 1 });
      const mixed = makeExercise({
        sets: [
          { localKey: 'set_1', kg: '', reps: '', done: true },
          { localKey: 'set_2', kg: '60', reps: '8', done: true },
        ],
      });
      assert.equal(canFinishFreestyleSession([mixed]), true);
      const { summary } = buildFreestyleFinish({
        exercises: [mixed],
        workoutName: 'Empty workout',
        startedAtIso: '2026-09-26T10:00:00.000Z',
        performedAtIso: '2026-09-26T10:40:00.000Z',
        elapsedSeconds: 600,
        exercisePrLookup: emptyPrLookup,
      });
      assert.equal(summary.setsCompleted, 1);
      assert.equal(summary.exerciseCards[0].completedSets, 1);
      assert.deepEqual(summary.logs[0].sets.map((set) => set.status), ['pending', 'completed']);
    },
  },
  {
    // "825" for 82,5 was ticked, counted into volume and shown on the summary,
    // then dropped by the loader on the next launch.
    name: 'isLoggableFreestyleSet: a set nobody could lift cannot be ticked',
    run() {
      const { isLoggableFreestyleSet } = require('../../.test-dist/lib/emptyWorkoutSession.js');
      assert.equal(isLoggableFreestyleSet({ kg: '82,5', reps: '6' }), true);
      assert.equal(isLoggableFreestyleSet({ kg: '', reps: '' }), false);
      assert.equal(isLoggableFreestyleSet({ kg: '60', reps: '' }), false);
      assert.equal(isLoggableFreestyleSet({ kg: '60', reps: '0' }), false);
      assert.equal(isLoggableFreestyleSet({ kg: '0', reps: '12' }), true);
      assert.equal(isLoggableFreestyleSet({ kg: '825', reps: '6' }), false);
      assert.equal(isLoggableFreestyleSet({ kg: '80', reps: '999' }), false);
      assert.equal(isLoggableFreestyleSet({ kg: 'abc', reps: '6' }), false);
    },
  },
  {
    /*
     * Audit round 4 (2026-09-20): the freestyle session lived in the screen's
     * React state alone, so a process the OS reclaimed mid-session lost every
     * set. The snapshot the provider persists comes back through this — read
     * from disk, so nothing in it is trusted.
     */
    name: 'a stored freestyle draft comes back with its lifts, rows and rest, and junk does not',
    run() {
      const { normalizeFreestyleDraftSnapshot } = require('../../.test-dist/lib/emptyWorkoutSession.js');
      assert.equal(normalizeFreestyleDraftSnapshot(null), null);
      assert.equal(normalizeFreestyleDraftSnapshot({ exercises: [] }), null, 'no lifts is no draft');
      assert.equal(normalizeFreestyleDraftSnapshot({ exercises: [{ localKey: 'a', name: 'Bench', sets: [] }] }), null, 'a lift with no rows is dropped, and the draft with it');

      const stored = normalizeFreestyleDraftSnapshot({
        exercises: [
          {
            localKey: 'a',
            name: 'Bench Press',
            libraryItemId: 'lib_bench',
            imageUrl: null,
            repMin: 6,
            repMax: 8,
            restSeconds: 120,
            trackedDefault: true,
            sets: [
              { localKey: 's1', kg: '60', reps: '8', done: true },
              { localKey: 's2', kg: '62.5', reps: '', done: false },
              { kg: 'no key' },
            ],
            supersetGroup: null,
            displayName: 'Bench Press',
            initials: 'BP',
            metaLabel: 'Barbell',
            isBarbell: true,
          },
          null,
          { localKey: 'b', name: '', sets: [{ localKey: 'x', kg: '1', reps: '1', done: true }] },
          { localKey: 'c', name: 'Curl', sets: [{ localKey: 'y', kg: 20, reps: null, done: 'yes' }], repMin: 'ten' },
        ],
        startedAtMs: 1_000_000,
        rest: { totalSeconds: 90, endsAtMs: 1_090_000, startedAtMs: 1_000_000 },
        savedAtMs: 1_050_000,
      });
      assert.ok(stored);
      assert.deepEqual(stored.exercises.map((lift) => lift.localKey), ['a', 'c'], 'the null and the nameless are gone');
      assert.deepEqual(stored.exercises[0].sets.map((set) => [set.localKey, set.kg, set.done]), [['s1', '60', true], ['s2', '62.5', false]], 'the row without a key is gone');
      assert.deepEqual(stored.exercises[1].sets, [{ localKey: 'y', kg: '', reps: '', done: false }], 'numbers that are not strings become blank rows, not crashes');
      assert.equal(stored.exercises[1].repMin, 8, 'a rep bound that is not a number is the default');
      assert.equal(stored.exercises[1].displayName, 'Curl');
      assert.equal(stored.startedAtMs, 1_000_000);
      assert.deepEqual(stored.rest, { totalSeconds: 90, endsAtMs: 1_090_000, startedAtMs: 1_000_000 });
      assert.equal(normalizeFreestyleDraftSnapshot({ exercises: stored.exercises, rest: { endsAtMs: 'soon' } }).rest, null, 'a rest without numbers is no rest');
    },
  },
  {
    /*
     * CI review of #162: savedAtMs was written on every save and read
     * nowhere, so a draft found days later resumed with its original clock —
     * a header counting in days, and a saved session claiming them.
     */
    name: 'a resumed freestyle session keeps its clock while the draft is fresh, and starts a new one when it is not',
    run() {
      const {
        resolveFreestyleDraftStart,
        FREESTYLE_DRAFT_CLOCK_MAX_AGE_MS,
      } = require('../../.test-dist/lib/emptyWorkoutSession.js');
      const now = 1_700_000_000_000;
      const startedAtMs = now - 45 * 60 * 1000;

      assert.equal(resolveFreestyleDraftStart(null, now), null);
      assert.equal(resolveFreestyleDraftStart({ startedAtMs: null, savedAtMs: now }, now), null, 'a draft with no clock has none');
      assert.equal(
        resolveFreestyleDraftStart({ startedAtMs, savedAtMs: now - 2 * 60 * 1000 }, now),
        startedAtMs,
        'two minutes after the process died, the session is the same session',
      );
      assert.equal(
        resolveFreestyleDraftStart({ startedAtMs, savedAtMs: now - FREESTYLE_DRAFT_CLOCK_MAX_AGE_MS }, now),
        startedAtMs,
        'the boundary belongs to the session, not past it',
      );
      assert.equal(
        resolveFreestyleDraftStart({ startedAtMs, savedAtMs: now - 3 * 24 * 60 * 60 * 1000 }, now),
        now,
        'a board found three days later is the same lifts and a new session',
      );
      assert.equal(
        resolveFreestyleDraftStart({ startedAtMs, savedAtMs: now + 60 * 60 * 1000 }, now),
        now,
        'a draft saved in the future says nothing about how long ago that was',
      );
    },
  },
  {
    name: 'a free workout board keeps one session id: kept with the draft, carried into the save, made once for an old draft',
    run() {
      const lift = { localKey: 'a', name: 'Bench Press', sets: [{ localKey: 's1', kg: '60', reps: '8', done: true }] };
      assert.equal(normalizeDraftForSessionId({ exercises: [lift], sessionId: 'session_abc' }).sessionId, 'session_abc', 'the id comes back with the draft');
      assert.equal(normalizeDraftForSessionId({ exercises: [lift] }).sessionId, null, 'a draft an older build wrote has none');
      assert.equal(normalizeDraftForSessionId({ exercises: [lift], sessionId: 42 }).sessionId, null, 'a junk id is none');
      assert.equal(resolveFreestyleSessionId({ sessionId: 'session_abc' }), 'session_abc', 'a board brought back from a draft saves under its id');
      assert.match(resolveFreestyleSessionId(null), /^session_/, 'a new board makes one');
      assert.match(resolveFreestyleSessionId({ sessionId: null }), /^session_/, 'an old draft gets one when its board opens');
      const { summary } = buildFreestyleFinish({
        exercises: [makeExercise()],
        workoutName: 'Free workout',
        startedAtIso: '2026-10-03T10:00:00.000Z',
        performedAtIso: '2026-10-03T10:30:00.000Z',
        elapsedSeconds: 1800,
        exercisePrLookup: emptyPrLookup,
        sessionId: 'session_abc',
      });
      assert.equal(summary.sessionId, 'session_abc', 'the save is handed the id of the board');
    },
  },
  {
    name: 'a free workout save under a taken id: a true retry writes nothing, other sets (or the same sets in other lifts) get an id of their own; the draft of a saved workout is dropped only when everything in it is saved',
    run() {
      const set = (reps, weight, orderIndex = 0) => ({ reps, weight, orderIndex, status: 'completed', outcome: 'completed' });
      const pending = { reps: 0, weight: 0, orderIndex: 9, status: 'pending', outcome: null };
      const log = (sessionId, name, orderIndex, sets) => ({ sessionId, exerciseNameSnapshot: name, orderIndex, sets });
      const database = {
        workoutSessions: [{ id: 'session_a' }],
        exerciseLogs: [
          log('session_a', 'Bench Press', 0, [set(8, 60, 0), set(6, 62.5, 1), pending]),
          log('session_a', 'Row', 1, [set(10, 50, 0)]),
          log('session_other', 'Bench Press', 0, [set(1, 1)]),
        ],
      };
      const same = [log('x', 'bench press', 0, [set(8, 60, 0), set(6, 62.5, 1)]), log('x', 'Row', 1, [set(10, 50, 0)])];
      assert.deepEqual(resolveFreestyleSaveTarget(database, 'session_a', same), { sessionId: 'session_a', alreadySaved: true }, 'the same lifts and sets are the finish that landed');
      const pooledOnly = [log('x', 'Bench Press', 0, [set(8, 60, 0), set(6, 62.5, 1), set(10, 50, 2)]), log('x', 'Row', 1, [])];
      const regrouped = resolveFreestyleSaveTarget(database, 'session_a', pooledOnly);
      assert.equal(regrouped.alreadySaved, false, 'the same sets pooled into other lifts are another workout');
      assert.equal(regrouped.sessionId, 'session_a_b', 'which gets an id of its own, the same one every time it is asked');
      const swapped = [log('x', 'Row', 0, [set(10, 50, 0)]), log('x', 'Bench Press', 1, [set(8, 60, 0), set(6, 62.5, 1)])];
      assert.equal(resolveFreestyleSaveTarget(database, 'session_a', swapped).alreadySaved, false, 'the same lifts in another order are another workout');
      const more = [...same, log('x', 'Curl', 2, [set(12, 20, 0)])];
      assert.equal(resolveFreestyleSaveTarget(database, 'session_a', more).alreadySaved, false, 'more sets than were saved are not saved yet');
      assert.deepEqual(resolveFreestyleSaveTarget(database, 'session_new', more), { sessionId: 'session_new', alreadySaved: false }, 'a free id is used as it is');
      const taken = { ...database, workoutSessions: [...database.workoutSessions, { id: 'session_a_b' }], exerciseLogs: [...database.exerciseLogs, log('session_a_b', 'Curl', 0, [set(12, 20, 0)])] };
      assert.deepEqual(resolveFreestyleSaveTarget(taken, 'session_a', [log('x', 'Curl', 0, [set(12, 20, 0)])]), { sessionId: 'session_a_b', alreadySaved: true }, 'a suffixed id that holds exactly these sets is where they are');

      const board = (done) => [
        { localKey: 'l1', name: 'Bench Press', sets: [{ localKey: 's1', kg: '60', reps: '8', done: done[0] }, { localKey: 's2', kg: '62.5', reps: '6', done: done[1] }] },
        { localKey: 'l2', name: 'Row', sets: [{ localKey: 's3', kg: '50', reps: '10', done: true }] },
      ];
      const draft = (done, sessionId = 'session_a') => ({ exercises: board(done), startedAtMs: null, rest: null, savedAtMs: 1, sessionId });
      assert.equal(discardSavedFreestyleDraft(draft([true, true]), database), null, 'the leftover of a saved workout is dropped');
      assert.equal(discardSavedFreestyleDraft(draft([true, false]), database), null, 'a draft handed over before the last tick is a subset of the save, and goes');
      const extra = { ...draft([true, true]), exercises: [...board([true, true]), { localKey: 'l3', name: 'Curl', sets: [{ localKey: 's4', kg: '20', reps: '12', done: true }] }] };
      const kept = discardSavedFreestyleDraft(extra, database);
      assert.ok(kept && kept.exercises.length === 3, 'a draft with a set the saved workout lacks stays');
      assert.equal(kept.sessionId, 'session_a', 'under its own id: its Finish merges into the saved workout (mergeStoredBoardLogs)');
      // When the draft was written against when the save landed: a draft written before the save is that save less
      // its last edits (the draft trails the board by 400 ms), and goes whatever it holds; one written after it is the
      // board carried on, and stays.
      const timed = { ...database, workoutSessions: [{ id: 'session_a', performedAt: '2026-10-03T10:00:00.000Z' }] };
      const at = (iso) => Date.parse(iso);
      const changedWeight = { ...draft([true, true]), exercises: board([true, true]).map((lift, index) => (index === 0 ? { ...lift, sets: [{ ...lift.sets[0], kg: '57.5' }, lift.sets[1]] } : lift)) };
      assert.equal(discardSavedFreestyleDraft({ ...changedWeight, savedAtMs: at('2026-10-03T09:59:59.700Z') }, timed), null, 'a weight changed in the last 400 ms before Finish: the draft is behind its save, and goes');
      assert.equal(discardSavedFreestyleDraft({ ...extra, savedAtMs: at('2026-10-03T10:00:00.000Z') }, timed), null, 'written in the same moment as the save is not after it');
      assert.equal(discardSavedFreestyleDraft({ ...extra, savedAtMs: at('2026-10-03T10:05:00.000Z') }, timed).sessionId, 'session_a', 'written after the save: the board carried on, kept');
      assert.equal(discardSavedFreestyleDraft({ ...changedWeight, savedAtMs: 0 }, timed).sessionId, 'session_a', 'a draft that does not say when it was written is judged by its sets alone');
      assert.equal(discardSavedFreestyleDraft(draft([true, true], 'session_b'), database).sessionId, 'session_b', 'a draft of an unsaved workout is untouched');
      assert.equal(discardSavedFreestyleDraft({ ...draft([true, true]), sessionId: null }, database).sessionId, null, 'an old draft with no id stays');
      assert.equal(discardSavedFreestyleDraft(null, database), null);
    },
  }
];
