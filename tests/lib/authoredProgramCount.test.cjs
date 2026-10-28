const assert = require('node:assert/strict');

const {
  FREE_CUSTOM_PROGRAM_LIMIT,
  countAuthoredPrograms,
  resolveProgramSlots,
} = require('../../src/lib/programSlots');

module.exports = [
  {
    name: 'logging freestyle workouts does not spend program slots',
    run() {
      // Exactly the state the emulator was in: three "own programs", two of
      // them ad-hoc sessions the user logged and never authored.
      const templates = [
        { id: 'a', origin: 'authored' },
        { id: 'b', origin: 'freestyle' },
        { id: 'c', origin: 'freestyle' },
      ];
      assert.equal(countAuthoredPrograms(templates), 1);

      const slots = resolveProgramSlots(countAuthoredPrograms(templates), false);
      assert.equal(slots.used, 1);
      assert.equal(slots.canCreate, true, 'the cap sheet said 3/3 with one program authored');
    },
  },
  {
    name: 'a template stored before the field existed still counts',
    run() {
      // There is no way to tell after the fact which of the old rows were
      // authored, and counting them is how they already behaved.
      assert.equal(countAuthoredPrograms([{ id: 'a' }, { id: 'b', origin: undefined }]), 2);
      assert.equal(countAuthoredPrograms([]), 0);
    },
  },
  {
    name: 'the cap still closes on authored programs',
    run() {
      const authored = Array.from({ length: FREE_CUSTOM_PROGRAM_LIMIT }, (unused, index) => ({
        id: `a${index}`,
        origin: 'authored',
      }));
      const withFreestyle = [...authored, { id: 'f', origin: 'freestyle' }];
      const slots = resolveProgramSlots(countAuthoredPrograms(withFreestyle), false);
      assert.equal(slots.used, FREE_CUSTOM_PROGRAM_LIMIT);
      assert.equal(slots.canCreate, false);
      // Pro is uncapped either way.
      assert.equal(resolveProgramSlots(countAuthoredPrograms(withFreestyle), true).canCreate, true);
    },
  },
];
