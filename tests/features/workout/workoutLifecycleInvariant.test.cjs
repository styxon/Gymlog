const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const { createFakeAsyncStorage, loadAgainstFake } = require('../../storage/fakeAsyncStorage.cjs');

/**
 * The workout-lifecycle invariant, run over random sequences (2026-10-03).
 *
 * docs/never-list.md N1 ("a logged set is never lost"), N2 ("a workout can
 * always be started and saved") and N6 ("success is never claimed before it
 * happened"), as one driver. A random sequence of events - start a ready
 * programme day or a custom programme day, log a set, correct it, untick it,
 * add / remove a set, add an exercise, swap, skip, pause, rest timers, the
 * guided step, repeat-last, a free workout's lifts and ticks, a cardio run,
 * Finish & save (the save, or the preferences write behind it, failing), an
 * explicit discard, a storage write that is refused, an app kill (with the last
 * write still in flight, with a read that fails on launch), a clock jump across
 * the 2026-10-25 Helsinki change - is run through the real code, and after every
 * step the invariants below are looked at. Nothing here asserts a path the code
 * takes; it asserts what must hold whichever path it takes.
 *
 * What is real (compiled in .test-dist, or lifted from source and run as
 * written):
 *  - workoutReducer with every WorkoutAction it is sent, the catalog (57
 *    programmes) and the custom-template adapter, session materialisation with
 *    the history the earlier finishes wrote;
 *  - the persistence bundle (workoutPersistence: save, load, normalise, the
 *    scrub of impossible loads) and storage/largeItem, the database loader and
 *    saver, loadWithRetry - all against an in-memory AsyncStorage that can
 *    refuse a write, refuse a read, and lose the write that was in flight when
 *    the process died;
 *  - the finish handlers: src/app/finishSaves.tsx is transpiled and run as
 *    written (handleConfirmFinishWorkout, handleDiscardWorkout,
 *    finishLoggedWorkoutSave), with the adapter, the post-session insight and
 *    the completion cards behind it;
 *  - AppProvider's `commit` (the optimistic database with its rollback) and
 *    `persistCompletedWorkoutSession`, lifted from src/state/AppProvider.tsx by
 *    text, transpiled and run, over the real persistCompletedWorkoutSessionToDatabase.
 * What is modelled (and where):
 *  - React. WorkoutProvider's persistence effect - one saveWorkoutBundle per
 *    commit in which activeSession / history / activeCardio / freestyleDraft /
 *    hydrated changed, no debounce, writes serialised by largeItem's per-key
 *    queue - is the `dispatch` function below, and its hydrate (loadWithRetry,
 *    then session/hydrate, which the effect writes straight back) is `launch`.
 *    The guided player's "log a set" is two commits (updateDraft, complete).
 *  - The free workout screen (EmptyWorkoutScreen): its rows live in screen
 *    state, and are handed to the provider 400 ms after the last edit (the
 *    debounce at src/screens/EmptyWorkoutScreen.tsx:580) or at once when the
 *    board is empty; a kill inside that window loses the edits since the last
 *    hand-over, which is the documented window and the only loss allowed there.
 *  - updatePreferences (a refusal is an event; its own write is not modelled),
 *    the route, the toasts.
 *  - Events are separated by enough time for the previous write to finish,
 *    except the one `kill:early` makes: the bundle write of the last commit is
 *    still in flight and never lands. That is the persistence window of the
 *    guided session: exactly one commit. Nothing is debounced there.
 * Not simulated: two writes racing, the cardio save (a separate screen saving
 * through saveCardioSession, not through this path), a reset, a restore from
 * backup, chunked (over 2 MB) values.
 *
 * Invariants, after every step:
 *  1. Every set logged (ticked with values) and not explicitly removed - undone,
 *     the workout discarded - is in the live session with the same values; and
 *     what is stored (read back as a launch reads it) is the state of the last
 *     write that landed, so after a kill the restored session holds every such
 *     set. The free workout's board the same, at its last hand-over.
 *  2. After a save that resolved, the database holds the session with exactly
 *     the logged sets (count and values), once - in memory and as stored; the
 *     slot history holds them too. After a save that failed, the database has
 *     no such session, no template is left behind, the session is still the
 *     live one, resumable, its sets intact, the reader was told, and a retry
 *     works. The nothing-lifted discard branch is never taken with a set logged.
 *  3. Starting any catalog day or custom day never throws, yields a session of
 *     unique slots with sets, and one logged set makes it a saveable record.
 *  4. Nothing throws; no number in the session is NaN or infinite; a logged set
 *     has whole reps above zero and a weight that is a number between 0 and 600;
 *     values the reducer is meant to refuse are refused; ids are unique.
 *  6. A summary is shown, and the session marked finished, only once the write
 *     has landed on disk.
 *  7. Whatever Finish shows as saved, some stored session holds exactly the sets
 *     logged at that Finish - also when the session is one that came back active
 *     after a save whose clear was lost (`finish:lostClear`, a kill, more sets,
 *     Finish again). A discard happens whether or not the preference write behind
 *     it is refused.
 *
 * The first runs (2026-10-03) found two things on main, both fixed since and held here as
 * invariants: a finished guided session left as the activeSession blocked every Start (and
 * toasted "save failed" over a saved workout when the preferences write after the save was
 * refused), and a free workout board returning after a lost clear was saved a second time
 * under a second session id.
 *
 * Reproduce a failure: WORKOUT_INVARIANT_SEED=<seed> WORKOUT_INVARIANT_SEQUENCES=<n>
 * node tests/run-tests.cjs; the failing sequence is printed, already shrunk.
 * WORKOUT_INVARIANT_REPLAY runs one sequence given by hand (see parseEvents),
 * WORKOUT_INVARIANT_STATS=1 prints what the sequences reached.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, '.test-dist');
const SRC = path.join(ROOT, 'src');
const dist = (relative) => require(path.join(DIST, relative));

const SEQUENCES = Number(process.env.WORKOUT_INVARIANT_SEQUENCES) || 2000;
const SEED = Number(process.env.WORKOUT_INVARIANT_SEED) || 20261003;
const REPLAY = process.env.WORKOUT_INVARIANT_REPLAY;
const STATS = process.env.WORKOUT_INVARIANT_STATS ? new Map() : null;
const count = (key) => STATS?.set(key, (STATS.get(key) ?? 0) + 1);

// ---------------------------------------------------------------------------
// Randomness and small helpers
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (rnd, n) => Math.floor(rnd() * n);
const pick = (rnd, list) => list[int(rnd, list.length)];
/** A reproducible stream for one event's own choices, from its r. */
const stream = (seed) => mulberry32(seed);

class Violation extends Error {}
const fail = (tag, message) => {
  throw new Violation(`${tag}: ${message}`);
};

// ---------------------------------------------------------------------------
// The real code, loaded once
// ---------------------------------------------------------------------------

const BUNDLE_KEY = '@vinha/workout/v1';
const DB_KEY = '@vinha/database/v1';

const kindOfKey = (key) =>
  key === BUNDLE_KEY || key.startsWith(`${BUNDLE_KEY}#`) ? 'bundle' : key === DB_KEY || key.startsWith(`${DB_KEY}#`) ? 'db' : 'other';

const emptySnap = () => ({ session: null, cardio: false, fs: null });

/**
 * AsyncStorage as the modules see it: one object, whose rows are swapped for a
 * fresh set per sequence, with a journal of every applied write (so a write
 * "still in flight at the kill" can be taken back) and the faults the events
 * arm. A refused write applies nothing, like a refused SQLite transaction.
 */
const storage = {
  inner: createFakeAsyncStorage(),
  journal: [],
  snapQueue: [],
  fault: { writeBundle: 0, writeDb: 0, dbSkip: 0, readBundle: 0, readDb: 0 },
  reset() {
    this.inner = createFakeAsyncStorage();
    this.journal = [];
    this.snapQueue = [];
    this.fault = { writeBundle: 0, writeDb: 0, dbSkip: 0, readBundle: 0, readDb: 0 };
  },
  async getItem(key) {
    if (key === BUNDLE_KEY && this.fault.readBundle > 0) {
      this.fault.readBundle -= 1;
      throw new Error('database is locked');
    }
    if (key === DB_KEY && this.fault.readDb > 0) {
      this.fault.readDb -= 1;
      throw new Error('database is locked');
    }
    return this.inner.getItem(key);
  },
  async write(pairs) {
    await Promise.resolve();
    const kinds = new Set(pairs.map(([key]) => kindOfKey(key)));
    const isBundle = pairs.some(([key]) => key === BUNDLE_KEY);
    const snap = isBundle ? this.snapQueue.shift() : undefined;
    if (kinds.has('bundle') && this.fault.writeBundle > 0) {
      this.fault.writeBundle -= 1;
      throw new Error('database or disk is full');
    }
    if (kinds.has('db')) {
      if (this.fault.dbSkip > 0) {
        this.fault.dbSkip -= 1;
      } else if (this.fault.writeDb > 0) {
        this.fault.writeDb -= 1;
        throw new Error('database or disk is full');
      }
    }
    const prev = new Map(pairs.map(([key]) => [key, this.inner.rows.get(key)]));
    for (const [key, value] of pairs) {
      this.inner.rows.set(key, String(value));
    }
    this.journal.push({ kind: kinds.has('bundle') ? 'bundle' : kinds.has('db') ? 'db' : 'other', prev, snap });
  },
  setItem(key, value) {
    return this.write([[key, value]]);
  },
  multiSet(pairs) {
    return this.write(pairs);
  },
  async removeItem(key) {
    await Promise.resolve();
    this.inner.rows.delete(key);
  },
  async multiRemove(keys) {
    await Promise.resolve();
    for (const key of keys) {
      this.inner.rows.delete(key);
    }
  },
  getAllKeys() {
    return this.inner.getAllKeys();
  },
  /** The last write is lost: the process died before SQLite committed it. Only a write nobody awaited can be. */
  loseLastBundleWrite() {
    const last = this.journal[this.journal.length - 1];
    if (!last || last.kind !== 'bundle') {
      return false;
    }
    this.journal.pop();
    for (const [key, value] of last.prev) {
      if (value === undefined) {
        this.inner.rows.delete(key);
      } else {
        this.inner.rows.set(key, value);
      }
    }
    return true;
  },
  /** What the last landed bundle write was meant to hold, by the shadow taken when it was issued. */
  durable() {
    for (let index = this.journal.length - 1; index >= 0; index -= 1) {
      if (this.journal[index].kind === 'bundle' && this.journal[index].snap) {
        return this.journal[index].snap;
      }
    }
    return emptySnap();
  },
  rowsText() {
    return [...this.inner.rows.values()].join('\n');
  },
};

const modules = loadAgainstFake(storage, (req) => ({
  database: req('storage/database.js'),
  persistence: req('features/workout/workoutPersistence.js'),
}));

const { workoutReducer, workoutInitialState, repsCeilingFor } = dist('features/workout/workoutState.js');
const catalog = dist('features/workout/workoutCatalog.js');
const { buildReadySessionRuntimeTemplate, buildCustomSessionRuntimeTemplate } = dist('lib/programDetails.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = dist('features/workout/customWorkoutAdapter.js');
const { adaptCompletedWorkoutSessionForAppDatabase } = dist('features/workout/workoutAppAdapter.js');
const { persistCompletedWorkoutSessionToDatabase, buildCompletedWorkoutRecord } = dist('state/completedWorkoutPersistence.js');
const { createSerialTaskQueue } = dist('lib/serialTaskQueue.js');
const { loadWithRetry } = dist('storage/loadWithRetry.js');
const { createId } = dist('lib/ids.js');
const { createEmptyDatabase } = dist('data/seed.js');
const { workoutTemplateRepository, exerciseTemplateRepository } = dist('storage/repositories.js');
const { isUnloadedTrackingMode } = dist('features/workout/workoutTypes.js');
const { parseIntervalScheme } = dist('lib/intervalScheme.js');
const { liftOfSet } = dist('lib/liftSegments.js');
const { parseNumberInput } = dist('lib/format.js');
const { getCatalogTrackingMode } = dist('lib/catalogExercisePools.js');
const emptyWorkout = dist('lib/emptyWorkoutSession.js');
const { sessionRecordedWork } = dist('lib/exerciseLog.js');
const { isWorkoutInProgress } = dist('lib/activeWorkout.js');
const { t: translate } = dist('lib/i18n.js');

const LIBRARY = createEmptyDatabase('en').exerciseLibrary;
const TEMPLATES = catalog.WORKOUT_TEMPLATES_V1;
const SWAP_GROUPS = catalog.WORKOUT_SUBSTITUTION_GROUPS;

// ---------------------------------------------------------------------------
// Source lifted and run as written
// ---------------------------------------------------------------------------

/** From `header` (which ends at the function's opening brace) to its matching close. */
function liftFunction(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `source moved: ${header}`);
  assert.equal(source.indexOf(header, start + 1), -1, `${header} must be unique`);
  let depth = 1;
  let index = start + header.length;
  while (depth > 0 && index < source.length) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }
    index += 1;
  }
  assert.equal(depth, 0, `no end found for ${header}`);
  const text = source.slice(start, index);
  assert.ok(text.length < 5000, `${header} ran on (${text.length} characters)`);
  return text;
}

