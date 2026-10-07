const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scheduleDraftSave } = require('../../.test-dist/lib/scheduleDraft.js');

const draft = (overrides) => ({ daysDirty: false, daysValid: true, cycleOn: false, cycleDirty: false, ...overrides });

module.exports = [
  {
    // Re-hunt, 2026-10-07: one weekday picked, then the rhythm tab chosen.
    // Done stayed hidden there, so "3 on, 1 off" could not be saved.
    name: 'schedule draft: an invalid weekday draft does not hold Done back on the rhythm tab',
    run() {
      const save = scheduleDraftSave(draft({ daysDirty: true, daysValid: false, cycleOn: true, cycleDirty: true }));
      assert.deepEqual(save, { canFinish: true, writeCycle: true, writeDays: false });
      // An unchanged rhythm closes the editor too, with nothing written.
      assert.deepEqual(
        scheduleDraftSave(draft({ daysDirty: true, daysValid: false, cycleOn: true })),
        { canFinish: true, writeCycle: false, writeDays: false },
      );
    },
  },
  {
    name: 'schedule draft: on the weekday tab an invalid draft hides Done and writes nothing, the rhythm included',
    run() {
      // Turning the rhythm off with one day left used to write the rhythm
      // before the weekday check refused Done.
      assert.deepEqual(
        scheduleDraftSave(draft({ daysDirty: true, daysValid: false, cycleOn: false, cycleDirty: true })),
        { canFinish: false, writeCycle: false, writeDays: false },
      );
    },
  },
  {
    name: 'schedule draft: valid drafts are written as before',
    run() {
      assert.deepEqual(scheduleDraftSave(draft({ daysDirty: true })), { canFinish: true, writeCycle: false, writeDays: true });
      // The weekday list stays written while a rhythm overrides it.
      assert.deepEqual(
        scheduleDraftSave(draft({ daysDirty: true, cycleOn: true, cycleDirty: true })),
        { canFinish: true, writeCycle: true, writeDays: true },
      );
      assert.deepEqual(scheduleDraftSave(draft({})), { canFinish: true, writeCycle: false, writeDays: false });
      // An untouched weekday list that is out of range (stored before the rule) never blocks.
      assert.equal(scheduleDraftSave(draft({ daysValid: false })).canFinish, true);
    },
  },
  {
    name: 'schedule draft: the training plan screen offers Done and writes by it',
    run() {
      const screen = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'TrainingPlanScreen.tsx'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.match(screen, /const draftSave = scheduleDraftSave\(\{[^}]*cycleOn: draftCycleOn,/);
      assert.match(screen, /actionLabel=\{\s*editingSchedule\s*\?\s*draftSave\.canFinish\s*\?\s*t\(language, 'plan\.done'\)\s*:\s*undefined/);
      const finish = screen.slice(screen.indexOf('const finishEditingSchedule'), screen.indexOf('const stepOnOff'));
      assert.ok(finish.length > 0);
      // Refused before anything is written.
      assert.match(finish, /^const finishEditingSchedule = \(\) => \{\s*if \(!draftSave\.canFinish\) \{\s*return;/);
      assert.match(finish, /if \(draftSave\.writeCycle && onChangeTrainingCycle\) \{/);
      assert.match(finish, /if \(draftSave\.writeDays\) \{\s*onChangeTrainingDays\(draftDays\);\s*\}/);
    },
  },
];
