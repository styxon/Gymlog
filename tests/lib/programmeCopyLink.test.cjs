const assert = require('node:assert/strict');

const {
  findHeldReadyProgrammeCopyId,
  findReadyProgrammeCopyId,
  isCopyOfReadyProgramme,
  onboardingSessionIdPrefix,
  resolveSourceReadyProgrammeId,
  expandRunningIdsWithSources,
} = require('../../src/lib/programmeCopyLink');

/**
 * The reader's own version of a catalog programme, found by either mark.
 *
 * Audit round 4 (2026-09-20): onboarding saved the composed week as a
 * programme of the reader's own and recorded nothing about where it came
 * from, so the catalog page kept its buttons pointed at the untouched
 * original — the day editor made a second copy, and "Take this programme"
 * adopted the original beside the copy being trained.
 */
module.exports = [
  {
    name: 'a copy is known by its source link, or by the day ids a composed week carries',
    run() {
      const fork = { id: 'custom_1', sourceTemplateId: 'tpl_strong_starter', sessions: [{ id: 's1' }] };
      const onboardingCopy = {
        id: 'custom_2',
        sessions: [{ id: 'onboarding_tpl_strong_starter_1' }, { id: 'onboarding_tpl_strong_starter_2' }],
      };
      const ownWork = { id: 'custom_3', sessions: [{ id: 'day_1' }] };

      assert.equal(onboardingSessionIdPrefix('tpl_a'), 'onboarding_tpl_a_');
      assert.ok(isCopyOfReadyProgramme(fork, 'tpl_strong_starter'), 'the link says so');
      assert.ok(isCopyOfReadyProgramme(onboardingCopy, 'tpl_strong_starter'), 'an install from before the link still knows');
      assert.ok(!isCopyOfReadyProgramme(ownWork, 'tpl_strong_starter'), 'a programme of their own is not a copy');
      assert.ok(
        !isCopyOfReadyProgramme(
          { id: 'custom_4', sessions: [{ id: 'onboarding_tpl_strong_starter_v2_1' }] },
          'tpl_strong_starter',
        ),
        'a longer id that starts the same way is a different programme',
      );
      // A row that names itself as its own source — the shape a store can
      // reach and nothing rejects — must not answer "you are your own copy",
      // or adopting a programme would resume the thing it was asked about.
      assert.ok(
        !isCopyOfReadyProgramme(
          {
            id: 'tpl_strong_starter',
            sourceTemplateId: 'tpl_strong_starter',
            sessions: [{ id: 'onboarding_tpl_strong_starter_1' }],
          },
          'tpl_strong_starter',
        ),
        'nothing is a copy of itself',
      );

      const templates = [ownWork, onboardingCopy, fork];
      assert.equal(findReadyProgrammeCopyId('tpl_strong_starter', templates), 'custom_2', 'stored order answers when nothing else does');
      assert.equal(findReadyProgrammeCopyId('tpl_other', templates), null);
      // An install from before the link can hold both an onboarding copy and
      // a fork of the same programme. Resuming the one nothing points at
      // would leave two copies of one programme running (review, 2026-09-20).
      assert.equal(
        findReadyProgrammeCopyId('tpl_strong_starter', templates, ['custom_1']),
        'custom_1',
        'the copy the reader is training answers',
      );
      assert.equal(
        findReadyProgrammeCopyId('tpl_strong_starter', templates, ['custom_9']),
        'custom_2',
        'a preference for something that is not a copy changes nothing',
      );
      // Two copies, both preferred, the caller's order deciding: running ids
      // come first and a held one is stored first. Asking each copy whether
      // it was preferred instead read the list as a set, and the held copy
      // won (CI review of #163).
      assert.equal(
        findReadyProgrammeCopyId('tpl_strong_starter', templates, ['custom_1', 'custom_2']),
        'custom_1',
        'the running copy beats the held one however they are stored',
      );

      // A copy nothing points at is a leftover: forgetting a programme drops
      // the plan and leaves the template standing for good. It still means
      // the reader HAS a copy, so the composed week is not the catalog's —
      // but it is not what they are training (CI review of #163).
      assert.equal(
        findHeldReadyProgrammeCopyId('tpl_strong_starter', templates, ['tpl_strong_starter']),
        null,
        'a copy with no plan is not the programme being trained',
      );
      assert.equal(
        findHeldReadyProgrammeCopyId('tpl_strong_starter', templates, ['custom_2', 'custom_1']),
        'custom_2',
        'and the order the caller asks in still decides between two that are held',
      );
      assert.equal(
        findReadyProgrammeCopyId('tpl_strong_starter', templates, []),
        'custom_2',
        'while the question "is there a copy at all" still answers yes',
      );
    },
  },
  {
    name: 'the other direction: which catalog programme this one is, and what counts as already running',
    run() {
      const catalog = ['tpl_strong_starter', 'tpl_home_starter'];
      const onboardingCopy = { id: 'custom_2', sessions: [{ id: 'onboarding_tpl_home_starter_1' }] };
      const fork = { id: 'custom_1', sourceTemplateId: 'tpl_strong_starter', sessions: [] };
      const ghost = { id: 'custom_5', sourceTemplateId: 'tpl_deleted_v0', sessions: [] };
      const templates = [fork, onboardingCopy, ghost];

      assert.equal(resolveSourceReadyProgrammeId(fork, catalog), 'tpl_strong_starter');
      assert.equal(resolveSourceReadyProgrammeId(onboardingCopy, catalog), 'tpl_home_starter');
      assert.equal(resolveSourceReadyProgrammeId(ghost, catalog), null, 'a link to a programme the catalog lost names no ghost');

      assert.deepEqual(
        expandRunningIdsWithSources(['custom_2'], templates, catalog),
        ['custom_2', 'tpl_home_starter'],
        'running the copy is running the programme',
      );
      assert.deepEqual(
        expandRunningIdsWithSources(['tpl_strong_starter', 'custom_1'], templates, catalog),
        ['tpl_strong_starter', 'custom_1'],
        'no id is named twice',
      );
      assert.deepEqual(expandRunningIdsWithSources([], templates, catalog), []);
    },
  },
];