const APP_PROVIDER = fs.readFileSync(path.join(SRC, 'state', 'AppProvider.tsx'), 'utf8').replace(/\r\n/g, '\n');
const COMMIT_SOURCE = liftFunction(APP_PROVIDER, 'async function commit(nextDatabase: AppDatabase) {');
const PERSIST_SOURCE = liftFunction(APP_PROVIDER, 'function persistCompletedWorkoutSession(input: PersistCompletedWorkoutInput) {');

const compileAppProviderPart = (() => {
  const wrapped = [
    'function __part(__scope) {',
    '  const { databaseRef, setDatabase, saveDatabase, runExclusive, persistCompletedWorkoutSessionToDatabase, createId } = __scope;',
    COMMIT_SOURCE,
    PERSIST_SOURCE,
    '  return { commit, persistCompletedWorkoutSession };',
    '}',
  ].join('\n');
  const js = ts.transpileModule(wrapped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return new Function(`'use strict';\n${js}\nreturn __part;`)();
})();

const APP_SHELL = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');
const NAVIGATE_SOURCE = liftFunction(APP_SHELL, 'function navigateToActiveWorkout(options?: { message?: string; resume?: boolean }) {');

/** App.tsx's navigateToActiveWorkout, the door every Start goes through, run as written. */
const compileDoor = (() => {
  const wrapped = `function __door(__scope) {\n  const { workout, showToast, navigateToGuidedWorkout, isWorkoutInProgress } = __scope;\n${NAVIGATE_SOURCE}\n  return navigateToActiveWorkout;\n}`;
  const js = ts.transpileModule(wrapped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return new Function(`'use strict';\n${js}\nreturn __door;`)();
})();

const FINISH_SAVES = (() => {
  const file = path.join(SRC, 'app', 'finishSaves.tsx');
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module_ = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier.includes('analyticsClient')) {
      return { trackEvent() {} };
    }
    if (specifier.includes('errorReporter')) {
      return { reportOperationFailed() {} };
    }
    return specifier.startsWith('.') ? require(path.join(DIST, 'app', specifier)) : require(specifier);
  };
  new Function('require', 'module', 'exports', js)(localRequire, module_, module_.exports);
  return module_.exports.createFinishSaves;
})();

// ---------------------------------------------------------------------------
// The world: clock, shadow (what must be true), the process
// ---------------------------------------------------------------------------

/**
 * The shadow is the invariant's own record of what the reader did: it is
 * written from the events, never read back from the reducer (except for a value
 * the event does not choose: an unloaded set's weight, and repeat-last's copy).
 * A snapshot of it is taken whenever a bundle write is issued; the last write
 * that landed is what a launch must restore.
 */
const cloneSession = (session) =>
  session ? { sessionId: session.sessionId, sets: new Map(session.sets), takenBack: new Set(session.takenBack ?? []) } : null;
const snapshotOf = (current) => ({
  session: cloneSession(current.shadow.session),
  cardio: current.shadow.cardio,
  fs: current.fsAtDraft ? new Map(current.fsAtDraft) : null,
});

const START_MS = Date.UTC(2026, 9, 24, 20, 0, 0);
let world = null;

function freshWorld() {
  storage.reset();
  return {
    now: START_MS,
    shadow: { session: null, cardio: false },
    /** The board as the provider's draft holds it: "lift/set" -> "done|kg|reps". */
    fsAtDraft: null,
    expectedDb: new Map(),
    seenSessionIds: new Set(),
    keyCounter: 0,
    proc: null,
    toasts: [],
    lastSave: null,
    pendingExpectation: [],
    /** The guided finish's sets by identity (slot|set|moment logged), for a merge with what is stored under its id. */
    pendingByIdentity: new Map(),
    /** The free workout board's done sets by place (lift key|set position), for a merge with its earlier save. */
    pendingByPlace: null,
    /** The moments the finishing session took back (set/undo). */
    pendingTakenBack: new Set(),
    /** What the database must hold under the id the finish landed under: its sets, or the merge with what was stored. */
    pendingSaved: [],
    pendingLifts: null,
    duringSave: null,
    unhandled: [],
    violation: null,
  };
}

/**
 * A finished session is closed to edits. A session whose save resolved is NOT: when the clear behind the save
 * was lost (finish with `lostClear`, then a kill) it comes back active on the next launch, and the reader can
 * log more into it and Finish again. This used to count it as closed, which hid that path from every
 * generated sequence (bug hunt 2026-10-03).
 */
const isClosed = (session) => !session || session.status === 'completed';

const setKey = (slotId, setIndex) => `${slotId}|${setIndex}`;
const sameNumber = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

function newProc() {
  return {
    state: workoutInitialState,
    bundleFailed: false,
    dbFailed: false,
    killedMid: false,
    fsFinishing: false,
    dbRef: { current: null },
    runExclusive: createSerialTaskQueue(),
    pending: [],
    part: null,
    fs: null,
    refs: {
      finishInFlight: { current: false },
      counted: { current: new Set() },
      summaryPending: { current: false },
      summaryExit: { current: null },
    },
    finishSaveState: { status: 'idle', sessionId: null },
  };
}
const isDown = (proc) => proc.bundleFailed || proc.dbFailed;

/** WorkoutProvider's persistence effect: one write per commit that changed what it watches. */
function dispatch(proc, action, afterReduce) {
  const previous = proc.state;
  const next = workoutReducer(previous, action);
  proc.state = next;
  if (afterReduce) {
    afterReduce(next);
  }
  if (!next.hydrated || proc.bundleFailed) {
    return next;
  }
  if (
    previous.activeSession !== next.activeSession ||
    previous.activeCardio !== next.activeCardio ||
    previous.freestyleDraft !== next.freestyleDraft ||
    previous.history !== next.history ||
    previous.hydrated !== next.hydrated
  ) {
    storage.snapQueue.push(snapshotOf(world));
    const bundle = {
      activeSession: next.activeSession,
      history: next.history,
      activeCardio: next.activeCardio,
      freestyleDraft: next.freestyleDraft,
    };
    // The real effect catches and logs a refused write; nothing retries until the next change.
    proc.pending.push(
      modules.persistence.saveWorkoutBundle(bundle).then(
        () => undefined,
        () => count('bundle write refused'),
      ),
    );
  }
  return next;
}

async function settle(proc) {
  while (proc.pending.length > 0) {
    const batch = proc.pending;
    proc.pending = [];
    await Promise.all(batch);
  }
}

const retryOptions = { isCancelled: () => false, onError: () => undefined, wait: async () => undefined };

/** App launch: WorkoutProvider's hydrate and AppProvider's, as written (loadWithRetry, then the state lands). */
async function launch(options = {}) {
  const proc = newProc();
  world.proc = proc;
  const rowsBefore = new Map(storage.inner.rows);
  dispatch(proc, { type: 'session/markRestoring', payload: { value: true } });
  const bundle = await loadWithRetry(modules.persistence.loadWorkoutBundle, retryOptions);
  if (bundle.kind === 'loaded') {
    // The shadow is whatever was stored: the process is the stored state again.
    const durable = storage.durable();
    world.shadow = { session: cloneSession(durable.session), cardio: durable.cardio };
    world.fsAtDraft = durable.fs ? new Map(durable.fs) : null;
    dispatch(proc, { type: 'session/hydrate', payload: bundle.value });
  } else {
    proc.bundleFailed = true;
  }
  const database = await loadWithRetry(modules.database.loadDatabase, retryOptions);
  if (database.kind === 'loaded') {
    proc.dbRef.current = database.value;
  } else {
    proc.dbFailed = true;
  }
  proc.part = compileAppProviderPart({
    databaseRef: proc.dbRef,
    setDatabase: () => undefined,
    saveDatabase: modules.database.saveDatabase,
    runExclusive: proc.runExclusive,
    persistCompletedWorkoutSessionToDatabase,
    createId,
  });
  await settle(proc);
  if (isDown(proc)) {
    count('launch refused');
    // A failed read must leave that key's rows as they were: an empty value saved over them is the lost history.
    // (A provider whose own read worked writes its bundle back, normalised, as it always does.)
    for (const kind of [proc.bundleFailed ? 'bundle' : null, proc.dbFailed ? 'db' : null]) {
      const rowsOf = (rows) => [...rows].filter(([key]) => kindOfKey(key) === kind).sort();
      if (kind && JSON.stringify(rowsOf(rowsBefore)) !== JSON.stringify(rowsOf(storage.inner.rows))) {
        fail('1', `a launch whose ${kind} read failed wrote to storage`);
      }
    }
  } else if (bundle.value.freestyleDraft) {
    const draft = bundle.value.freestyleDraft;
    // App.tsx hands the screen what discardSavedFreestyleDraft leaves of it; options.stale is a draft that
    // reached the screen unfiltered (a database read behind the draft's), the save layer's own case.
    const kept = options.stale ? draft : emptyWorkout.discardSavedFreestyleDraft(draft, proc.dbRef.current);
    if (!kept) {
      // Dropped: every set the draft holds as done must be in the saved session it names - unless the draft was
      // written before that save, which is the board as it stood at Finish and so supersedes it (a weight changed
      // in the last 400 ms before Finish is in the save, not in the draft).
      const saved = world.expectedDb.get(draft.sessionId);
      const lost = saved ? subtractSets(doneSetsOfBoard(draft.exercises), saved.sets) : doneSetsOfBoard(draft.exercises);
      const superseded = Boolean(saved) && draft.savedAtMs > 0 && draft.savedAtMs <= saved.at;
      if (superseded && lost.length > 0) {
        count('board written before its save dropped');
      }
      if (lost.length > 0 && !superseded) {
        fail('1', `a restored free workout board was dropped with ${lost.length} done sets (${lost.join(' ')}) that no saved workout holds`);
      }
      count('leftover board dropped');
      world.fsAtDraft = null;
      dispatch(proc, { type: 'freestyle/clear' });
      await settle(proc);
    } else {
      proc.fs = {
        exercises: JSON.parse(JSON.stringify(kept.exercises)),
        startedAtMs: emptyWorkout.resolveFreestyleDraftStart(kept, world.now),
        // The screen's mount effect hands a board it was given under a new id to the provider after 400 ms.
        lastEditMs: world.now,
        dirty: kept.sessionId !== draft.sessionId,
        sessionId: emptyWorkout.resolveFreestyleSessionId(kept),
        draftSavedAtMs: kept.savedAtMs,
      };
      if (kept.sessionId !== draft.sessionId) {
        count('restored board kept under a new id');
      }
    }
  }
  return proc;
}

// ---------------------------------------------------------------------------
// Reading the session
// ---------------------------------------------------------------------------

function loggedSetsOf(session) {
  const logged = new Map();
  for (const exercise of session?.exercises ?? []) {
    for (const set of exercise.sets) {
      if (set.status === 'completed') {
        logged.set(setKey(exercise.slotId, set.setIndex), { reps: set.actualReps, kg: set.actualLoadKg });
      }
    }
  }
  return logged;
}

/** The done, loggable sets of a board as reps@kg, sorted. */
function doneSetsOfBoard(exercises) {
  const found = [];
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      if (set.done && emptyWorkout.isLoggableFreestyleSet(set)) {
        found.push(`${parseNumberInput(set.reps)}@${parseNumberInput(set.kg) ?? 0}`);
      }
    }
  }
  return found.sort();
}

/** Lift by lift, in order: "name:reps@kg,reps@kg" for each lift with a done set (the save compares exactly this). */
function liftSignatureOf(exercises) {
  return exercises
    .map((exercise) => {
      const sets = exercise.sets
        .filter((set) => set.done && emptyWorkout.isLoggableFreestyleSet(set))
        .map((set) => `${parseNumberInput(set.reps)}@${parseNumberInput(set.kg) ?? 0}`);
      return sets.length > 0 ? `${exercise.name.trim().toLowerCase()}:${sets.join(',')}` : null;
    })
    .filter(Boolean);
}

/** `all` less `some`, as multisets of strings: what of `all` is not in `some`. */
function subtractSets(all, some) {
  const pool = new Map();
  some.forEach((key) => pool.set(key, (pool.get(key) ?? 0) + 1));
  return all.filter((key) => {
    const left = pool.get(key) ?? 0;
    pool.set(key, left - 1);
    return left <= 0;
  });
}

