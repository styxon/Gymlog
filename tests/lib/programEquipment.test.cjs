const assert = require('node:assert/strict');

const {
  EQUIPMENT_CHIP_KEYS,
  missingEquipment,
  resolveProgramEquipment,
} = require('../../src/lib/programEquipment');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

function gearFor(id) {
  const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.id === id);
  return resolveProgramEquipment(
    template.sessions.flatMap((session) => session.exercises.map((ex) => ex.exerciseName)),
  );
}

module.exports = [
  {
    name: 'equipment is derived from the exercises, not from a sentence',
    run() {
      // The catalog stored one prose line per program. Prose cannot be checked
      // against the reader's own gym; a list can.
      const powerbuild = gearFor('tpl_4_day_powerbuilding_v1');
      assert.ok(powerbuild.includes('Barbells'));
      assert.ok(powerbuild.includes('Bench'));
      assert.ok(powerbuild.length >= 4);

      // A program with no gear reports none rather than a default set — the
      // section then does not render at all.
      assert.deepEqual(gearFor('tpl_3_day_run_mobility_v1'), []);

      // "Hip Thrust (Bodyweight)" matched the hip-thrust rule and claimed a
      // bench, so a postpartum program that needs a floor was listed as
      // needing gym furniture. When the name says bodyweight, it means it.
      assert.deepEqual(resolveProgramEquipment(['Hip Thrust (Bodyweight)']), []);
      assert.deepEqual(resolveProgramEquipment(['Barbell Hip Thrust']), ['Barbells', 'Bench']);
      assert.ok(!gearFor('tpl_gainer_postpartum_recovery_v1').includes('Bench'));
    },
  },
  {
    name: 'an unknown gym is missing nothing, and a rack counts as a barbell',
    run() {
      const needed = ['Barbells', 'Bench', 'Machines'];
      // The setup never said: no verdict rather than a false all-clear.
      assert.deepEqual(missingEquipment(needed, null), []);

      assert.deepEqual(missingEquipment(needed, ['Barbells', 'Bench', 'Machines']), []);
      assert.deepEqual(missingEquipment(needed, ['Barbells', 'Bench']), ['Machines']);
      // "Barbell & plates" and "Barbells" describe the same corner of a gym;
      // demanding both would report a missing item nobody is missing.
      assert.deepEqual(missingEquipment(['Barbells'], ['Barbell & plates', 'Bench']), []);
    },
  },
  {
    name: 'no program ships with placeholder copy, in either language',
    run() {
      // Twenty of fifty-five shared one filler paragraph, and it was invisible
      // until the program screen started rendering the description. A test is
      // cheaper than noticing it on a device again.
      const { getReadyProgramContent } = require('../../src/lib/readyProgramContent');
      const { FALLBACK_READY_PROGRAM_CONTENT_FI } = require('../../src/lib/readyProgramContentFi');
      const placeholder = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const language of ['en', 'fi']) {
          const content = getReadyProgramContent(template.id, language);
          assert.ok(content, `${template.id} has no content in ${language}`);
          // The English fallback is built inline and opens with this phrase.
          // The Finnish one is an exported constant, so compare to it: a
          // prefix check went blind the first time the wording was touched.
          if (
            content.summary.startsWith('A structured Vinha') ||
            content.summary === FALLBACK_READY_PROGRAM_CONTENT_FI.summary
          ) {
            placeholder.push(`${template.id}/${language}`);
          }
        }
      }
      assert.equal(placeholder.length, 0, `placeholder copy: ${placeholder.slice(0, 5).join(', ')}`);
    },
  },
  {
    name: 'every chip any program can produce has a label',
    run() {
      // A chip with no key renders the section header as its own name, which
      // is the kind of thing nobody notices until it ships.
      const produced = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const chip of gearFor(template.id)) {
          produced.add(chip);
        }
      }
      assert.ok(produced.size > 0);
      for (const chip of produced) {
        assert.ok(EQUIPMENT_CHIP_KEYS[chip], `no label for chip "${chip}"`);
      }
    },
  },
];
