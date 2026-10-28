const assert = require('node:assert/strict');

const { buildRecommendationOptionIds } = require('../../src/lib/recommendationPresentation');

module.exports = [
  {
    name: 'recommendation presentation builds a unique ordered option list from primary secondary and alternatives',
    run() {
      const optionIds = buildRecommendationOptionIds({
        featuredProgramId: 'tpl_primary',
        secondaryProgramId: 'tpl_secondary',
        alternativeProgramIds: ['tpl_secondary', 'tpl_third', 'tpl_primary', 'tpl_fourth'],
      });

      assert.deepEqual(optionIds, ['tpl_primary', 'tpl_secondary', 'tpl_third', 'tpl_fourth']);
    },
  },
];
