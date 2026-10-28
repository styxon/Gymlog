const assert = require('node:assert/strict');
const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');
const { buildAiCoachBodyState, buildAiCoachGoals } = require('../../src/lib/aiTrainingContext');
const { buildAiCoachSystemContext } = require('../../src/lib/aiCoachSystemContext');
const { normalizeAiCoachTrainingContext } = require('../../src/lib/aiTrainingContext');

const NOW = new Date('2026-08-24T12:00:00.000Z');

function weightEntry(daysAgo, weight) {
  return {
    id: `bw-${daysAgo}`,
    recordedAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    weight,
  };
}

module.exports = [
  {
    name: 'aiCoachBody: weight trend needs two weigh-ins inside the window',
    run() {
      const single = buildAiCoachBodyState([weightEntry(2, 82.4)], [], NOW);
      assert.equal(single.weightKg, 82.4);
      assert.equal(single.weightChange30d, null, 'one weigh-in is a fact, not a direction');

      const trending = buildAiCoachBodyState(
        [weightEntry(28, 84.0), weightEntry(14, 83.1), weightEntry(2, 82.4)],
        [],
        NOW,
      );
      assert.equal(trending.weightChange30d.deltaKg, -1.6);
      assert.equal(trending.weightChange30d.spanDays, 26);
      // 90d window sees the same three entries — same span, not a longer story.
      assert.equal(trending.weightChange90d.spanDays, 26);
    },
  },
  {
    name: 'aiCoachBody: measurements carry latest and previous per site; empty record is null',
    run() {
      assert.equal(buildAiCoachBodyState([], [], NOW), null);

      const body = buildAiCoachBodyState(
        [],
        [
          { id: 'm1', kind: 'chest', recordedAt: '2026-07-12T08:00:00.000Z', value: 96.5, unit: 'cm' },
          { id: 'm2', kind: 'chest', recordedAt: '2026-08-20T08:00:00.000Z', value: 98, unit: 'cm' },
          { id: 'm3', kind: 'waist', recordedAt: '2026-08-20T08:00:00.000Z', value: 84, unit: 'cm' },
        ],
        NOW,
      );
      const chest = body.measurements.find((entry) => entry.kind === 'chest');
      assert.equal(chest.latestValue, 98);
      assert.equal(chest.previousValue, 96.5);
      assert.equal(chest.previousAt, '2026-07-12');
      const waist = body.measurements.find((entry) => entry.kind === 'waist');
      assert.equal(waist.previousValue, null);
    },
  },
  {
    name: 'aiCoachGoals: stated goal resolves current value; onboarding weight goal fills in but never doubles',
    run() {
      const body = buildAiCoachBodyState(
        [weightEntry(2, 82.4)],
        [{ id: 'm2', kind: 'chest', recordedAt: '2026-08-20T08:00:00.000Z', value: 98, unit: 'cm' }],
        NOW,
      );
      const stated = {
        id: 'g1',
        text: 'yritän kasvattaa rinnanympärystä',
        kind: 'chest',
        targetValue: 104,
        unit: 'cm',
        startValue: 96.5,
        createdAt: '2026-08-24T06:00:00.000Z',
      };
      const goals = buildAiCoachGoals([stated], 78, body);
      assert.equal(goals.length, 2);
      assert.equal(goals[0].currentValue, 98, 'chest goal reads current chest from the body record');
      assert.equal(goals[1].kind, 'bodyweight');
      assert.equal(goals[1].targetValue, 78);
      assert.equal(goals[1].currentValue, 82.4);

      const statedWeight = { ...stated, id: 'g2', text: 'haluan laskea painoa', kind: 'bodyweight', targetValue: 79, unit: 'kg' };
      const noDouble = buildAiCoachGoals([statedWeight], 78, body);
      assert.equal(noDouble.length, 1, 'the user-stated bodyweight goal wins over the onboarding one');
      assert.equal(noDouble[0].targetValue, 79);
    },
  },
  {
    name: 'aiCoachGoals: exactly one goal leads, and a stale id does not leave the list headless',
    run() {
      const body = buildAiCoachBodyState([weightEntry(2, 82.4)], [], NOW);
      const older = {
        id: 'g-old',
        text: 'pudota rasvaa',
        kind: 'bodyweight',
        targetValue: 78,
        unit: 'kg',
        startValue: 84,
        createdAt: '2026-08-01T06:00:00.000Z',
      };
      const newer = {
        id: 'g-new',
        text: 'kasvata rinnanympärystä',
        kind: 'chest',
        targetValue: 104,
        unit: 'cm',
        startValue: 96.5,
        createdAt: '2026-08-24T06:00:00.000Z',
      };

      const chosen = buildAiCoachGoals([older, newer], null, body, 'g-old');
      assert.deepEqual(
        chosen.map((goal) => goal.isPrimary),
        [true, false],
        'the stored choice leads even when it is not the newest',
      );

      // A goal can be replaced (one per kind), which retires its id. The list
      // must still have a head, or every answer is measured against nothing.
      const stale = buildAiCoachGoals([older, newer], null, body, 'g-deleted');
      assert.deepEqual(
        stale.map((goal) => goal.isPrimary),
        [false, true],
        'a stale id falls back to the most recently stated goal',
      );

      const none = buildAiCoachGoals([older, newer], null, body, null);
      assert.equal(none.filter((goal) => goal.isPrimary).length, 1, 'never two heads, never none');

      // The onboarding number is a tapped field, not a spoken goal: it leads
      // only when nothing was ever said to the coach.
      const withOnboarding = buildAiCoachGoals([newer], 78, body, null);
      assert.deepEqual(
        withOnboarding.map((goal) => goal.isPrimary),
        [true, false],
        'a stated goal outranks the onboarding bodyweight target',
      );
      assert.equal(buildAiCoachGoals([], 78, body, null)[0].isPrimary, true, 'alone, it leads');
    },
  },
  {
    name: 'aiCoachSystemContext: body and goals render as sections; a normalized bare context omits them',
    run() {
      const body = buildAiCoachBodyState(
        [weightEntry(28, 84.0), weightEntry(2, 82.4)],
        [
          { id: 'm1', kind: 'chest', recordedAt: '2026-07-12T08:00:00.000Z', value: 96.5, unit: 'cm' },
          { id: 'm2', kind: 'chest', recordedAt: '2026-08-20T08:00:00.000Z', value: 98, unit: 'cm' },
        ],
        NOW,
      );
      const context = normalizeAiCoachTrainingContext({
        body,
        goals: buildAiCoachGoals(
          [{ id: 'g1', text: 'yritän kasvattaa rinnanympärystä', kind: 'chest', targetValue: 104, unit: 'cm', startValue: 96.5, createdAt: '2026-08-24T06:00:00.000Z' }],
          null,
          body,
        ),
        profile: { heightCm: 181, age: 29, gender: 'male' },
      });
      const text = buildAiCoachSystemContext(context);
      assert.ok(text.includes('## Body record'), 'body section present');
      assert.ok(text.includes('82.4 kg'), 'latest weight rendered');
      assert.ok(text.includes('-1.6 kg over last 26 days'), 'trend rendered');
      assert.ok(text.includes('chest: 98 cm (2026-08-20) | previous 96.5 cm (2026-07-12)'), 'measurement trend rendered');
      assert.ok(text.includes('## Goals'), 'goals section present');
      assert.ok(text.includes('start 96.5 cm, now 98 cm, target 104 cm'), 'goal progress rendered');
      assert.ok(text.includes('## Profile'), 'profile section present');
      assert.ok(text.includes('181 cm'));

      // The flag only exists if it reaches the text — the model reads this
      // rendering, never the object.
      assert.ok(text.includes('[primary] "yritän kasvattaa rinnanympärystä"'), 'the leading goal is marked in the prompt');

      const bare = buildAiCoachSystemContext(normalizeAiCoachTrainingContext({}));
      assert.ok(!bare.includes('## Body record'), 'no body section without a record');
      assert.ok(!bare.includes('## Goals'), 'no goals section without goals');
    },
  },
  {
    name: 'the reading note tells the coach how firmly it may speak',
    run() {
      const note = (history) =>
        buildAiCoachSystemContext(normalizeAiCoachTrainingContext({ history }));
      const sessions = (count, everyDays) =>
        Array.from({ length: count }, (_, index) => ({
          sessionId: `s${index}`,
          performedAt: new Date(2026, 5, 1 + index * everyDays).toISOString(),
        }));

      const thin = note({ sessionCount: 2, sessions: sessions(2, 3), windowDays: 56 });
      assert.ok(thin.includes('not a trend'), 'a short record is named as one');

      const middling = note({ sessionCount: 6, sessions: sessions(6, 4), windowDays: 56 });
      assert.ok(middling.includes('enough to read a direction'), 'a medium record gets one qualification');
      assert.ok(!middling.includes('not a trend'));

      const long = note({ sessionCount: 16, sessions: sessions(16, 3), windowDays: 56 });
      assert.ok(long.includes('Do not hedge'), 'a long record is stated plainly');
    },
  },
  {
    name: 'aiCoachGoals: a payload from an app that predates the primary flag still gets a head',
    run() {
      // Installed apps keep sending the old shape until the reader updates,
      // and the rules promise the model that exactly one goal leads.
      const legacy = normalizeAiCoachTrainingContext({
        goals: [
          { text: 'pudota rasvaa', kind: 'bodyweight', targetValue: 78, unit: 'kg', startValue: 84, currentValue: 82, setAt: '2026-08-01' },
          { text: 'kasvata rinnanympärystä', kind: 'chest', targetValue: 104, unit: 'cm', startValue: 96.5, currentValue: 98, setAt: '2026-08-24' },
        ],
      });
      assert.deepEqual(
        legacy.goals.map((goal) => goal.isPrimary),
        [false, true],
        'the newest goal leads when the client said nothing about it',
      );

      // A payload that does carry the flag is left exactly as it came.
      const current = normalizeAiCoachTrainingContext({
        goals: [
          { text: 'a', kind: null, targetValue: null, unit: null, startValue: null, currentValue: null, setAt: null, isPrimary: true },
          { text: 'b', kind: null, targetValue: null, unit: null, startValue: null, currentValue: null, setAt: null, isPrimary: false },
        ],
      });
      assert.deepEqual(current.goals.map((goal) => goal.isPrimary), [true, false]);
    },
  },
  {
    name: 'aiCoachBody: the dates are the reader’s days, not UTC’s',
    run() {
      // Under Helsinki's clock, so the assertion is not vacuous on a UTC
      // runner where the two dates are the same string either way.
      withHelsinkiClocks(() => {
        // Half past midnight in Helsinki is 21:30 the previous day in UTC, so
        // slicing the ISO string told the reader they last weighed in
        // yesterday — and dated the change it was reading from (2026-09-16).
        const justAfterMidnight = new Date(2026, 8, 16, 0, 30, 0, 0);
        assert.equal(justAfterMidnight.toISOString().slice(0, 10), '2026-09-15', 'the UTC date is the day before');
        const earlier = new Date(2026, 8, 2, 7, 0, 0, 0);
        const body = buildAiCoachBodyState(
          [
            { id: 'bw-1', recordedAt: earlier.toISOString(), weight: 84 },
            { id: 'bw-2', recordedAt: justAfterMidnight.toISOString(), weight: 82.4 },
          ],
          [
            { id: 'm-1', recordedAt: justAfterMidnight.toISOString(), kind: 'chest', value: 104, unit: 'cm' },
            { id: 'm-0', recordedAt: earlier.toISOString(), kind: 'chest', value: 102, unit: 'cm' },
          ],
          new Date(2026, 8, 16, 9, 0, 0, 0),
        );
        assert.equal(body.weightAt, '2026-09-16');
        assert.equal(body.measurements[0].latestAt, '2026-09-16');

        // A goal set just after local midnight is dated the day it was set.
        const goals = buildAiCoachGoals(
          [{ id: 'g1', text: 'chest 110 cm', kind: 'chest', targetValue: 110, unit: 'cm', startValue: 104, createdAt: justAfterMidnight.toISOString() }],
          null,
          body,
        );
        assert.equal(goals[0].setAt, '2026-09-16');
      });
    },
  },
];
