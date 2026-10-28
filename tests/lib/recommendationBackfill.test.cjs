const assert = require('node:assert/strict');

const { backfillRecommendations } = require('../../src/lib/recommendationBackfill');

function tpl(id, goalType, level, daysPerWeek) {
  return { id, goalType, level, daysPerWeek, name: id, sessions: [] };
}

// One goal family at three levels, plus a neighbour on a different goal that
// happens to train the same number of days.
const CATALOG = [
  tpl('easy', 'strength', 'beginner', 3),
  tpl('mid', 'strength', 'intermediate', 3),
  tpl('mid_split', 'strength', 'intermediate', 4),
  tpl('hard', 'strength', 'advanced', 4),
  tpl('other', 'hypertrophy', 'intermediate', 3),
];

const PICKS = [
  { templateId: 'easy', whyKey: 'programs.why.primary' },
  { templateId: 'mid', whyKey: 'programs.why.alternative' },
];

const base = { picks: PICKS, adoptedIds: [], anchor: null, catalog: CATALOG, limit: 2 };

module.exports = [
  {
    name: 'with nothing adopted the questionnaire keeps both slots',
    run() {
      assert.deepEqual(backfillRecommendations(base), PICKS);
    },
  },
  {
    // The row recommended a programme the reader was already training, next to
    // a card saying "valittu sinulle" for something they had chosen weeks ago.
    name: 'a programme you already run leaves the row',
    run() {
      const rows = backfillRecommendations({
        ...base,
        adoptedIds: ['easy'],
        anchor: CATALOG[0],
      });
      assert.equal(rows.length, 2);
      assert.ok(!rows.some((row) => row.templateId === 'easy'), 'the adopted one is still offered');
      assert.equal(rows[0].templateId, 'mid', 'the surviving pick keeps its place');
    },
  },
  {
    // "A bit harder" is the first reason the ranker reaches for, so a reader
    // running the beginner block is offered the intermediate one.
    name: 'the replacement is a step up from what is being trained now',
    run() {
      const rows = backfillRecommendations({
        ...base,
        picks: [PICKS[0]],
        adoptedIds: ['easy'],
        anchor: CATALOG[0],
        limit: 1,
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].templateId, 'mid');
      assert.equal(rows[0].whyKey, 'programs.affinity.nextLevel');
    },
  },
  {
    // The gap has to actually close: the ranker's first matches are often
    // already in the row or already adopted, and asking it for exactly the
    // shortfall would leave the hole it was called to fill.
    name: 'the row refills past matches that are already spoken for',
    run() {
      const rows = backfillRecommendations({
        ...base,
        adoptedIds: ['easy', 'mid'],
        anchor: CATALOG[1],
        limit: 2,
      });
      assert.equal(rows.length, 2);
      assert.ok(!rows.some((row) => ['easy', 'mid'].includes(row.templateId)));
      assert.equal(new Set(rows.map((row) => row.templateId)).size, 2, 'a card is repeated');
    },
  },
  {
    // Nothing to step up from means nothing to say. A row that guessed would
    // be recommending the catalog in its own order and calling it "for you".
    name: 'with no active programme the row shrinks rather than guessing',
    run() {
      const rows = backfillRecommendations({ ...base, adoptedIds: ['easy'], anchor: null });
      assert.deepEqual(rows.map((row) => row.templateId), ['mid']);
      assert.deepEqual(
        backfillRecommendations({ ...base, adoptedIds: ['easy', 'mid'], anchor: null }),
        [],
      );
    },
  },
  {
    // Same inputs, same row. Nothing here is random, and a card that moved on
    // its own would read as a bug.
    name: 'the row is stable and never repeats a programme',
    run() {
      const input = { ...base, adoptedIds: ['easy'], anchor: CATALOG[0], limit: 4 };
      const first = backfillRecommendations(input);
      assert.deepEqual(backfillRecommendations(input), first);
      assert.equal(new Set(first.map((row) => row.templateId)).size, first.length);
    },
  },
];
