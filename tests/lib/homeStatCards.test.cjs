const assert = require('node:assert/strict');

const {
  buildHomeStatCardCatalog,
  buildHomeStatCards,
  resolveHomeStatCardKeys,
  formatHomeStatRecency,
  formatHomeStatTrend,
  formatHomeStatValue,
  DEFAULT_HOME_STAT_CARD_KEYS,
  TREND_MIN_SPAN_DAYS,
} = require('../../.test-dist/lib/homeStatCards.js');

function createLog(performedAt, weight, reps) {
  return {
    id: `log_${performedAt}`,
    sessionId: `session_${performedAt}`,
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Takakyykky',
    weight,
    repsPerSet: [reps],
    sets: [{ orderIndex: 0, weight, reps, kind: 'working', outcome: 'completed' }],
    tracked: true,
    orderIndex: 0,
    skipped: false,
    performedAt,
    workoutNameSnapshot: 'Leg Day',
  };
}

function createLiftSummary(key, name, points) {
  return {
    key,
    name,
    logs: points.map(([performedAt, weight, reps]) => createLog(performedAt, weight, reps)),
    latestWeight: null,
    previousWeight: null,
    latestReps: '-',
    bestWeight: Math.max(...points.map(([, weight]) => weight), 0) || null,
    bestReps: 0,
  };
}

const EMPTY_SOURCES = { bodyweightEntries: [], measurementEntries: [], trackedProgress: [] };

