const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between } = require('../helpers/sourceSlices.cjs');

/**
 * The workout tour touches the player, the shell and the layer - files Node
 * cannot run. These guards read them, each over a sliced region so a comment
 * cannot satisfy its own guard (feedback-guards-that-pass-themselves).
 */
const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (source) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '{}')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const player = stripComments(read('src/screens/GuidedPlayerScreen.tsx'));
const layer = stripComments(read('src/components/FirstRunTour.tsx'));
const reporter = stripComments(read('src/features/tour/GuidedTourReport.tsx'));
const wiring = stripComments(readAppWiring().replace(/\r\n/g, '\n'));
const overlays = stripComments(read('src/app/useSetupHandoffOverlays.tsx'));

/** SetStepView's own source, from its signature to the next top-level function. */
function setStepView() {
  return between(player, 'function SetStepView({', 'function FinishView(');
}

module.exports = [
  {
    name: 'workout tour: the set screen registers the five things the beats ring, as real views, once',
    run() {
      const set = setStepView();
      const views = [
        ['workout.name', 'nameRef', 'setExerciseTop'],
        ['workout.history', 'historyRef', 'setExerciseRows'],
        ['workout.setRow', 'setRowRef', 'setMetaRow'],
        ['workout.dials', 'dialsRef', 'setDialRow'],
        ['workout.log', 'logRef', 'setControls'],
      ];
      for (const [id, ref, style] of views) {
        // Made once per mount, not per render: an inline ref callback is a new
        // function every render, and the player renders every second.
        assert.match(set, new RegExp(`const ${ref} = useTourTarget\\(tourTargets, '${id.replace('.', '\\.')}'\\);`), id);
        // collapsable={false}: a View with only layout props is flattened away
        // on Android and there is nothing left to measure. And each ref is on
        // the view the beat's copy describes.
        assert.match(set, new RegExp(`ref=\\{${ref}\\}\\s+collapsable=\\{false\\}\\s+style=\\{styles\\.${style}\\}`), id);
      }
      assert.doesNotMatch(set, /tourTargets\?\.register\(/, 'no inline registering');
      assert.equal((set.match(/useTourTarget\(/g) || []).length, 5);
      // The hook memoises on the registry and the id.
      assert.match(reporter, /return useCallback\(\(node: unknown\) => tourTargets\?\.register\(id, node\), \[tourTargets, id\]\);/);
    },
  },
  {
    name: 'workout tour: the rest beat rings the controls block - the -15s / +15s / Pause row and Skip rest',
    run() {
      assert.match(player, /const restControlsRef = useTourTarget\(tourTargets, 'workout\.rest'\);/);
      // The block's own view: the row of buttons and the skip button inside it,
      // not the countdown ring above.
      const rest = between(player, "{step.type === 'rest' && (", '<ProgressRail');
      assert.match(
        rest,
        /<View\s+ref=\{restControlsRef\}\s+collapsable=\{false\}\s+style=\{\{ paddingHorizontal: 24, paddingBottom: 10, gap: 12 \}\}\s*>/,
      );
      const block = rest.slice(rest.indexOf('ref={restControlsRef}'));
      assert.match(block, /label="−15s"/);
      assert.match(block, /label="\+15s"/);
      assert.match(block, /onPress=\{startRestNextSet\}/);
      assert.doesNotMatch(block, /<RestRing/, 'the ring is outside the block');
      // And the ring no longer carries a tour handle.
      const ring = between(player, 'function RestRing({', 'function TopBar({');
      assert.doesNotMatch(ring, /tourRef/);
    },
  },
  {
    name: 'workout tour: only a plain set or rest is reported, and nothing is reported while the player is held',
    run() {
      const set = setStepView();
      // Not a superset round, not a clock, not a hold.
      assert.match(set, /<GuidedTourReport[\s\S]{0,200}kind="set"[\s\S]{0,120}plain=\{!superset && !minutesMode && !timed\}/);
      // What the beats' sentences depend on.
      assert.match(set, /canWarmUp=\{canWarmUp\}\s+canRemove=\{Boolean\(onRemoveSet\)\}\s+loaded=\{!bodyweight\}\s+hasHistory=\{Boolean\(panels\?\.history\)\}/);
      // An interval bout is a different step view altogether.
      assert.match(player, /\{step\.type === 'set' && !step\.interval && \(\s*<SetStepView/);
      // A rest with a recovery kind is an interval's easy half: no buttons to describe.
      assert.match(player, /<GuidedTourReport report=\{frozen \? undefined : onTourStep\} kind="rest" plain=\{!step\.recoveryKind\} \/>/);
      // A sheet open, the workout paused, the permission ask up: the tour steps aside.
      assert.match(player, /tourReport=\{frozen \? undefined : onTourStep\}/);
      // And the reporter takes its report back when held or unmounted.
      assert.match(reporter, /if \(!report \|\| !plain\) \{\s*return undefined;\s*\}\s*report\(\{ kind, canWarmUp, canRemove, loaded, hasHistory \}\);\s*return \(\) => report\(null\);/);
    },
  },
  {
    name: 'workout tour: the rest clock is never touched by the tour',
    run() {
      for (const [name, source] of [['layer', layer], ['reporter', reporter]]) {
        assert.doesNotMatch(source, /pauseWorkout|\bpause\(|adjustRemaining|endsAtRef|setRemainingMs/, name);
      }
      // The rest tour hangs off the same step the clock runs on: when the rest
      // ends the step changes, the report is withdrawn, and the layer closes.
      assert.match(reporter, /return \(\) => report\(null\);/);
      // The player reports through a plain prop; it freezes nothing for the tour.
      const frozen = between(player, 'const frozen = guidedClockHeld({', '});');
      assert.doesNotMatch(frozen, /tour/i);
    },
  },
  {
    name: 'workout tour: the shell decides from the route and the reported step, for a reader owed it',
    run() {
      const trigger = between(overlays, 'const tourSurface =', 'const homeTourActive');
      assert.match(trigger, /resolveTourSurface\(route\) \?\? resolveWorkoutTourSurface\(route, workoutTourStep\)/);
      // Eligibility: no programme workout behind the reader, or a replay.
      assert.match(trigger, /isWorkoutTourEligible\(\{\s*replayed: preferences\.firstRunToursReplayed,\s*sessions: database\.workoutSessions,\s*templates: database\.workoutTemplates,/);
      assert.match(trigger, /workoutTourOwed &&/);
      assert.match(trigger, /isTourReady\(preferences\.firstRunToursSeen, tourSurface\)/);
      // Same gates as Home: splash, onboarding, hand-off, terms.
      assert.match(trigger, /brandSplashDone/);
      assert.match(trigger, /!onboardingActive/);
      assert.match(trigger, /!setupHandoffActive/);
      assert.match(trigger, /legalConsentDue === null/);
      // The one layer: the same element, keyed by surface so each starts fresh.
      assert.match(overlays, /<FirstRunTour\s+key=\{tourSurface\}\s+surface=\{tourSurface\}/);
      assert.equal((overlays.match(/<FirstRunTour\b/g) || []).length, 1);
    },
  },
  {
    name: 'workout tour: a finish writes through updatePreferences, and a skip carries the rest tour with it',
    run() {
      const finish = between(overlays, 'const handleTourFinish = useCallback(', 'const tourElement');
      assert.match(finish, /\(surface: TourSurface, reason: TourFinishReason = 'done'\)/);
      assert.match(finish, /markToursSeen\(seen, surfacesSeenOnFinish\(surface, reason\)\)/);
      assert.match(finish, /void updatePreferences\(\{ firstRunToursSeen: next \}\)/);
      // The layer's own Skip is the only 'skipped'.
      assert.match(layer, /const skip = useCallback\(\(\) => finish\('skipped'\), \[finish\]\);/);
      assert.match(layer, /onFinish\(surface, reason\);/);
      assert.match(layer, /\(reason: TourFinishReason = 'done'\) =>/);
      const buttons = between(layer, 'onPress={skip}', 'onPress={advance}');
      assert.match(buttons, /'tour\.skip'/);
      // No other caller says 'skipped'.
      assert.equal((layer.match(/'skipped'/g) || []).length, 1);
    },
  },
  {
    name: 'workout tour: the layer starts after the step has settled and rings inside the page margin',
    run() {
      assert.match(layer, /setTimeout\(\(\) => setPhase\('beat'\), tourStartDelayMs\(reduceMotion, surface\)\)/);
      const read = between(layer, 'const readSpot = useCallback(', 'const finish = useCallback(');
      assert.match(read, /const targetRect = measuredTarget \? insetRect\(measuredTarget, beat\.inset\) : null;/);
      // A target the step does not have is skipped, not rung on nothing.
      // Leaving mid-tour marks only what was shown (unchanged for the workout).
      assert.match(layer, /if \(shownRef\.current\) \{\s*finishRef\.current\(\);\s*\}/);
    },
  },
  {
    name: 'workout tour: the overlay is above the player, which has no tab bar of its own',
    run() {
      const shell = stripComments(read('src/components/AppShell.tsx'));
      // Children first, then the bar, then the overlay: later siblings draw on top.
      assert.match(shell, /<View style=\{styles\.content\}>\{children\}<\/View>[\s\S]*\{tabBar\}\s*\{overlay\}/);
      assert.match(wiring, /legalConsentDue \? renderLegalConsent\(shellSafeAreaEdges\.includes\('bottom'\)\) : tourElement/);
      // The player route hides the bar, so the tour's bar measurement answers null and the band runs to the screen's floor.
      const bar = between(wiring, 'const showTabBar =', 'return renderAppShell');
      assert.match(bar, /route\.screen === 'guided'/);
      // The layer reads its own origin, so the shell's safe-area padding does not offset the ring.
      assert.match(layer, /const measured = await measureNode\(rootRef\.current\);/);
      // The shield is the layer's: the workout adds no second one.
      assert.match(layer, /pointerEvents="auto"\s*onStartShouldSetResponder=\{\(\) => true\}/);
    },
  },
  {
    name: 'workout tour: the shell passes the registry and the report channel to the player only',
    run() {
      assert.match(wiring, /const \[workoutTourStep, setWorkoutTourStep\] = useState<WorkoutTourStep \| null>\(null\);/);
      assert.match(wiring, /tourTargets=\{tourRegistry\}\s+onTourStep=\{setWorkoutTourStep\}/);
      // Once: the free workout and cardio screens do not take the props.
      assert.equal((wiring.match(/onTourStep=/g) || []).length, 1);
      for (const file of ['src/screens/EmptyWorkoutScreen.tsx', 'src/screens/CardioPlayerScreen.tsx']) {
        if (fs.existsSync(path.join(ROOT, file))) {
          assert.doesNotMatch(read(file), /tourTargets|onTourStep|GuidedTourReport/, file);
        }
      }
    },
  },
  {
    name: 'workout tour: Settings replay sets the flag with the empty list, and the loader and defaults agree',
    run() {
      const profile = stripComments(read('src/app/renderProfileTab.tsx'));
      assert.match(profile, /savePreferences\(\{ firstRunToursSeen: \[\], firstRunToursReplayed: true \}\)/);
      const database = stripComments(read('src/storage/database.ts'));
      assert.match(database, /firstRunToursReplayed: input\?\.preferences\?\.firstRunToursReplayed === true,/);
      assert.match(stripComments(read('src/data/seed.ts')), /firstRunToursReplayed: false,/);
      assert.match(stripComments(read('src/state/AppProvider.tsx')), /firstRunToursReplayed: false,/);
      assert.match(stripComments(read('src/types/models.ts')), /firstRunToursReplayed: boolean;/);
    },
  },
  {
    // The player's own back listener opens its End-workout sheet; the shield
    // does not stop the hardware key, so with a callout up "back" used to
    // reach the screen under the tour.
    name: 'first-run tour: the back key with a callout up skips the tour, and the layer stays the newest listener',
    run() {
      const effect = between(layer, "if (phase !== 'beat' || !spot) {\n      return undefined;\n    }\n    const subscription = BackHandler", '  const onRootLayout');
      assert.match(effect, /BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\s*skip\(\);\s*return true;\s*\}\);/);
      assert.match(effect, /return \(\) => subscription\.remove\(\);\s*\}\);/, 'no dependency list: re-subscribed with the shell, so it stays newest');
      // Only while a callout is on screen: not during the start delay.
      assert.match(effect, /phase !== 'beat' \|\| !spot/);
      // And the player's own listener is the thing being outranked.
      assert.match(player, /BackHandler\.addEventListener\('hardwareBackPress'[\s\S]{0,400}setExitOpen\(true\)/);
    },
  },
  {
    name: 'first-run tour: a tour with nothing on screen is not marked seen, and the counter counts only what was shown',
    run() {
      const finish = between(layer, 'const finish = useCallback(', 'const skip = useCallback');
      assert.match(finish, /if \(shownRef\.current\) \{\s*onFinish\(surface, reason\);\s*\}/);
      assert.equal((layer.match(/const shownRef = useRef\(false\);/g) || []).length, 1);
      // A beat whose target is missing is passed over and counted as such.
      assert.match(layer, /if \(!next\) \{\s*setPassedOver\(\(count\) => count \+ 1\);\s*stepTo\(index \+ 1\);/);
      assert.match(layer, /\$\{index \+ 1 - passedOver\}\/\$\{shownTotal\}/);
      assert.match(layer, /const shownTotal = beats\.length - passedOver;/);
    },
  },
  {
    name: 'first-run tour: a one-beat tour has no counter and no Skip, only Done',
    run() {
      const render = stripComments(layer.slice(layer.indexOf('  return (\n    <View ref={rootRef}')));
      assert.match(render, /const single|\{single \? null/);
      assert.match(layer, /const single = beats\.length === 1;/);
      // The counter and the skip link both go; the button stays and says Done.
      assert.match(render, /\{single \? null : \(\s*<Text style=\{\[styles\.counter/);
      assert.match(render, /\{single \? null : \(\s*<Pressable[\s\S]{0,260}onPress=\{skip\}/);
      assert.match(render, /'tour\.done' : 'tour\.next'/);
      assert.match(layer, /isLast = index \+ 1 >= beats\.length/);
      // A single beat is the rest tour; Home and the set tour keep both.
      const lib = stripComments(read('src/lib/firstRunTour.ts'));
      assert.match(lib, /case 'workoutRest':\s*return \[\s*\{/);
    },
  },
];
