const assert = require('node:assert/strict');

const {
  RATING_COOLDOWN_DAYS,
  RATING_MIN_SESSIONS,
  decideRatingPrompt,
  emptyRatingPromptState,
  recordRatingAsked,
  recordRatingCompleted,
} = require('../../.test-dist/lib/ratingPrompt.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-13T08:00:00.000Z');

function input(overrides = {}) {
  return {
    state: overrides.state ?? emptyRatingPromptState,
    sessionsLogged: overrides.sessionsLogged ?? RATING_MIN_SESSIONS,
    atPeakMoment: overrides.atPeakMoment ?? true,
    nowMs: overrides.nowMs ?? NOW,
  };
}

module.exports = [
  {
    name: 'asks at a peak moment once the log has enough sessions',
    run() {
      assert.deepEqual(decideRatingPrompt(input()), { ask: true });
    },
  },
  {
    name: 'stays silent until the app has done its job a few times',
    run() {
      const decision = decideRatingPrompt(input({ sessionsLogged: RATING_MIN_SESSIONS - 1 }));
      assert.deepEqual(decision, { ask: false, reason: 'too_few_sessions' });
    },
  },
  {
    name: 'never asks in the middle of the flow, only after a success',
    run() {
      const decision = decideRatingPrompt(input({ atPeakMoment: false }));
      assert.deepEqual(decision, { ask: false, reason: 'not_a_peak_moment' });
    },
  },
  {
    name: 'a reader who already rated is never asked again',
    run() {
      const state = recordRatingCompleted(emptyRatingPromptState);
      assert.deepEqual(decideRatingPrompt(input({ state })), { ask: false, reason: 'already_rated' });
    },
  },
  {
    name: 'the cooldown holds, then releases',
    run() {
      const state = recordRatingAsked(emptyRatingPromptState, NOW);
      assert.equal(state.askCount, 1);

      const tooSoon = NOW + (RATING_COOLDOWN_DAYS - 1) * DAY_MS;
      assert.deepEqual(decideRatingPrompt(input({ state, nowMs: tooSoon })), {
        ask: false,
        reason: 'cooling_down',
      });

      const later = NOW + (RATING_COOLDOWN_DAYS + 1) * DAY_MS;
      assert.deepEqual(decideRatingPrompt(input({ state, nowMs: later })), { ask: true });
    },
  },
  {
    name: 'the weekly ask has no lifetime cap — only rating ends it',
    run() {
      // User decision 2026-08-24: it comes back once a week until the reader
      // rates. The old three-ask ceiling is gone on purpose.
      assert.equal(RATING_COOLDOWN_DAYS, 7);

      let state = emptyRatingPromptState;
      let clock = NOW;
      for (let index = 0; index < 12; index += 1) {
        assert.deepEqual(
          decideRatingPrompt(input({ state, nowMs: clock })),
          { ask: true },
          `ask ${index + 1} should still be offered`,
        );
        state = recordRatingAsked(state, clock);
        clock += (RATING_COOLDOWN_DAYS + 1) * DAY_MS;
      }
      assert.equal(state.askCount, 12);

      // What actually ends it, everywhere at once.
      const rated = recordRatingCompleted(state);
      assert.deepEqual(decideRatingPrompt(input({ state: rated, nowMs: clock })), {
        ask: false,
        reason: 'already_rated',
      });
    },
  },
  {
    /**
     * The only thing standing between "weekly" and "a weekly nag". The ask
     * fires on the way out of a finished session, so a reader who stops
     * training stops being asked — the sheet cannot find them on a launch,
     * a settings visit, or any other idle moment.
     */
    name: 'weekly means weekly-after-a-workout, not weekly-on-launch',
    run() {
      const state = { lastAskedAt: null, askCount: 4, rated: false };
      const overdue = NOW + 400 * DAY_MS;
      assert.deepEqual(decideRatingPrompt(input({ state, nowMs: overdue, atPeakMoment: false })), {
        ask: false,
        reason: 'not_a_peak_moment',
      });
    },
  },
  {
    name: 'an unreadable stored date does not become a way to ask every launch',
    run() {
      const state = { lastAskedAt: 'not a date', askCount: 1, rated: false };
      assert.deepEqual(decideRatingPrompt(input({ state })), { ask: false, reason: 'cooling_down' });
    },
  },
  {
    name: 'recording an ask does not mutate the state it was given',
    run() {
      const state = emptyRatingPromptState;
      const next = recordRatingAsked(state, NOW);
      assert.equal(state.askCount, 0);
      assert.equal(state.lastAskedAt, null);
      assert.equal(next.askCount, 1);
      assert.equal(next.lastAskedAt, new Date(NOW).toISOString());
    },
  },
  {
    /**
     * The rules, the sheet and its strings all existed and nothing called
     * them — the i18n block said "built, deliberately not wired" and the
     * reader's report was that the rating ask "disappeared". Unit tests
     * counted as callers, so the dead-code guard stayed quiet. These are
     * source-level on purpose: they pin the chain the guard cannot see.
     */
    name: 'rating: the sheet is actually wired, and the ask is remembered across restarts',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const root = path.join(__dirname, '..', '..');
      const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
      const appSource = require('../helpers/appWiringSource.cjs').readAppWiring();

      // Decided at the peak moment, on the way out of the finish screen.
      assert.match(appSource, /<RateAppSheet/);
      assert.match(appSource, /decideRatingPrompt\(\{/);
      assert.match(appSource, /atPeakMoment: true/);
      assert.match(appSource, /maybeAskForRating\(\);/);

      // Counted when SHOWN, not when answered: a reader who closes it has
      // still been asked, and counting only answers would ask forever.
      // Android shows the sheet; iPhone asks Apple's own prompt (App Review 5.6.1). Either way the ask is recorded.
      assert.match(
        appSource,
        /if \(usesSystemReviewPrompt\(storePlatformOf\(Platform\.OS\)\)\) \{\s*void requestSystemReview\(\);\s*\} else \{\s*setRatingSheetVisible\(true\);\s*\}\s*void updatePreferences\(\(current\) => \(\{ ratingPrompt: recordRatingAsked\(current\.ratingPrompt/,
      );

      // Every star opens the listing. No branch on the number: that is review
      // gating, and it is against Play policy.
      assert.match(read('src/lib/storeLinks.ts'), /export const PLAY_LISTING_URL = 'https:\/\/play\.google\.com\/store\/apps\/details\?id=app\.vinha'/);
      assert.match(appSource, /void Linking\.openURL\(PLAY_LISTING_URL\)/);
      assert.doesNotMatch(appSource, /onRate=\{\(rating\)/);

      // Persisted, because "we asked twice and you said no" is a promise, and
      // a promise held only in memory is broken by the next restart.
      assert.match(read('src/types/models.ts'), /ratingPrompt: RatingPromptState;/);
      assert.match(read('src/storage/database.ts'), /ratingPrompt: normalizeRatingPrompt\(/);
      assert.match(read('src/data/seed.ts'), /ratingPrompt: \{ lastAskedAt: null, askCount: 0, rated: false \}/);

      // The Profile offers it too, and hides once rated — the same flag that
      // silences the sheet ("kerran kun suorittaa se lähtee kaikkialta").
      // It used to be a Settings row as well; the design moved that one out
      // (2026-09-03) and Send feedback took its place, so the star is asked
      // for in one place, where the reader has just seen what they did.
      const profileSource = read('src/screens/ProfileScreen.tsx');
      assert.match(profileSource, /!preferences\.ratingPrompt\.rated \? \(/);
      assert.match(profileSource, /onPress=\{onOpenRating\}/);
      assert.doesNotMatch(read('src/screens/SettingsScreen.tsx'), /onOpenRating|settings\.rate/);
      // Tapping it is not an interruption, so it skips the timing rules the
      // automatic ask has to obey.
      assert.match(appSource, /if \(!usesSystemReviewPrompt\(store\)\) \{\s*return \(\) => setRatingSheetVisible\(true\);/);
    },
  },
];
