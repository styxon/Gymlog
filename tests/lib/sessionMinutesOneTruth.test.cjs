const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { readyTemplateCardMinutes } = require('../../.test-dist/lib/programmeMinutes.js');
const { buildReadyProgramDetail, readyProgramSessionMinutes } = require('../../.test-dist/lib/programDetails.js');
const {
  buildReadyDiscoveryItem,
  filterReadyDiscoveryItems,
  getReadyProgramTimeBucket,
} = require('../../.test-dist/lib/workoutDiscovery.js');
const { getReadyProgramContent } = require('../../.test-dist/lib/readyProgramContent.js');
const { evaluateWorkoutContentFit } = require('../../.test-dist/lib/workoutContentFit.js');

const ROOT = path.join(__dirname, '..', '..');

// B14 (bug hunt 2026-10-05): the catalog's hand-written `estimatedSessionDuration`
// was 10+ minutes off the Programs card on 43 of 68 programmes, and four
// surfaces still read it: the plans screen, the session guidance, the time
// filter and the content-fit signal. One truth now: the card's estimate.
const GEAR_CASES = [{}, { availableEquipment: null }, { availableEquipment: [] }, { availableEquipment: ['Dumbbells', 'Bench'] }];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

module.exports = [
  {
    name: 'session minutes: every surface of a ready programme quotes the Programs card number',
    run() {
      const disagreements = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const options of GEAR_CASES) {
          const card = readyTemplateCardMinutes(template, options);
          const surfaces = {};

          // The programme page: badge, and every session's guidance line.
          surfaces.pageHelper = readyProgramSessionMinutes(template, null, options);
          const detail = buildReadyProgramDetail(template, undefined, null, [], null, 'en', false, false, options);
          surfaces.pageBadge = detail.badges[3];
          for (const session of detail.sessions) {
            surfaces[`guidance:${session.id}`] = session.guidance?.estimatedDuration;
          }

          // The plans screen builds its items with this, prints item.minutes
          // and filters by it.
          surfaces.plansScreen = buildReadyDiscoveryItem(template, getReadyProgramContent(template.id), options).minutes;

          // The recommender's "over N minutes" signal, costed with the same
          // gear (review 2026-10-07: it costed the ungeared template).
          surfaces.contentFit = evaluateWorkoutContentFit(template.id, {
            goalType: 'fat_loss',
            setupContext: 'full_gym',
            availableEquipment: options.availableEquipment,
          }).signals.averageSessionMinutes;

          for (const [surface, value] of Object.entries(surfaces)) {
            const expected = typeof value === 'string' ? `${card} min` : card;
            if (value !== expected) {
              disagreements.push(`${template.id} ${JSON.stringify(options)} ${surface}: ${value}, card ${card}`);
            }
          }
        }
      }
      assert.deepEqual(disagreements, []);

      // And the recommender hands content-fit the reader's gear, or the
      // signal is costed ungeared whatever content-fit can do with it.
      const scoring = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'recommendationScoring.ts'), 'utf8');
      assert.match(scoring, /evaluateWorkoutContentFit\([^)]*availableEquipment: input\.availableEquipment/);
    },
  },
  {
    name: 'session minutes: the time filter buckets by the card number, not the hand-written one',
    run() {
      const wrong = [];
      let handWrittenDisagrees = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        const card = readyTemplateCardMinutes(template);
        if (getReadyProgramTimeBucket(card) !== getReadyProgramTimeBucket(template.estimatedSessionDuration)) {
          handWrittenDisagrees += 1;
        }
        const item = { template, content: null, minutes: card };
        for (const time of ['short', 'balanced', 'long']) {
          const passes = filterReadyDiscoveryItems([item], {
            query: '',
            goal: 'all',
            level: 'all',
            time,
            equipment: 'all',
          }).length === 1;
          if (passes !== (getReadyProgramTimeBucket(card) === time)) {
            wrong.push(`${template.id} ${time}: card ${card} min`);
          }
        }
      }
      assert.deepEqual(wrong, []);
      // Not vacuous: the old field really would have put programmes in the wrong bucket.
      assert.ok(handWrittenDisagrees > 0, 'the hand-written field no longer disagrees; the test proves nothing');
    },
  },
  {
    name: 'session minutes: the page quotes the composed week when it is the reader\'s plan',
    run() {
      const template = WORKOUT_TEMPLATES_V1[0];
      const composedWeek = { days: template.daysPerWeek, sessionMinutes: 25, sessions: template.sessions };
      assert.equal(readyProgramSessionMinutes(template, composedWeek, {}), 25);
      const detail = buildReadyProgramDetail(template, undefined, null, [], composedWeek, 'en');
      assert.equal(detail.badges[3], '25 min');
      for (const session of detail.sessions) {
        assert.equal(session.guidance.estimatedDuration, '25 min', session.id);
      }
    },
  },
  {
    name: 'session minutes: no screen or lib quotes the catalog\'s hand-written estimatedSessionDuration',
    run() {
      // Only the card's own fallback for a programme with nothing to time, and
      // the two composers' fallbacks, may read the field. The plans screen is
      // not compiled for tests, so this guard reads source.
      const allowed = new Set([
        'src/lib/programmeMinutes.ts',
        'src/lib/programDayComposer.ts',
        'src/lib/recommendationProgramme.ts',
        'src/features/workout/workoutTypes.ts',
        'src/features/workout/workoutCatalog.ts',
        'src/features/workout/gainerProgramCatalog.ts',
        // Parameters that carry the page's own minutes under this name.
        'src/lib/firstRunSetup.ts',
        'src/lib/recommendationExplanation.ts',
        'src/lib/readyProgramFit.ts',
        'src/app/renderWorkoutTab.tsx',
        'src/lib/sessionDuration.ts',
      ]);
      const offenders = [];
      const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'App.tsx')];
      for (const file of files) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (allowed.has(rel)) {
          continue;
        }
        // Comments explain the history; only code can read the field.
        const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        if (/\bestimatedSessionDuration\b/.test(source)) {
          offenders.push(rel);
        }
      }
      assert.deepEqual(offenders, []);

      // The allowed readers that matter: only as a zero-estimate fallback.
      const page = fs.readFileSync(path.join(ROOT, 'src/app/renderWorkoutTab.tsx'), 'utf8');
      assert.doesNotMatch(page, /\.estimatedSessionDuration/);

      // The plans screen prints and filters by the item's minutes.
      const screen = fs.readFileSync(path.join(ROOT, 'src/screens/WorkoutsScreen.tsx'), 'utf8');
      assert.match(screen, /\{item\.minutes\} min/);
      assert.match(screen, /buildReadyDiscoveryItem\(/);
    },
  },
];