function pendingSetsOf(session) {
  const found = [];
  for (const exercise of session?.exercises ?? []) {
    for (const set of exercise.sets) {
      if (set.status === 'pending') {
        found.push({ exercise, set });
      }
    }
  }
  return found;
}

const isTimedExercise = (exercise) => exercise.trackingMode === 'hold' || parseIntervalScheme(exercise.exerciseName) !== null;

const formatNumber = (value, comma) => (comma ? String(value).replace('.', ',') : String(value));

function walkNumbers(value, trail, visit) {
  if (typeof value === 'number') {
    visit(value, trail);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => walkNumbers(item, `${trail}[${index}]`, visit));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      walkNumbers(item, `${trail}.${key}`, visit);
    }
  }
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

function compareLogged(actual, expected, label) {
  for (const [key, want] of expected) {
    const got = actual.get(key);
    if (!got) {
      fail('1', `${label}: logged set ${key} (${want.reps} reps at ${want.kg} kg) is gone`);
    }
    if (got.reps !== want.reps || !sameNumber(got.kg, want.kg)) {
      fail('1', `${label}: logged set ${key} reads ${got.reps} reps at ${got.kg} kg, was ${want.reps} at ${want.kg}`);
    }
  }
  for (const [key, got] of actual) {
    if (!expected.has(key)) {
      fail('1', `${label}: set ${key} is logged (${got.reps} at ${got.kg}) and nobody logged it`);
    }
  }
}

const fsMapOf = (exercises) => {
  const map = new Map();
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      map.set(`${exercise.localKey}/${set.localKey}`, `${set.done}|${set.kg}|${set.reps}`);
    }
  }
  return map;
};

function compareFs(actualMap, expectedMap, label) {
  if ((actualMap === null) !== (expectedMap === null)) {
    fail('1', `${label}: the free workout's board is ${actualMap ? 'there' : 'gone'}, expected ${expectedMap ? 'there' : 'gone'}`);
  }
  if (!actualMap) {
    return;
  }
  for (const [key, want] of expectedMap) {
    if (actualMap.get(key) !== want) {
      fail('1', `${label}: free workout row ${key} reads ${actualMap.get(key) ?? 'nothing'}, was ${want}`);
    }
  }
  if (actualMap.size !== expectedMap.size) {
    fail('1', `${label}: the board holds ${actualMap.size} rows, expected ${expectedMap.size}`);
  }
}

function checkSessionSanity(session) {
  if (!session) {
    return;
  }
  const slotIds = new Set();
  for (const exercise of session.exercises) {
    if (slotIds.has(exercise.slotId)) {
      fail('4', `slot id ${exercise.slotId} is used twice in one session`);
    }
    slotIds.add(exercise.slotId);
    const indexes = new Set();
    for (const set of exercise.sets) {
      if (indexes.has(set.setIndex)) {
        fail('4', `set index ${set.setIndex} is used twice in ${exercise.slotId}`);
      }
      indexes.add(set.setIndex);
      if (set.status === 'completed') {
        const okReps = Number.isInteger(set.actualReps) && set.actualReps >= 1;
        const okKg = typeof set.actualLoadKg === 'number' && Number.isFinite(set.actualLoadKg) && set.actualLoadKg >= 0 && set.actualLoadKg <= 600;
        if (!okReps || !okKg) {
          fail('4', `logged set ${exercise.slotId}|${set.setIndex} holds ${set.actualReps} reps at ${set.actualLoadKg} kg`);
        }
      }
    }
  }
  walkNumbers(session, 'session', (value, trail) => {
    if (!Number.isFinite(value)) {
      fail('4', `${trail} is ${value}`);
    }
  });
  for (const field of ['startedAt', 'updatedAt']) {
    if (!Number.isFinite(Date.parse(session[field]))) {
      fail('4', `session.${field} is ${session[field]}`);
    }
  }
}

const setMultiset = (sets) => sets.map((set) => `${set.reps}@${set.kg}`).sort();

/**
 * The completed sets a saved session's logs hold, as reps@kg, sorted. Not in a skipped log: totals, records and
 * History count none of a skipped log's sets, so a set saved there is a set lost (the player never puts a done set
 * in one: a lift with a set logged is not skipped).
 */
function savedSets(database, sessionId) {
  return database.exerciseLogs
    .filter((log) => log.sessionId === sessionId && log.skipped !== true && log.status !== 'skipped')
    .flatMap((log) => log.sets)
    .filter((set) => set.status === 'completed' || set.outcome === 'completed')
    .map((set) => `${set.reps}@${set.weight}`)
    .sort();
}

function checkDatabase(database, label) {
  const ids = database.workoutSessions.map((session) => session.id);
  for (const id of ids) {
    if (ids.filter((other) => other === id).length !== 1) {
      fail('2', `${label}: session ${id} is in the database more than once`);
    }
  }
  for (const [id, expected] of world.expectedDb) {
    const row = database.workoutSessions.find((session) => session.id === id);
    if (!row) {
      fail('2', `${label}: session ${id} was saved (the save resolved) and is not in the database`);
    }
    const sets = savedSets(database, id);
    if (sets.length !== expected.sets.length || sets.some((value, index) => value !== expected.sets[index])) {
      fail('2', `${label}: session ${id} holds ${sets.length} sets [${sets.join(' ')}], the reader logged ${expected.sets.length} [${expected.sets.join(' ')}]`);
    }
    if (!Number.isFinite(row.durationMinutes) || row.durationMinutes < 1 || !Number.isFinite(Date.parse(row.performedAt))) {
      fail('4', `${label}: session ${id} has duration ${row.durationMinutes} and performedAt ${row.performedAt}`);
    }
  }
  for (const id of ids) {
    if (!world.expectedDb.has(id)) {
      fail('2', `${label}: session ${id} is in the database as saved, and no save of it resolved`);
    }
  }
}

function assertDurable(sessionId, what) {
  // N6: the claim comes after the write. The stored rows are what a kill would leave.
  if (!storage.rowsText().includes(`"id":"${sessionId}"`)) {
    fail('6', `${what} while session ${sessionId} was not on disk`);
  }
}

async function checkStorage(label) {
  // What a launch would read right now: the state of the last write that landed.
  const stored = await modules.persistence.loadWorkoutBundle();
  const durable = storage.durable();
  if (durable.session) {
    if (!stored.activeSession || stored.activeSession.sessionId !== durable.session.sessionId) {
      fail('1', `${label}: the stored bundle holds ${stored.activeSession ? `session ${stored.activeSession.sessionId}` : 'no session'}, expected ${durable.session.sessionId}`);
    }
  } else if (stored.activeSession) {
    fail('1', `${label}: the stored bundle holds a session nobody has been told is there`);
  }
  compareLogged(loggedSetsOf(stored.activeSession), durable.session?.sets ?? new Map(), `${label} (stored)`);
  if (Boolean(stored.activeCardio) !== durable.cardio) {
    fail('1', `${label}: the stored bundle ${stored.activeCardio ? 'holds' : 'lacks'} a cardio run it should ${durable.cardio ? 'hold' : 'lack'}`);
  }
  compareFs(stored.freestyleDraft ? fsMapOf(stored.freestyleDraft.exercises) : null, durable.fs, `${label} (stored)`);
}

async function checkAfter(label) {
  const proc = world.proc;
  if (isDown(proc)) {
    return;
  }
  const session = proc.state.activeSession;
  const expected = world.shadow.session;
  if (expected) {
    if (!session || session.sessionId !== expected.sessionId) {
      fail('1', `${label}: the live session is ${session ? session.sessionId : 'gone'}, expected ${expected.sessionId}`);
    }
  } else if (session) {
    fail('1', `${label}: a session is live that the reader did not start`);
  }
  compareLogged(loggedSetsOf(session), expected?.sets ?? new Map(), `${label} (live)`);
  checkSessionSanity(session);
  if (Boolean(proc.state.activeCardio) !== world.shadow.cardio) {
    fail('1', `${label}: the cardio run is ${proc.state.activeCardio ? 'live' : 'gone'}`);
  }
  compareFs(proc.state.freestyleDraft ? fsMapOf(proc.state.freestyleDraft.exercises) : null, world.fsAtDraft, `${label} (draft)`);
  if (proc.dbRef.current) {
    checkDatabase(proc.dbRef.current, `${label} (database in memory)`);
  }
  await checkStorage(label);
}

// ---------------------------------------------------------------------------
// Starting a session
// ---------------------------------------------------------------------------

function randomCustomTemplate(rnd) {
  const id = `custom_${int(rnd, 1e9).toString(36)}`;
  const sessionCount = 1 + int(rnd, 3);
  const sessions = [];
  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
    const sessionId = `${id}_s${sessionIndex}`;
    const exercises = [];
    const exerciseCount = 1 + int(rnd, 6);
    for (let index = 0; index < exerciseCount; index += 1) {
      const item = pick(rnd, LIBRARY);
      const repMin = 1 + int(rnd, 15);
      exercises.push({
        id: `${sessionId}_e${index}`,
        workoutTemplateId: id,
        workoutTemplateSessionId: sessionId,
        name: rnd() < 0.1 ? `${item.name} (30s on / 30s off)` : item.name,
        targetSets: int(rnd, 6),
        repMin,
        repMax: rnd() < 0.2 ? repMin - 1 : repMin + int(rnd, 10),
        restSeconds: pick(rnd, [null, 0, 30, 90]),
        trackedDefault: rnd() < 0.7,
        orderIndex: index,
        libraryItemId: item.id,
        supersetGroup: index > 0 && rnd() < 0.2 ? `ss_${sessionId}` : null,
      });
    }
    // A superset is a pair standing together; give the first one its group too.
    exercises.forEach((exercise, index) => {
      if (exercise.supersetGroup && exercises[index - 1] && !exercises[index - 1].supersetGroup) {
        exercises[index - 1].supersetGroup = exercise.supersetGroup;
      }
    });
    sessions.push({ id: sessionId, name: `Day ${sessionIndex + 1}`, orderIndex: sessionIndex, exerciseIds: exercises.map((exercise) => exercise.id), exercises });
  }
  const template = {
    id,
    name: 'My programme',
    exerciseIds: [],
    sessions: sessions.map(({ exercises: _exercises, ...rest }) => rest),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    origin: 'authored',
  };
  const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, LIBRARY, 90);
  return buildCustomSessionRuntimeTemplate(runtime, pick(rnd, sessions).id);
}

function readyDay(rnd) {
  const template = pick(rnd, TEMPLATES);
  const session = pick(rnd, template.sessions);
  return buildReadySessionRuntimeTemplate(template, session.id);
}

/** A set a reader could log first, valid by the rules the dial keeps. */
function validDraftFor(exercise) {
  const timed = isTimedExercise(exercise);
  const loaded = !isUnloadedTrackingMode(exercise.trackingMode);
  return { repsText: String(timed ? 30 : 8), loadText: loaded ? '20' : undefined };
}

/**
 * Invariant 3 on a session the reducer has just made: it can be adapted, and
 * one logged set makes it a record the save would keep.
 */
function probeSaveable(session, label) {
  checkSessionSanity(session);
  const slots = new Set(session.exercises.map((exercise) => exercise.slotId));
  if (slots.size !== session.exercises.length || session.exercises.length === 0) {
    fail('3', `${label}: the session has ${session.exercises.length} exercises and ${slots.size} distinct slots`);
  }
  if (session.exercises.some((exercise) => exercise.sets.length === 0)) {
    fail('3', `${label}: an exercise started with no sets`);
  }
  const first = session.exercises[0];
  const draft = validDraftFor(first);
  let state = { ...workoutInitialState, hydrated: true, activeSession: session };
  state = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId: first.slotId, setIndex: first.sets[0].setIndex, patch: { loadText: draft.loadText, repsText: draft.repsText } } });
  state = workoutReducer(state, { type: 'set/complete', payload: { slotId: first.slotId, setIndex: first.sets[0].setIndex, nowMs: world.now, unitPreference: 'kg' } });
  if (loggedSetsOf(state.activeSession).size !== 1) {
    fail('3', `${label}: the first set of ${first.exerciseName} (${first.trackingMode}) cannot be logged with ${draft.repsText} reps at ${draft.loadText ?? '-'} kg`);
  }
  const adapted = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, world.now);
  if (!sessionRecordedWork(adapted.logs) || !buildCompletedWorkoutRecord({ ...adapted, sessionId: 'probe' })) {
    fail('3', `${label}: a session with one logged set (${first.exerciseName}) does not make a saveable record`);
  }
}

// ---------------------------------------------------------------------------
// The finish, through the real handlers
// ---------------------------------------------------------------------------

/**
 * A violation raised inside a dependency the real handler calls would be caught by the handler's own
 * try/catch and shown as a failed save; it is kept here and rethrown once the handler is done.
 */
