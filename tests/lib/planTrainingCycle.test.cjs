const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  keepPlanTrainingCycle,
  leadPlanTrainingCycle,
  moveTrainingCycleToLeadPlan,
  planForTemplate,
  planTrainingCycle,
  withPlanTrainingCycle,
} = require('../../.test-dist/lib/planTrainingCycle.js');
const { workoutPlanRepository } = require('../../.test-dist/storage/repositories.js');
const { createEmptyDatabase } = require('../../.test-dist/data/seed.js');

/**
 * A rhythm belongs to its programme (user 2026-10-07).
 *
 * One app-wide `preferences.trainingCycle` made a six-day ready programme show
 * the reader's own "3 on, 1 off", and setting a rhythm on any programme set it
 * on every one. It lives on the plan now; the old value moves to the lead
 * programme only, once, and a programme never started shows its own week.
 */

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const MINE = { pattern: [true, true, true, false], anchorDayStart: new Date(2026, 9, 1).getTime() };
const OTHER = { pattern: [true, false], anchorDayStart: new Date(2026, 8, 1).getTime() };

function plan(id, templateId, extra = {}) {
  return {
    id,
    name: id,
    mode: 'rotation',
    entries: [{ id: `${id}_e1`, workoutTemplateId: templateId, workoutTemplateSessionId: 's1', label: 'Mon', orderIndex: 0 }],
    isActive: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}

function database({ plans, activePlanId, activePlanIds = activePlanId ? [activePlanId] : [], trainingCycle = null }) {
  const empty = createEmptyDatabase('fi');
  return {
    ...empty,
    workoutPlans: plans,
    preferences: { ...empty.preferences, activePlanId, activePlanIds, trainingCycle },
  };
}

module.exports = [
  {
    name: 'plan rhythm: the old app-wide rhythm moves to the lead programme only, once',
    run() {
      const before = database({
        plans: [plan('custom_plan_mine', 'wt_mine'), plan('ready_plan_tpl_6', 'tpl_6')],
        activePlanId: 'custom_plan_mine',
        activePlanIds: ['custom_plan_mine', 'ready_plan_tpl_6'],
        trainingCycle: MINE,
      });
      const after = moveTrainingCycleToLeadPlan(before);

      assert.deepEqual(after.workoutPlans.find((item) => item.id === 'custom_plan_mine').trainingCycle, MINE);
      // The six-day programme running beside it goes back to its own week.
      assert.equal(planTrainingCycle(after.workoutPlans.find((item) => item.id === 'ready_plan_tpl_6')), null);
      assert.equal(after.preferences.trainingCycle, null, 'emptied, so the move never runs twice');
      // Nothing else in the preferences moved.
      assert.equal(after.preferences.activePlanId, 'custom_plan_mine');
      assert.deepEqual(after.preferences.activePlanIds, ['custom_plan_mine', 'ready_plan_tpl_6']);

      // Run again, it is a no-op returning the same object.
      assert.equal(moveTrainingCycleToLeadPlan(after), after);
    },
  },
  {
    name: 'plan rhythm: a lead with its own rhythm keeps it, and with no lead the old one is dropped',
    run() {
      const own = database({
        plans: [plan('custom_plan_mine', 'wt_mine', { trainingCycle: OTHER })],
        activePlanId: 'custom_plan_mine',
        trainingCycle: MINE,
      });
      const kept = moveTrainingCycleToLeadPlan(own);
      assert.deepEqual(kept.workoutPlans[0].trainingCycle, OTHER, 'the programme’s own rhythm is the newer truth');
      assert.equal(kept.preferences.trainingCycle, null);

      const nowhere = database({ plans: [plan('ready_plan_tpl_6', 'tpl_6')], activePlanId: null, trainingCycle: MINE });
      const dropped = moveTrainingCycleToLeadPlan(nowhere);
      assert.equal(planTrainingCycle(dropped.workoutPlans[0]), null, 'a programme not leading never takes it');
      assert.equal(dropped.preferences.trainingCycle, null);

      const none = database({ plans: [plan('custom_plan_mine', 'wt_mine')], activePlanId: 'custom_plan_mine' });
      assert.equal(moveTrainingCycleToLeadPlan(none), none);
    },
  },
  {
    name: 'plan rhythm: the reader’s calendar reads the lead; a programme page reads its own plan',
    run() {
      const plans = [
        plan('custom_plan_mine', 'wt_mine', { trainingCycle: MINE }),
        plan('ready_plan_tpl_6', 'tpl_6'),
        plan('ready_plan_tpl_6_old', 'tpl_6', { trainingCycle: OTHER }),
      ];
      assert.deepEqual(leadPlanTrainingCycle(plans, 'custom_plan_mine'), MINE);
      assert.equal(leadPlanTrainingCycle(plans, 'ready_plan_tpl_6'), null, 'the six-day programme leads on its own week');
      assert.equal(leadPlanTrainingCycle(plans, null), null);
      assert.equal(leadPlanTrainingCycle(plans, 'gone'), null);

      const running = { plans, activePlanId: 'custom_plan_mine', activePlanIds: ['custom_plan_mine', 'ready_plan_tpl_6'] };
      // The running plan wins over a stopped one holding the same programme.
      assert.equal(planForTemplate(running, 'tpl_6').id, 'ready_plan_tpl_6');
      assert.equal(planForTemplate({ ...running, activePlanId: 'ready_plan_tpl_6_old' }, 'tpl_6').id, 'ready_plan_tpl_6_old');
      assert.equal(planForTemplate({ ...running, activePlanIds: [] , activePlanId: null }, 'tpl_6').id, 'ready_plan_tpl_6');
      // Never started: no plan, so no rhythm to show or to set.
      assert.equal(planForTemplate(running, 'tpl_never'), null);
    },
  },
  {
    name: 'plan rhythm: setting one programme’s rhythm moves no other',
    run() {
      const plans = [plan('custom_plan_mine', 'wt_mine', { trainingCycle: MINE }), plan('ready_plan_tpl_6', 'tpl_6')];
      const next = withPlanTrainingCycle(plans, 'ready_plan_tpl_6', OTHER);
      assert.deepEqual(next[1].trainingCycle, OTHER);
      assert.equal(next[0], plans[0], 'the other programme is the same object');
      const cleared = withPlanTrainingCycle(next, 'ready_plan_tpl_6', null);
      assert.equal(cleared[1].trainingCycle, null);
      assert.deepEqual(cleared[0].trainingCycle, MINE);
    },
  },
  {
    name: 'plan rhythm: a plan rebuilt under its own id keeps its rhythm, whatever the record says',
    run() {
      const stored = plan('custom_plan_mine', 'wt_mine', { trainingCycle: MINE });
      const db = database({ plans: [stored], activePlanId: 'custom_plan_mine' });

      // New days, a new week: built from parts, naming no rhythm.
      const { trainingCycle, ...rebuilt } = { ...stored, entries: [...stored.entries, { ...stored.entries[0], id: 'e2', orderIndex: 1 }] };
      assert.equal(trainingCycle, MINE);
      const kept = workoutPlanRepository.upsert(db, rebuilt);
      assert.deepEqual(kept.workoutPlans[0].trainingCycle, MINE);
      assert.equal(kept.workoutPlans[0].entries.length, 2);

      // Naming one does not set it either: a rebuilt record names the rhythm
      // it was read with, and the rhythm moves only through its own write.
      const named = workoutPlanRepository.upsert(db, { ...rebuilt, trainingCycle: null });
      assert.deepEqual(named.workoutPlans[0].trainingCycle, MINE);
      const other = workoutPlanRepository.upsert(db, { ...rebuilt, trainingCycle: OTHER });
      assert.deepEqual(other.workoutPlans[0].trainingCycle, MINE);

      // A new plan has nothing to inherit.
      const added = workoutPlanRepository.upsert(db, plan('ready_plan_tpl_6', 'tpl_6'));
      assert.equal(planTrainingCycle(added.workoutPlans.find((item) => item.id === 'ready_plan_tpl_6')), null);
      assert.equal(keepPlanTrainingCycle(rebuilt, null), rebuilt);
    },
  },
  {
    // Profile -> Training plan -> Edit: the reader switches a 3-on-1-off
    // rhythm to weekdays and picks the days, and Done makes two writes in one
    // tick. The rhythm lands first; the days are then written over a copy of
    // the plan read at render, which still held the old rhythm, and put it
    // back (bug hunt 2026-10-07).
    name: 'plan rhythm: a plan read before a rhythm edit cannot undo it when written back',
    run() {
      // As the loader hands plans out: the field is always there, null when none.
      const rendered = database({
        plans: [plan('custom_plan_mine', 'wt_mine', { trainingCycle: MINE })],
        activePlanId: 'custom_plan_mine',
      });
      const stale = rendered.workoutPlans[0];
      const relabel = (from) => ({ ...from, entries: from.entries.map((entry) => ({ ...entry, label: 'Wed' })) });

      // Turned off, then the weekdays written from the render's copy.
      const off = { ...rendered, workoutPlans: withPlanTrainingCycle(rendered.workoutPlans, 'custom_plan_mine', null) };
      const afterDays = workoutPlanRepository.upsert(off, relabel(stale));
      assert.equal(afterDays.workoutPlans[0].trainingCycle, null, 'the rhythm the reader just turned off stays off');
      assert.equal(afterDays.workoutPlans[0].entries[0].label, 'Wed', 'and the days they picked are written');

      // The other way round: a rhythm turned on survives the copy that says none.
      const plain = database({
        plans: [plan('custom_plan_mine', 'wt_mine', { trainingCycle: null })],
        activePlanId: 'custom_plan_mine',
      });
      const staleNone = plain.workoutPlans[0];
      const on = { ...plain, workoutPlans: withPlanTrainingCycle(plain.workoutPlans, 'custom_plan_mine', OTHER) };
      assert.deepEqual(workoutPlanRepository.upsert(on, relabel(staleNone)).workoutPlans[0].trainingCycle, OTHER);

      // A restart writes the same copy with a new boundary, and keeps it too.
      const restarted = workoutPlanRepository.upsert(off, { ...stale, updatedAt: '2026-10-07T00:00:00.000Z' });
      assert.equal(restarted.workoutPlans[0].trainingCycle, null);
      assert.equal(restarted.workoutPlans[0].updatedAt, '2026-10-07T00:00:00.000Z');
    },
  },
  {
    // A rerun of the questionnaire builds a new programme on the id of the one
    // it replaces, and the rhythm it chose, or none, is part of it.
    name: 'plan rhythm: a plan replaced whole takes the rhythm it was built with',
    run() {
      const db = database({
        plans: [plan('onboarding_plan_wt', 'wt', { trainingCycle: MINE })],
        activePlanId: 'onboarding_plan_wt',
      });
      const rebuilt = plan('onboarding_plan_wt', 'wt', { trainingCycle: OTHER });
      assert.deepEqual(workoutPlanRepository.replace(db, rebuilt).workoutPlans[0].trainingCycle, OTHER);
      assert.equal(
        workoutPlanRepository.replace(db, { ...rebuilt, trainingCycle: null }).workoutPlans[0].trainingCycle,
        null,
      );
      // New, it is added, and nothing else moves.
      const added = workoutPlanRepository.replace(db, plan('onboarding_plan_wt2', 'wt2', { trainingCycle: OTHER }));
      assert.equal(added.workoutPlans.length, 2);
      assert.deepEqual(added.workoutPlans.find((item) => item.id === 'onboarding_plan_wt').trainingCycle, MINE);

      // The onboarding finish writes its plan this way, inside its one lock.
      const provider = strip(read('src/state/AppProvider.tsx'));
      const finish = provider.slice(
        provider.indexOf('function saveOnboardingResult('),
        provider.indexOf('function upsertWorkoutPlan('),
      );
      assert.ok(finish.length > 0, 'saveOnboardingResult is where it was');
      assert.match(finish, /const withPlan = workoutPlanRepository\.replace\(/);
      assert.doesNotMatch(finish, /workoutPlanRepository\.upsert\(/);
    },
  },
  {
    name: 'plan rhythm: the loader reads a stored rhythm and nothing that is not one',
    run() {
      // Through the fake storage: the module reaches for AsyncStorage when it loads.
      const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
      const { normalizeDatabase } = loadAgainstFake(createFakeAsyncStorage(), (requireDist) =>
        requireDist('storage/database.js'),
      );
      const out = normalizeDatabase({
        workoutPlans: [
          plan('p_ok', 'wt', { trainingCycle: MINE }),
          plan('p_missing', 'wt'),
          plan('p_junk', 'wt', { trainingCycle: 'every day' }),
          plan('p_rest_only', 'wt', { trainingCycle: { pattern: [false, false], anchorDayStart: MINE.anchorDayStart } }),
          plan('p_no_anchor', 'wt', { trainingCycle: { pattern: [true] } }),
        ],
      });
      const byId = Object.fromEntries(out.workoutPlans.map((item) => [item.id, item.trainingCycle]));
      assert.deepEqual(byId.p_ok, MINE);
      assert.equal(byId.p_missing, null);
      assert.equal(byId.p_junk, null);
      assert.equal(byId.p_rest_only, null, 'a pattern with no training day is not a rhythm');
      assert.equal(byId.p_no_anchor, null);
    },
  },
  {
    // Run, against the in-memory storage: the old rhythm can sit in the
    // preferences key while the plans sit in the blob.
    name: 'plan rhythm: an old install loads with its rhythm on the lead, written to both keys at once',
    async run() {
      const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
      const fake = createFakeAsyncStorage();
      const storage = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const old = database({
        plans: [plan('custom_plan_mine', 'wt_mine'), plan('ready_plan_tpl_6', 'tpl_6')],
        activePlanId: 'custom_plan_mine',
        activePlanIds: ['custom_plan_mine', 'ready_plan_tpl_6'],
        trainingCycle: MINE,
      });
      // As an install from before 2026-10-07 wrote them: no rhythm on any plan.
      await storage.saveDatabase(old, { withPreferences: true });

      // A refused write makes no move: nothing is lost, and the next launch tries again.
      fake.faults.multiSet = 1;
      const refused = await storage.loadDatabase();
      assert.equal(planTrainingCycle(refused.workoutPlans[0]), null);
      assert.deepEqual(refused.preferences.trainingCycle, MINE, 'kept where it was until it can be written');

      const loaded = await storage.loadDatabase();
      const mine = loaded.workoutPlans.find((item) => item.id === 'custom_plan_mine');
      const six = loaded.workoutPlans.find((item) => item.id === 'ready_plan_tpl_6');
      assert.deepEqual(mine.trainingCycle, MINE);
      assert.equal(six.trainingCycle, null);
      assert.equal(loaded.preferences.trainingCycle, null);

      // Both keys hold the move, so a preferences-only write after it cannot
      // strand the rhythm.
      assert.equal(JSON.parse(fake.rows.get('@vinha/preferences/v1')).trainingCycle, null);
      const again = await storage.loadDatabase();
      assert.deepEqual(again.workoutPlans.find((item) => item.id === 'custom_plan_mine').trainingCycle, MINE);
      assert.equal(again.preferences.trainingCycle, null);
    },
  },
  {
    name: 'plan rhythm: nothing reads or writes the old app-wide rhythm any more',
    run() {
      const files = ['App.tsx'];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
          const relative = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(relative);
          } else if (/\.tsx?$/.test(entry.name)) {
            files.push(relative);
          }
        }
      };
      walk('src');
      // The loader normalizes the stored value and the move empties it; the
      // seed and the provider's blank write the null default.
      const allowed = new Set(
        ['src/storage/database.ts', 'src/lib/planTrainingCycle.ts'].map((file) => path.normalize(file)),
      );
      const offenders = [];
      for (const file of files) {
        if (allowed.has(path.normalize(file))) {
          continue;
        }
        const code = strip(read(file));
        if (/preferences\??\.trainingCycle\b|updatePreferences\(\{\s*trainingCycle|\btrainingCycle: preferences\b/.test(code)) {
          offenders.push(file);
        }
      }
      assert.deepEqual(offenders, [], 'these still read or write preferences.trainingCycle');
    },
  },
  {
    name: 'plan rhythm: every reader is wired to the right plan',
    run() {
      // The programme page: its own plan, read and written.
      const workoutTab = strip(read('src/app/renderWorkoutTab.tsx'));
      assert.match(workoutTab, /const rhythmPlan = planForTemplate\(\s*\{ plans: database\.workoutPlans, activePlanId: preferences\.activePlanId, activePlanIds: preferences\.activePlanIds \},\s*route\.workoutTemplateId,\s*\);/);
      assert.match(workoutTab, /trainingCycle=\{planTrainingCycle\(rhythmPlan\)\}/);
      // Its weekdays from the same plan, and saved to the same plan.
      assert.match(workoutTab, /const detailPlanEntries = livePlanEntries\(rhythmPlan\?\.entries \?\? \[\], templateSessionsReader\(database\)\);/);
      assert.match(workoutTab, /onSaveRhythm=\{\s*rhythmPlan\s*\?/);
      assert.match(
        strip(read('src/app/programmePlanEdits.tsx')),
        /async function handleSaveRhythm[\s\S]{0,200}const plan = planForTemplate\(\s*\{ plans: database\.workoutPlans, activePlanId: preferences\.activePlanId, activePlanIds: preferences\.activePlanIds \},\s*workoutTemplateId,\s*\);/,
      );
      assert.match(workoutTab, /onChangeTrainingCycle=\{\s*rhythmPlan\s*\?\s*\(cycle\) =>\s*void setPlanTrainingCycle\(rhythmPlan\.id, cycle\)/);

      // The reader's own calendar: the lead.
      assert.match(
        strip(read('src/app/useHomeTrainingSchedule.ts')),
        /const leadCycle = leadPlanTrainingCycle\(database\.workoutPlans, preferences\.activePlanId\);/,
      );
      const profile = strip(read('src/app/renderProfileTab.tsx'));
      assert.match(profile, /trainingCycle=\{planTrainingCycle\(leadPlan\)\}/);
      assert.match(profile, /void setPlanTrainingCycle\(leadPlan\.id, cycle\)/);
      assert.match(strip(read('src/hooks/useScheduledNotifications.ts')), /trainingCycle: planTrainingCycle\(activePlan\),/);

      // Onboarding puts the chosen rhythm on the plan it builds, anchored
      // against the lead's.
      const finishes = strip(read('src/app/onboardingFinishes.tsx'));
      assert.equal(
        (finishes.match(/preferences\.appLanguage,\s*leadPlanTrainingCycle\(database\.workoutPlans, preferences\.activePlanId\),\s*\)/g) ?? []).length,
        2,
        'both questionnaire finishes hand the lead rhythm to the plan builder',
      );

      // The move runs on load and on a restore.
      const loader = strip(read('src/storage/database.ts'));
      assert.match(loader, /return await withTrainingCycleMoved\(reconciled\);/);
      assert.match(loader, /await saveDatabase\(moved, \{ withPreferences: true \}\);/);
      assert.match(strip(read('src/state/AppProvider.tsx')), /const next: AppDatabase = moveTrainingCycleToLeadPlan\(\{/);

      // A copy of a held ready programme keeps the rhythm of the plan it replaces.
      assert.match(
        strip(read('src/app/useProgramExerciseEdit.tsx')),
        /await upsertWorkoutPlan\(\{ \.\.\.plan, trainingCycle: planTrainingCycle\(replacedPlan\) \}\);/,
      );
    },
  },
];
