const assert = require('node:assert/strict');

const {
  completeWorkoutSession,
  workoutReducer,
  workoutInitialState,
} = require('../../../.test-dist/features/workout/workoutState.js');
const { createCompletedSession, createExercise, createSet } = require('../../helpers/workoutFixtures.cjs');
const {
  buildExerciseLogDraftsFromWorkoutSession,
} = require('../../../.test-dist/features/workout/workoutAppAdapter.js');

module.exports = [
  {
    name: 'finishWorkout can lock a custom performedAt into the completion summary',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        ui: {
          activeSlotId: null,
          activeSetIndex: 0,
          focusedField: null,
          noteEditorSlotId: null,
          swapSheetSlotId: null,
          expandedSlotIds: [],
          finishSummaryOpen: false,
        },
      });

      const performedAt = '2026-03-31T10:30:00.000Z';
      const nextState = completeWorkoutSession(
        {
          ...workoutInitialState,
          activeSession,
        },
        performedAt,
      );

      assert.equal(nextState.activeSession.status, 'completed');
      assert.equal(nextState.activeSession.completedAt, performedAt);
      assert.equal(nextState.completionSummary.performedAt, performedAt);
    },
  },
  {
    name: 'tick does not keep completed workouts running in the background',
    run() {
      const completedAt = '2026-03-31T10:30:00.000Z';
      const activeSession = createCompletedSession({
        status: 'completed',
        completedAt,
        startedAt: '2026-03-31T09:30:00.000Z',
        updatedAt: completedAt,
        elapsedSeconds: 3600,
        restTimer: {
          status: 'idle',
          exerciseSlotId: null,
          setIndex: null,
          startedAtMs: null,
          endsAtMs: null,
          durationSeconds: 0,
        },
      });

      const nextState = workoutReducer(
        {
          ...workoutInitialState,
          activeSession,
          nowMs: Date.parse(completedAt),
        },
        { type: 'session/tick', payload: { nowMs: Date.parse(completedAt) + 8 * 60 * 60 * 1000 } },
      );

      assert.equal(nextState.activeSession.elapsedSeconds, 3600);
      assert.equal(nextState.activeSession.restTimer.status, 'idle');
      assert.equal(nextState.activeSession.updatedAt, completedAt);
    },
  },
  {
    name: 'discardWorkout clears the active session without creating a completion summary',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
      });

      const nextState = workoutReducer(
        {
          ...workoutInitialState,
          activeSession,
        },
        { type: 'session/discardWorkout' },
      );

      assert.equal(nextState.activeSession, null);
      assert.equal(nextState.completionSummary, null);
      assert.equal(nextState.history.sessions.length, 0);
    },
  },
  {
    name: 'recordSetEffort stores a quick effort read on a completed set',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [
          createExercise({
            sets: [
              createSet({
                setIndex: 0,
                status: 'completed',
                effort: null,
                actualLoadKg: 90,
                actualReps: 6,
              }),
            ],
          }),
        ],
      });

      const nextState = workoutReducer(
        {
          ...workoutInitialState,
          activeSession,
        },
        { type: 'set/recordEffort', payload: { slotId: activeSession.exercises[0].slotId, setIndex: 0, effort: 'hard' } },
      );

      assert.equal(nextState.activeSession.exercises[0].sets[0].effort, 'hard');
    },
  },
  {
    name: 'completing the last set of a session starts no rest',
    run() {
      // Rest is the gap before the next set. Reported from the phone: the bar
      // opened on the final tick, counted down to a set that did not exist,
      // and covered the finish button while it did.
      const lastSet = createSet({ setIndex: 0, status: 'pending', actualReps: null, completedAt: null });
      const exercise = createExercise({ sets: [lastSet], status: 'active' });
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [exercise],
      });

      const nextState = workoutReducer(
        { ...workoutInitialState, nowMs: 1000, activeSession },
        {
          type: 'set/complete',
          payload: { slotId: exercise.slotId, setIndex: 0, nowMs: 1000, unitPreference: 'kg' },
        },
      );

      assert.equal(nextState.activeSession.exercises[0].sets[0].status, 'completed');
      assert.equal(nextState.activeSession.restTimer.status, 'idle');
    },
  },
  {
    name: 'completing a set with another still pending starts the rest',
    run() {
      const exercise = createExercise({
        sets: [
          createSet({ setIndex: 0, status: 'pending', actualReps: null, completedAt: null }),
          createSet({ setIndex: 1, status: 'pending', actualReps: null, completedAt: null }),
        ],
        status: 'active',
      });
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [exercise],
      });

      const nextState = workoutReducer(
        { ...workoutInitialState, nowMs: 1000, activeSession },
        {
          type: 'set/complete',
          payload: { slotId: exercise.slotId, setIndex: 0, nowMs: 1000, unitPreference: 'kg' },
        },
      );

      assert.equal(nextState.activeSession.restTimer.status, 'running');
      assert.equal(nextState.activeSession.restTimer.durationSeconds, exercise.restSecondsMin);
    },
  },
  {
    name: 'timer override resets a running rest timer to the premium suggestion',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        restTimer: {
          status: 'running',
          exerciseSlotId: 'slot-1',
          setIndex: 0,
          startedAtMs: 1000,
          endsAtMs: 121000,
          durationSeconds: 120,
        },
      });

      const nextState = workoutReducer(
        {
          ...workoutInitialState,
          nowMs: 1000,
          activeSession,
        },
        { type: 'timer/override', payload: { durationSeconds: 150, nowMs: 5000 } },
      );

      assert.equal(nextState.activeSession.restTimer.durationSeconds, 150);
      assert.equal(nextState.activeSession.restTimer.startedAtMs, 5000);
      assert.equal(nextState.activeSession.restTimer.endsAtMs, 155000);
    },
  },
  {
    name: 'timer override updates paused rest duration without resuming',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        restTimer: {
          status: 'paused',
          exerciseSlotId: 'slot-1',
          setIndex: 0,
          startedAtMs: 1000,
          endsAtMs: null,
          durationSeconds: 60,
        },
      });

      const nextState = workoutReducer(
        {
          ...workoutInitialState,
          nowMs: 1000,
          activeSession,
        },
        { type: 'timer/override', payload: { durationSeconds: 90, nowMs: 5000 } },
      );

      assert.equal(nextState.activeSession.restTimer.status, 'paused');
      assert.equal(nextState.activeSession.restTimer.durationSeconds, 90);
      assert.equal(nextState.activeSession.restTimer.endsAtMs, null);
    },
  },
  {
    name: 'swapping an exercise renames it and drops the old prefilled load',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [
          createExercise({
            exerciseName: 'Leg Press',
            substitutionGroup: 'squat_pattern',
            status: 'active',
            sets: [
              createSet({ setIndex: 0, actualLoadKg: 150, draftLoadText: '150', plannedLoadKg: 150 }),
              createSet({
                setIndex: 1,
                status: 'pending',
                plannedLoadKg: 150,
                draftLoadText: '150',
                draftRepsText: '',
                actualLoadKg: undefined,
                actualReps: undefined,
                completedAt: undefined,
                edited: false,
                autoProgressedFromKg: 147.5,
              }),
            ],
          }),
        ],
      });

      const nextState = workoutReducer(
        { ...workoutInitialState, activeSession },
        {
          type: 'exercise/swap',
          payload: {
            slotId: activeSession.exercises[0].slotId,
            exerciseName: 'Front Squat',
            substitutionGroup: 'squat_pattern',
            unitPreference: 'kg',
          },
        },
      );

      const swapped = nextState.activeSession.exercises[0];
      assert.equal(swapped.exerciseName, 'Front Squat');
      assert.equal(swapped.sourceExerciseName, 'Leg Press');
      assert.equal(swapped.status, 'swapped');

      // What was actually lifted stays on the record.
      assert.equal(swapped.sets[0].actualLoadKg, 150);

      // Never squatted before, so the field opens empty rather than on the leg
      // press weight — and automated progression cannot claim it picked one.
      assert.equal(swapped.sets[1].draftLoadText, '');
      assert.equal(swapped.sets[1].plannedLoadKg, undefined);
      assert.equal(swapped.sets[1].autoProgressedFromKg, undefined);
      assert.equal(swapped.sets[1].prefilledFromPerformedAt, undefined);
    },
  },
  {
    name: 'swapping to a lift you have done elsewhere prefills what you lifted',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [
          createExercise({
            exerciseName: 'Leg Press',
            substitutionGroup: 'squat_pattern',
            status: 'active',
            sets: [
              createSet({
                setIndex: 0,
                status: 'pending',
                plannedLoadKg: 150,
                draftLoadText: '150',
                draftRepsText: '',
                actualLoadKg: undefined,
                actualReps: undefined,
                completedAt: undefined,
                edited: false,
              }),
            ],
          }),
        ],
      });

      // Front squats done in a DIFFERENT program. Slot-keyed history cannot
      // reach this; the name lookup can, and it is a weight the user actually
      // lifted rather than anything estimated.
      const history = {
        sessions: [],
        lastSelectedTemplateId: null,
        slotHistory: {
          'tpl_other:day_2:legs_1': [
            {
              slotId: 'tpl_other:day_2:legs_1',
              templateId: 'tpl_other',
              templateName: 'Other plan',
              exerciseName: 'Front Squat',
              substitutionGroup: 'squat_pattern',
              performedAt: '2026-07-12T09:00:00.000Z',
              sessionId: 'session_x',
              sets: [{ setIndex: 0, loadKg: 65, reps: 6, completedAt: '2026-07-12T09:05:00.000Z' }],
              skipped: false,
            },
          ],
        },
      };

      const nextState = workoutReducer(
        { ...workoutInitialState, history, activeSession },
        {
          type: 'exercise/swap',
          payload: {
            slotId: activeSession.exercises[0].slotId,
            exerciseName: 'Front Squat',
            substitutionGroup: 'squat_pattern',
            unitPreference: 'kg',
          },
        },
      );

      const swapped = nextState.activeSession.exercises[0];
      assert.equal(swapped.sets[0].draftLoadText, '65');
      assert.equal(swapped.sets[0].plannedLoadKg, 65);
      // Borrowed history never feeds the progression gate, so no AUTO badge…
      assert.equal(swapped.sets[0].autoProgressedFromKg, undefined);
      // …but the weight says where it came from instead of appearing from air.
      assert.equal(swapped.sets[0].prefilledFromPerformedAt, '2026-07-12T09:00:00.000Z');
    },
  },
  {
    name: 'a brand-new slot prefills from the same lift done in another program',
    run() {
      // Nothing has ever been logged on this slot. The lift itself has been —
      // in a different plan. Slot-keyed history is blind to that, which is why
      // a lift you have done for months used to open at zero in a new program.
      const history = {
        sessions: [],
        lastSelectedTemplateId: null,
        slotHistory: {
          'tpl_other:day_2:legs_1': [
            {
              slotId: 'tpl_other:day_2:legs_1',
              templateId: 'tpl_other',
              templateName: 'Other plan',
              exerciseName: 'Front Squat',
              substitutionGroup: 'squat_pattern',
              performedAt: '2026-07-12T09:00:00.000Z',
              sessionId: 'session_x',
              sets: [
                { setIndex: 0, loadKg: 65, reps: 8, completedAt: '2026-07-12T09:05:00.000Z' },
                { setIndex: 1, loadKg: 67.5, reps: 8, completedAt: '2026-07-12T09:10:00.000Z' },
              ],
              skipped: false,
            },
          ],
        },
      };

      const template = {
        id: 'tpl_new',
        name: 'New plan',
        defaultScheduleMode: 'rolling_sequence',
        sessions: [
          {
            id: 'day_1',
            name: 'Legs',
            orderIndex: 0,
            exercises: [
              {
                id: 'ex_1',
                exerciseName: 'Front Squat',
                slotId: 'primary_squat',
                role: 'primary',
                progressionPriority: 'high',
                trackingMode: 'load_and_reps',
                sets: 2,
                repsMin: 6,
                repsMax: 8,
                restSecondsMin: 120,
                restSecondsMax: 180,
                substitutionGroup: 'squat_pattern',
              },
            ],
          },
        ],
      };

      const nextState = workoutReducer(
        { ...workoutInitialState, history },
        {
          type: 'session/startFromRuntimeTemplate',
          payload: {
            template,
            sessionOrderIndex: 0,
            unitPreference: 'kg',
            // ON, and a rep ceiling was cleared on every set of that session —
            // the gate would happily add 2.5 kg if it were fed this history.
            progression: { automatedProgressionEnabled: true, setupLevel: 'beginner' },
          },
        },
      );

      const sets = nextState.activeSession.exercises[0].sets;
      assert.equal(sets[0].draftLoadText, '65');
      assert.equal(sets[0].plannedLoadKg, 65);
      assert.equal(sets[1].plannedLoadKg, 67.5);

      // Decision A: borrowed history seeds the number and NOTHING else. The
      // gate judges "rep ceiling cleared" against this template's rep range,
      // and those sets were performed under another prescription — so it must
      // not move a weight off sessions it never watched, and the AUTO badge
      // must not appear on one.
      assert.equal(sets[0].autoProgressedFromKg, undefined);
      assert.equal(sets[1].autoProgressedFromKg, undefined);

      // Decision B: the weight says where it came from.
      assert.equal(sets[0].prefilledFromPerformedAt, '2026-07-12T09:00:00.000Z');

      // Reps stay empty either way — entering them is what logs the set.
      assert.equal(sets[0].draftRepsText, '');
    },
  },
  {
    name: 'a set logged before "skip this exercise" survives into the saved log',
    run() {
      // Seen on a phone: one set of squats logged, then "Ohita tämä liike" to
      // move on. The completion screen celebrated a new record; Progress said
      // 0 kg, 0 sets; Ennätykset said no records. The skip had marked the
      // whole exercise `skipped`, and `skipped` is what drops a log from every
      // stat. The set that happened has to stay a set.
      const pending = (setIndex) =>
        createSet({
          setIndex,
          status: 'pending',
          actualLoadKg: null,
          actualReps: null,
          completedAt: undefined,
          draftRepsText: '',
          edited: false,
        });
      const exercise = createExercise({
        slotId: 'slot_squat',
        exerciseName: 'Back Squat',
        status: 'active',
        sets: [
          createSet({ setIndex: 0, actualLoadKg: 20, actualReps: 6 }),
          pending(1),
          pending(2),
          pending(3),
        ],
      });
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [exercise],
      });

      const nextState = workoutReducer(
        { ...workoutInitialState, activeSession },
        { type: 'exercise/skip', payload: { slotId: 'slot_squat' } },
      );

      const skipped = nextState.activeSession.exercises[0];
      // The remaining sets are skipped; the logged one is untouched.
      assert.deepEqual(
        skipped.sets.map((set) => set.status),
        ['completed', 'skipped', 'skipped', 'skipped'],
      );
      // And the exercise is done, not skipped — one set was.
      assert.equal(skipped.status, 'completed');

      // What reaches the database carries the set and is not filtered out.
      const [draft] = buildExerciseLogDraftsFromWorkoutSession(nextState.activeSession);
      assert.equal(draft.skipped, false);
      assert.equal(draft.sets.filter((set) => set.outcome === 'completed').length, 1);
      assert.equal(draft.sets[0].weight, 20);
    },
  },
  {
    name: 'skipping an exercise with nothing logged still marks it skipped',
    run() {
      // The other half of the rule: no set done, the exercise reads skipped
      // and stays out of the stats — as before.
      const pending = (setIndex) =>
        createSet({ setIndex, status: 'pending', actualLoadKg: null, actualReps: null, completedAt: undefined, edited: false });
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [createExercise({ slotId: 'slot_bench', status: 'active', sets: [pending(0), pending(1)] })],
      });

      const nextState = workoutReducer(
        { ...workoutInitialState, activeSession },
        { type: 'exercise/skip', payload: { slotId: 'slot_bench' } },
      );

      assert.equal(nextState.activeSession.exercises[0].status, 'skipped');
      const [draft] = buildExerciseLogDraftsFromWorkoutSession(nextState.activeSession);
      assert.equal(draft.skipped, true);
    },
  },
  {
    /**
     * The gate can be right and the badge still never appear.
     * materializeExercise builds each set by listing its fields by hand, and
     * heldForFatigue was never on that list: the gate computed the hold,
     * resolveHistoricalSetDraft carried it, and the set dropped it. So the
     * recovery badge — a Pro behaviour the paywall sells by name — had never
     * once been shown. Guarded here rather than in the gate's own tests,
     * because the gate was right the whole time; it was the hop into the set
     * that lost it.
     */
    name: 'a recovery hold survives the hop from the gate into the set',
    run() {
      const SLOT = 'primary_press_1';
      const DAY_MS = 86400000;
      const now = Date.parse('2026-08-24T09:00:00.000Z');
      const ceilingEntry = (daysAgo) => ({
        slotId: SLOT,
        templateId: 'tpl',
        templateName: 'Push',
        exerciseName: 'Bench Press',
        substitutionGroup: 'horizontal_press',
        performedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
        sessionId: 'sess-' + daysAgo,
        sets: [0, 1, 2].map((setIndex) => ({
          setIndex,
          loadKg: 60,
          reps: 12,
          completedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
        })),
        skipped: false,
      });

      const start = (fatigueSignal) =>
        workoutReducer(
          {
            ...workoutInitialState,
            history: {
              sessions: [],
              lastSelectedTemplateId: null,
              slotHistory: { [SLOT]: [ceilingEntry(0), ceilingEntry(3)] },
            },
          },
          {
            type: 'session/startFromRuntimeTemplate',
            payload: {
              template: {
                id: 'tpl',
                name: 'Push',
                defaultScheduleMode: 'weekday',
                sessions: [
                  {
                    id: 'push_a',
                    name: 'Push A',
                    orderIndex: 1,
                    exercises: [
                      {
                        id: 'ex_bench',
                        exerciseName: 'Bench Press',
                        slotId: SLOT,
                        role: 'primary',
                        progressionPriority: 'high',
                        trackingMode: 'load_and_reps',
                        sets: 3,
                        repsMin: 8,
                        repsMax: 12,
                        restSecondsMin: 120,
                        restSecondsMax: 150,
                        substitutionGroup: 'horizontal_press',
                      },
                    ],
                  },
                ],
              },
              sessionOrderIndex: 1,
              unitPreference: 'kg',
              progression: {
                automatedProgressionEnabled: true,
                setupLevel: 'beginner',
                fatigueSignal,
                nowMs: now,
              },
            },
          },
        ).activeSession.exercises[0].sets[0];

      // Both sessions cleared the ceiling: rested, the load moves.
      const rested = start(undefined);
      assert.equal(rested.plannedLoadKg, 62.5);
      assert.equal(rested.heldForFatigue, undefined);

      // Cooked: the load stays AND the set says why.
      const cooked = start('high');
      assert.equal(cooked.plannedLoadKg, 60);
      assert.equal(cooked.heldForFatigue, true);
    },
  },
  {
    /**
     * Onboarding tells a reader with flagged areas that the app never raises
     * the weight on lifts that load them. Until 2026-09-30 it said "we keep
     * loads light" and nothing read the flags for load at all. This is the
     * promise end to end: the flags ride in with the session start, the gate
     * holds the earned jump, and the set names the area.
     */
    name: 'a flagged area holds an earned jump on the lifts that load it, and the advisory says so',
    run() {
      const { t } = require('../../../.test-dist/lib/i18n.js');
      const SLOT = 'primary_squat_1';
      const DAY_MS = 86400000;
      const now = Date.parse('2026-08-24T09:00:00.000Z');
      const ceilingEntry = (daysAgo) => ({
        slotId: SLOT,
        templateId: 'tpl',
        templateName: 'Legs',
        exerciseName: 'Back Squat',
        substitutionGroup: 'squat',
        performedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
        sessionId: 'sess-' + daysAgo,
        sets: [0, 1, 2].map((setIndex) => ({
          setIndex,
          loadKg: 80,
          reps: 8,
          completedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
        })),
        skipped: false,
      });

      const start = (cautionFlags) =>
        workoutReducer(
          {
            ...workoutInitialState,
            history: {
              sessions: [],
              lastSelectedTemplateId: null,
              slotHistory: { [SLOT]: [ceilingEntry(0), ceilingEntry(3)] },
            },
          },
          {
            type: 'session/startFromRuntimeTemplate',
            payload: {
              template: {
                id: 'tpl',
                name: 'Legs',
                defaultScheduleMode: 'weekday',
                sessions: [
                  {
                    id: 'legs_a',
                    name: 'Legs A',
                    orderIndex: 1,
                    exercises: [
                      {
                        id: 'ex_squat',
                        exerciseName: 'Back Squat',
                        slotId: SLOT,
                        role: 'primary',
                        progressionPriority: 'high',
                        trackingMode: 'load_and_reps',
                        sets: 3,
                        repsMin: 5,
                        repsMax: 8,
                        restSecondsMin: 150,
                        restSecondsMax: 180,
                        substitutionGroup: 'squat',
                      },
                    ],
                  },
                ],
              },
              sessionOrderIndex: 1,
              unitPreference: 'kg',
              progression: {
                automatedProgressionEnabled: true,
                setupLevel: 'beginner',
                cautionFlags,
                nowMs: now,
              },
            },
          },
        ).activeSession.exercises[0].sets[0];

      // No flags: the ceiling was cleared twice, the load moves.
      const open = start([]);
      assert.equal(open.plannedLoadKg, 82.5);
      assert.equal(open.heldForCautionArea, undefined);

      // Knees flagged careful: the squat keeps its weight and says why.
      const careful = start([{ area: 'knees', level: 'careful', refinements: [] }]);
      assert.equal(careful.plannedLoadKg, 80);
      assert.equal(careful.autoProgressedFromKg, undefined);
      assert.equal(careful.heldForCautionArea, 'knees');

      // `info` promises nothing about training, and another area's flag does
      // not touch a squat.
      assert.equal(start([{ area: 'knees', level: 'info', refinements: [] }]).plannedLoadKg, 82.5);
      assert.equal(start([{ area: 'shoulders', level: 'careful', refinements: [] }]).plannedLoadKg, 82.5);

      // And the sentence the reader was shown is the one the code keeps.
      assert.match(t('en', 'onb.avoid.advisory'), /never add weight or reps on exercises that load these areas/);
      assert.match(t('fi', 'onb.avoid.advisory'), /emme koskaan lisää painoa tai toistoja liikkeisiin, jotka kuormittavat näitä kohtia/);
      assert.doesNotMatch(t('en', 'onb.avoid.advisory'), /keep loads light/);
      assert.doesNotMatch(t('fi', 'onb.avoid.advisory'), /pidämme kuormat kevyinä/);
    },
  },
  {
    name: 'the freestyle draft rides in the bundle: hydrated, saved, cleared',
    run() {
      const { workoutReducer, workoutInitialState } = require('../../../.test-dist/features/workout/workoutState.js');
      const snapshot = {
        exercises: [{ localKey: 'a', name: 'Bench', libraryItemId: null, imageUrl: null, repMin: 6, repMax: 8, restSeconds: 90, trackedDefault: true, sets: [{ localKey: 's', kg: '60', reps: '8', done: true }], supersetGroup: null, displayName: 'Bench', initials: 'BE', metaLabel: '', isBarbell: false }],
        startedAtMs: 1,
        rest: null,
        savedAtMs: 2,
      };
      const history = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };
      const hydrated = workoutReducer(workoutInitialState, {
        type: 'session/hydrate',
        payload: { activeSession: null, history, activeCardio: null, freestyleDraft: snapshot },
      });
      assert.deepEqual(hydrated.freestyleDraft, snapshot, 'a stored draft is back after hydrate');
      const without = workoutReducer(workoutInitialState, {
        type: 'session/hydrate',
        payload: { activeSession: null, history, activeCardio: null },
      });
      assert.equal(without.freestyleDraft, null, 'a bundle from before the field hydrates to no draft');
      const saved = workoutReducer(without, { type: 'freestyle/save', payload: { snapshot } });
      assert.deepEqual(saved.freestyleDraft, snapshot);
      const cleared = workoutReducer(saved, { type: 'freestyle/clear' });
      assert.equal(cleared.freestyleDraft, null);
      assert.equal(workoutReducer(cleared, { type: 'freestyle/clear' }), cleared, 'clearing nothing is the same state');
    },
  },
  {
    /**
     * Recheck round 2026-09-29: the guided player's cooldown-only sessions
     * (`exercises = []`, no main block) had nowhere to anchor a mid-workout
     * add — `insertExerciseAfter(anchor.slotId, …)` needs an `anchor`, and
     * there is no last exercise when there was never a first one. A null
     * anchor now means "insert at the front", which for an empty list is the
     * only place there is.
     */
    name: 'inserting after a null anchor appends into an empty session',
    run() {
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [],
      });

      const insertInput = {
        exerciseName: 'Standing Calf Stretch',
        trackingMode: 'hold',
        sets: 1,
        repsMin: 0,
        repsMax: 0,
        restSecondsMin: 0,
        restSecondsMax: 0,
        substitutionGroup: 'lib_calf_stretch',
        libraryItemId: 'lib_calf_stretch',
      };

      const nextState = workoutReducer(
        { ...workoutInitialState, activeSession },
        { type: 'exercise/insertAfter', payload: { afterSlotId: null, exercise: insertInput } },
      );

      assert.equal(nextState.activeSession.exercises.length, 1);
      const inserted = nextState.activeSession.exercises[0];
      assert.equal(inserted.exerciseName, 'Standing Calf Stretch');
      assert.equal(inserted.orderIndex, 0);
      // A real slot id, not the null anchor echoed back — the guided
      // player's own effect resolves the new lift by finding the ONE slot
      // id that was not already known (see GuidedPlayerScreen's
      // pendingInsertKnownSlotsRef), so this has to actually mint one.
      assert.equal(typeof inserted.slotId, 'string');
      assert.ok(inserted.slotId.length > 0);
    },
  },
  {
    name: 'inserting after a real anchor still lands right after it, null anchor unaffected',
    run() {
      const first = createExercise({ slotId: 'slot_a', exerciseName: 'Back Squat', orderIndex: 0 });
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [first],
      });

      const insertInput = {
        exerciseName: 'Leg Extension',
        trackingMode: 'load_and_reps',
        sets: 3,
        repsMin: 10,
        repsMax: 12,
        restSecondsMin: 60,
        restSecondsMax: 60,
        substitutionGroup: 'lib_leg_extension',
        libraryItemId: 'lib_leg_extension',
      };

      const nextState = workoutReducer(
        { ...workoutInitialState, activeSession },
        { type: 'exercise/insertAfter', payload: { afterSlotId: 'slot_a', exercise: insertInput } },
      );

      assert.equal(nextState.activeSession.exercises.length, 2);
      assert.equal(nextState.activeSession.exercises[0].slotId, 'slot_a');
      assert.equal(nextState.activeSession.exercises[1].exerciseName, 'Leg Extension');
      assert.equal(nextState.activeSession.exercises[1].orderIndex, 1);
    },
  },
  {
    name: 'inserting after a slot id that no longer exists is a no-op, not a front-of-list insert',
    run() {
      // Only an explicit `null` means "insert at the front". A stale or
      // mistyped slot id must not silently fall back to the same place —
      // that would hide a real bug (a slot removed between the button being
      // shown and the button being pressed) as a successful insert.
      const activeSession = createCompletedSession({
        status: 'active',
        completedAt: undefined,
        exercises: [createExercise({ slotId: 'slot_a' })],
      });

      const initialState = { ...workoutInitialState, activeSession };
      const nextState = workoutReducer(initialState, {
        type: 'exercise/insertAfter',
        payload: {
          afterSlotId: 'slot_that_does_not_exist',
          exercise: {
            exerciseName: 'Leg Extension',
            trackingMode: 'load_and_reps',
            sets: 3,
            repsMin: 10,
            repsMax: 12,
            restSecondsMin: 60,
            restSecondsMax: 60,
            substitutionGroup: 'lib_leg_extension',
            libraryItemId: 'lib_leg_extension',
          },
        },
      });

      // The reducer's early-return path hands back the very state it was
      // given — nothing cloned, nothing inserted.
      assert.equal(nextState, initialState);
      assert.equal(nextState.activeSession.exercises.length, 1);
    },
  },
  {
    // #bugs 2026-10-02: two lifts added from one walk-up intro. The screen now
    // anchors the second on the first; the reducer splices right behind its
    // anchor, so the order is the order of adding.
    name: 'adding two lifts, the second anchored on the first, keeps the order they were added in',
    run() {
      const bench = createExercise({ slotId: 'slot_bench', exerciseName: 'Bench Press', orderIndex: 0 });
      const row = createExercise({ slotId: 'slot_row', exerciseName: 'Barbell Row', orderIndex: 1 });
      const activeSession = createCompletedSession({ status: 'active', completedAt: undefined, exercises: [bench, row] });
      const input = (name) => ({
        exerciseName: name,
        trackingMode: 'load_and_reps',
        sets: 3,
        repsMin: 10,
        repsMax: 12,
        restSecondsMin: 60,
        restSecondsMax: 60,
        substitutionGroup: name,
        libraryItemId: name,
      });
      const afterFirst = workoutReducer(
        { ...workoutInitialState, activeSession },
        { type: 'exercise/insertAfter', payload: { afterSlotId: 'slot_bench', exercise: input('Cable Curl') } },
      );
      const curlSlot = afterFirst.activeSession.exercises[1].slotId;
      const afterSecond = workoutReducer(afterFirst, {
        type: 'exercise/insertAfter',
        payload: { afterSlotId: curlSlot, exercise: input('Pushdown') },
      });
      assert.deepEqual(
        afterSecond.activeSession.exercises.map((exercise) => exercise.exerciseName),
        ['Bench Press', 'Cable Curl', 'Pushdown', 'Barbell Row'],
      );
      assert.deepEqual(
        afterSecond.activeSession.exercises.map((exercise) => exercise.orderIndex),
        [0, 1, 2, 3],
      );
    },
  },
];
