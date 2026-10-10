const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { syncPlanEntriesToTemplate } = require('../../.test-dist/lib/planTemplateSync.js');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A plan as adoption writes one: three days on the reader's weekdays. */
function planEntries() {
  return [
    { id: 'p_entry_1', workoutTemplateId: 'tpl', workoutTemplateSessionId: 's1', label: 'mon', orderIndex: 0 },
    { id: 'p_entry_2', workoutTemplateId: 'tpl', workoutTemplateSessionId: 's2', label: 'wed', orderIndex: 1 },
    { id: 'p_entry_3', workoutTemplateId: 'tpl', workoutTemplateSessionId: 's3', label: 'fri', orderIndex: 2 },
  ];
}

const base = { planId: 'p', workoutTemplateId: 'tpl', dayLabels: ['mon', 'wed', 'fri', 'sat'] };

/**
 * The plan's week following the template's days (audit 3, 2026-09-19). The
 * template editor could add and remove days and the plan never heard of it.
 */
module.exports = [
  {
    name: 'plan sync: an unchanged day list is not rewritten',
    run() {
      assert.equal(
        syncPlanEntriesToTemplate({ ...base, entries: planEntries(), sessionIds: ['s1', 's2', 's3'] }),
        null,
      );
    },
  },
  {
    name: 'plan sync: a day removed leaves the others where the reader put them',
    run() {
      const entries = syncPlanEntriesToTemplate({ ...base, entries: planEntries(), sessionIds: ['s1', 's3'] });
      assert.ok(entries, 'a shorter template must change the plan');
      assert.deepEqual(
        entries.map((entry) => [entry.workoutTemplateSessionId, entry.label, entry.orderIndex]),
        [
          ['s1', 'mon', 0],
          ['s3', 'fri', 1],
        ],
      );
      // No entry may point at a session that is gone: Home filtered those out
      // of the list it drew while still counting them, so every day after the
      // gap wore the previous day's weekday.
      assert.equal(entries.some((entry) => entry.workoutTemplateSessionId === 's2'), false);
    },
  },
  {
    name: 'plan sync: a day added takes a training day nothing else sits on',
    run() {
      const entries = syncPlanEntriesToTemplate({
        ...base,
        entries: planEntries(),
        sessionIds: ['s1', 's2', 's3', 's4'],
      });
      assert.ok(entries);
      assert.equal(entries.length, 4);
      assert.deepEqual(
        entries.map((entry) => [entry.workoutTemplateSessionId, entry.label]),
        [
          ['s1', 'mon'],
          ['s2', 'wed'],
          ['s3', 'fri'],
          ['s4', 'sat'],
        ],
      );
      // The three that survived keep their own ids, so nothing downstream that
      // remembers an entry by id loses it.
      assert.deepEqual(entries.slice(0, 3).map((entry) => entry.id), ['p_entry_1', 'p_entry_2', 'p_entry_3']);
    },
  },
  {
    name: 'plan sync: more days than training days repeats rather than dropping one',
    run() {
      const entries = syncPlanEntriesToTemplate({
        ...base,
        dayLabels: ['mon', 'wed', 'fri'],
        entries: planEntries(),
        sessionIds: ['s1', 's2', 's3', 's4', 's5'],
      });
      assert.ok(entries);
      assert.equal(entries.length, 5, 'every session gets an entry');
      assert.equal(entries.every((entry) => Boolean(entry.label)), true, 'and every entry a day');
      assert.deepEqual(entries.map((entry) => entry.orderIndex), [0, 1, 2, 3, 4]);
    },
  },
  {
    name: 'plan sync: a new day never takes an id a surviving day already has',
    run() {
      // Day 1 removed and a fourth added: the new day lands at index 2, whose
      // adoption name `p_entry_3` the surviving third day already carries.
      const entries = syncPlanEntriesToTemplate({ ...base, entries: planEntries(), sessionIds: ['s2', 's3', 's4'] });
      assert.ok(entries);
      const ids = entries.map((entry) => entry.id);
      assert.equal(new Set(ids).size, ids.length, `two entries share an id: ${ids.join(', ')}`);
      // The survivors keep theirs, so nothing that remembers an entry by id
      // loses it.
      assert.deepEqual(ids.slice(0, 2), ['p_entry_2', 'p_entry_3']);
    },
  },
  {
    name: 'plan sync: a plan rebuilt from nothing reads like one adoption wrote',
    run() {
      const entries = syncPlanEntriesToTemplate({ ...base, entries: [], sessionIds: ['s1', 's2'] });
      assert.ok(entries);
      // `buildProgramWorkoutPlan` names its entries the same way.
      assert.deepEqual(entries.map((entry) => entry.id), ['p_entry_1', 'p_entry_2']);
      assert.deepEqual(entries.map((entry) => entry.label), ['mon', 'wed']);
    },
  },
  {
    name: 'plan sync: the template editor calls it, and says so when the save is refused',
    run() {
      const tab = strip(read('src', 'app', 'renderWorkoutTab.tsx'));
      const save = tab.slice(tab.indexOf('onSave={async (draft) => {'), tab.indexOf('/>', tab.indexOf('onSave={async (draft) => {')));
      assert.ok(save.length > 0, 'the template editor has no save handler');
      // The plan follows the days, after the template write has landed.
      assert.ok(
        save.indexOf('await upsertWorkoutTemplate(draft)') < save.indexOf('await syncPlanToTemplate(workoutTemplateId)'),
        'the plan must be synced after the template is written',
      );
      // And a refused write is answered rather than swallowed: this was the
      // one caller of upsertWorkoutTemplate with no catch at all.
      assert.match(save, /catch \(error\) \{/);
      assert.match(save, /if \(error instanceof ProgramLimitReachedError\) \{\s*setProgramLimitVisible\(true\);\s*return false;/);
      assert.match(save, /showToast\(t\(preferences\.appLanguage, 'toast\.planSaveFailed'\)\);/);
      // The success state still follows the write, never precedes it.
      assert.ok(save.indexOf('haptics.success()') > save.indexOf('await syncPlanToTemplate'));
      // And the plan write has an answer of its own. It rethrows on a refusal
      // like every other write, and an unhandled rejection here would have
      // skipped the haptic AND the navigation: the button would look dead
      // while the programme was saved and its week left out of step.
      assert.match(save, /try \{\s*await syncPlanToTemplate\(workoutTemplateId\);\s*\} catch \(error\) \{/);
      // "Could not save" would be false by then — the template is written.
      assert.match(save, /showToast\(t\(preferences\.appLanguage, 'toast\.planWeekOutOfStep'\)\);/);
      assert.ok(
        save.indexOf('replaceRoute({') > save.indexOf('toast.planWeekOutOfStep'),
        'the programme page opens either way: the programme really is saved',
      );

      // syncPlanToTemplate leaves VinhaApp for src/app in the phase-B split
      // (2026-09-30): read the whole shell, App.tsx first. Its signature is
      // asserted first, so the absence below is checked over code that holds it.
      const app = strip(readAppWiring().replace(/\r\n/g, '\n'));
      assert.match(app, /async function syncPlanToTemplate\(workoutTemplateId: string\) \{/);
      // Read back from the repository, like the reorder beside it.
      assert.match(app, /const saved = await getWorkoutTemplateSessionsFresh\(workoutTemplateId\);\s*const entries = syncPlanEntriesToTemplate\(\{/);
      assert.match(app, /dayLabels: planLabelsForProgramme\(saved\.length, preferences\.setupAvailableDays, new Date\(\)\)/);
      // The block boundary is left alone. On a plan `updatedAt` is not a
      // modification stamp — Home counts the week from it — so stamping it
      // would reset a reader mid-block to week 1 for adding a day.
      assert.match(app, /await upsertWorkoutPlan\(\{ \.\.\.plan, entries, updatedAt: plan\.updatedAt \}\);/);
      assert.doesNotMatch(app, /upsertWorkoutPlan\(\{ \.\.\.plan, entries, updatedAt: new Date\(\)/);
    },
  },
];