function watched(deps) {
  const wrap = (fn) =>
    typeof fn === 'function'
      ? (...args) => {
          const guard = (error) => {
            if (error instanceof Violation && !world.violation) {
              world.violation = error;
            }
            throw error;
          };
          try {
            const result = fn(...args);
            return result && typeof result.then === 'function' ? result.catch(guard) : result;
          } catch (error) {
            return guard(error);
          }
        }
      : fn;
  const wrapped = { ...deps };
  const defined = {};
  for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(deps.workout))) {
    defined[key] = d.get ? d : { ...d, value: wrap(d.value) };
  }
  wrapped.workout = Object.defineProperties({}, defined);
  for (const key of ['saveCompletedWorkoutSession', 'upsertWorkoutTemplate', 'deleteWorkoutTemplate', 'setCompletionSummary', 'replaceRoute', 'updatePreferences', 'setFinishSaveState']) {
    wrapped[key] = wrap(deps[key]);
  }
  return wrapped;
}

function finishDeps(proc, ev) {
  const database = proc.dbRef.current;
  return watched({
    workout: {
      get activeSession() {
        return proc.state.activeSession;
      },
      discardWorkout() {
        world.shadow.session = null;
        dispatch(proc, { type: 'session/discardWorkout' });
      },
      finishWorkout(performedAt) {
        // N6: finishing flips the session to completed and stamps the history; only a landed save may say so.
        const sessionId = proc.state.activeSession.sessionId;
        assertDurable(sessionId, 'the session was marked finished');
        dispatch(proc, { type: 'session/finishWorkout', payload: { performedAt } });
        const summary = proc.state.history.sessions[0];
        if (!summary || summary.sessionId !== sessionId || summary.setsCompleted !== world.pendingExpectation.length) {
          fail('2', `the slot history holds ${summary ? `${summary.setsCompleted} sets for ${summary.sessionId}` : 'no session'}, the reader logged ${world.pendingExpectation.length}`);
        }
      },
      adoptSessionId(sessionId) {
        // The shadow is the reader's session, which keeps its sets under the new id; written before the dispatch,
        // because the bundle write the dispatch issues takes its snapshot of the shadow.
        if (world.shadow.session) {
          world.shadow.session.sessionId = sessionId;
        }
        dispatch(proc, { type: 'session/adoptSessionId', payload: { sessionId } });
      },
      clearCompletedWorkout() {
        world.shadow.session = null;
        dispatch(proc, { type: 'session/clearCompletedSession' });
      },
      recordLoggedWorkout(input) {
        dispatch(proc, { type: 'history/recordLogged', payload: input });
      },
    },
    database,
    getDatabase: () => proc.dbRef.current,
    preferences: database.preferences,
    unitPreference: 'kg',
    exerciseLibrary: database.exerciseLibrary,
    updatePreferences: async () => {
      if (ev.killMid) {
        proc.killedMid = true;
        return new Promise(() => undefined);
      }
      if (ev.prefFail) {
        throw new Error('preferences write refused');
      }
      return undefined;
    },
    saveCompletedWorkoutSession: async (input) => {
      if (world.duringSave) {
        const interleave = world.duringSave;
        world.duringSave = null;
        await interleave();
      }
      const expected = world.pendingExpectation;
      // heldBefore: the id already names a saved workout (a finish of a restored session, merged in place).
      const attempt = { sessionId: input.sessionId, outcome: null, heldBefore: world.expectedDb.has(input.sessionId) };
      world.lastSave = attempt;
      try {
        const summary = await proc.part.persistCompletedWorkoutSession(input);
        attempt.outcome = 'resolved';
        // The id the sets landed under: the write may file them elsewhere than the caller asked (it reads the database itself).
        const landedAs = summary.sessionId;
        attempt.sessionId = landedAs ?? attempt.sessionId;
        if (landedAs) {
          const prior = world.expectedDb.get(landedAs);
          if (!prior) {
            world.expectedDb.set(landedAs, { sets: expected, lifts: world.pendingLifts, byIdentity: world.pendingByIdentity, byPlace: world.pendingByPlace, at: world.now });
          } else if (input.mergeStored && input.mergeBy === 'place' && landedAs === input.sessionId) {
            // A free workout board carried on under its saved id, merged into that save by place: a lift's key on the
            // board and the set's position in it. A done set on the board is saved as it stands; a stored set whose
            // place the board holds nothing done at stays. Built from the board alone, held to exactly by checkDatabase.
            if (!prior.byPlace) {
              fail('2', `a free workout was merged into ${landedAs}, which no free workout save wrote`);
            }
            const merged = new Map(prior.byPlace);
            world.pendingByPlace.forEach((value, place) => merged.set(place, value));
            const sets = setMultiset([...merged.values()]);
            world.pendingSaved = sets;
            world.expectedDb.set(landedAs, { sets, lifts: world.pendingLifts, byPlace: merged, at: world.now });
          } else if (input.mergeStored && landedAs === input.sessionId) {
            // The same workout finished again, merged with what is stored. The expectation is built here from the
            // shadow alone: a set is the slot, its place and the moment it was logged. A set the finish holds is
            // its latest value (a correction keeps its moment, so it is the stored set, once); a stored set the
            // finish lacks stays (it was logged before the bundle the session came back from, or taken back); a new
            // one is added. checkDatabase then holds the stored rows to exactly this: nothing lost, nothing twice.
            if (!prior.byIdentity) {
              fail('2', `a guided finish was merged into ${landedAs}, which no guided save wrote`);
            }
            const merged = new Map(prior.byIdentity);
            for (const identity of merged.keys()) {
              if (world.pendingTakenBack.has(merged.get(identity).at) && !world.pendingByIdentity.has(identity)) {
                merged.delete(identity);
              }
            }
            world.pendingByIdentity.forEach((value, identity) => merged.set(identity, value));
            const sets = setMultiset([...merged.values()]);
            world.pendingSaved = sets;
            world.expectedDb.set(landedAs, { sets, lifts: world.pendingLifts, byIdentity: merged, at: world.now });
          }
        }
        return summary;
      } catch (error) {
        attempt.outcome = 'failed';
        throw error;
      }
    },
    upsertWorkoutTemplate: (draft) =>
      proc.runExclusive(async () => {
        const current = proc.dbRef.current;
        const id = createId('workout');
        const sessionId = createId('workout_template_session');
        const exercises = draft.sessions[0].exercises.map((exercise, index) => ({
          id: createId('exercise'),
          workoutTemplateId: id,
          workoutTemplateSessionId: sessionId,
          name: exercise.name,
          targetSets: exercise.targetSets,
          repMin: exercise.repMin,
          repMax: exercise.repMax,
          restSeconds: exercise.restSeconds,
          trackedDefault: exercise.trackedDefault,
          orderIndex: index,
          libraryItemId: exercise.libraryItemId ?? null,
          supersetGroup: exercise.supersetGroup ?? null,
        }));
        const stamp = new Date().toISOString();
        let next = workoutTemplateRepository.upsert(current, {
          id,
          name: draft.name,
          exerciseIds: exercises.map((exercise) => exercise.id),
          sessions: [{ id: sessionId, name: draft.sessions[0].name, orderIndex: 0, exerciseIds: exercises.map((exercise) => exercise.id) }],
          createdAt: stamp,
          updatedAt: stamp,
          origin: draft.origin ?? 'authored',
          sourceTemplateId: null,
        });
        next = exerciseTemplateRepository.replaceForWorkoutTemplate(next, id, exercises);
        next = { ...next, preferences: { ...next.preferences, trainingFirstRunDismissed: true } };
        await proc.part.commit(next);
        return id;
      }),
    deleteWorkoutTemplate: (id) =>
      proc.runExclusive(async () => {
        await proc.part.commit(workoutTemplateRepository.remove(proc.dbRef.current, id));
      }),
    exercisePrLookup: { byLibraryItemId: {}, byName: {} },
    setCompletionSummary: (summary) => {
      if (summary) {
        assertDurable(summary.sessionId, 'the completion summary was shown');
      }
    },
    setFinishSaveState: (value) => {
      if (value.status !== 'idle') {
        const live = proc.state.activeSession?.sessionId ?? null;
        if (value.sessionId !== live) {
          fail('6', `the finish state (${value.status}) names session ${value.sessionId} while the running session is ${live}: the route guard resets it to idle, so the player is not locked while the save runs and a failed save has no retry`);
        }
      }
      proc.finishSaveState = value;
    },
    finishInFlightRef: proc.refs.finishInFlight,
    completionCountedRef: proc.refs.counted,
    summaryNavigationPendingRef: proc.refs.summaryPending,
    summaryExitRouteRef: proc.refs.summaryExit,
    getWorkoutLoggerFallbackRoute: () => ({ tab: 'home', screen: 'home' }),
    navigateBack: () => undefined,
    replaceRoute: (route) => {
      if (route.screen === 'summary' && world.lastSave?.sessionId) {
        assertDurable(world.lastSave.sessionId, 'the summary route opened');
      }
    },
    showToast: (message) => {
      world.toasts.push(message);
    },
  });
}

/** A violation a dependency raised inside the handler's own catch. */
function rethrowCaptured() {
  if (world.violation) {
    const violation = world.violation;
    world.violation = null;
    throw violation;
  }
}

const saveFailedToast = () => translate(world.proc.dbRef.current.preferences.appLanguage, 'toast.saveWorkoutFailed');

async function finishGuided(ev) {
  const proc = world.proc;
  const session = proc.state.activeSession;
  if (!session) {
    return;
  }
  if (session.status === 'completed') {
    // Held as finished until its summary clears it, and saved already: no caller opens the player for it
    // (navigateToActiveWorkout refuses it), so there is no Finish to press. Finishing it here made a failed save
    // "leave no resumable session" that no reader could have reached (bug hunt 5, 2026-10-03: it failed at seeds 1,
    // 2, 3 and 777 within 30 000 sequences).
    count('finish not offered: the session is already finished');
    return;
  }
  const expectedLogged = world.shadow.session?.sets ?? new Map();
  world.pendingExpectation = setMultiset([...expectedLogged.values()]);
  // A set is the moment it was logged (two in one moment told apart by a count).
  world.pendingByIdentity = new Map();
  for (const value of expectedLogged.values()) {
    let n = 0;
    while (world.pendingByIdentity.has(`${value.at}#${n}`)) n += 1;
    world.pendingByIdentity.set(`${value.at}#${n}`, value);
  }
  world.pendingTakenBack = new Set(world.shadow.session?.takenBack ?? []);
  world.pendingSaved = world.pendingExpectation;
  world.pendingByPlace = null;
  world.pendingLifts = null;
  world.lastSave = null;
  world.toasts = [];
  if (ev.saveFail) {
    storage.fault.writeDb = 1;
    storage.fault.dbSkip = 0;
  }
  if (ev.lostClear) {
    // The bundle writes behind the finish (the session marked finished, then cleared) never land: the save is on
    // disk, the stored session is still the live one, and the next launch brings it back active.
    storage.fault.writeBundle = 2;
  }
  const sessionAtFinish = world.proc.state.activeSession.sessionId;
  const saves = FINISH_SAVES(finishDeps(proc, ev));
  let thrown = null;
  const flow = saves.handleConfirmFinishWorkout().catch((error) => {
    thrown = error;
  });
  if (ev.killMid) {
    // The process dies inside the awaited preferences write: neither the clear nor the summary ever happens.
    await Promise.race([flow, new Promise((resolve) => setImmediate(resolve))]);
    await settle(proc);
    storage.fault.writeBundle = 0;
    return;
  }
  await flow;
  storage.fault.writeDb = 0;
  await settle(proc);
  storage.fault.writeBundle = 0;
  rethrowCaptured();
  if (proc.refs.finishInFlight.current) {
    fail('2', 'the finish left itself in flight: no second Finish can run');
  }
  const attempt = world.lastSave;
  if (!attempt) {
    // The nothing-lifted branch: a discard. Never with a set logged.
    if (expectedLogged.size > 0) {
      fail('2', `Finish with ${expectedLogged.size} logged sets did not try to save (took the nothing-lifted discard branch)`);
    }
    if (thrown && !ev.prefFail) {
      fail('4', `Finish threw ${thrown instanceof Error ? thrown.message : thrown}`);
    }
    count('finish discarded empty');
    return;
  }
  if (attempt.outcome === 'failed') {
    count('save failed');
    if (!attempt.heldBefore && world.expectedDb.has(attempt.sessionId)) {
      fail('2', 'a save that failed is expected as saved');
    }
    if (!attempt.heldBefore && proc.dbRef.current.workoutSessions.some((row) => row.id === attempt.sessionId)) {
      fail('2', `a save that failed left session ${attempt.sessionId} in the database in memory`);
    }
    const live = proc.state.activeSession;
    // The session the reader is still in, under the id its retry will save it under.
    if (!live || live.sessionId !== attempt.sessionId || live.status === 'completed') {
      fail('2', 'a save that failed left no resumable session behind');
    }
    if (!world.toasts.includes(saveFailedToast())) {
      fail('2', 'a save that failed did not say so');
    }
    if (proc.finishSaveState.status !== 'error') {
      fail('6', `a save that failed left the finish state at ${proc.finishSaveState.status}`);
    }
    return;
  }
  // The save resolved. What follows can still fail (the preferences write); the session is saved either way.
  count('save resolved');
  if (thrown) {
    fail('4', `Finish threw ${thrown instanceof Error ? thrown.message : thrown}`);
  }
  // N1 and N6 together: the summary said these sets were saved, so some session in the database holds exactly them
  // (merged with what was stored under the id, for a session finished again). (A session restored after a lost
  // clear, with sets added, was "already saved" under its old id and the new sets reached nothing.)
  const wanted = world.pendingSaved.join(' ');
  const holder = proc.dbRef.current.workoutSessions.find((row) => savedSets(proc.dbRef.current, row.id).join(' ') === wanted);
  if (!holder) {
    fail('2', `Finish showed ${world.pendingSaved.length} logged sets [${wanted}] as saved and no session in the database holds them`);
  }
  if (sessionAtFinish !== attempt.sessionId) {
    count('finish saved under an id of its own');
  }
  if (attempt.heldBefore) {
    count('finish of an id already stored (merged in place, or the same finish again)');
  }
  if (ev.lostClear) {
    count('finish with the clear lost');
  }
  if (ev.prefFail) {
    // The save is on disk and the preferences write behind it was refused: not a reason to say the save failed.
    count('saved, preferences refused');
  }
  if (world.toasts.length > 0) {
    fail('2', `Finish saved the workout and then said "${world.toasts[0]}"`);
  }
  if (proc.state.activeSession) {
    fail('2', 'a save that resolved left the session live');
  }
}

