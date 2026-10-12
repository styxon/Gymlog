const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts));
/**
 * The whole shell — App.tsx plus the src/app modules the phase-A and phase-B
 * splits (2026-08-26, 2026-09-30) moved its wiring into. A dead name must not
 * come back in a hook any more than in App.tsx itself.
 */
const shell = () => readAppWiring().replace(/\r\n/g, '\n');

/*
 * The tab of the SAME object literal, not the nearest one on the page.
 * A seven-line lookback took the first `tab:` it saw, and in a run of
 * constructions that is the line above: `{ tab: 'profile', screen:
 * 'premium' }` two lines under `{ tab: 'home', screen: 'cardio' }` was
 * filed as `home/premium`. Inert while every route kept a correctly filed
 * builder elsewhere — and a silent pass the day one does not (CI review of
 * #150). So walk the braces out to the literal's own `{` and `}`, and
 * refuse anything too big to be a route object.
 */
const literalAround = (src, at) => {
  let start = -1;
  for (let i = at, depth = 0; i >= 0 && at - i < 600; i -= 1) {
    if (src[i] === '}') depth += 1;
    else if (src[i] === '{' && depth === 0) {
      start = i;
      break;
    } else if (src[i] === '{') depth -= 1;
  }
  if (start < 0) return '';
  for (let i = at, depth = 0; i < src.length && i - at < 600; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}' && depth === 0) return src.slice(start, i + 1);
    else if (src[i] === '}') depth -= 1;
  }
  return '';
};

/**
 * Every `{ tab, screen }` construction in one source file, keyed
 * `tab/screen`, with the top-level function it sits inside (null at module
 * level). A construction whose own literal carries no tab string is not a
 * builder of anything: a loud false alarm beats a builder filed under
 * whatever tab happens to sit nearby.
 */
const constructionsIn = (src) => {
  const lines = src.split('\n');
  const holderAt = [];
  let holder = null;
  lines.forEach((line, i) => {
    const fn =
      line.match(/^\s{0,4}(?:export\s+)?(?:async\s+)?function (\w+)/) ||
      line.match(/^\s{0,4}const (\w+) = (?:useCallback\(|async |\()/);
    if (fn) holder = fn[1];
    holderAt[i] = holder;
  });
  const out = [];
  for (const m of src.matchAll(/screen: '([^']+)'(?!;)/g)) {
    const tab = literalAround(src, m.index).match(/tab: '([^']+)'/);
    if (!tab) continue;
    out.push({ key: `${tab[1]}/${m[1]}`, holder: holderAt[src.slice(0, m.index).split('\n').length - 1] });
  }
  return out;
};

/**
 * Two screens nothing could open — audit round 3, 2026-09-20.
 *
 * `AICoachScreen` was reachable only from itself: the one place that built a
 * `screen: 'ai'` route was `handleOpenAICoach`, and the only thing holding
 * `handleOpenAICoach` was that screen's own `onSubmitPrompt`. A door whose
 * only key is on the inside.
 *
 * `WorkoutEditorScreen` hung off it: the one place that built a
 * `screen: 'editor'` route was the `open_custom_editor` branch of
 * `handleSelectAiCoachAction`, which only that screen could reach. 1 286 lines
 * of editor behind a door behind the first door.
 *
 * This guard is about the shape, not the files: what made them dead was that
 * a route existed with no way in. Re-adding either screen is fine — wiring one
 * to nothing is what must not come back.
 */
