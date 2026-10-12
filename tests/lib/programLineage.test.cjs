const assert = require('node:assert/strict');

const {
  alignHistoryToCopiedDays,
  programmeHistoryIds,
  programmeOriginId,
} = require('../../.test-dist/lib/programLineage.js');

/**
 * The same programme, before and after the reader changed a lift in it
 * (programme audit, 2026-09-16).
 */

const TEMPLATES = [
  { id: 'copy_1', sourceTemplateId: 'tpl_full_body' },
  { id: 'copy_2', sourceTemplateId: 'tpl_full_body' },
  { id: 'own', sourceTemplateId: null },
  { id: 'copy_other', sourceTemplateId: 'tpl_upper_lower' },
];

module.exports = [
  {
    name: 'lineage: a copy stands for the programme it came from, anything else for itself',
    run() {
      // What a programme IS — its block length above all — is asked of this
      // id; asking the copy's own id found nothing in the catalog.
      assert.equal(programmeOriginId('copy_1', TEMPLATES), 'tpl_full_body');
      assert.equal(programmeOriginId('copy_other', TEMPLATES), 'tpl_upper_lower');
      assert.equal(programmeOriginId('tpl_full_body', TEMPLATES), 'tpl_full_body');
      assert.equal(programmeOriginId('own', TEMPLATES), 'own');
      assert.equal(programmeOriginId('unknown', TEMPLATES), 'unknown');
    },
  },
  {
    name: 'lineage: yesterday’s session wears the day id the copy knows it by',
    run() {
      const sessions = [
        { id: 's1', workoutTemplateId: 'tpl_full_body', workoutTemplateSessionId: 'day_b', performedAt: '2026-09-15T17:00:00.000Z' },
        { id: 's2', workoutTemplateId: 'copy_1', workoutTemplateSessionId: 'copy_day_a', performedAt: '2026-09-16T17:00:00.000Z' },
        { id: 's3', workoutTemplateId: 'tpl_other', workoutTemplateSessionId: 'x', performedAt: '2026-09-14T17:00:00.000Z' },
      ];
      const mapping = {
        fromTemplateIds: ['copy_1', 'tpl_full_body'],
        fromSessionIds: ['day_a', 'day_b', 'day_c'],
        toTemplateId: 'copy_1',
        toSessionIds: ['copy_day_a', 'copy_day_b', 'copy_day_c'],
      };

      const aligned = alignHistoryToCopiedDays(sessions, mapping);
      // Day 2 of the original is day 2 of the copy.
      assert.deepEqual(aligned[0], { ...sessions[0], workoutTemplateId: 'copy_1', workoutTemplateSessionId: 'copy_day_b' });
      // What already belongs to the copy is left alone, and so is everything
      // that belongs to another programme.
      assert.deepEqual(aligned[1], sessions[1]);
      assert.deepEqual(aligned[2], sessions[2]);
      // Nothing is dropped and nothing is added.
      assert.equal(aligned.length, sessions.length);
    },
  },
  {
    // Matching by position alone sent yesterday's day to whatever the reader
    // had dragged into its place (review, 2026-09-16).
    name: 'lineage: a day is found by its name, wherever the reader moved it',
    run() {
      const logged = (day) => ({ id: day, workoutTemplateId: 'tpl_ppl', workoutTemplateSessionId: day });
      const base = {
        fromTemplateIds: ['copy_1', 'tpl_ppl'],
        fromSessionIds: ['push', 'pull', 'legs'],
        // Its own name, and how it reads translated.
        fromSessionNames: [['Push', 'Työntö'], ['Pull', 'Veto'], ['Legs', 'Jalat']],
        toTemplateId: 'copy_1',
      };
      const dayOf = (mapping, day) => alignHistoryToCopiedDays([logged(day)], { ...base, ...mapping })[0].workoutTemplateSessionId;

      // Reordered: Legs moved first. Pull is still Pull.
      const reordered = { toSessionIds: ['c_legs', 'c_push', 'c_pull'], toSessionNames: ['Jalat', 'Työntö', 'Veto'] };
      assert.equal(dayOf(reordered, 'pull'), 'c_pull');
      assert.equal(dayOf(reordered, 'push'), 'c_push');
      assert.equal(dayOf(reordered, 'legs'), 'c_legs');
      // The same, with the copy made while the app was in English.
      assert.equal(dayOf({ toSessionIds: ['c_legs', 'c_push'], toSessionNames: [' legs ', 'PUSH'] }, 'legs'), 'c_legs');

      // A day deleted: the others are still found, the deleted one is not.
      const shortened = { toSessionIds: ['c_push', 'c_legs'], toSessionNames: ['Työntö', 'Jalat'] };
      assert.equal(dayOf(shortened, 'legs'), 'c_legs');
      assert.equal(dayOf(shortened, 'pull'), 'pull');

      // A day renamed where it stood: its place says which day it is.
      const renamed = { toSessionIds: ['c_push', 'c_back', 'c_legs'], toSessionNames: ['Työntö', 'Selkä', 'Jalat'] };
      assert.equal(dayOf(renamed, 'pull'), 'c_back');
      // Renamed AND moved: the place now holds a day the original knows, so
      // nothing is guessed.
      const renamedMoved = { toSessionIds: ['c_push', 'c_legs', 'c_back'], toSessionNames: ['Työntö', 'Jalat', 'Selkä'] };
      assert.equal(dayOf(renamedMoved, 'pull'), 'pull');
      assert.equal(dayOf(renamedMoved, 'legs'), 'c_legs');

      // Every day renamed: position is all there is.
      const allRenamed = { toSessionIds: ['c_1', 'c_2', 'c_3'], toSessionNames: ['A', 'B', 'C'] };
      assert.equal(dayOf(allRenamed, 'pull'), 'c_2');

      // Two days by one name: the one still in its place, or neither.
      const twins = {
        fromSessionIds: ['fb1', 'fb2', 'arms'],
        fromSessionNames: [['Full Body'], ['Full Body'], ['Arms']],
      };
      const loggedTwin = (day) => [{ id: day, workoutTemplateId: 'tpl_ppl', workoutTemplateSessionId: day }];
      const inPlace = alignHistoryToCopiedDays(loggedTwin('fb2'), {
        ...base,
        ...twins,
        toSessionIds: ['c_fb1', 'c_fb2', 'c_arms'],
        toSessionNames: ['Full Body', 'Full Body', 'Arms'],
      });
      assert.equal(inPlace[0].workoutTemplateSessionId, 'c_fb2');
      const moved = alignHistoryToCopiedDays(loggedTwin('fb1'), {
        ...base,
        ...twins,
        toSessionIds: ['c_arms', 'c_fb1', 'c_fb2'],
        toSessionNames: ['Arms', 'Full Body', 'Full Body'],
      });
      assert.equal(moved[0].workoutTemplateSessionId, 'fb1');
    },
  },
  {
    name: 'lineage: the app hands over the day names, translated both ways',
    run() {
      const { readAppWiring } = require('../helpers/appWiringSource.cjs');
      const wiring = readAppWiring();
      const call = wiring.slice(wiring.indexOf('return alignHistoryToCopiedDays(sessions, {'));
      const args = call.slice(0, call.indexOf('});'));
      assert.match(args, /fromSessionNames: source\.sessions\.map\(\(session\) => \[\s*session\.name,\s*localizeSessionName\(session\.name, 'fi'\),\s*localizeSessionName\(session\.name, 'en'\),\s*\]\),/);
      assert.match(args, /toSessionNames: copiedDays\.map\(\(session\) => session\.name\),/);
      assert.match(args, /toSessionIds: copiedDays\.map\(\(session\) => session\.id\),/);
    },
  },
  {
    name: 'lineage: once the days no longer line up, nothing is translated',
    run() {
      const sessions = [{ id: 's1', workoutTemplateId: 'tpl_full_body', workoutTemplateSessionId: 'day_b' }];
      // The reader deleted a day from their copy: position no longer means
      // the same day, and guessing would put yesterday on the wrong workout.
      const shortened = alignHistoryToCopiedDays(sessions, {
        fromTemplateIds: ['copy_1', 'tpl_full_body'],
        fromSessionIds: ['day_a', 'day_b', 'day_c'],
        toTemplateId: 'copy_1',
        toSessionIds: ['copy_day_a', 'copy_day_b'],
      });
      assert.deepEqual(shortened, sessions);

      // A day the original does not have is left as it is.
      const unknownDay = alignHistoryToCopiedDays(
        [{ id: 's1', workoutTemplateId: 'tpl_full_body', workoutTemplateSessionId: 'day_z' }],
        {
          fromTemplateIds: ['copy_1', 'tpl_full_body'],
          fromSessionIds: ['day_a', 'day_b'],
          toTemplateId: 'copy_1',
          toSessionIds: ['copy_day_a', 'copy_day_b'],
        },
      );
      assert.equal(unknownDay[0].workoutTemplateId, 'tpl_full_body');

      // And a programme with no copy at all is a no-op.
      assert.deepEqual(
        alignHistoryToCopiedDays(sessions, {
          fromTemplateIds: ['copy_1'],
          fromSessionIds: ['day_a', 'day_b'],
          toTemplateId: 'copy_1',
          toSessionIds: ['copy_day_a', 'copy_day_b'],
        }),
        sessions,
      );
    },
  },
  {
    name: 'lineage: a block counts its own history, not another copy of the same programme',
    run() {
      // A copy inherits the programme it was made from — that is the point —
      // but work logged in somebody's OTHER copy belongs to that copy's own
      // block, and counting it would inflate this one's week counter.
      assert.deepEqual(programmeHistoryIds('copy_1', TEMPLATES), ['copy_1', 'tpl_full_body']);
      assert.deepEqual(programmeHistoryIds('tpl_full_body', TEMPLATES), ['tpl_full_body']);
      assert.deepEqual(programmeHistoryIds('own', TEMPLATES), ['own']);
      assert.deepEqual(programmeHistoryIds('tpl_unknown', TEMPLATES), ['tpl_unknown']);
      // A record that somehow points at itself is still one id, not two.
      assert.deepEqual(programmeHistoryIds('loop', [{ id: 'loop', sourceTemplateId: 'loop' }]), ['loop']);

      // And a programme another plan is running keeps its own work: a reader
      // who took the original up again after copying it has two plans, and
      // the sessions logged in the original belong to the original's block
      // (PR #125 review).
      assert.deepEqual(programmeHistoryIds('copy_1', TEMPLATES, ['tpl_full_body']), ['copy_1']);
      assert.deepEqual(programmeHistoryIds('copy_1', TEMPLATES, ['tpl_other']), ['copy_1', 'tpl_full_body']);
      assert.deepEqual(programmeHistoryIds('copy_1', TEMPLATES, []), ['copy_1', 'tpl_full_body']);
    },
  },
];
