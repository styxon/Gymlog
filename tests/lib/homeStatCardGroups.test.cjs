const assert = require('node:assert/strict');

const {
  buildHomeStatCardCatalog,
  groupHomeStatCards,
} = require('../../src/lib/homeStatCards');

const EMPTY = { bodyweightEntries: [], measurementEntries: [], trackedProgress: [] };

function liftSummary(key, name, weight) {
  return {
    key,
    name,
    logs: [],
    latestWeight: null,
    previousWeight: null,
    latestReps: '-',
    bestWeight: weight,
    bestReps: 0,
  };
}

module.exports = [
  {
    name: 'the add sheet is three named groups, in one fixed order',
    run() {
      const catalog = buildHomeStatCardCatalog({
        ...EMPTY,
        trackedProgress: [liftSummary('takakyykky', 'Takakyykky', 105)],
      });
      const groups = groupHomeStatCards(catalog);

      assert.deepEqual(
        groups.map((group) => group.key),
        ['body', 'measurements', 'lifts'],
      );
      assert.deepEqual(
        groups.map((group) => group.labelKey),
        ['cards.group.body', 'cards.group.measurements', 'cards.group.lifts'],
      );

      // Grouped by where the number comes from, which is also where the reader
      // goes to change it: the scale, the tape, or a set they lifted.
      assert.deepEqual(
        groups[0].items.map((item) => item.key),
        ['bodyweight', 'bodyfat'],
      );
      assert.equal(groups[2].items[0].key, 'lift:takakyykky');

      // Every card lands in exactly one group, and none is lost on the way.
      const grouped = groups.flatMap((group) => group.items);
      assert.equal(grouped.length, catalog.length);
      assert.deepEqual(new Set(grouped.map((i) => i.key)).size, catalog.length);
    },
  },
  {
    name: 'the catalogue order survives inside a group',
    run() {
      const groups = groupHomeStatCards(buildHomeStatCardCatalog(EMPTY));
      // The measurement screen's own order, so the two surfaces list the same
      // tape measures the same way round.
      assert.deepEqual(
        groups[1].items.map((item) => item.key),
        ['shoulders', 'chest', 'back', 'arms', 'waist', 'hips', 'thighs', 'calves'],
      );
    },
  },
  {
    name: 'a group with nothing under it never gets a heading',
    run() {
      // A reader who has logged no lifts should not be told there is a Lifts
      // section — an empty heading is a promise the sheet cannot keep.
      const groups = groupHomeStatCards(buildHomeStatCardCatalog(EMPTY));
      assert.deepEqual(
        groups.map((group) => group.key),
        ['body', 'measurements'],
      );

      // And with nothing at all, there is nothing to head.
      assert.deepEqual(groupHomeStatCards([]), []);

      // The sheet groups what is LEFT to add, so a reader who has pinned every
      // body metric sees the remaining groups only.
      const catalog = buildHomeStatCardCatalog(EMPTY);
      const remaining = catalog.filter((item) => item.icon === 'tape');
      assert.deepEqual(
        groupHomeStatCards(remaining).map((group) => group.key),
        ['measurements'],
      );
    },
  },
];
