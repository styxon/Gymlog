const assert = require('node:assert/strict');

const { resolveWorkoutLoggerFallbackRoute } = require('../../src/lib/workoutLoggerNavigation');
const { ROOT_ROUTES } = require('../../src/navigation/routes');

module.exports = [
  {
    name: 'logger fallback returns home when the live session belongs to the recommended plan',
    run() {
      const route = resolveWorkoutLoggerFallbackRoute({
        activeWorkoutTemplateId: 'tpl_3_day_strength_base_v1',
        recommendedProgramId: 'tpl_3_day_strength_base_v1',
        setupCompleted: true,
      });

      assert.deepEqual(route, ROOT_ROUTES.home);
    },
  },
  {
    name: 'logger fallback returns home when the live session is not the recommended plan',
    run() {
      const route = resolveWorkoutLoggerFallbackRoute({
        activeWorkoutTemplateId: 'custom_upper_lower',
        recommendedProgramId: 'tpl_3_day_strength_base_v1',
        setupCompleted: true,
      });

      assert.deepEqual(route, ROOT_ROUTES.home);
    },
  },
  {
    name: 'logger fallback returns workout list when no live session exists',
    run() {
      const route = resolveWorkoutLoggerFallbackRoute({
        activeWorkoutTemplateId: null,
        recommendedProgramId: 'tpl_3_day_strength_base_v1',
        setupCompleted: true,
      });

      assert.deepEqual(route, ROOT_ROUTES.workout);
    },
  },
];
