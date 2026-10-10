const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tour = require('../../.test-dist/lib/firstRunTour');
const eligibility = require('../../.test-dist/lib/workoutTourEligibility');

/**
 * The guided workout's first-run tour (2026-10-10), tested where it is decided.
 *
 * Two surfaces, because the reader meets two screens in turn: the first plain
 * set (five beats) and the first rest after it (one). Whether they are shown is
 * lib's business - who they are for, what a skip means, what comes first - so
 * the overlay only draws.
 */

const SET_STEP = { kind: 'set', canWarmUp: true, canRemove: true, loaded: true, hasHistory: true };

/**
 * The words that give an order. The page under a beat is shielded, so a tour
 * that opens a sentence with one of these - in either language - asks for
 * something it will not let the reader do. Matched at the start of a clause:
 * "holding a button" describes, and "Hold" opening a sentence commands.
 */
const IMPERATIVE_AT_CLAUSE_START =
  /(^|[.;:!?]\s+)(Napauta|Napsauta|Klikkaa|Valitse|Paina|Pidä|Tap|Click|Press|Hold|Select|Choose)(?![\p{L}])/u;
const TAP_WORD_ANYWHERE = /(?<![\p{L}])(Napauta|Napsauta|Klikkaa|Tap|Click)(?![\p{L}])/u;
const read = (file) =>
  fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\r\n/g, '\n');

/** Every dictionary entry for a key, in both languages (entries may be wrapped). */
function copyOf(key) {
  const dict = read('src/lib/i18n.ts');
  const found = [...dict.matchAll(new RegExp(`'${key.replace('.', '\\.')}':\\s*(['"])([\\s\\S]*?)\\1,`, 'g'))];
  assert.equal(found.length, 2, `${key} is in both dictionaries`);
  return { en: found[0][2], fi: found[1][2] };
}

const targets = (beats) => beats.map((beat) => beat.target);

