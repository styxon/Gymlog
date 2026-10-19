const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isSuggestionSilenced,
  silencedSuggestionKinds,
  recordSuggestionAccepted,
  recordSuggestionRejected,
  SUGGESTION_COOLDOWN_DAYS,
} = require('../../.test-dist/lib/coachSuggestions.js');

const NOW = new Date('2026-08-25T09:00:00.000Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

module.exports = [
  {
    name: 'a canned offline answer is labelled as one, not passed off as the coach',
    run() {
      // The endpoint answers with a preview reply when it cannot reach the
      // model — rate limited, upstream down, key missing. Shown unlabelled,
      // that is what "the AI chat does not work" looks like from the reader's
      // side: a real-looking answer that says nothing (found live, 25.8.,
      // when an eval run used up the per-IP rate limit the phone shares).
      const screen = fs.readFileSync(path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'), 'utf8');
      assert.match(screen, /const fellBackToPreview = liveConfigured && result\.source === 'preview';/);
      assert.match(screen, /fellBackToPreview \? \{ evidence: t\(language, 'coachChat\.offlineAnswer'\) \}/);

      const i18n = fs.readFileSync(path.join(__dirname, '../../src/lib/i18n.ts'), 'utf8');
      assert.equal((i18n.match(/'coachChat\.offlineAnswer':/g) ?? []).length, 2, 'both languages');

      // The header says which mode the chat is in, and it recovers on its own:
      // the badge reports the last answer, not a past outage.
      assert.match(screen, /const online = liveConfigured && !answeredOffline;/);
      assert.match(screen, /setAnsweredOffline\(result\.source === 'preview'\);/);
      // A request that never landed is the plainest offline there is.
      assert.match(screen, /setAnsweredOffline\(true\);/);
      assert.equal((i18n.match(/'coachChat\.mode\.online':/g) ?? []).length, 2, 'both languages');

      // The composer is lifted by the keyboard's MEASURED height, never by
      // KeyboardAvoidingView's estimate: on edge-to-edge Android the estimate
      // under-lifts, and the field ended up under the keys (photo, 25.8.).
      // On iOS the AppShell has already lifted the screen, and only the gap is
      // added (iOS hunt 2026-10-17): keyboardOpenBottomPadding decides which.
      assert.match(screen, /const keyboard = useKeyboardOpen\(\);/);
      assert.match(
        screen,
        /keyboard\.open && \{ paddingBottom: keyboardOpenBottomPadding\(Platform\.OS, keyboard\.height, spacing\.sm\) \}/,
      );
      // In code, not in the comment that explains why it left.
      assert.doesNotMatch(screen, /<KeyboardAvoidingView|KeyboardAvoidingView,/);
    },
  },
  {
    name: 'coach suggestions: a refusal is an answer, not a "later"',
    run() {
      // Nothing said yet: the offer may be made.
      assert.equal(isSuggestionSilenced({}, 'pin_stat_card', NOW), false);
      assert.equal(isSuggestionSilenced(null, 'pin_stat_card', NOW), false);

      // One no buys a month of quiet.
      const once = recordSuggestionRejected({}, 'pin_stat_card', daysAgo(3));
      assert.equal(isSuggestionSilenced(once, 'pin_stat_card', NOW), true);
      assert.equal(
        isSuggestionSilenced(once, 'pin_stat_card', new Date(NOW.getTime() + SUGGESTION_COOLDOWN_DAYS * 86400000)),
        false,
        'after the cooling-off month it may be asked once more',
      );

      // The second no ends it. There is no third offer, ever.
      const twice = recordSuggestionRejected(once, 'pin_stat_card', daysAgo(1));
      assert.equal(twice.pin_stat_card.rejectedCount, 2);
      assert.equal(isSuggestionSilenced(twice, 'pin_stat_card', NOW), true);
      assert.equal(
        isSuggestionSilenced(twice, 'pin_stat_card', new Date(NOW.getTime() + 400 * 86400000)),
        true,
        'two refusals do not expire',
      );

      // Accepting also ends it: the thing is on, and offering to turn on what
      // is already on is the sign that explains a sign.
      const taken = recordSuggestionAccepted({}, 'set_goal', NOW);
      assert.equal(isSuggestionSilenced(taken, 'set_goal', new Date(NOW.getTime() + 400 * 86400000)), true);

      // One kind's answer says nothing about another's.
      assert.equal(isSuggestionSilenced(twice, 'set_goal', NOW), false);
    },
  },
  {
    name: 'coach suggestions: the silenced kinds travel in the context, not a filter after the fact',
    run() {
      const state = recordSuggestionAccepted(
        recordSuggestionRejected({}, 'pin_stat_card', daysAgo(2)),
        'set_goal',
        daysAgo(60),
      );
      assert.deepEqual(silencedSuggestionKinds(state, NOW).sort(), ['pin_stat_card', 'set_goal']);
      assert.deepEqual(silencedSuggestionKinds({}, NOW), []);

      // Dropping a suggestion after it arrives would mean paying for an offer
      // that is thrown away, so the list has to reach the prompt.
      const renderer = fs.readFileSync(path.join(__dirname, '../../src/lib/aiCoachSystemContext.ts'), 'utf8');
      assert.match(renderer, /Do not offer/);
      assert.match(renderer, /silencedSuggestions/);

      // The context memo leaves VinhaApp for src/app in the phase-B split
      // (2026-09-30) — read the whole shell, not App.tsx alone.
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();
      assert.match(app, /silencedSuggestions: silencedSuggestionKinds\(preferences\.coachSuggestionState\)/);
      // The memo has to see the state, or the context keeps the answer the
      // reader already gave for a whole session.
      assert.match(app, /preferences\.coachSuggestionState,/);
    },
  },
  {
    name: 'coach suggestions: both answers are recorded, and an unusable offer is never drawn',
    run() {
      const screen = fs.readFileSync(path.join(__dirname, '../../src/screens/AICoachChatScreen.tsx'), 'utf8');
      // The chat screen's wiring moved to src/app with the home sub-screens
      // (phase A) — read the whole switchboard, not App.tsx alone.
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();

      // Recording only the acceptances would leave a refusal invisible and
      // the same offer would return next week.
      assert.match(screen, /if \(suggestionKind\) \{\s*\n\s*onCoachSuggestionResolved\(suggestionKind, accepted\);/);

      // A button the app cannot carry out is worse than no button: an unknown
      // measurement and an unparseable goal are both dropped.
      assert.match(screen, /if \(!isMeasurementIntentKind\(kind\) \|\| pinnedStatCardKeys\.includes\(kind\)\)/);
      // ...but a goal the coach itself declared is read on the declared path,
      // where only the body part and the number are still open. The sniffer's
      // rules were discarding offers the coach had merely paraphrased.
      assert.match(screen, /parseGoalIntent\(suggestion\.goalText, language, \{ declared: true \}\)/);

      // The weigh-in offer is a switch with nothing to carry, and it must not
      // be offered when it is already on.
      assert.match(screen, /if \(suggestion\.kind === 'weigh_in_reminder'\) \{[\s\S]*?return weighInReminderEnabled/);
      // The toggle has to be in the scheduling hook's dependency list, or
      // turning it on would not re-arm anything until the next cold start.
      const hook = fs.readFileSync(path.join(__dirname, '../../src/hooks/useScheduledNotifications.ts'), 'utf8');
      assert.match(hook, /notificationPrefs\.weighInReminder,/);
      assert.match(hook, /signals\.lastBodyweightAtMs,/);

      // "Painan 69,2 kg — pystytkö lisäämään sen?" was answered with "I
      // cannot log it for you" by a reply that could have carried the button
      // that does. A stated value now travels on the suggestion and the
      // button logs it in one tap; the unit must fit the measurement, so a
      // bodyweight in centimetres is dropped rather than drawn.
      // The shared validator (measurementIntent.ts) holds the unit and range rule.
      assert.match(screen, /validMeasurementIntent\(kind, suggestion\.value, suggestion\.unit\)/);
      assert.match(screen, /type: 'log' as const,/);
      const endpointSrc = fs.readFileSync(path.join(__dirname, '../../api/ai-coach.ts'), 'utf8');
      // The server refuses to forward garbage a button would then write.
      assert.match(endpointSrc, /candidate\.value > 0 && candidate\.value < 1000/);
      // And the rules forbid the dead promise outright. It moved up to the
      // evidence rules after the coach broke it anyway ("Avaan
      // painonkirjauksen sinulle", log 2026-08-25) — see the ordering guard in
      // tests/api/aiCoachEndpoint.test.cjs.
      assert.match(endpointSrc, /Never say you are doing, opening, logging, setting or changing anything/);
      assert.match(endpointSrc, /attach log_measurement with statKey, value and unit/);

      // The reading is the thing the coach does not have, so the offer opens
      // the page rather than pretending to log a number it invented.
      assert.match(screen, /if \(suggestion\.kind === 'log_measurement'\)/);
      // Split now: the kind gate first, the already-measured gate only on the
      // open-page path — a stated value may still be logged for a measured
      // site, because a new reading is the point.
      assert.match(screen, /if \(!isMeasurementIntentKind\(kind\)\)/);
      assert.match(screen, /if \(measured\)/);
      assert.match(app, /onOpenMeasure=\{\(kind\) =>/);
      assert.match(app, /section: 'measures', measure: kind/);
      // Bodyweight has its own screen; sending it to the measures section
      // would open a page that cannot record it.
      assert.match(app, /kind === 'bodyweight'/);

      const endpoint = fs.readFileSync(path.join(__dirname, '../../api/ai-coach.ts'), 'utf8');
      // One offer per answer, and only for what the app state says is missing.
      assert.match(endpoint, /You may offer one action per answer/);
      assert.match(endpoint, /Never offer what is already on/);
      // An unknown kind is dropped rather than passed to a client that would
      // have to draw a button for it.
      assert.match(
        endpoint,
        /candidate\.kind !== 'pin_stat_card' &&[\s\S]*?candidate\.kind !== 'set_goal' &&[\s\S]*?candidate\.kind !== 'weigh_in_reminder' &&[\s\S]*?candidate\.kind !== 'log_measurement'/,
      );
      // 6.4 without this is a question that goes nowhere: the rules have to
      // tell the coach to hand the reader the button along with the question.
      assert.match(endpoint, /Pair such a question with the matching `suggestion`/);
    },
  },
];
