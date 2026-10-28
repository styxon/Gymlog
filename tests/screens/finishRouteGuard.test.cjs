const assert = require('node:assert/strict');
const ts = require('typescript');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { createHookRuntime } = require('../helpers/hookHarness.cjs');
const { ROOT_ROUTES } = require('../../src/navigation/routes');

/**
 * The finish machine's two route effects, run as written.
 *
 * VinhaApp resets a finish-save state that outlived its session, then
 * guards the route: a guided route with nothing to play, a summary with no
 * summary, and every detail route whose subject has gone are each replaced.
 * Nothing pinned that body, and it is the effect that decides where a reader
 * lands after Finish — CLAUDE.md's "a success state must follow the resolved
 * write" runs through its summaryNavigationPendingRef and `saving` checks.
 *
 * This lifts the two effects' source out of the shell wiring (App.tsx and
 * src/app, so it holds wherever the effects live), compiles that text, and
 * runs it with the hook harness against a hand-built world: refs, setters and
 * the clock are fakes the test reads back. What it pins is behaviour, branch
 * by branch, plus which changes re-run each effect (its dependency list).
 */

const START = "  useEffect(() => {\n    if (finishSaveState.status === 'idle') {";
const END = '    workoutTemplates,\n  ]);\n';

/** Every name the two effects read from the component around them. */
const SCOPE = [
  'useEffect',
  'Date',
  'setTimeout',
  'clearTimeout',
  'finishSaveState',
  'setFinishSaveState',
  'workout',
  'route',
  'workoutLogNavigationAllowedAtRef',
  'summaryNavigationPendingRef',
  'summaryExitRouteRef',
  'replaceRoute',
  'ROOT_ROUTES',
  'workoutTemplates',
  'workoutHomeRoute',
  'exerciseBrowserItems',
  'trackedProgress',
  'workoutSessions',
  'completionSummary',
];

function guardSource() {
  const wiring = readAppWiring().replace(/\r\n/g, '\n');
  const start = wiring.indexOf(START);
  assert.ok(start >= 0, 'the finish-save reset effect is missing');
  assert.equal(wiring.indexOf(START, start + 1), -1, 'the finish-save reset effect must be unique');
  const end = wiring.indexOf(END, start);
  assert.ok(end > start, 'the route guard’s dependency list is missing');
  const text = wiring.slice(start, end + END.length);
  // Exactly the two effects: the reset, then the guard.
  assert.equal(text.split('useEffect(').length - 1, 2);
  assert.ok(text.length < 6000, `the slice ran past the guard (${text.length} chars)`);
  assert.match(text, /const nextRoute = summaryExitRouteRef\.current \?\? workoutHomeRoute;/);
  return text;
}

let compiled = null;
function compileGuard() {
  if (!compiled) {
    const wrapped = `function __finishRouteGuard(__scope) {\n  const { ${SCOPE.join(', ')} } = __scope;\n${guardSource()}}\n`;
    const js = ts.transpileModule(wrapped, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, strict: true },
    }).outputText;
    compiled = new Function(`'use strict';\n${js}\nreturn __finishRouteGuard;`)();
  }
  return compiled;
}

const HOME_ROUTE = { tab: 'workout', screen: 'programs_home' };
const IDLE = { status: 'idle', sessionId: null };
const NOW = 1_000_000;

/** One mounted VinhaApp's worth of the guard: render it, read back what it did. */
function mount() {
  const runtime = createHookRuntime();
  const calls = [];
  const guard = compileGuard();
  const clock = { now: () => NOW };
  // Timers the guard schedules, fired by hand: `fire()` runs every live one.
  const timers = new Map();
  let nextTimer = 1;
  return {
    calls,
    timers,
    fire() {
      calls.length = 0;
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
      return calls.slice();
    },
    render(world) {
      calls.length = 0;
      runtime.render(
        (props) =>
          guard({
            ...props,
            useEffect: runtime.react.useEffect,
            Date: clock,
            setTimeout: (fn) => {
              const id = nextTimer++;
              timers.set(id, fn);
              return id;
            },
            clearTimeout: (id) => timers.delete(id),
            ROOT_ROUTES,
            setFinishSaveState: (next) => calls.push(['setFinishSaveState', next]),
            replaceRoute: (next) => calls.push(['replaceRoute', next]),
          }),
        world,
      );
      return calls.slice();
    },
  };
}

const exercises = [{ id: 'ex_bench' }];
const readyTemplates = [{ id: 'ready_full_body' }];
const customTemplates = [{ id: 'custom_mine' }];

