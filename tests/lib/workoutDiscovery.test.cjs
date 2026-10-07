const assert = require('node:assert/strict');

const {
  buildReadyProgramSearchText,
  filterAndSortReadyDiscoveryItems,
  filterReadyDiscoveryItems,
  getReadyProgramEquipmentBucket,
  getReadyProgramTimeBucket,
} = require('../../.test-dist/lib/workoutDiscovery.js');
const { getPreferredReadyEquipmentFilter } = require('../../.test-dist/lib/tailoringFit.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { getReadyProgramContent } = require('../../.test-dist/lib/readyProgramContent.js');
const { readyTemplateCardMinutes } = require('../../.test-dist/lib/programmeMinutes.js');

function createItem(templateId) {
  const template = getWorkoutTemplateById(templateId);
  return {
    template,
    content: getReadyProgramContent(templateId),
    // The card's number, as the plans screen builds it.
    minutes: readyTemplateCardMinutes(template),
  };
}

module.exports = [
  {
    name: 'ready discovery buckets plans by time and equipment',
    run() {
      assert.equal(getReadyProgramTimeBucket(40), 'short');
      assert.equal(getReadyProgramTimeBucket(55), 'balanced');
      assert.equal(getReadyProgramTimeBucket(70), 'long');

      assert.equal(getReadyProgramEquipmentBucket(createItem('tpl_3_day_strength_base_v1')), 'full_gym');
      assert.equal(getReadyProgramEquipmentBucket(createItem('tpl_2_day_mobility_reset_v1')), 'low_equipment');
    },
  },
  {
    name: 'ready discovery search text includes summary and tradeoff context',
    run() {
      const text = buildReadyProgramSearchText(createItem('tpl_3_day_push_pull_legs_v1'));

      assert.match(text, /classic three-day ppl/i);
      assert.match(text, /tradeoff/i);
    },
  },
  {
    name: 'ready discovery filters by query, level, time, goal, and equipment',
    run() {
      const items = [
        createItem('tpl_3_day_strength_base_v1'),
        createItem('tpl_4_day_powerbuilding_v1'),
        createItem('tpl_2_day_mobility_reset_v1'),
      ];

      const filtered = filterReadyDiscoveryItems(items, {
        query: 'power',
        goal: 'strength',
        level: 'intermediate',
        // The card says 40 min for Powerbuilding (the catalog's hand-written 60
        // said "balanced"), and the filter follows the card.
        time: 'short',
        equipment: 'full_gym',
      });

      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].template.id, 'tpl_4_day_powerbuilding_v1');
    },
  },
  {
    name: 'ready discovery exposes the equipment default from tailoring',
    run() {
      // Asserted on tailoringFit directly. workoutDiscovery re-exported this
      // under a second name and nothing outside this file ever called it.
      assert.equal(
        getPreferredReadyEquipmentFilter({
          setupEquipment: 'minimal',
          setupFreeWeightsPreference: 'neutral',
          setupBodyweightPreference: 'prefer',
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
    name: 'ready discovery can sort toward tailoring fit after filtering',
    run() {
      const items = [
        createItem('tpl_4_day_powerbuilding_v1'),
        createItem('tpl_2_day_minimal_full_body_v1'),
      ];

      const filtered = filterAndSortReadyDiscoveryItems(
        items,
        {
          query: '',
          goal: 'all',
          level: 'all',
          time: 'all',
          equipment: 'all',
        },
        {
          setupEquipment: 'minimal',
          setupFreeWeightsPreference: 'neutral',
          setupBodyweightPreference: 'prefer',
          setupMachinesPreference: 'neutral',
          setupShoulderFriendlySwaps: 'neutral',
          setupElbowFriendlySwaps: 'neutral',
          setupKneeFriendlySwaps: 'neutral',
        },
      );

      assert.equal(filtered[0].template.id, 'tpl_2_day_minimal_full_body_v1');
    },
  },
];