module.exports = [
  {
    name: 'dead screens: the two unreachable screens are gone, with the routes that only they built',
    run() {
      assert.ok(!exists('src', 'screens', 'AICoachScreen.tsx'), 'AICoachScreen is back');
      assert.ok(!exists('src', 'screens', 'WorkoutEditorScreen.tsx'), 'WorkoutEditorScreen is back');
      // Its only importer went with it.
      assert.ok(!exists('src', 'components', 'FitnessPhotoSurface.tsx'), 'FitnessPhotoSurface is back');
      // The libraries that existed only to serve them.
      assert.ok(!exists('src', 'lib', 'workoutEditorTable.ts'), 'workoutEditorTable is back');
      assert.ok(!exists('src', 'lib', 'aiCoachActions.ts'), 'aiCoachActions is back');

      // Superseded by WorkoutCompletionScreen in 83b718b, which deleted the
      // only `replaceRoute` that opened it. Its state was unreachable twice
      // over: `setWorkoutCelebration` was called in two places and passed
      // `null` in both, and the render branch needed it truthy.
      assert.ok(!exists('src', 'screens', 'WorkoutCelebrationScreen.tsx'), 'WorkoutCelebrationScreen is back');

      const routes = read('src', 'navigation', 'routes.ts');
      assert.doesNotMatch(routes, /screen: 'ai';/, "the 'ai' route is back");
      assert.doesNotMatch(routes, /screen: 'editor';/, "the 'editor' route is back");
      assert.doesNotMatch(routes, /screen: 'celebration';/, "the 'celebration' route is back");
      // Seasons were parked on 2026-08-31 and removed for good on 2026-10-12.
      assert.doesNotMatch(routes, /screen: 'season';/, "the 'season' route is back");
      assert.ok(!exists('src', 'screens', 'SeasonScreen.tsx'), 'SeasonScreen is back');
      // The state it was the only reader of, and the setter threaded through
      // the profile tab to clear it.
      assert.doesNotMatch(read('src', 'app', 'workoutCompletionState.ts'), /WorkoutCelebrationState/);
      assert.doesNotMatch(read('src', 'app', 'renderProfileTab.tsx'), /setWorkoutCelebration/);
      assert.doesNotMatch(shell(), /workoutCelebration/);
      // And the memo the Seasons parking left behind: computed every render,
      // passed to nothing, one of the "App memos behind them" that were meant
      // to go with the section on 2026-08-31.
      assert.doesNotMatch(shell(), /programsSeasonTileCounts/);
    },
  },
  {
    /*
     * The rule the deletion came from, kept as a rule — and kept honestly.
     *
     * The first version of this guard asked "does the string `screen: 'x'`
     * appear anywhere?", which is not the same question at all. Run that
     * version against the tree before this commit and it reports nothing
     * wrong with `ai` or `editor`: `App.tsx` *did* contain
     * `navigate({ tab: 'home', screen: 'ai', prompt })` — inside
     * `handleOpenAICoach`, a function wired to nothing but the dead screen
     * itself. The guard would have passed the very bug it is named after
     * (CI review of #150).
     *
     * So it walks the graph instead. A route is reachable when something
     * that can actually run builds it:
     *
     *   seeds        the four tab roots plus the plans route, which the
     *                bottom bar reaches from anywhere
     *   renders      `route.screen === 'x'` next to a JSX tag says which
     *                component that route puts on screen
     *   builds       a `{ tab, screen }` construction, and the top-level
     *                function it sits inside
     *   attached     a handler named as a JSX prop belongs to that component
     *
     * Then: a route is reachable if one of its constructions sits in a
     * handler attached to a component that some already-reachable route
     * renders. Repeat until nothing new is added.
     *
     * Defaults to reachable. A construction with no enclosing handler, or a
     * handler nothing attaches to a component, counts — so the check only
     * ever accuses a route it can SEE is built solely by handlers living on
     * screens that are themselves out of reach. That is the shape of this
     * PR's bug, and it is the shape it is worth failing over.
     *
     * Checked against b7932fc, the commit before this one: it names
     * `home/ai`, `workout/editor` and `workout/celebration` there, and only
     * `workout/season` here.
     */
    name: 'dead screens: every route is reachable from something a reader can press',
    run() {
      const walk = (dir) => {
        const out = [];
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
          const next = `${dir}/${entry.name}`;
          if (entry.isDirectory()) out.push(...walk(next));
          else if (/\.tsx?$/.test(entry.name)) out.push(next);
        }
        return out;
      };
      const ROUTES = 'src/navigation/routes.ts';
      const routesSrc = read(...ROUTES.split('/'));
      const sources = ['App.tsx', ...walk('src')]
        .filter((f) => f !== ROUTES)
        .map((f) => read(...f.split('/')));

      // Declared, as tab+screen. Keyed on the pair because a screen name is
      // not unique: 'list' is declared under workout, progress and profile,
      // and 'detail' under two — on the bare name, one going unreachable
      // would hide behind the other (CI review of #150). Split into union
      // members first: several carry a doc comment between the brace and
      // `tab:`, which a `{\s*tab:` regex skips silently — `season` among them.
      const declared = new Set();
      for (const member of routesSrc.split(/\n  \| \{/).slice(1)) {
        const body = member.slice(0, member.indexOf('\n    }'));
        const tab = body.match(/tab: '([^']+)';/);
        const screen = body.match(/screen: '([^']+)';/);
        if (tab && screen) declared.add(`${tab[1]}/${screen[1]}`);
      }
      assert.ok(declared.size > 30, `only ${declared.size} routes parsed — the union's shape changed`);

      /*
       * A guard's branch either writes its JSX in place or, since the shell's
       * tail moved into src/app (phase C), hands off with `content =
       * renderX({ … })` / `return renderX({ … })`. A handoff resolves to the
       * element that render function draws first — unless the function has
       * `route.screen` guards of its own (a tab dispatcher such as
       * renderHomeScreens or renderAppShell), whose guards are mapped where
       * they stand, so the handoff maps to nothing, as it did before.
       */
      const renderFns = new Map();
      for (const src of sources) {
        for (const m of src.matchAll(/^(?:export )?function (render[A-Z]\w*)\(/gm)) {
          assert.ok(!renderFns.has(m[1]), `${m[1]} is declared twice`);
          const body = functionBody(src, m[0].slice(m[0].indexOf('function')));
          renderFns.set(
            m[1],
            /route\.screen === '/.test(body) ? null : (body.match(/<([A-Z]\w+)/) ?? [])[1] ?? null,
          );
        }
      }
      const rendersOf = new Map();
      for (const src of sources) {
        for (const m of src.matchAll(/route\.screen === '([^']+)'/g)) {
          const next = src
            .slice(m.index, m.index + 900)
            // `inWorkoutArea(…)` wraps a workout screen's handoff in the boundary that marks its failures.
            .match(/<([A-Z]\w+)|(?:content = (?:inWorkoutArea\()?|return )(render[A-Z]\w*)\(/);
          const tag = !next ? null : next[1] ?? (renderFns.has(next[2]) ? renderFns.get(next[2]) : null);
          if (!tag) continue;
          if (!rendersOf.has(m[1])) rendersOf.set(m[1], new Set());
          rendersOf.get(m[1]).add(tag);
        }
      }
      // The two branches the phase-C move turned into handoffs: proof the
      // mapping follows them rather than going quiet where the JSX left.
      assert.ok(rendersOf.get('setup')?.has('OnboardingScreen'), 'the setup editor maps to no element');
      assert.ok(rendersOf.get('summary')?.has('WorkoutCompletionScreen'), 'the summary route maps to no element');
      if (process.env.DEAD_SCREENS_DEBUG) {
        console.log([...rendersOf].map(([k, v]) => `${k} -> ${[...v].sort().join(',')}`).sort().join('\n'));
      }

      const builds = new Map();
      for (const src of sources) {
        for (const { key, holder } of constructionsIn(src)) {
          if (!builds.has(key)) builds.set(key, []);
          builds.get(key).push(holder);
        }
      }

      const attachedTo = new Map();
      for (const src of sources) {
        for (const m of src.matchAll(/\w+=\{(\w+)\}/g)) {
          const tags = [...src.slice(Math.max(0, m.index - 2500), m.index).matchAll(/<([A-Z]\w+)/g)];
          if (!tags.length) continue;
          if (!attachedTo.has(m[1])) attachedTo.set(m[1], new Set());
          attachedTo.get(m[1]).add(tags[tags.length - 1][1]);
        }
      }

      const reachable = new Set(
        [...routesSrc.matchAll(/tab: '([^']+)', screen: '([^']+)'/g)].map((m) => `${m[1]}/${m[2]}`),
      );
      assert.ok(reachable.size >= 4, 'the tab roots are gone from routes.ts — the seeds are wrong');
      for (let pass = 0; pass < 12; pass += 1) {
        const live = new Set();
        for (const key of reachable) {
          for (const c of rendersOf.get(key.split('/')[1]) ?? []) live.add(c);
        }
        let grew = false;
        for (const key of declared) {
          if (reachable.has(key)) continue;
          for (const holder of builds.get(key) ?? []) {
            const hosts = holder ? attachedTo.get(holder) : null;
            if (!hosts || hosts.size === 0 || [...hosts].some((c) => live.has(c))) {
              reachable.add(key);
              grew = true;
              break;
            }
          }
        }
        if (!grew) break;
      }

      /*
       * A route unreachable ON PURPOSE goes here, with the decision that keeps
       * it. `workout/season` was the one entry (parked 2026-08-31); the season
       * feature was removed on 2026-10-12, and its route with it.
       *
       * This guard's first run flagged `celebration` beside it, and that one
       * WAS dead: 83b718b rebuilt the post-finish flow onto `summary` and
       * WorkoutCompletionScreen, deleting the `replaceRoute` that opened the
       * old one.
       */
      const PARKED = new Set();

      const unreachable = [...declared].filter((k) => !reachable.has(k) && !PARKED.has(k)).sort();
      assert.deepEqual(unreachable, [], `nothing can open these routes: ${unreachable.join(', ')}`);

      // Both halves of what PARKED promises. Filtering it against `reachable`
      // alone caught a route being quietly wired but not one being quietly
      // deleted: with the union entry gone, the name is simply absent from
      // both sets and the list would have kept claiming it was parked
      // (CI review of #150).
      for (const key of PARKED) {
        assert.ok(!reachable.has(key), `${key} has an entry point now — take it out of PARKED`);
        assert.ok(declared.has(key), `${key} is no longer a route at all — take it out of PARKED`);
      }
    },
  },
  {
    name: 'dead screens: the coach stops computing an action list nobody draws',
    run() {
      // `buildAiCoachActions` ran on every offline answer and its result was
      // read in exactly one place — the screen that no longer exists.
      const preview = read('src', 'lib', 'aiCoachPreview.ts');
      assert.doesNotMatch(preview, /buildAiCoachActions/);
      assert.doesNotMatch(preview, /actions:/);

      const types = read('src', 'types', 'aiCoach.ts');
      assert.doesNotMatch(types, /AICoachActionKind/);
      assert.doesNotMatch(types, /actions\?: AICoachAction/);
    },
  },
  {
    name: 'dead screens: the freestyle save carries the type of the thing that builds it',
    run() {
      /*
       * `finishLoggedWorkoutSave` took `WorkoutEditorFinishSummary`, a type
       * the deleted screen exported — while the live caller passes a
       * `FreestyleFinishSummary`, whose declaration carried the comment
       * "Structurally identical to WorkoutEditorFinishSummary". Two names for
       * one shape, one of them on a screen nobody could open.
       */
      // The whole shell: the save leaves VinhaApp in the phase-C split (2026-10-01).
      assert.match(shell(), /finishLoggedWorkoutSave = async \(\s*draft: WorkoutTemplateDraft,\s*summary: FreestyleFinishSummary,/);
      assert.doesNotMatch(shell(), /WorkoutEditorFinishSummary/);

      const lib = read('src', 'lib', 'emptyWorkoutSession.ts');
      assert.doesNotMatch(lib, /Structurally identical to WorkoutEditorFinishSummary/);
    },
  },
  {
    /*
     * The keying, pinned to the shape that fooled the lookback window: two
     * constructions two lines apart under different tabs, as at App.tsx
     * where `onOpenPremium` sits under `onOpenCardio`. A fixture rather
     * than the live file, because the live file having such pairs today and
     * none tomorrow are both legal — the rule has to hold either way.
     */
    name: "dead screens: a construction is filed under its own tab, not its neighbour's",
    run() {
      const fixture = [
        'function ProfileHost() {',
        '  return (',
        '    <Home',
        "      onOpenCardio={() => navigate({ tab: 'home', screen: 'cardio' })}",
        '      activeCardioActivity={null}',
        "      onOpenPremium={() => navigate({ tab: 'profile', screen: 'premium' })}",
        '      onSetTrainingDays={() =>',
        "        navigate({ tab: 'profile', screen: 'training_plan', editSchedule: true })",
        '      }',
        '    />',
        '  );',
        '}',
      ].join('\n');
      const found = constructionsIn(fixture);
      assert.deepEqual(
        found.map((c) => c.key),
        ['home/cardio', 'profile/premium', 'profile/training_plan'],
      );
      assert.ok(found.every((c) => c.holder === 'ProfileHost'), 'the enclosing function was lost');

      // No tab string in the literal itself: not a builder, whatever sits above it.
      const spread = "navigate({ tab: 'home', screen: 'cardio' });\nnavigate({ tab: route.tab, screen: 'detail' });";
      assert.deepEqual(constructionsIn(spread).map((c) => c.key), ['home/cardio']);
    },
  },
];
