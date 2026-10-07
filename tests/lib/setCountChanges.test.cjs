const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { setCountChanges, setCountToastParts, SET_COUNT_TOAST_NAMED } = require('../../.test-dist/lib/setCountChanges.js');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * #to-do 2026-09-29: the emphasis sheet's sliders changed set counts on rows
 * the sheet does not show. A reader found the hip thrust at 5 × 8, remembered
 * 4 × 8, and could not tell whether the app had added a set by itself. The
 * save now names the rows it moved, after the write has landed.
 */

const ROOT = path.join(__dirname, '..', '..');
const days = [
  {
    exercises: [
      { id: 'a1', name: 'Hip Thrust', targetSets: 4 },
      { id: 'a2', name: 'Back Squat', targetSets: 3 },
      { id: 'a3', name: 'Plank', targetSets: 3 },
    ],
  },
  {
    exercises: [
      { id: 'b1', name: 'Hip Thrust', targetSets: 4 },
      { id: 'b2', name: 'Romanian Deadlift', targetSets: 3 },
    ],
  },
];

module.exports = [
  {
    name: 'set count changes: the rows a save moves, in programme order; an unchanged count is not a change',
    run() {
      const changes = setCountChanges(
        days,
        new Map([
          ['a1', 5],
          ['a2', 3],
          ['b2', 2],
        ]),
      );
      assert.deepEqual(changes, [
        { name: 'Hip Thrust', from: 4, to: 5 },
        { name: 'Romanian Deadlift', from: 3, to: 2 },
      ]);
      assert.deepEqual(setCountChanges(days, new Map()), []);
      assert.deepEqual(setCountChanges(days, new Map([['a3', 3]])), [], 'a slider that lands where it started says nothing');
    },
  },
  {
    name: 'set count changes: a lift on two days moved the same way is named once; moved differently, twice',
    run() {
      assert.deepEqual(
        setCountChanges(days, new Map([['a1', 5], ['b1', 5]])),
        [{ name: 'Hip Thrust', from: 4, to: 5 }],
      );
      assert.deepEqual(setCountChanges(days, new Map([['a1', 5], ['b1', 3]])), [
        { name: 'Hip Thrust', from: 4, to: 5 },
        { name: 'Hip Thrust', from: 4, to: 3 },
      ]);
    },
  },
  {
    name: 'set count changes: a toast names three and counts the rest',
    run() {
      assert.equal(SET_COUNT_TOAST_NAMED, 3);
      const five = [1, 2, 3, 4, 5].map((index) => ({ name: `Lift ${index}`, from: 3, to: 4 }));
      const parts = setCountToastParts(five);
      assert.equal(parts.named.length, 3);
      assert.equal(parts.more, 2);
      assert.equal(setCountToastParts(five.slice(0, 2)).more, 0);
    },
  },
  {
    name: 'set count changes: the toast reads as a fact in both languages',
    run() {
      assert.equal(t('fi', 'toast.setCountChanged', { name: 'Lantionnosto', from: 4, to: 5 }), 'Lantionnosto 4 → 5 sarjaa');
      assert.equal(t('en', 'toast.setCountChanged', { name: 'Hip thrust', from: 4, to: 5 }), 'Hip thrust 4 → 5 sets');
      assert.equal(t('fi', 'toast.setCountChangedMore', { count: 2 }), '+2 muuta');
      assert.match(t('fi', 'toast.setCountChangedMany', { list: 'x' }), /x$/);
    },
  },
  {
    name: 'set count changes: the emphasis save names its rows only after the write landed, from the days the write read',
    run() {
      const source = fs.readFileSync(path.join(ROOT, 'src/app/programmePlanEdits.tsx'), 'utf8');
      const start = source.indexOf('async function handleSaveEmphasis(');
      const body = source.slice(start, source.indexOf('function setCountToast(', start));
      assert.ok(start > 0 && body.length > 0);
      assert.match(body, /changes = setCountChanges\(sessions, setsByExerciseId\)/, 'computed inside the write slot');
      const savedCheck = body.indexOf('if (!result.saved)');
      const toast = body.indexOf('showToast(setCountToast(changes))');
      assert.ok(savedCheck > 0 && toast > savedCheck, 'no line before the save resolves');
      assert.match(body, /if \(changes\.length > 0\)/, 'a save that moved no count says nothing');

      const app = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
      const call = app.slice(app.indexOf('createProgrammePlanEdits({'), app.indexOf('createProgrammePlanEdits({') + 400);
      assert.match(call, /showToast,/, 'the shell hands its toast to the plan edits');
    },
  },
];
