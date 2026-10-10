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
    name: 'workout tour: the set screen registers the five things the beats ring, as real views',
    run() {
      const set = setStepView();
      for (const id of ['workout.name', 'workout.history', 'workout.setRow', 'workout.dials', 'workout.log']) {
        const found = set.match(new RegExp(`<View\\s+ref=\\{\\(node\\) => tourTargets\\?\\.register\\('${id.replace('.', '\\.')}', node\\)\\}\\s+collapsable=\\{false\\}`));
        // collapsable={false}: a View with only layout props is flattened away
        // on Android and there is nothing left to measure.
        assert.ok(found, id);
      }
      // Each registers once.
      assert.equal((set.match(/tourTargets\?\.register\(/g) || []).length, 5);
      // And each target is the view the beat's copy describes.
      assert.match(set, /register\('workout\.name', node\)\}\s+collapsable=\{false\}\s+style=\{styles\.setExerciseTop\}/);
      assert.match(set, /register\('workout\.history', node\)\}\s+collapsable=\{false\}\s+style=\{styles\.setExerciseRows\}/);
      assert.match(set, /register\('workout\.setRow', node\)\}\s+collapsable=\{false\}\s+style=\{styles\.setMetaRow\}/);
      assert.match(set, /register\('workout\.dials', node\)\}\s+collapsable=\{false\}\s+style=\{styles\.setDialRow\}/);
      assert.match(set, /register\('workout\.log', node\)\}\s+collapsable=\{false\}\s+style=\{styles\.setControls\}/);
    },
  },
  {
    name: 'workout tour: the rest ring is registered through the ring itself',
    run() {
      assert.match(player, /tourRef=\{\(node\) => tourTargets\?\.register\('workout\.rest', node\)\}/);
      const ring = between(player, 'function RestRing({', 'function TopBar({');
      assert.match(ring, /<View\s+ref=\{tourRef\}\s+collapsable=\{false\}/);
    },
  },
  {
    name: 'workout tour: only a plain set or rest is reported, and nothing is reported while the player is held',
    run() {
      const set = setStepView();
      // Not a superset round, not a clock, not a hold.
      assert.match(set, /<GuidedTourReport[\s\S]{0,200}kind="set"[\s\S]{0,120}plain=\{!superset && !minutesMode && !timed\}/);
      // What the beats' sentences depend on.
      assert.match(set, /canWarmUp=\{canWarmUp\}\s+loaded=\{!bodyweight\}\s+hasHistory=\{Boolean\(panels\?\.history\)\}/);
      // An interval bout is a different step view altogether.
      assert.match(player, /\{step\.type === 'set' && !step\.interval && \(\s*<SetStepView/);
      // A rest with a recovery kind is an interval's easy half: no buttons to describe.
      assert.match(player, /<GuidedTourReport report=\{frozen \? undefined : onTourStep\} kind="rest" plain=\{!step\.recoveryKind\} \/>/);
      // A sheet open, the workout paused, the permission ask up: the tour steps aside.
      assert.match(player, /tourReport=\{frozen \? undefined : onTourStep\}/);
      // And the reporter takes its report back when held or unmounted.
      assert.match(reporter, /if \(!report \|\| !plain\) \{\s*return undefined;\s*\}\s*report\(\{ kind, canWarmUp, loaded, hasHistory \}\);\s*return \(\) => report\(null\);/);
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
      assert.match(layer, /if \(!next\) \{\s*stepTo\(index \+ 1\);/);
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
];