async function discardGuided(ev) {
  const proc = world.proc;
  if (!proc.state.activeSession) {
    return;
  }
  const saves = FINISH_SAVES(finishDeps(proc, ev));
  try {
    await saves.handleDiscardWorkout();
  } catch (error) {
    rethrowCaptured();
    fail('4', `Discard threw ${error instanceof Error ? error.message : error}`);
  }
  await settle(proc);
  // A preference is not allowed to refuse the reader's choice: the discard happens whether or not its write did.
  if (proc.state.activeSession) {
    fail('1', `a discard was refused${ev.prefFail ? ' because the preferences write behind it failed' : ''}: the session is still live`);
  }
  if (ev.prefFail) {
    count('discard with the preferences write refused');
  }
}

// ---------------------------------------------------------------------------
// The free workout board (EmptyWorkoutScreen), modelled
// ---------------------------------------------------------------------------

function fsNewSet() {
  world.keyCounter += 1;
  return { localKey: `fs${world.keyCounter}`, kg: '', reps: '', done: false };
}

function fsNewLift(rnd) {
  const item = pick(rnd, LIBRARY);
  world.keyCounter += 1;
  return {
    localKey: `fx${world.keyCounter}`,
    name: item.name,
    libraryItemId: item.id,
    imageUrl: null,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    trackedDefault: true,
    supersetGroup: null,
    displayName: item.name,
    initials: item.name.slice(0, 2).toUpperCase(),
    metaLabel: '',
    isBarbell: false,
    sets: [fsNewSet()],
  };
}

/** The screen refuses every edit while Finish is saving (finishingRef); a refused edit is not an edit. */
const fsLocked = () => {
  if (world.proc.fsFinishing) {
    count('board edit refused while saving');
    return true;
  }
  return false;
};

function fsTouch(proc) {
  if (proc.fsFinishing) {
    fail('1', 'a board edit was accepted while Finish was saving: it is in neither the save nor the board, and the board is cleared once the save lands');
  }
  proc.fs.lastEditMs = world.now;
  proc.fs.dirty = true;
  if (proc.fs.exercises.length === 0) {
    // An empty board clears the draft at once.
    proc.fs.dirty = false;
    proc.fs.sessionId = emptyWorkout.resolveFreestyleSessionId(null);
    world.fsAtDraft = null;
    dispatch(proc, { type: 'freestyle/clear' });
  }
}

/** The 400 ms debounce: the board is handed to the provider once it has been left alone that long. */
function pumpDebounce(proc) {
  const board = proc.fs;
  if (!board || !board.dirty || world.now - board.lastEditMs < 400) {
    return;
  }
  board.dirty = false;
  world.fsAtDraft = fsMapOf(board.exercises);
  dispatch(proc, {
    type: 'freestyle/save',
    payload: { snapshot: { exercises: JSON.parse(JSON.stringify(board.exercises)), startedAtMs: board.startedAtMs, rest: null, sessionId: board.sessionId, savedAtMs: world.now } },
  });
}

