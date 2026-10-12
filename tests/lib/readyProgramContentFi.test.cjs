const assert = require('node:assert/strict');

const {
  READY_PROGRAM_CONTENT_FI,
} = require('../../.test-dist/lib/readyProgramContentFi');
const { getReadyProgramContent } = require('../../.test-dist/lib/readyProgramContent');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');
const { getReadyTemplatePresentation } = require('../../.test-dist/lib/templatePresentation');

const FIELDS = ['summary', 'audience', 'equipmentProfile', 'whyItWorks'];

module.exports = [
  {
    // Dup sweep 13 review R2: the season competition is gone (owner,
    // 2026-10-12), but its two programmes still told the reader about it —
    // "Kesäkauteen osallistuville", a "Season" / "Kausi" tag, and "Twenty-six
    // weeks" on an 8-week block.
    name: 'no ready programme describes the removed season competition, in either language',
    run() {
      const SEASON = /season|\bkau(si|den|teen|della|delle)\b|kesäkau|talvikau|twenty-six weeks|26 viikkoa/i;
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const language of ['en', 'fi']) {
          const content = getReadyProgramContent(template.id, language);
          for (const field of FIELDS) {
            assert.doesNotMatch(content[field], SEASON, `${template.id}.${field} (${language})`);
          }
          for (const tag of getReadyTemplatePresentation(template, language).tags) {
            assert.doesNotMatch(tag, SEASON, `${template.id} tag (${language})`);
          }
        }
      }
    },
  },
  {
    name: 'every Finnish program entry mirrors an English one, field for field',
    run() {
      for (const [templateId, finnish] of Object.entries(READY_PROGRAM_CONTENT_FI)) {
        const english = getReadyProgramContent(templateId, 'en');
        assert.ok(english, `${templateId} has Finnish content but no English source`);

        for (const field of FIELDS) {
          assert.ok(finnish[field] && finnish[field].trim().length > 0, `${templateId}.${field} is empty`);
          assert.notEqual(
            finnish[field],
            english[field],
            `${templateId}.${field} was left in English`,
          );
        }

      }
    },
  },
  {
    name: 'Finnish is returned for fi and English stays the default',
    run() {
      const fi = getReadyProgramContent('tpl_3_day_full_body_v1', 'fi');
      const en = getReadyProgramContent('tpl_3_day_full_body_v1');

      assert.ok(fi && en);
      assert.notEqual(fi.summary, en.summary);
      assert.match(en.summary, /full-body/i);
    },
  },
  {
    name: 'a program without a Finnish entry still reads in English, never blank',
    run() {
      const missing = Object.keys(READY_PROGRAM_CONTENT_FI).length;
      assert.ok(missing > 0);

      for (const template of WORKOUT_TEMPLATES_V1) {
        const content = getReadyProgramContent(template.id, 'fi');
        if (content) {
          assert.ok(content.summary.trim().length > 0, `${template.id} resolved to an empty summary`);
        }
      }
    },
  },
  {
    /**
     * Both languages said the upper body went heavy with the barbell once,
     * while the pull day opens with the same 4 × 10 barbell row as the bench
     * day (backfill review of #69, 2026-09-16). The copy is pinned to the
     * week it describes: change which days open on a barbell and this fails
     * until the sentence follows.
     */
    name: 'Strong & Lean Female says what its week does: two upper days open on a barbell lift',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.id === 'tpl_gainer_strong_lean_female_v1');
      assert.ok(template, 'the programme is gone from the catalog');
      assert.deepEqual(
        template.sessions
          .map((session) => session.exercises[0].exerciseName)
          .filter((name) => /^Barbell /.test(name)),
        ['Barbell Bench Press', 'Barbell Row'],
      );
      const en = getReadyProgramContent(template.id, 'en').whyItWorks;
      const fi = getReadyProgramContent(template.id, 'fi').whyItWorks;
      assert.match(en, /twice led by a barbell lift \(the bench press and the barbell row\)/);
      assert.match(fi, /kahdesti tankoliikkeestä alkaen \(penkki ja kulmasoutu\)/);
      assert.doesNotMatch(en, /once heavy with the barbell/);
      assert.doesNotMatch(fi, /kerran raskaasti tangolla/);
    },
  },
];
