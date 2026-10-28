const assert = require('node:assert/strict');

const {
  buildCoachContextChips,
  buildCoachContextReadout,
  buildCoachOpeningLine,
  buildCoachNoticed,
  buildCoachOpeningRows,
  buildCoachOpeningOffer,
} = require('../../src/lib/coachChat');

function row(overrides) {
  return {
    key: 'squat',
    tone: 'green',
    name: 'Squat',
    status: 'Improving',
    meta: '+5 kg in 4 weeks',
    bars: [0.4, 0.6, 0.8],
    locked: null,
    ...overrides,
  };
}

const STALLED = row({ key: 'squat', tone: 'amber', status: 'Stalled', meta: 'Same top set × 4', locked: { teaser: 'One fix', body: 'Hold the weight and cut one set.' } });
const IMPROVING = row({ key: 'bench', name: 'Bench press', tone: 'green', status: 'Improving' });
const RECOVERY = row({ key: 'recovery', name: 'Recovery', tone: 'red', status: 'Running low', meta: '6 sessions in 7 days', locked: { teaser: 'Why', body: 'Too much this week.' } });

function intro(overrides) {
  return { todaySessionTitle: null, sessionsThisWeek: 0, weeklyRead: [], fatigue: null, ...overrides };
}

module.exports = [
  {
    name: 'coachChat: the context strip states facts and stays empty without any',
    run() {
      assert.deepEqual(buildCoachContextChips(intro({}), 'en'), [], 'a fresh user gets no invented status');

      const chips = buildCoachContextChips(
        intro({ todaySessionTitle: 'Push A', weeklyRead: [STALLED, RECOVERY] }),
        'en',
      );
      assert.equal(chips.length, 3);
      assert.equal(chips[0].label, 'Push A today');
      assert.equal(chips[0].tone, 'plan');
      assert.equal(chips[1].label, 'Squat · Stalled');
      assert.equal(chips[2].label, 'Recovery · Running low');
    },
  },
  {
    name: 'coachChat: a healthy recovery row is not worth a chip',
    run() {
      const chips = buildCoachContextChips(
        intro({ weeklyRead: [row({ key: 'recovery', name: 'Recovery', tone: 'green', status: 'On track' })] }),
        'en',
      );
      assert.equal(chips.length, 0);
    },
  },
  {
    name: 'coachChat: the strip never grows past three chips',
    run() {
      const chips = buildCoachContextChips(
        intro({ todaySessionTitle: 'Push A', weeklyRead: [STALLED, RECOVERY, IMPROVING] }),
        'en',
      );
      assert.ok(chips.length <= 3);
    },
  },
  {
    name: 'coachChat: the opening line names what it can see, and admits when it cannot',
    run() {
      assert.match(
        buildCoachOpeningLine(intro({ todaySessionTitle: 'Push A', sessionsThisWeek: 3, weeklyRead: [STALLED] }), 'en'),
        /3× this week[\s\S]*squat[\s\S]*Push A/,
      );
      assert.match(buildCoachOpeningLine(intro({ weeklyRead: [STALLED] }), 'en'), /squat has not moved/);
      assert.match(buildCoachOpeningLine(intro({ todaySessionTitle: 'Push A' }), 'en'), /Push A is on the plan/);
      assert.match(buildCoachOpeningLine(intro({ sessionsThisWeek: 2 }), 'en'), /2 sessions logged/);
      // Nothing logged: it says so instead of claiming a trend.
      assert.match(buildCoachOpeningLine(intro({}), 'en'), /Log a session/);
    },
  },
  {
    name: 'coachChat: Pro opens with problems first, then earned progress, capped at two',
    run() {
      const items = buildCoachNoticed([IMPROVING, STALLED, RECOVERY], 'en');
      assert.equal(items.length, 2);
      // Amber and red outrank a green row even when green comes first.
      assert.equal(items[0].key, 'squat');
      assert.equal(items[1].key, 'recovery');
      // The body is the real conclusion, not the headline again.
      assert.equal(items[0].body, 'Hold the weight and cut one set.');
      assert.match(items[0].question, /squat/);
    },
  },
  {
    name: 'coachChat: a green-only week still gets an opener',
    run() {
      const items = buildCoachNoticed([IMPROVING], 'en');
      assert.equal(items.length, 1);
      assert.equal(items[0].tone, 'plan');
      assert.equal(items[0].body, '+5 kg in 4 weeks');
    },
  },
  {
    name: 'coachChat: nothing logged means nothing claimed',
    run() {
      assert.deepEqual(buildCoachNoticed([], 'en'), []);
    },
  },
  {
    name: 'coachChat: the last-session row names the session in the reader\'s language',
    run() {
      // Seen on a phone: "Rintavoima · Amateur - Day 2: Deadlift & Press"
      // under a Finnish "Viime treeni" label, beside a lift row that had
      // already translated its lift. The stored name is the catalog's English;
      // the row now runs it through the same localiser History uses.
      const context = {
        unitPreference: 'kg',
        activeSession: null,
        recentCompletedSessions: [
          {
            sessionId: 's1',
            title: 'Rintavoima · Amateur - Day 2: Deadlift & Press',
            performedAt: '2026-08-18T09:00:00.000Z',
            durationMinutes: 20,
            setsCompleted: 1,
            swappedExercises: 0,
            noteCount: 0,
          },
        ],
        trackedLifts: [],
        latestTopSets: [],
        sessionsThisWeek: 1,
        sessionsLast30Days: 0,
        rhythm: [],
        readyProgramCount: 0,
      };
      const rows = buildCoachContextReadout(context, 'fi');
      const last = rows.find((row) => row.key === 'lastSession');
      assert.ok(last);
      // "ja", not "&": Finnish spells the conjunction out, and the session
      // names decomposed on the ampersand used to keep it.
      assert.match(last.value, /Päivä 2: Maastaveto ja pystypunnerrus/);
      assert.doesNotMatch(last.value, /Deadlift/);
      // English stays English.
      assert.match(buildCoachContextReadout(context, 'en')[0].value, /Day 2: Deadlift & Press/);
    },
  },
  {
    // Three stacked surfaces became one stage (2026-08-23): today's line
    // leads, noticed items keep the tap that used to live on their card, and
    // the readout follows. Order is what the reader sees in the first seconds.
    name: 'the opening ticker folds today, the noticed items and the readout into one ordered sequence',
    run() {
      const rows = buildCoachOpeningRows({
        openingLine: 'Lower Pump is on the plan today.',
        noticed: [{ key: 'bench', tone: 'warn', title: 'Bench · stalled', body: '3 weeks flat', question: 'What about my bench?' }],
        readout: [{ key: 'rhythm', label: 'Rhythm', value: '3 this week' }],
        language: 'en',
      });
      assert.deepEqual(rows.map((r) => r.key), ['today', 'noticed-bench', 'rhythm']);
      assert.equal(rows[0].label, 'Today');
      assert.equal(rows[0].question, undefined);
      assert.equal(rows[1].question, 'What about my bench?');
      assert.match(rows[1].value, /Bench · stalled — 3 weeks flat/);
      assert.equal(rows[2].question, undefined);
      // An empty opening line adds no slide.
      assert.deepEqual(
        buildCoachOpeningRows({ openingLine: '  ', noticed: [], readout: [], language: 'fi' }),
        [],
      );
    },
  },
  {
    // "Want me to walk through it?" shipped with no way to say yes. Every
    // opening line that ends in an offer now carries its one-tap answer.
    name: 'an opening line that makes an offer carries a one-tap answer',
    run() {
      const plan = { todaySessionTitle: 'Lower Pump', sessionsThisWeek: 2, weeklyRead: [] };
      const offer = buildCoachOpeningOffer(plan, 'fi');
      assert.ok(offer);
      assert.match(offer.question, /Lower Pump/);
      assert.equal(offer.askLabel, 'Käy läpi →');
      assert.match(buildCoachOpeningLine(plan, 'fi'), /Käydäänkö se läpi\?/);

      const stalled = {
        todaySessionTitle: null,
        sessionsThisWeek: 2,
        weeklyRead: [row({ key: 'bench', tone: 'amber', name: 'Bench' })],
      };
      assert.match(buildCoachOpeningOffer(stalled, 'en').question, /bench/);

      // "Ask me anything" is answered by the input box, not a button — as long
      // as there is a programme to ask about.
      assert.equal(buildCoachOpeningOffer({ todaySessionTitle: null, sessionsThisWeek: 0, weeklyRead: [] }, 'en'), null);

      // With no programme, every branch above is about a session or a lift the
      // reader does not have, and the opening had nothing to offer. That is
      // exactly the reader for whom the chat's newest capability is the useful
      // first thing to say — so the empty case stops being empty, rather than
      // the offer being bolted onto readers who are mid-block.
      const noProgramme = buildCoachOpeningOffer(
        { todaySessionTitle: null, sessionsThisWeek: 0, weeklyRead: [], hasProgramme: false },
        'fi',
      );
      assert.ok(noProgramme, 'the empty opening now offers to build one');
      assert.equal(noProgramme.askLabel, 'Rakenna minulle ohjelma →');
      // And it stays out of the way of a reader who has one.
      assert.equal(
        buildCoachOpeningOffer(
          { todaySessionTitle: null, sessionsThisWeek: 0, weeklyRead: [], hasProgramme: true },
          'fi',
        ),
        null,
      );

      // And the row builder puts the offer on the today slide.
      const rows = buildCoachOpeningRows({ openingLine: 'x', offer, noticed: [], readout: [], language: 'fi' });
      assert.equal(rows[0].question, offer.question);
      assert.equal(rows[0].askLabel, 'Käy läpi →');
    },
  },
  {
    // #bugs 2026-08-23: a rest day opened with "Upper is on the plan today".
    // The next session in the rotation is "next", and only the schedule can
    // make it "today".
    name: 'a rest day says rest and names the next session, instead of calling it today',
    run() {
      const rest = { todaySessionTitle: null, nextSessionTitle: 'Upper Ma', sessionsThisWeek: 2, weeklyRead: [] };
      // Rest is the sentence, not a preamble. The old line buried it in front
      // of a question that invited training, and a reader took the invitation
      // for the answer (user, 2026-08-25).
      assert.equal(
        buildCoachOpeningLine(rest, 'fi'),
        'Tänään on lepopäivä — ei nostettavaa. Seuraavana ohjelmassa: Upper Ma.',
      );
      const offer = buildCoachOpeningOffer(rest, 'fi');
      assert.ok(offer);
      assert.equal(offer.question, 'Käy seuraava treenini Upper Ma läpi.');
      // The button has to agree with the sentence: "walk me through it" on a
      // rest day reads as "do it now", and the button is what a reader trusts.
      assert.equal(offer.askLabel, 'Katso ennakkoon →');
      assert.notEqual(offer.askLabel, 'Käy läpi →');
      // A training day still says today.
      const today = { todaySessionTitle: 'Upper Ma', nextSessionTitle: 'Upper Ma', sessionsThisWeek: 2, weeklyRead: [] };
      assert.match(buildCoachOpeningLine(today, 'fi'), /on tänään ohjelmassa/);
    },
  },
];