module.exports = [
  {
    name: 'catalog: body metrics always offered, tracked lifts appended heaviest first with logged names',
    run() {
      const sources = {
        ...EMPTY_SOURCES,
        trackedProgress: [
          createLiftSummary('penkki', 'Penkki', [['2026-07-01T10:00:00', 80, 5]]),
          createLiftSummary('takakyykky', 'Takakyykky', [['2026-07-01T10:00:00', 105, 5]]),
        ],
      };

      const catalog = buildHomeStatCardCatalog(sources);

      // Every measurement Progress tracks, not three of six: the Add sheet
      // used to offer bodyweight, body fat and waist while the measurement
      // screen logged shoulders, chest, hips and thighs too, so a reader who
      // measures their chest could not put that number on Home.
      assert.deepEqual(
        catalog.map((item) => item.key),
        [
          'bodyweight',
          'bodyfat',
          'shoulders',
          'chest',
          // Back joined on 2026-08-31: onboarding let a reader pick it as a
          // focus area and nothing downstream could act on the answer.
          'back',
          // Arms and calves were missing from the model entirely, so the two
          // tape readings a growth trainee takes most often could not be
          // logged anywhere, let alone shown on Home.
          'arms',
          'waist',
          'hips',
          'thighs',
          'calves',
          'lift:takakyykky',
          'lift:penkki',
        ],
      );
      assert.equal(catalog[10].label, 'Takakyykky');
    },
  },
  {
    /**
     * #bugs 2026-09-30: the Add card sheet and the pinned cards printed the
     * library's English names ("Wide-Grip Lat Pulldown", "Barbell Bench Press
     * - Medium Grip") in a Finnish app. The label goes through the same
     * translation every other lift name does; a name the reader typed in
     * Finnish still reads as typed.
     */
    name: 'lift cards are named in the reader\'s language',
    run() {
      const lift = (key, name, weight) => ({ key, name, bestWeight: weight, sessions: [], history: [] });
      const catalog = buildHomeStatCardCatalog(
        {
          bodyweightEntries: [],
          measurementEntries: [],
          trackedProgress: [
            lift('bench', 'Barbell Bench Press - Medium Grip', 60),
            lift('lat', 'Wide-Grip Lat Pulldown', 60),
            lift('takakyykky', 'Takakyykky', 100),
          ],
        },
        'fi',
      );
      const labels = catalog.filter((item) => item.key.startsWith('lift:')).map((item) => item.label);
      assert.deepEqual(labels, ['Takakyykky', 'Penkkipunnerrus', 'Ylätalja']);
      // English stays English.
      const en = buildHomeStatCardCatalog(
        { bodyweightEntries: [], measurementEntries: [], trackedProgress: [lift('lat', 'Wide-Grip Lat Pulldown', 60)] },
        'en',
      );
      assert.equal(en.find((item) => item.key === 'lift:lat').label, 'Lat Pulldown');
    },
  },
  {
    name: 'bodyweight card: series is chronological, capped to 7, previous = second-to-last entry',
    run() {
      const entries = [];
      for (let day = 1; day <= 9; day += 1) {
        entries.push({ id: `bw_${day}`, recordedAt: `2026-07-0${day > 9 ? day : `${day}`.padStart(1, '0')}T08:00:00`, weight: 77 + day * 0.5 });
      }
      // Deliberately shuffled input — the lib must sort by recordedAt.
      const shuffled = [entries[4], entries[0], entries[8], entries[2], entries[6], entries[1], entries[3], entries[5], entries[7]];

      const [card] = buildHomeStatCards(['bodyweight'], { ...EMPTY_SOURCES, bodyweightEntries: shuffled });

      assert.equal(card.series.length, 7);
      assert.equal(card.value, 77 + 9 * 0.5);
      // The result before the latest one: day 8.
      assert.equal(card.previous, 77 + 8 * 0.5);
      assert.equal(card.reps, null);
    },
  },
  {
    name: 'measurement cards: bodyfat and waist filter by kind',
    run() {
      const sources = {
        ...EMPTY_SOURCES,
        measurementEntries: [
          { id: 'm1', kind: 'bodyfat', recordedAt: '2026-07-01T08:00:00', value: 17.2, unit: '%' },
          { id: 'm2', kind: 'waist', recordedAt: '2026-07-02T08:00:00', value: 85, unit: 'cm' },
          { id: 'm3', kind: 'bodyfat', recordedAt: '2026-07-10T08:00:00', value: 15.4, unit: '%' },
        ],
      };

      const cards = buildHomeStatCards(['bodyfat', 'waist'], sources);

      assert.equal(cards[0].value, 15.4);
      assert.equal(cards[0].previous, 17.2);
      assert.equal(cards[1].value, 85);
      assert.equal(cards[1].previous, null); // single point — nothing before it
    },
  },
  {
    name: 'lift card: top-set weights per session, reps from the latest top set',
    run() {
      const sources = {
        ...EMPTY_SOURCES,
        trackedProgress: [
          createLiftSummary('takakyykky', 'Takakyykky', [
            ['2026-07-15T10:00:00', 105, 7],
            ['2026-07-01T10:00:00', 95, 8],
            ['2026-07-08T10:00:00', 100, 6],
          ]),
        ],
      };

      const [card] = buildHomeStatCards(['lift:takakyykky'], sources);

      assert.deepEqual(card.series, [95, 100, 105]);
      assert.equal(card.value, 105);
      assert.equal(card.reps, 7);
      assert.equal(card.previous, 100);
    },
  },
  {
    name: 'pinned card with no data keeps honest nulls instead of an invented trend',
    run() {
      const [card] = buildHomeStatCards(['bodyweight'], EMPTY_SOURCES);

      assert.equal(card.value, null);
      assert.equal(card.previous, null);
      assert.deepEqual(card.series, []);
      assert.equal(formatHomeStatValue(card.value), '—');
    },
  },
  {
    name: 'unknown pinned keys are dropped silently',
    run() {
      const cards = buildHomeStatCards(['bodyweight', 'lift:gone', 'nonsense'], EMPTY_SOURCES);
      assert.deepEqual(
        cards.map((card) => card.key),
        ['bodyweight'],
      );
    },
  },
  {
    name: 'card carries when it was last true, and a weekly rate once a week of calendar backs it',
    run() {
      // Four weigh-ins across two weeks: 80 -> 79.2 is -0.8 kg over 14
      // calendar days = -0.4 per week, regardless of how unevenly the
      // points land inside the window.
      const entries = [
        { id: 'w1', recordedAt: '2026-08-01T08:00:00', weight: 80 },
        { id: 'w2', recordedAt: '2026-08-04T08:00:00', weight: 80.4 },
        { id: 'w3', recordedAt: '2026-08-10T08:00:00', weight: 79.6 },
        { id: 'w4', recordedAt: '2026-08-15T08:00:00', weight: 79.2 },
      ];
      const [card] = buildHomeStatCards(['bodyweight'], { ...EMPTY_SOURCES, bodyweightEntries: entries });

      assert.equal(card.recordedAt, new Date('2026-08-15T08:00:00').getTime());
      assert.equal(Math.round(card.weeklyTrend * 10) / 10, -0.4);
      assert.equal(formatHomeStatTrend(card.weeklyTrend), '\u22120.4 / wk');

      // Rising lift: the sign flips and prints as a plus.
      const sources = {
        ...EMPTY_SOURCES,
        trackedProgress: [
          createLiftSummary('takakyykky', 'Takakyykky', [
            ['2026-08-01T10:00:00', 100, 5],
            ['2026-08-15T10:00:00', 105, 5],
          ]),
        ],
      };
      const [lift] = buildHomeStatCards(['lift:takakyykky'], sources);
      assert.equal(formatHomeStatTrend(lift.weeklyTrend), '+2.5 / wk');
    },
  },
  {
    name: 'no trend from under a week of data - two days projected to "per week" would be a guess',
    run() {
      const entries = [
        { id: 'w1', recordedAt: '2026-08-13T08:00:00', weight: 80 },
        { id: 'w2', recordedAt: '2026-08-15T08:00:00', weight: 79.6 },
      ];
      const [card] = buildHomeStatCards(['bodyweight'], { ...EMPTY_SOURCES, bodyweightEntries: entries });

      // The card still knows when it was last true - only the rate is withheld.
      assert.equal(card.weeklyTrend, null);
      assert.equal(card.recordedAt, new Date('2026-08-15T08:00:00').getTime());

      // Exactly a week apart is the first honest rate.
      const week = [
        { id: 'w1', recordedAt: '2026-08-08T08:00:00', weight: 80 },
        { id: 'w2', recordedAt: `2026-08-${8 + TREND_MIN_SPAN_DAYS}T08:00:00`, weight: 79 },
      ];
      const [weekCard] = buildHomeStatCards(['bodyweight'], { ...EMPTY_SOURCES, bodyweightEntries: week });
      assert.equal(weekCard.weeklyTrend, -1);

      // No entries at all: both stay null.
      const [empty] = buildHomeStatCards(['bodyweight'], EMPTY_SOURCES);
      assert.equal(empty.recordedAt, null);
      assert.equal(empty.weeklyTrend, null);
    },
  },
  {
    name: 'recency reads as a phrase near now and as a date once a phrase would be longer than the truth',
    run() {
      const now = new Date(2026, 7, 30, 21, 0, 0);
      const at = (y, m, d, h = 8) => new Date(y, m, d, h).getTime();

      // Calendar days, not 24-hour blocks: a morning weigh-in read at night
      // is still "today".
      assert.equal(formatHomeStatRecency(at(2026, 7, 30), 'en', now), 'Today');
      assert.equal(formatHomeStatRecency(at(2026, 7, 29, 23), 'en', now), 'Yesterday');
      assert.equal(formatHomeStatRecency(at(2026, 7, 28), 'en', now), '2 days ago');
      assert.equal(formatHomeStatRecency(at(2026, 7, 24), 'en', now), '6 days ago');
      // From the seventh day on, the date itself — never "Last week", which
      // is false for most of days 7–13 (owner, 2026-10-12; dup sweep 13, D2-3).
      assert.equal(formatHomeStatRecency(at(2026, 7, 23), 'en', now), 'Aug 23');
      assert.equal(formatHomeStatRecency(at(2026, 7, 17), 'en', now), 'Aug 17');
      // And the date in the reader's language: an English card read the
      // Finnish "16.8." (D3-5).
      assert.equal(formatHomeStatRecency(at(2026, 7, 16), 'en', now), 'Aug 16');
      assert.equal(formatHomeStatRecency(at(2026, 7, 16), 'fi', now), '16.8.');
      assert.equal(formatHomeStatRecency(at(2026, 7, 23), 'fi', now), '23.8.');

      assert.equal(formatHomeStatRecency(at(2026, 7, 28), 'fi', now), '2 pv sitten');
    },
  },
  {
    name: 'resolveHomeStatCardKeys: null means default, empty array means the user cleared the section',
    run() {
      assert.deepEqual(resolveHomeStatCardKeys(null), DEFAULT_HOME_STAT_CARD_KEYS);
      assert.deepEqual(resolveHomeStatCardKeys([]), []);
      assert.deepEqual(resolveHomeStatCardKeys(['a', 'a', '', 'b']), ['a', 'b']);
    },
  },
];
