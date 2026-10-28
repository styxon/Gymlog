const assert = require('node:assert/strict');

const {
  ACCOUNT_BACKUP_VERSION,
  DEVICE_PRIVACY_PREFERENCE_FIELDS,
  accountBackupFingerprint,
  autoBackupWouldShrinkLog,
  backupWouldShrink,
  buildAccountBackupPayload,
  countBackup,
  countBackupContents,
  countBackupItems,
  countHistoryItems,
  decideAfterLook,
  describeAccountBackup,
  describeRestoreChoice,
  hasLocalDataWorthKeeping,
  hasWorkoutInProgress,
  isCloudCopyThisPhones,
  parseAccountBackupPayload,
  planBackup,
  preferencesForRestore,
  syncCounts,
} = require('../../src/lib/accountBackup');
const { restoreQuestionCopy } = require('../../src/lib/accountBackupCopy');
const { DEVICE_ONLY_PREFERENCE_FIELDS, resolveProEntitlement } = require('../../src/lib/proEntitlement');
const { createEmptyDatabase } = require('../../src/data/seed');

function makeDatabase(overrides = {}) {
  return {
    workoutTemplates: [],
    exerciseTemplates: [],
    workoutPlans: [],
    exerciseLibrary: [{ id: 'lib_1', name: 'Bench Press' }],
    workoutSessions: [],
    cardioSessions: [],
    exerciseLogs: [],
    bodyweightEntries: [],
    measurementEntries: [],
    preferences: { appLanguage: 'fi' },
    ...overrides,
  };
}

const HISTORY = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };

