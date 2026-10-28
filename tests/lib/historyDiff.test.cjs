const assert = require('node:assert/strict');

const { diffCollection, diffHistory, isHistoryDiffEmpty } = require('../../src/lib/historyDiff');
const { HISTORY_COLLECTIONS } = require('../../src/lib/historyRowCodec');

/**
 * A model of the row store the diff is written for: rows with an `ord`, read
 * back in `ord` order. Applying a diff the way the plan describes (head rows
 * below the smallest ord, tail rows above the largest, renumber on demand)
 * must give the next array, whatever the previous one was.
 */
function storeOf(items) {
  return items.map((item, index) => ({ ord: index, item }));
}

function read(rows) {
  return [...rows].sort((left, right) => left.ord - right.ord).map((row) => row.item);
}

function applyDiff(rows, diff, next) {
  if (diff.kind === 'same') {
    return rows;
  }
  if (diff.kind === 'replace') {
    return storeOf(next);
  }
  let kept = rows.filter((row) => !diff.removed.includes(row.item));
  if (diff.kind === 'renumber') {
    return storeOf(next);
  }
  const min = kept.length ? Math.min(...kept.map((row) => row.ord)) : 0;
  const max = kept.length ? Math.max(...kept.map((row) => row.ord)) : -1;
  kept = [
    ...kept,
    ...diff.head.map((item, index) => ({ ord: min - diff.head.length + index, item })),
    ...diff.tail.map((item, index) => ({ ord: max + 1 + index, item })),
  ];
  return kept;
}