module.exports = [
  {
    name: 'workout tour: the set tour has five beats in the order the screen reads, the rest tour has one',
    run() {
      assert.deepEqual(targets(tour.resolveTourBeats('workoutSet', { hasProgram: false, workout: SET_STEP })), [
        'workout.name',
        'workout.history',
        'workout.setRow',
        'workout.dials',
        'workout.log',
      ]);
      assert.deepEqual(targets(tour.resolveTourBeats('workoutRest', { hasProgram: false })), ['workout.rest']);
      // And Home is untouched by the options the workout adds.
      assert.deepEqual(
        targets(tour.resolveTourBeats('home', { hasProgram: true, workout: SET_STEP }).filter((b) => b.kind === 'section')),
        ['home.week', 'home.startCta', 'home.workoutChevron', 'home.program', 'home.cards'],
      );
      for (const beat of [
        ...tour.resolveTourBeats('workoutSet', { hasProgram: false, workout: SET_STEP }),
        ...tour.resolveTourBeats('workoutRest', { hasProgram: false }),
      ]) {
        assert.equal(beat.kind, 'section');
        // The player has no list to scroll, and no fine target inside an anchor.
        assert.equal(beat.scroll, undefined);
        assert.equal(beat.anchor, undefined);
      }
    },
  },
  {
    name: 'workout tour: a beat never describes a button the screen does not have',
    run() {
      const keysFor = (step) =>
        Object.fromEntries(
          tour.resolveTourBeats('workoutSet', { hasProgram: false, workout: step }).map((beat) => [beat.target, beat.copyKey]),
        );
      // The set row's buttons come and go: the red − when there is a set to take
      // back (not on a one-set lift, not when the last set is logged), the blue +
      // on the first set of a loaded lift. The green + is always there.
      assert.equal(keysFor(SET_STEP)['workout.setRow'], 'tour.workout.sets');
      assert.equal(keysFor({ ...SET_STEP, canWarmUp: false })['workout.setRow'], 'tour.workout.setsNoWarmup');
      assert.equal(keysFor({ ...SET_STEP, canRemove: false })['workout.setRow'], 'tour.workout.setsNoRemove');
      assert.equal(
        keysFor({ ...SET_STEP, canRemove: false, canWarmUp: false })['workout.setRow'],
        'tour.workout.setsAddOnly',
      );
      assert.equal(tour.setRowCopyKey(true, true), 'tour.workout.sets');
            const blueWarmup = /(blue \+|sininen \+)/;
      const warmUpWord = /(warm-up|lämmittely)/i;
      for (const [key, hasMinus, hasWarmup] of [
        ['tour.workout.sets', true, true],
        ['tour.workout.setsNoWarmup', true, false],
        ['tour.workout.setsNoRemove', false, true],
        ['tour.workout.setsAddOnly', false, false],
      ]) {
        const { en, fi } = copyOf(key);
        assert.equal(/Red −/.test(en), hasMinus, `${key} en: the red −`);
        assert.equal(/Punainen −/.test(fi), hasMinus, `${key} fi: the red −`);
        assert.equal(blueWarmup.test(en), hasWarmup, `${key} en: the blue +`);
        assert.equal(blueWarmup.test(fi), hasWarmup, `${key} fi: the blue +`);
        assert.equal(warmUpWord.test(en), hasWarmup, `${key} en: a warm-up`);
        assert.equal(warmUpWord.test(fi), hasWarmup, `${key} fi: a warm-up`);
        assert.match(en, /(green|Green) \+/, `${key} en: the green + is always there`);
        assert.match(fi, /Vihreä \+|vihreä \+/, `${key} fi: the green + is always there`);
      }
      // No weight dial on a bodyweight lift.
      assert.equal(keysFor(SET_STEP)['workout.dials'], 'tour.workout.dials');
      assert.equal(keysFor({ ...SET_STEP, loaded: false })['workout.dials'], 'tour.workout.dialsReps');
      // A lift with no history shows the first-time note, not a LAST TIME line.
      assert.equal(keysFor(SET_STEP)['workout.history'], 'tour.workout.history');
      assert.equal(keysFor({ ...SET_STEP, hasHistory: false })['workout.history'], 'tour.workout.historyFirst');

      const reps = copyOf('tour.workout.dialsReps');
      assert.doesNotMatch(reps.en, /weight/i);
      assert.doesNotMatch(reps.fi, /paino/i);
    },
  },
  {
    name: 'workout tour: rows that carry the page margin as padding are rung inside it',
    run() {
      const beats = tour.resolveTourBeats('workoutSet', { hasProgram: false, workout: SET_STEP });
      const byTarget = Object.fromEntries(beats.map((beat) => [beat.target, beat]));
      // The set row and the button row measure edge to edge; the ring must not.
      assert.deepEqual(byTarget['workout.setRow'].inset, { x: 24, top: 18 });
      assert.deepEqual(byTarget['workout.log'].inset, { x: 22, top: 4, bottom: 12 });
      assert.deepEqual(byTarget['workout.history'].inset, { top: 9 });
      assert.equal(byTarget['workout.name'].inset, undefined);
      assert.equal(byTarget['workout.dials'].inset, undefined);

      assert.deepEqual(tour.insetRect({ x: 0, y: 500, width: 400, height: 80 }, { x: 22, top: 4, bottom: 12 }), {
        x: 22,
        y: 504,
        width: 356,
        height: 64,
      });
      const box = { x: 0, y: 10, width: 400, height: 80 };
      assert.equal(tour.insetRect(box, undefined), box);
      assert.deepEqual(tour.insetRect(box, {}), box);
      // An inset that would eat the whole box is ignored, never negative.
      assert.equal(tour.insetRect({ x: 0, y: 0, width: 30, height: 80 }, { x: 24 }).width, 30);
      assert.equal(tour.insetRect({ x: 0, y: 0, width: 300, height: 20 }, { top: 18, bottom: 12 }).height, 20);
    },
  },
  {
    name: 'workout tour: only the guided player has a workout surface, and only on a step it reports',
    run() {
      const guided = { tab: 'workout', screen: 'guided' };
      assert.equal(tour.resolveWorkoutTourSurface(guided, { kind: 'set' }), 'workoutSet');
      assert.equal(tour.resolveWorkoutTourSurface(guided, { kind: 'rest' }), 'workoutRest');
      // The entry screen, a splash, a drill, an interval, a superset: nothing reported.
      assert.equal(tour.resolveWorkoutTourSurface(guided, null), null);
      // Not the free workout, not cardio, not the programme pages, not Home.
      for (const route of [
        { tab: 'workout', screen: 'empty' },
        { tab: 'workout', screen: 'detail' },
        { tab: 'workout', screen: 'summary' },
        { tab: 'workout', screen: 'plans' },
        { tab: 'home', screen: 'cardio' },
        { tab: 'home', screen: 'dashboard' },
      ]) {
        assert.equal(tour.resolveWorkoutTourSurface(route, { kind: 'set' }), null, route.screen);
      }
      // Home's own resolver does not see the player.
      assert.equal(tour.resolveTourSurface(guided), null);
    },
  },
  {
    name: 'workout tour: the surfaces are known to the normaliser, and an old install gets the tour once',
    run() {
      assert.deepEqual(
        tour.normalizeFirstRunToursSeen(['home', 'workoutSet', 'workoutRest', 'workoutSet', 'garden', 'progress']),
        ['home', 'workoutSet', 'workoutRest'],
      );
      assert.equal(tour.isTourSurface('workoutSet'), true);
      assert.equal(tour.isTourSurface('workoutRest'), true);

      // An install from before: Home seen, nothing else stored.
      const old = tour.normalizeFirstRunToursSeen(['home']);
      assert.deepEqual(old, ['home']);
      assert.equal(tour.isTourDue(old, 'workoutSet'), true);
      assert.equal(tour.isTourReady(old, 'workoutSet'), true);
      // ...and once it has run, it has run.
      const after = tour.markToursSeen(old, ['workoutSet']);
      assert.equal(tour.isTourReady(after, 'workoutSet'), false);
      assert.deepEqual(tour.markToursSeen(after, ['workoutSet']), after, 'marking twice is marking once');
    },
  },
  {
    name: 'workout tour: the rest tour comes after the set tour, never before it',
    run() {
      // A superset opens the workout: the first plain step is a rest.
      assert.equal(tour.isTourReady([], 'workoutRest'), false);
      assert.equal(tour.isTourReady(['home'], 'workoutRest'), false);
      assert.equal(tour.isTourReady(['workoutSet'], 'workoutRest'), true);
      assert.equal(tour.isTourReady(['workoutSet', 'workoutRest'], 'workoutRest'), false);
      assert.equal(tour.isTourReady([], 'home'), true, 'Home does not wait for the workout');
    },
  },
  {
    name: 'workout tour: skipping the set tour skips the rest tour; finishing or leaving marks only what was shown',
    run() {
      assert.deepEqual(tour.surfacesSeenOnFinish('workoutSet', 'skipped'), ['workoutSet', 'workoutRest']);
      assert.deepEqual(tour.surfacesSeenOnFinish('workoutSet', 'done'), ['workoutSet']);
      assert.deepEqual(tour.surfacesSeenOnFinish('workoutRest', 'skipped'), ['workoutRest']);
      assert.deepEqual(tour.surfacesSeenOnFinish('workoutRest', 'done'), ['workoutRest']);
      // Home's skip stays Home's: it is not an answer about the workout.
      assert.deepEqual(tour.surfacesSeenOnFinish('home', 'skipped'), ['home']);

      // The whole walk, as the shell drives it.
      let seen = [];
      seen = tour.markToursSeen(seen, tour.surfacesSeenOnFinish('workoutSet', 'skipped'));
      assert.equal(tour.isTourReady(seen, 'workoutSet'), false);
      assert.equal(tour.isTourReady(seen, 'workoutRest'), false, 'the rest tour is not shown to a reader who said no');

      let finished = tour.markToursSeen([], tour.surfacesSeenOnFinish('workoutSet', 'done'));
      assert.equal(tour.isTourReady(finished, 'workoutRest'), true, 'but one who read it through gets the rest');
      finished = tour.markToursSeen(finished, tour.surfacesSeenOnFinish('workoutRest', 'done'));
      assert.equal(tour.isTourReady(finished, 'workoutRest'), false);
    },
  },
  {
    name: 'workout tour: Settings replay hands back every surface',
    run() {
      // The replay writes an empty list; every surface is due again, in order.
      for (const surface of tour.TOUR_SURFACES) {
        assert.equal(tour.isTourDue([], surface), true, surface);
      }
      assert.equal(tour.isTourReady([], 'workoutSet'), true);
      assert.deepEqual([...tour.WORKOUT_TOUR_SURFACES], ['workoutSet', 'workoutRest']);
    },
  },
  {
    name: 'workout tour: it starts once the step has settled, later than a tap and sooner than Home',
    run() {
      // StepIn is 320 ms; the tour waits for it and for a first look.
      assert.ok(tour.WORKOUT_TOUR_START_MS >= 320 + 300);
      assert.ok(tour.WORKOUT_TOUR_START_MS < 1500, 'a rest is not long enough to spend it waiting');
      assert.equal(tour.tourStartDelayMs(false, 'workoutSet'), tour.WORKOUT_TOUR_START_MS);
      assert.equal(tour.tourStartDelayMs(false, 'workoutRest'), tour.WORKOUT_TOUR_START_MS);
      assert.ok(tour.tourStartDelayMs(true, 'workoutSet') < 300, 'reduced motion has no entrance to wait for');
      // Home keeps its own number, with or without the argument.
      assert.equal(tour.tourStartDelayMs(false), tour.TOUR_START_AFTER_UNFOLD_MS);
      assert.equal(tour.tourStartDelayMs(false, 'home'), tour.TOUR_START_AFTER_UNFOLD_MS);
      assert.equal(tour.tourStartDelayMs(true, 'home'), tour.TOUR_START_REDUCED_MS);
    },
  },
  {
    name: 'workout tour: a reader with a programme workout behind them is not shown it, unless they asked',
    run() {
      const none = { replayed: false, sessions: [], templates: [] };
      assert.equal(eligibility.isWorkoutTourEligible(none), true, 'a new install');

      const authored = [{ id: 'custom_1', origin: 'authored' }];
      const veteran = { replayed: false, sessions: [{ workoutTemplateId: 'custom_1' }], templates: authored };
      assert.equal(eligibility.isWorkoutTourEligible(veteran), false, 'finished a custom programme workout');
      // A ready programme has no stored template at all: still a programme workout.
      assert.equal(
        eligibility.isWorkoutTourEligible({ ...veteran, sessions: [{ workoutTemplateId: 'tpl_ready_1' }], templates: [] }),
        false,
      );
      // A template deleted since: the session stands.
      assert.equal(eligibility.isWorkoutTourEligible({ ...veteran, templates: [] }), false);

      // Free workouts never met the guided player.
      const freestyle = [{ id: 'free_1', origin: 'freestyle' }];
      assert.equal(
        eligibility.isWorkoutTourEligible({
          replayed: false,
          sessions: [{ workoutTemplateId: 'free_1' }, { workoutTemplateId: 'free_1' }],
          templates: freestyle,
        }),
        true,
        'only freestyle logs behind them',
      );
      assert.equal(
        eligibility.isWorkoutTourEligible({
          replayed: false,
          sessions: [{ workoutTemplateId: 'free_1' }, { workoutTemplateId: 'custom_1' }],
          templates: [...freestyle, ...authored],
        }),
        false,
        'one programme workout among them is enough',
      );

      // "Show the tour again" is a request, and history does not overrule it.
      assert.equal(eligibility.isWorkoutTourEligible({ ...veteran, replayed: true }), true);
      // A session row with no usable template id is not evidence of anything.
      assert.equal(eligibility.hasCompletedProgrammeWorkout([{ workoutTemplateId: null }, {}], []), false);
    },
  },
  {
    // Hevy's import writes every session under one shared id (AppProvider
    // importWorkoutHistory), with no template behind it. An importer who has
    // never opened the guided player is exactly who the tour is for.
    name: 'workout tour: imported history is not a programme workout, so an importer still gets the tour',
    run() {
      assert.equal(eligibility.IMPORTED_HISTORY_TEMPLATE_ID, 'hevy_import');
      const app = read('src/state/AppProvider.tsx');
      assert.match(app, /workoutTemplateId: 'hevy_import'/, 'the id the importer really writes');
      const imported = Array.from({ length: 40 }, () => ({ workoutTemplateId: 'hevy_import' }));
      assert.equal(eligibility.hasCompletedProgrammeWorkout(imported, []), false);
      assert.equal(eligibility.isWorkoutTourEligible({ replayed: false, sessions: imported, templates: [] }), true);
      // ...until they finish one in the player.
      assert.equal(
        eligibility.isWorkoutTourEligible({
          replayed: false,
          sessions: [...imported, { workoutTemplateId: 'custom_1' }],
          templates: [{ id: 'custom_1', origin: 'authored' }],
        }),
        false,
      );
      // Imports and free workouts together are still no programme workout.
      assert.equal(
        eligibility.isWorkoutTourEligible({
          replayed: false,
          sessions: [...imported, { workoutTemplateId: 'free_1' }],
          templates: [{ id: 'free_1', origin: 'freestyle' }],
        }),
        true,
      );
    },
  },
  {
    name: 'workout tour: every beat has copy in both languages that says what is there, never what to tap',
    run() {
      const keys = new Set();
      for (const canRemove of [true, false]) {
        for (const canWarmUp of [true, false]) {
          for (const loaded of [true, false]) {
            for (const hasHistory of [true, false]) {
              const step = { ...SET_STEP, canRemove, canWarmUp, loaded, hasHistory };
              for (const beat of tour.resolveTourBeats('workoutSet', { hasProgram: false, workout: step })) {
                keys.add(beat.copyKey);
              }
            }
          }
        }
      }
      for (const beat of tour.resolveTourBeats('workoutRest', { hasProgram: false })) {
        keys.add(beat.copyKey);
      }
      assert.equal(keys.size, 11, 'name, two histories, four set rows, two dials, the log button, the rest');
      for (const key of keys) {
        const { en, fi } = copyOf(key);
        for (const [language, text] of [['en', en], ['fi', fi]]) {
          assert.ok(text.length > 40, `${key} ${language} is suspiciously short: ${text}`);
          // The page under a beat is shielded: a tour that orders the reader
          // to tap, press, hold or pick something lies.
          assert.doesNotMatch(text, TAP_WORD_ANYWHERE, `${key} ${language}: ${text}`);
          assert.doesNotMatch(text, IMPERATIVE_AT_CLAUSE_START, `${key} ${language}: ${text}`);
        }
        assert.notEqual(en, fi, `${key} is translated`);
        // British spelling, the dictionary's own.
        assert.doesNotMatch(en, /\bprogram\b/i, key);
      }
    },
  },
  {
    name: 'workout tour: the imperative check itself catches what it is for',
    run() {
      // The guard is only worth its regex if it fires on the sentences it is
      // for, in both languages, and leaves description alone.
      for (const bad of [
        'Tap the name to open it.',
        'Press the red button.',
        'Hold a button to run the number.',
        'Select a set. Then go on.',
        'Napauta nimeä.',
        'Valitse sarja.',
        'Pidä painiketta pohjassa.',
        'Paina kirjaa. Sitten jatka.',
        'Hyvä. Pidä painiketta pohjassa.',
      ]) {
        assert.ok(IMPERATIVE_AT_CLAUSE_START.test(bad) || TAP_WORD_ANYWHERE.test(bad), bad);
      }
      for (const fine of [
        'Holding a button changes the number faster.',
        'painiketta pohjassa pitämällä luku vaihtuu nopeammin.',
        'Logging a set moves on to the rest.',
      ]) {
        assert.ok(!IMPERATIVE_AT_CLAUSE_START.test(fine) && !TAP_WORD_ANYWHERE.test(fine), fine);
      }
    },
  },
  {
    name: 'workout tour: the copy names only what the player has on screen',
    run() {
      // The rest screen's buttons are -15s and +15s (not +60s: that is the
      // lock-screen alert) and Skip rest; the copy must say the same labels.
      const player = read('src/screens/GuidedPlayerScreen.tsx');
      assert.match(player, /label="−15s"/);
      assert.match(player, /label="\+15s"/);
      const rest = copyOf('tour.workout.rest');
      assert.match(rest.en, /−15s and \+15s/);
      assert.match(rest.fi, /−15s ja \+15s/);
      assert.doesNotMatch(rest.en, /60/);
      const dict = read('src/lib/i18n.ts');
      assert.match(dict, /'guided\.skipRest': 'Skip rest'/);
      assert.match(dict, /'guided\.skipRest': 'Ohita lepo'/);
      assert.match(rest.en, /Skip rest/);
      assert.match(rest.fi, /Ohita lepo/);
      // A rest only follows a set when another round follows (guidedPlayer
      // buildGuidedSteps), so "logging starts the rest" would be false after
      // the last set of a lift. The sentence says both.
      const log = copyOf('tour.workout.log');
      assert.doesNotMatch(log.en, /^Logging a set starts the rest/);
      assert.match(log.en, /rest, or to the next exercise after the last set/);
      assert.match(log.fi, /lepoon, tai viimeisen sarjan jälkeen seuraavaan liikkeeseen/);
      const steps = read('src/lib/guidedPlayer.ts');
      assert.match(steps, /Rest when the round is over and another round follows/);
      // What Pause and the menu do, as the screen has them.
      assert.match(log.en, /Pause stops the workout clock/);
      assert.match(log.en, /menu beside it swaps or skips this exercise/);
      assert.match(player, /GPIcon name=\{paused \? 'play' : 'pause'\}/);
      assert.match(dict, /'guided\.action\.swap': 'Swap this exercise'/);
      assert.match(dict, /'guided\.action\.skipExercise': 'Skip this exercise'/);
      // The history beat: TODAY is a row label on the card, and the first-time
      // sentence quotes it as the card prints it in each language.
      assert.match(copyOf('tour.workout.historyFirst').en, /^TODAY /);
      assert.match(copyOf('tour.workout.historyFirst').fi, /^TÄNÄÄN-rivillä /);
      assert.match(dict, /'guided\.card\.today': 'TODAY'/);
      assert.match(dict, /'guided\.card\.today': 'TÄNÄÄN'/);
    },
  },
  {
    name: 'workout tour: the rest beat rings the controls block, with the callout above it',
    run() {
      const [beat, ...others] = tour.resolveTourBeats('workoutRest', { hasProgram: false });
      assert.equal(others.length, 0);
      assert.equal(beat.target, 'workout.rest');
      // Above: below the block there is only the rail, and a callout pushed back
      // up would sit on the very buttons its sentence is about.
      assert.equal(beat.place, 'above');
      assert.deepEqual(beat.inset, { x: 24, bottom: 10 });
    },
  },
];
