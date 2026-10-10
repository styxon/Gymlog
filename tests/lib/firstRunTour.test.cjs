const assert = require('node:assert/strict');

const tour = require('../../.test-dist/lib/firstRunTour');

/**
 * The first-run tour's rules, tested where they are decided.
 *
 * The design build got two of these wrong in ways only a number shows: it
 * measured its ring 400 ms into a smooth scroll, and it made the bar five
 * stops. Both are settled here, in lib, so the overlay only draws.
 */
module.exports = [
  {
    name: 'firstRunTour: Home walks the day block in the order a reader uses it',
    run() {
      // Start first, then what is in it. One beat carried both and the second
      // half went unread (user 2026-09-09).
      const withProgram = tour.resolveTourBeats('home', { hasProgram: true });
      assert.deepEqual(
        withProgram.map((beat) => (beat.kind === 'section' ? beat.target : 'bar')),
        ['home.week', 'home.startCta', 'home.workoutChevron', 'home.program', 'home.cards', 'bar'],
      );
      const withoutProgram = tour.resolveTourBeats('home', { hasProgram: false });
      assert.deepEqual(
        withoutProgram.map((beat) => (beat.kind === 'section' ? beat.target : 'bar')),
        ['home.week', 'home.hero', 'home.cards', 'bar'],
      );
      // The two beats the brief cut stay cut: the lifts and the quick rows.
      for (const beat of withProgram) {
        if (beat.kind === 'section') {
          assert.doesNotMatch(beat.target, /lifts|quick|empty|cardio/);
        }
      }
    },
  },
  {
    /**
     * The hero beat's sentence is about the day block, but the thing it asks
     * the reader to press is one chevron inside it. So the ring and the
     * callout part company: the ring goes on the target, the callout on the
     * anchor, and the anchor is what the page is scrolled for.
     */
    name: 'firstRunTour: with a plan the hero beat rings the workout fold and anchors to the whole block',
    run() {
      const beats = tour.resolveTourBeats('home', { hasProgram: true });

      // The start button is its own beat, and rings what it points at, so it
      // needs no anchor of its own.
      const start = beats[1];
      assert.equal(start.target, 'home.startCta');
      assert.equal(start.anchor, undefined);
      assert.equal(start.copyKey, 'tour.home.start');

      const hero = beats[2];
      assert.equal(hero.target, 'home.workoutChevron');
      assert.equal(hero.anchor, 'home.hero');
      assert.equal(hero.place, 'below');
      assert.equal(hero.copyKey, 'tour.home.hero');

      // Without a plan the block IS one button: there is nothing finer to
      // ring and nothing to swap, so it stays a single beat with no anchor.
      const without = tour.resolveTourBeats('home', { hasProgram: false });
      // Two beats fewer: the block is one button, and there is no programme
      // card to point at either.
      assert.equal(without.length, 4);
      const plain = without[1];
      assert.equal(plain.target, 'home.hero');
      assert.equal(plain.anchor, undefined);

      // Every other section beat still rings what it anchors to.
      for (const beat of tour.resolveTourBeats('home', { hasProgram: true })) {
        if (beat.kind === 'section' && beat.target !== 'home.workoutChevron') {
          assert.equal(beat.anchor, undefined, beat.target);
        }
      }
    },
  },
  {
    /**
     * The cards are the last thing on the page, so there is nothing under
     * them to lift them against: `scrollOffsetForTarget`'s 240 stopped short
     * and the ring drew half a section (user 2026-09-08).
     */
    name: 'firstRunTour: the last Home section asks for the end of the list, not an offset',
    run() {
      const beats = tour.resolveTourBeats('home', { hasProgram: true });
      const cards = beats.find((beat) => beat.kind === 'section' && beat.target === 'home.cards');
      assert.equal(cards.scroll, 'end');
      // And it is the only one: every other beat has content below it.
      for (const beat of beats) {
        if (beat.kind === 'section' && beat.target !== 'home.cards') {
          assert.equal(beat.scroll, undefined, beat.target);
        }
      }
    },
  },
  {
    name: 'firstRunTour: the bar is ONE beat that sweeps all five items in order',
    run() {
      const beats = tour.resolveTourBeats('home', { hasProgram: true });
      const barBeats = beats.filter((beat) => beat.kind === 'bar');
      assert.equal(barBeats.length, 1);
      assert.deepEqual([...barBeats[0].stops], ['home', 'programs', 'ai', 'progress', 'profile']);
      for (const stop of barBeats[0].stops) {
        assert.equal(typeof tour.TOUR_BAR_STOP_COPY_KEY[stop], 'string');
      }
    },
  },
  {
    // User 2026-10-03: Progress and Profile had two beats each and went; a
    // stray surface name must not bring them back. The guided workout joined
    // Home on 2026-10-10 with two surfaces of its own (workoutTour.test.cjs).
    name: 'firstRunTour: Home and the two workout surfaces are the only ones',
    run() {
      assert.deepEqual([...tour.TOUR_SURFACES], ['home', 'workoutSet', 'workoutRest']);
      for (const surface of ['progress', 'profile']) {
        assert.deepEqual(tour.resolveTourBeats(surface, { hasProgram: true }), [], surface);
        assert.equal(tour.isTourSurface(surface), false, surface);
      }
    },
  },
  {
    name: 'firstRunTour: the tour starts after the last Home section has settled',
    run() {
      // HomeScreen RISE_DELAYS_MS ends at 600 and each rise is 500 ms.
      assert.ok(tour.TOUR_START_AFTER_UNFOLD_MS >= 600 + 500);
      assert.ok(tour.TOUR_START_AFTER_UNFOLD_MS < 2000, 'not so late the page feels dead');
      assert.equal(tour.tourStartDelayMs(false), tour.TOUR_START_AFTER_UNFOLD_MS);
      assert.ok(tour.tourStartDelayMs(true) < 100, 'reduced motion has no unfold to wait for');
      assert.ok(tour.SCROLL_SETTLE_MS >= 400, 'the ring is measured after the scroll, not during it');
    },
  },
  {
    /**
     * The bar sweep walked itself on a timer. 1800 ms per stop was too fast,
     * 2600 was still too fast, and a reader who needed longer had no way to
     * ask — so the timer is gone and "Seuraava" moves it (user 2026-09-09).
     * Nothing on this screen advances on its own any more.
     */
    name: 'firstRunTour: nothing advances on a timer, and the beat keeps re-measuring',
    run() {
      assert.equal(tour.BAR_SWEEP_STOP_MS, undefined, 'the sweep timer is gone, not merely longer');
      // Fast enough that a panel opening under the ring is caught, slow
      // enough that it is not a measurement per frame.
      assert.ok(tour.TOUR_REMEASURE_MS >= 100 && tour.TOUR_REMEASURE_MS <= 500);
      assert.ok(tour.TOUR_RESCROLL_QUIET_MS >= 500, 'the reader gets the page to themselves first');
    },
  },
  {
    name: 'firstRunTour: a rectangle that only jittered has not moved',
    run() {
      const rect = { x: 12, y: 340, width: 372, height: 208 };
      assert.equal(tour.rectChanged(rect, rect), false);
      assert.equal(tour.rectChanged(rect, { ...rect }), false);
      assert.equal(tour.rectChanged(rect, { ...rect, y: 340.4 }), false, 'sub-pixel jitter is not a move');
      assert.equal(tour.rectChanged(rect, { ...rect, height: 560 }), true, 'a list folding open is');
      assert.equal(tour.rectChanged(null, rect), true);
      assert.equal(tour.rectChanged(rect, null), true);
      assert.equal(tour.rectChanged(null, null), false);
    },
  },
  {
    /**
     * The signal for a second scroll: the callout, clamped into the band,
     * ended up on top of the thing it points at.
     */
    name: 'firstRunTour: a callout clamped back over its own target is caught',
    run() {
      const target = { x: 0, y: 100, width: 300, height: 200 };
      assert.equal(tour.calloutCoversTarget({ top: 320, above: false }, target, 120), false, 'clear below');
      assert.equal(tour.calloutCoversTarget({ top: 12, above: true }, target, 80), false, 'clear above');
      assert.equal(tour.calloutCoversTarget({ top: 250, above: false }, target, 120), true, 'clamped up into it');
      assert.equal(tour.calloutCoversTarget({ top: 12, above: true }, target, 120), true, 'clamped down into it');
    },
  },
  {
    name: 'firstRunTour: the ring is a circle on one control only when that control was found',
    run() {
      const hero = tour.resolveTourBeats('home', { hasProgram: true })[2];
      assert.equal(tour.sectionRingShape(hero, true), 'chevron');
      assert.equal(tour.sectionRingShape(hero, false), 'section', 'no chevron on this install: ring the section');
      // The start beat rings itself, so it is an outline and not a glyph.
      const start = tour.resolveTourBeats('home', { hasProgram: true })[1];
      assert.equal(tour.sectionRingShape(start, true), 'section');
      const week = tour.resolveTourBeats('home', { hasProgram: true })[0];
      assert.equal(tour.sectionRingShape(week, true), 'section');
      // A chevron's ring is the tap target around a 16 dp glyph, not a box.
      const chevron = tour.ringBox({ x: 300, y: 400, width: 16, height: 16 }, 'chevron');
      assert.equal(chevron.width, tour.RING_CHEVRON_DIAMETER);
      assert.equal(chevron.x + chevron.width / 2, 308);
      assert.ok(chevron.width >= 44, 'a 44 dp target, the same minimum the app uses everywhere');
    },
  },
  {
    /**
     * The dim is one path with the ring punched out of it, so even-odd cuts a
     * hole rather than painting a second shape. Both subpaths share the
     * hole's frame — the caller draws it under `translate(hole.x hole.y)`.
     */
    name: 'firstRunTour: the dim layer is the whole overlay minus the ring, in one path',
    run() {
      const overlay = { width: 400, height: 800 };
      const section = tour.dimCutoutPath(overlay, { x: 20, y: 100, width: 300, height: 60 }, 'section');
      assert.ok(section.startsWith('M -20 -100 H 380 V 700 H -20 Z '), section.slice(0, 60));
      // cutCornerPath's own opening move, i.e. the hole follows the frame.
      assert.ok(section.includes(' M 20 0 '), 'the cut-corner hole is in the same d');
      assert.equal(section.split('Z').length - 1, 2, 'exactly two closed subpaths');

      const circle = tour.dimCutoutPath(overlay, { x: 10, y: 20, width: 44, height: 44 }, 'chevron');
      assert.ok(circle.startsWith('M -10 -20 H 390 V 780 H -10 Z '));
      assert.ok(circle.includes('A 22 22 0 1 0'), 'a full circle, drawn as two arcs');
    },
  },
  {
    name: 'firstRunTour: the callout sits below when it fits and flips above when it does not',
    run() {
      const screen = { screenHeight: 800, barTop: 720, calloutHeight: 120 };
      const high = tour.placeCallout({ ...screen, target: { x: 20, y: 100, width: 350, height: 60 }, prefer: 'below' });
      assert.equal(high.above, false);
      assert.equal(high.top, 100 + 60 + tour.CALLOUT_GAP);

      // A target near the bar: below would cross the 24 dp floor, so it flips.
      const low = tour.placeCallout({ ...screen, target: { x: 20, y: 600, width: 350, height: 80 }, prefer: 'below' });
      assert.equal(low.above, true);
      assert.equal(low.top, 600 - tour.CALLOUT_GAP - 120);

      // Preference honoured when both fit.
      const mid = tour.placeCallout({ ...screen, target: { x: 20, y: 380, width: 350, height: 60 }, prefer: 'above' });
      assert.equal(mid.above, true);
    },
  },
  {
    name: 'firstRunTour: the callout never crosses the gesture-bar floor or the status band',
    run() {
      const tall = tour.placeCallout({
        target: { x: 20, y: 300, width: 350, height: 400 },
        calloutHeight: 160,
        screenHeight: 800,
        barTop: 720,
        prefer: 'below',
      });
      assert.ok(tall.top + 160 <= 720 - tour.GESTURE_BAR_FLOOR, 'stays above the bar with its floor');
      assert.ok(tall.top >= tour.CALLOUT_TOP_MIN);

      const noBar = tour.placeCallout({
        target: { x: 20, y: 700, width: 350, height: 80 },
        calloutHeight: 120,
        screenHeight: 800,
        barTop: null,
        prefer: 'below',
      });
      assert.ok(noBar.top + 120 <= 800 - tour.GESTURE_BAR_FLOOR);
      assert.equal(tour.GESTURE_BAR_FLOOR, 24);
    },
  },
  {
    name: 'firstRunTour: the ring pads a section and is a fixed circle on a bar item, larger on the AI orb',
    run() {
      const section = tour.ringBox({ x: 20, y: 100, width: 300, height: 80 }, 'section');
      assert.deepEqual(section, { x: 13, y: 93, width: 314, height: 94 });
      const tab = tour.ringBox({ x: 100, y: 700, width: 58, height: 64 }, 'bar');
      assert.equal(tab.width, tour.RING_BAR_DIAMETER);
      assert.equal(tab.x + tab.width / 2, 129);
      const ai = tour.ringBox({ x: 100, y: 700, width: 58, height: 64 }, 'bar-ai');
      // The orb's halo is 58; a 50 ring sat inside it in the design build.
      assert.ok(ai.width > 58);
    },
  },
  {
    name: 'firstRunTour: the notch points at the target centre and stays inside the callout',
    run() {
      const width = 352;
      assert.equal(tour.notchOffset({ x: 20, y: 0, width: 200, height: 10 }, 20, width), 100);
      assert.equal(tour.notchOffset({ x: 0, y: 0, width: 4, height: 10 }, 20, width), 18);
      assert.equal(tour.notchOffset({ x: 800, y: 0, width: 4, height: 10 }, 20, width), width - 18);
    },
  },
  {
    name: 'firstRunTour: scrolling lifts a below-target higher than an above-target and never past the top',
    run() {
      assert.equal(tour.scrollOffsetForTarget(0, 500, 'below'), 500 - 132);
      assert.equal(tour.scrollOffsetForTarget(0, 500, 'above'), 500 - 240);
      assert.equal(tour.scrollOffsetForTarget(0, 40, 'below'), 0);
      assert.equal(tour.scrollOffsetForTarget(300, 40, 'below'), 300 + 40 - 132);
    },
  },
  {
    name: 'firstRunTour: stored seen-lists are normalised to known surfaces without duplicates',
    run() {
      assert.deepEqual(tour.normalizeFirstRunToursSeen(undefined), []);
      assert.deepEqual(tour.normalizeFirstRunToursSeen('home'), []);
      // 'profile' and 'progress' were surfaces before 2026-10-03; an old
      // install's list drops them rather than carrying unknown names.
      assert.deepEqual(tour.normalizeFirstRunToursSeen(['home', 'home', 'garden', 7, 'profile', 'progress']), ['home']);
    },
  },
  {
    name: 'firstRunTour: seen once is seen',
    run() {
      assert.equal(tour.isTourDue([], 'home'), true);
      const seen = tour.markTourSeen([], 'home');
      assert.deepEqual(seen, ['home']);
      assert.deepEqual(tour.markTourSeen(seen, 'home'), ['home']);
      assert.equal(tour.isTourDue(seen, 'home'), false);
    },
  },
  {
    name: "firstRunTour: only Home's dashboard is a tour surface",
    run() {
      assert.equal(tour.resolveTourSurface({ tab: 'home', screen: 'dashboard' }), 'home');
      assert.equal(tour.resolveTourSurface({ tab: 'home', screen: 'ai_chat' }), null);
      assert.equal(tour.resolveTourSurface({ tab: 'progress', screen: 'list' }), null);
      assert.equal(tour.resolveTourSurface({ tab: 'progress', screen: 'list', section: 'overview' }), null);
      assert.equal(tour.resolveTourSurface({ tab: 'profile', screen: 'list' }), null);
      assert.equal(tour.resolveTourSurface({ tab: 'profile', screen: 'settings' }), null);
      assert.equal(tour.resolveTourSurface({ tab: 'workout', screen: 'list' }), null);
    },
  },
];
