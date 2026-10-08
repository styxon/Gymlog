const assert = require('node:assert/strict');

const first = require('../../.test-dist/lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer.js');

/**
 * Persona hunt, 2026-10-08: a day named for a lift a caution flag took out
 * ("Day 1: Squat & Bench" over a day with no squat). The renaming itself is
 * sessionNameAfterRemovedLifts (cautionFilterRound3 pins its unit cases); this
 * sweeps whole composed weeks, at both `avoid` and `careful`.
 */
module.exports = [
  {
    name: 'caution day names: a day whose lift a flag took out is not named for it',
    run() {
      const { localizeWorkoutFocus } = require('../../.test-dist/lib/sessionNameLabel.js');
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

      for (const word of ['Lower', 'Upper', 'Push', 'Pull', 'Full Body']) {
        assert.notEqual(localizeWorkoutFocus(word, 'fi'), word, `${word} has a Finnish word`);
      }

      // Every template, every flag: no day keeps a lift word nothing on it honours.
      const honours = {
        squat: /squat|leg press|lunge|step-?up|hack/i,
        deadlift: /deadlift/i,
        bench: /bench|chest press|push-?up|dip\b/i,
        press: /press|push-?up|dip\b/i,
        row: /row|pulldown|pull-?up|chin-?up/i,
      };
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const area of ['knees', 'lower_back', 'shoulders', 'wrists', 'hips', 'elbows', 'ankles', 'neck']) {
          for (const level of ['avoid', 'careful']) {
            let week = null;
            try {
              week = composeProgramWeekForSelection(
                {
                  ...first.DEFAULT_FIRST_RUN_SELECTION,
                  daysPerWeek: template.daysPerWeek,
                  cautionFlags: [{ area, level, refinements: [] }],
                },
                template.id,
              );
            } catch {
              continue; // seasonal templates have no recommendation profile
            }
            if (!week) {
              continue;
            }
            for (const session of week.sessions) {
              const names = session.exercises.map((exercise) => exercise.exerciseName);
              const body = session.name.replace(/^\s*Day\s+\d+\s*:\s*/i, '');
              for (const part of body.split(/\s*[&+]\s*/)) {
                const word = part.trim().match(/^(squat|deadlift|bench|press|row)(?:\s+day)?$/i);
                if (word) {
                  assert.ok(
                    names.some((name) => honours[word[1].toLowerCase()].test(name)),
                    `${template.id} [${area}/${level}] "${session.name}" has no ${word[1]}: ${names.join('; ')}`,
                  );
                }
              }
            }
          }
        }
      }

      // And the case the hunt found, end to end.
      const strength = composeProgramWeekForSelection(
        {
          ...first.DEFAULT_FIRST_RUN_SELECTION,
          daysPerWeek: 3,
          cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }],
        },
        'tpl_3_day_strength_base_v1',
      );
      assert.deepEqual(
        strength.sessions.map((session) => session.name),
        ['Day 1: Bench', 'Day 2: Deadlift & Press', 'Day 3: Row'],
      );
    },
  },
];