function world(overrides = {}) {
  return {
    finishSaveState: IDLE,
    workout: { activeSession: null, templates: readyTemplates },
    route: ROOT_ROUTES.home,
    workoutLogNavigationAllowedAtRef: { current: null },
    summaryNavigationPendingRef: { current: false },
    summaryExitRouteRef: { current: null },
    workoutTemplates: customTemplates,
    workoutHomeRoute: HOME_ROUTE,
    exerciseBrowserItems: exercises,
    trackedProgress: [{ key: 'bench press' }],
    workoutSessions: [{ id: 'session_1' }],
    completionSummary: null,
    ...overrides,
  };
}

const once = (overrides) => mount().render(world(overrides));
const replaced = (route) => [['replaceRoute', route]];
const guided = (workoutTemplateId) => ({ tab: 'workout', screen: 'guided', workoutTemplateId });
const running = (sessionId) => ({ activeSession: { sessionId }, templates: readyTemplates });

module.exports = [
  {
    name: 'finish route guard: its source is the two effects, and they read nothing the test does not hand them',
    run() {
      const text = guardSource();
      // A name the effects start reading that SCOPE does not list would throw
      // only on the branch that reads it; the compiler sees every one.
      const program = ts.createSourceFile('guard.ts', text, ts.ScriptTarget.ES2020, true);
      const free = new Set();
      const visit = (node) => {
        if (ts.isIdentifier(node)) {
          const parent = node.parent;
          const isProperty = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
          const isParam = parent && ts.isParameter(parent);
          const isKey = parent && ts.isPropertyAssignment(parent) && parent.name === node;
          const isDecl = parent && ts.isVariableDeclaration(parent) && parent.name === node;
          if (!isProperty && !isParam && !isKey && !isDecl) {
            free.add(node.text);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(program);
      for (const local of ['template', 'item', 'session', 'activeSessionId', 'allowedAt', 'nextRoute', 'windowExpiry', 'ReturnType', 'undefined']) {
        free.delete(local);
      }
      assert.deepEqual([...free].sort(), [...SCOPE].sort());
    },
  },
  {
    name: 'finish route guard: a finish-save state outlives only its own session',
    run() {
      assert.deepEqual(once({}), [], 'idle is left alone');
      assert.deepEqual(
        once({ finishSaveState: { status: 'saving', sessionId: 's_a' }, workout: running('s_a') }),
        [],
        'a save for the running session stands',
      );
      assert.deepEqual(
        once({ finishSaveState: { status: 'error', sessionId: 's_a' }, workout: running('s_b') }),
        [['setFinishSaveState', IDLE]],
        'another session is running: back to idle',
      );
      assert.deepEqual(
        once({ finishSaveState: { status: 'saving', sessionId: 's_a' } }),
        [['setFinishSaveState', IDLE]],
        'nothing is running: back to idle',
      );
    },
  },
  {
    name: 'finish route guard: a guided route with nothing to play goes Home, unless a start or a save just sent it there',
    run() {
      const nothingRunning = once({ route: guided('ready_full_body') });
      assert.deepEqual(nothingRunning, replaced(ROOT_ROUTES.home));

      // Home first and only: the template check below never runs.
      assert.deepEqual(once({ route: guided('gone') }), replaced(ROOT_ROUTES.home));

      // A start stamps the time; inside two seconds the session is still on its way.
      const recent = { current: NOW - 2000 };
      assert.deepEqual(once({ route: guided('ready_full_body'), workoutLogNavigationAllowedAtRef: recent }), []);
      // Kept while the session is still on its way: a second run inside the
      // window (any dep changing) must hold too, not find the stamp spent
      // and send the start Home (#bugs 2026-10-01).
      assert.equal(recent.current, NOW - 2000, 'the stamp is spent before the session it waits for');
      assert.deepEqual(once({ route: guided('ready_full_body'), workoutLogNavigationAllowedAtRef: recent }), []);
      // And if the session never lands, the window's end sends the route Home
      // on its own — nothing else would re-run the guard (review of #bugs
      // 2026-10-01).
      const lost = mount();
      const lostStamp = { current: NOW - 500 };
      assert.deepEqual(lost.render(world({ route: guided('ready_full_body'), workoutLogNavigationAllowedAtRef: lostStamp })), []);
      assert.equal(lost.timers.size, 1, 'no expiry scheduled for a start still on its way');
      assert.deepEqual(lost.fire(), replaced(ROOT_ROUTES.home));
      assert.equal(lostStamp.current, null);
      // A session that lands first cancels it.
      const landed = mount();
      const landedWorld = world({ route: guided('ready_full_body'), workoutLogNavigationAllowedAtRef: { current: NOW - 500 } });
      landed.render(landedWorld);
      landed.render({ ...landedWorld, workout: running('s_a') });
      assert.equal(landed.timers.size, 0, 'the expiry outlives the session it waited for');
      // Spent once the session has landed.
      once({ route: guided('ready_full_body'), workout: running('s_a'), workoutLogNavigationAllowedAtRef: recent });
      assert.equal(recent.current, null, 'the stamp outlives the session it waited for');
      const stale = { current: NOW - 2001 };
      assert.deepEqual(
        once({ route: guided('ready_full_body'), workoutLogNavigationAllowedAtRef: stale }),
        replaced(ROOT_ROUTES.home),
      );
      assert.equal(stale.current, null);

      // A finish in flight, or a summary on its way, holds the route.
      assert.deepEqual(
        once({ route: guided('ready_full_body'), finishSaveState: { status: 'saving', sessionId: null } }),
        [],
      );
      const pending = { current: true };
      assert.deepEqual(once({ route: guided('ready_full_body'), summaryNavigationPendingRef: pending }), []);
      assert.equal(pending.current, true, 'only the summary route clears the pending flag');

      // An error is not a save in flight.
      assert.deepEqual(
        once({ route: guided('ready_full_body'), finishSaveState: { status: 'error', sessionId: null } }),
        replaced(ROOT_ROUTES.home),
      );

      // Off the guided route the stamp is not touched.
      const untouched = { current: NOW - 10 };
      once({ workoutLogNavigationAllowedAtRef: untouched });
      assert.equal(untouched.current, NOW - 10);
    },
  },
  {
    name: 'finish route guard: a running session’s programme must still exist, ready or custom',
    run() {
      const live = running('s_a');
      assert.deepEqual(once({ route: guided('ready_full_body'), workout: live }), []);
      assert.deepEqual(once({ route: guided('custom_mine'), workout: live }), []);
      assert.deepEqual(once({ route: guided('gone'), workout: live }), replaced(HOME_ROUTE));
    },
  },
  {
    name: 'finish route guard: detail routes whose subject has gone are replaced',
    run() {
      // The exercise detail reads the browser list, not the library.
      assert.deepEqual(once({ route: { tab: 'workout', screen: 'detail', exerciseId: 'ex_bench' } }), []);
      assert.deepEqual(
        once({ route: { tab: 'workout', screen: 'detail', exerciseId: 'ex_gone' } }),
        replaced(ROOT_ROUTES.workout),
      );

      for (const screen of ['program', 'programDay']) {
        const at = (programType, workoutTemplateId) => ({ tab: 'workout', screen, programType, workoutTemplateId, sessionId: 'x' });
        assert.deepEqual(once({ route: at('ready', 'ready_full_body') }), [], `${screen}: a ready programme`);
        assert.deepEqual(once({ route: at('custom', 'custom_mine') }), [], `${screen}: a custom programme`);
        assert.deepEqual(once({ route: at('ready', 'custom_mine') }), replaced(HOME_ROUTE), `${screen}: ready reads the catalog`);
        assert.deepEqual(once({ route: at('custom', 'ready_full_body') }), replaced(HOME_ROUTE), `${screen}: custom reads the reader's own`);
      }

      assert.deepEqual(once({ route: { tab: 'workout', screen: 'template' } }), [], 'a new template has no id yet');
      assert.deepEqual(once({ route: { tab: 'workout', screen: 'template', workoutTemplateId: 'custom_mine' } }), []);
      assert.deepEqual(
        once({ route: { tab: 'workout', screen: 'template', workoutTemplateId: 'ready_full_body' } }),
        replaced(HOME_ROUTE),
      );

      assert.deepEqual(once({ route: { tab: 'progress', screen: 'detail', exerciseKey: 'bench press' } }), []);
      assert.deepEqual(
        once({ route: { tab: 'progress', screen: 'detail', exerciseKey: 'squat' } }),
        replaced(ROOT_ROUTES.progress),
      );

      assert.deepEqual(once({ route: { tab: 'home', screen: 'session', sessionId: 'session_1' } }), []);
      assert.deepEqual(
        once({ route: { tab: 'home', screen: 'session', sessionId: 'session_gone' } }),
        replaced({ tab: 'home', screen: 'history' }),
      );
    },
  },
  {
    name: 'finish route guard: the summary waits for its data, then leaves by the exit route when the data goes',
    run() {
      const summaryRoute = { tab: 'workout', screen: 'summary' };
      const summary = { sessionId: 'session_1' };

      // The summary arrived: the pending flag has done its job.
      const pending = { current: true };
      assert.deepEqual(once({ route: summaryRoute, completionSummary: summary, summaryNavigationPendingRef: pending }), []);
      assert.equal(pending.current, false);

      // Still on its way: saving, or the flag still up — stay.
      assert.deepEqual(
        once({ route: summaryRoute, finishSaveState: { status: 'saving', sessionId: 's_a' }, workout: running('s_a') }),
        [],
      );
      assert.deepEqual(once({ route: summaryRoute, summaryNavigationPendingRef: { current: true } }), []);

      // Data gone and nothing on its way: leave by the exit route, once.
      const exit = { current: ROOT_ROUTES.home };
      assert.deepEqual(once({ route: summaryRoute, summaryExitRouteRef: exit }), replaced(ROOT_ROUTES.home));
      assert.equal(exit.current, null);
      assert.deepEqual(once({ route: summaryRoute }), replaced(HOME_ROUTE), 'no exit route: the programmes home');

      // A summary on screen is left alone, whatever the exit route says.
      assert.deepEqual(once({ route: summaryRoute, completionSummary: summary, summaryExitRouteRef: { current: ROOT_ROUTES.home } }), []);
    },
  },
  {
    name: 'finish route guard: the reset runs before the guard in the same commit',
    run() {
      assert.deepEqual(
        once({ route: guided('ready_full_body'), finishSaveState: { status: 'error', sessionId: 's_a' } }),
        [['setFinishSaveState', IDLE], ['replaceRoute', ROOT_ROUTES.home]],
      );
    },
  },
  {
    name: 'finish route guard: what re-runs each effect',
    run() {
      const app = mount();
      const base = world({ route: { tab: 'workout', screen: 'detail', exerciseId: 'ex_gone' } });
      assert.deepEqual(app.render(base), replaced(ROOT_ROUTES.workout));

      // Same inputs: neither effect runs again.
      assert.deepEqual(app.render({ ...base }), []);
      // Refs are read, not watched.
      assert.deepEqual(app.render({ ...base, summaryNavigationPendingRef: { current: true } }), []);
      // The guard watches the browser list it reads (#bugs 2026-10-01).
      assert.deepEqual(app.render({ ...base, exerciseBrowserItems: [] }), replaced(ROOT_ROUTES.workout));

      // The reset watches the save's status and session and the running session's id, not the objects.
      const saving = { status: 'saving', sessionId: 's_a' };
      const resetWorld = world({ finishSaveState: saving, workout: running('s_a') });
      const reset = mount();
      assert.deepEqual(reset.render(resetWorld), []);
      assert.deepEqual(
        reset.render({ ...resetWorld, finishSaveState: { ...saving }, workout: running('s_a') }),
        [],
        'the same fields in new objects re-run neither',
      );
      assert.deepEqual(reset.render({ ...resetWorld, workout: running('s_b') }), [['setFinishSaveState', IDLE]]);

      for (const key of ['completionSummary', 'finishSaveState', 'route', 'trackedProgress', 'workout', 'workoutSessions', 'workoutTemplates']) {
        // `workout` stands for workout.activeSession: the context object itself is not watched.
        const guardOnly = mount();
        const at = world({ route: { tab: 'home', screen: 'session', sessionId: 'session_gone' } });
        assert.deepEqual(guardOnly.render(at), replaced({ tab: 'home', screen: 'history' }));
        const changed =
          key === 'route'
            ? { ...at.route }
            : key === 'finishSaveState'
              ? { status: 'error', sessionId: null }
              : key === 'workout'
                ? { ...at.workout, activeSession: { sessionId: 's_z' } }
                : key === 'completionSummary'
                  ? { sessionId: 'other' }
                  : [...at[key]];
        const calls = guardOnly.render({ ...at, [key]: changed });
        assert.ok(
          calls.some((call) => call[0] === 'replaceRoute'),
          `a new ${key} re-runs the guard`,
        );
      }
      const watched = mount();
      const at = world({ route: { tab: 'home', screen: 'session', sessionId: 'session_gone' } });
      watched.render(at);
      // A new context object with the same session and templates is not a change.
      assert.deepEqual(watched.render({ ...at, workout: { ...at.workout } }), []);
      // New templates are.
      assert.deepEqual(
        watched.render({ ...at, workout: { ...at.workout, templates: [...readyTemplates] } }),
        replaced({ tab: 'home', screen: 'history' }),
      );
    },
  },
];
