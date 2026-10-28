const assert = require('node:assert/strict');

const {
  buildTailoredSwapOptions,
  buildTailoringBadgeLabels,
  getPreferredReadyEquipmentFilter,
  rankProgramIdsByTailoring,
} = require('../../src/lib/tailoringFit');

module.exports = [
  {
    name: 'tailoring fit ranks low-equipment plans higher for minimal setup users',
    run() {
      const ranked = rankProgramIdsByTailoring(
        ['tpl_4_day_powerbuilding_v1', 'tpl_2_day_minimal_full_body_v1', 'tpl_2_day_mobility_reset_v1'],
        {
          setupEquipment: 'minimal',
          setupFreeWeightsPreference: 'neutral',
          setupBodyweightPreference: 'neutral',
          setupMachinesPreference: 'neutral',
          setupShoulderFriendlySwaps: 'neutral',
          setupElbowFriendlySwaps: 'neutral',
          setupKneeFriendlySwaps: 'neutral',
        },
      );

      assert.equal(ranked[0], 'tpl_2_day_minimal_full_body_v1');
      assert.equal(ranked.includes('tpl_4_day_powerbuilding_v1'), true);
    },
  },
  {
    name: 'tailoring fit exposes the preferred discovery equipment filter',
    run() {
      assert.equal(
        getPreferredReadyEquipmentFilter({
          setupEquipment: 'home',
          setupFreeWeightsPreference: 'neutral',
          setupBodyweightPreference: 'neutral',
          setupMachinesPreference: 'neutral',
          setupShoulderFriendlySwaps: 'neutral',
          setupElbowFriendlySwaps: 'neutral',
          setupKneeFriendlySwaps: 'neutral',
        }),
        'low_equipment',
      );
    },
  },
  {
    name: 'tailored swaps push joint-friendly machine options up first',
    run() {
      const swaps = buildTailoredSwapOptions(
        ['Bench Press', 'Machine Chest Press', 'Incline Bench Press', 'Incline Dumbbell Press'],
        {
          setupEquipment: 'gym',
          setupFreeWeightsPreference: 'avoid',
          setupBodyweightPreference: 'neutral',
          setupMachinesPreference: 'love',
          setupShoulderFriendlySwaps: 'prioritize',
          setupElbowFriendlySwaps: 'neutral',
          setupKneeFriendlySwaps: 'neutral',
        },
      );

      assert.equal(swaps[0].exerciseName, 'Machine Chest Press');
      assert.match(swaps[0].reason ?? '', /protects shoulders|machine/i);
    },
  },
  {
    name: 'tailoring fit exposes compact equipment and joint badges',
    run() {
      const badges = buildTailoringBadgeLabels({
        setupEquipment: 'home',
        setupFreeWeightsPreference: 'neutral',
        setupBodyweightPreference: 'neutral',
        setupMachinesPreference: 'neutral',
        setupShoulderFriendlySwaps: 'prioritize',
        setupElbowFriendlySwaps: 'neutral',
        setupKneeFriendlySwaps: 'prefer',
      });

      assert.deepEqual(badges, ['Home fit', 'Shoulder priority', 'Knee-friendly']);
    },
  },
];