module.exports = [
  {
    // The library is 873 generated entries that every load reseeds; shipping
    // it to the server would make each backup megabytes of data the restore
    // path throws away.
    name: 'accountBackup: the payload strips the exercise library, exactly like the local save',
    run() {
      const payload = buildAccountBackupPayload(makeDatabase(), HISTORY, '2026-08-22T10:00:00.000Z');
      assert.equal('exerciseLibrary' in payload.database, false);
      assert.equal(payload.version, ACCOUNT_BACKUP_VERSION);
      assert.equal(payload.exportedAt, '2026-08-22T10:00:00.000Z');
    },
  },
  {
    name: 'accountBackup: a built payload round-trips through parse',
    run() {
      const payload = buildAccountBackupPayload(makeDatabase(), HISTORY, '2026-08-22T10:00:00.000Z');
      const parsed = parseAccountBackupPayload(JSON.parse(JSON.stringify(payload)));
      assert.ok(parsed);
      assert.equal(parsed.exportedAt, payload.exportedAt);
    },
  },
  {
    // A wrong-shaped download must become "no backup", never a restore of
    // garbage — the local data is the only copy the reader is guaranteed.
    name: 'accountBackup: parse rejects everything that is not a v1 backup',
    run() {
      for (const bad of [
        null,
        undefined,
        'text',
        42,
        {},
        { version: 2, exportedAt: 'x', database: {}, workoutHistory: {} },
        { version: 1, exportedAt: '', database: {}, workoutHistory: {} },
        { version: 1, exportedAt: 'x', database: null, workoutHistory: {} },
        { version: 1, exportedAt: 'x', database: {}, workoutHistory: null },
      ]) {
        assert.equal(parseAccountBackupPayload(bad), null, JSON.stringify(bad));
      }
    },
  },
  {
    name: 'accountBackup: the summary counts what the restore dialog names',
    run() {
      const payload = buildAccountBackupPayload(
        makeDatabase({
          workoutSessions: [{ id: 'a' }, { id: 'b' }],
          cardioSessions: [{ id: 'c' }],
          // Every free workout leaves a template behind; none is a programme.
          workoutTemplates: [{ id: 'tpl' }, { id: 'free_1', origin: 'freestyle' }, { id: 'free_2', origin: 'freestyle' }],
          bodyweightEntries: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
        }),
        HISTORY,
        '2026-08-22T10:00:00.000Z',
      );
      assert.deepEqual(describeAccountBackup(payload), {
        exportedAt: '2026-08-22T10:00:00.000Z',
        workoutCount: 2,
        cardioCount: 1,
        customProgramCount: 1,
        bodyweightCount: 3,
        measurementCount: 0,
        readyProgramCount: 0,
        nameBookCount: 0,
        strengthGoalCount: 0,
        coachGoalCount: 0,
      });
    },
  },
  {
    // The line between "restore silently" and "ask first": a fresh install
    // has nothing to lose, a device with any logged work does.
    name: 'accountBackup: only a device with logged work forces the restore question',
    run() {
      assert.equal(hasLocalDataWorthKeeping(makeDatabase()), false);
      assert.equal(hasLocalDataWorthKeeping(makeDatabase({ workoutSessions: [{ id: 'a' }] })), true);
      assert.equal(hasLocalDataWorthKeeping(makeDatabase({ cardioSessions: [{ id: 'c' }] })), true);
      assert.equal(hasLocalDataWorthKeeping(makeDatabase({ bodyweightEntries: [{ id: 'w', weight: 80 }] })), true);
      assert.equal(hasLocalDataWorthKeeping(makeDatabase({ workoutTemplates: [{ id: 't', createdAt: 'a', updatedAt: 'a' }] })), true);
      // Logged by hand like the rest; a measurements-only phone was overwritten unasked.
      assert.equal(hasLocalDataWorthKeeping(makeDatabase({ measurementEntries: [{ id: 'm' }] })), true);
    },
  },
  {
    // A new phone is set up before anyone signs in. Setup's own programme and
    // weigh-in made every new phone ask, and "Use the data on this phone"
    // replaced a year of history with them (user decision 2026-09-17).
    name: 'accountBackup: a phone holding only what setup wrote counts as empty',
    run() {
      const setupTemplate = { id: 'workout_1', origin: 'authored', createdAt: '2026-09-17T08:00:00.000Z', updatedAt: '2026-09-17T08:00:00.000Z' };
      const setupOnly = (overrides = {}) =>
        makeDatabase({
          preferences: { appLanguage: 'fi', setupCurrentWeightKg: 82 },
          workoutTemplates: [setupTemplate],
          workoutPlans: [{ id: 'onboarding_plan_workout_1', entries: [{}] }],
          bodyweightEntries: [{ id: 'bw', weight: 82 }],
          ...overrides,
        });
      assert.equal(hasLocalDataWorthKeeping(setupOnly()), false, 'setup alone made the phone ask');
      assert.equal(hasLocalDataWorthKeeping(setupOnly({ bodyweightEntries: [] })), false);
      assert.equal(hasLocalDataWorthKeeping(setupOnly({ workoutTemplates: [], workoutPlans: [] })), false);

      // Anything the reader did themselves still asks.
      assert.equal(hasLocalDataWorthKeeping(setupOnly({ workoutSessions: [{ id: 'a' }] })), true, 'a logged workout');
      assert.equal(
        hasLocalDataWorthKeeping(setupOnly({ workoutTemplates: [{ ...setupTemplate, updatedAt: '2026-09-17T09:00:00.000Z' }] })),
        true,
        'an edited setup programme',
      );
      assert.equal(hasLocalDataWorthKeeping(setupOnly({ workoutPlans: [{ id: 'ready_plan_workout_1', entries: [{}] }] })), true, 'a programme setup did not write');
      assert.equal(hasLocalDataWorthKeeping(setupOnly({ bodyweightEntries: [{ id: 'bw', weight: 81.5 }] })), true, 'a weigh-in that is not setup\'s number');
      assert.equal(
        hasLocalDataWorthKeeping(setupOnly({ bodyweightEntries: [{ id: 'bw', weight: 82 }, { id: 'bw2', weight: 82 }] })),
        true,
        'a second weigh-in',
      );
      assert.equal(
        hasLocalDataWorthKeeping(setupOnly({ workoutTemplates: [setupTemplate, { ...setupTemplate, id: 'free', origin: 'freestyle' }] })),
        true,
      );
      // A workout or run in progress: a restore would put it away.
      assert.equal(hasLocalDataWorthKeeping(setupOnly(), true), true, 'a live workout was restored over unasked');
      assert.equal(hasLocalDataWorthKeeping(makeDatabase(), true), true);
      assert.equal(hasLocalDataWorthKeeping(makeDatabase(), false), false);

      // An adopted ready programme is a plan and no template: it is data.
      const onboardingPlan = { id: 'onboarding_plan_workout_1', entries: [{ workoutTemplateId: 'workout_1' }] };
      const readyPlan = { id: 'ready_plan_tpl_gainer_full_body_v1', entries: [{ workoutTemplateId: 'tpl_gainer_full_body_v1' }] };
      const running = { appLanguage: 'fi', setupCurrentWeightKg: 82, activePlanId: onboardingPlan.id, activePlanIds: [onboardingPlan.id] };
      assert.equal(
        hasLocalDataWorthKeeping(setupOnly({ preferences: running, workoutPlans: [onboardingPlan] })),
        false,
        'setup\'s own running plan made the phone ask',
      );
      assert.equal(
        hasLocalDataWorthKeeping(
          setupOnly({
            preferences: { ...running, activePlanId: readyPlan.id, activePlanIds: [onboardingPlan.id, readyPlan.id] },
            workoutPlans: [onboardingPlan, readyPlan],
          }),
        ),
        true,
        'an adopted ready programme was restored over unasked',
      );
      assert.equal(hasLocalDataWorthKeeping(makeDatabase({ workoutPlans: [readyPlan] })), true);
      // A running-set id with no plan behind it is not a programme. This
      // pinned that every fresh install carried the seed's one exactly so; it
      // no longer does (the phantom took a cap slot, 2026-09-21), but an
      // install that stored it before, or a backup of one, still holds it
      // until the next load drops it — and must not read as data meanwhile.
      const fresh = createEmptyDatabase('fi');
      assert.deepEqual(fresh.preferences.activePlanIds, [], 'a fresh install runs a programme it does not have');
      assert.equal(hasLocalDataWorthKeeping(fresh), false, 'every fresh install was asked');
      const phantom = { ...fresh, preferences: { ...fresh.preferences, activePlanIds: ['plan_push_pull_legs'] } };
      assert.equal(hasLocalDataWorthKeeping(phantom), false, 'a phantom running id made the phone ask');
      assert.equal(hasLocalDataWorthKeeping({ ...fresh, preferences: { ...fresh.preferences, activePlanId: readyPlan.id } }), false);

      // And the question counts it as a programme, on either side, once.
      assert.equal(countBackupContents(makeDatabase({ workoutPlans: [readyPlan, { ...readyPlan, id: 'ready_plan_again' }] })).readyProgramCount, 1);
      assert.equal(countBackupContents(setupOnly({ workoutPlans: [onboardingPlan] })).readyProgramCount, 0, 'setup\'s plan counted twice');
      assert.equal(
        countBackupContents(makeDatabase({ workoutTemplates: [{ id: 'mine' }], workoutPlans: [{ id: 'custom_plan_mine', entries: [{ workoutTemplateId: 'mine' }] }] })).readyProgramCount,
        0,
        'a built programme counted again through its plan',
      );
      assert.equal(countBackupContents({ workoutPlans: [null, { id: 'p', entries: null }, { id: 3 }] }).readyProgramCount, 0, 'an old backup with odd plans');
    },
  },
  {
    name: 'accountBackup: the restore question counts both sides, and flags a keep that would shrink the cloud copy',
    run() {
      const cloud = buildAccountBackupPayload(
        makeDatabase({ workoutSessions: new Array(12).fill({}), workoutTemplates: [{ id: 'a' }, { id: 'b' }, { id: 'f', origin: 'freestyle' }] }),
        HISTORY,
        '2026-09-12T10:00:00.000Z',
      );
      const small = makeDatabase({ workoutSessions: [{}], workoutTemplates: [{ id: 'mine' }] });
      const summary = describeRestoreChoice(cloud, small, false, HISTORY);
      assert.equal(summary.cloud.workoutCount, 12);
      assert.equal(summary.cloud.customProgramCount, 2);
      assert.deepEqual(summary.local, {
        workoutCount: 1,
        customProgramCount: 1,
        cardioCount: 0,
        bodyweightCount: 0,
        measurementCount: 0,
        readyProgramCount: 0,
        nameBookCount: 0,
        strengthGoalCount: 0,
        coachGoalCount: 0,
        workoutInProgress: false,
      });
      assert.equal(summary.keepingLocalShrinksCloud, true);
      assert.equal(describeRestoreChoice(cloud, makeDatabase({ workoutSessions: new Array(10).fill({}) }), false, HISTORY).keepingLocalShrinksCloud, false);

      // The words: both sides, in the app's language, with the date the app writes.
      const fi = restoreQuestionCopy(summary, 'fi');
      assert.equal(
        fi.body,
        'Tililläsi on varmuuskopio (12.9.2026): 12 treeniä, 2 ohjelmaa. Tällä puhelimella on 1 treeni, 1 ohjelma. Kumpi pidetään? Toinen korvataan.',
      );
      assert.equal(fi.keepLocal, 'Käytä puhelimen tietoja');
      assert.ok(fi.replace, 'keeping a phone with less is not asked twice');
      assert.equal(
        fi.replace.body,
        'Varmuuskopiossa on 12 treeniä, 2 ohjelmaa. Se korvataan tämän puhelimen tiedoilla (1 treeni, 1 ohjelma), ja kaikki, mikä on vain varmuuskopiossa, menetetään.',
      );
      const en = restoreQuestionCopy(summary, 'en');
      assert.equal(
        en.body,
        'Your account has a backup from 9/12/2026: 12 workouts, 2 programs. This phone has 1 workout, 1 program. Which one do you keep? The other is replaced.',
      );
      assert.match(en.replace.body, /^The backup holds 12 workouts, 2 programs\. It is replaced by the data on this phone \(1 workout, 1 program\)/);
      assert.equal(en.replace.back, 'Back');
      assert.equal(restoreQuestionCopy({ ...summary, keepingLocalShrinksCloud: false }, 'en').replace, null);

      // The second question names everything that goes, not only workouts:
      // a backup of weigh-ins read as "the backup with 0 workouts".
      const weighIns = describeRestoreChoice(
        buildAccountBackupPayload(
          makeDatabase({ bodyweightEntries: new Array(300).fill({}), cardioSessions: [{}], measurementEntries: new Array(4).fill({}) }),
          HISTORY,
          '2026-09-12T10:00:00.000Z',
        ),
        makeDatabase(),
        false,
        HISTORY,
      );
      assert.equal(weighIns.keepingLocalShrinksCloud, true);
      assert.match(restoreQuestionCopy(weighIns, 'fi').replace.body, /^Varmuuskopiossa on 1 cardiotreeni, 300 punnitusta, 4 mittausta\. /);
      assert.match(restoreQuestionCopy(weighIns, 'en').replace.body, /^The backup holds 1 cardio session, 300 weigh-ins, 4 measurements\. /);

      // And this phone is counted the same way, in both questions: a phone of
      // weigh-ins and runs read "0 workouts, 0 programs", and "Restore backup"
      // looked free.
      const runner = describeRestoreChoice(
        cloud,
        makeDatabase({ bodyweightEntries: new Array(200).fill({}), cardioSessions: new Array(30).fill({}) }),
        true,
        HISTORY,
      );
      assert.deepEqual(runner.local, {
        workoutCount: 0,
        customProgramCount: 0,
        cardioCount: 30,
        bodyweightCount: 200,
        measurementCount: 0,
        readyProgramCount: 0,
        nameBookCount: 0,
        strengthGoalCount: 0,
        coachGoalCount: 0,
        workoutInProgress: true,
      });
      assert.equal(runner.keepingLocalShrinksCloud, false);
      assert.equal(
        restoreQuestionCopy(runner, 'fi').body,
        'Tililläsi on varmuuskopio (12.9.2026): 12 treeniä, 2 ohjelmaa. Tällä puhelimella on 30 cardiotreeniä, 200 punnitusta, kesken oleva treeni. Kumpi pidetään? Toinen korvataan.',
      );
      assert.match(restoreQuestionCopy(runner, 'en').body, /This phone has 30 cardio sessions, 200 weigh-ins, a workout in progress\. /);
      const runnerShrinks = restoreQuestionCopy({ ...runner, keepingLocalShrinksCloud: true }, 'en');
      assert.match(runnerShrinks.replace.body, /by the data on this phone \(30 cardio sessions, 200 weigh-ins, a workout in progress\)/);
      // A phone whose only programme is an adopted one says so.
      const adopted = describeRestoreChoice(
        cloud,
        makeDatabase({ workoutPlans: [{ id: 'ready_plan_tpl_x', entries: [{ workoutTemplateId: 'tpl_x' }] }] }),
        false,
        HISTORY,
      );
      assert.match(restoreQuestionCopy(adopted, 'fi').body, /Tällä puhelimella on 1 ohjelma\. /);
      assert.match(restoreQuestionCopy(adopted, 'en').body, /This phone has 1 program\. /);
      // An empty phone still says what it has.
      assert.match(restoreQuestionCopy(describeRestoreChoice(cloud, makeDatabase(), false, HISTORY), 'fi').body, /Tällä puhelimella on 0 treeniä\. /);
    },
  },
  {
    name: 'accountBackup: a restore keeps this phone\'s Pro, meters and privacy answers, and counts the lead programme',
    run() {
      const device = {
        ...createEmptyDatabase('fi').preferences,
        usageStatisticsEnabled: false,
        aiLogId: null,
        aiLogChatConsent: false,
        aiLogComposerConsent: false,
        aiLogPhotoConsent: false,
        coachDemoMomentsUsed: ['day7'],
      };
      const restored = {
        ...createEmptyDatabase('en').preferences,
        profileName: 'Sanna',
        usageStatisticsEnabled: true,
        aiLogId: 'label-from-the-other-phone',
        aiLogChatConsent: true,
        aiLogComposerConsent: true,
        aiLogPhotoConsent: true,
        promoProUntil: '9999-01-01T00:00:00.000Z',
        coachDemoMomentsUsed: [],
        activePlanId: 'onboarding_plan_x',
        activePlanIds: ['ready_plan_y'],
      };
      const plans = [{ id: 'onboarding_plan_x', entries: [{}] }, { id: 'ready_plan_y', entries: [{}] }];
      const kept = preferencesForRestore(restored, device, plans);
      for (const field of [...DEVICE_PRIVACY_PREFERENCE_FIELDS, ...DEVICE_ONLY_PREFERENCE_FIELDS]) {
        assert.deepEqual(kept[field], device[field], `${field} came from the backup`);
      }
      assert.equal(resolveProEntitlement(kept).unlocked, false);
      assert.equal(kept.profileName, 'Sanna');
      assert.equal(kept.appLanguage, 'en');
      // The loader's step, applied to the restore too.
      assert.deepEqual(kept.activePlanIds, ['ready_plan_y', 'onboarding_plan_x']);
      assert.deepEqual(restored.activePlanIds, ['ready_plan_y'], 'the input was mutated');

      // Usage statistics default to yes, so a new phone's yes is nobody's
      // answer: a no on either side wins.
      const fresh = { ...createEmptyDatabase('fi').preferences };
      assert.equal(fresh.usageStatisticsEnabled, true, 'the default this rule is about has changed');
      const saidNo = { ...createEmptyDatabase('fi').preferences, usageStatisticsEnabled: false };
      assert.equal(preferencesForRestore(saidNo, fresh, []).usageStatisticsEnabled, false, 'the old phone\'s no became a yes');
      assert.equal(preferencesForRestore(fresh, saidNo, []).usageStatisticsEnabled, false);
      assert.equal(preferencesForRestore(fresh, { ...fresh }, []).usageStatisticsEnabled, true);
      // The consents default to no, so this phone's answer stays.
      assert.equal(preferencesForRestore({ ...fresh, aiLogChatConsent: true }, fresh, []).aiLogChatConsent, false);
    },
  },
  {
    // The automatic backup watched five counts, so an edit never reached the
    // cloud copy. The fingerprint moves with edits and stays with meters.
    name: 'accountBackup: the backup fingerprint moves with edits, and not with meters or privacy answers',
    run() {
      const base = createEmptyDatabase('fi');
      const db = {
        ...base,
        workoutSessions: [{ id: 's1', workoutTemplateId: 't1', workoutNameSnapshot: 'Push', performedAt: 'x' }],
        workoutTemplates: [{ id: 't1', name: 'Mine', exerciseIds: [], sessions: [], createdAt: 'a', updatedAt: 'a', origin: 'authored' }],
        exerciseNameBook: [],
      };
      const history = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };
      const print = accountBackupFingerprint(db, history);
      assert.equal(accountBackupFingerprint(JSON.parse(JSON.stringify(db)), { ...history }), print, 'the same data printed twice differs');

      const changed = {
        'a corrected workout': { ...db, workoutSessions: [{ ...db.workoutSessions[0], sessionNotes: 'fixed' }] },
        'a renamed workout': { ...db, workoutSessions: [{ ...db.workoutSessions[0], workoutNameSnapshot: 'Pull' }] },
        'a workout feel': { ...db, workoutSessions: [{ ...db.workoutSessions[0], feel: 'hard' }] },
        'an edited programme': { ...db, workoutTemplates: [{ ...db.workoutTemplates[0], updatedAt: 'b' }] },
        'a taught name': { ...db, exerciseNameBook: [{ wrote: 'penkki', name: 'Bench Press', libraryItemId: null }] },
        'a goal': { ...db, preferences: { ...db.preferences, bodyweightGoalKg: 75 } },
        'a setting': { ...db, preferences: { ...db.preferences, hapticsEnabled: !db.preferences.hapticsEnabled } },
        'a weigh-in': { ...db, bodyweightEntries: [{ id: 'b', recordedAt: 'x', weight: 80 }] },
        'an exercise log': { ...db, exerciseLogs: [{ id: 'l' }] },
        'a plan': { ...db, workoutPlans: [{ id: 'p', entries: [] }] },
      };
      for (const [what, next] of Object.entries(changed)) {
        assert.notEqual(accountBackupFingerprint(next, history), print, `${what} did not move the fingerprint`);
      }
      assert.notEqual(
        accountBackupFingerprint(db, { ...history, sessions: [{ sessionId: 'n', performedAt: 'y' }] }),
        print,
        'a finished player session did not move it',
      );

      // Not restored, so not worth a multi-megabyte upload each time.
      const meters = {
        ...db,
        preferences: {
          ...db.preferences,
          aiCoachProQuota: { monthStart: '2026-09-01', used: 9 },
          coachDemoMomentsUsed: ['day7'],
          usageStatisticsEnabled: !db.preferences.usageStatisticsEnabled,
          aiLogChatConsent: !db.preferences.aiLogChatConsent,
        },
      };
      assert.equal(accountBackupFingerprint(meters, history), print);
      // The exercise library is regenerated on load and never uploaded.
      assert.equal(accountBackupFingerprint({ ...db, exerciseLibrary: [] }, history), print);
    },
  },
  {
    name: 'accountBackup: what a backup may do before and after it reads the cloud copy',
    run() {
      // Counts are per store since the workout history got its own guard;
      // this suite is about the database side and keeps the history even.
      const local = (itemCount, historyCount = 10) => ({ itemCount, historyCount });
      const synced = {
        lastBackupAt: '2026-09-10T08:00:00.000Z',
        lastBackupItemCount: 40,
        lastBackupHistoryCount: 10,
        autoBackupPaused: false,
        cloudVersion: '"v1"',
      };
      // Nothing to worry about: straight up.
      assert.equal(planBackup({ interactive: false, sync: synced, local: local(41) }), 'upload');
      assert.equal(planBackup({ interactive: true, sync: synced, local: local(41) }), 'upload');
      // A phone holding far less: the automatic path stays out, "Back up now" looks and asks.
      assert.equal(planBackup({ interactive: false, sync: synced, local: local(3) }), 'skip');
      assert.equal(planBackup({ interactive: true, sync: synced, local: local(3) }), 'look', '"Back up now" skipped the shrink check');
      // Never synced, or the size never learned: look first, either way.
      for (const interactive of [false, true]) {
        assert.equal(planBackup({ interactive, sync: { ...synced, lastBackupAt: null }, local: local(41) }), 'look');
        assert.equal(planBackup({ interactive, sync: { ...synced, lastBackupItemCount: null }, local: local(41) }), 'look');
        assert.equal(planBackup({ interactive, sync: { ...synced, lastBackupHistoryCount: null }, local: local(41) }), 'look');
        // Nor the copy's version: an upload names the copy it replaces, and
        // one this phone has not read cannot be named (server audit, 2026-09-21).
        assert.equal(planBackup({ interactive, sync: { ...synced, cloudVersion: null }, local: local(41) }), 'look');
      }
      // After "Delete cloud backup" only the reader backs up.
      const paused = { lastBackupAt: null, lastBackupItemCount: null, lastBackupHistoryCount: null, autoBackupPaused: true };
      assert.equal(planBackup({ interactive: false, sync: paused, local: local(5) }), 'skip', 'the delete was undone by the next weigh-in');
      assert.equal(planBackup({ interactive: true, sync: paused, local: local(5) }), 'look');

      const backup = (itemCount, historyCount = 10) => ({ kind: 'backup', itemCount, historyCount });
      // Never synced: the reader gets sign-in's question; unattended, only "no backup" uploads.
      assert.equal(decideAfterLook({ interactive: true, neverSynced: true, remote: backup(40), local: local(0) }), 'settle');
      assert.equal(decideAfterLook({ interactive: true, neverSynced: true, remote: { kind: 'unreachable' }, local: local(0) }), 'settle');
      assert.equal(decideAfterLook({ interactive: false, neverSynced: true, remote: { kind: 'none' }, local: local(0) }), 'upload');
      assert.equal(decideAfterLook({ interactive: false, neverSynced: true, remote: backup(1), local: local(9) }), 'fail');
      assert.equal(decideAfterLook({ interactive: false, neverSynced: true, remote: { kind: 'unreachable' }, local: local(9) }), 'fail');
      // Synced.
      assert.equal(decideAfterLook({ interactive: true, neverSynced: false, remote: backup(40), local: local(3) }), 'ask');
      assert.equal(decideAfterLook({ interactive: false, neverSynced: false, remote: backup(40), local: local(3) }), 'hold');
      assert.equal(decideAfterLook({ interactive: true, neverSynced: false, remote: backup(40), local: local(30) }), 'upload');
      // Synced, and no copy now: it was deleted elsewhere (this phone's own delete forgets the backup time). Said
      // and asked about, never re-made as a first backup without a word (bug hunt 5, 2026-10-03).
      assert.equal(decideAfterLook({ interactive: true, neverSynced: false, remote: { kind: 'none' }, local: local(0) }), 'gone');
      assert.equal(decideAfterLook({ interactive: false, neverSynced: false, remote: { kind: 'none' }, local: local(30) }), 'gone');
      assert.equal(decideAfterLook({ interactive: true, neverSynced: false, remote: { kind: 'unreachable' }, local: local(30) }), 'fail');
      // A copy another phone wrote: asked about, and never replaced unattended
      // — not even by a phone holding more than it does.
      assert.equal(decideAfterLook({ interactive: true, neverSynced: false, remote: backup(40), local: local(60), unseen: true }), 'ask');
      assert.equal(decideAfterLook({ interactive: false, neverSynced: false, remote: backup(40), local: local(60), unseen: true }), 'fail');
      assert.equal(decideAfterLook({ interactive: false, neverSynced: false, remote: backup(40), local: local(60), unseen: false }), 'upload');
    },
  },
  {
    name: 'accountBackup: a phone knows its own cloud copy by version, and without one by what it wrote or restored',
    run() {
      const db = makeDatabase({ workoutSessions: [{ id: 'a', workoutNameSnapshot: 'Push', performedAt: '2026-09-01T10:00:00.000Z' }] });
      const history = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };
      // What the server hands back is the upload, through JSON.
      const uploaded = JSON.parse(JSON.stringify(buildAccountBackupPayload(db, history, '2026-09-10T08:00:00.000Z')));
      const sync = { cloudVersion: '"v1"', lastBackupAt: '2026-09-10T08:00:03.000Z', lastBackupFingerprint: accountBackupFingerprint(db, history) };

      assert.equal(isCloudCopyThisPhones(sync, { version: '"v1"', payload: uploaded }), true);
      assert.equal(isCloudCopyThisPhones(sync, { version: '"v2"', payload: uploaded }), false, 'a newer version is another write');

      // An account from before versions. Its upload kept the fingerprint of
      // what it sent, and the copy fingerprints the same after the round trip.
      const legacy = { ...sync, cloudVersion: null };
      assert.equal(isCloudCopyThisPhones(legacy, { version: '"v9"', payload: uploaded }), true);
      // Its restore kept the copy's own export time.
      assert.equal(
        isCloudCopyThisPhones({ cloudVersion: null, lastBackupAt: uploaded.exportedAt, lastBackupFingerprint: null }, { version: null, payload: uploaded }),
        true,
      );
      // Another phone's copy is neither.
      const theirs = JSON.parse(JSON.stringify(buildAccountBackupPayload(makeDatabase(), history, '2026-09-11T08:00:00.000Z')));
      assert.equal(isCloudCopyThisPhones(legacy, { version: '"v9"', payload: theirs }), false, 'a legacy account adopted another phone\'s copy');
      assert.equal(isCloudCopyThisPhones({ cloudVersion: null, lastBackupAt: null, lastBackupFingerprint: null }, { version: null, payload: theirs }), false);
    },
  },
  {
    // A phone whose database was set aside as unreadable opens empty and still
    // signed in; its next automatic backup replaced the one full copy left.
    name: 'accountBackup: the automatic backup will not replace a copy holding more than twice the log',
    run() {
      // Counted over everything the backup watches, not workouts alone: two
      // workouts and a year of weigh-ins is a log worth protecting.
      assert.equal(
        countBackupItems(makeDatabase({ workoutSessions: [{}, {}], bodyweightEntries: new Array(40).fill({}), workoutTemplates: [{}] })),
        43,
      );
      assert.equal(countBackupItems({ workoutSessions: [{}] }), 1, 'an old backup missing arrays counts what it has');
      assert.equal(autoBackupWouldShrinkLog(countBackupItems(makeDatabase({ bodyweightEntries: [{}] })), 43), true);

      // A quarantined phone: nothing, or one workout, against a real history.
      assert.equal(autoBackupWouldShrinkLog(0, 40), true);
      assert.equal(autoBackupWouldShrinkLog(1, 40), true);
      assert.equal(autoBackupWouldShrinkLog(19, 40), true);
      // Half or more is a reader tidying their history, and it backs up.
      assert.equal(autoBackupWouldShrinkLog(20, 40), false);
      assert.equal(autoBackupWouldShrinkLog(41, 40), false);
      // Too small a copy to judge, and an account from before the count was kept.
      assert.equal(autoBackupWouldShrinkLog(0, 2), false);
      assert.equal(autoBackupWouldShrinkLog(0, null), false);
    },
  },
  {
    // The workout store is read, and set aside when unreadable, on its own:
    // the database stays whole and the history opens empty. The shrink guard
    // counted the database only, so the automatic backup uploaded that empty
    // history over the only copy left of every lift's "last time", prefills
    // and progression (persistence audit, 2026-09-20).
    name: 'accountBackup: an emptied workout history does not replace the cloud copy of it',
    run() {
      const history = {
        sessions: new Array(20).fill({}),
        slotHistory: { a: new Array(10).fill({}), b: new Array(4).fill({}) },
        lastSelectedTemplateId: 't',
      };
      // The sessions the player remembers and every remembered set per slot.
      assert.equal(countHistoryItems(history), 34);
      assert.equal(countHistoryItems(HISTORY), 0);
      assert.equal(countHistoryItems({ sessions: 'x', slotHistory: { a: null, b: [{}] } }), 1, 'an odd backup counts what it has');
      assert.equal(countHistoryItems(null), 0);

      // A year of weigh-ins and the history beside it. The database is the
      // same on both sides, so a sum of the two stores still reads as more
      // than half: only a per-store count sees the history go.
      const database = makeDatabase({ workoutSessions: new Array(20).fill({}), bodyweightEntries: new Array(300).fill({}) });
      const cloud = countBackup(database, history);
      const phone = countBackup(database, HISTORY);
      assert.ok(phone.itemCount + phone.historyCount > (cloud.itemCount + cloud.historyCount) / 2, 'the sum would not have caught it');
      assert.equal(backupWouldShrink(phone, cloud), true);
      assert.equal(backupWouldShrink(cloud, cloud), false);
      assert.equal(backupWouldShrink(phone, { itemCount: cloud.itemCount, historyCount: null }), false, 'an unknown size is not a shrink');

      // The automatic backup stays out; "Back up now" looks, and then asks.
      const sync = { lastBackupAt: '2026-09-20T12:00:00.000Z', ...syncCounts(cloud), autoBackupPaused: false };
      assert.deepEqual(syncCounts(cloud), { lastBackupItemCount: 320, lastBackupHistoryCount: 34 });
      assert.equal(planBackup({ interactive: false, sync, local: phone }), 'skip', 'the empty history was uploaded over the full one');
      assert.equal(planBackup({ interactive: true, sync, local: phone }), 'look');
      const remote = { kind: 'backup', ...cloud };
      assert.equal(decideAfterLook({ interactive: false, neverSynced: false, remote, local: phone }), 'hold');
      assert.equal(decideAfterLook({ interactive: true, neverSynced: false, remote, local: phone }), 'ask');

      // And "Use the data on this phone" is asked a second time.
      const payload = buildAccountBackupPayload(database, history, '2026-09-20T12:00:00.000Z');
      assert.equal(describeRestoreChoice(payload, database, false, HISTORY).keepingLocalShrinksCloud, true);
      assert.equal(describeRestoreChoice(payload, database, false, history).keepingLocalShrinksCloud, false);
    },
  },
  {
    // #162 keeps a free workout's board across the process, and a restore
    // replaces the player's store with the backup's history alone. The
    // question counted the guided session and the run: signing in with a
    // free workout open threw it out unasked (persistence audit, 2026-09-20).
    name: 'accountBackup: a free workout on the board is a workout in progress',
    run() {
      const none = { activeSession: null, activeCardio: null, freestyleDraft: null };
      assert.equal(hasWorkoutInProgress(none), false);
      assert.equal(hasWorkoutInProgress({ ...none, activeSession: { sessionId: 's' } }), true);
      assert.equal(hasWorkoutInProgress({ ...none, activeSession: { sessionId: 's', status: 'active' } }), true);
      assert.equal(hasWorkoutInProgress({ ...none, activeSession: { sessionId: 's', status: 'paused' } }), true);
      // A finished session held until its summary clears it is saved, not in progress (bug hunt 2026-10-03): the
      // same answer isWorkoutInProgress gives every other caller.
      assert.equal(hasWorkoutInProgress({ ...none, activeSession: { sessionId: 's', status: 'completed' } }), false);
      const cloudCopy = buildAccountBackupPayload(makeDatabase({ workoutSessions: [{}] }), HISTORY, '2026-09-20T12:00:00.000Z');
      const finished = describeRestoreChoice(cloudCopy, makeDatabase({ workoutSessions: [{}] }), hasWorkoutInProgress({ ...none, activeSession: { sessionId: 's', status: 'completed' } }), HISTORY);
      assert.equal(finished.local.workoutInProgress, false, 'the question does not call a saved workout one in progress');
      assert.doesNotMatch(restoreQuestionCopy(finished, 'en').body, /workout in progress/);
      assert.equal(hasWorkoutInProgress({ ...none, activeCardio: { activityType: 'run' } }), true);
      const draft = { exercises: [{ localKey: 'k', name: 'Bench Press', sets: [{ localKey: 's', kg: '80', reps: '8', done: true }] }] };
      assert.equal(hasWorkoutInProgress({ ...none, freestyleDraft: draft }), true, 'the free workout was not counted');

      // On an otherwise empty phone that is the difference between a
      // question and a restore that runs without one.
      const empty = makeDatabase();
      assert.equal(hasLocalDataWorthKeeping(empty, hasWorkoutInProgress({ ...none, freestyleDraft: draft })), true);
      const cloud = buildAccountBackupPayload(makeDatabase({ workoutSessions: [{}] }), HISTORY, '2026-09-20T12:00:00.000Z');
      const summary = describeRestoreChoice(cloud, empty, hasWorkoutInProgress({ ...none, freestyleDraft: draft }), HISTORY);
      assert.equal(summary.local.workoutInProgress, true);
      assert.match(restoreQuestionCopy(summary, 'en').body, /This phone has a workout in progress\. /);
    },
  },
  {
    // Break round, 2026-09-28 (user decision: ask).
    name: 'account backup: a first backup needs a yes only when another account left its data on the phone',
    run() {
      const { uploadNeedsConsent } = require('../../src/lib/accountBackup');
      assert.equal(uploadNeedsConsent({ signedOutSubs: ['a'], sub: 'b', localWorthKeeping: true }), true);
      assert.equal(uploadNeedsConsent({ signedOutSubs: ['a'], sub: 'a', localWorthKeeping: true }), false, 'the same account came back');
      assert.equal(uploadNeedsConsent({ signedOutSubs: [], sub: 'b', localWorthKeeping: true }), false, 'never signed in before');
      assert.equal(uploadNeedsConsent({ signedOutSubs: ['a'], sub: 'b', localWorthKeeping: false }), false, 'nothing of the other account left');
      // Invariant test, 2026-09-28: A and B both left data; A coming back is
      // not "the same account" while B's workouts are still on the phone.
      assert.equal(uploadNeedsConsent({ signedOutSubs: ['a', 'b'], sub: 'a', localWorthKeeping: true }), true);
    },
  },
  {
    name: 'account backup: the switch question names what is on the phone and where it would go, in both languages',
    run() {
      const { confirmUploadCopy } = require('../../src/lib/accountBackupCopy');
      const local = { workoutCount: 12, customProgramCount: 1, readyProgramCount: 0, cardioCount: 0, bodyweightCount: 0, measurementCount: 0, workoutInProgress: false };
      const fi = confirmUploadCopy({ email: 'toinen@example.com', local }, 'fi');
      assert.match(fi.body, /\(12 treeniä, 1 ohjelma\)/);
      assert.match(fi.body, /Varmuuskopioidaanko ne tilille toinen@example\.com\?$/);
      assert.match(confirmUploadCopy({ email: null, local }, 'fi').body, /Varmuuskopioidaanko ne tälle tilille\?$/);
      const en = confirmUploadCopy({ email: 'other@example.com', local }, 'en');
      assert.match(en.body, /Back it up to other@example\.com\?$/);
      assert.equal(en.skip, 'Not now');
    },
  },
  {
    // A phone holding only what the reader wrote (their lift names, a strength target, a goal told to the coach)
    // is asked about, and the question has to show it: "0 workouts" beside a one-tap "Keep this phone" hid it.
    name: 'account backup: the question counts the lift names, strength goals and coach goals each side holds, in both languages',
    run() {
      const { confirmUploadCopy } = require('../../src/lib/accountBackupCopy');
      const database = makeDatabase({
        exerciseNameBook: [{ alias: 'a' }, { alias: 'b' }],
        preferences: { appLanguage: 'fi', strengthGoals: [{ exerciseName: 'Deadlift', targetKg: 180 }], coachGoals: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }] },
      });
      const counted = countBackupContents(database);
      assert.equal(counted.nameBookCount, 2);
      assert.equal(counted.strengthGoalCount, 1);
      assert.equal(counted.coachGoalCount, 3);
      assert.equal(countBackupContents({}).nameBookCount, 0, 'an old backup without the collection counts none');
      assert.equal(countBackupContents({ preferences: { strengthGoals: 'x', coachGoals: null } }).coachGoalCount, 0);
      const local = { ...counted, workoutInProgress: false };
      const only = { workoutCount: 0, customProgramCount: 0, readyProgramCount: 0, cardioCount: 0, bodyweightCount: 0, measurementCount: 0 };
      const en = confirmUploadCopy({ email: null, local: { ...only, nameBookCount: 2, strengthGoalCount: 1, coachGoalCount: 3, workoutInProgress: false } }, 'en');
      assert.match(en.body, /(2 saved lift names, 1 strength goal, 3 coach goals)/);
      const fi = confirmUploadCopy({ email: null, local: { ...only, nameBookCount: 1, strengthGoalCount: 2, coachGoalCount: 1, workoutInProgress: false } }, 'fi');
      assert.match(fi.body, /(1 tallennettu liikenimi, 2 voimatavoitetta, 1 valmentajan tavoite)/);
      const question = restoreQuestionCopy(
        { cloud: { exportedAt: '2026-09-12T10:00:00.000Z', ...only }, local: { ...local, ...only, nameBookCount: 1 }, keepingLocalShrinksCloud: false, localFromOtherAccount: false },
        'en',
      );
      assert.match(question.body, /1 saved lift name/, 'the phone side shows what it holds');
      assert.doesNotMatch(question.body, /This phone[^.]*0 workouts/);
    },
  },
];
