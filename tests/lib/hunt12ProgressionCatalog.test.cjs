const assert = require('node:assert/strict');

const { progressionRuleLabel } = require('../../src/lib/progressionRuleLabel');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

/**
 * Programme text against the gate (progression hunt 12, A14, 2026-10-11).
 *
 * The rules on a programme's page are prose the progression gate never
 * reads, so they drifted from it: "when the last hard set reaches repsMax"
 * (the gate needs every set at the target), "secondary lifts climb more
 * slowly" (the gate has no role input: every lift steps on the same rule),
 * and the field names repsMin / repsMax printed on the English page of 65
 * programmes. The gate is the truth; the text says what it does.
 */
const KEYS = ['primary', 'secondary', 'accessory', 'failureHandling'];
/** What ProgramDetailScreen renders. The accessory rule is not on the page. */
const RENDERED = ['primary', 'secondary', 'failureHandling'];

const FIELD_NAME = /repsMin|repsMax|rest_?seconds|trackingMode/;
const ROLE_PACE_EN = /last hard set|more slowly|slower|rise more slowly/i;
const ROLE_PACE_FI = /hitaammin|viimeinen raskas sarja/i;

module.exports = [
  {
    name: 'hunt 12 A14-5: no programme rule prints a raw field name, in English or Finnish',
    run() {
      const raw = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const key of KEYS) {
          const rule = template.progressionRules[key];
          for (const text of [rule, progressionRuleLabel('fi', rule)]) {
            if (FIELD_NAME.test(text)) {
              raw.add(`${template.id}.${key}: ${text}`);
            }
          }
        }
      }
      assert.deepEqual([...raw], []);
    },
  },
  {
    name: 'hunt 12 A14-3/4: no rendered rule promises a last-set gate or a slower pace by role',
    run() {
      const promising = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const key of RENDERED) {
          const rule = template.progressionRules[key];
          if (ROLE_PACE_EN.test(rule) || ROLE_PACE_FI.test(progressionRuleLabel('fi', rule))) {
            promising.add(rule);
          }
        }
      }
      assert.deepEqual([...promising], []);
    },
  },
  {
    name: 'hunt 12 A14-3: the anchor rule says every set, in both languages',
    run() {
      const EN =
        'Use double progression on anchor lifts. When every set reaches the target reps with clean form, increase load next time by the smallest practical increment.';
      const FI =
        'Käytä ankkuriliikkeissä tuplaprogressiota. Kun jokainen sarja yltää toistotavoitteeseen puhtaana, nosta painoa ensi kerralla pienimmällä järkevällä askeleella.';
      const carrying = WORKOUT_TEMPLATES_V1.filter((template) => template.progressionRules.primary === EN);
      assert.ok(carrying.length >= 15, `${carrying.length} programmes carry the anchor rule`);
      assert.equal(progressionRuleLabel('fi', EN), FI);
    },
  },
  {
    // Review nit: one reworded secondary rule joined its clauses with ";" in
    // English and a dash in Finnish.
    name: 'hunt 12 A14: a rendered rule joins its clauses the same way in English and Finnish',
    run() {
      const mismatched = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const key of RENDERED) {
          const rule = template.progressionRules[key];
          const fi = progressionRuleLabel('fi', rule);
          if (rule.includes(';') !== fi.includes(';') || rule.includes('—') !== fi.includes('—')) {
            mismatched.add(`${rule} | ${fi}`);
          }
        }
      }
      assert.deepEqual([...mismatched], []);
    },
  },
];