async function finishFreestyle(ev) {
  const proc = world.proc;
  const board = proc.fs;
  if (!board || proc.fsFinishing || !emptyWorkout.canFinishFreestyleSession(board.exercises)) {
    return;
  }
  proc.fsFinishing = true;
  world.toasts = [];
  world.lastSave = null;
  const doneSets = [];
  const byPlace = new Map();
  for (const exercise of board.exercises) {
    exercise.sets.forEach((set, position) => {
      if (set.done && emptyWorkout.isLoggableFreestyleSet(set)) {
        const value = { reps: parseNumberInput(set.reps), kg: parseNumberInput(set.kg) ?? 0, key: `${exercise.localKey}/${set.localKey}` };
        doneSets.push(value);
        if (exercise.name.trim().length > 0) {
          byPlace.set(`${exercise.localKey}|${position}`, value);
        }
      }
    });
  }
  world.pendingExpectation = setMultiset(doneSets);
  world.pendingByPlace = byPlace;
  world.pendingByIdentity = null;
  world.pendingLifts = liftSignatureOf(board.exercises);
  if (ev.during) {
    world.duringSave = async () => {
      await HANDLERS[ev.during]({ t: ev.during, dt: 0, r: ev.r2 ?? 3, valid: true });
    };
  }
  const templatesBefore = proc.dbRef.current.workoutTemplates.length;
  if (ev.saveFail) {
    storage.fault.writeDb = 1;
    storage.fault.dbSkip = ev.failAt ? 1 : 0;
  }
  const saves = FINISH_SAVES(finishDeps(proc, ev));
  const { draft, summary } = emptyWorkout.buildFreestyleFinish({
    exercises: board.exercises,
    workoutName: 'Free workout',
    startedAtIso: new Date(board.startedAtMs ?? world.now).toISOString(),
    performedAtIso: new Date(world.now).toISOString(),
    elapsedSeconds: 600,
    exercisePrLookup: { byLibraryItemId: {}, byName: {} },
    sessionId: board.sessionId,
  });
  // A true retry: a session already saved under this board's id with exactly these sets. Anything else must be written.
  const startId = board.sessionId;
  const priorSave = world.expectedDb.get(startId);
  const repeated = Boolean(priorSave?.lifts) && JSON.stringify(liftSignatureOf(board.exercises)) === JSON.stringify(priorSave.lifts);
  const idHeld = world.expectedDb.has(startId);
  const sessionsBefore = proc.dbRef.current.workoutSessions.length;
  let saved = false;
  try {
    // renderWorkoutTab's onSave: the template is named by date and flagged freestyle, and a failure toasts and rethrows.
    try {
      // EmptyWorkoutScreen.adoptSessionId: the board keeps the id the save files under, and hands it over at once.
      const adopt = (id) => {
        board.sessionId = id;
        board.dirty = false;
        world.fsAtDraft = fsMapOf(board.exercises);
        dispatch(proc, {
          type: 'freestyle/save',
          payload: { snapshot: { exercises: JSON.parse(JSON.stringify(board.exercises)), startedAtMs: board.startedAtMs, rest: null, sessionId: id, savedAtMs: world.now } },
        });
        count('board adopted a new id');
      };
      await saves.finishLoggedWorkoutSave({ ...draft, name: `${draft.name.trim()} 3.10.`, origin: 'freestyle' }, summary, adopt);
    } catch (error) {
      world.toasts.push(saveFailedToast());
      throw error;
    }
    saved = true;
    rethrowCaptured();
    // EmptyWorkoutScreen.handleFinish: on disk, nothing left to resume - clear the draft, drop the board.
    board.dirty = false;
    world.fsAtDraft = null;
    dispatch(proc, { type: 'freestyle/clear' });
    proc.fs = null;
    if (idHeld) {
      // A board under the id of its own earlier save is that workout carried on (or finished again): merged into that
      // save under the same id, never a second workout beside it with every shared set counted twice. checkDatabase
      // holds the stored rows to the merge.
      if (proc.dbRef.current.workoutSessions.length !== sessionsBefore) {
        fail('2', 'a free workout board finished again under its saved id was saved as a second workout');
      }
      if (!world.lastSave || world.lastSave.outcome !== 'resolved' || world.lastSave.sessionId !== startId) {
        fail('2', `the free workout's ${doneSets.length} sets were shown as saved and not merged into the workout under its id`);
      }
      checkDatabase(proc.dbRef.current, 'after a free workout board was finished again');
      count(repeated ? 'free workout board finished again, saved once' : 'free workout board carried on, merged into its save');
    } else {
      if (!world.lastSave || world.lastSave.outcome !== 'resolved' || proc.dbRef.current.workoutSessions.length !== sessionsBefore + 1) {
        fail('2', `the free workout's ${doneSets.length} sets were shown as saved and never written`);
      }
    }
    count('free workout saved');
  } catch (error) {
    if (error instanceof Violation) {
      throw error;
    }
    rethrowCaptured();
    count('free workout save failed');
    if (proc.dbRef.current.workoutTemplates.length !== templatesBefore) {
      fail('2', 'a free workout whose save failed left its template behind');
    }
    // A failed write leaves the database in memory as it was. A board with no earlier save has no row; one under the id
    // of its own earlier save keeps that row with the sets it was stored with (checkDatabase: every saved session holds
    // exactly its expected sets, and no row stands without a resolved save). (Read as "any row under that id", a
    // failed merge into a stored row looked like a leaked one: bug hunt 5, 2026-10-03.)
    if (!idHeld && world.lastSave && proc.dbRef.current.workoutSessions.some((row) => row.id === world.lastSave.sessionId)) {
      fail('2', 'a free workout whose save failed is in the database in memory');
    }
    if (idHeld) {
      checkDatabase(proc.dbRef.current, 'after a free workout board failed to merge into its save');
    }
    if (!world.toasts.includes(saveFailedToast())) {
      fail('2', 'a free workout whose save failed did not say so');
    }
    if (!proc.fs) {
      fail('2', 'a free workout whose save failed lost its board');
    }
    if (idHeld && proc.fs.sessionId !== startId) {
      fail('2', 'a board whose merge into its saved workout failed left that id: its retry would be saved beside it');
    }
  } finally {
    storage.fault.writeDb = 0;
    storage.fault.dbSkip = 0;
    proc.fsFinishing = false;
  }
  // A board merged into its earlier save keeps the template that save hangs on: no new one.
  if (saved && proc.dbRef.current.workoutTemplates.length !== templatesBefore + (idHeld ? 0 : 1)) {
    fail('2', 'a free workout that saved did not leave exactly its one template');
  }
  await settle(proc);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const HANDLERS = {
  async start(ev) {
    const proc = world.proc;
    const rnd = stream(ev.r);
    const active = proc.state.activeSession;
    // Every Start goes through navigateToActiveWorkout first; a session in progress takes the Start back to it.
    const door = compileDoor({
      workout: {
        get activeSession() {
          return proc.state.activeSession;
        },
        resumeWorkout() {
          dispatch(proc, { type: 'session/resume', payload: { nowMs: world.now } });
        },
      },
      showToast: () => undefined,
      navigateToGuidedWorkout: () => undefined,
      isWorkoutInProgress,
    });
    if (door({ resume: false })) {
      if (active.status === 'completed') {
        fail('3', `Start opened the finished workout ${active.sessionId} instead of starting one`);
      }
      return;
    }
    // WorkoutProvider.startCustomWorkout's own guard.
    if (proc.state.activeSession && proc.state.activeSession.status === 'active') {
      return;
    }
    const template = rnd() < 0.5 ? readyDay(rnd) : randomCustomTemplate(rnd);
    const progression = { automatedProgressionEnabled: rnd() < 0.5, setupLevel: pick(rnd, [null, 'beginner', 'advanced', 'pro']), nowMs: world.now };
    try {
      dispatch(
        proc,
        {
          type: 'session/startFromRuntimeTemplate',
          payload: { template, sessionOrderIndex: proc.state.history.sessions.length + 1, unitPreference: ev.lb ? 'lb' : 'kg', progression },
        },
        (next) => {
          if (world.seenSessionIds.has(next.activeSession.sessionId)) {
            fail('4', `session id ${next.activeSession.sessionId} was issued twice`);
          }
          world.seenSessionIds.add(next.activeSession.sessionId);
          world.shadow.session = { sessionId: next.activeSession.sessionId, sets: new Map(), takenBack: new Set() };
        },
      );
    } catch (error) {
      if (error instanceof Violation) {
        throw error;
      }
      fail('3', `Start threw on "${template.name}": ${error instanceof Error ? error.stack.split('\n').slice(0, 3).join(' | ') : error}`);
    }
    if (active && proc.state.activeSession.sessionId === active.sessionId) {
      fail('3', `Start left the finished session ${active.sessionId} in place`);
    }
    probeSaveable(proc.state.activeSession, `Start "${template.name}"`);
    count(active ? 'start over a finished session' : 'start');
  },

  async log(ev) {
    const proc = world.proc;
    const session = proc.state.activeSession;
    const candidates = pendingSetsOf(session).filter(({ exercise }) => exercise.status !== 'skipped');
    if (!session || isClosed(session) || candidates.length === 0) {
      return;
    }
    const rnd = stream(ev.r);
    const { exercise, set } = pick(rnd, candidates);
    const reps = isTimedExercise(exercise) ? 5 + 5 * int(rnd, 24) : 1 + int(rnd, 30);
    const loaded = !isUnloadedTrackingMode(exercise.trackingMode);
    const kg = (1 + int(rnd, 200)) * 2.5;
    dispatch(proc, {
      type: 'set/updateDraft',
      payload: { slotId: exercise.slotId, setIndex: set.setIndex, patch: { repsText: formatNumber(reps, ev.comma), ...(loaded ? { loadText: formatNumber(kg, ev.comma) } : {}) } },
    });
    dispatch(
      proc,
      { type: 'set/complete', payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs: world.now, unitPreference: ev.lb ? 'lb' : 'kg' } },
      (next) => {
        const after = next.activeSession.exercises.find((item) => item.slotId === exercise.slotId).sets.find((item) => item.setIndex === set.setIndex);
        if (after.status !== 'completed') {
          fail('1', `a valid set was refused: ${exercise.exerciseName} (${exercise.trackingMode}) set ${set.setIndex}, ${reps} reps${loaded ? ` at ${kg} kg` : ''}`);
        }
        world.shadow.session.sets.set(setKey(exercise.slotId, set.setIndex), { reps, kg: loaded ? kg : after.actualLoadKg, at: world.now });
      },
    );
    count('set logged');
  },

  async logBad(ev) {
    const proc = world.proc;
    const session = proc.state.activeSession;
    const candidates = pendingSetsOf(session);
    if (!session || isClosed(session) || candidates.length === 0) {
      return;
    }
    const rnd = stream(ev.r);
    const { exercise, set } = pick(rnd, candidates);
    const loaded = !isUnloadedTrackingMode(exercise.trackingMode);
    const ceiling = repsCeilingFor(exercise, set);
    const variants = [
      { reps: '0', load: '20', why: 'zero reps' },
      { reps: '', load: '20', why: 'no reps' },
      { reps: '-3', load: '20', why: 'negative reps' },
      { reps: String(ceiling + 1), load: '20', why: 'reps past the dial' },
      { reps: 'abc', load: '20', why: 'reps that are not a number' },
      ...(loaded ? [{ reps: '8', load: '601', why: 'a weight past 600 kg' }, { reps: '8', load: '-5', why: 'a negative weight' }] : []),
    ];
    const variant = pick(rnd, variants);
    dispatch(proc, { type: 'set/updateDraft', payload: { slotId: exercise.slotId, setIndex: set.setIndex, patch: { repsText: variant.reps, loadText: variant.load } } });
    const next = dispatch(proc, { type: 'set/complete', payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs: world.now, unitPreference: 'kg' } });
    const after = next.activeSession.exercises.find((item) => item.slotId === exercise.slotId).sets.find((item) => item.setIndex === set.setIndex);
    if (after.status === 'completed') {
      // A set the loader would drop on the next launch, or one nobody lifted.
      fail('4', `${variant.why} was logged as a set (${after.actualReps} reps at ${after.actualLoadKg} kg)`);
    }
    count('bad set refused');
  },

  async edit(ev) {
    const proc = world.proc;
    const shadow = world.shadow.session;
    if (!shadow || shadow.sets.size === 0 || isClosed(proc.state.activeSession)) {
      return;
    }
    const rnd = stream(ev.r);
    const key = pick(rnd, [...shadow.sets.keys()]);
    const [slotId, setIndexText] = key.split('|');
    const exercise = proc.state.activeSession.exercises.find((item) => item.slotId === slotId);
    const set = exercise.sets.find((item) => item.setIndex === Number(setIndexText));
    const lift = liftOfSet(exercise, set);
    const unloaded = isUnloadedTrackingMode(lift.trackingMode);
    if (rnd() < 0.25) {
      const bad = pick(rnd, [{ reps: 0, kg: 20 }, { reps: Number.NaN, kg: 20 }, { reps: 8, kg: 601 }, { reps: 8, kg: Number.NaN }, { reps: repsCeilingFor(lift, set) + 1, kg: 20 }]);
      if (unloaded && bad.kg !== 20) {
        return;
      }
      dispatch(proc, { type: 'set/editLogged', payload: { slotId, setIndex: set.setIndex, reps: bad.reps, loadKg: bad.kg } });
      count('bad edit refused');
      return;
    }
    const reps = isTimedExercise(lift) ? 5 + 5 * int(rnd, 24) : 1 + int(rnd, 30);
    const kg = (1 + int(rnd, 200)) * 2.5;
    // A correction is the same set: it keeps the moment it was logged.
    shadow.sets.set(key, { reps, kg: unloaded ? 0 : kg, at: shadow.sets.get(key).at });
    dispatch(proc, { type: 'set/editLogged', payload: { slotId, setIndex: set.setIndex, reps, loadKg: kg } });
    count('set corrected');
  },

  async undo(ev) {
    const proc = world.proc;
    const shadow = world.shadow.session;
    if (!shadow || shadow.sets.size === 0 || isClosed(proc.state.activeSession)) {
      return;
    }
    const key = pick(stream(ev.r), [...shadow.sets.keys()]);
    const [slotId, setIndex] = key.split('|');
    // Taken back: the moment it was logged is on record, so a merge with a stored copy drops that copy.
    (shadow.takenBack ??= new Set()).add(shadow.sets.get(key).at);
    shadow.sets.delete(key);
    dispatch(proc, { type: 'set/undo', payload: { slotId, setIndex: Number(setIndex) } });
    count('set unticked');
  },

  async addSet(ev) {
    const session = world.proc.state.activeSession;
    if (isClosed(session)) {
      return;
    }
    dispatch(world.proc, { type: 'exercise/addSet', payload: { slotId: pick(stream(ev.r), session.exercises).slotId } });
  },

  async removeSet(ev) {
    const session = world.proc.state.activeSession;
    if (isClosed(session)) {
      return;
    }
    // Refusals are the reducer's; a logged set going missing is what check 1 sees.
    dispatch(world.proc, { type: 'exercise/removeSet', payload: { slotId: pick(stream(ev.r), session.exercises).slotId } });
  },

  async insert(ev) {
    const session = world.proc.state.activeSession;
    if (isClosed(session)) {
      return;
    }
    const rnd = stream(ev.r);
    const item = pick(rnd, LIBRARY);
    const after = rnd() < 0.2 ? null : pick(rnd, session.exercises).slotId;
    dispatch(world.proc, {
      type: 'exercise/insertAfter',
      payload: {
        afterSlotId: after,
        exercise: {
          exerciseName: item.name,
          trackingMode: getCatalogTrackingMode(item.name),
          sets: 1 + int(rnd, 4),
          repsMin: 8,
          repsMax: 12,
          restSecondsMin: 60,
          restSecondsMax: 90,
          substitutionGroup: `custom_${item.id}`,
          libraryItemId: item.id,
        },
      },
    });
    count('exercise added');
  },

  async swap(ev) {
    const session = world.proc.state.activeSession;
    if (isClosed(session)) {
      return;
    }
    const rnd = stream(ev.r);
    const exercise = pick(rnd, session.exercises);
    const group = pick(rnd, SWAP_GROUPS);
    dispatch(world.proc, {
      type: 'exercise/swap',
      payload: { slotId: exercise.slotId, exerciseName: pick(rnd, group.allowedExerciseNames), substitutionGroup: group.id, unitPreference: 'kg' },
    });
    count('exercise swapped');
  },

  async skip(ev) {
    const session = world.proc.state.activeSession;
    if (isClosed(session)) {
      return;
    }
    dispatch(world.proc, { type: 'exercise/skip', payload: { slotId: pick(stream(ev.r), session.exercises).slotId } });
    count('exercise skipped');
  },

  async pause() {
    dispatch(world.proc, { type: 'session/pause' });
  },

  async resume() {
    dispatch(world.proc, { type: 'session/resume', payload: { nowMs: world.now } });
  },

  async timer(ev) {
    const session = world.proc.state.activeSession;
    if (!session) {
      return;
    }
    const rnd = stream(ev.r);
    const exercise = pick(rnd, session.exercises);
    const action = pick(rnd, [
      { type: 'timer/start', payload: { slotId: exercise.slotId, setIndex: 0, durationSeconds: 30 + int(rnd, 200), nowMs: world.now } },
      { type: 'timer/pause', payload: { nowMs: world.now } },
      { type: 'timer/resume', payload: { nowMs: world.now } },
      { type: 'timer/override', payload: { durationSeconds: 30 + int(rnd, 200), nowMs: world.now } },
      { type: 'timer/clear' },
      { type: 'session/tick', payload: { nowMs: world.now } },
    ]);
    dispatch(world.proc, action);
  },

  async step(ev) {
    if (!world.proc.state.activeSession) {
      return;
    }
    dispatch(world.proc, { type: 'session/setGuidedStep', payload: { stepIndex: int(stream(ev.r), 20), nowMs: world.now } });
  },

  async repeat(ev) {
    const proc = world.proc;
    const session = proc.state.activeSession;
    const candidates = pendingSetsOf(session);
    if (!session || isClosed(session) || candidates.length === 0) {
      return;
    }
    const { exercise, set } = pick(stream(ev.r), candidates);
    const before = loggedSetsOf(session);
    dispatch(
      proc,
      { type: 'set/repeatLast', payload: { slotId: exercise.slotId, setIndex: set.setIndex, nowMs: world.now, unitPreference: 'kg' } },
      (next) => {
        const after = next.activeSession.exercises.find((item) => item.slotId === exercise.slotId).sets.find((item) => item.setIndex === set.setIndex);
        if (after.status !== 'completed') {
          return;
        }
        const source = [...before.entries()].find(
          ([key, value]) => key.startsWith(`${exercise.slotId}|`) && value.reps === after.actualReps && sameNumber(value.kg, after.actualLoadKg),
        );
        if (!source) {
          fail('4', `repeat-last logged ${after.actualReps} reps at ${after.actualLoadKg} kg, which no logged set of ${exercise.exerciseName} held`);
        }
        world.shadow.session.sets.set(setKey(exercise.slotId, set.setIndex), { reps: after.actualReps, kg: after.actualLoadKg, at: world.now });
        count('set repeated');
      },
    );
  },

  async note(ev) {
    const session = world.proc.state.activeSession;
    if (!session) {
      return;
    }
    dispatch(world.proc, { type: 'exercise/updateNotes', payload: { slotId: pick(stream(ev.r), session.exercises).slotId, notes: 'felt heavy' } });
  },

  async finish(ev) {
    await finishGuided(ev);
  },

  async discard(ev) {
    await discardGuided(ev);
    count('discard');
  },

  /** Everything that would change a finished session's sets, tried on one: none of it may land. */
  async poke(ev) {
    const proc = world.proc;
    const before = proc.state.activeSession;
    if (!before || before.status !== 'completed') {
      return;
    }
    const rnd = stream(ev.r);
    const exercise = pick(rnd, before.exercises);
    const set = pick(rnd, exercise.sets);
    const slotId = exercise.slotId;
    for (const action of [
      { type: 'session/pause' },
      { type: 'set/updateDraft', payload: { slotId, setIndex: set.setIndex, patch: { repsText: '5', loadText: '20' } } },
      { type: 'set/complete', payload: { slotId, setIndex: set.setIndex, nowMs: world.now, unitPreference: 'kg' } },
      { type: 'set/undo', payload: { slotId, setIndex: set.setIndex } },
      { type: 'exercise/addSet', payload: { slotId } },
      { type: 'exercise/skip', payload: { slotId } },
    ]) {
      dispatch(proc, action);
      if (proc.state.activeSession !== before) {
        fail('1', `${action.type} changed a session that was finished and saved`);
      }
    }
    count('finished session poked');
  },

  async wait() {
    // Time only.
  },

  async clock() {
    // The jump is applied by the runner.
    count('clock jump');
  },

  async writeFail(ev) {
    if (ev.target === 'db') {
      storage.fault.writeDb = 1;
    } else {
      storage.fault.writeBundle = 1;
    }
  },

  async cardio(ev) {
    const op = pick(stream(ev.r), ['start', 'pause', 'resume', 'clear', 'start']);
    if (op === 'start') {
      world.shadow.cardio = true;
    } else if (op === 'clear') {
      world.shadow.cardio = false;
    }
    dispatch(world.proc, { type: `cardio/${op}`, payload: { activityType: 'run', nowMs: world.now } });
    count(`cardio ${op}`);
  },

  async fsAdd(ev) {
    if (fsLocked()) {
      return;
    }
    const proc = world.proc;
    if (!proc.fs) {
      proc.fs = { exercises: [], startedAtMs: world.now, lastEditMs: 0, dirty: false, sessionId: emptyWorkout.resolveFreestyleSessionId(null) };
    }
    proc.fs.exercises.push(fsNewLift(stream(ev.r)));
    fsTouch(proc);
  },

  async fsType(ev) {
    if (fsLocked()) {
      return;
    }
    const board = world.proc.fs;
    if (!board || board.exercises.length === 0) {
      return;
    }
    const rnd = stream(ev.r);
    const set = pick(rnd, pick(rnd, board.exercises).sets);
    set.kg = !ev.valid && rnd() < 0.15 ? pick(rnd, ['825', '', 'abc']) : formatNumber((1 + int(rnd, 160)) * 2.5, ev.comma);
    set.reps = !ev.valid && rnd() < 0.15 ? pick(rnd, ['8,5', '0', '']) : String(1 + int(rnd, 30));
    fsTouch(world.proc);
  },

  async fsTick(ev) {
    if (fsLocked()) {
      return;
    }
    const board = world.proc.fs;
    if (!board) {
      return;
    }
    const open = board.exercises.flatMap((exercise) => exercise.sets.filter((set) => !set.done && emptyWorkout.isLoggableFreestyleSet(set)));
    if (open.length === 0) {
      return;
    }
    const set = pick(stream(ev.r), open);
    if (!emptyWorkout.isLoggableFreestyleSet(set)) {
      return;
    }
    set.done = true;
    fsTouch(world.proc);
    count('free set ticked');
  },

  async fsUntick(ev) {
    if (fsLocked()) {
      return;
    }
    const board = world.proc.fs;
    if (!board) {
      return;
    }
    const done = board.exercises.flatMap((exercise) => exercise.sets.filter((set) => set.done));
    if (done.length === 0) {
      return;
    }
    pick(stream(ev.r), done).done = false;
    fsTouch(world.proc);
  },

  async fsAddSet(ev) {
    if (fsLocked()) {
      return;
    }
    const board = world.proc.fs;
    if (!board || board.exercises.length === 0) {
      return;
    }
    const exercise = pick(stream(ev.r), board.exercises);
    const carried = emptyWorkout.carryForwardFreestyleSet(exercise.sets);
    exercise.sets.push({ ...fsNewSet(), kg: carried.kg, reps: carried.reps });
    fsTouch(world.proc);
  },

  async fsRemove(ev) {
    if (fsLocked()) {
      return;
    }
    const board = world.proc.fs;
    if (!board || board.exercises.length === 0) {
      return;
    }
    board.exercises.splice(int(stream(ev.r), board.exercises.length), 1);
    fsTouch(world.proc);
  },

  async fsFinish(ev) {
    await finishFreestyle(ev);
  },

  async fsDiscard() {
    const proc = world.proc;
    if (!proc.fs) {
      return;
    }
    proc.fs = null;
    world.fsAtDraft = null;
    dispatch(proc, { type: 'freestyle/clear' });
  },

  async kill(ev) {
    const proc = world.proc;
    if (!isDown(proc)) {
      pumpDebounce(proc);
    }
    await settle(proc);
    if (ev.early && storage.loseLastBundleWrite()) {
      // The bundle write of the last commit was still in flight.
      count('kill with a write in flight');
    }
    count('kill');
    await relaunch(ev);
  },
};

