const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveProgramAffinity, AFFINITY_REASON_KEYS } = require('../../src/lib/programAffinity');
const { PROGRAM_CATEGORIES } = require('../../src/lib/programCategories');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
const {
  READY_PROGRAM_COLLECTIONS,
  UNLISTED_READY_PROGRAMS,
} = require('../../src/lib/readyProgramCollections');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

module.exports = [
  {
    name: 'affinity reads the program you chose, and ranks the better reason first',
    run() {
      const active = { id: 'x', goalType: 'strength', level: 'beginner', daysPerWeek: 3 };
      const catalog = [
        active,
        { id: 'up', goalType: 'strength', level: 'intermediate', daysPerWeek: 4 },
        { id: 'split', goalType: 'strength', level: 'beginner', daysPerWeek: 5 },
        { id: 'light', goalType: 'strength', level: 'advanced', daysPerWeek: 2 },
        { id: 'other', goalType: 'hypertrophy', level: 'beginner', daysPerWeek: 3 },
      ];
      const matches = resolveProgramAffinity(active, catalog, 4);

      // "The same goal one level up" is a better thing to say than "this also
      // runs three days a week", so it is offered first.
      assert.equal(matches[0].templateId, 'up');
      assert.equal(matches[0].reason, 'nextLevel');
      assert.ok(!matches.some((match) => match.templateId === 'x'), 'never itself');
      assert.deepEqual(
        matches.map((match) => match.reason),
        ['nextLevel', 'sameGoalOtherSplit', 'lighterWeek', 'sameDays'],
      );
      assert.equal(matches.length, 4, 'four reasons, four cards, no more');

      // Nothing to read means nothing to claim.
      assert.deepEqual(resolveProgramAffinity(null, catalog), []);
      assert.deepEqual(resolveProgramAffinity(undefined, catalog), []);
    },
  },
  {
    name: 'no two cards say the identical sentence, and every reason speaks before any repeats',
    run() {
      // 21 hypertrophy programs share a goal. Taking matches in catalog order
      // would spend every slot on "same goal, different split" and never reach
      // the level-up card, which is the one worth showing.
      const active = WORKOUT_TEMPLATES_V1.find((template) => template.goalType === 'hypertrophy');
      const matches = resolveProgramAffinity(active, WORKOUT_TEMPLATES_V1, 9);
      assert.ok(matches.length >= 4, `a hypertrophy anchor should fill a row: ${matches.length}`);

      // The device-found fault this guards: two cards side by side carrying
      // the identical sentence, reading as a rendering fault rather than two
      // suggestions. The rule sits on the RENDERED sentence (the row grew
      // past four on user request, 2026-08-25): three of the four sentences
      // interpolate the candidate's days, nextLevel's does not — so its
      // identity is the reason alone and it can appear once, ever.
      const days = new Map(WORKOUT_TEMPLATES_V1.map((template) => [template.id, template.daysPerWeek]));
      const sentences = matches.map((match) =>
        match.reason === 'nextLevel' ? match.reason : `${match.reason}:${days.get(match.templateId)}`,
      );
      assert.equal(new Set(sentences).size, sentences.length, `identical sentence twice: ${sentences}`);
      assert.ok(matches.filter((match) => match.reason === 'nextLevel').length <= 1);

      // Round-robin: every reason that has anything to say gets its first
      // card before any reason gets a second one.
      const present = [...new Set(matches.map((match) => match.reason))];
      const firstRound = matches.slice(0, present.length).map((match) => match.reason);
      assert.equal(new Set(firstRound).size, present.length, `a reason repeated early: ${firstRound}`);

      // Every reason has a sentence in both languages.
      const i18n = read('src', 'lib', 'i18n.ts');
      for (const key of Object.values(AFFINITY_REASON_KEYS)) {
        const hits = i18n.split('\n').filter((line) => line.trim().startsWith(`'${key}':`));
        assert.equal(hits.length, 2, `${key} is missing a language`);
      }
    },
  },
  {
    name: 'every category tile has its own colour and its own glyph',
    run() {
      // The tiles exist so the row can be scanned rather than read. Two
      // categories sharing a tint or a glyph puts that back to reading.
      const inks = new Set(PROGRAM_CATEGORIES.map((entry) => entry.tint.ink));
      assert.equal(inks.size, PROGRAM_CATEGORIES.length, 'two categories share an ink colour');
      const icons = new Set(PROGRAM_CATEGORIES.map((entry) => entry.icon));
      assert.equal(icons.size, PROGRAM_CATEGORIES.length, 'two categories share a glyph');

      for (const entry of PROGRAM_CATEGORIES) {
        for (const value of Object.values(entry.tint)) {
          assert.match(value, /^#[0-9A-F]{6}$/, `${entry.key} has a colour RN cannot parse: ${value}`);
        }
        assert.match(entry.icon, /^M/, `${entry.key} icon is not a path`);
      }
    },
  },
  {
    name: 'every ready programme is either browsable or listed as deliberately not',
    run() {
      // Eighteen programmes were in the catalogue and in no collection, so the
      // onboarding picker showed 37 of 57 — including eleven of the sixteen the
      // welcome screen is hand-curated to advertise. Nothing went red, because
      // absence cost nothing. It costs something now.
      const listed = new Set();
      for (const collection of READY_PROGRAM_COLLECTIONS) {
        for (const id of collection.templateIds) {
          listed.add(id);
        }
      }
      const unlisted = new Set(UNLISTED_READY_PROGRAMS);

      const missing = WORKOUT_TEMPLATES_V1.filter(
        (template) => !listed.has(template.id) && !unlisted.has(template.id),
      ).map((template) => template.name);
      assert.deepEqual(
        missing,
        [],
        'these programmes exist but cannot be found: add them to a collection, or to UNLISTED_READY_PROGRAMS with a reason',
      );

      // The exclusion list may only name programmes that exist, and may not
      // name one that is also in a collection — either would make it a place
      // where a stale id hides rather than a decision anyone can read.
      const ids = new Set(WORKOUT_TEMPLATES_V1.map((template) => template.id));
      for (const id of unlisted) {
        assert.ok(ids.has(id), `UNLISTED_READY_PROGRAMS names ${id}, which is not in the catalogue`);
        assert.ok(!listed.has(id), `${id} is both excluded and in a collection`);
      }
    },
  },
];
