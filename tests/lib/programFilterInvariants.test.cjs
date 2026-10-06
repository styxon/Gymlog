const assert = require('node:assert/strict');

const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { PROGRAM_CATEGORIES, isInCategory } = require('../../.test-dist/lib/programCategories.js');
const { resolveProgramEquipment, resolveProgramEquipmentBucket } = require('../../.test-dist/lib/programEquipment.js');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog.js');
const { readyTemplateCardMinutes } = require('../../.test-dist/lib/programmeMinutes.js');
const discovery = require('../../.test-dist/lib/workoutDiscovery.js');
const { getReadyProgramContent } = require('../../.test-dist/lib/readyProgramContent.js');
const { catalogLevelForSetup } = require('../../.test-dist/lib/goalProgramme.js');
const { filterProgramCatalog } = require('../../.test-dist/lib/programCatalogFilter.js');
const { partitionByReaderWeek } = require('../../.test-dist/lib/programLadder.js');

/**
 * Every programme filter against the catalog it filters (#bugs 2026-10-06,
 * "kaikki filtterit uusiksi" — the exercise half is pickerRules). A chip
 * promises something about every programme it lists; each suite here states
 * the promise and checks all of them:
 *
 * - "Kotona" / low equipment: needs no gym equipment;
 * - a time bucket: the minutes the card prints;
 * - a level chip: a level the recommender also offers the programme to;
 * - "fits your week": the days the programme actually has;
 * - a goal tile: the goal the recommender scores the programme for.
 *
 * The Programs tab rows are built in src/app/useProgramsCatalog.tsx from the
 * same fields used here: days = daysPerWeek, minutes = readyTemplateCardMinutes,
 * level = template.level.
 */
const templates = WORKOUT_TEMPLATES_V1;
const exerciseNames = (template) => template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
const definitionFor = (id) => RECOMMENDATION_PROGRAMS.find((definition) => definition.programId === id);
const SETUP_LEVEL_FOR_CATALOG = { beginner: 'beginner', intermediate: 'advanced', advanced: 'pro' };

/**
 * Content mismatches the ready-programme catalog owns (workoutCatalog /
 * gainerProgramCatalog), listed rather than fixed here. Each must still be a
 * mismatch: when the catalog is corrected, the entry has to go.
 *
 * - Joint Friendly is `goalType: 'hypertrophy'`, so the "Lihasmassa" tile and
 *   the catalog's goal chip list it, while the recommender scores it for
 *   general fitness only and files it under recovery.
 */
const KNOWN_GOAL_MISMATCHES = new Set([]);