async function relaunch(ev) {
  storage.fault = { writeBundle: 0, writeDb: 0, dbSkip: 0, readBundle: ev.rb ?? 0, readDb: ev.rd ?? 0 };
  const proc = await launch({ stale: ev.stale });
  storage.fault.readBundle = 0;
  storage.fault.readDb = 0;
  if (isDown(proc)) {
    return;
  }
  // Launch checks: what came back is what was stored, and the database holds every save that resolved.
  const durable = storage.durable();
  compareLogged(loggedSetsOf(proc.state.activeSession), durable.session?.sets ?? new Map(), 'after the launch');
  checkDatabase(proc.dbRef.current, 'after the launch (database as stored)');
  checkSessionSanity(proc.state.activeSession);
  // A board may come back under the id of its saved workout only when it was carried on after that save (its Finish
  // merges into it); one written before the save is that save, less its last edits.
  const savedUnderBoard = proc.fs ? world.expectedDb.get(proc.fs.sessionId) : undefined;
  if (!ev.stale && savedUnderBoard && !(proc.fs.draftSavedAtMs > savedUnderBoard.at)) {
    fail('2', `a free workout board written before its save came back under that save's id (${proc.fs.sessionId})`);
  }
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

const WEIGHTS = [
  ['start', 9], ['log', 30], ['logBad', 3], ['edit', 5], ['undo', 4], ['addSet', 4], ['removeSet', 3], ['insert', 3], ['swap', 4], ['skip', 3],
  ['pause', 2], ['resume', 2], ['timer', 4], ['step', 2], ['repeat', 3], ['note', 1], ['finish', 7], ['poke', 2], ['discard', 1], ['wait', 2], ['clock', 3],
  ['writeFail', 4], ['kill', 7], ['cardio', 2], ['fsAdd', 4], ['fsType', 9], ['fsTick', 9], ['fsUntick', 1], ['fsAddSet', 2], ['fsRemove', 1], ['fsFinish', 5], ['fsDiscard', 1],
];
const WEIGHT_TOTAL = WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
const DTS = [80, 250, 1500, 20000, 120000, 900000, 4 * 3600 * 1000];
// Across 2026-10-25 01:00 UTC (Helsinki 04:00 -> 03:00): forward a day and a bit, back an hour, a week.
const JUMPS = [-3600 * 1000, 25 * 3600 * 1000, 3 * 24 * 3600 * 1000, 7 * 24 * 3600 * 1000, 5 * 3600 * 1000];

/** Sequences that walk a path the random ones reach rarely: the finish and a kill right behind it. */
function scenario(rnd) {
  const ev = (t, extra = {}) => ({ t, dt: pick(rnd, [250, 1500, 20000]), r: int(rnd, 1 << 30), ...extra });
  if (rnd() < 0.3) {
    // A guided session whose save landed and whose clear was lost comes back active; the reader logs more and finishes.
    const first = Array.from({ length: 1 + int(rnd, 3) }, () => ev('log'));
    const more = Array.from({ length: int(rnd, 3) }, () => ev('log'));
    return [ev('start'), ...first, ev('finish', { lostClear: true, ...(rnd() < 0.2 ? { prefFail: true } : {}) }), ev('kill'), ...more, ev('finish', rnd() < 0.2 ? { saveFail: true } : {})];
  }
  if (rnd() < 0.5) {
    const lifts = [ev('fsAdd'), ev('fsType'), ev('fsTick'), ev('fsAdd'), ev('fsType'), ev('fsTick')];
    return [...lifts, ev('wait', { dt: 1500 }), ev('fsFinish', rnd() < 0.3 ? { saveFail: true, failAt: int(rnd, 2) } : {}), ev('kill', rnd() < 0.7 ? { early: true } : {}), ev('fsFinish')];
  }
  const sets = Array.from({ length: 1 + int(rnd, 4) }, () => ev('log'));
  const closing = pick(rnd, [{ killMid: true }, { prefFail: true }, {}, { saveFail: true }]);
  return [ev('start'), ...sets, ev('finish', closing), ev('kill', rnd() < 0.5 ? { early: true } : {}), ev('poke'), ev('start'), ev('log'), ev('finish')];
}

function generate(rnd) {
  const length = 8 + int(rnd, 40);
  const events = rnd() < 0.15 ? scenario(rnd) : [];
  for (let index = 0; index < length; index += 1) {
    let draw = rnd() * WEIGHT_TOTAL;
    let t = 'log';
    for (const [name, weight] of WEIGHTS) {
      draw -= weight;
      if (draw < 0) {
        t = name;
        break;
      }
    }
    if (index === 0 && rnd() < 0.7) {
      t = 'start';
    }
    const event = { t, dt: pick(rnd, DTS), r: int(rnd, 1 << 30) };
    if (rnd() < 0.2) {
      event.comma = true;
    }
    if (rnd() < 0.2) {
      event.lb = true;
    }
    if (t === 'finish') {
      if (rnd() < 0.25) {
        event.saveFail = true;
      }
      if (rnd() < 0.1) {
        event.prefFail = true;
      }
      if (rnd() < 0.08) {
        event.killMid = true;
      }
      if (rnd() < 0.1) {
        event.lostClear = true;
      }
    } else if (t === 'fsFinish') {
      if (rnd() < 0.3) {
        event.saveFail = true;
        event.failAt = int(rnd, 2);
      }
      if (rnd() < 0.3) {
        event.during = pick(rnd, ['fsTick', 'fsType', 'fsAddSet', 'fsAdd', 'fsRemove']);
        event.r2 = int(rnd, 1 << 30);
      }
    } else if (t === 'discard') {
      if (rnd() < 0.15) {
        event.prefFail = true;
      }
    } else if (t === 'kill') {
      if (rnd() < 0.4) {
        event.early = true;
      }
      if (rnd() < 0.12) {
        event.rb = 1 + int(rnd, 3);
      }
      if (rnd() < 0.1) {
        event.stale = true;
      }
      if (rnd() < 0.06) {
        event.rd = 1 + int(rnd, 3);
      }
    } else if (t === 'writeFail') {
      event.target = pick(rnd, ['bundle', 'bundle', 'db']);
    } else if (t === 'clock') {
      event.jump = pick(rnd, JUMPS);
    }
    events.push(event);
  }
  return events;
}

function describe(event) {
  const rest = Object.entries(event)
    .filter(([key]) => key !== 't' && key !== 'dt' && key !== 'r')
    .map(([key, value]) => (value === true ? key : `${key}=${value}`));
  return [event.t, `dt=${event.dt}`, `r=${event.r}`, ...rest].join(':');
}

/** WORKOUT_INVARIANT_REPLAY="start:dt=80:r=5,log:dt=80:r=9,kill:dt=80:r=1:early", as describe() prints. */
function parseEvents(text) {
  return text.split(',').map((part) => {
    const [t, ...fields] = part.trim().split(':');
    const event = { t, dt: 80, r: 0 };
    for (const field of fields) {
      const [key, value] = field.split('=');
      event[key] = value === undefined ? true : Number.isNaN(Number(value)) ? value : Number(value);
    }
    return event;
  });
}

const DOWN_ALLOWED = new Set(['kill', 'wait', 'clock']);

async function runEvent(event) {
  world.now += event.t === 'clock' ? event.jump : event.dt;
  if (isDown(world.proc)) {
    if (!DOWN_ALLOWED.has(event.t)) {
      count('event while the app shows the storage error');
      return;
    }
  } else {
    pumpDebounce(world.proc);
  }
  await HANDLERS[event.t](event);
  if (!isDown(world.proc)) {
    await settle(world.proc);
  }
}

async function runSequence(events, seedForIds) {
  world = freshWorld();
  Math.random = mulberry32(seedForIds);
  let step = 0;
  try {
    await launch();
    await checkAfter('after the first launch');
    for (step = 0; step < events.length; step += 1) {
      const event = events[step];
      try {
        await runEvent(event);
      } catch (error) {
        if (error instanceof Violation) {
          throw error;
        }
        throw new Violation(`4: ${describe(event)} threw ${error instanceof Error ? error.stack.split('\n').slice(0, 4).join(' | ') : error}`);
      }
      if (event.t === 'finish' && event.killMid && world.proc.killedMid) {
        // The process died with the preferences write pending: relaunch, as a kill does.
        await relaunch({});
      }
      await checkAfter(`after ${describe(event)}`);
    }
    // Last: whatever the sequence left, a launch from it must hold.
    await HANDLERS.kill({ t: 'kill', dt: 80, r: 0 });
    await checkAfter('after the closing launch');
    if (world.unhandled.length > 0) {
      fail('4', `an unhandled rejection: ${world.unhandled[0]}`);
    }
    return null;
  } catch (error) {
    if (error instanceof Violation) {
      return { message: error.message, step };
    }
    throw error;
  }
}

/** Removes events while the same invariant still fails: the shortest sequence that shows it. */
async function shrink(events, failure, seedForIds) {
  const kind = failure.message.split(':')[0];
  let current = events.slice(0, failure.step + 1);
  let best = failure;
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const candidate = current.filter((_, at) => at !== index);
      const result = await runSequence(candidate, seedForIds);
      if (result && result.message.split(':')[0] === kind) {
        current = candidate.slice(0, result.step + 1);
        best = result;
        changed = true;
        break;
      }
    }
  }
  return { events: current, failure: best };
}

