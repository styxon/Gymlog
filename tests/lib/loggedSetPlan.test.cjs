const assert = require('node:assert/strict');

const { buildLoggedSetPlan, normalizeLoggedSetPlan } = require('../../.test-dist/lib/loggedSetPlan');
const { normalizeExerciseLogDraft } = require('../../.test-dist/lib/exerciseLog');
const { workoutReducer, workoutInitialState } = require('../../.test-dist/features/workout/workoutState');
const { buildExerciseLogDraftsFromWorkoutSession } = require('../../.test-dist/features/workout/workoutAppAdapter');

const base = { plannedRepsMin: 6, plannedRepsMax: 8 };

module.exports = [
  {
    name: 'logged set plan: each prefill is saved with the reason the gate gave',
    run() {
      assert.deepEqual(buildLoggedSetPlan({ ...base, plannedLoadKg: 62.5, autoProgressedFromKg: 60 }), {
        loadKg: 62.5,
        repsMin: 6,
        repsMax: 8,
        targetReps: null,
        basis: 'progressed',
        fromKg: 60,
        fromReps: null,
        cautionArea: null,
      });
      const reps = buildLoggedSetPlan({ ...base, plannedTargetReps: 13, autoProgressedFromReps: 12 });
      assert.equal(reps.basis, 'progressed');
      assert.equal(reps.targetReps, 13);
      assert.equal(reps.fromReps, 12);

      const caution = buildLoggedSetPlan({ ...base, plannedLoadKg: 80, heldForCautionArea: 'knees' });
      assert.equal(caution.basis, 'held_caution');
      assert.equal(caution.cautionArea, 'knees');
      assert.equal(caution.loadKg, 80);

      assert.equal(buildLoggedSetPlan({ ...base, plannedLoadKg: 60, heldForFatigue: true }).basis, 'held_recovery');
      assert.equal(
        buildLoggedSetPlan({ ...base, plannedLoadKg: 60, prefilledFromPerformedAt: '2026-09-01T10:00:00.000Z' }).basis,
        'borrowed',
      );
      assert.equal(buildLoggedSetPlan({ ...base, plannedLoadKg: 60 }).basis, 'repeat');
      // An added set is the reader's, whatever the set it copied carried.
      assert.equal(
        buildLoggedSetPlan({ ...base, plannedLoadKg: 90, autoProgressedFromKg: 80, addedMidSession: true }).basis,
        'added',
      );
      // A lowered missed-reps target is the same weight again, at reps the
      // reader can meet: a repeat, with the reps it opened at.
      const lowered = buildLoggedSetPlan({ ...base, plannedLoadKg: 60, plannedTargetReps: 6 });
      assert.equal(lowered.basis, 'repeat');
      assert.equal(lowered.targetReps, 6);

      const empty = buildLoggedSetPlan(base);
      assert.equal(empty.basis, 'none');
      assert.equal(empty.loadKg, null);
    },
  },
  {
    name: 'logged set plan: a stored plan is read back whole or not at all',
    run() {
      const good = buildLoggedSetPlan({ ...base, plannedLoadKg: 80, heldForCautionArea: 'knees' });
      assert.deepEqual(normalizeLoggedSetPlan(JSON.parse(JSON.stringify(good))), good);

      assert.equal(normalizeLoggedSetPlan(undefined), null);
      assert.equal(normalizeLoggedSetPlan('progressed'), null);
      assert.equal(normalizeLoggedSetPlan({ ...good, basis: 'guessed' }), null);
      assert.equal(normalizeLoggedSetPlan({ ...good, loadKg: -5 }), null);
      assert.equal(normalizeLoggedSetPlan({ ...good, loadKg: 5122.5 }), null);
      assert.equal(normalizeLoggedSetPlan({ ...good, repsMax: 'eight' }), null);
      assert.equal(normalizeLoggedSetPlan({ ...good, cautionArea: 'spleen' }), null);
      // Missing optional numbers read as "none", as a later field would on an
      // older save.
      const sparse = normalizeLoggedSetPlan({ basis: 'repeat', repsMin: 6, repsMax: 8, loadKg: 60 });
      assert.deepEqual(sparse, {
        loadKg: 60,
        repsMin: 6,
        repsMax: 8,
        targetReps: null,
        basis: 'repeat',
        fromKg: null,
        fromReps: null,
        cautionArea: null,
      });
    },
  },
  {
    name: 'logged set plan: the save path keeps it, and an older save without one stays as it was',
    run() {
      const set = {
        orderIndex: 0,
        weight: 85,
        reps: 5,
        kind: 'working',
        outcome: 'completed',
        status: 'completed',
        completedAt: '2026-09-30T10:00:00.000Z',
      };
      const plan = buildLoggedSetPlan({ ...base, plannedLoadKg: 80, heldForCautionArea: 'knees' });
      const draft = {
        sessionId: 's',
        exerciseTemplateId: null,
        exerciseNameSnapshot: 'Back Squat',
        weight: 85,
        repsPerSet: [5],
        tracked: true,
        orderIndex: 0,
      };

      const kept = normalizeExerciseLogDraft({ ...draft, sets: [{ ...set, planned: plan }] });
      assert.deepEqual(kept.sets[0].planned, plan);
      // The reader's own numbers stay what they logged — 85 over the app's 80.
      assert.equal(kept.sets[0].weight, 85);

      const older = normalizeExerciseLogDraft({ ...draft, sets: [set] });
      assert.equal('planned' in older.sets[0], false);

      const damaged = normalizeExerciseLogDraft({ ...draft, sets: [{ ...set, planned: { basis: 'x' } }] });
      assert.equal('planned' in damaged.sets[0], false);
      assert.equal(damaged.sets[0].weight, 85);
    },
  },
  {
    /**
     * The field the gate set has to survive every hop to the saved log: from
     * the session start, through the reducer, into the draft the app saves.
     * heldForFatigue once died on exactly such a hop.
     */
    name: 'logged set plan: from session start to the saved draft, the app’s number and the reader’s both arrive',
    run() {
      const SLOT = 'primary_squat_1';
      const DAY_MS = 86400000;
      const now = Date.parse('2026-09-24T09:00:00.000Z');
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
      const started = workoutReducer(
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
            // The clock the history is dated against: today is a break from it.
            progression: { automatedProgressionEnabled: true, setupLevel: 'beginner', nowMs: now },
          },
        },
      );

      // The reader logs every set heavier than the app's raised 82.5.
      const session = JSON.parse(JSON.stringify(started.activeSession));
      for (const set of session.exercises[0].sets) {
        set.status = 'completed';
        set.actualLoadKg = 90;
        set.actualReps = 5;
        set.completedAt = '2026-09-24T10:00:00.000Z';
      }

      // Then adds a fourth set, which opens on the 90 just lifted (CI review of #245:
      // saved as the app's suggestion, the log would claim the app said 90).
      const added = JSON.parse(
        JSON.stringify(
          workoutReducer({ ...started, activeSession: session }, { type: 'exercise/addSet', payload: { slotId: session.exercises[0].slotId } })
            .activeSession,
        ),
      );
      const extra = added.exercises[0].sets[added.exercises[0].sets.length - 1];
      extra.status = 'completed';
      extra.actualLoadKg = 90;
      extra.actualReps = 4;
      extra.completedAt = '2026-09-24T10:10:00.000Z';

      const [draft] = buildExerciseLogDraftsFromWorkoutSession(added);
      const savedSets = normalizeExerciseLogDraft(draft).sets;
      const saved = savedSets[0];
      const savedExtra = savedSets[savedSets.length - 1];
      assert.equal(savedExtra.planned.basis, 'added');
      assert.equal(savedExtra.planned.loadKg, 90);
      assert.equal(saved.weight, 90);
      assert.deepEqual(saved.planned, {
        loadKg: 82.5,
        repsMin: 5,
        repsMax: 8,
        targetReps: null,
        basis: 'progressed',
        fromKg: 80,
        fromReps: null,
        cautionArea: null,
      });
    },
  },
];
