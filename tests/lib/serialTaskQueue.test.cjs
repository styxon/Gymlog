const assert = require('node:assert/strict');

const { createSerialTaskQueue } = require('../../src/lib/serialTaskQueue');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = [
  {
    name: 'serialTaskQueue: concurrent read-modify-write cannot lose an update',
    async run() {
      // The exact shape of the onboarding bug: a whole-database blob, two
      // mutations each snapshotting it, mutating one field and writing the
      // whole thing back. Unserialized, the slower write erases the faster
      // one's field.
      const runExclusive = createSerialTaskQueue();
      let blob = { templates: [], plans: [] };

      const addTemplate = runExclusive(async () => {
        const snapshot = blob;
        await delay(20);
        blob = { ...snapshot, templates: [...snapshot.templates, 'template'] };
      });
      const addPlan = runExclusive(async () => {
        const snapshot = blob;
        await delay(5);
        blob = { ...snapshot, plans: [...snapshot.plans, 'plan'] };
      });

      await Promise.all([addTemplate, addPlan]);
      assert.deepEqual(blob, { templates: ['template'], plans: ['plan'] });
    },
  },
  {
    name: 'serialTaskQueue: tasks run in submission order',
    async run() {
      const runExclusive = createSerialTaskQueue();
      const order = [];

      await Promise.all([
        runExclusive(async () => {
          await delay(15);
          order.push('first');
        }),
        runExclusive(async () => {
          await delay(1);
          order.push('second');
        }),
        runExclusive(() => {
          order.push('third');
        }),
      ]);

      assert.deepEqual(order, ['first', 'second', 'third']);
    },
  },
  {
    name: 'serialTaskQueue: a failing task rejects its caller but not the queue',
    async run() {
      const runExclusive = createSerialTaskQueue();

      await assert.rejects(
        runExclusive(() => {
          throw new Error('boom');
        }),
        /boom/,
      );

      // The queue must keep serving after the failure.
      const value = await runExclusive(() => 'still alive');
      assert.equal(value, 'still alive');
    },
  },
  {
    name: 'serialTaskQueue: return values flow through to the caller',
    async run() {
      const runExclusive = createSerialTaskQueue();
      const id = await runExclusive(async () => {
        await delay(1);
        return 'workout_123';
      });
      assert.equal(id, 'workout_123');
    },
  },
];
