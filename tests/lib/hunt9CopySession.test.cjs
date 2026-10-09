const assert = require('node:assert/strict');

/**
 * Bug hunt 9 (2026-10-09), the copy / session / today cluster. One suite per
 * finding; the wiring half of each lives in tests/screens/hunt9CopySession.
 */

const DIST = '../../.test-dist';

module.exports = [
  {
    // #13. The first edit of a ready programme copies it under new programme,
    // day and row ids; the day's holds and the pick are keyed by the old ones.
    name: 'hunt 9 #13: a ready programme\'s copy takes today\'s swaps and drops with it, rows renamed and one removed',
    run() {
      const A = require(`${DIST}/lib/sessionAdaptation.js`);
      const { WORKOUT_TEMPLATES_V1 } = require(`${DIST}/features/workout/workoutCatalog.js`);
      const { customSlotId, adaptLegacyWorkoutTemplateToRuntimeTemplate } = require(`${DIST}/features/workout/customWorkoutAdapter.js`);

      const template = WORKOUT_TEMPLATES_V1.find((item) => item.sessions.length >= 3 && item.sessions[1].exercises.length >= 4);
      const day = template.sessions[1];
      const [e0, e1, e2, e3] = day.exercises;
      const other = template.sessions[0];
      const today = new Date(2026, 9, 9).getTime();
      const ref = { programId: template.id, sessionId: day.id };
      const otherRef = { programId: template.id, sessionId: other.id };

      let held = A.updateHeldAdaptation(A.NO_HELD_SESSION_ADAPTATIONS, ref, today, (current) =>
        A.withSessionDrop(A.withSessionSwap(current, e1.slotId, 'Leg Press', e1.exerciseName), e2.slotId),
      );
      held = A.updateHeldAdaptation(held, ref, today, (current) => A.withSessionSwap(current, e0.slotId, 'Dip', e0.exerciseName));
      held = A.updateHeldAdaptation(held, otherRef, today, (current) => A.withSessionDrop(current, other.exercises[0].slotId));

      // The copy: every day in order; on the picked day e0 is removed (the edit),
      // so its swap goes with it; ids are all new.
      const copiedDays = template.sessions.map((session, index) => {
        const rows = session.exercises.filter((exercise) => !(session.id === day.id && exercise.id === e0.id));
        return {
          id: `copy_day_${index}`,
          exercises: rows.map((exercise, position) => ({ id: `copy_ex_${index}_${position}`, fromExerciseId: exercise.id })),
        };
      });
      const { moves, sessionIds } = A.planHeldMovesToCopy({
        programId: template.id,
        copyId: 'workout_copy1',
        days: template.sessions,
        copiedDays,
      });
      const moved = A.moveHeldAdaptations(held, moves);

      const copyRef = { programId: 'workout_copy1', sessionId: 'copy_day_1' };
      const heldForCopy = A.heldAdaptationFor(moved, copyRef, today);
      assert.deepEqual(heldForCopy.swaps, { [customSlotId('copy_ex_1_0')]: 'Leg Press' }, 'the swap on the row that stayed follows it; the removed row\'s is gone');
      assert.deepEqual(heldForCopy.drops, [customSlotId('copy_ex_1_1')]);
      assert.deepEqual(
        A.heldAdaptationFor(moved, { programId: 'workout_copy1', sessionId: 'copy_day_0' }, today).drops,
        [customSlotId('copy_ex_0_0')],
        'another day\'s holds move to that day of the copy',
      );
      assert.deepEqual(A.heldAdaptationFor(moved, ref, today), A.EMPTY_SESSION_ADAPTATION, 'nothing is left filed under the catalogue programme');
      assert.equal(sessionIds[day.id], 'copy_day_1');

      // The slot ids are the ones the copy's runtime template really carries.
      const stored = {
        id: 'workout_copy1',
        name: 'Copy',
        sessions: copiedDays.map((copied, index) => ({
          id: copied.id,
          name: `Day ${index}`,
          orderIndex: index,
          exercises: copied.exercises.map((row, position) => ({
            id: row.id,
            name: 'Back Squat',
            targetSets: 3,
            repMin: 5,
            repMax: 5,
            restSeconds: 90,
            trackedDefault: true,
            orderIndex: position,
          })),
        })),
      };
      const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate({ id: 'workout_copy1', name: 'Copy' }, stored.sessions, [], 90);
      const adapted = A.applySessionAdaptation(
        { ...runtime, sessions: runtime.sessions.filter((session) => session.id === 'copy_day_1') },
        heldForCopy,
      );
      assert.equal(adapted.sessions[0].exercises.length, day.exercises.length - 1 - 1, 'the dropped row is out of today\'s session');
      assert.equal(adapted.sessions[0].exercises[0].exerciseName, 'Leg Press', 'the swapped row starts as the swapped lift');
      void e3;
    },
  },
  {
    name: 'hunt 9 #13: nothing held, nothing moved; a hold made on a day the copy lacks is let go',
    run() {
      const A = require(`${DIST}/lib/sessionAdaptation.js`);
      const today = new Date(2026, 9, 9).getTime();
      const none = A.moveHeldAdaptations(A.NO_HELD_SESSION_ADAPTATIONS, [
        { from: { programId: 'p', sessionId: 'a' }, to: { programId: 'c', sessionId: 'x' }, slots: { s1: 'k1' } },
      ]);
      assert.equal(none, A.NO_HELD_SESSION_ADAPTATIONS);

      const held = A.updateHeldAdaptation(A.NO_HELD_SESSION_ADAPTATIONS, { programId: 'p', sessionId: 'a' }, today, (c) =>
        A.withSessionDrop(c, 's1'),
      );
      const gone = A.moveHeldAdaptations(held, [
        { from: { programId: 'p', sessionId: 'a' }, to: { programId: 'c', sessionId: 'x' }, slots: {} },
      ]);
      assert.deepEqual(gone.bySession, {}, 'the only dropped row is not in the copy, so nothing stays held');
    },
  },
  {
    name: 'hunt 9 #13: today\'s pick follows the programme into its copy and leaves another programme\'s alone',
    run() {
      const { movePickToCopy, resolveTodaySessionPick } = require(`${DIST}/lib/todaySessionPick.js`);
      const today = new Date(2026, 9, 9).getTime();
      const pick = { dayStart: today, sessionId: 'day_b', pickedAt: today + 3600e3, workoutTemplateId: 'catalog_1' };
      const moved = movePickToCopy(pick, 'catalog_1', 'workout_copy1', { day_a: 'copy_a', day_b: 'copy_b' });
      assert.deepEqual(moved, { ...pick, sessionId: 'copy_b', workoutTemplateId: 'workout_copy1' });
      const resolved = resolveTodaySessionPick({
        pick: moved,
        sessions: [{ id: 'copy_a' }, { id: 'copy_b' }],
        todayDayStart: today,
        completed: [],
        toDayStart: () => 0,
        templateIds: new Set(['workout_copy1', 'catalog_1']),
      });
      assert.equal(resolved.id, 'copy_b', 'Home still opens on the picked day');

      assert.equal(movePickToCopy(pick, 'catalog_2', 'workout_copy1', { day_b: 'copy_b' }), pick, 'another programme\'s pick is not this copy\'s');
      assert.equal(movePickToCopy(null, 'catalog_1', 'c', {}), null);
    },
  },
  {
    // #59
    name: 'hunt 9 #59: a session with every lift dropped for today is recognised as empty',
    run() {
      const A = require(`${DIST}/lib/sessionAdaptation.js`);
      const { WORKOUT_TEMPLATES_V1 } = require(`${DIST}/features/workout/workoutCatalog.js`);
      const { buildReadySessionRuntimeTemplate } = require(`${DIST}/lib/programDetails.js`);
      const template = WORKOUT_TEMPLATES_V1[0];
      const sessionId = template.sessions[0].id;
      const runtime = buildReadySessionRuntimeTemplate(template, sessionId);
      const slots = runtime.sessions[0].exercises.map((exercise) => exercise.slotId);
      assert.ok(slots.length >= 2);

      const allDropped = A.applySessionAdaptation(runtime, { swaps: {}, drops: slots });
      assert.equal(A.sessionHasNoExercises(allDropped), true);
      const oneLeft = A.applySessionAdaptation(runtime, { swaps: {}, drops: slots.slice(1) });
      assert.equal(A.sessionHasNoExercises(oneLeft), false);
      assert.equal(A.sessionHasNoExercises(runtime), false);
    },
  },
  {
    // #53
    name: 'hunt 9 #53: finnish hyphenation keeps ie, uo and yö together in the later part of a compound',
    run() {
      const { hyphenateFinnishWord, SOFT_HYPHEN } = require(`${DIST}/lib/finnishHyphenation.js`);
      const shown = (word) => hyphenateFinnishWord(word).split(SOFT_HYPHEN).join('-');
      assert.equal(shown('Kuntopyörä'), 'Kun-to-pyö-rä');
      assert.equal(shown('Rintatyöntö'), 'Rin-ta-työn-tö');
      assert.equal(shown('Sisäkierto'), 'Si-sä-kier-to');
      assert.equal(shown('Polkujuoksu'), 'Pol-ku-juok-su');
      assert.equal(shown('Yksipuolinen'), 'Yk-si-puo-li-nen');
      // Not diphthongs: the plural ending, and a compound whose first part ends in u.
      assert.equal(shown('Polvien'), 'Pol-vi-en');
      assert.equal(shown('Sormien'), 'Sor-mi-en');
      assert.equal(shown('etuolkapään'), 'etu-ol-ka-pään');
      // And the first-syllable case that was already right.
      assert.equal(shown('Ruohonleikkuu'), 'Ruo-hon-leik-kuu');
    },
  },
  {
    // #51
    name: 'hunt 9 #51: the count strings that read "1 sessions" and "1 reps" have singular copy in both languages',
    run() {
      const { t } = require(`${DIST}/lib/i18n.js`);
      const cases = [
        ['history.browse.metaOne', { sessions: 1 }, '1 session', '1 treeni'],
        ['exDetail.bestRepsOne', { count: 1 }, '1 rep', '1 toisto'],
        ['season.weeksLeftOne', { count: 1 }, '1 WEEK LEFT', '1 VIIKKO JÄLJELLÄ'],
        ['hevy.doneOne', { imported: 1 }, '1 workout imported', '1 treeni tuotu'],
        ['hevy.doneWithDuplicatesOne', { duplicates: 3 }, '1 workout imported · 3 already existed', '1 treeni tuotu · 3 oli jo ennestään'],
        ['rest.notify.idleBodyOne', { session: 'Push' }, 'Still training, or done for today? Push · 1 set logged', 'Treenaatko vielä, vai riittikö tältä päivältä? Push · 1 sarja kirjattu'],
        ['rest.notify.sessionBodyOne', { done: 1, time: '18:00' }, '1 of 1 set logged · started 18:00', '1/1 sarjaa kirjattu · alkoi 18:00'],
      ];
      for (const [key, vars, en, fi] of cases) {
        assert.equal(t('en', key, vars), en, `en ${key}`);
        assert.equal(t('fi', key, vars), fi, `fi ${key}`);
      }
    },
  },
  {
    // #54
    name: 'hunt 9 #54: a ready programme\'s level tag says the same word as its level label',
    run() {
      const { getReadyTemplatePresentation } = require(`${DIST}/lib/templatePresentation.js`);
      const { t } = require(`${DIST}/lib/i18n.js`);
      const catalog = require(`${DIST}/features/workout/workoutCatalog.js`);
      const gainer = require(`${DIST}/features/workout/gainerProgramCatalog.js`);
      const templates = [...catalog.WORKOUT_TEMPLATES_V1];
      for (const value of Object.values(gainer)) {
        if (Array.isArray(value) && value[0] && value[0].sessions) {
          templates.push(...value);
        }
      }
      for (const language of ['en', 'fi']) {
        const labels = {
          beginner: t(language, 'catalog.level.beginner'),
          intermediate: t(language, 'catalog.level.intermediate'),
          advanced: t(language, 'catalog.level.advanced'),
        };
        const levelWords = new Set(Object.values(labels));
        let checked = 0;
        for (const template of templates) {
          const level = template.level;
          if (!labels[level]) {
            continue;
          }
          for (const tag of getReadyTemplatePresentation(template, language).tags) {
            if (levelWords.has(tag)) {
              checked += 1;
              assert.equal(tag, labels[level], `${template.id} (${level}) is tagged ${tag}, its level label is ${labels[level]}`);
            }
          }
        }
        assert.ok(checked > 0, 'the guard looked at at least one level tag');
      }
    },
  },
  {
    // #16
    name: 'hunt 9 #16: a free workout finished hours after its last edit ends at that edit, not at the tap',
    run() {
      const E = require(`${DIST}/lib/emptyWorkoutSession.js`);
      const started = Date.parse('2026-10-09T21:00:00+03:00');
      const lastEdit = Date.parse('2026-10-09T22:00:00+03:00');
      const tap = lastEdit + 11 * 3600e3;

      const stale = E.resolveFreestyleFinish({ startedAtMs: started, lastEditMs: lastEdit, nowMs: tap });
      assert.equal(stale.performedAtMs, lastEdit);
      assert.equal(stale.elapsedSeconds, 3600);

      // The saved row: an hour long and dated the evening it was done.
      const { summary } = E.buildFreestyleFinish({
        exercises: [
          {
            localKey: 'k',
            name: 'Squat',
            libraryItemId: null,
            imageUrl: null,
            repMin: 5,
            repMax: 5,
            restSeconds: 90,
            trackedDefault: true,
            sets: [{ localKey: 's', kg: '100', reps: '5', done: true }],
          },
        ],
        workoutName: 'Empty workout',
        startedAtIso: new Date(started).toISOString(),
        performedAtIso: new Date(stale.performedAtMs).toISOString(),
        elapsedSeconds: stale.elapsedSeconds,
        exercisePrLookup: { byLibraryItemId: {}, byName: {} },
      });
      assert.equal(summary.durationMinutes, 60);
      assert.equal(summary.performedAt, new Date(lastEdit).toISOString());

      // Within the two hours the finish is the tap, as before.
      const soon = E.resolveFreestyleFinish({ startedAtMs: started, lastEditMs: lastEdit, nowMs: lastEdit + 30 * 60e3 });
      assert.equal(soon.performedAtMs, lastEdit + 30 * 60e3);
      assert.equal(soon.elapsedSeconds, 5400);
      // No start yet: no duration to invent.
      assert.equal(E.resolveFreestyleFinish({ startedAtMs: null, lastEditMs: lastEdit, nowMs: tap }).elapsedSeconds, 0);
    },
  },
  {
    name: 'hunt 9 #16: the board\'s last edit is the draft\'s while its clock runs on, and now once the clock restarted',
    run() {
      const E = require(`${DIST}/lib/emptyWorkoutSession.js`);
      const started = 1_000_000;
      const saved = started + 3600e3;
      const draft = { startedAtMs: started, savedAtMs: saved };
      const now = saved + 3 * 3600e3;
      assert.equal(E.resolveFreestyleLastEdit(draft, started, now), saved);
      // The clock restarted (a draft older than 12 h): an old edit says nothing about the new session.
      assert.equal(E.resolveFreestyleLastEdit(draft, now, now), now);
      assert.equal(E.resolveFreestyleLastEdit(null, null, now), now);
      assert.equal(E.resolveFreestyleLastEdit({ startedAtMs: null, savedAtMs: saved }, null, now), now);
    },
  },
  {
    // #33
    name: 'hunt 9 #33: the auto-backup fingerprint changes when a finished board is finished again with another set',
    run() {
      require('../helpers/reactNativeStub.cjs').installReactNativeStub();
      const { createEmptyDatabase } = require(`${DIST}/data/seed.js`);
      const { persistCompletedWorkoutSessionToDatabase } = require(`${DIST}/state/completedWorkoutPersistence.js`);
      const { accountBackupFingerprint } = require(`${DIST}/lib/accountBackup.js`);
      const set = (i, weight, reps, at) => ({ orderIndex: i, weight, reps, kind: 'working', outcome: 'completed', status: 'completed', completedAt: at });
      const log = (sets) => ({ exerciseTemplateId: null, exerciseNameSnapshot: 'Bench Press', sets, tracked: true, orderIndex: 0 });
      const input = (logs, extra = {}) => ({
        sessionId: 's1',
        workoutTemplateId: 't1',
        workoutNameSnapshot: 'Push',
        logs,
        startedAt: '2026-10-09T09:00:00.000Z',
        performedAt: '2026-10-09T10:00:00.000Z',
        ...extra,
      });
      const history = { sessions: [{ sessionId: 's1', performedAt: '2026-10-09T10:00:00.000Z' }], slotHistory: {}, lastSelectedTemplateId: null };
      const two = [set(0, 80, 8, '2026-10-09T09:10:00.000Z'), set(1, 80, 8, '2026-10-09T09:15:00.000Z')];

      const first = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase(), input([log(two)]));
      assert.ok(first.didPersist);
      const before = accountBackupFingerprint(first.database, history);

      const three = persistCompletedWorkoutSessionToDatabase(
        first.database,
        input([log([...two, set(2, 100, 5, '2026-10-09T09:20:00.000Z')])], { mergeStored: true, mergeBy: 'place' }),
      );
      assert.ok(three.didPersist);
      assert.equal(three.database.exerciseLogs[0].sets.length, 3, 'the set was added');
      assert.notEqual(accountBackupFingerprint(three.database, history), before, 'the cloud copy lacks that set until the fingerprint moves');

      // A weight corrected on an existing set, same ids and counts, moves it too.
      const corrected = {
        ...first.database,
        exerciseLogs: first.database.exerciseLogs.map((entry) => ({
          ...entry,
          sets: entry.sets.map((item, index) => (index === 0 ? { ...item, weight: 85 } : item)),
        })),
      };
      assert.notEqual(accountBackupFingerprint(corrected, history), before);
      // And an unchanged database is still the same fingerprint (no upload loop).
      assert.equal(accountBackupFingerprint(first.database, history), before);
    },
  },
  {
    // #12
    name: 'hunt 9 #12: "payments are not live" copy is for builds with no billing behind them only',
    run() {
      const { paymentsAreLive } = require(`${DIST}/lib/billingCopy.js`);
      assert.equal(paymentsAreLive(false, true), true, 'a release build with the store key charges');
      assert.equal(paymentsAreLive(false, false), false, 'no key, no store: nothing is charged');
      assert.equal(paymentsAreLive(true, true), false, 'the demo never charges');
      assert.equal(paymentsAreLive(true, false), false);

      const { t } = require(`${DIST}/lib/i18n.js`);
      for (const language of ['en', 'fi']) {
        const live = t(language, 'pro.sheet.fineLive');
        assert.match(live, /6,66/, 'it quotes the one price set');
        assert.doesNotMatch(live, /not live|nothing is charged|ei ole vielä|mitään ei veloiteta/i, language);
        assert.match(t(language, 'pro.sheet.fine'), /6,66/);
      }
    },
  },
];