module.exports = [
  {
    name: 'programme filters: "Kotona" and the low-equipment chip list only programmes that need no gym equipment',
    run() {
      const home = templates.filter((template) => isInCategory(template, 'home'));
      assert.ok(home.length >= 8);
      for (const template of home) {
        assert.equal(
          resolveProgramEquipmentBucket(exerciseNames(template)),
          'low_equipment',
          `${template.id} needs ${resolveProgramEquipment(exerciseNames(template)).join(', ')}`,
        );
      }
      // The plans screen's chip and the recommender read the same bucket.
      for (const template of templates) {
        const item = discovery.buildReadyDiscoveryItem(template, getReadyProgramContent(template.id));
        const bucket = discovery.getReadyProgramEquipmentBucket(item);
        assert.equal(bucket, resolveProgramEquipmentBucket(exerciseNames(template)), template.id);
        const definition = definitionFor(template.id);
        if (definition) assert.equal(definition.equipmentTier, bucket, `${template.id}: recommender tier`);
      }
      // Every tpl_home_* programme is behind the tile.
      assert.deepEqual(
        templates.filter((template) => template.id.startsWith('tpl_home_') && !isInCategory(template, 'home')).map((t) => t.id),
        [],
      );
    },
  },
  {
    name: 'programme filters: a time bucket is the minutes the card prints, and the recommender scores the same minutes',
    run() {
      for (const options of [{}, { availableEquipment: ['Dumbbells'], overrides: null }]) {
        for (const template of templates) {
          const item = discovery.buildReadyDiscoveryItem(template, getReadyProgramContent(template.id), options);
          const card = readyTemplateCardMinutes(template, options);
          assert.equal(item.minutes, card, template.id);
          for (const time of ['short', 'balanced', 'long']) {
            const listed = discovery
              .filterReadyDiscoveryItems([item], { query: '', goal: 'all', level: 'all', time, equipment: 'all' })
              .includes(item);
            assert.equal(listed, discovery.getReadyProgramTimeBucket(card) === time, `${template.id} ${time}`);
          }
        }
      }
      for (const definition of RECOMMENDATION_PROGRAMS) {
        const template = templates.find((entry) => entry.id === definition.programId);
        assert.equal(definition.estimatedSessionMinutes, readyTemplateCardMinutes(template), definition.programId);
      }
    },
  },
  {
    name: 'programme filters: a level chip lists programmes the recommender offers to that level',
    run() {
      const offenders = [];
      for (const template of templates) {
        const definition = definitionFor(template.id);
        if (!definition) continue;
        const setupLevel = SETUP_LEVEL_FOR_CATALOG[template.level];
        if (!definition.supportedLevels.includes(setupLevel)) {
          offenders.push(`${template.id}: chip ${template.level}, recommended for ${definition.supportedLevels.join('/')}`);
        }
        // And the map the "fits your week" ordering reads is the inverse of this one.
        assert.equal(catalogLevelForSetup(setupLevel), template.level);
      }
      assert.deepEqual(offenders, []);
      // The catalog's level chip is exactly template.level.
      const rows = templates.map((template) => ({ id: template.id, name: template.name, blurb: '', level: template.level, categories: [] }));
      for (const level of ['beginner', 'intermediate', 'advanced']) {
        const shown = filterProgramCatalog(rows, { level, goal: null, search: '' });
        assert.deepEqual(shown.map((row) => row.id), templates.filter((t) => t.level === level).map((t) => t.id), level);
      }
    },
  },
  {
    name: 'programme filters: "fits your week" counts the days a programme actually has',
    run() {
      for (const template of templates) {
        assert.equal(template.daysPerWeek, template.sessions.length, template.id);
        const definition = definitionFor(template.id);
        if (definition) assert.equal(definition.daysPerWeek, template.daysPerWeek, template.id);
      }
      const rows = templates.map((template) => ({ id: template.id, days: template.daysPerWeek, minutes: 0, weeks: 8, level: template.level }));
      for (const days of [2, 3, 4, 5, 6]) {
        const { fits } = partitionByReaderWeek(rows, days, null);
        assert.deepEqual(fits.map((row) => row.id), templates.filter((t) => t.sessions.length === days).map((t) => t.id), `${days} days`);
      }
    },
  },
  {
    name: 'programme filters: a goal tile lists programmes the recommender scores for that goal',
    run() {
      const offenders = [];
      for (const template of templates) {
        const definition = definitionFor(template.id);
        if (!definition) continue;
        const goals = definition.supportedGoals;
        if (isInCategory(template, 'strength') !== goals.includes('strength')) {
          offenders.push(`${template.id}: strength tile ${isInCategory(template, 'strength')}, goals ${goals.join('/')}`);
        }
        if (isInCategory(template, 'muscle') && !goals.includes('muscle') && !KNOWN_GOAL_MISMATCHES.has(template.id)) {
          offenders.push(`${template.id}: muscle tile, goals ${goals.join('/')}`);
        }
      }
      assert.deepEqual(offenders, []);
      // Each listed mismatch is still one; a fixed catalog shrinks the list.
      for (const id of KNOWN_GOAL_MISMATCHES) {
        const template = templates.find((entry) => entry.id === id);
        assert.ok(template, `${id} no longer exists`);
        assert.equal(isInCategory(template, 'muscle') && !definitionFor(id).supportedGoals.includes('muscle'), true, `${id} is fixed — remove it`);
      }
      // No programme is behind no tile.
      assert.deepEqual(
        templates.filter((template) => !PROGRAM_CATEGORIES.some((category) => isInCategory(template, category.key))).map((t) => t.id),
        [],
      );
    },
  },
];
