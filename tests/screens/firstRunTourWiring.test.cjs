const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * The first-run tour touches six files that Node cannot run. These guards
 * read them, and each one claims a sliced region rather than a whole file,
 * so a comment cannot satisfy its own guard (feedback-guards-that-pass-themselves).
 */
const ROOT = path.join(__dirname, '..', '..');
// Working copies are CRLF on Windows (core.autocrlf); the markers below are LF.
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const tourSource = read('src/components/FirstRunTour.tsx');
const homeSource = read('src/screens/HomeScreen.tsx');
const progressSource = read('src/screens/ProgressScreen.tsx');
const profileSource = read('src/screens/ProfileScreen.tsx');
const barSource = read('src/components/BottomTabBar.tsx');
const shellSource = read('src/components/AppShell.tsx');
const appSource = read('App.tsx');
// App.tsx plus the src/app modules: phase C (2026-10-01) moved the tour's gate,
// the prompt queue and the layer's element to src/app hooks, the <HomeScreen>
// element to src/app/renderHomeDashboard.tsx and the shell's return (tab bar,
// overlay slot, sheets) to src/app/renderAppShell.tsx.
const wiringSource = readAppWiring().replace(/\r\n/g, '\n');
const { between } = require('../helpers/sourceSlices.cjs');
const settingsSource = read('src/screens/SettingsScreen.tsx');
const databaseSource = read('src/storage/database.ts');

/**
 * The <HomeScreen …/> element, sliced out of the ONE shell file (App.tsx or a
 * src/app module) that renders it, so the slice cannot run on across a join of
 * the wiring. `<HomeScreen` followed by whitespace — the bare prefix also
 * matches `HomeScreenProps` type annotations. It ends at the first `/>` after
 * the tag (none of its props renders JSX), which must sit at the tag's own
 * indentation.
 */
function homeScreenElement() {
  const files = [
    'App.tsx',
    ...fs
      .readdirSync(path.join(ROOT, 'src', 'app'))
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .sort()
      .map((name) => `src/app/${name}`),
  ];
  const opening = /<HomeScreen\s/g;
  const renderers = files.map(read).filter((source) => (source.match(opening) || []).length > 0);
  assert.equal(renderers.length, 1, 'HomeScreen is rendered from exactly one shell file');
  const source = renderers[0];
  assert.equal((source.match(opening) || []).length, 1, 'HomeScreen is rendered once in the shell');
  const start = source.search(/<HomeScreen\s/);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  assert.match(indent, /^[ \t]*$/, '<HomeScreen does not open its own line');
  const end = source.indexOf('/>', start);
  assert.ok(end > start, 'the <HomeScreen element does not close');
  assert.equal(source.slice(source.lastIndexOf('\n', end) + 1, end), indent, '<HomeScreen did not close at its own indentation');
  return source.slice(start, end);
}

/** The JSX the layer returns while a beat is showing. */
function tourRender() {
  const start = tourSource.indexOf('  return (\n    <View ref={rootRef}');
  const end = tourSource.indexOf('const styles = StyleSheet.create', start);
  assert.ok(start > 0 && end > start, 'tour render block not found');
  return stripComments(tourSource.slice(start, end));
}

