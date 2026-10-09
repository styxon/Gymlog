const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PROGRAM_CATEGORIES,
  countByCategory,
  filterByCategory,
  isInCategory,
} = require('../../.test-dist/lib/programCategories.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

module.exports = [
  {
    name: 'every category opens something, and every program is reachable',
    run() {
      const counts = countByCategory(WORKOUT_TEMPLATES_V1);
      for (const category of PROGRAM_CATEGORIES) {
        // A tile that says "0" is worse than no tile: it reads as broken.
        assert.ok(counts[category.key] > 0, `${category.key} is empty`);
      }

      // Nothing may be stranded. A program in none of them is one a
      // browsing user can only find by search, which is what these rows exist
      // to replace.
      const reachable = new Set();
      for (const category of PROGRAM_CATEGORIES) {
        for (const template of filterByCategory(WORKOUT_TEMPLATES_V1, category.key)) {
          reachable.add(template.id);
        }
      }
      const stranded = WORKOUT_TEMPLATES_V1.filter((template) => !reachable.has(template.id));
      assert.deepEqual(
        stranded.map((template) => template.name),
        [],
        'these programs are in no category',
      );
    },
  },
  {
    name: 'the hand-listed categories name programs that exist',
    run() {
      // Fat loss cannot be derived — the catalog does not encode "this is a
      // cut" — so it names its members (and mobility and the runner's gym
      // week theirs), which is the id
      // typo trap that has bitten this codebase twice. A wrong id here does
      // not throw; the row is just one program short.
      const ids = new Set(WORKOUT_TEMPLATES_V1.map((template) => template.id));
      const source = read('src', 'lib', 'programCategories.ts');
      // Anchored on the _v1 suffix every catalog id carries: the loose
      // version also matched the 'tpl_focus_' prefix used with startsWith,
      // and reported the prefix as a missing program.
      const listed = source.match(/'tpl_[a-z0-9_]+_v[0-9]+'/g) ?? [];
      assert.ok(listed.length > 0, 'the hand-listed ids should be findable');
      const unknown = [...new Set(listed.map((quoted) => quoted.slice(1, -1)))].filter(
        (id) => !ids.has(id),
      );
      assert.deepEqual(unknown, [], `not in the catalog: ${unknown.join(', ')}`);
    },
  },
  {
    name: 'the conditioning and home tiles list what the sessions hold, not a hand-kept list',
    run() {
      // Both were id lists, and they drifted: "Running & conditioning" held
      // Calisthenics Mastery at 4% conditioning and missed SHRED, Fat Burn
      // HIIT and five more at 25% or over; "Home" missed Fat Burn HIIT, RUN
      // and Mobility Flow (bug hunt, 2026-10-09). The tile now answers what
      // the Cardio chip and the equipment bucket answer, for every programme.
      const { meetsCardioFocus } = require('../../.test-dist/lib/programCatalogFocus.js');
      const { resolveProgramEquipmentBucket } = require('../../.test-dist/lib/programEquipment.js');
      const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog.js');
      const names = (template) => template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
      const RUNNERS = new Set(['tpl_gainer_runners_strength_v1']);
      const drift = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        const conditioning = meetsCardioFocus(template) || RUNNERS.has(template.id);
        if (isInCategory(template, 'conditioning') !== conditioning) {
          drift.push(`${template.name}: conditioning tile ${isInCategory(template, 'conditioning')}, content ${conditioning}`);
        }
        const home = resolveProgramEquipmentBucket(names(template)) === 'low_equipment';
        if (isInCategory(template, 'home') !== home) {
          drift.push(`${template.name}: home tile ${isInCategory(template, 'home')}, gear ${home}`);
        }
        // And the recommender's tier, which sells "nothing in it needs a gym".
        const definition = RECOMMENDATION_PROGRAMS.find((entry) => entry.programId === template.id);
        if (definition && isInCategory(template, 'home') !== (definition.equipmentTier === 'low_equipment')) {
          drift.push(`${template.name}: home tile ${isInCategory(template, 'home')}, recommender ${definition.equipmentTier}`);
        }
      }
      assert.deepEqual(drift, []);

      // The cases the hand lists got wrong, by name.
      const byName = (name) => {
        const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.name === name);
        assert.ok(template, name);
        return template;
      };
      assert.equal(isInCategory(byName('Calisthenics Mastery'), 'conditioning'), false);
      for (const name of ['SHRED', 'Fat Burn HIIT', 'Summer Conditioning', 'FIT Elite', 'Athletic Starter', 'RUN']) {
        assert.equal(isInCategory(byName(name), 'conditioning'), true, name);
      }
      for (const name of ['Fat Burn HIIT', 'RUN', 'Mobility Flow', 'Calisthenics Mastery']) {
        assert.equal(isInCategory(byName(name), 'home'), true, name);
      }
      // A runner's gym week holds no running and stays where runners look.
      assert.equal(isInCategory(byName("Runner's Strength"), 'conditioning'), true);
    },
  },
  {
    name: 'a program may sit in more than one category, and the single-muscle days sit in one',
    run() {
      const byName = (name) => WORKOUT_TEMPLATES_V1.find((template) => template.name === name);

      // Both strength and beginner. Hiding it from one to keep the sets
      // disjoint would make both rows worse.
      const fives = byName('Strength Foundations 5x5');
      assert.ok(fives);
      assert.equal(isInCategory(fives, 'strength'), true);
      assert.equal(isInCategory(fives, 'beginner'), true);

      // A one-day add-on is hypertrophy, but it is not a growth PROGRAM, and
      // putting it in "Muscle" would bury the real ones under six day-cards.
      const chestDay = byName('Chest Day');
      assert.ok(chestDay);
      assert.equal(isInCategory(chestDay, 'focus'), true);
      assert.equal(isInCategory(chestDay, 'muscle'), false);
    },
  },
  {
    name: 'the rail can reach what a tile promises',
    run() {
      const screen = read('src', 'screens', 'ProgramsHomeScreen.tsx');
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();

      // Explore was eight hand-picked ids. A tile saying "Voima 8" filtering
      // that list would open three, so the filtered rail reads the whole
      // catalog instead.
      assert.match(app, /catalogItems=\{programsCatalogItems\}/);
      assert.match(app, /workout\.templates\.map\(\(template\) => \{/);
      assert.match(screen, /categoryMembers\[sheet\.key\]\?\.includes\(item\.id\)/);
      // Counts come from the same source as the filter, so a tile cannot
      // promise a number the rail does not have.
      assert.match(app, /countByCategory\(workout\.templates\)/);
      assert.match(screen, /categoryCounts\[entry\.key\]/);
    },
  },
  {
    name: 'the "for you" row carries a reason per card, and never claims to be AI',
    run() {
      const screen = read('src', 'screens', 'ProgramsHomeScreen.tsx');
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      const i18n = read('src', 'lib', 'i18n.ts');

      // Only the programs the waterfall gives a reason for. The scorer ranks
      // all 55, so a row of five is easy — and three of them would arrive with
      // no "why", which is the thing this app keeps refusing to ship.
      assert.match(app, /waterfall\.whyPrimary/);
      assert.match(app, /waterfall\.whyAlternative/);
      assert.match(app, /entry\.templateId && entry\.whyKey/);
      // The reason moved to the program's own screen, where it has room to
      // say why in a sentence. On a 186px card it was a fragment competing
      // with the numbers above it. The card now carries the boost anatomy
      // instead of a link: name, what it is, two facts, and the one number
      // worth comparing across cards.
      assert.match(screen, /styles\.recFootValue/);
      assert.match(screen, /LEVEL_LABEL_KEYS\[item\.level\]/);
      assert.match(screen, /'programs\.weeksShort'/);
      assert.match(app, /AFFINITY_REASON_KEYS\[match\.reason\]/);

      // No questionnaire is no longer an empty row. Choosing a ready program
      // off the catalog is a statement of intent every bit as strong as
      // answering a form, and it is more recent — the old row was permanently
      // empty for exactly the people who had already told us what they want.
      //
      // And a programme you HAVE chosen leaves the row: the questionnaire's
      // two picks used to stay forever, so the tab kept recommending what the
      // reader was already training. The gap refills from the catalog,
      // measured from the active programme, and the ranker's first reason is
      // "same goal, one level up".
      assert.match(app, /backfillRecommendations\(\{/);
      // Under the running set expanded with the catalog programmes those
      // running programmes are copies of: the row dropped what was adopted by
      // template id, and a copy carries a new one, so the questionnaire's own
      // pick kept being recommended to the reader training it (audit round 4).
      assert.match(app, /adoptedIds: expandRunningIdsWithSources\(\s*activeProgramTemplateIds,/);
      // Six cards (user asked for a fuller row, 2026-08-25) — but only ever
      // filled with reasoned matches, so the constant is the CAP, not a
      // padding target: with no anchor the row still shrinks to the picks.
      assert.match(app, /limit: 6/);
      assert.match(screen, /recommendations\.length > 0 \? \(/);

      // Never labelled AI. The model is never used to pick a programme — it
      // is recommendationScoring plus a waterfall. The AI info page that once
      // said so in copy (aiInfo.never.2) is gone, and its keys went with it on
      // 2026-09-08, so this check and the code comments are where the rule
      // lives now.
      const forYou = screen.slice(screen.indexOf("'programs.forYou'"), screen.indexOf(String.raw`The old "Vaihda ohjelmaa" rail lived here`));
      assert.ok(forYou.length > 200 && forYou.length < 4000, `the row span went wrong: ${forYou.length} chars`);
      assert.doesNotMatch(forYou, /AI/, 'the recommendation row must not claim to be AI');
      // No lead copy anywhere on this page. A row that works does not need a
      // sentence saying it works, and the reference has none — explaining a
      // tile row that already shows a count under its label tells the reader
      // only that the designer did not trust it.
      for (const key of ['programs.browse.lead', 'programs.forYou.lead', 'programs.season.winterLead']) {
        assert.doesNotMatch(i18n, new RegExp(`'${key.replace(/\./g, '\.')}':`), `${key} came back`);
      }
      // Zero now, not one. The last of them was the targets empty state, which
      // became a card with a title and a button on 2026-09-01 — a sentence
      // under a heading read as a caption rather than as something to do.
      assert.equal(
        (screen.match(/styles\.seasonLead/g) ?? []).length,
        0,
        'lead copy is back on this page',
      );
    },
  },
];