async function withEnvironment(run) {
  const RealDate = Date;
  const savedRandom = Math.random;
  const savedError = console.error;
  const savedTz = process.env.TZ;
  const onRejection = (reason) => world?.unhandled.push(reason instanceof Error ? reason.message : String(reason));
  process.env.TZ = 'Europe/Helsinki';
  // Without a clock change every statement about one is vacuously true.
  assert.deepEqual(
    [new Date(2026, 9, 24, 12).getTimezoneOffset(), new Date(2026, 9, 27, 12).getTimezoneOffset()],
    [-180, -120],
    'TZ override did not take effect, so the clock-change events prove nothing',
  );
  class TestDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(world ? world.now : START_MS);
      } else {
        super(...args);
      }
    }

    static now() {
      return world ? world.now : START_MS;
    }
  }
  global.Date = TestDate;
  console.error = () => undefined;
  process.on('unhandledRejection', onRejection);
  try {
    await run();
  } finally {
    process.off('unhandledRejection', onRejection);
    global.Date = RealDate;
    Math.random = savedRandom;
    console.error = savedError;
    if (savedTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = savedTz;
    }
    world = null;
  }
}

module.exports = [
  {
    name: `workout lifecycle: ${SEQUENCES} random sequences - start, log, correct, swap, kill, fail a write, finish and save - break no invariant of never-list N1, N2, N6`,
    async run() {
      await withEnvironment(async () => {
        if (REPLAY) {
          const events = parseEvents(REPLAY);
          const failure = await runSequence(events, SEED);
          assert.equal(failure, null, `${failure?.message} (at step ${failure ? failure.step + 1 : 0} of ${events.map(describe).join(', ')})`);
          return;
        }
        const random = mulberry32(SEED);
        for (let index = 0; index < SEQUENCES; index += 1) {
          const events = generate(random);
          const idSeed = SEED + index;
          const failure = await runSequence(events, idSeed);
          if (failure) {
            const small = await shrink(events, failure, idSeed);
            assert.fail(
              [
                `invariant broken (seed ${SEED}, sequence #${index}; reproduce with WORKOUT_INVARIANT_SEED=${SEED} WORKOUT_INVARIANT_SEQUENCES=${index + 1}).`,
                `  ${small.failure.message}`,
                `  shortest sequence (${small.events.length} steps; WORKOUT_INVARIANT_REPLAY="${small.events.map(describe).join(',')}" WORKOUT_INVARIANT_SEED=${idSeed}):`,
                ...small.events.map((event, at) => `    ${at + 1}. ${describe(event)}`),
              ].join('\n'),
            );
          }
        }
        if (STATS) {
          console.log([...STATS].sort().map(([key, n]) => `${n} ${key}`).join('\n'));
        }
      });
    },
  },
  {
    name: 'workout lifecycle: a saved free workout whose clear was lost is not a board to come back to - the next workout (a new one, or the old rows with sets added) is written, never shown as saved',
    async run() {
      const ev = (t, extra = {}) => ({ t, dt: 250, r: 7, ...extra });
      const saved = [ev('fsAdd'), ev('fsType', { valid: true }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500 }), ev('kill', { early: true })];
      const another = [ev('fsAdd'), ev('fsType', { valid: true, r: 9 }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500 })];
      const cases = {
        'remove every lift, log a new workout': [...saved, ev('fsRemove'), ...another],
        'keep the rows, add and correct sets': [...saved, ev('fsAddSet'), ev('fsType', { valid: true }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500 }), ...another],
      };
      // A draft that reaches the screen under a saved id with more sets (a database read behind the draft's):
      // the save layer is what stands between those sets and a summary over a write that never happened.
      cases['a stale board under a saved id, sets added: merged into that save'] = [
        ev('fsAdd'), ev('fsType', { valid: true }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500 }), ev('kill', { early: true, stale: true }),
        ev('fsAddSet'), ev('fsType', { valid: true, r: 11 }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500 }),
      ];
      cases['the same stale board, the new save failing and the app killed: the sets are not dropped as saved'] = [
        ev('fsAdd'), ev('fsType', { valid: true }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500 }), ev('kill', { early: true, stale: true }),
        ev('fsAddSet'), ev('fsType', { valid: true, r: 11 }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500, saveFail: true, failAt: 1 }), ev('kill'), ev('fsFinish', { dt: 1500 }),
      ];
      // The same board, carried on after the stale launch and handed to the provider, then a plain launch: a draft
      // with sets the saved workout lacks is not the saved workout, and must not be dropped as if it were.
      cases['a board with sets the saved workout lacks survives the next launch'] = [
        ev('fsAdd'), ev('fsType', { valid: true }), ev('fsTick'), ev('wait', { dt: 1500 }), ev('fsFinish', { dt: 1500 }), ev('kill', { early: true, stale: true }),
        ev('fsAddSet'), ev('fsType', { valid: true, r: 11 }), ev('fsTick'), ev('kill', { dt: 1500 }), ev('fsFinish', { dt: 1500 }),
      ];
      // Edits tried while the save awaits are refused, and the board stays what was saved.
      cases['a tick while Finish is saving'] = [
        ev('fsAdd'), ev('fsType', { valid: true }), ev('fsTick'), ev('fsAddSet'), ev('fsType', { valid: true, r: 5 }), ev('fsTick'), ev('wait', { dt: 1500 }),
        ev('fsFinish', { dt: 1500, during: 'fsTick', r2: 3 }), ev('kill', { early: true }),
      ];
      await withEnvironment(async () => {
        for (const [name, events] of Object.entries(cases)) {
          const failure = await runSequence(events, SEED);
          assert.equal(failure, null, `${name}: ${failure?.message} (at step ${failure ? failure.step + 1 : 0} of ${events.map(describe).join(', ')})`);
          const saves = [...world.expectedDb.keys()].length;
          assert.ok(saves >= 1, `${name}: expected the first workout and the next one saved, saw ${saves}`);
        }
        // A weight changed and Finish pressed inside the draft's 400 ms, the clear lost: the draft on disk holds the old
        // weight, a set the save does not. It was written before the save, so it is that save less its last edit: it
        // does not come back, and nothing is saved twice (bug hunt 2026-10-03: it came back, and its Finish wrote every
        // set again under `<id>_b`).
        const lagging = [
          ev('fsAdd'), ev('fsType', { valid: true }), ev('fsTick'), ev('wait', { dt: 1500 }),
          ev('fsType', { valid: true, r: 4, dt: 80 }), ev('fsFinish', { dt: 80 }), ev('kill', { early: true }),
        ];
        const failure = await runSequence(lagging, SEED);
        assert.equal(failure, null, `lagging draft: ${failure?.message}`);
        assert.equal(world.expectedDb.size, 1, 'one workout saved');
        assert.equal(world.proc.fs, null, 'the board written before its save does not come back');
      });
    },
  },
  {
    name: 'workout lifecycle: a guided session whose save landed and whose clear was lost comes back active - sets logged or corrected in it are merged into the stored workout under its id, an unchanged one is not saved twice, and a discard is never refused by a preference',
    async run() {
      const ev = (t, extra = {}) => ({ t, dt: 250, r: 7, ...extra });
      const begin = [ev('start', { r: 11 }), ev('log', { r: 1 }), ev('log', { r: 2 }), ev('finish', { lostClear: true }), ev('kill')];
      // How many saved sessions each path leaves: always the one. Whatever the finish holds is merged into the stored
      // workout under its id (checkDatabase holds its rows to the merge, set by set: nothing lost, nothing twice). A
      // stored set the finish lacks used to cost a second row under an id of its own, every shared set counted twice.
      const cases = [
        ['sets added after the relaunch: the one workout, finished further', [...begin, ev('log', { r: 3 }), ev('log', { r: 4 }), ev('finish')], 1],
        ['nothing added: the same finish again writes nothing', [...begin, ev('finish')], 1],
        ['sets added, the save failing, then the retry', [...begin, ev('log', { r: 3 }), ev('finish', { saveFail: true }), ev('finish')], 1],
        ['sets added, a kill, the board restored, Finish', [...begin, ev('log', { r: 3 }), ev('kill'), ev('finish')], 1],
        ['sets added, and the preferences write refused after the save', [...begin, ev('log', { r: 3 }), ev('finish', { prefFail: true })], 1],
        ['a stored set taken back and another logged: the taken-back set goes, the new one is saved', [...begin, ev('undo', { r: 5 }), ev('log', { r: 6 }), ev('finish')], 1],
        ['the same, the save failing, then the retry', [...begin, ev('undo', { r: 5 }), ev('log', { r: 6 }), ev('finish', { saveFail: true }), ev('finish')], 1],
        ['the same, the failed save killed and relaunched, then finished', [...begin, ev('undo', { r: 5 }), ev('log', { r: 6 }), ev('finish', { saveFail: true }), ev('kill'), ev('finish')], 1],
        ['a stored set corrected: saved once, corrected', [...begin, ev('edit', { r: 4 }), ev('finish')], 1],
        ['a stored set taken back, nothing else: it goes', [...begin, ev('undo', { r: 5 }), ev('finish')], 1],
        ['the slot swapped after the relaunch, a set logged as the new lift', [...begin, ev('swap', { r: 1 }), ev('log', { r: 3 }), ev('finish')], 1],
        ['the slot swapped after the relaunch, nothing logged', [...begin, ev('swap', { r: 2 }), ev('finish')], 1],
        ['a lift skipped after the relaunch, a set logged elsewhere', [...begin, ev('skip', { r: 1 }), ev('log', { r: 3 }), ev('finish')], 1],
        ['a stored set corrected and one added, the save failing, then the retry', [...begin, ev('edit', { r: 4 }), ev('log', { r: 3 }), ev('finish', { saveFail: true }), ev('finish')], 1],
        ['a discard whose preferences write is refused still discards', [...begin, ev('discard', { prefFail: true })], 1],
      ];
      await withEnvironment(async () => {
        for (const [name, events, saves] of cases) {
          const failure = await runSequence(events, SEED);
          assert.equal(failure, null, `${name}: ${failure?.message} (at step ${failure ? failure.step + 1 : 0} of ${events.map(describe).join(', ')})`);
          assert.equal(world.expectedDb.size, saves, `${name}: expected ${saves} saved session(s), saw ${world.expectedDb.size}`);
        }
      });
    },
  },
  {
    name: 'workout lifecycle: every day of every ready programme starts, takes a logged set on each lift, and makes a saveable record',
    async run() {
      await withEnvironment(async () => {
        world = freshWorld();
        let days = 0;
        for (const template of TEMPLATES) {
          for (const day of template.sessions) {
            const runtime = buildReadySessionRuntimeTemplate(template, day.id);
            let state = { ...workoutInitialState, hydrated: true };
            state = workoutReducer(state, {
              type: 'session/startFromRuntimeTemplate',
              payload: { template: runtime, sessionOrderIndex: 1, unitPreference: 'kg' },
            });
            const label = `${template.id} / ${day.id}`;
            probeSaveable(state.activeSession, label);
            for (const exercise of state.activeSession.exercises) {
              const draft = validDraftFor(exercise);
              state = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId: exercise.slotId, setIndex: exercise.sets[0].setIndex, patch: { loadText: draft.loadText, repsText: draft.repsText } } });
              state = workoutReducer(state, { type: 'set/complete', payload: { slotId: exercise.slotId, setIndex: exercise.sets[0].setIndex, nowMs: world.now, unitPreference: 'kg' } });
            }
            const logged = loggedSetsOf(state.activeSession);
            assert.equal(logged.size, state.activeSession.exercises.length, `${label}: a set on each lift was not logged`);
            const adapted = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, world.now);
            const saved = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase('en'), adapted);
            assert.ok(saved.didPersist, `${label}: the session was not saved`);
            assert.equal(savedSets(saved.database, adapted.sessionId).length, logged.size, `${label}: the saved session holds a different number of sets`);
            const finished = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: new Date(world.now).toISOString() } });
            assert.equal(finished.history.sessions[0].setsCompleted, logged.size, `${label}: the history holds a different number of sets`);
            days += 1;
          }
        }
        assert.ok(days > 150, `only ${days} days were walked`);
      });
    },
  },
];