module.exports = [
  {
    /**
     * This guard used to assert the opposite, and the reversal is the point.
     * Round 1's layer never blocked; round 2's walk on the phone showed what
     * that costs, because the page moves under a beat for reasons the layer
     * cannot see, and a day block folded open is taller than the whole band —
     * there is nowhere for its callout to stand. The reader chose a tour that
     * simply runs (2026-09-08). So the dim doubles as a shield.
     */
    name: 'first-run tour: the layer is guided — it dims the page and takes its touches',
    run() {
      const render = tourRender();
      assert.match(render, /<View ref=\{rootRef\} pointerEvents="box-none" style=\{StyleSheet\.absoluteFill\}/);
      // The shield: full screen, the responder for anything that reaches it,
      // and the ring's shape cut out so the beat's subject still shows.
      assert.match(
        render,
        /pointerEvents="auto"\s*onStartShouldSetResponder=\{\(\) => true\}\s*style=\{\[StyleSheet\.absoluteFill, dimStyle\]\}/,
      );
      assert.match(render, /dimCutoutPath\(size, ring, spot\.shape\)/);
      assert.match(render, /fillRule="evenodd"/);
      // Not a Pressable: a shield is not a control and must not be announced
      // as one, nor take a press the reader meant for the page.
      assert.doesNotMatch(render, /<Pressable[^>]*StyleSheet\.absoluteFill/);
      // The ring is inert; the shield beneath it is what blocks.
      assert.match(render, /pointerEvents="none"[\s\S]{0,200}styles\.ring/);
      // Two views reading one value through two style objects — never one
      // interpolated node handed to two views (ref-animated-node-one-view).
      const body = stripComments(tourSource);
      assert.match(body, /const dimStyle = useRef\(\{ opacity: ringAnim \}\)\.current;/);
    },
  },
  {
    /**
     * A shield makes an instruction to tap the page a lie: nothing under the
     * layer can be pressed while a beat is up. Beats have opened with one
     * twice now — round 1's "Napauta viikkoriviä…", and again in the copy
     * the reader handed over on 2026-09-08 — so this reads every beat's
     * sentence in both languages rather than the two that were wrong.
     */
    name: 'first-run tour: no beat tells the reader to tap something the shield refuses',
    run() {
      // Matched as entries, not as lines. A long sentence is wrapped onto a
      // continuation line, and a line-based scan then reads the key and misses
      // every word of the copy — two of these are wrapped today, so the scan
      // that shipped an hour ago was checking fourteen beats out of sixteen.
      const dict = read('src/lib/i18n.ts');
      const entries = [...dict.matchAll(/'(tour\.(?:home|progress|profile)\.[a-zA-Z]+)':\s*(['"])([\s\S]*?)\2,/g)];
      // Home's five section beats; Progress and Profile lost theirs on
      // 2026-10-03, and the pattern still matches them so a revival is seen.
      assert.equal(entries.length, 10, 'five section beats in two dictionaries');
      for (const [, key, , text] of entries) {
        assert.ok(text.length > 20, `${key} is suspiciously short, did the match stop early: ${text}`);
        // Verbs that ask for a press. "Painamalla X voit…" describes what a
        // button does and is fine; "Paina X" is an order the shield refuses.
        assert.doesNotMatch(text, /(?<![\p{L}])(Napauta|Napsauta|Klikkaa|Valitse|Pidä|Tap|Click|Hold)(?![\p{L}])/u, `${key}: ${text}`);
        assert.doesNotMatch(text, /(^|[.;]\s+)(Paina|Press) /, `${key}: ${text}`);
      }
      // The way out is still one tap, and it is on every beat — a guided tour
      // that could not be left would be a trap.
      assert.match(tourRender(), /onPress=\{skip\}[\s\S]{0,400}'tour\.skip'/);
    },
  },
  {
    /**
     * Three of the reader's five reports were the same bug: the page moved
     * under a beat — a month panel opening into the week card, a workout list
     * folding — and the ring stayed where it was first measured. Scroll events
     * do not report any of that, so the beat re-measures on a tick.
     */
    name: 'first-run tour: a section beat keeps measuring its target, and only writes when it moved',
    run() {
      const layer = stripComments(tourSource);
      const follow = layer.slice(layer.indexOf('const sync = () => {'), layer.indexOf('clearInterval(timer);'));
      assert.ok(follow.length > 80, 'the follow effect moved - recheck by hand');
      assert.match(follow, /setInterval\(sync, TOUR_REMEASURE_MS\)/);
      assert.match(follow, /readSpot\(beat, \{ fallback: false \}\)/);
      // And not before the beat's own opening scroll has landed its first
      // reading: a ring measured mid-scroll sits across two sections.
      assert.match(follow, /if \(cancelled \|\| inFlight \|\| !beatReadyRef\.current\)/);
      // The tick is the only measurement clock: measuring on the scroll event
      // as well re-rendered a full-screen path thirty times a second. The
      // subscription is there to note when the reader last touched the page.
      assert.match(follow, /registry\.subscribeScroll\(\(\) => \{\s*lastScrollAtRef\.current = Date\.now\(\);\s*\}\);/);
      assert.match(follow, /sameSpot\(current, next\) \? current : next/, 'an unchanged rect is not a re-render');

      // And what a measurement is: the ring's target, the callout's anchor,
      // with the anchor standing in when the fine target is not on screen.
      const read = layer.slice(layer.indexOf('const readSpot = useCallback('), layer.indexOf('const finish = useCallback('));
      assert.match(read, /registry\.measure\(beat\.target\)/);
      assert.match(read, /registry\.measure\(beat\.anchor as TourTargetId\)/);
      assert.match(read, /const ringWindow = targetRect \?\? anchorRect;/);
      // ...but only when a beat opens. A ref re-attaching mid-render answers
      // nothing for a frame, and a partial reading on the tick would make the
      // ring flit between the chevron and the whole block.
      assert.match(
        read,
        /if \(!options\.fallback && \(!targetRect \|\| \(wantsAnchor && !anchorRect\)\)\) \{\s*return null;/,
      );
      assert.match(read, /sectionRingShape\(beat, targetRect !== null\)/);

      // A callout clamped back over its target buys exactly one more scroll.
      const rescroll = layer.slice(layer.indexOf('if (!calloutCoversTarget('), layer.indexOf('const ringShape = spot?.shape'));
      assert.match(rescroll, /rescrolledForRef\.current === spot\.anchor\.height/);
      assert.match(rescroll, /Date\.now\(\) - lastScrollAtRef\.current < TOUR_RESCROLL_QUIET_MS/);
    },
  },
  {
    /**
     * The hero beat rings the workout row's fold and asks to be tapped, so the
     * ring breathes — and the block is shut before the beat starts, through a
     * prop rather than the layer reaching into a screen's state.
     */
    name: 'first-run tour: the hero beat rings the workout fold, which pulses, on a block the screen has shut',
    run() {
      const home = stripComments(homeSource);
      assert.match(home, /register\('home\.workoutChevron', node\)/);
      // The start button answers to two names: its own beat when there is a
      // plan, and the hero itself when there is not — with no plan the day
      // block does not exist and that row IS the block.
      assert.match(home, /register\(heroStartsSession \? 'home\.startCta' : 'home\.hero', node\)/);
      const fold = home.slice(home.indexOf("if (tourFocus !== 'home.hero') {"), home.indexOf('}, [tourFocus]);'));
      assert.ok(fold.length > 40, "Home's tour fold moved - recheck by hand");
      assert.match(fold, /setWorkoutListOpen\(false\);/);
      assert.match(fold, /setOpenBlock\(null\);/);

      const app = stripComments(wiringSource);
      assert.match(app, /onBeatChange=\{setTourFocus\}/);
      assert.match(app, /tourFocus=\{tourFocus\}/);

      const layer = stripComments(tourSource);
      const pulse = layer.slice(layer.indexOf('const ringShape = spot?.shape ?? null;'), layer.indexOf('const advance = useCallback('));
      assert.ok(pulse.length > 80, 'the pulse effect moved - recheck by hand');
      assert.match(pulse, /ringShape !== 'chevron'/);
      assert.match(pulse, /reduceMotion !== false/, 'no loop under reduced motion');
      assert.match(pulse, /Animated\.loop\(/);
      assert.match(pulse, /loop\.stop\(\);/, 'the loop is stopped when the beat leaves');
      // Its own value, on the ring's own view, resting at 0 so the transform
      // is never conditional (ref-animated-node-one-view).
      assert.match(layer, /const pulseAnim = useRef\(new Animated\.Value\(0\)\)\.current;/);
      assert.match(layer, /outputRange: \[1, RING_PULSE_SCALE\]/);
    },
  },
  {
    /**
     * The bar sweep used to walk itself. 1800 ms per stop was too fast, 2600
     * was still too fast, and a reader who needed longer had no way to ask
     * (user 2026-09-09) — so the timer is gone rather than retuned again, and
     * nothing on this screen advances on its own.
     */
    name: 'first-run tour: the bar sweep waits for the reader',
    run() {
      const layer = stripComments(tourSource);
      // Sliced on code, not on a comment: stripComments has already removed
      // the comments this used to bound itself with, and an unbounded slice
      // reaches other effects' timers and passes for the wrong reason.
      const barStart = layer.indexOf("if (!beat || beat.kind !== 'bar')");
      const barBeat = layer.slice(barStart, layer.indexOf('pendingShowRef.current === null', barStart));
      assert.ok(barBeat.length > 200, 'the bar effect moved - recheck by hand');
      assert.doesNotMatch(barBeat, /setTimeout|setInterval|BAR_SWEEP/, 'no timer drives the sweep');
      assert.doesNotMatch(layer, /BAR_SWEEP_STOP_MS/);
      // The button is what moves it, one stop at a time.
      assert.match(
        layer,
        /beat\.kind === 'bar' && reduceMotion === false && stopIndex < beat\.stops\.length - 1\) \{\s*setStopIndex\(stopIndex \+ 1\);/,
      );
    },
  },
  {
    name: 'first-run tour: every beat advances from its own button, and the way out is on every beat',
    run() {
      const render = tourRender();
      assert.match(render, /onPress=\{advance\}/);
      assert.match(render, /onPress=\{skip\}[\s\S]{0,400}'tour\.skip'/);
      // A 44 dp target on a small underlined link: padding plus hitSlop.
      assert.match(render, /hitSlop=\{\{ top: 12, bottom: 12, left: 12, right: 12 \}\}/);
      assert.match(render, /'tour\.done' : 'tour\.next'/);
    },
  },
  {
    name: 'first-run tour: the accent is the theme\'s pressable colour, and its ink comes with it',
    run() {
      const body = stripComments(tourSource);
      assert.match(body, /const accent = theme\.highlight;/);
      // The button is the shared cut button in its accent variant, which
      // pairs theme.highlight with theme.onHighlight in one place.
      assert.match(tourRender(), /<CutButton size="md" variant="accent"/);
      const cutButton = stripComments(read('src/components/CutButton.tsx'));
      assert.match(cutButton, /variant === 'accent'\s*\?\s*theme\.highlight/);
      assert.match(cutButton, /variant === 'accent'\s*\?\s*theme\.onHighlight/);
      // The light callout is the app's own dark-violet layer; dark lifts.
      assert.match(body, /theme\.proSheetTop/);
      assert.match(body, /theme\.purpleLight/);
      assert.doesNotMatch(body, /#FF8A4C|#6D28D9/, 'no hex accents — the theme decides');
    },
  },
  {
    name: 'first-run tour: the bar sweep runs on the bar\'s own highlight and hands it back when done',
    run() {
      const bar = stripComments(barSource);
      assert.match(bar, /const activeKey = sweep \? sideTabs\.find\(\(tab\) => tab\.stop === sweep\)\?\.key \?\? null : routeKey;/);
      assert.match(bar, /const aiLit = aiActive \|\| sweep === 'ai';/);
      for (const id of ['bar.pill', 'bar.ai']) {
        assert.match(bar, new RegExp(`tourTargets\\?\\.register\\('${id.replace('.', '\\.')}', node\\)`), id);
      }
      assert.match(bar, /onRef=\{\(node\) => tourTargets\?\.register\(`bar\.\$\{tab\.stop\}`, node\)\}/);
      // The layer hands back everything it borrowed on every exit: the
      // bar's highlight, and the screen's knowledge of which beat is on.
      const layer = stripComments(tourSource);
      assert.match(layer, /onSweep\(null\);\s*onBeatChange\?\.\(null\);\s*setPhase\('done'\)/);
      assert.match(layer, /useEffect\(\(\) => \(\) => beatChangeRef\.current\?\.\(null\), \[\]\);/);
    },
  },
  {
    name: 'first-run tour: leaving counts as seen only once a callout has been on screen',
    run() {
      // PR #83 review: unmounting during the start delay marked the surface
      // seen with nothing shown, so flicking through the tabs on a first open
      // burned all three tours. The unmount path is gated on a shown flag
      // that the enter effect sets.
      const layer = stripComments(tourSource);
      const unmount = layer.slice(layer.indexOf('const shownRef = useRef(false);'), layer.indexOf('// Reduced motion decides'));
      assert.match(unmount, /if \(shownRef\.current\) \{\s*finishRef\.current\(\);\s*\}/);
      assert.doesNotMatch(unmount, /\(\) => \(\) => finishRef\.current\(\)/, 'no unconditional finish on unmount');
      const enter = layer.slice(layer.indexOf('pendingShowRef.current = null;'), layer.indexOf('Animated.parallel([', layer.indexOf('pendingShowRef.current = null;')));
      assert.match(enter, /shownRef\.current = true;/);
    },
  },
  {
    name: 'first-run tour: Home registers its five targets and its scroller',
    run() {
      const home = stripComments(homeSource);
      for (const id of ['home.week', 'home.program', 'home.cards']) {
        assert.match(home, new RegExp(`register\\('${id.replace('.', '\\.')}', node\\)`), id);
      }
      // The session box is the hero when a plan exists.
      assert.match(home, /register\('home\.hero', node\)/);
      assert.match(home, /useTourScroller\('home', tourTargets\)/);
      assert.match(home, /onScroll=\{tourScroller\.onScroll\}/);
      // The last section has nothing under it to be lifted against, so the
      // scroller can also just go to the end of the list.
      const hook = stripComments(read('src/features/tour/useTourScroller.ts'));
      assert.match(hook, /scrollToEnd: \(animated\) => ref\.current\?\.scrollToEnd\(\{ animated \}\)/);
      const registry = stripComments(read('src/features/tour/tourTargets.ts'));
      assert.match(registry, /if \(mode === 'end'\) \{\s*scroller\.scrollToEnd\(animated\);/);
    },
  },
  {
    // User 2026-10-03: the tour runs on Home only. Progress and Profile kept
    // two beats each until then; neither screen registers anything now.
    name: 'first-run tour: Progress and Profile carry no tour targets or scrollers',
    run() {
      for (const source of [progressSource, profileSource]) {
        const screen = stripComments(source);
        assert.doesNotMatch(screen, /tourTargets/);
        assert.doesNotMatch(screen, /useTourScroller/);
      }
      // The one hook is where the scroller is registered and the offset kept.
      const hook = stripComments(read('src/features/tour/useTourScroller.ts'));
      assert.match(hook, /tourTargets\.registerScroller\(surface, \{/);
      assert.match(hook, /offsetRef\.current = event\.nativeEvent\.contentOffset\.y;\s*tourTargets\?\.notifyScroll\(\);/);
    },
  },
  {
    name: 'first-run tour: the layer is drawn above the bar, only on a due surface, and goes first in Home\'s prompt queue',
    run() {
      const shell = stripComments(shellSource);
      assert.match(shell, /\{tabBar\}\s*\{overlay\}/);
      const app = stripComments(appSource);
      // The terms sheet takes the slot while it is owed (2026-09-26); the
      // tour waits for it, so the two are never both due. The overlay slot is
      // in the shell's return, which moved to src/app/renderAppShell.tsx.
      assert.match(stripComments(wiringSource), /legalConsentDue \? renderLegalConsent\(shellSafeAreaEdges\.includes\('bottom'\)\) : tourElement/);
      // Bounded on both anchors, in the whole shell (phase-C split, 2026-10-01).
      const wiring = stripComments(wiringSource);
      assert.match(between(wiring, 'const tourActive =', 'const homeTourActive'), /legalConsentDue === null/);
      const trigger = between(wiring, 'const tourActive =', 'const homeTourActive');
      assert.match(trigger, /brandSplashDone/);
      assert.match(trigger, /!onboardingActive/);
      assert.match(trigger, /!setupHandoffActive/);
      assert.match(trigger, /isTourReady\(preferences\.firstRunToursSeen, tourSurface\)/);
      // The three Home cards wait for the tour: the two queued ones through
      // the queue itself (lib/homePrompts), the widget card at its own gate.
      const queue = between(wiring, 'const homePrompt = resolveHomePrompt(', '});');
      assert.match(queue, /tourActive: homeTourActive/);
      // Home's own JSX is the <HomeScreen …/> element, read from the one file
      // that renders it. It used to run from <HomeScreen to the shell's
      // <SettingsImportSheet>, which since phase C sit in different files; the
      // tab bar it also spanned is pinned on its own below.
      const homeJsx = stripComments(homeScreenElement());
      assert.match(homeJsx, /!homeTourActive && homeWidgetState\?\.supported/);
      assert.match(homeJsx, /tourTargets=\{tourRegistry\}/);
      assert.match(stripComments(wiringSource), /<BottomTabBar[\s\S]{0,900}tourTargets=\{tourRegistry\}/);
      const prompts = stripComments(read('src/lib/homePrompts.ts'));
      assert.match(prompts, /if \(input\.tourActive\) \{\s*return null;\s*\}/);
    },
  },
  {
    name: 'first-run tour: Settings offers the replay, and the loader normalises the seen-list through lib',
    run() {
      const settings = stripComments(settingsSource);
      assert.match(settings, /'settings\.replayTour'[\s\S]{0,300}onPress=\{onReplayTour\}/);
      const loader = stripComments(databaseSource);
      assert.match(loader, /firstRunToursSeen: normalizeFirstRunToursSeen\(input\?\.preferences\?\.firstRunToursSeen\)/);
    },
  },
];