/** A small deterministic generator, so a failure names its seed. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

let nextId = 0;
function row(id) {
  nextId += 1;
  return { id: id ?? `r${nextId}`, n: nextId };
}

module.exports = [
  {
    name: 'historyDiff: a database missing a collection diffs as an empty one',
    run() {
      const { diffHistory } = require('../../src/lib/historyDiff');
      const { HISTORY_COLLECTIONS } = require('../../src/lib/historyRowCodec');
      const row = { id: 'x' };
      const next = {};
      next[HISTORY_COLLECTIONS[0]] = [row];
      const diff = diffHistory({}, next);
      assert.equal(diff[HISTORY_COLLECTIONS[0]].kind, 'renumber');
      assert.deepEqual(diff[HISTORY_COLLECTIONS[0]].added, [row]);
      for (const collection of HISTORY_COLLECTIONS.slice(1)) {
        assert.equal(diff[collection].kind, 'same');
      }
      assert.equal(diffHistory({}, {})[HISTORY_COLLECTIONS[0]].kind, 'same');
      const gone = diffHistory(next, {});
      assert.deepEqual(gone[HISTORY_COLLECTIONS[0]].removed, [row]);
    },
  },
  {
    name: 'historyDiff: the same array, or the same objects in the same order, is no change',
    run() {
      const a = row();
      const b = row();
      const list = [a, b];
      assert.deepEqual(diffCollection(list, list), { kind: 'same' });
      assert.deepEqual(diffCollection(list, [a, b]), { kind: 'same' });
      assert.deepEqual(diffCollection([], []), { kind: 'same' });
    },
  },
  {
    name: 'historyDiff: a prepend and an append are edges, and nothing else is touched',
    run() {
      const a = row();
      const b = row();
      const head = row();
      const tail = row();
      assert.deepEqual(diffCollection([a, b], [head, a, b]), { kind: 'edges', removed: [], head: [head], tail: [] });
      assert.deepEqual(diffCollection([a, b], [a, b, tail]), { kind: 'edges', removed: [], head: [], tail: [tail] });
      assert.deepEqual(diffCollection([a, b], [head, a, b, tail]), { kind: 'edges', removed: [], head: [head], tail: [tail] });
    },
  },
  {
    name: 'historyDiff: an edited row is its old object removed and a new one added in the same place',
    run() {
      const a = row('x');
      const b = row('y');
      const c = row('z');
      const edited = { ...b, note: 'new' };
      const diff = diffCollection([a, b, c], [a, edited, c]);
      // Between two kept rows: the table's order is rewritten.
      assert.equal(diff.kind, 'renumber');
      assert.deepEqual(diff.removed, [b]);
      assert.deepEqual(diff.added, [edited]);
      const edge = diffCollection([a, b, c], [{ ...a, note: 'new' }, b, c]);
      assert.equal(edge.kind, 'edges');
      assert.equal(edge.head.length, 1);
      assert.deepEqual(edge.removed, [a]);
    },
  },
  {
    name: 'historyDiff: kept rows in a new order, or a row between kept ones, renumber',
    run() {
      const a = row();
      const b = row();
      const c = row();
      const inserted = row();
      assert.equal(diffCollection([a, b, c], [c, b, a]).kind, 'renumber');
      assert.equal(diffCollection([a, b, c], [a, inserted, b, c]).kind, 'renumber');
      assert.equal(diffCollection([], [a]).kind, 'renumber');
    },
  },
  {
    name: 'historyDiff: the same object twice in a snapshot cannot be told apart, so the table is replaced',
    run() {
      const a = row();
      assert.equal(diffCollection([a, a], [a]).kind, 'replace');
      assert.equal(diffCollection([a], [a, a]).kind, 'replace');
    },
  },
  {
    name: 'historyDiff: duplicate ids are separate rows, because identity is the object',
    run() {
      const first = { id: 'dup', n: 1 };
      const second = { id: 'dup', n: 2 };
      const diff = diffCollection([first, second], [second]);
      assert.deepEqual(diff, { kind: 'edges', removed: [first], head: [], tail: [] });
    },
  },
  {
    name: 'historyDiff: random edits, applied as a row store would apply them, give the next array every time',
    run() {
      const kinds = new Set();
      for (let seed = 1; seed <= 600; seed += 1) {
        const rand = random(seed);
        const size = Math.floor(rand() * 9);
        const previous = Array.from({ length: size }, () => row(rand() < 0.2 ? 'dup' : undefined));
        let next = [...previous];
        const steps = 1 + Math.floor(rand() * 4);
        for (let step = 0; step < steps; step += 1) {
          const choice = Math.floor(rand() * 6);
          if (choice === 0 && next.length) next.splice(Math.floor(rand() * next.length), 1);
          else if (choice === 1) next = [row(), ...next];
          else if (choice === 2) next = [...next, row()];
          else if (choice === 3) next.splice(Math.floor(rand() * (next.length + 1)), 0, row());
          else if (choice === 4 && next.length) {
            const at = Math.floor(rand() * next.length);
            next[at] = { ...next[at], edited: step };
          } else if (choice === 5) next = [...next].sort(() => rand() - 0.5);
        }
        const diff = diffCollection(previous, next);
        kinds.add(diff.kind);
        const result = read(applyDiff(storeOf(previous), diff, next));
        assert.equal(result.length, next.length, `seed ${seed}: length (${diff.kind})`);
        result.forEach((item, index) => assert.equal(item, next[index], `seed ${seed}: row ${index} (${diff.kind})`));
        if (diff.kind === 'same') {
          assert.equal(previous.length, next.length);
          previous.forEach((item, index) => assert.equal(item, next[index]));
        }
      }
      for (const kind of ['same', 'edges', 'renumber']) {
        assert.ok(kinds.has(kind), `the generator never produced ${kind}`);
      }
    },
  },
  {
    name: 'historyDiff: diffHistory covers the five collections and ignores the rest of the database',
    run() {
      assert.deepEqual([...HISTORY_COLLECTIONS], [
        'workoutSessions',
        'exerciseLogs',
        'bodyweightEntries',
        'measurementEntries',
        'cardioSessions',
      ]);
      const session = row();
      const before = { workoutSessions: [], exerciseLogs: [], bodyweightEntries: [], measurementEntries: [], cardioSessions: [] };
      const after = { ...before, workoutSessions: [session] };
      const diff = diffHistory(before, after);
      assert.equal(isHistoryDiffEmpty(diff), false);
      assert.equal(diff.workoutSessions.kind, 'renumber');
      assert.equal(diff.exerciseLogs.kind, 'same');
      assert.equal(isHistoryDiffEmpty(diffHistory(after, { ...after })), true);
      // A missing collection (an old database in memory) reads as empty.
      assert.equal(isHistoryDiffEmpty(diffHistory({}, before)), true);
    },
  },
  {
    name: 'historyDiff: it is pure (no storage, no React) and does no work at load',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      for (const file of ['historyDiff', 'historyContentHash', 'historyRowCodec']) {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', `${file}.ts`), 'utf8');
        assert.doesNotMatch(source, /from '(react|react-native|@react-native-async-storage\/async-storage)'|\.\.\/storage\//, file);
      }
    },
  },
];
