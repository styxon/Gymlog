const assert = require('node:assert/strict');

const { READY_PROGRAM_COLLECTIONS } = require('../../src/lib/readyProgramCollections');

// src used to export a lookup for this. Every caller reads the table directly,
// so the lookup went and the one line it was stayed here.
const getReadyProgramCollection = (key) => READY_PROGRAM_COLLECTIONS.find((entry) => entry.key === key);

module.exports = [
  {
    name: 'ready program collections expose expanded starter, strength, and muscle lanes',
    run() {
      const starter = getReadyProgramCollection('starter');
      const strength = getReadyProgramCollection('strength');
      const muscle = getReadyProgramCollection('muscle');

      assert.equal(starter.label, 'Starter picks');
      assert.ok(starter.templateIds.includes('tpl_3_day_full_body_v1'));
      assert.ok(starter.templateIds.includes('tpl_2_day_beginner_strength_v1'));
      assert.equal(strength.label, 'Build strength');
      assert.ok(strength.templateIds.includes('tpl_4_day_powerbuilding_v1'));
      assert.ok(strength.templateIds.includes('tpl_4_day_strength_size_v1'));
      assert.equal(muscle.label, 'Build muscle');
      assert.ok(muscle.templateIds.includes('tpl_3_day_push_pull_legs_v1'));
      assert.ok(READY_PROGRAM_COLLECTIONS.length >= 4);
    },
  },
];
